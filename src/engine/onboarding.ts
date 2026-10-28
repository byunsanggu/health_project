import { EXERCISES, HEAVY_PULLS, exerciseById } from './exercises.ts';
import { availableExercises, coverageReport, gymFromCatalog, type GymSelection } from './equipment.ts';
import { assessLevel, levelProfile, type LevelAssessment } from './levels.ts';
import { MUSCLE_GROUPS, MUSCLE_LABELS_KO, landmarksFor } from './muscles.ts';
import { JOINT_LABELS_KO, screenExercise } from './pain.ts';
import { volumeReport } from './volume.ts';
import { templateWeekLogs } from './weekSets.ts';
import { withParticle } from './korean.ts';
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
  /** 평소 반복 스타일. 없거나 'auto'면 목표에 맞춘다 */
  repStyle?: RepStyle;
}

/**
 * 평소 반복 스타일.
 *
 * 근육을 키우는 데는 6회든 15회든 한계 가까이 가면 효과가 비슷하다. 그래서
 * 몇 회가 정답이라기보다 그 사람이 좋아하고 꾸준히 할 수 있는 쪽이 맞다.
 * 10~15회로 하는 사람에게 4~6회를 고집하면 앱을 안 따른다.
 */
export type RepStyle = 'auto' | 'heavy' | 'moderate' | 'light' | 'mixed';

export const REP_STYLES: readonly { id: RepStyle; label: string; hint: string }[] = [
  { id: 'auto', label: '목표에 맞춰', hint: '고른 목표대로 앱이 정합니다' },
  { id: 'heavy', label: '무겁게', hint: '바벨 메인 4~6회 · 나머지 6~12회' },
  { id: 'moderate', label: '보통', hint: '메인 6~10회 · 고립 10~15회' },
  { id: 'light', label: '가볍게 많이', hint: '메인 10~15회 · 고립 12~20회' },
  { id: 'mixed', label: '섞어서', hint: '동작마다 한 주에 한 번 무겁게, 나머지는 8~12회' },
];

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
  /**
   * 사용자가 직접 짠 루틴(routineProgram)인가. 블록이 바뀌어도 다시 짜지 않고,
   * 세트 수는 정한 대로 간다.
   */
  custom?: boolean;
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

/*
 * 레그 날에는 무릎을 굽히는 뒤허벅지 운동(레그컬)을 둔다. 엉덩이를 접는 힌지만으로는
 * 뒤허벅지가 덜 자란다 — 주 5 · 6회 분할에 레그컬이 한 번도 없던 것을 고쳤다. 둔근은
 * 스쿼트 · 힌지 · 런지에서 충분히 들어가므로 따로 자리를 두지 않는다.
 */
const LEGS: DayBlueprint = {
  name: '레그',
  slots: [
    { muscle: 'quads', role: 'primary', patterns: ['squat'] },
    { muscle: 'hamstrings', role: 'accessory', patterns: ['hinge'] },
    { muscle: 'quads', role: 'accessory', patterns: ['squat', 'lunge', 'isolation'] },
    { muscle: 'hamstrings', role: 'isolation', patterns: ['isolation'] },
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
    // 전신 분할에는 복근 자리가 없어서 맨몸 종목이 한 번도 안 들어갔다 — 짧게 하나.
    { muscle: 'abs', role: 'isolation' },
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

/*
 * 주 2회는 A · B만 돈다. B에 가슴 자리가 없으면 가슴이 주 1회 3~4세트로 끝난다 —
 * 최소 세트의 절반도 안 된다. 2회 분할의 B에는 가슴 보조 자리를 하나 더 둔다.
 */
const FULL_B_TWICE: DayBlueprint = {
  name: '전신 B',
  slots: [
    ...FULL_B.slots.slice(0, 3),
    { muscle: 'chest', role: 'accessory', patterns: ['horizontalPush'] },
    ...FULL_B.slots.slice(3),
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
  2: [FULL_A, FULL_B_TWICE],
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
export const TECHNICAL_LIFTS: ReadonlySet<string> = new Set([
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

/**
 * 덤벨만 있는 곳을 위한 종목. 기구가 있는 헬스장에서는 머신 카프레이즈 · 리버스 펙덱 ·
 * 벤치프레스처럼 더 안정적이거나 무겁게 다룰 수 있는 쪽을 먼저 고른다.
 */
const HOME_FALLBACK: ReadonlySet<string> = new Set([
  'dumbbell-calf-raise', 'dumbbell-rear-delt-fly', 'dumbbell-floor-press',
  'standing-dumbbell-press', 'dumbbell-bent-over-row',
]);

/** 허리를 많이 쓰는 힌지 — 하루에 하나만(덤벨 루마니안도 데드리프트 뒤에는 두 번째 힌지다) */
const HEAVY_HINGE_LOW_BACK = 0.5;

/**
 * 메인으로 무겁게 하기 어려운 종목. 고블릿 스쿼트는 들 수 있는 덤벨 하나가 상한이라
 * 중급부터는 다리에 비해 너무 가볍고(초보에게는 좋은 첫 스쿼트다), 케이블 풀스루는
 * 스택이 먼저 끝난다. 레그프레스 · 핵 스쿼트 · 힙 쓰러스트가 있으면 그쪽을 메인으로.
 */
const WEAK_MAIN: Readonly<Record<string, 'all' | 'notBeginner'>> = {
  'goblet-squat': 'notBeginner',
  'cable-pull-through': 'all',
};

/** 무게를 맞출 수 있는 세로 당기기 — 이게 있으면 풀업보다 먼저 */
const LOADABLE_PULLS: ReadonlySet<string> = new Set(['lat-pulldown', 'neutral-grip-pulldown', 'assisted-pull-up']);

/** 무게를 못 다루는 사람도 있는 맨몸 당기기. 할 수 있는지 모르는 처음에는 랫풀다운이 먼저다. */
const BODYWEIGHT_PULLS: ReadonlySet<string> = new Set(['pull-up', 'chin-up']);
const HOLDS: ReadonlySet<string> = new Set(['plank', 'side-plank']);
const HARD_BODYWEIGHT: ReadonlySet<string> = new Set(['chest-dip', 'triceps-dip', 'hanging-leg-raise']);
const LIGHT_BODYWEIGHT: ReadonlySet<string> = new Set(['bodyweight-reverse-lunge', 'glute-bridge']);

interface PickContext {
  level: TrainingLevel;
  sessionLoad: ReadonlyMap<Joint, number>;
  introduced?: readonly string[];
  /** 오늘 이미 고른 종목 */
  today: readonly Exercise[];
  /** 이번 주(앞선 날들 포함)에 이미 넣은 맨몸 종목 수 */
  weekBodyweight: number;
  /** 다음 날이 무거운 힌지(데드리프트) 날 */
  beforeHeavyHinge: boolean;
  /** 이 헬스장에 랫풀다운 · 어시스트 풀업이 있다 */
  loadablePull: boolean;
}

function scoreExercise(exercise: Exercise, slot: SlotSpec, context: PickContext): number {
  const { level, sessionLoad, introduced } = context;
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

  /*
   * 골고루 — 하루를 한 가지 기구로 채우지 않는다.
   *
   * 점수만 보면 그날 보조 · 고립이 전부 케이블 · 머신으로 몰렸다(초보 주 4회는
   * 머신 8 · 케이블 7에 맨몸 0). 같은 기구가 이미 둘 이상이면 조금씩 뒤로 민다.
   * 맨몸 종목(딥스 · 푸시업 · 친업 · 행잉 레그레이즈 · 플랭크 …)은 보조 · 고립
   * 자리에서 먼저 — 기구를 기다릴 일도 없고, 몸을 다루는 힘이 따로 는다.
   */
  const sameKit = context.today.filter((item) => item.equipment === exercise.equipment).length;
  if (sameKit >= 2) score -= 1.5 * (sameKit - 1);
  if (slot.role !== 'primary' && exercise.equipment === 'bodyweight' && !BODYWEIGHT_PULLS.has(exercise.id)) {
    const bodyweightToday = context.today.filter((item) => item.equipment === 'bodyweight').length;
    // 주에 하나도 없으면 더 앞으로 — 주 3회 전신처럼 자리가 적어도 한 번은 들어가게.
    if (bodyweightToday === 0) score += context.weekBodyweight === 0 ? 5 : 3;
  }

  // 딥스는 맨몸이어도 쉽지 않다 — 처음 시작하는 사람은 체중을 다 받아 내려가기 어렵고
  // 어깨 앞쪽이 먼저 아프다. 행잉 레그레이즈도 매달려 버틸 악력부터 필요하다.
  // 초보에게는 푸시업 · 데드버그 · 머신 쪽을 먼저 둔다.
  if (level === 'beginner' && HARD_BODYWEIGHT.has(exercise.id)) score -= 4;
  // 플랭크처럼 버티는 동작은 "몇 회"로 세기 어색하다 — 세트 기록이 횟수라 뒤로.
  if (HOLDS.has(exercise.id)) score -= 3;
  // 거꾸로 맨몸 런지 · 브릿지는 하체가 이미 강한 사람에게 자극이 모자란다 — 덤벨 쪽을 먼저.
  if (level !== 'beginner' && LIGHT_BODYWEIGHT.has(exercise.id)) score -= 3;

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
  if (HOME_FALLBACK.has(exercise.id)) score -= 3;
  // 데드리프트는 메인 자리에서 무겁게 하는 종목이다. 8~12회 보조로 돌리지 않는다.
  if (slot.role !== 'primary' && HEAVY_PULLS.has(exercise.id)) score -= 5;
  const weak = WEAK_MAIN[exercise.id];
  if (slot.role === 'primary' && weak && (weak === 'all' || level !== 'beginner')) score -= 4;

  /*
   * 풀업은 맨몸을 끌어올릴 수 있어야 한다. 처음 짜는 시점에는 몇 개 되는지 모른다 —
   * 경력 1년 남짓 회원도 0개인 경우가 흔하다. 무게를 맞출 수 있는 랫풀다운을 먼저 두고,
   * 풀업이 되는 사람은 메인 종목으로 직접 고른다. 철봉뿐인 곳이면 그래도 풀업이다.
   */
  if (BODYWEIGHT_PULLS.has(exercise.id) && context.loadablePull && (level === 'beginner' || level === 'intermediate')) score -= 2;

  /*
   * 다음 날이 데드리프트 날이면 오늘은 허리를 많이 쓰는 로우(바벨 로우 · T바)를 피한다.
   * 이틀 연달아 척추를 무겁게 싣게 된다 — 원암 로우 · 머신 로우로 같은 등을 한다.
   */
  if (context.beforeHeavyHinge && (exercise.jointStress.lowBack ?? 0) >= 0.7) score -= 3;

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
  context: PickContext,
): Exercise | undefined {
  /*
   * 메인 자리는 복합 동작만 — 덤벨만 있는 집에서 어깨 메인 자리에 프론트 레이즈가 들어간
   * 적이 있다. 대신 기여도는 0.75부터 받는다. 푸시업(가슴 0.8)이 가슴 메인이 못 돼서
   * 집에서 하는 사람의 가슴이 0세트였다. 더 나은 종목이 있으면 점수에서 밀린다.
   */
  const minContribution = slot.role === 'accessory' ? 0.5 : slot.role === 'primary' ? 0.75 : 0.85;

  // 오늘 이미 무거운 힌지가 있으면 두 번째 무거운 힌지는 넣지 않는다(데드 뒤 스티프 레그 데드)
  const heavyHinge = (exercise: Exercise) => exercise.pattern === 'hinge' && (exercise.jointStress.lowBack ?? 0) >= HEAVY_HINGE_LOW_BACK;
  const hingedToday = context.today.some(heavyHinge);

  const candidates = pool
    .filter((exercise) => !used.has(exercise.id))
    .filter((exercise) => slot.role !== 'primary' || (exercise.pattern !== 'isolation' && exercise.pattern !== 'core'))
    .filter((exercise) => !hingedToday || !heavyHinge(exercise))
    .filter((exercise) => (exercise.contribution[slot.muscle] ?? 0) >= minContribution);
  /*
   * 고립 자리에는 고립 종목이 먼저다. 레그컬 기계가 없는 곳에서 "뒤허벅지 고립" 자리에
   * 스티프 레그 데드리프트가 10~15회로 들어가던 것을 막는다 — 고립 종목이 하나도 없을
   * 때만 복합 동작으로 채운다.
   */
  const light = (exercise: Exercise) => exercise.pattern === 'isolation' || exercise.pattern === 'core';
  const narrowed = slot.role === 'isolation' && candidates.some(light) ? candidates.filter(light) : candidates;
  return narrowed
    .map((exercise) => ({ exercise, score: scoreExercise(exercise, slot, context) }))
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

  /*
   * 그 헬스장에서 가능하고, 기존 통증으로 막히지 않는 종목만 후보로 둔다.
   *
   * 오늘 통증이면 그 자리에서 대체할 종목(통증 3~6점 · 그 관절 부담 큼)도 프로그램에는
   * 처음부터 넣지 않는다. 무릎이 5점인 사람에게 백 스쿼트를 짜 두고 매번 대체하는 건
   * 프로그램이 아니다 — 레그프레스 · 벨트 스쿼트처럼 부담이 덜한 종목으로 짠다.
   */
  const pain = answers.pain ?? [];
  const pool = availableExercises(answers.gym.equipmentIds, EXERCISES).filter(
    (exercise) => !painKeepsOut(exercise, pain),
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
  let weekBodyweight = 0;

  // 1단계 — 종목부터 전부 고른다. 세트 수는 주 전체를 본 뒤에 정해야
  // 로우가 이두에, 프레스가 삼두에 이미 준 볼륨을 뺄 수 있다.
  type Picked = { slot: SlotSpec; exercise: Exercise; sets: number };
  const week: Picked[][] = blueprints.map((day, dayIndex) => {
    const usedToday = new Set<string>();
    const sessionLoad = new Map<Joint, number>();
    const picked: Picked[] = [];
    const next = blueprints[dayIndex + 1];
    const context: PickContext = {
      level, sessionLoad, introduced,
      today: [],
      weekBodyweight: 0,
      loadablePull: pool.some((exercise) => LOADABLE_PULLS.has(exercise.id)),
      beforeHeavyHinge: Boolean(next?.slots.some((slot) => slot.role === 'primary' && slot.patterns?.[0] === 'hinge')),
    };

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
        context.today = picked.map((item) => item.exercise);
        context.weekBodyweight = weekBodyweight;
        exercise =
          pickExercise(slot, pool, fresh, context) ??
          pickExercise(slot, pool, base, context) ??
          pickExercise(slot, pool, usedToday, context);
      }
      if (!exercise) return;

      usedToday.add(exercise.id);
      usedThisWeek.add(exercise.id);
      if (exercise.equipment === 'bodyweight') weekBodyweight += 1;
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
      setCap: limit,
      slots: week[dayIndex]!.map((item): SessionSlot => ({
        exerciseId: item.exercise.id,
        sets: item.sets,
        repRange: repRangeFor(item.exercise, item.slot.role, answers.goals),
        role: item.slot.role,
      })),
    };
  });

  const ranged = assignRepRanges(templates, answers.goals, level, answers.repStyle);

  return {
    name: SPLIT_NAMES[days] ?? `주 ${days}회 분할`,
    daysPerWeek: days,
    caution: cautionFor(days, ranged, landmarks, answers.gym.equipmentIds),
    templates: ranged,
    weeklyTargets,
  };
}

/** 모자라다고 말하지 않는 부위 — 다른 종목에서 저절로 채워지거나 따로 안 해도 되는 곳 */
const QUIET_WHEN_LOW: ReadonlySet<MuscleGroup> = new Set<MuscleGroup>(['frontDelt', 'forearms', 'abs']);
const EXERCISE_INDEX: ReadonlyMap<string, Exercise> = new Map(EXERCISES.map((exercise) => [exercise.id, exercise]));

/**
 * 이 일정의 한계를 그대로 말한다.
 *
 * 주 1~2회로는 대부분의 부위가 최소 자극선(MEV)에 닿지 않는다. 그걸 숨기고
 * "훌륭한 프로그램입니다"라고 하면 몇 달 뒤에 사용자가 앱을 탓하게 된다.
 * 무엇이 되고 무엇이 안 되는지 처음에 말해야 한다.
 *
 * 짠 프로그램을 한 주 다 했을 때 부위마다 몇 세트인지(볼륨 탭과 같은 셈)로 판단한다.
 * 목표로 판단하면 목표가 곧 최소라 한 번도 걸리지 않았다(주 2회 가슴 4세트에도 조용했다).
 * 기구가 없어서 못 채우는 부위는 여기서 말하지 않는다 — 그건 기구 안내가 따로 하고,
 * 홈짐에서 등이 0세트인데 "하루를 더 내라"고 하면 틀린 말이다.
 */
function cautionFor(
  days: number,
  templates: readonly SessionTemplate[],
  landmarks: ReturnType<typeof landmarksFor>,
  equipmentIds: readonly string[],
): string | undefined {
  if (days === 1) {
    return '주 1회는 근육을 늘리기보다 지키는 일정입니다. 전신을 한 번에 돌려 ' +
      '빠지는 부위가 없게 짰지만, 부위별 볼륨은 최소 자극선에 못 미칩니다. ' +
      '늘리는 것이 목표라면 주 2회부터가 현실적입니다.';
  }

  // 할 종목이 아예 없는 부위만 기구 탓이다 — 한 가지라도 있으면 세트를 늘려 채울 수 있다
  const noGear = new Set(coverageReport(equipmentIds).filter((item) => item.directOptions === 0).map((item) => item.muscle));
  const short = volumeReport(templateWeekLogs(templates), landmarks, EXERCISE_INDEX)
    .filter((line) => line.landmark.mev > 0 && line.effectiveSets < line.landmark.mev * 0.85)
    .filter((line) => !QUIET_WHEN_LOW.has(line.muscle) && !noGear.has(line.muscle))
    .map((line) => line.muscle);
  if (short.length === 0) return undefined;

  const named = short.slice(0, 3).map((muscle) => MUSCLE_LABELS_KO[muscle]).join(' · ') +
    (short.length > 3 ? ` 외 ${short.length - 3}곳` : '');
  const plan = days <= 3 ? `주 ${days}회 · 하루 한 시간 안쪽으로` : withParticle(`주 ${days}회`, '으로/로');
  return `${plan} 짜서 첫 주에는 ${withParticle(named, '이/가')} ` +
    '주 최소 세트 아래에서 시작합니다. 몇 주에 걸쳐 세트를 늘리며 채웁니다' +
    (days <= 2 ? ' — 하루를 더 낼 수 있으면 크게 달라집니다.' : '.');
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
    sex: answers.sex,
  });

  const profile = levelProfile(level.level);
  const gym = gymFromCatalog(answers.gym);
  const program = buildProgram(answers, level.level);
  const notes: string[] = [];

  if (level.adjusted) notes.push(level.note);

  notes.push(
    `${program.name} · ${profile.label} 볼륨으로 시작합니다. ` +
      `${profile.accumulationWeeks}주 동안 조금씩 늘리고, 그다음 한 주는 덜어냅니다.`,
  );

  /*
   * 기구 안내 — 할 종목이 아예 없는 부위와, 한 가지뿐이라 블록이 바뀌어도 같은 종목인
   * 부위를 나눠 말한다. 둘을 묶어 "종목이 부족합니다"라고만 하면 덤벨 로우로 등을 잘 하고
   * 있는 사람도 등을 못 하는 줄 안다.
   */
  const gaps = coverageReport(answers.gym.equipmentIds).filter((item) => !item.sufficient);
  const none = gaps.filter((gap) => gap.directOptions === 0);
  const few = gaps.filter((gap) => gap.directOptions > 0);
  const labels = (list: typeof gaps) => list.slice(0, 3).map((gap) => MUSCLE_LABELS_KO[gap.muscle]).join(' · ');
  if (none.length > 0) {
    const suggestion = none.find((gap) => gap.suggestion)?.suggestion;
    notes.push(`${labels(none)} 종목을 할 기구가 없어 이 부위는 다른 종목에서 간접으로만 씁니다.` +
      (suggestion ? ` ${withParticle(suggestion.name, '을/를')} 더하면 채워집니다.` : ''));
  }
  if (few.length > 0) {
    notes.push(`${withParticle(labels(few), '은/는')} 이 기구로 할 종목이 한 가지뿐이라 블록이 바뀌어도 같은 종목입니다. 기구를 더 고르면 바꿔 가며 합니다.`);
  }

  /*
   * 초보 안내 — 바벨 기본 종목이 나중에 들어온다는 말은 그 헬스장에 바벨이 있을 때만,
   * 루마니안 데드리프트 이야기는 프로그램에 실제로 있을 때만 한다.
   */
  const programIds = new Set(program.templates.flatMap((template) => template.slots.map((slot) => slot.exerciseId)));
  const noBarbellBasics = [...programIds].every((id) => !TECHNICAL_LIFTS.has(id));
  if (level.level === 'beginner' && noBarbellBasics) {
    const reachable = new Set(availableExercises(answers.gym.equipmentIds, EXERCISES).map((exercise) => exercise.id));
    const later = ['back-squat', 'conventional-deadlift'].filter((id) => reachable.has(id))
      .map((id) => (id === 'back-squat' ? '바벨 백 스쿼트' : '컨벤셔널 데드리프트'));
    const hinge = ['romanian-deadlift', 'dumbbell-romanian-deadlift'].find((id) => programIds.has(id));
    const lines = ['처음에는 다루기 쉬운 종목으로 자세를 먼저 만듭니다.'];
    if (later.length > 0) lines.push(`${later.join(' · ')}는 중급으로 다시 짤 때 들어갑니다.`);
    if (hinge) lines.push(`${EXERCISE_INDEX.get(hinge)!.name}는 가벼운 무게로 엉덩이 접는 법을 익히는 종목이라 처음부터 넣었습니다.`);
    notes.push(lines.join(' '));
  }

  // 실제로 뺀 것이 있을 때만, 무엇을 뺐는지 말한다
  const kept = availableExercises(answers.gym.equipmentIds, EXERCISES)
    .filter((exercise) => painKeepsOut(exercise, answers.pain ?? []));
  if (kept.length > 0) {
    const joints = [...new Set((answers.pain ?? []).filter((report) => report.score >= 3).map((report) => JOINT_LABELS_KO[report.joint]))];
    notes.push(`${joints.join(' · ')} 통증 때문에 그 관절에 부담이 큰 종목(${kept.slice(0, 3).map((exercise) => exercise.name).join(' · ')}` +
      `${kept.length > 3 ? ` 외 ${kept.length - 3}개` : ''})은 빼고 짰습니다. 나아지면 설정을 다시 해 주세요.`);
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

/**
 * 종목의 반복 범위. 목표와 자리(메인 · 보조 · 고립)가 정하고, 데드리프트만 따로 —
 * 근비대 메인 6~10회로 데드리프트를 하면 뒤 반복에서 허리가 먼저 무너진다. 4~6회(근력 3~5회).
 */
/**
 * 근력용 저반복(4~6회)이 맞는 종목 — 양손으로 드는 바벨 복합 운동.
 *
 * 고블릿 스쿼트 4~6회는 덤벨이 모자라서 못 하고, 불가리안 스플릿 스쿼트 ·
 * 원암 로우 · 랫 풀다운을 4~6회로 하면 무게보다 자세와 균형이 먼저 무너진다.
 * 근력 프로그램이 저반복을 거는 곳은 스쿼트 · 벤치 · 데드 · 프레스 · 로우 같은
 * 바벨 종목이다. 나머지 주 종목은 근력이 목표여도 6~10회가 맞다.
 */
export function isStrengthLift(exercise: Exercise): boolean {
  return exercise.equipment === 'barbell' && !exercise.unilateral &&
    exercise.pattern !== 'isolation' && !NOT_LOW_REP.has(exercise.id);
}

/*
 * 바벨이어도 저반복으로 하지 않는 것 — 루마니안 · 스티프 레그 데드와 굿모닝은
 * 햄스트링을 늘이는 보조 힌지라 무겁게 몇 개보다 6~10회가 맞고, 힙 쓰러스트와
 * 랜드마인 프레스도 근력 프로그램에서 저반복을 거는 자리가 아니다.
 */
const NOT_LOW_REP = new Set(['romanian-deadlift', 'stiff-leg-deadlift', 'good-morning', 'hip-thrust', 'landmine-press']);

/** 근력 + 근비대일 때 하루에 무겁게 하는 종목 수. 셋이 넘으면 그날은 근력 날이 된다. */
const HEAVY_PER_DAY = 2;

/**
 * 한 주 전체를 보고 반복 범위를 매긴다.
 *
 * 근력 + 근비대는 "이 동작을 이번 주에 이미 무겁게 했나"를 알아야 해서 종목
 * 하나만 보고는 못 정한다. 날 순서대로 훑으며 동작마다 첫 번째 바벨 주 종목만
 * 무겁게 하고(하루 최대 HEAVY_PER_DAY), 나머지는 볼륨으로 둔다.
 *
 * 이미 저장된 프로그램에도 쓴다 — 규칙이 바뀌면 설문을 다시 하지 않아도
 * 반복 범위만 새 규칙으로 맞춘다. 종목 · 세트 수는 건드리지 않는다.
 */
export function assignRepRanges(
  templates: readonly SessionTemplate[],
  goals: readonly TrainingGoal[],
  level: TrainingLevel,
  style: RepStyle = 'auto',
): SessionTemplate[] {
  const heavyPatterns = new Set<string>();
  return templates.map((template) => {
    // 내 루틴은 사용자가 정한 반복 그대로 둔다
    if (template.fixed) return template;
    let heavyToday = 0;
    return {
      ...template,
      slots: template.slots.map((slot) => {
        const exercise = exerciseById(slot.exerciseId);
        if (!exercise || !slot.role) return slot;
        const heavy = slot.role === 'primary' && isStrengthLift(exercise) &&
          !heavyPatterns.has(exercise.pattern) && heavyToday < HEAVY_PER_DAY;
        if (heavy) {
          heavyPatterns.add(exercise.pattern);
          heavyToday += 1;
        }
        return { ...slot, repRange: repRangeFor(exercise, slot.role, goals, level, heavy, style) };
      }),
    };
  });
}

/**
 * 반복 범위.
 *
 * 근력 목표의 저반복은 바벨 주 종목에만 건다(isStrengthLift).
 *   · 근력만        — 바벨 주 종목 전부 4~6회
 *   · 근력 + 근비대 — 동작(스쿼트 · 힌지 · 벤치 · 프레스 · 로우)마다 한 주에 한 번만
 *                     무겁게(4~6회), 같은 동작의 다른 날은 6~10회(무거운 날 · 볼륨 날).
 *                     둘 다 고른 사람에게 전부 4~6회를 주면 근비대를 고른 의미가 없다.
 *   · 초보          — 4~6회 대신 5~8회. 자세가 자리 잡기 전에 최대 근처 무게로
 *                     몇 개만 하는 것보다, 조금 가볍게 더 많이 반복하는 쪽이 근력도
 *                     충분히 오르고(초보는 어느 범위로 해도 근력이 는다) 덜 다친다.
 * 데드리프트류는 이보다 한 칸 낮다(허리 부담 · 기술).
 */
function repRangeFor(
  exercise: Exercise,
  role: SlotRole,
  goals: readonly TrainingGoal[],
  level: TrainingLevel = 'intermediate',
  heavySlot = true,
  style: RepStyle = 'auto',
): { min: number; max: number } {
  return BODYWEIGHT_REPS[exercise.id] ?? heavyPullRange(exercise, styledRange(exercise, role, goals, level, heavySlot, style));
}

/*
 * 무게를 못 올리는 맨몸 종목은 횟수로 올린다. 푸시업 8~12회는 금방 쉬워지고,
 * 그 뒤로 할 게 없다 — 처음부터 넓게 잡아 두고 위 끝에 닿으면 자세 · 템포로 어렵게 한다.
 * 딥스 · 풀업처럼 체중이 곧 무거운 종목, 플랭크처럼 버티는 종목은 여기 넣지 않는다.
 */
const BODYWEIGHT_REPS: Readonly<Record<string, { min: number; max: number }>> = {
  'push-up': { min: 12, max: 20 },
  'reverse-crunch': { min: 12, max: 20 },
  'glute-bridge': { min: 12, max: 20 },
  'back-extension': { min: 12, max: 20 },
  'bodyweight-reverse-lunge': { min: 10, max: 15 },
  'inverted-row': { min: 8, max: 12 },
  'pike-push-up': { min: 8, max: 12 },
};

/** 무겁게 드는 칸의 범위 — 초보는 5~8회. */
function heavyRange(level: TrainingLevel): { min: number; max: number } {
  return level === 'beginner' ? { min: 5, max: 8 } : { min: 4, max: 6 };
}

function styledRange(
  exercise: Exercise,
  role: SlotRole,
  goals: readonly TrainingGoal[],
  level: TrainingLevel,
  heavySlot: boolean,
  style: RepStyle,
): { min: number; max: number } {
  const strong = role === 'primary' && isStrengthLift(exercise);
  switch (style) {
    case 'moderate':
      return repRangeForGoals(role, ['hypertrophy']);
    case 'light':
      if (role === 'isolation') return { min: 12, max: 20 };
      if (role === 'accessory') return { min: 12, max: 15 };
      return { min: 10, max: 15 };
    case 'heavy':
      if (role === 'isolation') return { min: 8, max: 12 };
      if (role === 'accessory') return { min: 6, max: 10 };
      return strong ? heavyRange(level) : { min: 6, max: 10 };
    case 'mixed':
      if (role === 'isolation') return { min: 10, max: 15 };
      if (role === 'accessory') return { min: 8, max: 12 };
      return strong && heavySlot ? heavyRange(level) : { min: 8, max: 12 };
    default: {
      const plan = planGoals(goals);
      const range = repRangeForGoals(role, goals);
      if (role !== 'primary' || !plan.goals.includes('strength')) return range;
      const mixed = plan.goals.includes('hypertrophy');
      if (!strong || (mixed && !heavySlot)) return { min: 6, max: 10 };
      return heavyRange(level);
    }
  }
}

/**
 * 데드리프트류는 한 칸 낮게 — 허리 부담과 기술 때문이다. 고반복 스타일이어도
 * 데드리프트를 15회까지 하지는 않는다(뒤로 갈수록 허리가 먼저 풀린다).
 */
export function heavyPullRange(exercise: Exercise, range: { min: number; max: number }): { min: number; max: number } {
  if (!HEAVY_PULLS.has(exercise.id)) return range;
  if (range.max <= 6) return { min: 3, max: 5 };
  if (range.min >= 10) return { min: 6, max: 10 };
  return { min: 4, max: 6 };
}

/** 처음 설문의 통증으로 프로그램에서 뺄 종목인가 — 오늘이라면 대체하거나 멈출 종목. */
function painKeepsOut(exercise: Exercise, pain: readonly PainReport[]): boolean {
  const action = screenExercise(exercise, pain).action;
  return action === 'stop' || action === 'substitute';
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
    summary: `${program.name} 1주차 — 기준을 잡는 주입니다. 세트마다 ${targetRir}개쯤 여유를 남기세요.`,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
