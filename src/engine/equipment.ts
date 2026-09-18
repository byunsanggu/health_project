import { EXERCISES } from './exercises.ts';
import { DEFAULT_GYM, type GymProfile, type LoadingSpec } from './gym.ts';
import { MUSCLE_GROUPS, MUSCLE_LABELS_KO } from './muscles.ts';
import type { Exercise, MuscleGroup } from './types.ts';

/**
 * 헬스장 기구 카탈로그.
 *
 * 온보딩에서 "내 헬스장에 있는 것"을 하나씩 켜면 종목이 열린다.
 * 종목 41개를 일일이 고르게 하면 아무도 끝까지 못 간다 — 기구 단위라야 한다.
 */
export type EquipmentCategory = 'rack' | 'bench' | 'freeweight' | 'machine' | 'cable' | 'bodyweight';

export const CATEGORY_LABELS_KO: Record<EquipmentCategory, string> = {
  rack: '랙 · 프레임',
  bench: '벤치',
  freeweight: '프리웨이트',
  machine: '머신',
  cable: '케이블',
  bodyweight: '맨몸',
};

export interface EquipmentMeasurement {
  /** 이 기구에서 실측해 두면 좋은 값 */
  field: 'barKg' | 'stepKg' | 'carriageKg' | 'maxDumbbellKg';
  label: string;
  default: number;
  /** 흔한 값들 — 온보딩에서 버튼으로 고르게 한다 */
  options: number[];
  hint?: string;
}

export interface EquipmentItem {
  id: string;
  name: string;
  category: EquipmentCategory;
  /** 대부분의 헬스장에 있는 기구 — 온보딩 기본 선택 */
  common?: boolean;
  measurement?: EquipmentMeasurement;
  /** 이 기구가 정하는 중량 방식 (측정값이 들어가면 덮어쓴다) */
  loading?: LoadingSpec;
}

export const EQUIPMENT_CATALOG: readonly EquipmentItem[] = [
  {
    id: 'floor', name: '매트 · 맨몸 공간', category: 'bodyweight', common: true,
  },
  {
    id: 'barbell-set', name: '올림픽 바벨 + 플레이트', category: 'freeweight', common: true,
    measurement: {
      field: 'barKg', label: '빈 바 무게', default: 20, options: [20, 15, 10],
      hint: '올림픽 바는 20kg, 여성용은 15kg입니다',
    },
  },
  {
    id: 'ez-bar', name: 'EZ 바', category: 'freeweight', common: true,
    measurement: { field: 'barKg', label: '빈 바 무게', default: 10, options: [10, 7.5, 12] },
  },
  {
    id: 'dumbbells', name: '덤벨 세트', category: 'freeweight', common: true,
    measurement: {
      field: 'maxDumbbellKg', label: '가장 무거운 덤벨', default: 40, options: [30, 40, 50, 60],
    },
  },
  { id: 'power-rack', name: '파워랙 · 스쿼트랙', category: 'rack', common: true },
  { id: 'bench-flat', name: '플랫 벤치', category: 'bench', common: true },
  { id: 'bench-incline', name: '인클라인 벤치', category: 'bench', common: true },
  { id: 'pull-up-bar', name: '풀업 바', category: 'rack', common: true },
  { id: 'landmine', name: '랜드마인', category: 'rack' },
  { id: 'back-extension-bench', name: '백 익스텐션대', category: 'bench' },
  {
    id: 'cable-station', name: '케이블 스테이션', category: 'cable', common: true,
    measurement: {
      field: 'stepKg', label: '스택 간격', default: 5, options: [5, 2.5],
      hint: '핀을 한 칸 내릴 때 바뀌는 무게',
    },
  },
  {
    id: 'lat-pulldown-machine', name: '랫 풀다운', category: 'cable', common: true,
    measurement: { field: 'stepKg', label: '스택 간격', default: 5, options: [5, 2.5] },
  },
  {
    id: 'seated-row-machine', name: '시티드 로우', category: 'cable', common: true,
    measurement: { field: 'stepKg', label: '스택 간격', default: 5, options: [5, 2.5] },
  },
  { id: 'chest-press-machine', name: '체스트프레스 머신', category: 'machine', common: true },
  { id: 'shoulder-press-machine', name: '숄더프레스 머신', category: 'machine' },
  { id: 'pec-deck-machine', name: '펙덱 (플라이 머신)', category: 'machine', common: true },
  { id: 'chest-supported-row-machine', name: '체스트 서포티드 로우', category: 'machine' },
  {
    id: 'leg-press-machine', name: '레그프레스', category: 'machine', common: true,
    measurement: {
      field: 'carriageKg', label: '빈 캐리지 무게', default: 20, options: [0, 20, 30, 40],
      hint: '플레이트를 빼도 남는 무게. 모르면 20kg으로 두세요',
    },
  },
  {
    id: 'hack-squat-machine', name: '핵 스쿼트', category: 'machine',
    measurement: { field: 'carriageKg', label: '빈 캐리지 무게', default: 30, options: [20, 30, 40, 60] },
  },
  { id: 'leg-extension-machine', name: '레그 익스텐션', category: 'machine', common: true },
  { id: 'leg-curl-machine', name: '레그컬', category: 'machine', common: true },
  { id: 'calf-raise-machine', name: '카프레이즈 머신', category: 'machine', common: true },
];

const CATALOG_BY_ID = new Map(EQUIPMENT_CATALOG.map((item) => [item.id, item]));

export function equipmentItem(id: string): EquipmentItem | undefined {
  return CATALOG_BY_ID.get(id);
}

/**
 * 종목별로 필요한 기구. 전부 갖춰야 그 종목이 열린다.
 * 벤치프레스는 바벨만으로는 안 되고 벤치가 있어야 한다.
 */
export const EXERCISE_REQUIREMENTS: Record<string, readonly string[]> = {
  'barbell-bench-press': ['barbell-set', 'bench-flat'],
  'dumbbell-bench-press': ['dumbbells', 'bench-flat'],
  'incline-dumbbell-press': ['dumbbells', 'bench-incline'],
  'machine-chest-press': ['chest-press-machine'],
  'push-up': ['floor'],
  'cable-fly': ['cable-station'],
  'pec-deck': ['pec-deck-machine'],

  'barbell-overhead-press': ['barbell-set'],
  'landmine-press': ['landmine'],
  'seated-dumbbell-press': ['dumbbells', 'bench-incline'],
  'machine-shoulder-press': ['shoulder-press-machine'],
  'lateral-raise': ['dumbbells'],
  'cable-lateral-raise': ['cable-station'],

  'pull-up': ['pull-up-bar'],
  'lat-pulldown': ['lat-pulldown-machine'],
  'neutral-grip-pulldown': ['lat-pulldown-machine'],
  'barbell-row': ['barbell-set'],
  'chest-supported-row': ['chest-supported-row-machine'],
  'seated-cable-row': ['seated-row-machine'],
  'face-pull': ['cable-station'],
  'reverse-pec-deck': ['pec-deck-machine'],

  'back-squat': ['barbell-set', 'power-rack'],
  'hack-squat': ['hack-squat-machine'],
  'leg-press': ['leg-press-machine'],
  'goblet-squat': ['dumbbells'],
  'walking-lunge': ['dumbbells'],
  'leg-extension': ['leg-extension-machine'],

  'conventional-deadlift': ['barbell-set'],
  'romanian-deadlift': ['barbell-set'],
  'hip-thrust': ['barbell-set', 'bench-flat'],
  'lying-leg-curl': ['leg-curl-machine'],
  'back-extension': ['back-extension-bench'],

  'barbell-curl': ['ez-bar'],
  'incline-dumbbell-curl': ['dumbbells', 'bench-incline'],
  'hammer-curl': ['dumbbells'],
  'triceps-pushdown': ['cable-station'],
  'overhead-cable-extension': ['cable-station'],

  'standing-calf-raise': ['calf-raise-machine'],
  'hanging-leg-raise': ['pull-up-bar'],
  'cable-crunch': ['cable-station'],
  'plank': ['floor'],
};

export function requirementsMet(exerciseId: string, selected: ReadonlySet<string>): boolean {
  const required = EXERCISE_REQUIREMENTS[exerciseId];
  if (!required) return true; // 요구사항을 모르는 종목은 막지 않는다
  return required.every((id) => selected.has(id));
}

/** 선택한 기구로 할 수 있는 종목. */
export function availableExercises(
  selectedIds: readonly string[],
  pool: readonly Exercise[] = EXERCISES,
): Exercise[] {
  const selected = new Set(selectedIds);
  return pool.filter((exercise) => requirementsMet(exercise.id, selected));
}

/** 이 기구를 추가하면 새로 열리는 종목. 온보딩에서 "+3 종목"을 보여주는 데 쓴다. */
export function wouldEnable(
  itemId: string,
  selectedIds: readonly string[],
  pool: readonly Exercise[] = EXERCISES,
): Exercise[] {
  if (selectedIds.includes(itemId)) return [];
  const before = new Set(availableExercises(selectedIds, pool).map((e) => e.id));
  return availableExercises([...selectedIds, itemId], pool).filter((e) => !before.has(e.id));
}

/** 기구 목록을 "열리는 종목이 많은 순"으로 정렬해 추천한다. */
export function suggestNextEquipment(
  selectedIds: readonly string[],
  pool: readonly Exercise[] = EXERCISES,
): { item: EquipmentItem; unlocks: Exercise[] }[] {
  return EQUIPMENT_CATALOG
    .filter((item) => !selectedIds.includes(item.id))
    .map((item) => ({ item, unlocks: wouldEnable(item.id, selectedIds, pool) }))
    .filter((entry) => entry.unlocks.length > 0)
    .sort((a, b) => b.unlocks.length - a.unlocks.length);
}

export interface MuscleCoverage {
  muscle: MuscleGroup;
  label: string;
  /** 그 부위를 주동근으로 쓰는 가능 종목 수 */
  directOptions: number;
  /** 운동 DB 전체에 존재하는 직접 종목 수 — 기구를 다 갖춰도 이 수를 넘지 못한다 */
  possibleOptions: number;
  /** 종목이 충분한가 */
  sufficient: boolean;
  /** 부족할 때 추가하면 좋은 기구 */
  suggestion?: EquipmentItem;
}

/** 선택한 기구로 모든 부위를 훈련할 수 있는지 점검한다. */
export function coverageReport(
  selectedIds: readonly string[],
  pool: readonly Exercise[] = EXERCISES,
): MuscleCoverage[] {
  const available = availableExercises(selectedIds, pool);

  return MUSCLE_GROUPS.map((muscle) => {
    const directOptions = available.filter((e) => (e.contribution[muscle] ?? 0) >= 0.85).length;
    const possibleOptions = pool.filter((e) => (e.contribution[muscle] ?? 0) >= 0.85).length;

    // 기구를 다 갖춰도 직접 종목이 없는 부위는 사용자가 해결할 수 없다.
    // 간접 볼륨으로 충분한 부위(전면 삼각근·전완)도 구멍으로 보지 않는다.
    const reachable = Math.min(2, possibleOptions);
    const sufficient =
      directOptions >= reachable || muscle === 'frontDelt' || muscle === 'forearms';

    let suggestion: EquipmentItem | undefined;
    if (!sufficient) {
      const best = suggestNextEquipment(selectedIds, pool)
        .filter((entry) => entry.unlocks.some((e) => (e.contribution[muscle] ?? 0) >= 0.85))[0];
      suggestion = best?.item;
    }

    return { muscle, label: MUSCLE_LABELS_KO[muscle], directOptions, possibleOptions, sufficient, suggestion };
  });
}

/* ── 선택을 GymProfile 로 ─────────────────────────────────── */

export type MeasurementValues = Record<string, Partial<Record<EquipmentMeasurement['field'], number>>>;

export interface GymSelection {
  id?: string;
  name?: string;
  equipmentIds: readonly string[];
  /** 기구별 실측값. { 'barbell-set': { barKg: 15 } } */
  measurements?: MeasurementValues;
  /** 보유 플레이트 (한쪽 기준 종류) */
  plates?: number[];
}

/** 덤벨 최대 무게에 맞춰 보유 덤벨 목록을 만든다. */
function dumbbellLadder(maxKg: number): number[] {
  const values: number[] = [];
  for (let kg = 2; kg <= Math.min(maxKg, 40); kg += 2) values.push(kg);
  for (let kg = 45; kg <= maxKg; kg += 5) values.push(kg);
  return values;
}

/**
 * 온보딩에서 고른 기구와 실측값을 엔진이 쓰는 GymProfile 로 바꾼다.
 * 선택하지 않은 기구가 필요한 종목은 전부 'unavailable' 로 막힌다.
 */
export function gymFromCatalog(selection: GymSelection): GymProfile {
  const selected = new Set(selection.equipmentIds);
  const measured = selection.measurements ?? {};
  const value = (itemId: string, field: EquipmentMeasurement['field']) =>
    measured[itemId]?.[field] ?? equipmentItem(itemId)?.measurement?.default;

  const plates = selection.plates ?? DEFAULT_GYM.defaults.barbell.plates;
  const barKg = value('barbell-set', 'barKg') ?? 20;
  const stackStep = value('cable-station', 'stepKg') ?? 5;
  const maxDumbbell = value('dumbbells', 'maxDumbbellKg') ?? 40;

  const overrides: GymProfile['overrides'] = {};

  // 없는 기구가 필요한 종목을 막는다.
  for (const exercise of EXERCISES) {
    if (!requirementsMet(exercise.id, selected)) overrides[exercise.id] = 'unavailable';
  }

  // 실측값이 있는 기구는 종목별 명세를 따로 준다.
  if (selected.has('ez-bar')) {
    overrides['barbell-curl'] = {
      kind: 'barbell',
      barKg: value('ez-bar', 'barKg') ?? 10,
      plates: plates.filter((plate) => plate <= 10),
    };
  }
  if (selected.has('leg-press-machine')) {
    overrides['leg-press'] = {
      kind: 'plateLoaded',
      carriageKg: value('leg-press-machine', 'carriageKg') ?? 20,
      plates,
      sides: 2,
    };
  }
  if (selected.has('hack-squat-machine')) {
    overrides['hack-squat'] = {
      kind: 'plateLoaded',
      carriageKg: value('hack-squat-machine', 'carriageKg') ?? 30,
      plates,
      sides: 2,
    };
  }
  for (const [itemId, exerciseIds] of [
    ['lat-pulldown-machine', ['lat-pulldown', 'neutral-grip-pulldown']],
    ['seated-row-machine', ['seated-cable-row']],
  ] as const) {
    if (!selected.has(itemId)) continue;
    const step = value(itemId, 'stepKg') ?? 5;
    for (const exerciseId of exerciseIds) {
      overrides[exerciseId] = {
        kind: 'stack', minKg: step, stepKg: step, maxKg: 120, addOnKg: [2.5],
      };
    }
  }

  return {
    id: selection.id ?? 'my-gym',
    name: selection.name ?? '내 헬스장',
    defaults: {
      barbell: { kind: 'barbell', barKg, plates },
      dumbbell: { kind: 'dumbbell', availableKg: dumbbellLadder(maxDumbbell) },
      stack: { kind: 'stack', minKg: stackStep, stepKg: stackStep, maxKg: 100, addOnKg: [2.5] },
      plateLoaded: { kind: 'plateLoaded', carriageKg: 25, plates, sides: 2 },
      bodyweight: { kind: 'bodyweight', addedKg: [2.5, 5, 10, 15, 20] },
    },
    overrides,
  };
}

/** 대부분의 헬스장에 있는 기구로 시작하는 기본 선택. */
export const COMMON_EQUIPMENT_IDS: readonly string[] = EQUIPMENT_CATALOG
  .filter((item) => item.common)
  .map((item) => item.id);
