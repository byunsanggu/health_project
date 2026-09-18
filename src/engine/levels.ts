import { estimate1RM } from './load.ts';
import { ANCHOR_FACTORS, type Anchor } from './strength.ts';
import type { SessionLog, TrainingLevel } from './types.ts';

export const TRAINING_LEVELS: readonly TrainingLevel[] = [
  'beginner', 'intermediate', 'advanced', 'expert',
];

export const LEVEL_LABELS_KO: Record<TrainingLevel, string> = {
  beginner: '초보',
  intermediate: '중급',
  advanced: '고급',
  expert: '전문가',
};

export interface LevelProfile {
  level: TrainingLevel;
  label: string;
  /** 온보딩에서 보여줄 한 줄 설명 */
  description: string;
  /** 디로드 없이 이어가는 축적 주차 수 */
  accumulationWeeks: number;
  /** 블록 1주차의 목표 RIR — 경력이 낮을수록 실패에서 멀리 둔다 */
  startingRir: number;
  /** 권장 주당 훈련 일수 */
  suggestedDaysPerWeek: number;
  /** 한 세션에서 한 부위에 쓸 수 있는 유효 세트 상한 */
  perSessionCap: number;
}

/**
 * 경력 단계가 볼륨 랜드마크만 바꾸는 게 아니다.
 *
 * 초보자는 적은 볼륨으로도 자극이 충분하고 회복이 빠르며 실패 근처 훈련이
 * 자세를 무너뜨린다. 전문가는 반대로 자극 역치가 높지만 회복 여력이 좁아
 * 블록을 짧게 끊어야 한다. 이 표가 그 차이를 담는다.
 */
export const LEVEL_PROFILES: Record<TrainingLevel, LevelProfile> = {
  beginner: {
    level: 'beginner',
    label: '초보',
    description: '6개월 미만 · 자세를 익히는 단계. 가벼운 볼륨으로도 계속 늘어납니다',
    accumulationWeeks: 6,
    startingRir: 4,
    suggestedDaysPerWeek: 3,
    perSessionCap: 7,
  },
  intermediate: {
    level: 'intermediate',
    label: '중급',
    description: '6개월~2년 · 주 단위로 무게가 오르던 시기가 끝난 단계',
    accumulationWeeks: 5,
    startingRir: 3,
    suggestedDaysPerWeek: 4,
    perSessionCap: 9,
  },
  advanced: {
    level: 'advanced',
    label: '고급',
    description: '2~5년 · 블록 단위로 계획해야 진도가 나가는 단계',
    accumulationWeeks: 4,
    startingRir: 2,
    suggestedDaysPerWeek: 5,
    perSessionCap: 10,
  },
  expert: {
    level: 'expert',
    label: '전문가',
    description: '5년 이상 또는 경기 경험 · 피로 관리가 훈련만큼 중요한 단계',
    accumulationWeeks: 4,
    startingRir: 2,
    suggestedDaysPerWeek: 5,
    perSessionCap: 11,
  },
};

export function levelProfile(level: TrainingLevel): LevelProfile {
  return LEVEL_PROFILES[level];
}

/* ── 자가 신고 검증 ────────────────────────────────────────── */

export interface LevelAssessmentInput {
  /** 설문에서 사용자가 고른 단계 */
  selfReported: TrainingLevel;
  /** 꾸준히 훈련한 개월 수 */
  monthsTraining?: number;
  bodyweightKg?: number;
  /** 이미 아는 기록이 있으면 근력으로도 본다 */
  history?: readonly SessionLog[];
}

export type LevelSource = 'self' | 'experience' | 'strength';

export interface LevelAssessment {
  level: TrainingLevel;
  selfReported: TrainingLevel;
  /** 최종 판정을 결정한 근거 */
  source: LevelSource;
  /** 자가 신고보다 낮게 잡혔는가 */
  adjusted: boolean;
  note: string;
}

/** 경력 개월 수로 본 단계. */
export function levelFromExperience(months: number): TrainingLevel {
  if (months < 6) return 'beginner';
  if (months < 24) return 'intermediate';
  if (months < 60) return 'advanced';
  return 'expert';
}

/** 체중 대비 벤치·스쿼트 기록으로 본 단계. */
export function levelFromStrength(
  history: readonly SessionLog[],
  bodyweightKg: number,
): TrainingLevel | null {
  if (!bodyweightKg) return null;

  const ratios: number[] = [];
  for (const anchor of ['bench', 'squat'] as Anchor[]) {
    const best = bestAnchor1RM(history, anchor);
    if (best !== null) ratios.push(best / bodyweightKg);
  }
  if (ratios.length === 0) return null;

  // 두 종목이 있으면 낮은 쪽을 본다. 한쪽만 좋은 건 그 단계가 아니다.
  const ratio = Math.min(...ratios);
  const isSquat = ratios.length === 1 && bestAnchor1RM(history, 'bench') === null;
  const thresholds = isSquat
    ? { intermediate: 1.4, advanced: 1.85, expert: 2.25 }
    : { intermediate: 1.0, advanced: 1.35, expert: 1.6 };

  if (ratio >= thresholds.expert) return 'expert';
  if (ratio >= thresholds.advanced) return 'advanced';
  if (ratio >= thresholds.intermediate) return 'intermediate';
  return 'beginner';
}

function bestAnchor1RM(history: readonly SessionLog[], anchor: Anchor): number | null {
  let best: number | null = null;
  for (const session of history) {
    for (const set of session.sets) {
      if (set.warmup || set.reps <= 0) continue;
      const mapping = ANCHOR_FACTORS[set.exerciseId];
      if (!mapping || mapping.anchor !== anchor) continue;
      const value = estimate1RM(set) / mapping.factor;
      if (best === null || value > best) best = value;
    }
  }
  return best;
}

const ORDER: Record<TrainingLevel, number> = {
  beginner: 0, intermediate: 1, advanced: 2, expert: 3,
};

/**
 * 자가 신고를 객관 신호와 대조해 낮은 쪽을 택한다.
 *
 * 현장에서 "중급이요"라고 답하는 사람의 상당수가 6개월 미만이다.
 * 과대평가된 단계로 볼륨을 처방하면 초반 몇 주는 버티다가 부상으로 끝난다.
 * 반대로 낮게 잡으면 몇 주 손해 보고 끝나므로, 틀릴 때 손해가 작은 쪽을 고른다.
 */
export function assessLevel(input: LevelAssessmentInput): LevelAssessment {
  const candidates: { level: TrainingLevel; source: LevelSource }[] = [
    { level: input.selfReported, source: 'self' },
  ];

  if (input.monthsTraining !== undefined) {
    candidates.push({ level: levelFromExperience(input.monthsTraining), source: 'experience' });
  }
  if (input.history && input.bodyweightKg) {
    const fromStrength = levelFromStrength(input.history, input.bodyweightKg);
    if (fromStrength) candidates.push({ level: fromStrength, source: 'strength' });
  }

  const lowest = candidates.reduce((min, item) =>
    ORDER[item.level] < ORDER[min.level] ? item : min,
  );

  const adjusted = ORDER[lowest.level] < ORDER[input.selfReported];
  return {
    level: lowest.level,
    selfReported: input.selfReported,
    source: lowest.source,
    adjusted,
    note: buildNote(lowest, input, adjusted),
  };
}

function buildNote(
  chosen: { level: TrainingLevel; source: LevelSource },
  input: LevelAssessmentInput,
  adjusted: boolean,
): string {
  const label = LEVEL_LABELS_KO[chosen.level];
  if (!adjusted) return `${label} 기준으로 시작합니다.`;

  if (chosen.source === 'experience') {
    return `훈련 경력 ${input.monthsTraining}개월 기준으로 ${label} 볼륨에서 시작합니다. ` +
      '가볍게 느껴지면 몇 주 안에 올라갑니다 — 처음부터 높게 잡는 쪽이 위험합니다.';
  }
  if (chosen.source === 'strength') {
    return `현재 기록 기준으로 ${label} 볼륨에서 시작합니다. 수행이 안정되면 단계가 올라갑니다.`;
  }
  return `${label} 기준으로 시작합니다.`;
}
