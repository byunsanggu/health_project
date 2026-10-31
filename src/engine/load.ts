import type { Exercise, SetLog } from './types.ts';

export interface RepRange {
  min: number;
  max: number;
}

export interface LoadRule {
  repRange: RepRange;
  /** 이 종목에서 남겨야 할 RIR. 축적기에는 1~3, 디로드에는 4를 쓴다. */
  targetRir: number;
  /**
   * 신고 RIR에 더할 보정값.
   * 실제보다 RIR을 높게 부르는 사람에게 그대로 증량하면 실패 지점을 넘긴다.
   */
  rirOffset?: number;
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

/** 증량 단위로 내림 — 낮출 때 반올림하면 10kg × 0.9 = 9가 다시 10이 된다. */
export function floorToIncrement(weightKg: number, increment: number): number {
  if (increment <= 0) return round1(weightKg);
  return round1(Math.floor(weightKg / increment + 1e-9) * increment);
}

/**
 * 낮춘 무게. 10% 내리되 증량 단위로 내림하고, 적어도 한 칸은 내린다. 맨몸에 더한 무게는
 * 0(맨몸)까지, 나머지는 가장 가벼운 한 칸 밑으로는 안 내린다.
 */
function lowered(exercise: Exercise, weightKg: number): number {
  const step = exercise.increment;
  if (step <= 0) return round1(weightKg * 0.9);
  const floor = exercise.equipment === 'bodyweight' ? 0 : step;
  const reduced = Math.min(floorToIncrement(weightKg * 0.9, step), round1(weightKg - step));
  return Math.max(floor, reduced);
}

/** 한 번에 올리는 폭 — 두 칸은 무게의 10% 안쪽일 때만. 6kg 덤벨이 한 번에 10kg이 되지 않게. */
function jumpFor(exercise: Exercise, weightKg: number, surplus: number): number {
  const step = exercise.increment;
  if (surplus >= 2 && step * 2 <= weightKg * 0.1) return step * 2;
  return step;
}

/**
 * 이중 진행(double progression) + RIR 보정으로 다음 중량을 처방한다.
 *
 * 순서가 중요하다. 반복 상단에 닿았어도 RIR이 목표보다 모자라면 올리지 않는다 —
 * 이걸 무시하고 올리다가 4~6주차에 정체와 통증이 몰린다.
 *
 * 그 무게로 한 세트를 전부 본다. 첫 세트만 보면 "10회 · 여유 3 → 9회 · 1 → 8회 · 0"처럼
 * 뒤 세트에서 무너진 것을 놓치고 두 칸을 올린다. 상단은 모든 세트가 채워야, 여유는 가장
 * 빠듯했던 세트 기준이다. 낮출지는 가장 잘된 세트로 본다 — 마지막 세트 하나 무너졌다고
 * 무게를 깎지는 않는다.
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

  // 주 1회 무거운 세트(1~3회)는 근거에서 뺀다 — 그날의 처방 범위는 백오프 세트다
  const regular = (lastSession ?? []).filter((set) => !set.top);
  const attempts = regular.filter((set) => set.exerciseId === exercise.id && !set.warmup);
  const last = lastSession ? topWorkingSet(regular, exercise.id) : undefined;
  if (!last) {
    // 했는데 한 개도 못 했다 — 처음이 아니라 실패다. 처음으로 되돌리면 같은 무게를 또 권한다
    const tried = attempts.filter((set) => set.reps <= 0).sort((a, b) => b.weightKg - a.weightKg)[0];
    if (tried) return failedOutright(exercise, tried, rule, base);
    return {
      ...base,
      weightKg: null,
      change: 'start',
      deltaKg: 0,
      reason: `첫 수행입니다. ${rule.repRange.min}~${rule.repRange.max}회를 하고도 ${rule.targetRir}개쯤 더 할 수 있는 무게로 시작하세요.`,
    };
  }

  const step = exercise.increment;
  const atTop = attempts.filter((set) => set.reps > 0 && set.weightKg === last.weightKg);
  const fewestReps = Math.min(...atTop.map((set) => set.reps));
  const tightest = atTop.reduce((worst, set) => (set.rir < worst.rir ? set : worst), atTop[0]!);
  const observedRir = correctRir(tightest.rir, rule.rirOffset);
  const reachedTop = fewestReps >= rule.repRange.max;
  const belowBottom = last.reps < rule.repRange.min;
  const rirSurplus = observedRir - rule.targetRir;
  const sets = atTop.length > 1 ? `${atTop.length}세트 모두 ` : '';

  // 0) 무게를 더할 수 없는 맨몸 종목(푸시업 · 파이크 푸시업 · 인버티드 로우)이 가벼워졌다 — "0kg 올립니다"가 아니라 더 어렵게
  if (step <= 0 && last.weightKg <= 0 && reachedTop && rirSurplus >= 0) {
    return bodyweightHarder(exercise, rule, base);
  }
  // 범위 상단은 못 채웠는데 여유가 많았다 — 더 어렵게 바꾸기 전에 횟수부터 채운다("0kg 올립니다"도 아니다)
  if (step <= 0 && last.weightKg <= 0 && rirSurplus >= 2) {
    const aim = Math.min(rule.repRange.max, Math.max(rule.repRange.min, fewestReps + 2));
    return {
      ...base,
      weightKg: last.weightKg,
      targetReps: { min: aim, max: rule.repRange.max },
      change: 'hold',
      deltaKg: 0,
      reason: `여유가 ${describeRir(tightest.rir, observedRir)} 남았습니다. 다음에는 ${aim}회까지 해 보세요.`,
    };
  }

  // 1) 모든 세트가 반복 상단 + 가장 빠듯한 세트도 여유 → 증량. 여유가 2 이상이면 두 칸(무게의 10% 안).
  if (reachedTop && rirSurplus >= 0) {
    const jump = jumpFor(exercise, last.weightKg, rirSurplus);
    return {
      ...base,
      weightKg: roundToIncrement(last.weightKg + jump, step),
      change: 'increase',
      deltaKg: round1(jump),
      reason: `${sets}${rule.repRange.max}회를 채우고 여유도 ${describeRir(tightest.rir, observedRir)} 남았습니다. ${round1(jump)}kg 올립니다.`,
    };
  }

  // 2) 반복은 채웠지만 실패 직전이었다 → 같은 중량에서 RIR부터 확보.
  if (reachedTop) {
    return {
      ...base,
      weightKg: last.weightKg,
      change: 'hold',
      deltaKg: 0,
      reason: `목표 반복은 채웠지만 여유가 ${describeRir(tightest.rir, observedRir)}뿐인 세트가 있었습니다. 같은 무게로 여유가 ${rule.targetRir}개 남을 때까지 유지합니다.`,
    };
  }

  // 3) 반복은 덜 됐는데 모든 세트가 너무 가볍다 → 중량을 올려 자극 구간으로 옮긴다.
  if (rirSurplus >= 2) {
    return {
      ...base,
      weightKg: roundToIncrement(last.weightKg + step, step),
      change: 'increase',
      deltaKg: round1(step),
      reason: `여유 ${describeRir(tightest.rir, observedRir)}로 목표(${rule.targetRir}개)보다 가벼웠습니다. ${round1(step)}kg 올립니다.`,
    };
  }

  // 4) 가장 잘된 세트도 목표 반복 하단에 못 미쳤다 → 감량해 수행 품질을 되찾는다.
  if (belowBottom) {
    // 맨몸으로 못 채웠으면 낮출 무게가 없다 — 되는 만큼 하고 보조를 권한다
    if (exercise.equipment === 'bodyweight' && last.weightKg <= 0) return bodyweightShort(exercise, last.reps, rule, base);
    const reduced = lowered(exercise, last.weightKg);
    return {
      ...base,
      weightKg: reduced,
      change: 'decrease',
      deltaKg: round1(reduced - last.weightKg),
      reason: `${last.reps}회로 목표 하단(${rule.repRange.min}회)에 못 미쳤습니다. ${round1(last.weightKg - reduced)}kg 낮춰 반복 수부터 회복합니다.`,
    };
  }

  // 5) 범위 안 → 중량 유지하고 반복을 1회 늘린다(가장 적게 한 세트 기준).
  const aim = Math.min(fewestReps + 1, rule.repRange.max);
  return {
    ...base,
    weightKg: last.weightKg,
    targetReps: { min: aim, max: rule.repRange.max },
    change: 'hold',
    deltaKg: 0,
    reason: `같은 중량으로 ${aim}회를 노립니다.`,
  };
}

type PrescriptionBase = Pick<LoadPrescription, 'exerciseId' | 'targetReps' | 'targetRir'>;

/** 한 개도 못 한 세션 — 낮추거나, 맨몸이면 되는 만큼 + 보조. */
function failedOutright(exercise: Exercise, tried: SetLog, rule: LoadRule, base: PrescriptionBase): LoadPrescription {
  if (exercise.equipment === 'bodyweight' && tried.weightKg <= 0) return bodyweightShort(exercise, 0, rule, base);
  const reduced = lowered(exercise, tried.weightKg);
  return {
    ...base,
    weightKg: reduced,
    change: 'decrease',
    deltaKg: round1(reduced - tried.weightKg),
    reason: `지난번 ${tried.weightKg}kg로 한 개도 못 했습니다. ${round1(tried.weightKg - reduced)}kg 낮춰 다시 시작합니다.`,
  };
}

/** 맨몸으로 목표 하단을 못 채웠다 — 무게로는 더 낮출 수 없다. */
/** 맨몸 종목을 더 어렵게 하는 법 — 무게 대신. */
const HARDER: Record<string, string> = {
  'push-up': '발을 의자나 벤치에 올린 푸시업',
  'pike-push-up': '발을 상자에 올린 파이크 푸시업',
  'inverted-row': '발을 앞으로 더 빼서(몸을 더 눕혀) 하는 인버티드 로우',
  'chest-dip': '원판이나 덤벨을 다리 사이에 끼운 딥스',
  'triceps-dip': '발을 벤치에 올린 딥스',
};

function bodyweightHarder(exercise: Exercise, rule: LoadRule, base: PrescriptionBase): LoadPrescription {
  const harder = HARDER[exercise.id];
  return {
    ...base,
    weightKg: 0,
    change: 'hold',
    deltaKg: 0,
    reason: `${rule.repRange.max}회를 채우고도 여유가 남았습니다. 맨몸이라 무게를 더할 수 없으니 더 어렵게 하세요 — ` +
      (harder ? `${harder}, ` : '') + '내려갈 때 3초 천천히, 또는 조끼 · 배낭에 무게를 넣어서. 계속 쉬우면 무게를 싣는 종목으로 바꾸는 게 낫습니다.',
  };
}

function bodyweightShort(exercise: Exercise, reps: number, rule: LoadRule, base: PrescriptionBase): LoadPrescription {
  const aim = Math.max(1, reps);
  return {
    ...base,
    weightKg: 0,
    targetReps: { min: aim, max: rule.repRange.max },
    change: 'hold',
    deltaKg: 0,
    reason: reps > 0
      ? `맨몸으로 ${reps}회 — 목표 하단(${rule.repRange.min}회)에 못 미쳤습니다. 되는 만큼 하고, 보조 기계나 밴드가 있으면 그쪽(어시스트)으로 바꾸는 게 낫습니다.`
      : `맨몸으로 한 개가 안 됩니다. 보조 기계나 밴드로 하거나, 위에서 천천히 내려오는 동작(네거티브)으로 시작하세요.`,
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
  const observedRir = correctRir(lastSet.rir, rule.rirOffset);
  const surplus = observedRir - rule.targetRir;
  // 다섯 개 넘게 남았으면(RIR 5) 목표가 4여도 가벼운 것이다 — RIR은 5에서 끊기므로 차이가 1로 보일 뿐
  const light = surplus >= 2 || (observedRir >= 5 && surplus >= 1);

  // 무게를 더할 수 없는 맨몸 종목은 세트 사이에 바꿀 무게가 없다
  if (light && lastSet.reps >= rule.repRange.min && step <= 0) {
    return { weightKg: lastSet.weightKg, deltaKg: 0, reason: '' };
  }
  if (light && lastSet.reps >= rule.repRange.min) {
    const jump = step * (surplus >= 3 ? 2 : 1);
    return {
      weightKg: roundToIncrement(lastSet.weightKg + jump, step),
      deltaKg: round1(jump),
      reason: `여유 ${describeRir(lastSet.rir, observedRir)}로 넉넉합니다. 다음 세트 ${round1(jump)}kg 올립니다.`,
    };
  }

  if (observedRir <= 0 && lastSet.reps < rule.repRange.min) {
    const reduced = lowered(exercise, lastSet.weightKg);
    if (reduced >= lastSet.weightKg) {
      return {
        weightKg: lastSet.weightKg,
        deltaKg: 0,
        reason: '더 낮출 무게가 없습니다. 다음 세트는 되는 만큼만 하세요.',
      };
    }
    return {
      weightKg: reduced,
      deltaKg: round1(reduced - lastSet.weightKg),
      reason: `더는 못 드는 지점에서 목표 반복을 못 채웠습니다. 다음 세트 ${round1(lastSet.weightKg - reduced)}kg 낮춥니다.`,
    };
  }

  return {
    weightKg: lastSet.weightKg,
    deltaKg: 0,
    reason: '무게를 유지합니다.',
  };
}

function correctRir(reported: number, offset = 0): number {
  return Math.min(5, Math.max(0, reported + offset));
}

/** 보정이 들어갔으면 사용자에게 그 사실을 숨기지 않는다. */
/** "2개" — 보정이 들어갔으면 "3개(보정하면 2개)". 화면에 "RIR"이라는 말은 쓰지 않는다. */
function describeRir(reported: number, corrected: number): string {
  return reported === corrected ? `${reported}개` : `${reported}개(보정하면 ${round1(corrected)}개)`;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
