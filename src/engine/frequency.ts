import { MUSCLE_GROUPS, MUSCLE_LABELS_KO } from './muscles.ts';
import { PER_SESSION_CAP, aggregateVolume, type VolumeOptions } from './volume.ts';
import type { Exercise, MuscleGroup, SessionLog } from './types.ts';

export type FrequencyVerdict =
  /** 빈도와 분배가 적절하다 */
  | 'ok'
  /** 볼륨이 한 세션에 몰려 일부가 버려지고 있다 */
  | 'concentrated'
  /** 이 볼륨을 소화하기에 훈련 횟수가 모자란다 */
  | 'insufficient'
  /** 이번 주에 건드리지 않은 부위 */
  | 'idle';

export interface MuscleFrequency {
  muscle: MuscleGroup;
  label: string;
  /** 그 부위를 자극한 세션 수 */
  sessionCount: number;
  /** 수확 체감까지 반영한 유효 세트 */
  effectiveSets: number;
  /** 감가 전 세트 */
  rawSets: number;
  /** 한 세션에 몰려서 버려진 세트 */
  discountedSets: number;
  maxSetsInOneSession: number;
  /** 이 볼륨이면 주 몇 회로 나눠야 하는가 */
  recommendedSessions: number;
  verdict: FrequencyVerdict;
  advice: string;
}

export interface FrequencyOptions extends VolumeOptions {
  /**
   * 이 세트 수 아래로는 빈도를 따지지 않는다.
   * 주 3세트짜리 보조 부위에 "주 2회로 나누세요"라고 하는 건 소음이다.
   */
  minSetsForSplit?: number;
  /** 버려진 세트가 이만큼을 넘으면 '몰림'으로 본다. */
  discountTolerance?: number;
}

const DEFAULTS: Required<Pick<FrequencyOptions, 'minSetsForSplit' | 'discountTolerance'>> = {
  minSetsForSplit: 4,
  discountTolerance: 0.4,
};

/**
 * 이 볼륨을 소화하려면 주 몇 회로 나눠야 하는지.
 *
 * 근비대에서 부위당 주 2회 분산이 1회보다 유리하다는 건 반복 확인된 결과다.
 * 그 위로는 세션당 상한에서 역산한다 — 18세트를 9세트씩 두 번이면 충분하고,
 * 27세트라면 세 번으로 나눠야 버리는 세트가 없다.
 */
export function recommendedSessions(weeklySets: number, options: FrequencyOptions = {}): number {
  const cap = options.perSessionCap ?? PER_SESSION_CAP;
  const minForSplit = options.minSetsForSplit ?? DEFAULTS.minSetsForSplit;

  if (weeklySets <= 0) return 0;
  if (weeklySets < minForSplit) return 1;
  return Math.min(4, Math.max(2, Math.ceil(weeklySets / cap)));
}

/** 한 주의 세션들을 부위별 빈도 현황으로 정리한다. */
export function frequencyReport(
  sessions: readonly SessionLog[],
  index: ReadonlyMap<string, Exercise>,
  options: FrequencyOptions = {},
): MuscleFrequency[] {
  const totals = aggregateVolume(sessions, index, options);
  const tolerance = options.discountTolerance ?? DEFAULTS.discountTolerance;

  return MUSCLE_GROUPS.map((muscle) => {
    const detail = totals[muscle];
    const recommended = recommendedSessions(detail.rawSets, options);
    const label = MUSCLE_LABELS_KO[muscle];

    let verdict: FrequencyVerdict;
    let advice: string;

    if (detail.sessionCount === 0) {
      verdict = 'idle';
      advice = '이번 주에 훈련하지 않았습니다';
    } else if (detail.discountedSets > tolerance) {
      verdict = 'concentrated';
      advice =
        `한 세션에 ${detail.maxSetsInOneSession}세트가 몰려 ${detail.discountedSets}세트가 자극으로 이어지지 않았습니다. ` +
        `같은 볼륨을 주 ${recommended}회로 나누면 그대로 인정됩니다`;
    } else if (detail.sessionCount < recommended) {
      verdict = 'insufficient';
      advice = `주 ${detail.sessionCount}회로 ${detail.effectiveSets}세트를 소화하고 있습니다. 주 ${recommended}회로 나누는 편이 회복과 자극 모두에 유리합니다`;
    } else {
      verdict = 'ok';
      advice = `주 ${detail.sessionCount}회 · 세션당 평균 ${round1(detail.effectiveSets / detail.sessionCount)}세트`;
    }

    return {
      muscle,
      label,
      sessionCount: detail.sessionCount,
      effectiveSets: detail.effectiveSets,
      rawSets: detail.rawSets,
      discountedSets: detail.discountedSets,
      maxSetsInOneSession: detail.maxSetsInOneSession,
      recommendedSessions: recommended,
      verdict,
      advice,
    };
  });
}

/** 조치가 필요한 항목만. 심한 것부터. */
export function actionableFrequency(report: readonly MuscleFrequency[]): MuscleFrequency[] {
  const rank: Record<FrequencyVerdict, number> = { concentrated: 0, insufficient: 1, ok: 2, idle: 3 };
  return report
    .filter((item) => item.verdict === 'concentrated' || item.verdict === 'insufficient')
    .sort((a, b) => rank[a.verdict] - rank[b.verdict] || b.discountedSets - a.discountedSets);
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
