/**
 * 반복 수 · RIR ↔ 1RM 대비 강도.
 *
 * Epley 식(w × (1 + reps/30))은 선형이라 고반복 구간에서 능력을 과대 추정한다.
 * 8회 실패한 사람의 1RM을 계산하면 맞지만, 거기서 다시 15회 가능한 중량을
 * 역산하면 실제보다 무겁게 나온다. RIR 보정처럼 서로 다른 반복 구간을
 * 비교해야 하는 계산에서는 이 오차가 그대로 편향이 된다.
 *
 * 그래서 현장에서 쓰이는 RPE/반복 대비 %1RM 표를 쓴다. 표 사이는 선형 보간한다.
 */
const INTENSITY_BY_REPS: readonly number[] = [
  1,      // 0회 (사용 안 함)
  1,      // 1
  0.955,  // 2
  0.922,  // 3
  0.892,  // 4
  0.863,  // 5
  0.837,  // 6
  0.811,  // 7
  0.786,  // 8
  0.762,  // 9
  0.74,   // 10
  0.717,  // 11
  0.694,  // 12
  0.675,  // 13
  0.656,  // 14
  0.638,  // 15
  0.62,   // 16
  0.603,  // 17
  0.586,  // 18
  0.57,   // 19
  0.554,  // 20
];

const MAX_REPS = INTENSITY_BY_REPS.length - 1;
/** 20회를 넘어가면 표 밖이라 완만하게 이어 붙인다. */
const TAIL_SLOPE = 0.013;

/** 실패까지 n회 갈 수 있는 중량은 1RM의 몇 %인가. */
export function intensityForReps(reps: number): number {
  if (reps <= 1) return 1;
  if (reps <= MAX_REPS) {
    const low = Math.floor(reps);
    const high = Math.min(MAX_REPS, low + 1);
    const fraction = reps - low;
    return INTENSITY_BY_REPS[low]! + (INTENSITY_BY_REPS[high]! - INTENSITY_BY_REPS[low]!) * fraction;
  }
  return Math.max(0.3, INTENSITY_BY_REPS[MAX_REPS]! - (reps - MAX_REPS) * TAIL_SLOPE);
}

/** 그 강도로는 실패까지 몇 회 갈 수 있는가 (intensityForReps 의 역함수). */
export function repsForIntensity(intensity: number): number {
  if (intensity >= 1) return 1;
  if (intensity <= INTENSITY_BY_REPS[MAX_REPS]!) {
    return MAX_REPS + (INTENSITY_BY_REPS[MAX_REPS]! - intensity) / TAIL_SLOPE;
  }

  for (let reps = 1; reps < MAX_REPS; reps += 1) {
    const high = INTENSITY_BY_REPS[reps]!;
    const low = INTENSITY_BY_REPS[reps + 1]!;
    if (intensity <= high && intensity >= low) {
      return reps + (high - intensity) / (high - low);
    }
  }
  return MAX_REPS;
}

/**
 * 표 기반 1RM 추정. RIR을 반복 수에 더해 실패 지점으로 환산한다.
 * 서로 다른 반복 구간을 비교해야 할 때는 estimate1RM(Epley) 대신 이걸 쓴다.
 */
export function oneRepMax(set: { weightKg: number; reps: number; rir: number }): number {
  const totalReps = set.reps + Math.max(0, set.rir);
  return set.weightKg / intensityForReps(totalReps);
}

/** 1RM에서 목표 반복 · RIR에 맞는 작업 중량. */
export function workingWeight(oneRepMaxKg: number, reps: number, rir: number): number {
  return oneRepMaxKg * intensityForReps(reps + Math.max(0, rir));
}
