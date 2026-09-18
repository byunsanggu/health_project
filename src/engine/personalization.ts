import { calibrateLandmarks, landmarksFor, MUSCLE_GROUPS, MUSCLE_LABELS_KO, type LandmarkOverride } from './muscles.ts';
import { oneRepMax } from './repmax.ts';
import { aggregateVolume, groupByWeek, type VolumeOptions } from './volume.ts';
import type { Exercise, LandmarksByMuscle, MuscleGroup, SessionLog, TrainingLevel } from './types.ts';

/**
 * 개인 볼륨 랜드마크 보정.
 *
 * 지금까지는 모두가 교과서 평균값을 썼다. 그런데 MEV·MAV·MRV는 개인차가
 * 가장 큰 값이다 — 같은 중급자라도 가슴 MRV가 16인 사람과 26인 사람이 있다.
 *
 * 정답은 알 수 없지만 관측은 할 수 있다.
 *   - 그 볼륨을 하고 다음 주 수행력이 떨어졌다면 → 그건 MRV 위였다
 *   - 그 볼륨을 하고 수행력이 유지·상승했다면 → MEV는 그보다 아래다
 *
 * 한 번의 관측으로 통째로 갈아엎지 않는다. 컨디션 나쁜 한 주가 그 사람의
 * MRV를 영구히 낮춰버리면 안 되므로 30%만 반영한다(calibrateLandmarks).
 */
export interface WeekPerformance {
  weekStart: string;
  /** 그 주의 주요 종목 추정 1RM 합 */
  score: number;
  /** 직전 주 대비 변화율 */
  change: number | null;
}

export interface LandmarkObservation {
  muscle: MuscleGroup;
  label: string;
  /** 관측된 개인 MRV (이 볼륨에서 회복에 실패했다) */
  observedMrv?: number;
  /** 관측된 개인 MEV (이 볼륨으로 성장했다) */
  observedMev?: number;
  mrvSamples: number;
  mevSamples: number;
  /** 기본값에서 얼마나 움직였는가 */
  mrvShift?: number;
  mevShift?: number;
  /** 관측이 실제로 랜드마크 숫자를 바꿨는가 (세트는 정수라 작은 관측은 반올림에 묻힌다) */
  moved: boolean;
  note: string;
}

export interface PersonalizationResult {
  landmarks: LandmarksByMuscle;
  observations: LandmarkObservation[];
  weeksOfData: number;
  /** 실제로 보정이 적용됐는가 */
  applied: boolean;
  note: string;
}

export interface PersonalizationInput {
  history: readonly SessionLog[];
  index: ReadonlyMap<string, Exercise>;
  level: TrainingLevel;
  /** 기준이 되는 랜드마크. 없으면 경력 기준값을 쓴다 */
  baseLandmarks?: LandmarksByMuscle;
  /** 이보다 적은 주차로는 보정하지 않는다 */
  minWeeks?: number;
  /** 한 부위에 이만큼 관측이 쌓여야 그 부위를 건드린다 */
  minSamples?: number;
  /** 회복 실패의 원인으로 지목할 부위 수 (부하가 큰 쪽부터) */
  blameLimit?: number;
  /** 수행력이 이 비율 이상 떨어지면 회복 실패로 본다 */
  dropThreshold?: number;
  /** 보정 반영 비율 */
  weight?: number;
  volumeOptions?: VolumeOptions;
}

const DEFAULTS = {
  minWeeks: 8,
  minSamples: 2,
  dropThreshold: 0.02,
  weight: 0.3,
  blameLimit: 2,
};

/** 주별 수행력 — 그 주에 나온 추정 1RM을 종목별 최고치로 합산한다. */
export function weeklyPerformance(
  history: readonly SessionLog[],
  options: VolumeOptions = {},
): WeekPerformance[] {
  const offset = options.rirOffset ?? 0;
  const weeks = groupByWeek(history);
  const out: WeekPerformance[] = [];

  for (const [weekStart, sessions] of weeks) {
    const best = new Map<string, number>();
    for (const session of sessions) {
      for (const set of session.sets) {
        if (set.warmup || set.reps <= 0 || set.weightKg <= 0) continue;
        const value = oneRepMax({ ...set, rir: clamp(set.rir + offset, 0, 5) });
        const previous = best.get(set.exerciseId);
        if (previous === undefined || value > previous) best.set(set.exerciseId, value);
      }
    }
    const score = [...best.values()].reduce((sum, value) => sum + value, 0);
    out.push({ weekStart, score, change: null });
  }

  for (let i = 1; i < out.length; i += 1) {
    const previous = out[i - 1]!.score;
    // 종목 구성이 크게 달라진 주는 비교가 무의미하다.
    out[i]!.change = previous > 0 ? (out[i]!.score - previous) / previous : null;
  }

  return out;
}

/**
 * 이력에서 개인 랜드마크를 관측해 보정한다.
 *
 * 관측 논리:
 *   다음 주 수행력이 떨어진 주의 볼륨  →  그 볼륨은 MRV 위였다
 *   다음 주 수행력이 유지·상승한 주 중 가장 낮은 볼륨  →  MEV는 그 아래다
 */
export function personalizeLandmarks(input: PersonalizationInput): PersonalizationResult {
  const config = { ...DEFAULTS, ...input };
  const base = input.baseLandmarks ?? landmarksFor(input.level);
  const weeks = [...groupByWeek(input.history)];
  const performance = weeklyPerformance(input.history, input.volumeOptions);

  if (weeks.length < config.minWeeks) {
    return {
      landmarks: base,
      observations: [],
      weeksOfData: weeks.length,
      applied: false,
      note: `개인 보정에는 ${config.minWeeks}주 이상의 기록이 필요합니다. ` +
        `지금은 ${weeks.length}주 · 그때까지는 ${levelLabel(input.level)} 기준값을 씁니다.`,
    };
  }

  // 주별 부위 볼륨과 "다음 주에 회복했는가"를 짝짓는다.
  const failingByMuscle = new Map<MuscleGroup, number[]>();
  const growingByMuscle = new Map<MuscleGroup, number[]>();

  weeks.forEach(([weekStart, sessions], i) => {
    const next = performance[i + 1];
    if (!next || next.change === null) return;

    const recovered = next.change >= -config.dropThreshold;
    const volume = aggregateVolume(sessions, input.index, input.volumeOptions);

    if (recovered) {
      for (const muscle of MUSCLE_GROUPS) {
        const sets = volume[muscle].effectiveSets;
        // 볼륨이 너무 낮으면 "이 볼륨으로 성장했다"의 근거가 되지 못한다.
        // 다른 부위 훈련의 간접 효과일 가능성이 크다.
        if (sets < evidenceFloor(base[muscle])) continue;
        push(growingByMuscle, muscle, sets);
      }
      void weekStart;
      return;
    }

    // 회복에 실패한 주의 책임을 모든 부위에 똑같이 물리면 안 된다.
    // 가슴을 20세트 하고 무너졌는데 1세트 한 삼두의 MRV를 내리는 건 틀렸다.
    // 그래서 그 주에 랜드마크 대비 부하가 가장 컸던 부위만 원인으로 지목한다.
    const suspects = MUSCLE_GROUPS
      .map((muscle) => ({ muscle, sets: volume[muscle].effectiveSets }))
      .filter((entry) => entry.sets >= blameFloor(base[entry.muscle]))
      .map((entry) => ({ ...entry, ratio: entry.sets / base[entry.muscle].mrv }))
      .sort((a, b) => b.ratio - a.ratio)
      .slice(0, config.blameLimit);

    for (const suspect of suspects) push(failingByMuscle, suspect.muscle, suspect.sets);
    void weekStart;
  });

  const observations: LandmarkObservation[] = [];
  const overrides: LandmarkOverride[] = [];

  for (const muscle of MUSCLE_GROUPS) {
    const failing = failingByMuscle.get(muscle) ?? [];
    const growing = growingByMuscle.get(muscle) ?? [];
    if (failing.length === 0 && growing.length === 0) continue;

    const observation: LandmarkObservation = {
      muscle,
      label: MUSCLE_LABELS_KO[muscle],
      mrvSamples: failing.length,
      mevSamples: growing.length,
      moved: false,
      note: '',
    };
    const override: LandmarkOverride = { muscle };

    /*
     * 관측은 부등식이지 등식이 아니다. 여기서 한 번 틀린 적이 있다 —
     * "12세트 하고 성장했다"를 "MEV는 12다"로 읽으면, 잘 회복한 사람일수록
     * 최소 자극선이 올라가는 거꾸로 된 결과가 나온다. 실제로 말해주는 건
     * "MEV는 12 이하"뿐이다. 그래서 세 방향만 인정한다.
     *
     *   회복 실패 V  →  MRV < V     V가 지금 MRV보다 낮을 때만 MRV를 내린다
     *   회복 성공 V  →  MRV ≥ V     V가 지금 MRV보다 높을 때만 MRV를 올린다
     *   성장     V  →  MEV ≤ V     V가 지금 MEV보다 낮을 때만 MEV를 내린다
     *
     * MEV를 올리려면 "이 볼륨으로는 자라지 않았다"는 반대 증거가 필요한데
     * 지금 기록으로는 자극 부족과 컨디션을 구분할 수 없다. 그래서 올리지 않는다.
     */
    const lowestFailure = failing.length >= config.minSamples ? Math.min(...failing) : undefined;
    const highestSuccess = growing.length >= config.minSamples ? Math.max(...growing) : undefined;
    const lowestSuccess = growing.length >= config.minSamples ? Math.min(...growing) : undefined;

    if (lowestFailure !== undefined && lowestFailure < base[muscle].mrv) {
      observation.observedMrv = round1(lowestFailure);
      observation.mrvShift = round1(lowestFailure - base[muscle].mrv);
      override.observedMrv = lowestFailure;
    } else if (
      highestSuccess !== undefined &&
      highestSuccess > base[muscle].mrv &&
      (lowestFailure === undefined || highestSuccess < lowestFailure)
    ) {
      observation.observedMrv = round1(highestSuccess);
      observation.mrvShift = round1(highestSuccess - base[muscle].mrv);
      override.observedMrv = highestSuccess;
    }

    if (lowestSuccess !== undefined && lowestSuccess < base[muscle].mev) {
      observation.observedMev = round1(lowestSuccess);
      observation.mevShift = round1(lowestSuccess - base[muscle].mev);
      override.observedMev = lowestSuccess;
    }

    observation.note = describeObservation(observation);
    observations.push(observation);
    if (override.observedMrv !== undefined || override.observedMev !== undefined) {
      overrides.push(override);
    }
  }

  // 관측 횟수만큼 무게가 다르다. 부위마다 따로 섞는다.
  let landmarks = base;
  for (const override of overrides) {
    const observation = observations.find((item) => item.muscle === override.muscle)!;
    const samples = override.observedMrv !== undefined ? observation.mrvSamples : observation.mevSamples;
    landmarks = calibrateLandmarks(landmarks, [override], blendWeight(config.weight, samples, config.minSamples));
  }

  /*
   * 세트는 정수다. 관측이 기본값에 가까우면 30%를 섞어도 반올림에 묻혀
   * 숫자가 그대로 남는다. 그때 "개인값으로 옮겼습니다"라고 말하면 거짓말이
   * 되므로, 실제로 바뀐 부위만 옮겼다고 센다.
   */
  let moved = 0;
  for (const observation of observations) {
    const before = base[observation.muscle];
    const after = landmarks[observation.muscle];
    observation.moved = after.mev !== before.mev || after.mrv !== before.mrv;
    if (observation.moved) moved += 1;
  }

  return {
    landmarks,
    observations,
    weeksOfData: weeks.length,
    applied: moved > 0,
    note: moved > 0
      ? `${weeks.length}주 기록에서 ${moved}개 부위의 랜드마크를 개인값으로 옮겼습니다. ` +
        '한 번에 전부 바꾸지 않고 관측이 쌓인 만큼만 움직입니다.'
      : observations.length > 0
        ? `${weeks.length}주 기록에 관측은 있지만, 아직 기본값을 움직일 만큼은 아닙니다.`
        : `${weeks.length}주 기록이 있지만 부위별 관측이 아직 ${config.minSamples}회에 못 미칩니다.`,
  };
}

/**
 * 관측 2회와 7회를 같은 무게로 반영할 수는 없다.
 * 다만 한 사람의 기록으로 교과서 값을 통째로 대체하지도 않는다 — 60%에서 멈춘다.
 */
function blendWeight(base: number, samples: number, minSamples: number): number {
  return Math.min(0.6, base * Math.sqrt(Math.max(1, samples) / Math.max(1, minSamples)));
}

/**
 * 관측이 근거가 되기 위한 최소 볼륨.
 *
 * MEV가 0인 부위(전면 삼각근·복근)는 간접 볼륨만으로도 충분해서 MEV 기준이
 * 무력하다. 그래서 MAV를 기준으로 한 절대 하한을 함께 둔다 — 1세트 한 부위를
 * 두고 "이 볼륨으로 성장했다"거나 "이 볼륨에서 무너졌다"고 말할 수는 없다.
 */
function evidenceFloor(landmark: { mev: number; mav: number }): number {
  return Math.max(2, landmark.mev * 0.5, landmark.mav * 0.35);
}

/** 회복 실패의 원인으로 지목하려면 그 부위가 실제로 부하를 받았어야 한다. */
function blameFloor(landmark: { mev: number; mav: number }): number {
  return Math.max(4, landmark.mev, landmark.mav * 0.5);
}

function push(map: Map<MuscleGroup, number[]>, muscle: MuscleGroup, value: number): void {
  const list = map.get(muscle) ?? [];
  list.push(value);
  map.set(muscle, list);
}

function describeObservation(observation: LandmarkObservation): string {
  const parts: string[] = [];

  if (observation.observedMrv !== undefined) {
    // 내려간 건 회복 실패가, 올라간 건 회복 성공이 근거다. 둘을 같은 문장으로 쓰면 안 된다.
    parts.push((observation.mrvShift ?? 0) < 0
      ? `${observation.observedMrv}세트에서 회복에 실패한 적이 ${observation.mrvSamples}번 있습니다 — ` +
        '회복 한계가 기본값보다 낮습니다'
      : `${observation.observedMrv}세트를 하고도 다음 주 수행력이 유지됐습니다 — ` +
        '회복 한계가 기본값보다 높습니다');
  }
  if (observation.observedMev !== undefined) {
    parts.push(`${observation.observedMev}세트로도 수행력이 유지됐습니다 — 최소 자극선은 그보다 아래입니다`);
  }
  if (parts.length === 0) {
    parts.push(`관측 ${observation.mrvSamples + observation.mevSamples}회 — 보정에는 아직 모자랍니다`);
  }
  return parts.join(' · ');
}

function levelLabel(level: TrainingLevel): string {
  return { beginner: '초보', intermediate: '중급', advanced: '고급', expert: '전문가' }[level];
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
