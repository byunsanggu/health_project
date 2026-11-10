import { EXERCISES, HEAVY_PULLS, exerciseById, isTimed, isUnloaded } from './exercises.ts';
import { holdRange } from './hold.ts';
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
import { weeklyConditioningPlan, type WeeklyConditioningPlan } from './conditioning.ts';


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
  /**
   * 첫 주의 마무리 운동 · 유산소 계획(체력 기르기 · 체지방 감량). 붙는 것이 없으면 kind가 'none'.
   * 주차가 바뀌면 weeklyConditioningPlan을 그 주차로 다시 부른다 — 저장해 두는 값이 아니다.
   */
  conditioning: WeeklyConditioningPlan;
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
  // '분할 · 순환'은 처음 온 사람이 모르는 말이다 — 무엇을 번갈아 하는지로 부른다
  4: '주 4회 상체 · 하체 번갈아',
  5: '주 5회 상체 · 하체 + 푸시 · 풀 · 레그',
  6: '주 6회 푸시 · 풀 · 레그 두 바퀴',
  7: '주 7회 푸시 · 풀 · 레그 두 바퀴 + 가벼운 날',
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
  // 덤벨 스모 스쿼트도 덤벨 하나가 상한이다
  'dumbbell-sumo-squat': 'notBeginner',
  'cable-pull-through': 'all',
};

/** 무게를 맞출 수 있는 세로 당기기 — 이게 있으면 풀업보다 먼저 */
const LOADABLE_PULLS: ReadonlySet<string> = new Set(['lat-pulldown', 'neutral-grip-pulldown', 'assisted-pull-up']);

/** 무게를 못 다루는 사람도 있는 맨몸 당기기. 할 수 있는지 모르는 처음에는 랫풀다운이 먼저다. */
const BODYWEIGHT_PULLS: ReadonlySet<string> = new Set(['pull-up', 'chin-up']);
const HOLDS: ReadonlySet<string> = new Set(['plank', 'side-plank']);
/*
 * 처음 하는 사람이 한 개도 못 하는 맨몸 종목 — 초보에게는 뒤로 민다. 글루트 햄 레이즈는 상급 동작이라
 * 처음 온 사람은 한 번도 못 내려갔다 올라온다(레그컬 기계가 있으면 그쪽). 풀업 · 친업도 처음엔 0개가 흔하다.
 * 대안이 없는 곳(철봉뿐)이면 그래도 들어온다 — 빼지 않고 미루기만 한다.
 */
const HARD_BODYWEIGHT: ReadonlySet<string> = new Set([
  'chest-dip', 'triceps-dip', 'hanging-leg-raise', 'glute-ham-raise', 'pull-up', 'chin-up',
]);
/**
 * 초보에게는 아예 주지 않는 종목. 파이크 푸시업은 몸을 거꾸로 세워 체중을 어깨로 받는다 — 푸시업 하나도
 * 버거운 첫 주에 줄 동작이 아니다. 자리가 비면 아래 쉬운 종목으로 채운다.
 */
const BEGINNER_EXCLUDED: ReadonlySet<string> = new Set(['pike-push-up']);
/**
 * 초보에게는 쉬운 쪽이 있으면 그쪽만 준다. 바닥 푸시업 12~20회는 처음 온 여성 회원 대부분이 몇 개 못 한다 —
 * 손을 벤치에 짚는 인클라인 푸시업으로 시작하고, 위 끝을 채우면 바닥 푸시업으로 옮기라고 알려 준다(load.ts).
 * 점수로 뒤로 미는 것만으로는 같은 날 둘째 가슴 자리에 다시 들어왔다.
 */
const BEGINNER_EASIER: Readonly<Record<string, string>> = { 'push-up': 'incline-push-up' };
/**
 * 같은 동작의 맨몸 · 덤벨 판. 하루에 둘 다 넣으면 같은 런지를 두 번 하는 셈이다(덤벨 리버스 런지 뒤 맨몸 리버스 런지,
 * 워킹 런지 뒤 덤벨 리버스 런지). 푸시업 뒤의 인클라인 푸시업도 같은 동작을 쉽게 한 번 더 하는 것이다.
 */
const SAME_MOVEMENT: readonly (readonly string[])[] = [
  ['bodyweight-reverse-lunge', 'dumbbell-reverse-lunge', 'walking-lunge'],
  // 무릎 푸시업도 같은 푸시업의 쉬운 판이다
  ['push-up', 'incline-push-up', 'knee-push-up'],
  // 힙 쓰러스트 세 판(바벨 · 덤벨 · 머신) — 둔근 자리가 둘인 날 메인 덤벨 힙 쓰러스트 뒤에 바벨 · 머신 힙 쓰러스트가 또 들어갔다
  ['hip-thrust', 'dumbbell-hip-thrust', 'machine-hip-thrust'],
];
/**
 * 기구가 거의 없어 자리가 비는 날을 채우는 쉬운 맨몸 종목 — 누구나 첫날부터 할 수 있는 것.
 * 매트 · 밴드뿐인 집에서 전신 B가 파이크 푸시업과 런지 두 종목으로 끝났다. 밴드 종목이 생겨 밴드가 있으면
 * 거의 안 쓰이고, 매트뿐인 집에서 하체 날은 맨몸 스쿼트 · 한발 카프레이즈, 미는 날은 인클라인 푸시업으로 채운다.
 */
const EASY_FILLERS: readonly string[] = [
  'glute-bridge', 'dead-bug', 'reverse-crunch', 'bodyweight-squat', 'single-leg-calf-raise', 'incline-push-up',
];
/** EASY_FILLERS로도 모자란 미는 날(매트 · 케틀벨뿐) — 푸시업 뒤 인클라인 푸시업(가벼운 마무리), 파이크 푸시업 */
const SPARSE_PUSH_FILLERS: readonly string[] = ['incline-push-up', 'pike-push-up'];
/**
 * 그래도 짧은 날(매트 · 케틀벨뿐인 집의 상체 · 푸시 · 풀 날)을 채우는 바닥 종목. 초보 상체 날이 인클라인 푸시업 ·
 * 데드버그 두 종목으로 끝났고, 매트뿐인 풀 날은 크런치 하나였다.
 *  · 슈퍼맨 — 엎드려 등 위아래(하체 자리가 없는 날만 — 하체 날에는 브릿지가 이미 엉덩이를 쓴다)
 *  · 플랭크 — 초로 버티는 코어(hold.ts)
 *  · 버드독 — 몸통을 흔들리지 않게 잡는 힘
 * 코어는 하루 두 종목까지 — 데드버그 · 플랭크 · 버드독을 한날 다 넣지 않는다(당기는 날의 버드독은 등 뒤쪽 몫으로 따로).
 */
const FLOOR_FILLERS: readonly { id: string; upperOnly?: boolean }[] = [
  { id: 'superman', upperOnly: true },
  { id: 'plank' },
  { id: 'bird-dog', upperOnly: true },
];
/** 하루 코어 종목 상한 — 채우기에서만 본다 */
const MAX_CORE_FILLED = 2;
/** 하루에 이만큼은 있어야 운동한 날 같다 — 모자라면 EASY_FILLERS로 채운다 */
const MIN_DAY_EXERCISES = 4;
/** 무게를 실을 수 있는 다리 복합 동작 */
const LOWER_COMPOUND: readonly MovementPattern[] = ['squat', 'hinge', 'lunge'];
/** 하체 부위 — 하체 채우기 종목은 이 부위 자리가 있는 날에만 */
const LOWER_BODY: ReadonlySet<MuscleGroup> = new Set<MuscleGroup>(['quads', 'hamstrings', 'glutes', 'calves']);
/** 미는 부위 — 상체 채우기 종목(인클라인 푸시업)은 이 부위 자리가 있는 날에만. 당기는 날에 푸시업을 끼우지 않는다 */
const PUSH_MUSCLES: ReadonlySet<MuscleGroup> = new Set<MuscleGroup>(['chest', 'triceps', 'frontDelt']);
/**
 * 초보가 아니면 자극이 모자란 가벼운 맨몸 종목 — 중급 이상에게는 뒤로 밀고, 메인 자리에는 무게를 실을 수 있는 쪽을 준다.
 * 인클라인 푸시업도 여기 — 덤벨이 있는 집의 중급 가슴 메인이 덤벨 플로어 프레스 대신 인클라인 푸시업이 됐다.
 */
const LIGHT_BODYWEIGHT: ReadonlySet<string> = new Set(['bodyweight-reverse-lunge', 'glute-bridge', 'bodyweight-squat', 'incline-push-up', 'knee-push-up']);

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
  /** 근력이 목표다(근비대 없이) — 바벨 주 종목을 주 2회, 맨몸 보조는 뒤로 */
  strengthOnly?: boolean;
  /** 밀려난 가벼운 판을 바꿔 넣는 중 — 오늘 어떤 종목과도 같은 동작이 아닌 것만 */
  noSwap?: boolean;
  /** 이 헬스장에 무게를 싣는 판이 있는 하체 동작(스쿼트 · 런지) */
  loadedPatterns?: ReadonlySet<MovementPattern>;
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
  /*
   * 밴드는 여기 넣지 않는다 — 몸을 다루는 힘이 느는 것도 아니고, 넣으면 기구 많은 헬스장에서 케이블 로우 대신
   * 밴드 로우가 들어왔다. 집에서는 밴드 말고 다른 게 없어서 이 점수 없이도 들어간다.
   * 가벼운 맨몸 하체(브릿지 · 런지 · 맨몸 스쿼트)도 초보가 아니면 여기서 앞으로 당기지 않는다 — 중급 둔근 고립 자리에
   * 케이블 킥백 대신 브릿지가, 레그프레스 자리에 맨몸 스쿼트가 들어왔다.
   */
  const varietyBodyweight = exercise.equipment === 'bodyweight' && !BODYWEIGHT_PULLS.has(exercise.id) &&
    (level === 'beginner' || !LIGHT_BODYWEIGHT.has(exercise.id));
  if (slot.role !== 'primary' && varietyBodyweight) {
    const bodyweightToday = context.today.filter((item) => item.equipment === 'bodyweight').length;
    // 주에 하나도 없으면 더 앞으로 — 주 3회 전신처럼 자리가 적어도 한 번은 들어가게.
    // 근력 목표는 예외 — 무게를 못 올리는 푸시업 · 파이크 푸시업은 드는 무게를 올리는 데 도움이 안 된다.
    if (context.strengthOnly) score -= 2;
    else if (bodyweightToday === 0) score += context.weekBodyweight === 0 ? 5 : 3;
  }
  // 근력 목표 — 메인 자리에는 바벨 주 종목(스쿼트 · 벤치 · 데드 · 오버헤드 · 로우)
  // 그 자리의 동작 갈래에 맞을 때만 — 아니면 세로 당기기 자리에 바벨 로우가 들어가 풀 날이 로우 둘이 된다
  if (context.strengthOnly && slot.role === 'primary' && isStrengthLift(exercise) &&
    (!slot.patterns || slot.patterns.includes(exercise.pattern))) score += 5;

  // 딥스는 맨몸이어도 쉽지 않다 — 처음 시작하는 사람은 체중을 다 받아 내려가기 어렵고
  // 어깨 앞쪽이 먼저 아프다. 행잉 레그레이즈도 매달려 버틸 악력부터 필요하다.
  // 초보에게는 푸시업 · 데드버그 · 머신 쪽을 먼저 둔다.
  if (level === 'beginner' && HARD_BODYWEIGHT.has(exercise.id)) score -= 4;
  /*
   * 플랭크처럼 버티는 동작은 자리 고르기에서는 움직이는 복근 운동(데드버그 · 크런치) 뒤로 — 초로 세고 기록하지만
   * (hold.ts), 복근 자리 하나라면 움직이는 쪽이 먼저다. 기구가 적어 하루가 짧으면 FLOOR_FILLERS로 들어온다.
   */
  if (HOLDS.has(exercise.id)) score -= 3;
  /*
   * 무릎 푸시업은 매트뿐인 초보의 첫 푸시업(메인 자리)이다 — 보조 · 고립 가슴 자리에서는 펙덱 · 플라이가 먼저.
   * 맨몸 골고루 점수로 기구 많은 헬스장 푸시 날의 펙덱 자리에 들어왔다.
   */
  if (exercise.id === 'knee-push-up' && slot.role !== 'primary') score -= 6;
  // 거꾸로 맨몸 런지 · 브릿지는 하체가 이미 강한 사람에게 자극이 모자란다 — 덤벨 쪽을 먼저.
  if (level !== 'beginner' && LIGHT_BODYWEIGHT.has(exercise.id)) score -= 3;
  // 메인 자리는 더 — 케틀벨 하나뿐인 중급도 맨몸 스쿼트보다 고블릿 스쿼트가 메인이다(매트뿐이면 그래도 맨몸 스쿼트)
  if (level !== 'beginner' && LIGHT_BODYWEIGHT.has(exercise.id) && slot.role === 'primary') score -= 4;
  /*
   * 같은 동작의 무게 싣는 판(고블릿 · 덤벨 스모 스쿼트, 덤벨 런지)이 이 헬스장에 있으면 중급 이상에게 맨몸판은 더 뒤로 —
   * 덤벨만 있는 집의 전신 B 다리 자리가 기구 골고루 점수에 밀려 덤벨 스모 스쿼트 대신 맨몸 스쿼트가 됐다.
   */
  if (level !== 'beginner' && LIGHT_BODYWEIGHT.has(exercise.id) && context.loadedPatterns?.has(exercise.pattern)) score -= 3;

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
  /*
   * 데드리프트 뒤의 바벨 스쿼트 보조(프론트 · 백 스쿼트 8~12회)는 등 위쪽 · 허리가 먼저 무너진다 —
   * 이미 데드로 지친 척추에 바를 또 얹는 셈이다. 그날 하체 보조는 핵 스쿼트 · 레그프레스 · 런지 쪽으로.
   */
  if (slot.role !== 'primary' && exercise.pattern === 'squat' && (exercise.equipment === 'barbell' || exercise.equipment === 'smith') &&
      context.today.some((item) => HEAVY_PULLS.has(item.id))) score -= 6;
  // 고블릿 스쿼트는 들 수 있는 덤벨 하나가 상한 — 중급부터는 보조 자리에서도 금방 모자란다
  if (exercise.id === 'goblet-squat' && level !== 'beginner') score -= 4;
  /*
   * 무게를 못 싣는 맨몸 밀기(푸시업 · 파이크 푸시업)는 상급자에게 모자란다 — 벤치 70kg×10인 사람은
   * 푸시업을 25개 넘게 해야 두 개 남긴다. 파이크 푸시업은 중급부터 유일한 머리 위 프레스가 되면 안 된다.
   * 무게를 싣는 종목이 있는 헬스장이면 그쪽을 먼저(홈짐은 대안이 없으니 그대로 남는다).
   */
  if (exercise.increment <= 0 && isUnloaded(exercise) && !BODYWEIGHT_PULLS.has(exercise.id)) {
    if (exercise.id === 'pike-push-up' && level !== 'beginner') score -= 4;
    else if (level === 'advanced' || level === 'expert') score -= 4;
  }
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

  /*
   * 허리를 무겁게 싣는 종목을 같은 날 겹치지 않는다 — 아래 일반 규칙(−2.4쯤)은 근력 목표 가산점(+5)에 졌다.
   *   · 데드리프트 날의 바벨 로우 · 펜들레이 로우(근력 2회 B날: 데드 3~5회 + 바벨 로우 4~6회)
   *   · 같은 갈래의 허리 부담 큰 종목 둘(풀 날 바벨 로우 + 펜들레이 로우)
   *   · 바벨 스쿼트 둘(백 스쿼트 → RDL → 프론트 스쿼트)
   * 원암 로우 · 체스트 서포티드 로우 · 레그프레스처럼 허리를 덜 쓰는 종목이 있으면 그쪽으로 간다.
   */
  const spine = exercise.jointStress.lowBack ?? 0;
  if (spine >= 0.7 && exercise.pattern === 'horizontalPull' && context.today.some((one) => HEAVY_PULLS.has(one.id))) score -= 6;
  if (spine >= 0.7 && context.today.some((one) => one.pattern === exercise.pattern && (one.jointStress.lowBack ?? 0) >= 0.7)) score -= 8;
  // 루마니안 · 스티프 레그 날의 로우는 허리를 덜 쓰는 쪽(원암 · 가슴 대고 하는 로우)을 먼저
  else if (spine >= 0.7 && exercise.pattern === 'horizontalPull' &&
    context.today.some((one) => one.pattern === 'hinge' && (one.jointStress.lowBack ?? 0) >= 0.8)) score -= 4;
  if (exercise.pattern === 'squat' && exercise.equipment === 'barbell' &&
    context.today.some((one) => one.pattern === 'squat' && one.equipment === 'barbell')) score -= 6;

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

/**
 * 하루에 같이 두면 같은 동작을 두 번 하는 셈인 두 종목 — SAME_MOVEMENT 묶음(맨몸 · 덤벨 런지, 푸시업 · 인클라인 푸시업),
 * 그리고 같은 갈래(스쿼트 · 런지)의 가벼운 맨몸판과 무게를 실은 판(고블릿 스쿼트 + 맨몸 스쿼트).
 */
function sameMovement(a: Exercise, b: Exercise): boolean {
  if (a.id === b.id) return false;
  if (SAME_MOVEMENT.some((group) => group.includes(a.id) && group.includes(b.id))) return true;
  /*
   * 스쿼트와 런지는 같은 무릎 위주 갈래다 — 워킹 런지 뒤의 맨몸 스쿼트도 무릎 운동을 가볍게 한 번 더 하는 셈이다.
   * 그래서 가벼운 맨몸판과 무게 실은 판은 스쿼트 · 런지를 가리지 않고 부딪친다(덤벨 · 케틀벨 집의 하체 B).
   */
  if (movementFamily(a) !== 'squat' || movementFamily(b) !== 'squat') return false;
  const light = (item: Exercise) => LIGHT_BODYWEIGHT.has(item.id);
  return (light(a) && !isUnloaded(b)) || (light(b) && !isUnloaded(a));
}

/**
 * 초보에게 미루는 종목 — 처음엔 한 개도 못 하는 맨몸 종목(HARD_BODYWEIGHT)과 아직 안 배운 기술 종목(케틀벨 스윙 ·
 * 바벨 로우 …). 근력 목표의 메인 자리 바벨 주 종목은 일부러 넣는 것이라 여기 들지 않는다 — 보조 자리(고블릿 스쿼트 뒤의
 * 백 스쿼트 8~12회)는 초보에게 미룬다.
 */
function beginnerAvoids(exercise: Exercise, slot: SlotSpec, context: PickContext): boolean {
  if (context.level !== 'beginner') return false;
  if (HARD_BODYWEIGHT.has(exercise.id)) return true;
  if (!TECHNICAL_LIFTS.has(exercise.id) || context.introduced?.includes(exercise.id)) return false;
  return !(context.strengthOnly && slot.role === 'primary' && isStrengthLift(exercise));
}

/**
 * 덤벨(케틀벨) 스쿼트 둘째 판 — 고블릿 스쿼트 뒤의 덤벨 스모 스쿼트는 들 수 있는 덤벨 하나로 같은 스쿼트를 발 너비만
 * 바꿔 한 번 더 하는 것이다. 바벨 · 머신 스쿼트 둘(백 스쿼트 + 핵 스쿼트)은 무게가 달라 그대로 둔다.
 */
function twinBellSquat(exercise: Exercise, today: readonly Exercise[]): boolean {
  const bellSquat = (item: Exercise) => item.pattern === 'squat' && item.equipment === 'dumbbell';
  return bellSquat(exercise) && today.some((item) => item.id !== exercise.id && bellSquat(item));
}

/**
 * 고른 종목 대신 줄 종목이 있으면 그걸로 — 초보에게 미루는 종목은 같은 동작 갈래의 다른 종목이 있을 때(철봉뿐이면
 * 풀업, 케틀벨뿐이면 스윙은 그대로), 덤벨 스쿼트 둘째 판은 런지 · 힌지 · 스텝업 같은 다른 하체 종목이 있을 때만 뺀다.
 * 가벼운 맨몸판(브릿지 · 맨몸 스쿼트)은 대신 줄 종목으로 치지 않는다 — 케틀벨 스윙 대신 브릿지를 주면 하체 날에 무게가 빠진다.
 */
function betterInstead(chosen: Exercise, other: Exercise, slot: SlotSpec, context: PickContext): boolean {
  if (discouraged(other, slot, context) || LIGHT_BODYWEIGHT.has(other.id)) return false;
  return !beginnerAvoids(chosen, slot, context) || movementFamily(other) === movementFamily(chosen);
}

/** 동작 갈래 — 스쿼트와 런지는 같은 무릎 위주 갈래로 친다(초보에게 백 스쿼트 대신 덤벨 런지). */
function movementFamily(exercise: Exercise): MovementPattern {
  return exercise.pattern === 'lunge' ? 'squat' : exercise.pattern;
}

/**
 * 가벼운 맨몸 스쿼트 · 런지 둘째 — 맨몸 리버스 런지 옆의 맨몸 스쿼트. 무게 실은 판(불가리안을 하체 A에서 썼어도)이 있으면
 * 그쪽을 다시 쓴다. 매트뿐인 집처럼 그것뿐이면 그대로 둔다.
 */
function secondLightKnee(exercise: Exercise, today: readonly Exercise[]): boolean {
  const lightKnee = (item: Exercise) => LIGHT_BODYWEIGHT.has(item.id) && movementFamily(item) === 'squat';
  return lightKnee(exercise) && today.some((item) => item.id !== exercise.id && lightKnee(item));
}

function discouraged(exercise: Exercise, slot: SlotSpec, context: PickContext): boolean {
  return beginnerAvoids(exercise, slot, context) || twinBellSquat(exercise, context.today) ||
    secondLightKnee(exercise, context.today);
}

/**
 * 같은 동작 두 판이 부딪치면 남길 쪽 — 무게를 싣는 판(2) > 맨몸(1) > 가벼운 맨몸(0). 먼저 고른 쪽을 남기면
 * 둔근 자리에 먼저 들어간 맨몸 스쿼트 때문에 뒤 자리의 고블릿 스쿼트가 빠져, 덤벨 · 케틀벨이 있는데 하체 날에
 * 무게 실은 다리 운동이 하나도 없었다. 같은 단계끼리는 먼저 고른 쪽을 남긴다(워킹 런지 + 덤벨 리버스 런지).
 */
function hardness(exercise: Exercise): number {
  if (!isUnloaded(exercise)) return 2;
  return LIGHT_BODYWEIGHT.has(exercise.id) ? 0 : 1;
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
    .filter((exercise) => context.level !== 'beginner' || !BEGINNER_EXCLUDED.has(exercise.id))
    .filter((exercise) => {
      const easier = context.level === 'beginner' ? BEGINNER_EASIER[exercise.id] : undefined;
      return !easier || !pool.some((other) => other.id === easier);
    })
    .filter((exercise) => slot.role !== 'primary' || (exercise.pattern !== 'isolation' && exercise.pattern !== 'core'))
    .filter((exercise) => !hingedToday || !heavyHinge(exercise))
    /*
     * 같은 동작은 하루에 한 판만 — 고블릿 스쿼트 뒤의 맨몸 스쿼트는 같은 동작을 가볍게 한 번 더 하는 셈이다. 오늘 이미 있는
     * 판보다 가볍거나 같은 판은 넣지 않는다. 더 무거운 판은 들어오고, 먼저 있던 가벼운 판을 buildProgram이 다른 종목으로
     * 바꾼다(swapOut). 바꿔 넣는 자리는 noSwap이라 어떤 판과도 부딪치지 않는 종목만 받는다.
     */
    .filter((exercise) => !context.today.some((item) => sameMovement(exercise, item) &&
      (context.noSwap || hardness(exercise) <= hardness(item))))
    .filter((exercise) => (exercise.contribution[slot.muscle] ?? 0) >= minContribution);
  /*
   * 고립 자리에는 고립 종목이 먼저다. 레그컬 기계가 없는 곳에서 "뒤허벅지 고립" 자리에
   * 스티프 레그 데드리프트가 10~15회로 들어가던 것을 막는다 — 고립 종목이 하나도 없을
   * 때만 복합 동작으로 채운다.
   */
  const light = (exercise: Exercise) => exercise.pattern === 'isolation' || exercise.pattern === 'core';
  const narrowed = slot.role === 'isolation' && candidates.some(light) ? candidates.filter(light) : candidates;
  /*
   * 점수로 뒤로 미는 것만으로는 모자랐다 — 레그컬 기계가 있는 헬스장의 초보 하체 B에 글루트 햄 레이즈가 맨몸 골고루
   * 점수를 받아 들어갔다. 대신 줄 종목이 이 자리 후보에 있으면 아예 뺀다.
   */
  const kept = narrowed.filter((exercise) =>
    !discouraged(exercise, slot, context) || !narrowed.some((other) => betterInstead(exercise, other, slot, context)));
  return kept
    .map((exercise) => ({ exercise, score: scoreExercise(exercise, slot, context) }))
    .sort((a, b) => b.score - a.score)[0]?.exercise;
}

/** 고른 종목의 관절 부하를 세션 누계에 더한다. */
function addJointLoad(load: Map<Joint, number>, exercise: Exercise, sign = 1): void {
  for (const [joint, stress] of Object.entries(exercise.jointStress) as [Joint, number][]) {
    load.set(joint, (load.get(joint) ?? 0) + sign * stress);
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

    candidates.slice(0, Math.min(2, days.length)).forEach(({ index }, nth) => {
      const day = days[index]!;
      /*
       * 둔근은 둘째 날 자리를 고립(힙 어브덕션 · 킥백 · 브릿지)으로 둔다. 두 자리 다 힌지 · 런지면
       * 둔근을 고른 사람에게 런지만 하나 더 들어가고, 기대하는 엉덩이 고립 운동은 한 번도 안 나왔다.
       */
      const base: SlotSpec = muscle === 'glutes' && nth === 1
        ? { muscle: 'glutes', role: 'accessory', patterns: ['isolation'] }
        : PRIORITY_SLOT[muscle] ?? { muscle, role: 'isolation' };
      const spec: SlotSpec = { ...base, priority: true };
      const afterPrimary = day.slots.reduce((at, slot, i) => (slot.role === 'primary' ? i + 1 : at), 0);
      day.slots.splice(afterPrimary, 0, spec);
    });
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
  const goalPlan = planGoals(answers.goals);
  const strengthOnly = goalPlan.goals.includes('strength') && !goalPlan.goals.includes('hypertrophy');
  let weekBodyweight = 0;

  // 1단계 — 종목부터 전부 고른다. 세트 수는 주 전체를 본 뒤에 정해야
  // 로우가 이두에, 프레스가 삼두에 이미 준 볼륨을 뺄 수 있다.
  type Picked = { slot: SlotSpec; exercise: Exercise; sets: number };
  // 앞날에 채운 하체 채우기 종목 — 다음 날은 하체를 쉬게 둔다
  let previousLowerFillers = new Set<string>();
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
      loadedPatterns: new Set(pool
        .filter((exercise) => (exercise.pattern === 'squat' || exercise.pattern === 'lunge') && !isUnloaded(exercise))
        .map((exercise) => exercise.pattern)),
      beforeHeavyHinge: Boolean(next?.slots.some((slot) => slot.role === 'primary' && slot.patterns?.[0] === 'hinge')),
      strengthOnly,
    };

    const usedBeforeToday = new Set(usedThisWeek);
    // 주 안에서 종목이 겹치지 않게 하되, 후보가 마르면 재사용을 허용한다.
    // 보조 · 고립 자리는 지난 블록 종목을 먼저 피한다.
    const chooseFor = (slot: SlotSpec, repeatable: readonly string[], also: readonly string[] = []): Exercise | undefined => {
      const today = new Set([...usedToday, ...also]);
      const base = new Set([...today, ...repeatable, ...reserved]);
      const fresh = slot.role === 'primary' ? base : new Set([...base, ...rotateOut]);
      const first = pickExercise(slot, pool, fresh, context) ??
        pickExercise(slot, pool, base, context) ??
        pickExercise(slot, pool, today, context);
      if (!first || !discouraged(first, slot, context)) return first;
      /*
       * 이번 주에 아직 안 쓴 종목을 먼저 고르다 보면 초보에게 미루는 종목(케틀벨 스윙)이나 덤벨 스쿼트 둘째 판만 남는다 —
       * 덤벨 루마니안을 하체 A에서 써서 하체 B 둔근 자리에 스윙이 들어갔다. 대신 줄 종목이 있으면 이번 주에 쓴 것이라도 그쪽.
       */
      const notInstead = pool.filter((item) => !betterInstead(first, item, slot, context)).map((item) => item.id);
      return pickExercise(slot, pool, new Set([...today, ...reserved, ...notInstead]), context) ?? first;
    };
    const take = (exercise: Exercise) => {
      usedToday.add(exercise.id);
      usedThisWeek.add(exercise.id);
      if (exercise.equipment === 'bodyweight') weekBodyweight += 1;
      addJointLoad(sessionLoad, exercise);
    };
    // take를 되돌린다 — 고른 종목을 다른 것으로 바꿀 때
    const release = (exercise: Exercise) => {
      usedToday.delete(exercise.id);
      if (!usedBeforeToday.has(exercise.id)) usedThisWeek.delete(exercise.id);
      if (exercise.equipment === 'bodyweight') weekBodyweight -= 1;
      addJointLoad(sessionLoad, exercise, -1);
    };
    const swapOut = (loser: Picked, winner: Exercise) => {
      release(loser.exercise);
      const at = picked.indexOf(loser);
      context.today = [...picked.filter((item) => item !== loser).map((item) => item.exercise), winner];
      context.weekBodyweight = weekBodyweight;
      context.noSwap = true;
      const instead = chooseFor(loser.slot, [...usedThisWeek], [loser.exercise.id, winner.id]);
      context.noSwap = false;
      if (instead) {
        take(instead);
        picked[at] = { slot: loser.slot, exercise: instead, sets: 0 };
      } else {
        picked.splice(at, 1);
      }
    };

    day.slots.forEach((slot, slotIndex) => {
      const mine = pinSlot.get(`${dayIndex}:${slotIndex}`);

      let exercise: Exercise | undefined;
      if (mine && !usedToday.has(mine.id)) {
        exercise = mine;
      } else {
        // 근력 목표는 바벨 주 종목을 주 2회 — 메인 자리는 이번 주에 이미 한 종목도 다시 고를 수 있다
        const repeatable = strengthOnly && slot.role === 'primary'
          ? [...usedThisWeek].filter((id) => { const item = exerciseById(id); return !item || !isStrengthLift(item); })
          : [...usedThisWeek];
        context.today = picked.map((item) => item.exercise);
        context.weekBodyweight = weekBodyweight;
        exercise = chooseFor(slot, repeatable);
        /*
         * 메인 하체 자리에 맨몸 스쿼트 · 런지가 왔으면, 이번 주에 이미 쓴 무게 싣는 종목이라도 그쪽을 다시 쓴다 —
         * 메인 종목은 주 2회 겹쳐도 된다. 케틀벨 하나뿐인 집의 레그 날이 맨몸 스쿼트 + 고블릿 스쿼트가 되던 것.
         */
        if (exercise && slot.role === 'primary' && LIGHT_BODYWEIGHT.has(exercise.id)) {
          const again = new Set([...usedToday, ...reserved]);
          /*
           * 무게 싣는 종목이 없으면(매트뿐인 집) 초보가 아닌 사람에게는 이번 주에 쓴 맨몸 종목이라도 가벼운 쪽이 아닌 걸
           * 다시 준다 — 중급의 둘째 상체 날 메인이 푸시업 대신 인클라인 푸시업이 되지 않게.
           */
          const loaded = pickExercise(slot, pool.filter((item) => !isUnloaded(item)), again, context) ??
            (level === 'beginner' ? undefined : pickExercise(slot, pool.filter((item) => !LIGHT_BODYWEIGHT.has(item.id)), again, context));
          if (loaded) exercise = loaded;
        }
      }
      if (!exercise) return;

      /*
       * 더 무거운 판이 들어오면 먼저 있던 가벼운 판(같은 동작)을 그 자리에서 다른 종목으로 바꾼다 — 바꿀 게 없으면 뺀다.
       * 둔근 자리의 맨몸 스쿼트 → 고블릿 스쿼트가 들어오면 둔근 자리는 브릿지 · 스윙 같은 다른 종목으로.
       */
      const chosen = exercise;
      for (const loser of picked.filter((item) => sameMovement(item.exercise, chosen) && hardness(item.exercise) < hardness(chosen))) {
        swapOut(loser, chosen);
      }

      /*
       * 이 자리에 덤벨 스쿼트 말고 줄 게 없어 둘째 판이 됐으면, 앞서 덤벨 스쿼트를 받은 보조 자리를 런지 · 힌지로 바꿔 본다 —
       * 덤벨만 있는 집의 하체 B에서 둔근 자리(힌지 · 런지)가 덤벨 스모 스쿼트를, 대퇴사두 자리가 고블릿 스쿼트를 받았다.
       */
      const twin = picked.find((item) => item.slot.role !== 'primary' && twinBellSquat(chosen, [item.exercise]));
      if (twin) {
        context.today = [...picked.filter((item) => item !== twin).map((item) => item.exercise), chosen];
        context.weekBodyweight = weekBodyweight;
        context.noSwap = true;
        const notInstead = pool.filter((item) => !betterInstead(twin.exercise, item, twin.slot, context)).map((item) => item.id);
        const instead = pickExercise(twin.slot, pool,
          new Set([...usedToday, ...reserved, chosen.id, ...notInstead]), context);
        context.noSwap = false;
        if (instead) {
          release(twin.exercise);
          take(instead);
          twin.exercise = instead;
        }
      }

      take(exercise);
      picked.push({ slot, exercise, sets: 0 });
    });

    /*
     * 그래도 덤벨 스쿼트가 둘이면(덤벨 리버스 런지가 이미 있어 워킹 런지도 못 넣는 대퇴사두 자리) 하루가 네 종목 아래로
     * 줄지 않는 한 둘째 판을 뺀다 — 그날에는 이미 런지 · 힌지가 있다. 약점 자리 · 메인은 남긴다.
     */
    const wantedToday = Math.min(MIN_DAY_EXERCISES, day.slots.length);
    const bellSquats = picked.filter((item) => item.exercise.pattern === 'squat' && item.exercise.equipment === 'dumbbell');
    if (bellSquats.length > 1 && picked.length > wantedToday) {
      const spare = bellSquats.filter((item) => item.slot.role !== 'primary');
      const drop = [...spare].reverse().find((item) => !item.slot.priority) ?? spare[spare.length - 1];
      if (drop) {
        release(drop.exercise);
        picked.splice(picked.indexOf(drop), 1);
      }
    }

    /*
     * 덤벨 · 케틀벨이 있는데 하체 날에 무게 실은 스쿼트 · 힌지 · 런지가 하나도 없으면(케틀벨뿐인 집의 하체 B — 고블릿 스쿼트 ·
     * 스윙을 하체 A에서 써서 맨몸 스쿼트 · 브릿지만 남았다) 하체 동작 자리 하나를 무게 싣는 종목으로 바꾼다. 이번 주에 쓴 것도 된다.
     */
    const loadedLower = (exercise: Exercise) => !isUnloaded(exercise) && LOWER_COMPOUND.includes(exercise.pattern);
    /*
     * 먼저 오늘 어떤 종목과도 부딪치지 않는 걸 찾고, 없으면 무게 싣는 판을 넣은 뒤 부딪치는 가벼운 맨몸판(같은 무릎 갈래의
     * 맨몸 스쿼트 · 런지)을 다른 종목으로 바꾼다 — 맨몸 리버스 런지 + 맨몸 스쿼트뿐이던 케틀벨 집의 전신 B.
     */
    const lowerSlot = (item: Picked) =>
      isUnloaded(item.exercise) && item.slot.patterns?.some((pattern) => LOWER_COMPOUND.includes(pattern));
    for (const strict of [true, false]) {
      if (picked.some((item) => loadedLower(item.exercise)) || !pool.some(loadedLower)) break;
      for (const item of picked) {
        if (!lowerSlot(item)) continue;
        context.today = picked.filter((other) => other !== item).map((other) => other.exercise);
        context.weekBodyweight = weekBodyweight;
        context.noSwap = strict;
        const instead = pickExercise(item.slot, pool.filter(loadedLower), new Set([...usedToday, ...reserved]), context);
        context.noSwap = false;
        if (!instead) continue;
        release(item.exercise);
        take(instead);
        item.exercise = instead;
        for (const loser of picked.filter((other) => other !== item && sameMovement(other.exercise, instead) &&
          hardness(other.exercise) < hardness(instead))) swapOut(loser, instead);
        break;
      }
    }

    /*
     * 자리가 비어 하루가 너무 짧으면(기구가 거의 없는 집) 쉬운 맨몸 종목으로 채운다. 그날 아직 안 쓴
     * 부위를 맡는 종목만 — 데드버그 · 리버스 크런치를 같은 날 둘 다 넣지는 않는다.
     */
    /*
     * 하체 채우기(글루트 브릿지 · 맨몸 스쿼트 · 한발 카프레이즈)는 하체 자리가 있는 날에만, 그리고 같은 종목을 바로
     * 앞날에 넣지 않았을 때만 — 매트뿐인 주 4회에서 상체 날까지 브릿지가 들어가 하체가 매일 일했다.
     * 상체 채우기(인클라인 푸시업)는 미는 부위 자리가 있는 날에만 — 당기는 날에 푸시업을 끼우지 않는다.
     */
    const wanted = wantedToday;
    const mainMuscle = (exercise: Exercise) => (Object.entries(exercise.contribution) as [MuscleGroup, number][])
      .sort((a, b) => b[1] - a[1])[0]?.[0];
    const dayHasLower = day.slots.some((slot) => LOWER_BODY.has(slot.muscle));
    const dayHasPush = day.slots.some((slot) => PUSH_MUSCLES.has(slot.muscle));
    const lowerFillersToday = new Set<string>();
    for (const id of EASY_FILLERS) {
      if (picked.length >= wanted) break;
      const filler = pool.find((exercise) => exercise.id === id);
      if (!filler || usedToday.has(filler.id)) continue;
      const muscle = mainMuscle(filler);
      if (!muscle || picked.some((item) => mainMuscle(item.exercise) === muscle || item.slot.muscle === muscle)) continue;
      if (picked.some((item) => sameMovement(item.exercise, filler))) continue;
      if (LOWER_BODY.has(muscle) && (!dayHasLower || previousLowerFillers.has(filler.id))) continue;
      if (PUSH_MUSCLES.has(muscle) && !dayHasPush) continue;
      if (LOWER_BODY.has(muscle)) lowerFillersToday.add(filler.id);
      usedToday.add(filler.id);
      usedThisWeek.add(filler.id);
      weekBodyweight += 1;
      addJointLoad(sessionLoad, filler);
      picked.push({ slot: { muscle, role: 'isolation' }, exercise: filler, sets: 0 });
    }
    /*
     * 매트(+케틀벨)뿐인 집의 상체 · 푸시 날은 위 채우기를 해도 두세 종목에서 끝났다 — 미는 운동이 푸시업 · 파이크 푸시업뿐이다.
     * 무게를 싣는 가슴 운동이 없는 곳에서 그래도 모자라면:
     *  · 푸시업 바로 뒤에 인클라인 푸시업을 가볍게 한 번 더(같은 동작의 쉬운 판으로 마무리 — 고를 게 이것뿐일 때만)
     *  · 초보가 아니면 파이크 푸시업(어깨 앞 · 삼두)
     */
    const loadedPress = pool.some((exercise) => exercise.pattern === 'horizontalPush' && !isUnloaded(exercise));
    if (dayHasPush && !loadedPress) {
      for (const id of SPARSE_PUSH_FILLERS) {
        if (picked.length >= wanted) break;
        const filler = pool.find((exercise) => exercise.id === id);
        if (!filler || usedToday.has(filler.id)) continue;
        if (level === 'beginner' && BEGINNER_EXCLUDED.has(filler.id)) continue;
        const backOff = filler.id === 'incline-push-up' && picked.some((item) => item.exercise.id === 'push-up');
        if (picked.some((item) => sameMovement(item.exercise, filler) && !(backOff && item.exercise.id === 'push-up'))) continue;
        const muscle = mainMuscle(filler);
        if (!muscle) continue;
        if (!backOff && picked.some((item) => mainMuscle(item.exercise) === muscle || item.slot.muscle === muscle)) continue;
        usedToday.add(filler.id);
        usedThisWeek.add(filler.id);
        weekBodyweight += 1;
        addJointLoad(sessionLoad, filler);
        const entry: Picked = { slot: { muscle, role: 'isolation' }, exercise: filler, sets: 0 };
        const after = backOff ? picked.findIndex((item) => item.exercise.id === 'push-up') + 1 : picked.length;
        picked.splice(after, 0, entry);
      }
    }
    /*
     * 그래도 모자라면 바닥 종목(FLOOR_FILLERS). 같은 동작 · 버티기 둘(플랭크 + 사이드 플랭크)은 넣지 않고, 코어는 두 종목까지.
     */
    for (const { id, upperOnly } of FLOOR_FILLERS) {
      if (picked.length >= wanted) break;
      const filler = pool.find((exercise) => exercise.id === id);
      if (!filler || usedToday.has(filler.id)) continue;
      if (upperOnly && dayHasLower) continue;
      if (picked.some((item) => sameMovement(item.exercise, filler))) continue;
      if (HOLDS.has(filler.id) && picked.some((item) => HOLDS.has(item.exercise.id))) continue;
      // 버드독은 당기는 날(미는 · 하체 자리 없음)에는 등 뒤쪽 운동으로 친다 — 매트뿐인 풀 날은 그것 말고 등을 쓸 게 슈퍼맨뿐이다
      const backWork = filler.id === 'bird-dog' && !dayHasPush;
      if (filler.pattern === 'core' && !backWork &&
        picked.filter((item) => item.exercise.pattern === 'core').length >= MAX_CORE_FILLED) continue;
      const muscle = mainMuscle(filler);
      if (!muscle) continue;
      usedToday.add(filler.id);
      usedThisWeek.add(filler.id);
      weekBodyweight += 1;
      addJointLoad(sessionLoad, filler);
      picked.push({ slot: { muscle, role: 'isolation' }, exercise: filler, sets: 0 });
    }
    previousLowerFillers = lowerFillersToday;
    /*
     * 복근 · 코어(데드버그 · 크런치 · 플랭크)는 그날 마지막에 — 몸통을 받쳐 줄 힘을 프레스 · 스쿼트 전에 쓰지 않는다.
     * 매트 · 케틀벨 집의 상체 B가 채우기 순서대로 푸시업 → 인클라인 푸시업 → 데드버그 → 파이크 푸시업이 됐다.
     */
    const isCore = (item: Picked) => item.exercise.pattern === 'core';
    return [...picked.filter((item) => !isCore(item)), ...picked.filter(isCore)];
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
    /*
     * 종아리는 스쿼트 · 런지가 거의 채워 주지 않아(발목이 거의 안 움직인다) 고립 두 자리로만
     * 최소 8세트를 채워야 한다. 회복이 빨라 한 번에 4세트도 무리가 아니다.
     */
    const muscleCap = muscle === 'calves' ? cap + 1 : cap;
    item.sets = clamp(Math.ceil(remaining / Math.max(1, isolationCount.get(muscle) ?? 1)), floor, muscleCap);
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

  /*
   * 체력 기르기(크로스핏식) — 근력 운동은 큰 운동 위주로 짧게 줄이고, 남는 시간에 마무리 운동을 붙인다.
   * 한 시간짜리 근력 운동 뒤에 숨찬 운동 10분을 더 얹으면 둘 다 흐려진다.
   */
  if (goalPlan.conditioning && days > 1) {
    return {
      name: SPLIT_NAMES[days] ?? `주 ${days}회`,
      daysPerWeek: days,
      caution: goalPlan.goals.includes('hypertrophy')
        ? '마무리 운동을 날마다 붙이느라 근력 운동을 조금 줄였습니다. 부위마다 한 주 세트는 최소 언저리에서 시작합니다.'
        : '마무리 운동을 날마다 붙이느라 근력 운동은 큰 운동 위주로 짧게 짰습니다. ' +
          '부위마다 한 주 세트가 근육을 키우는 최소보다 적을 수 있습니다 — 체력이 먼저인 계획이라 그렇습니다.',
      templates: trimForConditioning(ranged, level, goalPlan.goals.includes('hypertrophy')),
      weeklyTargets,
    };
  }

  return {
    name: SPLIT_NAMES[days] ?? `주 ${days}회`,
    daysPerWeek: days,
    caution: cautionFor(days, ranged, landmarks, answers.gym.equipmentIds, levelProfile(level).startingRir, level),
    templates: ranged,
    weeklyTargets,
  };
}

/** 마무리 운동이 붙는 날, 근력 운동이 과정 안에서 늘 수 있는 세트 수. */
export const CONDITIONING_GROWTH_CAP = 2;

/** 마무리 운동이 붙는 날의 근력 운동 세트 상한 — 25~30분 안에 끝나는 양. */
export function conditioningSetCap(level: TrainingLevel, withHypertrophy = false): number {
  const base = level === 'beginner' ? 9 : level === 'intermediate' ? 11 : 12;
  return base + (withHypertrophy ? 3 : 0);
}

/**
 * 마무리 운동이 붙는 계획의 근력 부분.
 *
 * 큰 운동(메인 · 보조)을 앞에서부터 네 개까지 남기고 작은 운동은 뺀다 — 근육 키우기를 같이 골랐으면 다섯 개.
 * 큰 운동이 셋이 안 되는 날(매트뿐인 집)은 작은 운동으로 셋까지 채운다. 종목마다 세 세트까지(데드리프트는 정한 대로),
 * 하루 세트 상한을 넘으면 뒤 종목부터 두 세트까지 줄인다. 반복 범위와 종목 순서는 건드리지 않는다.
 */
export function trimForConditioning(
  templates: readonly SessionTemplate[],
  level: TrainingLevel,
  withHypertrophy = false,
): SessionTemplate[] {
  const maxSlots = withHypertrophy ? 5 : 4;
  const cap = conditioningSetCap(level, withHypertrophy);
  return templates.map((template) => {
    if (template.fixed) return template;
    const big = template.slots.filter((slot) => slot.role !== 'isolation').slice(0, maxSlots);
    const keep = new Set(big);
    const wanted = withHypertrophy ? maxSlots : 3;
    for (const slot of template.slots) {
      if (keep.size >= wanted) break;
      keep.add(slot);
    }
    const slots = template.slots.filter((slot) => keep.has(slot)).map((slot) => ({
      ...slot,
      sets: HEAVY_PULLS.has(slot.exerciseId) ? slot.sets : Math.min(slot.sets, 3),
    }));
    const total = () => slots.reduce((sum, slot) => sum + slot.sets, 0);
    for (const roles of [['isolation', 'accessory'], ['primary']] as const) {
      for (let guard = 0; guard < 40 && total() > cap; guard += 1) {
        const target = [...slots].reverse()
          .filter((slot) => (roles as readonly string[]).includes(slot.role ?? 'isolation') && slot.sets > 2)
          .sort((a, b) => b.sets - a.sets)[0];
        if (!target) break;
        target.sets -= 1;
      }
    }
    return { ...template, slots, setCap: Math.min(template.setCap ?? cap, cap), growthCap: CONDITIONING_GROWTH_CAP };
  });
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
  // 첫 주에 남기는 개수 — 근성장 체크와 같은 셈으로 재야 둘이 다르게 말하지 않는다(초보 첫 주는 4개)
  startingRir = 2,
  level?: TrainingLevel,
): string | undefined {
  if (days === 1) {
    return '주 1회는 근육을 늘리기보다 지키는 일정입니다. 전신을 한 번에 돌려 ' +
      '빠지는 부위가 없게 짰지만, 부위마다 한 주 최소 세트에는 못 미칩니다. ' +
      '늘리는 것이 목표라면 주 2회부터가 현실적입니다.';
  }
  /*
   * 초보의 주 3회 전신은 처음 시작하는 정석이다. 일부러 가볍게 시작해 몇 주에 걸쳐 늘리는 계획을
   * "최소 세트 아래에서 시작합니다"라고 경고처럼 말하면, 3일을 고르자마자 부족하다는 말부터 듣는다.
   */
  if (level === 'beginner' && days >= 3) return undefined;

  // 할 종목이 아예 없는 부위만 기구 탓이다 — 한 가지라도 있으면 세트를 늘려 채울 수 있다
  const noGear = new Set(coverageReport(equipmentIds).filter((item) => item.directOptions === 0).map((item) => item.muscle));
  const short = volumeReport(templateWeekLogs(templates, undefined, startingRir), landmarks, EXERCISE_INDEX)
    .filter((line) => line.landmark.mev > 0 && line.effectiveSets < line.landmark.mev * 0.85)
    .filter((line) => !QUIET_WHEN_LOW.has(line.muscle) && !noGear.has(line.muscle))
    .map((line) => line.muscle);
  if (short.length === 0) return undefined;

  const named = short.slice(0, 3).map((muscle) => MUSCLE_LABELS_KO[muscle]).join(' · ') +
    (short.length > 3 ? ` 외 ${short.length - 3}곳` : '');
  const plan = days <= 3 ? `주 ${days}회 · 하루 한 시간 안쪽으로` : withParticle(`주 ${days}회`, '으로/로');
  // 경고가 아니라 안내로 — 일부러 낮게 시작해 늘리는 정상 계획이다
  return `${plan} 짜서 첫 주는 ${withParticle(named, '을/를')} 한 주 최소 세트보다 가볍게 시작해 ` +
    '몇 주 동안 세트를 조금씩 늘려 채웁니다' +
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

  const goalPlan = planGoals(answers.goals);
  const conditioning = weeklyConditioningPlan({
    goals: answers.goals,
    level: level.level,
    templates: program.templates,
    equipmentIds: answers.gym.equipmentIds,
    weekInBlock: 1,
  });

  notes.push(
    `${program.name} · ${profile.label}에 맞는 운동량으로 시작합니다. ` +
      `${profile.accumulationWeeks}주 동안 조금씩 늘리고, 그다음 한 주는 덜어냅니다.`,
  );

  /*
   * 기구 안내 — 할 종목이 아예 없는 부위와, 한 가지뿐이라 블록이 바뀌어도 같은 종목인
   * 부위를 나눠 말한다. 둘을 묶어 "종목이 부족합니다"라고만 하면 덤벨 로우로 등을 잘 하고
   * 있는 사람도 등을 못 하는 줄 안다.
   */
  const gaps = coverageReport(answers.gym.equipmentIds).filter((item) => !item.sufficient);
  /*
   * 기구 목록으로는 "직접 종목 없음"이어도 프로그램에 그 부위를 주로 쓰는 종목(가슴 0.75인 인클라인 푸시업)이
   * 들어갔으면 없다고 말하지 않는다 — 매트뿐인 집에서 인클라인 푸시업을 하는데 "가슴 종목을 할 기구가 없어"라고 했다.
   */
  const trained = new Set<MuscleGroup>();
  for (const template of program.templates) {
    for (const slot of template.slots) {
      const exercise = EXERCISE_INDEX.get(slot.exerciseId);
      for (const [muscle, value] of Object.entries(exercise?.contribution ?? {}) as [MuscleGroup, number][]) {
        if (value >= 0.75) trained.add(muscle);
      }
    }
  }
  const none = gaps.filter((gap) => gap.directOptions === 0 && !trained.has(gap.muscle));
  const few = gaps.filter((gap) => gap.directOptions > 0);
  const labels = (list: typeof gaps) => list.slice(0, 3).map((gap) => MUSCLE_LABELS_KO[gap.muscle]).join(' · ');
  if (none.length > 0) {
    const suggestion = none.find((gap) => gap.suggestion)?.suggestion;
    notes.push(`${labels(none)} 종목을 할 기구가 없어 이 부위는 다른 종목에서 간접으로만 씁니다.` +
      (suggestion ? ` ${withParticle(suggestion.name, '을/를')} 더하면 채워집니다.` : ''));
  }
  if (few.length > 0) {
    notes.push(`${withParticle(labels(few), '은/는')} 이 기구로 할 종목이 한 가지뿐이라 과정이 바뀌어도 같은 종목입니다. 기구를 더 고르면 바꿔 가며 합니다.`);
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

  /*
   * 근력이 목표인데 무겁게 들 바벨 종목이 프로그램에 없으면 그대로 말한다. 목표 안내는 "바벨 메인 동작은 4~6회"라고
   * 하는데 덤벨 · 매트뿐인 집에서는 그런 종목이 하나도 없다 — 약속한 것과 받은 것이 달랐다.
   */
  if (goalPlan.goals.includes('strength')) {
    const heavy = [...programIds].some((id) => {
      const exercise = EXERCISE_INDEX.get(id);
      return exercise !== undefined && isStrengthLift(exercise);
    });
    if (!heavy) {
      notes.push('근력이 목표지만 이 기구에는 적은 횟수로 무겁게 들 바벨 종목이 없습니다. ' +
        '그래서 덤벨 · 맨몸 종목을 6회 이상으로 하고, 횟수를 다 채우면 무게나 더 어려운 동작으로 올립니다. ' +
        '바벨과 랙이 있는 곳에서 하게 되면 기구를 다시 골라 주세요.');
    }
  }

  // 붙는 마무리 운동 · 유산소가 있으면 한 줄로 알린다
  if (conditioning.kind !== 'none') {
    notes.push(conditioning.summary + (conditioning.restDay ? ` ${conditioning.restDay.text}` : ''));
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
    conditioning,
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
  const plan = planGoals(goals);
  const strengthOnly = plan.goals.includes('strength') && !plan.goals.includes('hypertrophy');
  return templates.map((template) => {
    // 내 루틴은 사용자가 정한 반복 그대로 둔다
    if (template.fixed) return template;
    let heavyToday = 0;
    return {
      ...template,
      slots: template.slots.map((slot) => {
        const exercise = exerciseById(slot.exerciseId);
        if (!exercise || !slot.role) return slot;
        /*
         * 근력만이면 종목마다 그 주 첫 등장이 무거운 날, 두 번째가 가벼운 날이다. 동작 갈래로 세면
         * 프론트 스쿼트가 무거운 자리를 가져가 백 스쿼트 첫 등장이 6~8회가 됐고, 하루 두 개 한도에
         * 걸려 주에 한 번뿐인 바벨 로우가 가벼운 날로만 나왔다.
         */
        const key = strengthOnly ? exercise.id : exercise.pattern;
        const heavy = slot.role === 'primary' && isStrengthLift(exercise) &&
          !heavyPatterns.has(key) && (strengthOnly || heavyToday < HEAVY_PER_DAY);
        if (heavy) {
          heavyPatterns.add(key);
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
  // 버티는 종목(플랭크)은 초 — 초보 20~30초에서 시작해 위 끝을 채우면 5초씩 늘린다(hold.ts)
  if (isTimed(exercise)) return holdRange(level);
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
  'incline-push-up': { min: 8, max: 15 },
  'bodyweight-squat': { min: 12, max: 20 },
  'single-leg-calf-raise': { min: 10, max: 20 },
  'crunch': { min: 12, max: 20 },
  // 매트 초보 종목 — 무릎 푸시업은 인클라인 푸시업과 같은 칸, 버드독은 좌우 번갈아 센 수
  'knee-push-up': { min: 8, max: 15 },
  'bird-dog': { min: 10, max: 16 },
  'superman': { min: 10, max: 15 },
  // 밴드도 무게 숫자가 없다 — 횟수로 올리고, 위 끝에 닿으면 센 밴드로 바꾼다
  'band-row': { min: 12, max: 20 },
  'band-lateral-raise': { min: 12, max: 20 },
  'band-pull-apart': { min: 15, max: 25 },
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
      // 근력만 — 같은 동작의 두 번째 날은 가벼운 날(6~8회): 무거운 날 · 가벼운 날
      if (!heavySlot) return level === 'beginner' ? { min: 6, max: 10 } : { min: 6, max: 8 };
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
