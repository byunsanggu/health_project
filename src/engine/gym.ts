import type { Equipment, Exercise } from './types.ts';

/**
 * 기구가 실제로 만들 수 있는 중량.
 *
 * 엔진이 "82.5kg"을 처방해도 그 헬스장 머신이 5kg 스택이면 80이나 85밖에 안 된다.
 * 바 무게도 20kg가 아닐 수 있고(여성용 15, EZ바 10, 스미스머신은 제각각),
 * 핵스쿼트는 캐리지 자체가 이미 무겁다. 그래서 중량 처방의 마지막 단계는
 * 종목별 고정 단위가 아니라 이 명세를 거쳐야 한다.
 */
export type LoadingSpec =
  | BarbellLoading
  | DumbbellLoading
  | StackLoading
  | PlateLoadedLoading
  | BodyweightLoading;

export interface BarbellLoading {
  kind: 'barbell';
  /** 빈 바 무게. 올림픽 20, 여성용 15, EZ바 10, 스미스머신은 실측 필요 */
  barKg: number;
  /** 보유한 플레이트 종류 (한쪽 기준) */
  plates: number[];
  /** 종류별 한쪽당 보유 개수. 없으면 넉넉하다고 본다 */
  plateCounts?: Record<number, number>;
  /** 조임쇠 한쪽 무게 */
  collarKg?: number;
  /** 현실적인 상한. 이론상 조합이 아니라 실제로 쓰는 범위를 넘지 않게 한다 */
  maxTotalKg?: number;
}

export interface DumbbellLoading {
  kind: 'dumbbell';
  /** 보유 덤벨 (한쪽 무게). 기록도 한쪽 기준으로 남긴다 */
  availableKg: number[];
}

export interface StackLoading {
  kind: 'stack';
  minKg: number;
  stepKg: number;
  maxKg: number;
  /** 스택 위에 얹는 보조추 */
  addOnKg?: number[];
}

export interface PlateLoadedLoading {
  kind: 'plateLoaded';
  /** 빈 캐리지 무게. 핵스쿼트는 이것만 25~60kg다 */
  carriageKg: number;
  plates: number[];
  plateCounts?: Record<number, number>;
  /** 플레이트를 끼우는 쪽 수 (레그프레스 2, 랜드마인 1) */
  sides?: 1 | 2;
  maxTotalKg?: number;
}

export interface BodyweightLoading {
  kind: 'bodyweight';
  /** 벨트나 덤벨로 추가할 수 있는 무게 */
  addedKg?: number[];
  /** 어시스트 머신이 있으면 음수 하중이 가능하다 */
  assist?: StackLoading;
}

export type GymEquipmentOverride = LoadingSpec | 'unavailable';

export interface GymProfile {
  id: string;
  name: string;
  defaults: {
    barbell: BarbellLoading;
    dumbbell: DumbbellLoading;
    stack: StackLoading;
    plateLoaded: PlateLoadedLoading;
    bodyweight: BodyweightLoading;
  };
  /**
   * 종목별 실측값과 예외.
   * "이 헬스장 레그프레스는 플레이트식이다", "핵스쿼트는 없다" 같은 것들.
   */
  overrides?: Record<string, GymEquipmentOverride>;
  /** 아예 없는 기구 종류. "스미스머신 없음" 한 번으로 관련 종목이 전부 걸러진다 */
  missingEquipment?: Equipment[];
}

/* ── 기본 프로필 ───────────────────────────────────────────── */

/** 국내 일반 헬스장에서 흔한 구성. 온보딩의 출발점으로 쓰고 사용자가 고친다. */
export const DEFAULT_GYM: GymProfile = {
  id: 'default',
  name: '일반 헬스장',
  defaults: {
    barbell: { kind: 'barbell', barKg: 20, plates: [25, 20, 15, 10, 5, 2.5, 1.25], collarKg: 0 },
    dumbbell: {
      kind: 'dumbbell',
      availableKg: [
        2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30,
        32, 34, 36, 38, 40, 45, 50,
      ],
    },
    stack: { kind: 'stack', minKg: 5, stepKg: 5, maxKg: 100, addOnKg: [2.5] },
    plateLoaded: { kind: 'plateLoaded', carriageKg: 25, plates: [25, 20, 15, 10, 5, 2.5], sides: 2 },
    bodyweight: { kind: 'bodyweight', addedKg: [2.5, 5, 10, 15, 20] },
  },
  overrides: {
    // 컬은 보통 EZ바를 쓴다
    'barbell-curl': { kind: 'barbell', barKg: 10, plates: [10, 5, 2.5, 1.25] },
    // 레그프레스·핵스쿼트는 플레이트식이 흔하고 캐리지가 무겁다
    'leg-press': { kind: 'plateLoaded', carriageKg: 20, plates: [25, 20, 15, 10, 5], sides: 2 },
    'hack-squat': { kind: 'plateLoaded', carriageKg: 30, plates: [25, 20, 15, 10, 5], sides: 2 },
  },
};

/** 기구 종류별로 어떤 기본 명세를 쓸지. */
const EQUIPMENT_TO_DEFAULT: Record<Equipment, keyof GymProfile['defaults'] | null> = {
  barbell: 'barbell',
  dumbbell: 'dumbbell',
  machine: 'stack',
  cable: 'stack',
  smith: 'barbell',
  bodyweight: 'bodyweight',
  band: null,
};

/** 이 헬스장에서 그 종목을 어떻게 싣는가. 없는 기구면 null. */
export function loadingFor(exercise: Exercise, gym: GymProfile = DEFAULT_GYM): LoadingSpec | null {
  const override = gym.overrides?.[exercise.id];
  if (override === 'unavailable') return null;
  if ((gym.missingEquipment ?? []).includes(exercise.equipment)) return null;
  if (override) return override;

  const key = EQUIPMENT_TO_DEFAULT[exercise.equipment];
  return key ? gym.defaults[key] : null;
}

const ALL_EQUIPMENT: Equipment[] = [
  'barbell', 'dumbbell', 'machine', 'cable', 'smith', 'bodyweight', 'band',
];

/** 이 헬스장에 있는 기구 종류. session/pain 의 availableEquipment 에 그대로 넣는다. */
export function availableEquipmentOf(gym: GymProfile = DEFAULT_GYM): Equipment[] {
  const missing = new Set(gym.missingEquipment ?? []);
  return ALL_EQUIPMENT.filter((equipment) => !missing.has(equipment));
}

export function isAvailableAt(exercise: Exercise, gym: GymProfile = DEFAULT_GYM): boolean {
  if (gym.overrides?.[exercise.id] === 'unavailable') return false;
  return !(gym.missingEquipment ?? []).includes(exercise.equipment);
}

/* ── 실제로 만들 수 있는 중량 ─────────────────────────────── */

/** 기본 상한 — 조합상 가능해도 이 위는 처방하지 않는다. */
const DEFAULT_MAX_TOTAL: Record<'barbell' | 'plateLoaded', number> = {
  barbell: 300,
  plateLoaded: 500,
};

/** 0.25kg 해상도로 계산해 부동소수 오차를 없앤다. */
const UNIT = 4;
const toUnits = (kg: number) => Math.round(kg * UNIT);
const toKg = (units: number) => units / UNIT;

/** 플레이트 조합으로 한쪽에 만들 수 있는 무게들 (0 포함, 오름차순). */
function reachablePerSide(plates: readonly number[], counts: Record<number, number> | undefined): number[] {
  const usable = plates.filter((plate) => plate > 0).sort((a, b) => b - a);
  if (usable.length === 0) return [0];

  const cap = toUnits(
    usable.reduce((sum, plate) => sum + plate * (counts?.[plate] ?? 6), 0),
  );
  const reachable = new Uint8Array(cap + 1);
  reachable[0] = 1;

  for (const plate of usable) {
    const step = toUnits(plate);
    const available = counts?.[plate] ?? 6;
    // 같은 플레이트를 여러 장 쓸 수 있으므로 개수만큼 반복한다.
    for (let used = 0; used < available; used += 1) {
      for (let value = cap; value >= step; value -= 1) {
        if (reachable[value - step]) reachable[value] = 1;
      }
    }
  }

  const out: number[] = [];
  for (let value = 0; value <= cap; value += 1) if (reachable[value]) out.push(toKg(value));
  return out;
}

function stackWeights(spec: StackLoading): number[] {
  const values = new Set<number>();
  for (let weight = spec.minKg; weight <= spec.maxKg + 1e-9; weight += spec.stepKg) {
    values.add(toKg(toUnits(weight)));
    for (const addOn of spec.addOnKg ?? []) {
      if (weight + addOn <= spec.maxKg + addOn) values.add(toKg(toUnits(weight + addOn)));
    }
  }
  return [...values].sort((a, b) => a - b);
}

/** 그 기구에서 실제로 만들 수 있는 중량 전부 (오름차순). */
export function loadableWeights(spec: LoadingSpec): number[] {
  switch (spec.kind) {
    case 'barbell': {
      const collars = (spec.collarKg ?? 0) * 2;
      const ceiling = spec.maxTotalKg ?? DEFAULT_MAX_TOTAL.barbell;
      return reachablePerSide(spec.plates, spec.plateCounts)
        .map((side) => toKg(toUnits(spec.barKg + side * 2 + (side > 0 ? collars : 0))))
        .filter((total) => total <= ceiling);
    }
    case 'plateLoaded': {
      const sides = spec.sides ?? 2;
      const ceiling = spec.maxTotalKg ?? DEFAULT_MAX_TOTAL.plateLoaded;
      return reachablePerSide(spec.plates, spec.plateCounts)
        .map((side) => toKg(toUnits(spec.carriageKg + side * sides)))
        .filter((total) => total <= ceiling);
    }
    case 'dumbbell':
      return [...spec.availableKg].sort((a, b) => a - b);
    case 'stack':
      return stackWeights(spec);
    case 'bodyweight': {
      const added = reachablePerSide(spec.addedKg ?? [], undefined);
      const assist = spec.assist ? stackWeights(spec.assist).map((value) => -value) : [];
      return [...new Set([...assist, ...added])].sort((a, b) => a - b);
    }
  }
}

export type SnapDirection = 'nearest' | 'down' | 'up';

/**
 * 처방 중량을 그 기구에서 실제로 만들 수 있는 값으로 맞춘다.
 * 증량 중이면 'up', 감량 중이면 'down' 을 써서 의도한 방향을 잃지 않게 한다.
 */
export function nearestLoadable(
  targetKg: number,
  spec: LoadingSpec,
  direction: SnapDirection = 'nearest',
): number {
  const options = loadableWeights(spec);
  if (options.length === 0) return targetKg;

  if (direction === 'down') {
    const below = options.filter((value) => value <= targetKg + 1e-9);
    return below.length > 0 ? below[below.length - 1]! : options[0]!;
  }
  if (direction === 'up') {
    const above = options.filter((value) => value >= targetKg - 1e-9);
    return above.length > 0 ? above[0]! : options[options.length - 1]!;
  }

  return options.reduce((best, value) =>
    Math.abs(value - targetKg) < Math.abs(best - targetKg) ? value : best,
  );
}

/** 그 기구의 최소 증량 폭 — 목표 부근에서 실제로 한 칸 올리면 몇 kg인지. */
export function stepAround(targetKg: number, spec: LoadingSpec): number {
  const options = loadableWeights(spec);
  const current = nearestLoadable(targetKg, spec);
  const next = options.find((value) => value > current + 1e-9);
  return next === undefined ? 0 : Math.round((next - current) * 100) / 100;
}

/**
 * 만들 수 있는 무게 목록에서 한 칸 옮긴다.
 *
 * 증분을 더하는 것과 다르다. 덤벨은 간격이 일정하지 않고(20, 22.5, 25, 30…),
 * 바벨도 작은 플레이트가 떨어지면 아래쪽 간격이 벌어진다. "2.5kg를 더한다"가
 * 아니라 "다음 칸으로 간다"가 현장에서 맞는 동작이다.
 *
 * 끝에 닿으면 그 자리에 둔다 — 없는 무게로 넘어가지 않는다.
 */
export function neighborLoad(
  targetKg: number,
  spec: LoadingSpec,
  direction: 1 | -1,
): number {
  const options = loadableWeights(spec);
  if (options.length === 0) return targetKg;

  const current = nearestLoadable(targetKg, spec);
  if (direction > 0) {
    const next = options.find((value) => value > current + 1e-9);
    return next === undefined ? current : next;
  }

  let previous = current;
  for (const value of options) {
    if (value < current - 1e-9) previous = value;
    else break;
  }
  return previous;
}

export interface PlatePlan {
  /** 바/캐리지 자체 무게 */
  baseKg: number;
  /** 한쪽에 끼울 플레이트 (무거운 것부터) */
  perSide: number[];
  totalKg: number;
}

/**
 * 플레이트 계산기.
 * 82.5kg면 한쪽에 뭘 끼워야 하는지 — 종목당 하루 몇 번씩 하는 계산이다.
 */
export function platePlan(targetKg: number, spec: LoadingSpec): PlatePlan | null {
  if (spec.kind !== 'barbell' && spec.kind !== 'plateLoaded') return null;

  const base = spec.kind === 'barbell' ? spec.barKg : spec.carriageKg;
  const multiplier = spec.kind === 'barbell' ? 2 : spec.sides ?? 2;
  const snapped = nearestLoadable(targetKg, spec);

  let remainingPerSide = toUnits((snapped - base) / multiplier);
  if (remainingPerSide < 0) return { baseKg: base, perSide: [], totalKg: base };

  const counts = { ...(spec.plateCounts ?? {}) };
  const perSide: number[] = [];

  for (const plate of [...spec.plates].sort((a, b) => b - a)) {
    const step = toUnits(plate);
    let left = counts[plate] ?? 6;
    while (remainingPerSide >= step && left > 0) {
      perSide.push(plate);
      remainingPerSide -= step;
      left -= 1;
    }
  }

  return { baseKg: base, perSide, totalKg: snapped };
}

/** "20kg 바 + 한쪽 25·10·2.5" 처럼 읽히는 한 줄. */
export function describePlates(plan: PlatePlan | null): string {
  if (!plan) return '';
  if (plan.perSide.length === 0) return `빈 바 ${plan.baseKg}kg`;
  return `${plan.baseKg}kg + 한쪽 ${plan.perSide.join(' · ')}`;
}
