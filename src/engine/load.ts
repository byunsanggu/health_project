import type { Exercise, SetLog } from './types.ts';

export interface RepRange {
  min: number;
  max: number;
}

export interface LoadRule {
  repRange: RepRange;
  /** 이 종목에서 남겨야 할 RIR. 축적기에는 1~3, 디로드에는 4를 쓴다. */
  targetRir: number;
}

export type LoadChange = 'start' | 'increase' | 'hold' | 'decrease';

export interface LoadPrescription {
  exerciseId: string;
  /** 다음 세션에 쓸 중량. 첫 수행이면 null(사용자 입력 필요). */
  weightKg: number | null;
  targetReps: RepRange;
  targetRir: number;
  change: LoadChange;
  deltaKg: number;
  /** 사용자에게 그대로 보여줄 한 줄 근거. */
  reason: string;
}

/**
 * Epley 식에 RIR을 더해 추정 1RM을 낸다.
 * 실패까지 갔다고 가정하지 않으므로 reps + rir 을 실제 수행 가능 반복으로 본다.
 */
export function estimate1RM(set: Pick<SetLog, 'weightKg' | 'reps' | 'rir'>): number {
  const totalReps = set.reps + Math.max(0, set.rir);
  if (totalReps <= 1) return set.weightKg;
  return round1(set.weightKg * (1 + totalReps / 30));
}

/** 증량 단위에 맞춰 반올림한다. 맨몸(increment 0)은 그대로 둔다. */
export function roundToIncrement(weightKg: number, increment: number): number {
  if (increment <= 0) return round1(weightKg);
  return round1(Math.round(weightKg / increment) * increment);
}

/** 그 세션에서 가장 무겁게 든 본세트 — 같은 중량이면 반복이 가장 많았던 세트. */
export function topWorkingSet(sets: readonly SetLog[], exerciseId: string): SetLog | undefined {
  const working = sets.filter((set) => set.exerciseId === exerciseId && !set.warmup && set.reps > 0);
  if (working.length === 0) return undefined;

  return working.reduce((best, set) => {
    if (set.weightKg > best.weightKg) return set;
    if (set.weightKg === best.weightKg && set.reps > best.reps) return set;
    return best;
  });
}

/**
 * 이중 진행(double progression) + RIR 보정으로 다음 중량을 처방한다.
 *
 * 순서가 중요하다. 반복 상단에 닿았어도 RIR이 목표보다 모자라면 올리지 않는다 —
 * 이걸 무시하고 올리다가 4~6주차에 정체와 통증이 몰린다.
 *
 * @param lastSession 그 종목을 마지막으로 수행한 세션의 세트들
 */
export function prescribeLoad(
  exercise: Exercise,
  lastSession: readonly SetLog[] | undefined,
  rule: LoadRule,
): LoadPrescription {
  const base = {
    exerciseId: exercise.id,
    targetReps: rule.repRange,
    targetRir: rule.targetRir,
  };

  const last = lastSession ? topWorkingSet(lastSession, exercise.id) : undefined;
  if (!last) {
    return {
      ...base,
      weightKg: null,
      change: 'start',
      deltaKg: 0,
      reason: `첫 수행입니다. ${rule.repRange.min}~${rule.repRange.max}회를 RIR ${rule.targetRir}로 마칠 수 있는 중량으로 시작하세요.`,
    };
  }

  const step = exercise.increment;
  const reachedTop = last.reps >= rule.repRange.max;
  const belowBottom = last.reps < rule.repRange.min;
  const rirSurplus = last.rir - rule.targetRir;

  // 1) 반복 상단 + RIR 여유 → 증량. 여유가 2 이상이면 두 칸.
  if (reachedTop && rirSurplus >= 0) {
    const jump = rirSurplus >= 2 ? step * 2 : step;
    return {
      ...base,
      weightKg: roundToIncrement(last.weightKg + jump, step),
      change: 'increase',
      deltaKg: round1(jump),
      reason: `${last.reps}회 × RIR ${last.rir}로 목표 상단에 여유 있게 도달했습니다. ${round1(jump)}kg 올립니다.`,
    };
  }

  // 2) 반복은 채웠지만 실패 직전이었다 → 같은 중량에서 RIR부터 확보.
  if (reachedTop) {
    return {
      ...base,
      weightKg: last.weightKg,
      change: 'hold',
      deltaKg: 0,
      reason: `목표 반복은 채웠지만 RIR ${last.rir}로 여유가 없었습니다. 같은 중량에서 RIR ${rule.targetRir}이 될 때까지 유지합니다.`,
    };
  }

  // 3) 반복은 덜 됐는데 너무 가볍다 → 중량을 올려 자극 구간으로 옮긴다.
  if (rirSurplus >= 2) {
    return {
      ...base,
      weightKg: roundToIncrement(last.weightKg + step, step),
      change: 'increase',
      deltaKg: round1(step),
      reason: `RIR ${last.rir}로 목표(${rule.targetRir})보다 가벼웠습니다. ${round1(step)}kg 올립니다.`,
    };
  }

  // 4) 목표 반복 하단에도 못 미쳤다 → 감량해 수행 품질을 되찾는다.
  if (belowBottom) {
    const reduced = roundToIncrement(last.weightKg * 0.9, step);
    return {
      ...base,
      weightKg: reduced,
      change: 'decrease',
      deltaKg: round1(reduced - last.weightKg),
      reason: `${last.reps}회로 목표 하단(${rule.repRange.min}회)에 못 미쳤습니다. 10% 낮춰 반복 수부터 회복합니다.`,
    };
  }

  // 5) 범위 안 → 중량 유지하고 반복을 1회 늘린다.
  return {
    ...base,
    weightKg: last.weightKg,
    targetReps: { min: Math.min(last.reps + 1, rule.repRange.max), max: rule.repRange.max },
    change: 'hold',
    deltaKg: 0,
    reason: `같은 중량으로 ${Math.min(last.reps + 1, rule.repRange.max)}회를 노립니다.`,
  };
}

export interface WithinSessionAdjustment {
  weightKg: number;
  deltaKg: number;
  reason: string;
}

/**
 * 세트 사이 즉시 보정.
 * 방금 끝낸 세트의 RIR을 받아 다음 세트 중량을 바꾼다.
 */
export function adjustWithinSession(
  exercise: Exercise,
  lastSet: SetLog,
  rule: LoadRule,
): WithinSessionAdjustment {
  const step = exercise.increment;
  const surplus = lastSet.rir - rule.targetRir;

  if (surplus >= 2 && lastSet.reps >= rule.repRange.min) {
    const jump = step * (surplus >= 3 ? 2 : 1);
    return {
      weightKg: roundToIncrement(lastSet.weightKg + jump, step),
      deltaKg: round1(jump),
      reason: `RIR ${lastSet.rir}로 여유가 많습니다. 다음 세트 ${round1(jump)}kg 올립니다.`,
    };
  }

  if (lastSet.rir <= 0 && lastSet.reps < rule.repRange.min) {
    const reduced = roundToIncrement(lastSet.weightKg * 0.9, step);
    return {
      weightKg: reduced,
      deltaKg: round1(reduced - lastSet.weightKg),
      reason: `실패 지점에서 목표 반복을 못 채웠습니다. 다음 세트 10% 낮춥니다.`,
    };
  }

  return {
    weightKg: lastSet.weightKg,
    deltaKg: 0,
    reason: '중량 유지합니다.',
  };
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
