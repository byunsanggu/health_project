import { withParticle } from './korean.ts';
import { intensityForReps } from './repmax.ts';
import { styleProfile, type TrainingStyle } from './styles.ts';
import type { Exercise, Joint, PainReport, TrainingLevel, VolumeZone } from './types.ts';

/**
 * 강도 기법과 한계 테스트.
 *
 * "한계를 뚫어야 한다"는 맞는 말이다. 다만 매주 뚫으려 하면 못 뚫는다.
 * 한계 돌파는 기분이 아니라 계획으로 하는 것이고, 이 모듈이 그 계획을 맡는다.
 *
 * 강도 기법은 자극을 크게 올리는 대신 피로를 더 크게 올린다. 그래서 유효 세트와
 * 피로를 따로 세고, 지금 써도 되는 상황인지 먼저 본다.
 */
export type IntensityTechnique =
  | 'dropSet'
  | 'restPause'
  | 'myoReps'
  | 'cluster'
  | 'antagonistSuperset'
  | 'compoundSuperset'
  | 'amrapFinisher';

export interface TechniqueProfile {
  id: IntensityTechnique;
  label: string;
  /** 한 세트가 몇 유효 세트로 세어지는가 */
  volumeFactor: number;
  /** 같은 세트 대비 피로 배율 */
  fatigueFactor: number;
  howTo: string;
  /** 고립 운동에만 쓸 수 있는가 */
  isolationOnly?: boolean;
  /** 이 값을 넘는 관절 부하가 있으면 쓰지 않는다 */
  maxJointStress?: number;
  minLevel?: TrainingLevel;
}

export const TECHNIQUES: Record<IntensityTechnique, TechniqueProfile> = {
  dropSet: {
    id: 'dropSet',
    label: '드롭세트',
    volumeFactor: 1.5,
    fatigueFactor: 2,
    maxJointStress: 0.6,
    howTo: '목표 반복까지 간 뒤 곧바로 20~25% 낮춰 한 번 더 실패까지 갑니다.',
  },
  restPause: {
    id: 'restPause',
    label: '레스트 포즈',
    volumeFactor: 1.6,
    fatigueFactor: 2.2,
    maxJointStress: 0.6,
    minLevel: 'intermediate',
    howTo: '실패까지 간 뒤 15~20초 쉬고 같은 중량으로 더 나오는 만큼, 두 번 반복합니다.',
  },
  myoReps: {
    id: 'myoReps',
    label: '미오렙',
    volumeFactor: 1.8,
    fatigueFactor: 2,
    isolationOnly: true,
    minLevel: 'intermediate',
    howTo: '활성화 세트를 실패까지 간 뒤, 5초 휴식 + 3~5회를 여러 번 반복합니다.',
  },
  cluster: {
    id: 'cluster',
    label: '클러스터 세트',
    volumeFactor: 1.3,
    fatigueFactor: 1.3,
    minLevel: 'intermediate',
    howTo: '세트 안에서 1~3회마다 15~20초 쉬어 총 반복을 늘립니다. 고중량에서 자세를 지키며 볼륨을 얻는 방법입니다.',
  },
  antagonistSuperset: {
    id: 'antagonistSuperset',
    label: '길항근 슈퍼세트',
    volumeFactor: 1,
    fatigueFactor: 1.1,
    howTo: '미는 동작과 당기는 동작을 번갈아 쉬지 않고 이어갑니다. 자극은 그대로, 시간만 줄입니다.',
  },
  compoundSuperset: {
    id: 'compoundSuperset',
    label: '같은 부위 슈퍼세트',
    volumeFactor: 1.4,
    fatigueFactor: 1.6,
    maxJointStress: 0.7,
    howTo: '같은 부위 두 종목을 쉬지 않고 이어 붙입니다.',
  },
  amrapFinisher: {
    id: 'amrapFinisher',
    label: 'AMRAP 피니셔',
    volumeFactor: 1.2,
    fatigueFactor: 1.5,
    maxJointStress: 0.6,
    howTo: '마지막 세트를 가능한 만큼 끝까지 수행합니다. 종목당 한 번만.',
  },
};

export const TECHNIQUE_IDS: readonly IntensityTechnique[] = [
  'dropSet', 'restPause', 'myoReps', 'cluster', 'antagonistSuperset', 'compoundSuperset', 'amrapFinisher',
];

const LEVEL_ORDER: Record<TrainingLevel, number> = {
  beginner: 0, intermediate: 1, advanced: 2, expert: 3,
};

export interface TechniqueContext {
  exercise: Exercise;
  level: TrainingLevel;
  style: TrainingStyle;
  /** 그 부위의 현재 볼륨 구간 */
  zone?: VolumeZone;
  /** 디로드 주인가 */
  deloadWeek?: boolean;
  pain?: readonly PainReport[];
  /** 그 종목의 마지막 세트인가 — 강도 기법은 뒤쪽에 붙인다 */
  isLastSet?: boolean;
}

export interface TechniqueAvailability {
  technique: TechniqueProfile;
  allowed: boolean;
  reason?: string;
}

/**
 * 지금 이 세트에 쓸 수 있는 강도 기법.
 *
 * 막는 게 목적이 아니라, 지금 쓰면 손해인 것을 이유와 함께 알려주는 게 목적이다.
 * MRV 근처에서 드롭세트를 붙이면 자극이 아니라 회복 부채만 쌓인다.
 */
export function availableTechniques(context: TechniqueContext): TechniqueAvailability[] {
  const { exercise, level, style } = context;
  const styleAllows = styleProfile(style).allowsIntensityTechniques;
  const maxStress = Math.max(0, ...Object.values(exercise.jointStress));
  const painful = (context.pain ?? []).filter((report) => report.score >= 3);

  return TECHNIQUE_IDS.map((id) => {
    const technique = TECHNIQUES[id];
    const deny = (reason: string): TechniqueAvailability => ({ technique, allowed: false, reason });

    if (context.deloadWeek) return deny('디로드 주에는 강도 기법을 쓰지 않습니다. 덜어내는 주입니다.');
    if (!styleAllows) {
      return deny(`${styleProfile(style).label} 블록에서는 강도 기법을 쓰지 않습니다. 강도는 중량으로 올립니다.`);
    }
    if (technique.minLevel && LEVEL_ORDER[level] < LEVEL_ORDER[technique.minLevel]) {
      return deny('아직 이 기법을 쓸 단계가 아닙니다. 기본 세트로 먼저 쌓으세요.');
    }
    if (level === 'beginner' && exercise.pattern !== 'isolation') {
      return deny('초보 단계에서는 고립 운동에만 붙입니다. 복합 동작은 자세가 먼저입니다.');
    }
    if (technique.isolationOnly && exercise.pattern !== 'isolation') {
      return deny(`${withParticle(technique.label, '은/는')} 고립 운동 전용입니다.`);
    }
    if (technique.maxJointStress !== undefined && maxStress > technique.maxJointStress) {
      return deny('관절 부하가 큰 종목입니다. 지친 상태에서 자세가 무너지면 다칩니다.');
    }
    for (const report of painful) {
      if ((exercise.jointStress[report.joint as Joint] ?? 0) >= 0.3) {
        return deny('통증이 보고된 관절을 쓰는 종목입니다.');
      }
    }
    if (context.zone === 'overMrv') {
      return deny('이미 회복 범위를 넘은 부위입니다. 지금 더 넣으면 자극이 아니라 부채가 됩니다.');
    }
    if (context.zone === 'mavToMrv' && technique.fatigueFactor > 1.5) {
      return deny('고강도 구간입니다. 피로가 적은 기법만 권합니다.');
    }
    if (context.isLastSet === false && technique.fatigueFactor >= 2) {
      return deny('세트 뒤쪽에 붙이세요. 앞 세트에 쓰면 나머지 세트가 무너집니다.');
    }

    return { technique, allowed: true };
  });
}

export interface TechniqueEffect {
  /** 유효 세트로 몇 세트가 더해지는가 */
  effectiveSets: number;
  /** 볼륨 회계에 반영할 피로 부하 */
  fatigueLoad: number;
  note: string;
}

/** 강도 기법을 붙인 한 세트가 볼륨과 피로에 미치는 영향. */
export function techniqueEffect(technique: IntensityTechnique, baseSets = 1): TechniqueEffect {
  const profile = TECHNIQUES[technique];
  return {
    effectiveSets: round1(baseSets * profile.volumeFactor),
    fatigueLoad: round1(baseSets * profile.fatigueFactor),
    note: `${profile.label}: 유효 ${round1(baseSets * profile.volumeFactor)}세트로 세지만 ` +
      `피로는 ${round1(baseSets * profile.fatigueFactor)}세트만큼 쌓입니다.`,
  };
}

/* ── 한계 테스트 ───────────────────────────────────────── */

export type MaxTestReps = 1 | 3 | 5;

export interface WarmupStep {
  weightKg: number;
  reps: number;
  restSeconds: number;
  /** 1RM 대비 비율 */
  percent: number;
}

export interface MaxAttempt {
  weightKg: number;
  label: string;
  percent: number;
}

export interface MaxTestPlan {
  exerciseId: string;
  name: string;
  testReps: MaxTestReps;
  estimated1RM: number;
  warmups: WarmupStep[];
  attempts: MaxAttempt[];
  restBetweenAttempts: number;
  eligible: boolean;
  blockers: string[];
  safety: string[];
}

export interface MaxTestInput {
  exercise: Exercise;
  /** 현재 추정 1RM */
  estimated1RM: number;
  level: TrainingLevel;
  /** 직전 주가 디로드였는가 */
  justDeloaded?: boolean;
  /** 디로드 없이 축적한 주차 수 */
  weeksAccumulated?: number;
  pain?: readonly PainReport[];
  /** 그 기구에서 만들 수 있는 중량으로 맞추는 함수 */
  snap?: (weightKg: number) => number;
}

/** 단계별 테스트 반복 수. 초보에게 1RM 시도는 위험하다. */
export function testRepsFor(level: TrainingLevel): MaxTestReps {
  if (level === 'beginner') return 5;
  if (level === 'intermediate') return 3;
  return 1;
}

/**
 * 최대 중량 시도 계획.
 *
 * 워밍업 램프를 제대로 밟지 않으면 기록이 안 나오고, 너무 많이 밟으면 지쳐서
 * 안 나온다. 시도는 세 번까지 — 네 번째는 이미 떨어진 능력을 재는 것이다.
 */
export function planMaxTest(input: MaxTestInput): MaxTestPlan {
  const { exercise, estimated1RM, level } = input;
  const testReps = testRepsFor(level);
  const snap = input.snap ?? ((weight: number) => Math.round(weight * 2) / 2);
  const blockers: string[] = [];

  for (const report of input.pain ?? []) {
    if (report.score >= 3 && (exercise.jointStress[report.joint as Joint] ?? 0) >= 0.3) {
      blockers.push('통증이 보고된 관절을 쓰는 종목입니다. 통증이 가라앉은 뒤에 시도하세요.');
      break;
    }
  }
  if (input.justDeloaded === false) {
    blockers.push('디로드로 피로를 뺀 다음 주에 시도하세요. 지금은 기록이 아니라 컨디션을 재는 셈이 됩니다.');
  }
  if ((input.weeksAccumulated ?? 99) < 3) {
    blockers.push('축적 블록을 3주 이상 마친 뒤에 시도하세요. 올릴 게 남아 있어야 기록이 갱신됩니다.');
  }

  // 목표 반복에서의 강도 — 5RM 테스트면 1RM의 87% 근처가 목표다.
  const targetIntensity = intensityForReps(testReps);
  const target = estimated1RM * targetIntensity;

  const warmups: WarmupStep[] = [
    { percent: 0.4, reps: 5, restSeconds: 60 },
    { percent: 0.55, reps: 5, restSeconds: 75 },
    { percent: 0.7, reps: 3, restSeconds: 90 },
    { percent: 0.8, reps: 2, restSeconds: 120 },
    { percent: Math.min(0.88, targetIntensity - 0.05), reps: 1, restSeconds: 150 },
  ]
    .filter((step) => step.percent < targetIntensity - 0.02)
    .map((step) => ({ ...step, weightKg: snap(estimated1RM * step.percent) }));

  const attempts: MaxAttempt[] = [
    { percent: targetIntensity * 0.97, label: '1차 — 확실히 드는 무게로 감각을 잡습니다' },
    { percent: targetIntensity, label: '2차 — 현재 추정치' },
    { percent: targetIntensity * 1.035, label: '3차 — 2차가 깔끔했을 때만' },
  ].map((attempt) => ({ ...attempt, weightKg: snap(estimated1RM * attempt.percent) }));

  return {
    exerciseId: exercise.id,
    name: exercise.name,
    testReps,
    estimated1RM: round1(estimated1RM),
    warmups,
    attempts,
    restBetweenAttempts: testReps === 1 ? 300 : 240,
    eligible: blockers.length === 0,
    blockers,
    safety: buildSafety(exercise, testReps, target),
  };
}

function buildSafety(exercise: Exercise, testReps: MaxTestReps, targetKg: number): string[] {
  const notes = [
    `${testReps}RM 기준 목표는 ${Math.round(targetKg)}kg 부근입니다. 2차 시도가 무거웠다면 3차는 건너뜁니다.`,
    '시도는 세 번까지입니다. 네 번째는 이미 떨어진 능력을 재는 것입니다.',
  ];

  if ((exercise.jointStress.lowBack ?? 0) >= 0.8) {
    notes.push('허리에 최대 부하가 실리는 종목입니다. 자세가 무너지는 순간 중단하세요.');
  }
  if (exercise.pattern === 'horizontalPush' || exercise.pattern === 'squat') {
    notes.push('보조자를 두거나 세이프티 바를 맞춰 두고 시작하세요.');
  }
  if ((exercise.jointStress.shoulder ?? 0) >= 0.7) {
    notes.push(`${withParticle(exercise.name, '은/는')} 어깨 부담이 큽니다. 어깨에 불편함이 있으면 다른 종목으로 바꾸세요.`);
  }
  return notes;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
