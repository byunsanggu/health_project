import { oneRepMax, repsForIntensity } from './repmax.ts';
import { addDays, weekStart } from './volume.ts';
import type { Exercise, SessionLog, SetLog } from './types.ts';

/**
 * RIR 신뢰도 보정.
 *
 * 엔진 전체가 사용자가 신고한 RIR 위에 서 있는데, 그 신고가 정확하다는 보장이 없다.
 * 특히 초보자는 "3회 남았다"고 하면서 실제로는 실패 직전인 경우가 흔하다.
 * 그대로 믿으면 엔진이 중량을 계속 올려 실패 지점을 넘겨버린다.
 *
 * 정답을 알 수는 없지만 기준점은 있다 — 실제로 실패까지 간 세트(RIR 0)다.
 * 그 세트에서 나온 능력치와, 여유가 있었다고 신고한 세트들이 함축하는 능력치를
 * 대조하면 그 사람의 편향을 역산할 수 있다.
 */
export interface RirCalibration {
  /** 비교에 쓰인 세트 수 */
  sampleSize: number;
  /** 기준점이 된 실패 세트 수 */
  anchorCount: number;
  /** 신고 RIR에 더할 값. 음수면 실제보다 높게 신고하는 사람이다 */
  offset: number;
  /** 신고를 얼마나 믿을 수 있는가 (0~1) */
  reliability: number;
  confidence: 'none' | 'low' | 'medium' | 'high';
  /** 보정을 실제로 적용할지 — 표본이 모자라면 건드리지 않는다 */
  applied: boolean;
  signals: string[];
  note: string;
}

export interface RirCalibrationOptions {
  /** 기준일. 이 날로부터 거슬러 올라가며 본다 */
  asOf?: string;
  /** 며칠치를 볼 것인가. 너무 길면 근력 변화가 섞인다 */
  windowDays?: number;
  /** Epley 추정이 무너지지 않는 반복 범위의 실패 세트만 기준으로 쓴다 */
  anchorReps?: { min: number; max: number };
  /** 이 신뢰도 아래에서는 보정을 적용하지 않는다 */
  minConfidence?: 'low' | 'medium' | 'high';
}

const DEFAULTS = {
  windowDays: 56,
  anchorReps: { min: 3, max: 15 },
  minConfidence: 'medium' as const,
};

const CONFIDENCE_ORDER = { none: 0, low: 1, medium: 2, high: 3 } as const;

export const NO_CALIBRATION: RirCalibration = {
  sampleSize: 0,
  anchorCount: 0,
  offset: 0,
  reliability: 1,
  confidence: 'none',
  applied: false,
  signals: [],
  note: 'RIR 신고를 검증할 기록이 아직 없습니다. 가끔 실패 지점까지 가는 세트를 남기면 정확도가 올라갑니다.',
};

export function calibrateRir(
  history: readonly SessionLog[],
  options: RirCalibrationOptions = {},
): RirCalibration {
  const windowDays = options.windowDays ?? DEFAULTS.windowDays;
  const anchorReps = options.anchorReps ?? DEFAULTS.anchorReps;
  const asOf = options.asOf ?? latestDate(history);
  if (!asOf) return NO_CALIBRATION;

  const from = addDays(weekStart(asOf), -windowDays);
  const inWindow = history.filter((s) => s.date >= from && s.date <= asOf);

  const byExercise = new Map<string, SetLog[]>();
  for (const session of inWindow) {
    for (const set of session.sets) {
      if (set.warmup || set.reps <= 0) continue;
      const bucket = byExercise.get(set.exerciseId);
      if (bucket) bucket.push(set);
      else byExercise.set(set.exerciseId, [set]);
    }
  }

  const offsets: number[] = [];
  const reported: number[] = [];
  let anchorCount = 0;

  for (const [, sets] of byExercise) {
    for (const set of sets) reported.push(set.rir);

    const anchors = sets.filter(
      (set) => set.rir === 0 && set.reps >= anchorReps.min && set.reps <= anchorReps.max,
    );
    if (anchors.length === 0) continue;

    // 그 종목에서 보여준 최고 능력치를 기준으로 삼는다.
    const anchor1RM = Math.max(...anchors.map((set) => oneRepMax(set)));
    anchorCount += anchors.length;

    for (const set of sets) {
      if (set.rir <= 0 || set.weightKg <= 0) continue;
      // 기준 능력치라면 이 중량으로 몇 회까지 갔어야 하는가
      const trueTotalReps = repsForIntensity(set.weightKg / anchor1RM);
      const impliedRir = trueTotalReps - set.reps;
      offsets.push(impliedRir - set.rir);
    }
  }

  const signals: string[] = [];
  const sampleSize = offsets.length;
  const spread = stddev(reported);

  // 늘 같은 숫자만 찍는 사람은 실제로 재고 있지 않다.
  if (reported.length >= 15 && spread < 0.4) {
    signals.push('모든 세트에 거의 같은 RIR을 입력하고 있습니다. 세트마다 실제 느낌을 다시 보세요');
  }

  if (sampleSize === 0 || anchorCount === 0) {
    const hasRecords = reported.length > 0;
    return {
      ...NO_CALIBRATION,
      sampleSize,
      signals,
      reliability: signals.length > 0 ? 0.8 : 1,
      note: hasRecords
        ? '기준으로 삼을 실패 세트가 없어 RIR 신고를 검증하지 못했습니다. ' +
          '가끔 한 세트를 실패 지점까지 가져가면 이후 처방이 정확해집니다.'
        : NO_CALIBRATION.note,
    };
  }

  const offset = clamp(round1(median(offsets)), -3, 1);
  const confidence = confidenceOf(anchorCount, sampleSize);
  const applied =
    CONFIDENCE_ORDER[confidence] >= CONFIDENCE_ORDER[options.minConfidence ?? DEFAULTS.minConfidence];

  if (offset <= -1) {
    signals.push(
      `실패 세트와 대조하면 실제보다 RIR을 평균 ${Math.abs(offset)} 정도 높게 신고하고 있습니다`,
    );
  } else if (offset >= 1) {
    signals.push('실제보다 RIR을 낮게 신고하는 편입니다. 아직 여유가 더 있습니다');
  }

  const reliability = clamp(
    round1((1 - Math.abs(offset) * 0.2) * (spread < 0.4 && reported.length >= 15 ? 0.85 : 1)),
    0.4,
    1,
  );

  return {
    sampleSize,
    anchorCount,
    offset,
    reliability,
    confidence,
    applied,
    signals,
    note: buildNote(offset, confidence, applied, anchorCount),
  };
}

function confidenceOf(anchorCount: number, sampleSize: number): RirCalibration['confidence'] {
  if (anchorCount >= 6 && sampleSize >= 30) return 'high';
  if (anchorCount >= 3 && sampleSize >= 12) return 'medium';
  return 'low';
}

function buildNote(
  offset: number,
  confidence: RirCalibration['confidence'],
  applied: boolean,
  anchorCount: number,
): string {
  if (!applied) {
    return `기준이 될 실패 세트가 ${anchorCount}개뿐이라 아직 보정하지 않습니다. ` +
      '가끔 실패 지점까지 가는 세트를 남기면 정확도가 올라갑니다.';
  }
  if (offset <= -0.5) {
    return `신고한 RIR에서 ${Math.abs(offset)}을(를) 빼서 계산합니다. ` +
      '중량을 과도하게 올리는 것을 막아 줍니다.';
  }
  if (offset >= 0.5) {
    return `신고한 RIR에 ${offset}을(를) 더해서 계산합니다. 실제로는 더 여유가 있습니다.`;
  }
  return `RIR 신고가 실제 수행과 잘 맞습니다 (신뢰도 ${confidence}).`;
}

/** 신고값에 보정을 적용한 RIR. */
export function correctedRir(reported: number, calibration: RirCalibration): number {
  if (!calibration.applied) return reported;
  return clamp(round1(reported + calibration.offset), 0, 5);
}

/** 세트 묶음에 보정을 적용한 사본. 원본은 건드리지 않는다. */
export function applyCalibration(
  sets: readonly SetLog[],
  calibration: RirCalibration,
): SetLog[] {
  if (!calibration.applied) return [...sets];
  return sets.map((set) => ({ ...set, rir: correctedRir(set.rir, calibration) }));
}

/** 세션 묶음 전체에 보정을 적용한 사본. */
export function calibrateSessions(
  sessions: readonly SessionLog[],
  calibration: RirCalibration,
): SessionLog[] {
  if (!calibration.applied) return [...sessions];
  return sessions.map((session) => ({
    ...session,
    sets: applyCalibration(session.sets, calibration),
  }));
}

/** 종목별로 따로 보고 싶을 때. 특정 종목만 RIR 감각이 나쁜 경우가 있다. */
export function calibrateByExercise(
  history: readonly SessionLog[],
  index: ReadonlyMap<string, Exercise>,
  options: RirCalibrationOptions = {},
): { exerciseId: string; name: string; calibration: RirCalibration }[] {
  const ids = new Set<string>();
  for (const session of history) for (const set of session.sets) ids.add(set.exerciseId);

  return [...ids]
    .map((exerciseId) => ({
      exerciseId,
      name: index.get(exerciseId)?.name ?? exerciseId,
      calibration: calibrateRir(
        history.map((session) => ({
          ...session,
          sets: session.sets.filter((set) => set.exerciseId === exerciseId),
        })),
        options,
      ),
    }))
    .filter((entry) => entry.calibration.anchorCount > 0);
}

/* ── 도우미 ─────────────────────────────────────────────── */

function latestDate(history: readonly SessionLog[]): string | undefined {
  let latest: string | undefined;
  for (const session of history) if (!latest || session.date > latest) latest = session.date;
  return latest;
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

function stddev(values: readonly number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
