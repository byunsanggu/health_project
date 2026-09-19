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
  { id: 'seated-calf-machine', name: '시티드 카프레이즈', category: 'machine' },
  { id: 'dip-station', name: '딥스 바', category: 'rack', common: true },
  { id: 'preacher-bench', name: '프리처 벤치', category: 'bench', common: true },
  { id: 'ab-wheel', name: '앱 휠', category: 'bodyweight', common: true },
  { id: 't-bar-row-machine', name: 'T바 로우', category: 'machine' },
  { id: 'assisted-pull-up-machine', name: '어시스트 풀업 머신', category: 'machine' },
  { id: 'lateral-raise-machine', name: '레터럴 레이즈 머신', category: 'machine' },
  { id: 'hip-thrust-machine', name: '힙 쓰러스트 머신', category: 'machine' },
  {
    id: 'smith-machine', name: '스미스머신', category: 'rack', common: true,
    measurement: {
      field: 'barKg', label: '바 자체 무게', default: 15, options: [0, 7, 15, 20],
      hint: '기구마다 다릅니다. 카운터웨이트가 있으면 0에 가깝습니다',
    },
  },
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

  // 확장 (2차)
  'incline-barbell-press': ['barbell-set', 'bench-incline'],
  'decline-barbell-press': ['barbell-set', 'bench-flat'],
  'chest-dip': ['dip-station'],
  'smith-bench-press': ['smith-machine', 'bench-flat'],
  'low-to-high-cable-fly': ['cable-station'],
  'floor-press': ['barbell-set', 'floor'],

  'chin-up': ['pull-up-bar'],
  'one-arm-dumbbell-row': ['dumbbells', 'bench-flat'],
  't-bar-row': ['t-bar-row-machine'],
  'pendlay-row': ['barbell-set'],
  'straight-arm-pulldown': ['cable-station'],
  'assisted-pull-up': ['assisted-pull-up-machine'],

  'arnold-press': ['dumbbells', 'bench-incline'],
  'machine-lateral-raise': ['lateral-raise-machine'],
  'front-raise': ['dumbbells'],
  'cable-rear-delt-fly': ['cable-station'],
  'barbell-shrug': ['barbell-set'],
  'dumbbell-shrug': ['dumbbells'],

  'preacher-curl': ['preacher-bench', 'ez-bar'],
  'cable-curl': ['cable-station'],
  'concentration-curl': ['dumbbells'],

  'close-grip-bench-press': ['barbell-set', 'bench-flat'],
  'skull-crusher': ['ez-bar', 'bench-flat'],
  'triceps-dip': ['dip-station'],
  'triceps-kickback': ['dumbbells'],

  'front-squat': ['barbell-set', 'power-rack'],
  'bulgarian-split-squat': ['dumbbells', 'bench-flat'],
  'step-up': ['dumbbells', 'bench-flat'],
  'smith-squat': ['smith-machine'],

  'sumo-deadlift': ['barbell-set'],
  'stiff-leg-deadlift': ['barbell-set'],
  'good-morning': ['barbell-set', 'power-rack'],
  'cable-pull-through': ['cable-station'],
  'seated-leg-curl': ['leg-curl-machine'],
  'machine-hip-thrust': ['hip-thrust-machine'],

  'seated-calf-raise': ['seated-calf-machine'],
  'leg-press-calf-raise': ['leg-press-machine'],
  'ab-wheel-rollout': ['ab-wheel'],
  'side-plank': ['floor'],
  'dead-bug': ['floor'],
  'wrist-curl': ['dumbbells'],
  'farmers-walk': ['dumbbells'],
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
  if (selected.has('smith-machine')) {
    const smithBar = value('smith-machine', 'barKg') ?? 15;
    for (const exerciseId of ['smith-bench-press', 'smith-squat']) {
      overrides[exerciseId] = { kind: 'barbell', barKg: smithBar, plates };
    }
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

/* ── 이름을 몰라도 알아보게 ─────────────────────────────── */

export interface EquipmentGuide {
  /** 다르게 부르는 이름들. 검색에 쓴다 */
  aka: string[];
  /** 생김새 한 줄 — 이름을 몰라도 헬스장에서 찾을 수 있어야 한다 */
  look: string;
}

/**
 * 기구 설명.
 *
 * "올림픽 바벨 + 플레이트"나 "펙덱"이 뭔지 모르는 사람이 훨씬 많다. 이름만
 * 늘어놓고 고르라고 하면 초보자는 거기서 앱을 닫는다. 그래서 다르게 부르는
 * 이름과 생김새를 같이 준다 — "긴 봉에 원판 끼우는 것"이라고 하면 안다.
 */
export const EQUIPMENT_GUIDE: Record<string, EquipmentGuide> = {
  floor: {
    aka: ['매트', '맨몸', '스트레칭 존', '요가매트'],
    look: '바닥에 깔린 매트. 팔굽혀펴기나 플랭크를 할 수 있는 빈 공간',
  },
  'barbell-set': {
    aka: ['긴 바벨', '봉', '원판', '바벨', '역기'],
    look: '2m쯤 되는 긴 쇠봉과 양쪽에 끼우는 둥근 원판',
  },
  'ez-bar': {
    aka: ['굽은 바', 'W바', '지그재그 봉', '컬바'],
    look: '가운데가 W자로 굽은 짧은 봉. 팔 운동에 씁니다',
  },
  dumbbells: {
    aka: ['아령', '덤벨'],
    look: '한 손으로 드는 아령. 보통 벽 쪽 거치대에 무게순으로 놓여 있습니다',
  },
  'power-rack': {
    aka: ['랙', '스쿼트랙', '철장', '파워케이지'],
    look: '사람이 들어가는 네모난 철제 구조물. 안에서 바벨을 들어올립니다',
  },
  'bench-flat': {
    aka: ['벤치', '평평한 벤치', '눕는 의자'],
    look: '평평하게 누울 수 있는 긴 의자',
  },
  'bench-incline': {
    aka: ['기울어진 벤치', '경사 벤치', '인클라인'],
    look: '등받이 각도를 세울 수 있는 벤치',
  },
  'pull-up-bar': {
    aka: ['철봉', '턱걸이 봉', '풀업'],
    look: '천장이나 기둥에 달린 가로 봉. 매달려서 턱걸이를 합니다',
  },
  landmine: {
    aka: ['한쪽 고정 바벨', '랜드마인'],
    look: '바벨 한쪽 끝이 바닥에 고정돼 비스듬히 움직이는 장치',
  },
  'back-extension-bench': {
    aka: ['허리 운동대', '로만체어', '백익스텐션'],
    look: '허벅지를 받치고 상체를 숙였다 펴는 비스듬한 받침대',
  },
  'cable-station': {
    aka: ['케이블', '줄 당기는 기계', '도르래'],
    look: '기둥에 줄(케이블)이 달려 있고 손잡이를 갈아 끼우는 기계. 추가 핀으로 조절됩니다',
  },
  'lat-pulldown-machine': {
    aka: ['랫풀', '위에서 당기는 기계', '풀다운'],
    look: '앉아서 머리 위의 긴 봉을 아래로 당기는 기계',
  },
  'seated-row-machine': {
    aka: ['로우 머신', '앉아서 당기는 기계', '시티드로우'],
    look: '앉아서 손잡이를 몸 쪽으로 당기는 기계',
  },
  'chest-press-machine': {
    aka: ['체스트프레스', '가슴 미는 기계'],
    look: '앉아서 앞으로 미는 기계. 가슴 운동입니다',
  },
  'shoulder-press-machine': {
    aka: ['숄더프레스', '어깨 미는 기계'],
    look: '앉아서 위로 미는 기계. 어깨 운동입니다',
  },
  'pec-deck-machine': {
    aka: ['펙덱', '플라이 머신', '나비 기계', '버터플라이'],
    look: '앉아서 양팔을 안으로 모으는 기계. 나비처럼 생겼습니다',
  },
  'chest-supported-row-machine': {
    aka: ['가슴 대고 당기는 기계', '티바 로우'],
    look: '가슴을 받침대에 대고 엎드려 당기는 기계',
  },
  'leg-press-machine': {
    aka: ['레그프레스', '다리 미는 기계'],
    look: '앉거나 누워서 발판을 다리로 밀어내는 큰 기계',
  },
  'hack-squat-machine': {
    aka: ['핵스쿼트', '어깨로 미는 스쿼트 기계'],
    look: '비스듬히 누워 어깨로 받치고 밀어 올리는 기계',
  },
  'leg-extension-machine': {
    aka: ['레그익스텐션', '앉아서 다리 펴는 기계'],
    look: '앉아서 발목 앞의 롤러를 걸고 무릎을 펴는 기계',
  },
  'leg-curl-machine': {
    aka: ['레그컬', '다리 접는 기계', '햄스트링 기계'],
    look: '엎드리거나 앉아서 발목 뒤의 롤러를 걸고 무릎을 접는 기계',
  },
  'calf-raise-machine': {
    aka: ['종아리 기계', '카프레이즈'],
    look: '서서 어깨로 받치고 뒤꿈치를 드는 기계',
  },
  'seated-calf-machine': {
    aka: ['앉아서 하는 종아리 기계'],
    look: '앉아서 무릎 위에 패드를 얹고 뒤꿈치를 드는 기계',
  },
  'dip-station': {
    aka: ['딥스', '평행봉'],
    look: '어깨너비 평행봉 두 개. 몸을 띄워 내렸다 올립니다',
  },
  'preacher-bench': {
    aka: ['프리처', '팔 받침대', '암컬 벤치'],
    look: '팔을 비스듬한 패드에 얹고 컬을 하는 의자',
  },
  'ab-wheel': {
    aka: ['앱휠', '복근 롤러', '바퀴'],
    look: '양쪽에 손잡이가 달린 작은 바퀴',
  },
  't-bar-row-machine': {
    aka: ['티바로우', 'T바'],
    look: '한쪽이 바닥에 고정된 바에 원판을 끼우고 당기는 기구',
  },
  'assisted-pull-up-machine': {
    aka: ['어시스트 풀업', '보조 턱걸이 기계', '그래비트론'],
    look: '무릎이나 발을 얹는 발판이 올라와 턱걸이를 도와주는 기계',
  },
  'lateral-raise-machine': {
    aka: ['레터럴레이즈 머신', '옆으로 드는 기계'],
    look: '앉아서 팔꿈치로 패드를 밀어 옆으로 올리는 기계',
  },
  'hip-thrust-machine': {
    aka: ['힙쓰러스트 기계', '엉덩이 기계'],
    look: '앉아서 골반 위에 패드를 얹고 밀어 올리는 기계',
  },
  'smith-machine': {
    aka: ['스미스', '레일 달린 바벨', '가이드 바벨'],
    look: '바벨이 두 개의 레일을 따라서만 위아래로 움직이는 기계',
  },
};

export function equipmentGuide(id: string): EquipmentGuide | undefined {
  return EQUIPMENT_GUIDE[id];
}

/**
 * 이름을 몰라도 찾을 수 있게 — 정식 이름과 별명, 생김새를 모두 뒤진다.
 * "굽은 봉"으로도 "EZ 바"로도 같은 것이 나와야 한다.
 */
export function findEquipment(query: string, pool: readonly EquipmentItem[] = EQUIPMENT_CATALOG): EquipmentItem[] {
  /*
   * 낱말 단위로 본다. "굽은 봉"을 통째로 붙여 찾으면 "가운데가 W자로 굽은
   * 짧은 봉"에서 못 찾는다 — 사람은 기억나는 낱말 몇 개만 던진다.
   */
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [...pool];

  return pool.filter((item) => {
    const guide = EQUIPMENT_GUIDE[item.id];
    const haystack = [item.name, ...(guide?.aka ?? []), guide?.look ?? '']
      .join(' ')
      .toLowerCase()
      .replace(/[\s·()]/g, '');
    return tokens.every((token) => haystack.includes(token.replace(/[\s·()]/g, '')));
  });
}
