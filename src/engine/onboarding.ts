import { EXERCISES } from './exercises.ts';
import { availableExercises, coverageReport, gymFromCatalog, type GymSelection } from './equipment.ts';
import { assessLevel, levelProfile, type LevelAssessment } from './levels.ts';
import { MUSCLE_GROUPS, MUSCLE_LABELS_KO, landmarksFor } from './muscles.ts';
import { screenExercise } from './pain.ts';
import type { LifterProfile } from './strength.ts';
import type { SessionSlot, SessionTemplate } from './session.ts';
import type { Phase, WeeklyPlan } from './mesocycle.ts';
import type {
  Exercise,
  Joint,
  LandmarksByMuscle,
  MovementPattern,
  MuscleGroup,
  PainReport,
  TrainingLevel,
} from './types.ts';
import { planGoals, repRangeForGoals, type TrainingGoal } from './goals.ts';


export interface OnboardingAnswers {
  /** 설문에서 사용자가 고른 단계 */
  selfReportedLevel: TrainingLevel;
  /** 꾸준히 훈련한 개월 수 — 자가 신고 검증에 쓴다 */
  monthsTraining?: number;
  /**
   * 체중. 이력이 하나도 없는 첫날 중량을 뽑는 유일한 근거이고,
   * 자가 신고한 경력을 실제 기록과 대조하는 데도 쓴다.
   */
  bodyweightKg: number;
  sex?: 'male' | 'female' | 'unspecified';
  /** 주당 운동 일수 (2~7) */
  daysPerWeek: number;
  /**
   * 목표. 여러 개를 고를 수 있다 — "근비대도 하고 근력도 늘리면서 살도 빼고
   * 싶다"가 현장에서 가장 흔한 대답이다. 조합에 따라 반복 범위와 볼륨 상한이
   * 달라진다.
   */
  goals: TrainingGoal[];
  gym: GymSelection;
  /** 기존 통증·부상 */
  pain?: readonly PainReport[];
  /**
   * 약점 부위 — 최대 2개. 자리를 하나씩 더 주고 주간 목표를 MEV와 MAV 사이로 올린다.
   * 경력이 쌓일수록 "다 똑같이"가 아니라 "모자란 곳을 먼저"가 된다.
   */
  priorities?: readonly MuscleGroup[];
  /** 직접 고른 메인 종목. 그 동작의 첫 메인 자리에 들어간다. */
  mainLifts?: Partial<Record<MainLiftPattern, string>>;
}

/** 메인 종목을 직접 고를 수 있는 동작. */
export type MainLiftPattern =
  | 'squat' | 'hinge' | 'horizontalPush' | 'verticalPush' | 'verticalPull' | 'horizontalPull';

export const MAIN_LIFT_PATTERNS: readonly MainLiftPattern[] = [
  'squat', 'hinge', 'horizontalPush', 'verticalPush', 'verticalPull', 'horizontalPull',
];

export const MAIN_LIFT_LABELS_KO: Record<MainLiftPattern, string> = {
  squat: '스쿼트',
  hinge: '힌지(데드리프트류)',
  horizontalPush: '가슴 프레스',
  verticalPush: '어깨 프레스',
  verticalPull: '풀다운 · 풀업',
  horizontalPull: '로우',
};

/** 그 동작의 메인이 주로 겨누는 부위 — 딥스(삼두)가 어깨 프레스 후보로 뜨지 않게. */
const MAIN_LIFT_MUSCLES: Record<MainLiftPattern, readonly MuscleGroup[]> = {
  squat: ['quads'],
  hinge: ['hamstrings', 'glutes'],
  horizontalPush: ['chest'],
  verticalPush: ['frontDelt'],
  verticalPull: ['back'],
  horizontalPull: ['back'],
};

export const MAX_PRIORITIES = 2;

/** 약점으로 고를 수 있는 부위 — 따로 자리를 줄 수 있는 것만. */
export const PRIORITY_MUSCLES: readonly MuscleGroup[] = [
  'chest', 'back', 'sideDelt', 'rearDelt', 'biceps', 'triceps',
  'quads', 'hamstrings', 'glutes', 'calves', 'traps',
];

/**
 * 블록이 바뀔 때 프로그램을 다시 짜는 조건.
 * 처음 짤 때는 비워 둔다.
 */
export interface ProgramOptions {
  /** 지난 블록 프로그램 — 보조 · 고립 종목은 다른 것으로 바꿔 끼운다 */
  previous?: TrainingProgram;
  /** 다음 단계로 넘어가는 중이면 그 단계 쪽으로 볼륨을 얼마나 옮길지 (0~1) */
  blendToward?: { level: TrainingLevel; amount: number };
  /**
   * 지금까지 배운 기술 종목. 정해져 있으면 여기 없는 기술 종목은 뒤로 미룬다 —
   * 초보에서 올라온 사람에게 바벨 종목을 한 블록에 하나씩 들이는 장치다.
   */
  technicalIntroduced?: readonly string[];
}

export interface TrainingProgram {
  name: string;
  daysPerWeek: number;
  /**
   * 이 일정으로 기대할 수 있는 것의 한계.
   * 주 1~2회는 부위별 볼륨이 최소 자극선에 못 미치는 경우가 많다.
   * 되는 척하지 않고 무엇이 가능한지 말한다.
   */
  caution?: string;
  /** 주간 순환 템플릿 */
  templates: SessionTemplate[];
  /** 부위별 주간 목표 유효 세트 */
  weeklyTargets: Partial<Record<MuscleGroup, number>>;
}

export interface OnboardingResult {
  level: LevelAssessment;
  lifter: LifterProfile;
  gym: ReturnType<typeof gymFromCatalog>;
  program: TrainingProgram;
  /** 첫 주 처방 — 비교할 이력이 없는 주를 이걸로 채운다 */
  firstWeek: WeeklyPlan;
  /** 사용자에게 보여줄 안내 */
  notes: string[];
}

/* ── 분할 설계 ─────────────────────────────────────────────── */

type SlotRole = 'primary' | 'accessory' | 'isolation';

interface SlotSpec {
  muscle: MuscleGroup;
  role: SlotRole;
  patterns?: MovementPattern[];
  /** 약점 부위로 더한 자리 */
  priority?: boolean;
}

interface DayBlueprint {
  name: string;
  slots: SlotSpec[];
}

/*
 * 하루에 무거운 하체 복합(스쿼트 · 힌지)은 하나만 primary로 둔다.
 * 고중량 데드 뒤에 고중량 스쿼트를 붙이면 두 번째 종목 자세가 무너진다 —
 * 다른 하나는 accessory(8~12회)로 내려서 같은 날 넣는다.
 *
 * 측면 · 후면 삼각근은 따로 자리를 준다. 프레스로는 거의 안 채워지는 부위라
 * 자리를 안 주면 "팔만 크고 어깨는 좁은" 몸이 된다. 팔은 반대로 로우 · 프레스에서
 * 간접 볼륨이 많이 들어오므로 하루 한 자리면 충분하다.
 */
const PUSH: DayBlueprint = {
  name: '푸시',
  slots: [
    { muscle: 'chest', role: 'primary', patterns: ['horizontalPush'] },
    { muscle: 'frontDelt', role: 'primary', patterns: ['verticalPush'] },
    { muscle: 'chest', role: 'accessory', patterns: ['horizontalPush', 'isolation'] },
    { muscle: 'sideDelt', role: 'isolation' },
    { muscle: 'sideDelt', role: 'isolation' },
    { muscle: 'triceps', role: 'isolation' },
  ],
};

const PULL: DayBlueprint = {
  name: '풀',
  slots: [
    { muscle: 'back', role: 'primary', patterns: ['verticalPull'] },
    { muscle: 'back', role: 'primary', patterns: ['horizontalPull'] },
    { muscle: 'rearDelt', role: 'isolation' },
    { muscle: 'sideDelt', role: 'isolation' },
    { muscle: 'biceps', role: 'isolation' },
    { muscle: 'abs', role: 'isolation' },
  ],
};

const LEGS: DayBlueprint = {
  name: '레그',
  slots: [
    { muscle: 'quads', role: 'primary', patterns: ['squat'] },
    { muscle: 'hamstrings', role: 'accessory', patterns: ['hinge'] },
    { muscle: 'glutes', role: 'accessory', patterns: ['hinge', 'lunge'] },
    { muscle: 'quads', role: 'accessory', patterns: ['squat', 'isolation'] },
    { muscle: 'calves', role: 'isolation' },
  ],
};

const UPPER_A: DayBlueprint = {
  name: '상체 A',
  slots: [
    { muscle: 'chest', role: 'primary', patterns: ['horizontalPush'] },
    { muscle: 'back', role: 'primary', patterns: ['verticalPull'] },
    { muscle: 'chest', role: 'accessory', patterns: ['horizontalPush', 'isolation'] },
    { muscle: 'frontDelt', role: 'accessory', patterns: ['verticalPush'] },
    { muscle: 'sideDelt', role: 'isolation' },
    { muscle: 'biceps', role: 'isolation' },
    { muscle: 'triceps', role: 'isolation' },
  ],
};

const UPPER_B: DayBlueprint = {
  name: '상체 B',
  slots: [
    { muscle: 'back', role: 'primary', patterns: ['horizontalPull'] },
    { muscle: 'chest', role: 'primary', patterns: ['horizontalPush'] },
    { muscle: 'back', role: 'accessory', patterns: ['verticalPull', 'horizontalPull'] },
    { muscle: 'sideDelt', role: 'isolation' },
    { muscle: 'rearDelt', role: 'isolation' },
    { muscle: 'triceps', role: 'isolation' },
  ],
};

const LOWER_A: DayBlueprint = {
  name: '하체 A',
  slots: [
    { muscle: 'quads', role: 'primary', patterns: ['squat'] },
    { muscle: 'hamstrings', role: 'accessory', patterns: ['hinge'] },
    { muscle: 'quads', role: 'accessory', patterns: ['squat', 'isolation'] },
    { muscle: 'calves', role: 'isolation' },
    { muscle: 'abs', role: 'isolation' },
  ],
};

const LOWER_B: DayBlueprint = {
  name: '하체 B',
  slots: [
    { muscle: 'glutes', role: 'primary', patterns: ['hinge'] },
    { muscle: 'quads', role: 'accessory', patterns: ['squat', 'lunge'] },
    { muscle: 'hamstrings', role: 'isolation' },
    { muscle: 'calves', role: 'isolation' },
  ],
};

/*
 * 전신 A · B · C는 셋이 합쳐 한 주다. 주 2회면 A · B만 돌기 때문에
 * B에 대퇴사두 자리를 하나 더 둬서 스쿼트 패턴이 주 1회로 끝나지 않게 한다.
 */
const FULL_A: DayBlueprint = {
  name: '전신 A',
  slots: [
    { muscle: 'quads', role: 'primary', patterns: ['squat'] },
    { muscle: 'chest', role: 'primary', patterns: ['horizontalPush'] },
    { muscle: 'back', role: 'primary', patterns: ['verticalPull'] },
    { muscle: 'sideDelt', role: 'isolation' },
    { muscle: 'triceps', role: 'isolation' },
  ],
};

const FULL_B: DayBlueprint = {
  name: '전신 B',
  slots: [
    { muscle: 'hamstrings', role: 'primary', patterns: ['hinge'] },
    { muscle: 'frontDelt', role: 'primary', patterns: ['verticalPush'] },
    { muscle: 'back', role: 'primary', patterns: ['horizontalPull'] },
    { muscle: 'quads', role: 'accessory', patterns: ['squat', 'lunge', 'isolation'] },
    { muscle: 'rearDelt', role: 'isolation' },
    { muscle: 'biceps', role: 'isolation' },
  ],
};

const FULL_C: DayBlueprint = {
  name: '전신 C',
  slots: [
    { muscle: 'quads', role: 'primary', patterns: ['squat', 'lunge'] },
    { muscle: 'chest', role: 'primary', patterns: ['horizontalPush'] },
    { muscle: 'back', role: 'primary', patterns: ['verticalPull', 'horizontalPull'] },
    { muscle: 'hamstrings', role: 'accessory', patterns: ['hinge', 'isolation'] },
    { muscle: 'sideDelt', role: 'isolation' },
    { muscle: 'calves', role: 'isolation' },
  ],
};

/**
 * 주당 일수별 분할.
 *
 * 부위당 주 2회 이상이 되도록 짠다. "월=가슴, 화=등" 식으로 부위를 주 1회만
 * 도는 분할은 넣지 않았다 — 같은 볼륨이라도 자극이 덜하다는 게 빈도 모듈이
 * 말하는 바이고, 프로그램 생성기가 그 규칙을 어기면 앞뒤가 안 맞는다.
 * 그래서 주 3회도 PPL이 아니라 전신 3회다.
 */
/**
 * 주 7일을 고른 사람을 위한 날.
 *
 * 매일 고강도로 하면 회복이 안 된다. 그래서 7일째는 또 하나의 하드 세션이
 * 아니라 약한 부위를 채우고 관절 부담이 적은 것들로만 채운다 — 이런 날이
 * 있어야 나머지 6일을 제대로 할 수 있다.
 */
const ACCESSORY_DAY: DayBlueprint = {
  name: '보완 · 가벼운 날',
  slots: [
    { muscle: 'rearDelt', role: 'isolation' },
    { muscle: 'sideDelt', role: 'isolation' },
    { muscle: 'traps', role: 'isolation' },
    { muscle: 'forearms', role: 'isolation' },
    { muscle: 'abs', role: 'isolation' },
    { muscle: 'calves', role: 'isolation' },
  ],
};

const SPLITS: Record<number, DayBlueprint[]> = {
  // 주 1회는 늘리기 위한 일정이 아니라 지키기 위한 일정이다. 전신 한 번.
  1: [FULL_A],
  2: [FULL_A, FULL_B],
  3: [FULL_A, FULL_B, FULL_C],
  4: [UPPER_A, LOWER_A, UPPER_B, LOWER_B],
  5: [UPPER_A, LOWER_A, PUSH, PULL, LEGS],
  6: [PUSH, PULL, LEGS, PUSH, PULL, LEGS],
  7: [PUSH, PULL, LEGS, PUSH, PULL, LEGS, ACCESSORY_DAY],
};

const SPLIT_NAMES: Record<number, string> = {
  1: '주 1회 전신',
  2: '주 2회 전신',
  3: '주 3회 전신',
  4: '주 4회 상하체 분할',
  5: '주 5회 혼합 분할',
  6: '주 6회 푸시·풀·레그 2순환',
  7: '주 7회 푸시·풀·레그 2순환 + 보완일',
};

/* ── 종목 선택 ─────────────────────────────────────────────── */

const FREE_WEIGHT: readonly Exercise['equipment'][] = ['barbell', 'dumbbell'];

/** 한 관절에 이만큼 쌓이면 그 세션에서 더 싣지 않는다. */
const JOINT_LOAD_LIMIT = 1.2;

/**
 * 자세를 배우는 데 몇 주가 걸리는 바벨 종목.
 *
 * 6개월 미만 회원에게 첫 주부터 컨벤셔널 데드 · 바벨 로우 · 백 스쿼트를 주는
 * 트레이너는 없다. 허리가 말리는 걸 스스로 못 느끼는 시기라서다. 초보 블록은
 * 레그프레스 · 고블릿 스쿼트 · 머신 로우 · 루마니안 데드로 패턴을 먼저 만들고,
 * 중급으로 다시 짜면 이 종목들이 들어온다. 막지는 않는다 — 대안이 없는
 * 헬스장이면 초보에게도 이걸 준다.
 */
const TECHNICAL_LIFTS: ReadonlySet<string> = new Set([
  'back-squat', 'front-squat', 'conventional-deadlift', 'sumo-deadlift',
  'stiff-leg-deadlift', 'good-morning', 'barbell-row', 'pendlay-row', 't-bar-row',
  'barbell-overhead-press', 'kettlebell-swing',
]);

/**
 * 자극 대비 효율이 떨어지는 고립 종목.
 *
 * 없애진 않는다 — 기구가 이것뿐이면 이걸 해야 한다. 같은 자리에 케이블 푸시다운 ·
 * 프리처 컬 같은 선택지가 있으면 그쪽을 먼저 고른다.
 */
const LOW_VALUE_ISOLATION: ReadonlySet<string> = new Set([
  'triceps-kickback', 'concentration-curl', 'front-raise',
]);

/** 기본값으로 고를 이유가 적은 변형. 원하면 메인 종목으로 직접 고르면 된다. */
const SPECIALTY_LIFTS: ReadonlySet<string> = new Set(['decline-barbell-press', 'floor-press']);

const HEAVY_PULLS: ReadonlySet<string> = new Set(['conventional-deadlift', 'sumo-deadlift', 'trap-bar-deadlift']);

function scoreExercise(
  exercise: Exercise,
  slot: SlotSpec,
  level: TrainingLevel,
  sessionLoad: ReadonlyMap<Joint, number>,
  introduced?: readonly string[],
): number {
  const contribution = exercise.contribution[slot.muscle] ?? 0;
  let score = contribution * 10;

  if (slot.patterns?.includes(exercise.pattern)) score += 4;
  if (slot.role === 'isolation' && exercise.pattern === 'isolation') score += 2;
  if (slot.role === 'primary' && exercise.pattern !== 'isolation') score += 2;

  // 메인 자리에는 프리웨이트 복합 동작을 우선한다.
  // 머신으로만 채운 프로그램은 안전해 보이지만 배우는 게 없다.
  if (slot.role === 'primary' && exercise.pattern !== 'isolation' && FREE_WEIGHT.includes(exercise.equipment)) {
    score += 3;
  }

  // 초보자에게는 같은 값이면 관절 부담이 적은 쪽을 고른다.
  // 기본 동작을 밀어낼 만큼 크게 주지는 않는다 — 초보일수록 기본을 배워야 한다.
  if (level === 'beginner') {
    const stress = Object.values(exercise.jointStress).reduce((sum, value) => sum + value, 0);
    score -= Math.min(2, stress * 0.4);
  }

  // 아직 안 배운 기술 종목은 뒤로 — 초보이거나, 초보에서 올라오는 중이면.
  const learning = introduced ?? (level === 'beginner' ? [] : undefined);
  if (learning && TECHNICAL_LIFTS.has(exercise.id) && !learning.includes(exercise.id)) score -= 6;

  if (LOW_VALUE_ISOLATION.has(exercise.id)) score -= 3;
  if (SPECIALTY_LIFTS.has(exercise.id)) score -= 2;
  // 데드리프트는 메인 자리에서 무겁게 하는 종목이다. 8~12회 보조로 돌리지 않는다.
  if (slot.role !== 'primary' && HEAVY_PULLS.has(exercise.id)) score -= 5;

  // 한 세션에서 같은 관절에 최대 부하를 거듭 싣지 않는다.
  // 스쿼트 · RDL 뒤에 데드리프트를 붙이는 구성이 이 규칙 없이 자주 나온다.
  for (const [joint, stress] of Object.entries(exercise.jointStress) as [Joint, number][]) {
    const already = sessionLoad.get(joint) ?? 0;
    if (already >= JOINT_LOAD_LIMIT && stress >= 0.6) score -= stress * 3;
  }

  return score;
}

/**
 * 역할별 한 종목 세트 범위.
 *
 * 주간 목표를 슬롯 수로 나누면 한 종목에 7세트가 배정되기도 한다.
 * 현장에서 한 종목 7세트는 뒤 세트가 버려지는 구성이다 — 3~4세트로 끊고,
 * 모자란 볼륨은 주간 처방이 몇 주에 걸쳐 올린다.
 *
 * 고립 종목이 복합 종목보다 세트를 많이 받는 일은 없어야 한다. 스쿼트 3세트에
 * 킥백 4세트는 우선순위가 거꾸로 된 프로그램이다.
 */
const ROLE_SETS: Record<SlotRole, { floor: number; cap: number }> = {
  primary: { floor: 3, cap: 4 },
  accessory: { floor: 2, cap: 3 },
  isolation: { floor: 2, cap: 3 },
};

/** 간접 볼륨으로 셀 최소 기여도 — 로우의 이두, 프레스의 삼두 정도. */
const INDIRECT_CONTRIBUTION = 0.5;

/**
 * 한 세션 총 세트 상한.
 *
 * 세트당 휴식 포함 3~4분으로 잡으면 16세트가 대략 한 시간이다. 주 2~3회
 * 전신을 고른 사람 대부분은 퇴근 후 한 시간을 쓰는 직장인이고, 한 시간 반짜리
 * 프로그램은 3주 안에 안 나오게 된다. 넘치면 고립 종목부터 줄인다.
 */
function sessionSetCap(days: number, level: TrainingLevel): number {
  if (days <= 3) return 16;
  return level === 'advanced' || level === 'expert' ? 20 : 18;
}

function pickExercise(
  slot: SlotSpec,
  pool: readonly Exercise[],
  used: ReadonlySet<string>,
  level: TrainingLevel,
  sessionLoad: ReadonlyMap<Joint, number>,
  introduced?: readonly string[],
): Exercise | undefined {
  const minContribution = slot.role === 'accessory' ? 0.5 : 0.85;

  return pool
    .filter((exercise) => !used.has(exercise.id))
    .filter((exercise) => (exercise.contribution[slot.muscle] ?? 0) >= minContribution)
    .map((exercise) => ({ exercise, score: scoreExercise(exercise, slot, level, sessionLoad, introduced) }))
    .sort((a, b) => b.score - a.score)[0]?.exercise;
}

/** 고른 종목의 관절 부하를 세션 누계에 더한다. */
function addJointLoad(load: Map<Joint, number>, exercise: Exercise): void {
  for (const [joint, stress] of Object.entries(exercise.jointStress) as [Joint, number][]) {
    load.set(joint, (load.get(joint) ?? 0) + stress);
  }
}

/* ── 프로그램 생성 ─────────────────────────────────────────── */

/** 상체 · 하체 갈래 — 약점 자리를 어느 날에 붙일지 고를 때 쓴다. */
const LOWER_MUSCLES: ReadonlySet<MuscleGroup> = new Set(['quads', 'hamstrings', 'glutes', 'calves']);

/** 큰 부위는 보조 자리(8~12회 복합)로, 작은 부위는 고립 자리로 더한다. */
const PRIORITY_SLOT: Partial<Record<MuscleGroup, SlotSpec>> = {
  chest: { muscle: 'chest', role: 'accessory', patterns: ['horizontalPush', 'isolation'] },
  back: { muscle: 'back', role: 'accessory', patterns: ['verticalPull', 'horizontalPull'] },
  quads: { muscle: 'quads', role: 'accessory', patterns: ['squat', 'lunge', 'isolation'] },
  hamstrings: { muscle: 'hamstrings', role: 'isolation' },
  glutes: { muscle: 'glutes', role: 'accessory', patterns: ['hinge', 'lunge'] },
};

/**
 * 약점 부위에 자리를 더한다.
 *
 * 그 부위를 이미 하는 날을 먼저 고르고, 같은 갈래(상체 · 하체)의 날 중
 * 종목이 적은 날 순서로 최대 두 날에 붙인다. 자리는 메인 종목 바로 뒤 —
 * 현장에서 약점은 힘이 남아 있을 때 먼저 한다.
 */
function withPriorities(blueprints: readonly DayBlueprint[], priorities: readonly MuscleGroup[]): DayBlueprint[] {
  // 항상 사본을 돌려준다 — 아래에서 자리를 고쳐 쓰는데 원본 분할표는 건드리면 안 된다.
  const days = blueprints.map((day) => ({ name: day.name, slots: [...day.slots] }));

  for (const muscle of priorities.slice(0, MAX_PRIORITIES)) {
    const lower = LOWER_MUSCLES.has(muscle);
    const candidates = days
      .map((day, index) => ({
        index,
        direct: day.slots.some((slot) => slot.muscle === muscle),
        region: day.slots.some((slot) => LOWER_MUSCLES.has(slot.muscle) === lower && slot.muscle !== 'abs'),
        size: day.slots.length,
      }))
      .filter((item) => item.direct || item.region)
      // 이미 그 부위를 하는 날 중에서도 그 부위 종목이 적은 날로 — 한 날에
      // 레터럴 레이즈 세 가지가 몰리지 않게.
      .map((item) => ({ ...item, already: days[item.index]!.slots.filter((slot) => slot.muscle === muscle).length }))
      .sort((a, b) => Number(b.direct) - Number(a.direct) || a.already - b.already || a.size - b.size);

    for (const { index } of candidates.slice(0, Math.min(2, days.length))) {
      const day = days[index]!;
      const spec: SlotSpec = { ...(PRIORITY_SLOT[muscle] ?? { muscle, role: 'isolation' }), priority: true };
      const afterPrimary = day.slots.reduce((at, slot, i) => (slot.role === 'primary' ? i + 1 : at), 0);
      day.slots.splice(afterPrimary, 0, spec);
    }
  }
  return days;
}

/** 두 단계의 랜드마크 사이. 단계를 한 번에 건너뛰지 않으려고 쓴다. */
function blendLandmarks(
  from: LandmarksByMuscle,
  to: LandmarksByMuscle,
  amount: number,
): LandmarksByMuscle {
  const t = Math.min(1, Math.max(0, amount));
  const out = {} as LandmarksByMuscle;
  for (const muscle of MUSCLE_GROUPS) {
    const a = from[muscle];
    const b = to[muscle];
    out[muscle] = {
      mev: Math.round(a.mev + (b.mev - a.mev) * t),
      mav: Math.round(a.mav + (b.mav - a.mav) * t),
      mrv: Math.round(a.mrv + (b.mrv - a.mrv) * t),
    };
  }
  return out;
}

/**
 * 메인 종목으로 고를 수 있는 것 — 그 헬스장에서 되고, 그 동작인 복합 종목.
 */
export function mainLiftOptions(
  equipmentIds: readonly string[],
  pattern: MainLiftPattern,
): Exercise[] {
  const muscles = MAIN_LIFT_MUSCLES[pattern];
  return availableExercises(equipmentIds, EXERCISES)
    .filter((exercise) => exercise.pattern === pattern)
    .filter((exercise) => muscles.some((muscle) => (exercise.contribution[muscle] ?? 0) >= 0.7))
    .sort((a, b) => a.name.localeCompare(b.name, 'ko'));
}

export function buildProgram(
  answers: OnboardingAnswers,
  level: TrainingLevel,
  options: ProgramOptions = {},
): TrainingProgram {
  const profile = levelProfile(level);
  const days = Math.min(7, Math.max(1, Math.round(answers.daysPerWeek)));
  const priorities = (answers.priorities ?? [])
    .filter((muscle) => PRIORITY_MUSCLES.includes(muscle))
    .slice(0, MAX_PRIORITIES);
  const blueprints = withPriorities(SPLITS[days] ?? SPLITS[4]!, priorities);
  const landmarks = options.blendToward
    ? blendLandmarks(landmarksFor(level), landmarksFor(options.blendToward.level), options.blendToward.amount)
    : landmarksFor(level);
  const introduced = options.technicalIntroduced;

  // 약점 부위는 MEV가 아니라 MEV와 MAV 사이를 겨눈다.
  const targetFor = (muscle: MuscleGroup): number => {
    const landmark = landmarks[muscle];
    return priorities.includes(muscle) ? Math.round((landmark.mev + landmark.mav) / 2) : landmark.mev;
  };

  // 그 헬스장에서 가능하고, 기존 통증으로 막히지 않는 종목만 후보로 둔다.
  const pain = answers.pain ?? [];
  const pool = availableExercises(answers.gym.equipmentIds, EXERCISES).filter(
    (exercise) => screenExercise(exercise, pain).action !== 'stop',
  );

  // 직접 고른 메인 종목. 그 헬스장에서 되는 것만 받는다.
  const pinned = new Map<MainLiftPattern, Exercise>();
  for (const pattern of MAIN_LIFT_PATTERNS) {
    const id = answers.mainLifts?.[pattern];
    const exercise = id ? pool.find((item) => item.id === id) : undefined;
    if (exercise) pinned.set(pattern, exercise);
  }
  const reserved = new Set([...pinned.values()].map((exercise) => exercise.id));

  // 지난 블록의 보조 · 고립 종목 — 이번 블록에서는 다른 것으로 바꿔 끼운다.
  const rotateOut = new Set(
    (options.previous?.templates ?? [])
      .flatMap((template) => template.slots)
      // 역할이 없던 예전 프로그램은 반복 범위로 가린다 — 메인은 8회 아래에서 시작한다.
      .filter((slot) => (slot.role ?? (slot.repRange.min >= 8 ? 'accessory' : 'primary')) !== 'primary')
      .map((slot) => slot.exerciseId),
  );

  // 부위별로 주에 몇 개의 슬롯이 배정되는지 먼저 센다 — 세트 수 계산의 분모다.
  const slotCount = new Map<MuscleGroup, number>();
  for (const day of blueprints) {
    for (const slot of day.slots) {
      slotCount.set(slot.muscle, (slotCount.get(slot.muscle) ?? 0) + 1);
    }
  }

  /*
   * 고른 메인 종목이 들어갈 자리 — 그 동작의 첫 메인 자리, 없으면 그 동작을
   * 받는 첫 자리. 주 5회 분할처럼 힌지가 보조 자리에만 있는 날도 있다.
   */
  const pinSlot = new Map<string, Exercise>();
  for (const [pattern, exercise] of pinned) {
    const find = (primaryOnly: boolean): string | undefined => {
      for (let d = 0; d < blueprints.length; d += 1) {
        const slots = blueprints[d]!.slots;
        for (let i = 0; i < slots.length; i += 1) {
          const slot = slots[i]!;
          const fits = primaryOnly
            ? slot.role === 'primary' && slot.patterns?.[0] === pattern
            : slot.patterns?.includes(pattern) === true;
          if (fits && (exercise.contribution[slot.muscle] ?? 0) >= 0.5) return `${d}:${i}`;
        }
      }
      return undefined;
    };
    let at = find(true);
    if (!at) {
      /*
       * 메인 자리가 없으면 보조 자리를 메인으로 올린다. 고른 종목은 그 사람의
       * 메인이다 — 8~12회 보조로 돌리면 고른 의미가 없다. 대신 그날의 다른
       * 하체 메인은 보조로 내린다. 하루에 무거운 하체 복합은 하나다.
       */
      at = find(false);
      if (at) {
        const [d, i] = at.split(':').map(Number) as [number, number];
        const day = blueprints[d]!;
        const lowerCompound = (slot: SlotSpec) =>
          (slot.patterns ?? []).some((item) => item === 'squat' || item === 'hinge' || item === 'lunge');
        const promotedIsLower = lowerCompound(day.slots[i]!);
        const promoted: SlotSpec = { ...day.slots[i]!, role: 'primary' };
        const rest = day.slots
          .filter((_, index) => index !== i)
          .map((slot): SlotSpec =>
            promotedIsLower && slot.role === 'primary' && lowerCompound(slot) ? { ...slot, role: 'accessory' } : slot);
        // 메인은 그날 맨 앞 — 힘이 제일 남아 있을 때 한다.
        day.slots = [promoted, ...rest];
        at = `${d}:0`;
      }
    }
    if (at && !pinSlot.has(at)) pinSlot.set(at, exercise);
  }

  const weeklyTargets: Partial<Record<MuscleGroup, number>> = {};
  const usedThisWeek = new Set<string>();

  // 1단계 — 종목부터 전부 고른다. 세트 수는 주 전체를 본 뒤에 정해야
  // 로우가 이두에, 프레스가 삼두에 이미 준 볼륨을 뺄 수 있다.
  type Picked = { slot: SlotSpec; exercise: Exercise; sets: number };
  const week: Picked[][] = blueprints.map((day, dayIndex) => {
    const usedToday = new Set<string>();
    const sessionLoad = new Map<Joint, number>();
    const picked: Picked[] = [];

    day.slots.forEach((slot, slotIndex) => {
      const mine = pinSlot.get(`${dayIndex}:${slotIndex}`);

      let exercise: Exercise | undefined;
      if (mine && !usedToday.has(mine.id)) {
        exercise = mine;
      } else {
        // 주 안에서 종목이 겹치지 않게 하되, 후보가 마르면 재사용을 허용한다.
        // 보조 · 고립 자리는 지난 블록 종목을 먼저 피한다.
        const base = new Set([...usedToday, ...usedThisWeek, ...reserved]);
        const fresh = slot.role === 'primary' ? base : new Set([...base, ...rotateOut]);
        exercise =
          pickExercise(slot, pool, fresh, level, sessionLoad, introduced) ??
          pickExercise(slot, pool, base, level, sessionLoad, introduced) ??
          pickExercise(slot, pool, usedToday, level, sessionLoad, introduced);
      }
      if (!exercise) return;

      usedToday.add(exercise.id);
      usedThisWeek.add(exercise.id);
      addJointLoad(sessionLoad, exercise);
      picked.push({ slot, exercise, sets: 0 });
    });
    return picked;
  });

  const all = week.flat();
  const setRange = (role: SlotRole) => ({
    floor: ROLE_SETS[role].floor,
    cap: Math.min(ROLE_SETS[role].cap, profile.perSessionCap),
  });

  // 2단계 — 복합 종목. 부위의 주간 MEV를 그 부위 자리 수로 나눈다.
  for (const item of all) {
    if (item.slot.role === 'isolation') continue;
    const target = targetFor(item.slot.muscle);
    const divisor = Math.max(1, slotCount.get(item.slot.muscle) ?? 1);
    const { floor, cap } = setRange(item.slot.role);
    item.sets = clamp(Math.ceil(target / divisor), floor, cap);
  }

  // 복합 종목이 이미 채운 볼륨 — 이두 · 삼두 · 후면 삼각근은 여기서 꽤 찬다.
  const indirect = new Map<MuscleGroup, number>();
  for (const item of all) {
    if (item.slot.role === 'isolation') continue;
    for (const [muscle, value] of Object.entries(item.exercise.contribution) as [MuscleGroup, number][]) {
      if (value < INDIRECT_CONTRIBUTION) continue;
      indirect.set(muscle, (indirect.get(muscle) ?? 0) + item.sets * value);
    }
  }

  // 3단계 — 고립 종목은 남은 만큼만, 그리고 복합 종목보다 많지 않게.
  const isolationCount = new Map<MuscleGroup, number>();
  for (const item of all) {
    if (item.slot.role !== 'isolation') continue;
    isolationCount.set(item.slot.muscle, (isolationCount.get(item.slot.muscle) ?? 0) + 1);
  }
  for (const item of all) {
    if (item.slot.role !== 'isolation') continue;
    const muscle = item.slot.muscle;
    const remaining = targetFor(muscle) - (indirect.get(muscle) ?? 0);
    const { floor, cap } = setRange('isolation');
    item.sets = clamp(Math.ceil(remaining / Math.max(1, isolationCount.get(muscle) ?? 1)), floor, cap);
  }

  for (const item of all) weeklyTargets[item.slot.muscle] = targetFor(item.slot.muscle);

  // 4단계 — 세션이 길면 이미 넉넉한 부위부터 한 세트씩 덜어낸다.
  // 순서대로 고립 종목을 깎으면 정작 모자란 측면 삼각근 · 이두가 먼저 잘린다.
  // 메인 종목은 다른 걸 다 깎아도 넘칠 때만 손댄다.
  const limit = sessionSetCap(days, level);
  const surplus = (muscle: MuscleGroup): number => {
    const mev = targetFor(muscle);
    let volume = 0;
    for (const item of all) {
      const value = item.exercise.contribution[muscle] ?? 0;
      if (value >= INDIRECT_CONTRIBUTION) volume += item.sets * value;
    }
    return mev > 0 ? volume / mev : Number.POSITIVE_INFINITY;
  };
  // 약점 자리는 마지막까지 지킨다 — 그걸 깎으면 고른 의미가 없다.
  const passes: { roles: SlotRole[]; overOnly: boolean; priority: boolean }[] = [
    // 먼저 MEV를 넘긴 부위만 — 메인 종목이라도 넘치는 쪽을 먼저 깎는다.
    { roles: ['primary', 'accessory', 'isolation'], overOnly: true, priority: false },
    { roles: ['isolation', 'accessory'], overOnly: false, priority: false },
    { roles: ['primary'], overOnly: false, priority: false },
    { roles: ['primary', 'accessory', 'isolation'], overOnly: false, priority: true },
  ];
  const total = (picked: readonly Picked[]) => picked.reduce((sum, item) => sum + item.sets, 0);
  for (const picked of week) {
    for (const { roles, overOnly, priority } of passes) {
      /*
       * 약점 자리까지 깎기 전에, 다 깎았는데도 넘치면 약점이 아닌 고립 종목을
       * 통째로 뺀다. 약점을 넣으면 덜 중요한 것 하나가 빠지는 게 맞다 —
       * 현장에서도 시간은 그대로고 순서만 바뀐다.
       */
      if (priority) {
        while (total(picked) > limit) {
          const drop = picked
            .map((item, index) => ({ item, index, surplus: surplus(item.slot.muscle) }))
            .filter((entry) => entry.item.slot.role === 'isolation' && !entry.item.slot.priority)
            .sort((a, b) => b.surplus - a.surplus)[0];
          if (!drop) break;
          picked.splice(drop.index, 1);
          all.splice(all.indexOf(drop.item), 1);
        }
      }
      while (total(picked) > limit) {
        const candidate = picked
          .filter((item) => roles.includes(item.slot.role) && item.sets > ROLE_SETS[item.slot.role].floor)
          .filter((item) => priority || !item.slot.priority)
          .map((item) => ({ item, surplus: surplus(item.slot.muscle) }))
          .filter((entry) => !overOnly || entry.surplus > 1)
          .sort((a, b) => b.surplus - a.surplus || b.item.sets - a.item.sets)[0];
        if (!candidate) break;
        candidate.item.sets -= 1;
      }
    }
  }

  const templates: SessionTemplate[] = blueprints.map((day, dayIndex) => {
    // 같은 이름의 날이 두 번 나오면 (주 6회) 번호를 붙인다.
    const duplicate = blueprints.findIndex((other) => other.name === day.name) !== dayIndex;
    return {
      name: duplicate ? `${day.name} 2` : day.name,
      slots: week[dayIndex]!.map((item): SessionSlot => ({
        exerciseId: item.exercise.id,
        sets: item.sets,
        repRange: repRangeForGoals(item.slot.role, answers.goals),
        role: item.slot.role,
      })),
    };
  });

  return {
    name: SPLIT_NAMES[days] ?? `주 ${days}회 분할`,
    daysPerWeek: days,
    caution: cautionFor(days, weeklyTargets, landmarks),
    templates,
    weeklyTargets,
  };
}

/**
 * 이 일정의 한계를 그대로 말한다.
 *
 * 주 1~2회로는 대부분의 부위가 최소 자극선(MEV)에 닿지 않는다. 그걸 숨기고
 * "훌륭한 프로그램입니다"라고 하면 몇 달 뒤에 사용자가 앱을 탓하게 된다.
 * 무엇이 되고 무엇이 안 되는지 처음에 말해야 한다.
 */
function cautionFor(
  days: number,
  targets: Partial<Record<MuscleGroup, number>>,
  landmarks: ReturnType<typeof landmarksFor>,
): string | undefined {
  const below = MUSCLE_GROUPS.filter((muscle) => {
    const mev = landmarks[muscle].mev;
    return mev > 0 && (targets[muscle] ?? 0) < mev;
  });

  if (days === 1) {
    return '주 1회는 근육을 늘리기보다 지키는 일정입니다. 전신을 한 번에 돌려 ' +
      '빠지는 부위가 없게 짰지만, 부위별 볼륨은 최소 자극선에 못 미칩니다. ' +
      '늘리는 것이 목표라면 주 2회부터가 현실적입니다.';
  }

  if (below.length >= 6) {
    return `주 ${days}회로는 ${below.slice(0, 3).map((muscle) => MUSCLE_LABELS_KO[muscle]).join(', ')} 등 ` +
      `${below.length}개 부위가 최소 자극선에 닿지 않습니다. 하루를 더 낼 수 있으면 크게 달라집니다.`;
  }

  return undefined;
}

/* ── 온보딩 전체 ───────────────────────────────────────────── */

/**
 * 설문 답변 하나로 첫 프로그램까지 만든다.
 *
 * 순서가 중요하다. 단계를 먼저 확정하고(과대 신고 보정 포함), 그 단계의
 * 볼륨 랜드마크로 세트 수를 정하고, 마지막에 그 헬스장에 있는 종목으로만 채운다.
 */
export function runOnboarding(answers: OnboardingAnswers): OnboardingResult {
  const level = assessLevel({
    selfReported: answers.selfReportedLevel,
    monthsTraining: answers.monthsTraining,
    bodyweightKg: answers.bodyweightKg,
  });

  const profile = levelProfile(level.level);
  const gym = gymFromCatalog(answers.gym);
  const program = buildProgram(answers, level.level);
  const notes: string[] = [];

  if (level.adjusted) notes.push(level.note);

  notes.push(
    `${program.name} · ${profile.label} 볼륨으로 시작합니다. ` +
      `${profile.accumulationWeeks}주 축적 후 디로드가 들어갑니다.`,
  );

  const gaps = coverageReport(answers.gym.equipmentIds).filter((item) => !item.sufficient);
  if (gaps.length > 0) {
    const named = gaps.slice(0, 3).map((gap) => MUSCLE_LABELS_KO[gap.muscle]).join(', ');
    notes.push(`${named} 종목이 부족합니다. 헬스장에 있는 기구를 더 추가하면 프로그램이 채워집니다.`);
  }

  const noBarbellBasics = program.templates.every((template) =>
    template.slots.every((slot) => !TECHNICAL_LIFTS.has(slot.exerciseId)));
  if (level.level === 'beginner' && noBarbellBasics) {
    notes.push('처음에는 머신 · 덤벨로 자세를 먼저 만듭니다. 바벨 스쿼트 · 데드리프트는 중급으로 다시 짤 때 들어갑니다.');
  }

  if ((answers.pain ?? []).some((report) => report.score >= 3)) {
    notes.push('보고한 통증 부위에 부담이 큰 종목은 프로그램에서 제외했습니다.');
  }

  return {
    level,
    lifter: {
      bodyweightKg: answers.bodyweightKg,
      level: level.level,
      sex: answers.sex,
    },
    gym,
    program,
    firstWeek: firstWeekPlan(program, profile.startingRir),
    notes,
  };
}

/** 비교할 이력이 없는 첫 주의 처방. */
export function firstWeekPlan(program: TrainingProgram, targetRir: number): WeeklyPlan {
  const phase: Phase = 'accumulation';
  return {
    weekStart: '',
    phase,
    weekInBlock: 1,
    targetRir,
    intensityMultiplier: 1,
    fatigue: { score: 0, threshold: 5, deloadRecommended: false, signals: [] },
    volume: [],
    neglected: [],
    frequency: [],
    summary: `${program.name} 1주차 — 기준선을 잡는 주입니다. 목표 RIR ${targetRir}로 여유 있게 수행하세요.`,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
