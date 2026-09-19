import {
  COMMON_EQUIPMENT_IDS,
  availableExercises,
  coverageReport,
  equipmentItem,
  gymFromCatalog,
  requirementsMet,
  type GymSelection,
} from './equipment.ts';
import { EXERCISES } from './exercises.ts';
import { findDuplicates, gymKey, parseFloor, type DuplicateHit } from './gymIdentity.ts';
import { gymPreset as gymPresetOf, presetEquipment, type GymVisibility } from './gymPresets.ts';
import type { GymProfile } from './gym.ts';
import type { Exercise } from './types.ts';
import type { TrainingProgram } from './onboarding.ts';

/**
 * 여러 헬스장 관리.
 *
 * 한 곳만 다니는 사람은 거의 없다. 집 근처와 회사 근처가 다르고, 출장이나
 * 여행지에서는 처음 가는 곳에서 해야 한다. 기구 구성이 다르면 같은 프로그램도
 * 그대로 못 하므로, 헬스장은 하나의 설정값이 아니라 목록이어야 한다.
 */
export interface GymEntry extends GymSelection {
  id: string;
  name: string;
  /** 집 · 회사 · 출장 같은 메모 */
  note?: string;
  /** 마지막으로 여기서 운동한 날 */
  lastUsedAt?: string;
}

export interface GymBook {
  gyms: GymEntry[];
  /** 지금 선택된 헬스장 */
  activeId: string;
}

export function createGymBook(first: GymEntry): GymBook {
  return { gyms: [first], activeId: first.id };
}

export function activeGym(book: GymBook): GymEntry | undefined {
  return book.gyms.find((gym) => gym.id === book.activeId);
}

/** 선택된 헬스장을 엔진이 쓰는 프로필로. */
export function activeProfile(book: GymBook): GymProfile | undefined {
  const entry = activeGym(book);
  return entry ? gymFromCatalog(entry) : undefined;
}

export function addGym(book: GymBook, gym: GymEntry, makeActive = true): GymBook {
  const gyms = book.gyms.some((item) => item.id === gym.id)
    ? book.gyms.map((item) => (item.id === gym.id ? gym : item))
    : [...book.gyms, gym];
  return { gyms, activeId: makeActive ? gym.id : book.activeId };
}

export function removeGym(book: GymBook, id: string): GymBook {
  if (book.gyms.length <= 1) return book; // 마지막 한 곳은 남긴다
  const gyms = book.gyms.filter((gym) => gym.id !== id);
  return { gyms, activeId: book.activeId === id ? gyms[0]!.id : book.activeId };
}

export function switchGym(book: GymBook, id: string, today?: string): GymBook {
  if (!book.gyms.some((gym) => gym.id === id)) return book;
  return {
    activeId: id,
    gyms: book.gyms.map((gym) => (gym.id === id && today ? { ...gym, lastUsedAt: today } : gym)),
  };
}

/* ── 헬스장 찾기 ───────────────────────────────────────── */

export type DirectorySource = 'community' | 'official' | 'user';

export interface GymDirectoryEntry {
  id: string;
  name: string;
  /** 표시용 주소 */
  address: string;
  location?: { lat: number; lng: number };
  /**
   * 층. 지하는 음수.
   * 같은 건물 3층과 5층에 다른 헬스장이 있는 경우가 흔해서, 좌표만으로는
   * 구분되지 않는다. 주소에서 읽어내지 못하면 사용자가 채운다.
   */
  floor?: number;
  /** 등록된 보유 기구 */
  equipmentIds: string[];
  /** 누가 올린 정보인가 — 기구 목록의 신뢰도가 여기서 갈린다 */
  source: DirectorySource;
  /** 마지막으로 확인된 날짜 */
  verifiedAt?: string;
  /**
   * 기구별 마지막 확인 시각.
   * 두 기록을 합칠 때 합집합을 쓰면 안 된다 — A가 6개월 전에 "레그프레스 있음"
   * 이라 했고 B가 어제 "없음"이라 했으면 없는 것이다.
   */
  equipmentVerifiedAt?: Record<string, string>;
  /** 없다고 확인된 기구. 있음만 쌓으면 사라진 기구를 영원히 못 지운다. */
  absentEquipmentIds?: string[];
  /**
   * 검색에 노출되는 곳인가.
   *
   * 아파트 커뮤니티 헬스장, 회사 헬스장, 홈짐은 'private'이다. 공개 디렉터리에
   * 올리지 않고 중복 판정에서도 남의 것과 비교하지 않는다 — 옆 동 주민이 같은
   * 단지 헬스장을 등록했는지는 알 필요도 없고, 알려줘서도 안 된다.
   */
  visibility?: GymVisibility;
  /**
   * 같은 곳일 수 있는데 아직 확인하지 않은 항목들.
   *
   * 등록할 때마다 "혹시 이거 아닌가요?"로 막으면 성가시다. 나중에 묻기로
   * 하고 여기 적어두면, 검색하다 마주쳤을 때 그때 확인할 수 있다.
   */
  pendingMergeWith?: string[];
}

/**
 * 예시 디렉터리.
 *
 * 실제 제품에서는 지도 API로 주변 시설을 받아오고, 기구 목록은 사용자가
 * 채워 넣는 크라우드소싱으로 쌓인다. 여기 들어 있는 항목은 구조를 보여주기
 * 위한 예시이고 실재하는 업체가 아니다.
 */
export const SAMPLE_DIRECTORY: readonly GymDirectoryEntry[] = [
  {
    id: 'sample-full',
    name: '예시 피트니스 A (대형)',
    address: '예시시 예시구 예시로 1',
    location: { lat: 37.5, lng: 127.03 },
    source: 'community',
    verifiedAt: '2026-08-01',
    equipmentIds: [
      'floor', 'barbell-set', 'ez-bar', 'dumbbells', 'power-rack', 'bench-flat',
      'bench-incline', 'pull-up-bar', 'dip-station', 'preacher-bench', 'smith-machine',
      'cable-station', 'lat-pulldown-machine', 'seated-row-machine', 'chest-press-machine',
      'shoulder-press-machine', 'pec-deck-machine', 'chest-supported-row-machine',
      'leg-press-machine', 'hack-squat-machine', 'leg-extension-machine', 'leg-curl-machine',
      'calf-raise-machine', 'seated-calf-machine', 'hip-thrust-machine', 't-bar-row-machine',
      'ab-wheel', 'landmine', 'back-extension-bench',
    ],
  },
  {
    id: 'sample-mid',
    name: '예시 짐 B (동네)',
    address: '예시시 예시구 예시로 22',
    location: { lat: 37.51, lng: 127.02 },
    source: 'community',
    verifiedAt: '2026-07-14',
    equipmentIds: [
      'floor', 'barbell-set', 'ez-bar', 'dumbbells', 'power-rack', 'bench-flat',
      'bench-incline', 'pull-up-bar', 'cable-station', 'lat-pulldown-machine',
      'seated-row-machine', 'chest-press-machine', 'pec-deck-machine',
      'leg-press-machine', 'leg-extension-machine', 'leg-curl-machine', 'calf-raise-machine',
    ],
  },
  {
    id: 'sample-hotel',
    name: '예시 호텔 피트니스 (출장용)',
    address: '예시시 예시구 예시로 333',
    location: { lat: 37.56, lng: 126.98 },
    source: 'user',
    verifiedAt: '2026-09-02',
    equipmentIds: ['floor', 'dumbbells', 'bench-flat', 'bench-incline', 'cable-station', 'lat-pulldown-machine'],
  },
  {
    id: 'sample-barbell',
    name: '예시 바벨 클럽 (프리웨이트 전용)',
    address: '예시시 예시구 예시로 47',
    location: { lat: 37.49, lng: 127.05 },
    source: 'community',
    verifiedAt: '2026-08-20',
    equipmentIds: [
      'floor', 'barbell-set', 'ez-bar', 'dumbbells', 'power-rack', 'bench-flat',
      'bench-incline', 'pull-up-bar', 'dip-station', 'landmine', 'back-extension-bench',
    ],
  },
];

export interface GymSearchOptions {
  /** 현재 위치. 주면 가까운 순으로 정렬한다 */
  near?: { lat: number; lng: number };
  /** 이 프로그램을 할 수 있는지 함께 계산한다 */
  program?: TrainingProgram;
  directory?: readonly GymDirectoryEntry[];
  limit?: number;
  pool?: readonly Exercise[];
}

export interface GymSearchResult {
  entry: GymDirectoryEntry;
  /** km. 위치를 모르면 undefined */
  distanceKm?: number;
  /** 이 헬스장에서 할 수 있는 종목 수 */
  exerciseCount: number;
  /** 내 프로그램 중 그대로 할 수 있는 비율 (0~1) */
  programFit?: number;
  /** 프로그램에서 할 수 없는 종목 */
  missing: Exercise[];
  /** 종목이 부족한 부위 */
  weakMuscles: string[];
}

/** 이름 · 주소로 찾고, 위치를 주면 가까운 순으로 정렬한다. */
export function searchGyms(query: string, options: GymSearchOptions = {}): GymSearchResult[] {
  const directory = options.directory ?? SAMPLE_DIRECTORY;
  const pool = options.pool ?? EXERCISES;
  const needle = query.trim().toLowerCase();

  const matched = directory.filter((entry) =>
    // 아파트·회사 헬스장은 검색에 뜨지 않는다.
    entry.visibility !== 'private',
  ).filter((entry) =>
    needle.length === 0 ||
    entry.name.toLowerCase().includes(needle) ||
    entry.address.toLowerCase().includes(needle),
  );

  const results = matched.map((entry) => describeGym(entry, options, pool));

  results.sort((a, b) => {
    if (a.distanceKm !== undefined && b.distanceKm !== undefined) return a.distanceKm - b.distanceKm;
    if (options.program) return (b.programFit ?? 0) - (a.programFit ?? 0);
    return b.exerciseCount - a.exerciseCount;
  });

  return results.slice(0, options.limit ?? 20);
}

/** 이 헬스장이 내 프로그램을 얼마나 받아낼 수 있는지. */
export function describeGym(
  entry: GymDirectoryEntry,
  options: GymSearchOptions = {},
  pool: readonly Exercise[] = EXERCISES,
): GymSearchResult {
  const selected = new Set(entry.equipmentIds);
  const exerciseCount = availableExercises(entry.equipmentIds, pool).length;

  let programFit: number | undefined;
  const missing: Exercise[] = [];

  if (options.program) {
    const wanted = new Set<string>();
    for (const template of options.program.templates) {
      for (const slot of template.slots) wanted.add(slot.exerciseId);
    }
    let usable = 0;
    for (const exerciseId of wanted) {
      if (requirementsMet(exerciseId, selected)) usable += 1;
      else {
        const exercise = pool.find((item) => item.id === exerciseId);
        if (exercise) missing.push(exercise);
      }
    }
    programFit = wanted.size === 0 ? 1 : round2(usable / wanted.size);
  }

  const weakMuscles = coverageReport(entry.equipmentIds, pool)
    .filter((item) => !item.sufficient)
    .map((item) => item.label);

  return {
    entry,
    distanceKm: options.near && entry.location
      ? round2(distanceKm(options.near, entry.location))
      : undefined,
    exerciseCount,
    programFit,
    missing,
    weakMuscles,
  };
}

/** 디렉터리 항목을 내 헬스장 목록에 담을 형태로 바꾼다. */
export function toGymEntry(entry: GymDirectoryEntry, note?: string): GymEntry {
  return {
    id: entry.id,
    name: entry.name,
    // 같은 건물 3층과 5층은 이름이 같을 수 있다. 목록에서 구분되게 층을 메모로 남긴다.
    note: note ?? floorNote(entry.floor),
    equipmentIds: [...entry.equipmentIds],
  };
}

export function floorNote(floor: number | undefined): string | undefined {
  if (floor === undefined) return undefined;
  return floor < 0 ? `지하 ${-floor}층` : `${floor}층`;
}

/** 기구 목록을 모르는 곳을 직접 등록할 때의 출발점. */
export function blankGym(name: string, note?: string): GymEntry {
  return {
    id: `gym-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    name,
    note,
    equipmentIds: [...COMMON_EQUIPMENT_IDS],
  };
}

export interface GymDiff {
  /** 옮긴 곳에 없어서 못 하는 종목 */
  lost: Exercise[];
  /** 옮긴 곳에서 새로 할 수 있는 종목 */
  gained: Exercise[];
  addedEquipment: string[];
  removedEquipment: string[];
}

/** 헬스장을 바꿨을 때 무엇이 달라지는지. 전환 전에 보여준다. */
export function compareGyms(
  from: GymSelection,
  to: GymSelection,
  pool: readonly Exercise[] = EXERCISES,
): GymDiff {
  const before = new Set(availableExercises(from.equipmentIds, pool).map((e) => e.id));
  const after = new Set(availableExercises(to.equipmentIds, pool).map((e) => e.id));
  const fromIds = new Set(from.equipmentIds);
  const toIds = new Set(to.equipmentIds);

  const label = (id: string) => equipmentItem(id)?.name ?? id;

  return {
    lost: pool.filter((exercise) => before.has(exercise.id) && !after.has(exercise.id)),
    gained: pool.filter((exercise) => !before.has(exercise.id) && after.has(exercise.id)),
    addedEquipment: to.equipmentIds.filter((id) => !fromIds.has(id)).map(label),
    removedEquipment: from.equipmentIds.filter((id) => !toIds.has(id)).map(label),
  };
}

/* ── 거리 ─────────────────────────────────────────────── */

function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

function toRad(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/* ── 등록 ──────────────────────────────────────────────── */

export type RegisterOutcome = 'joined' | 'confirm' | 'created';

export interface RegisterResult {
  outcome: RegisterOutcome;
  /** joined·created면 쓸 항목, confirm이면 아직 없다 */
  entry?: GymDirectoryEntry;
  /** confirm일 때 사용자에게 보여줄 후보들 */
  candidates: DuplicateHit[];
  message: string;
}

export interface RegisterInput {
  name: string;
  address?: string;
  location?: { lat: number; lng: number };
  floor?: number;
  equipmentIds?: string[];
  /** 헬스장 유형. 주면 기구 목록이 여기서 채워진다 */
  presetId?: string;
  /** 검색에 노출할지. 안 주면 유형이 정한다 */
  visibility?: GymVisibility;
  directory?: readonly GymDirectoryEntry[];
  /** 후보를 보고도 "새로 만들겠다"고 한 경우 */
  force?: boolean;
  /**
   * 지금 확인하지 않고 나중에 묻는다.
   * 후보를 pendingMergeWith에 적어두고 일단 등록한다.
   */
  defer?: boolean;
  today?: string;
}

/**
 * 헬스장 등록.
 *
 * 이 함수를 거치지 않으면 새 항목을 만들 수 없게 하는 게 핵심이다. 지금까지는
 * blankGym()을 아무 때나 불러서 바로 새 id가 나왔고, 그래서 B가 "상구 헬스장"을
 * 다시 만들 수 있었다.
 *
 * 세 갈래로만 끝난다.
 *   joined  — 확실히 같은 곳이 이미 있다. 그걸 쓴다.
 *   confirm — 비슷한 게 있다. 사용자가 고르기 전에는 만들지 않는다.
 *   created — 겹치는 게 없다. 새로 만든다.
 */
export function registerGym(input: RegisterInput): RegisterResult {
  const directory = input.directory ?? SAMPLE_DIRECTORY;
  const identity = {
    name: input.name,
    address: input.address,
    location: input.location,
    floor: input.floor,
  };

  const preset = input.presetId ? gymPresetOf(input.presetId) : undefined;
  const visibility = input.visibility ?? preset?.visibility ?? 'public';

  /*
   * 아파트·회사·홈짐은 남의 것과 비교하지 않는다.
   * 같은 단지 주민이 올린 항목과 합쳐질 이유가 없고, 옆 동 사람의 홈짐이
   * 후보로 뜨는 건 사생활 문제다.
   */
  const pool = visibility === 'private'
    ? directory.filter((entry) => entry.visibility === 'private')
    : directory.filter((entry) => entry.visibility !== 'private');

  const hits = findDuplicates(identity, pool);
  const exact = hits.find((hit) => hit.match.verdict === 'same');

  if (exact) {
    return {
      outcome: 'joined',
      entry: exact.entry,
      candidates: hits,
      message: `이미 등록된 곳입니다 — ${exact.entry.name}. ${exact.match.reason}`,
    };
  }

  if (hits.length > 0 && !input.force && !input.defer) {
    return {
      outcome: 'confirm',
      candidates: hits,
      message: `비슷한 곳이 ${hits.length}곳 있습니다. 같은 곳이면 골라 주세요.`,
    };
  }

  const equipmentIds = input.equipmentIds
    ?? (input.presetId ? presetEquipment(input.presetId) : undefined)
    ?? [...COMMON_EQUIPMENT_IDS];

  const entry: GymDirectoryEntry = {
    id: gymKey(identity),
    name: input.name.trim(),
    address: input.address ?? '',
    location: input.location,
    floor: input.floor ?? parseFloor(input.address),
    equipmentIds: [...equipmentIds],
    source: 'user',
    visibility,
    // 나중에 묻기로 한 후보는 적어둔다. 그냥 버리면 영영 못 합친다.
    pendingMergeWith: input.defer && hits.length > 0
      ? hits.map((hit) => hit.entry.id)
      : undefined,
    verifiedAt: input.today,
  };

  return {
    outcome: 'created',
    entry,
    candidates: hits,
    message: hits.length === 0
      ? '새 헬스장으로 등록했습니다.'
      : input.defer
        ? `비슷한 곳 ${hits.length}곳은 나중에 확인합니다. 지금은 이대로 씁니다.`
        : '비슷한 곳이 있었지만 새로 만들었습니다.',
  };
}

/* ── 나중에 확인하기 ───────────────────────────────────── */

export interface PendingMerge {
  entry: GymDirectoryEntry;
  others: GymDirectoryEntry[];
}

/**
 * 아직 확인하지 않은 중복 후보.
 *
 * 등록할 때 "나중에"를 고른 것들이다. 헬스장을 검색하거나 목록을 열었을 때
 * 한 번씩 물어서 정리한다 — 그때가 사용자가 헬스장을 생각하고 있는
 * 순간이라 대답하기 쉽다.
 */
export function pendingMerges(directory: readonly GymDirectoryEntry[]): PendingMerge[] {
  const byId = new Map(directory.map((entry) => [entry.id, entry]));

  return directory
    .filter((entry) => (entry.pendingMergeWith ?? []).length > 0)
    .map((entry) => ({
      entry,
      others: (entry.pendingMergeWith ?? [])
        .map((id) => byId.get(id))
        .filter((other): other is GymDirectoryEntry => Boolean(other)),
    }))
    .filter((item) => item.others.length > 0);
}

/**
 * 확인을 끝냈다고 표시한다 — 합쳤든 아니라고 했든.
 *
 * mergedInto를 주면 entryId가 그쪽으로 흡수되어 사라진다. 안 주면 "다른
 * 곳이다"로 보고 둘 다 남기되, 다시 묻지 않도록 짝을 지운다.
 */
export function resolvePending(
  directory: readonly GymDirectoryEntry[],
  entryId: string,
  mergedInto?: string,
): GymDirectoryEntry[] {
  const source = directory.find((entry) => entry.id === entryId);

  const drop = (entry: GymDirectoryEntry, remove: string) => {
    const rest = (entry.pendingMergeWith ?? []).filter((id) => id !== remove);
    return rest.length > 0
      ? { ...entry, pendingMergeWith: rest }
      : { ...entry, pendingMergeWith: undefined };
  };

  return directory
    .map((entry) => {
      // 정리한 항목 자신의 대기 목록은 통째로 비운다.
      if (entry.id === entryId) return { ...entry, pendingMergeWith: undefined };

      if (mergedInto && entry.id === mergedInto && source) {
        const merged = mergeGymRecords(entry, source);
        return drop({
          ...merged,
          /*
           * 사용자가 목록에서 이쪽을 골라 "여기로 합친다"고 했다. 그러면
           * 이쪽 이름으로 남아야 한다 — 기구는 최근 확인이 이기지만, 이름은
           * 사용자가 방금 고른 것이 이긴다.
           */
          name: entry.name,
          pendingMergeWith: entry.pendingMergeWith,
        }, entryId);
      }

      // 이 짝은 어느 쪽으로 끝났든 다시 물을 필요가 없다.
      return drop(entry, entryId);
    })
    .filter((entry) => !(mergedInto && entry.id === entryId));
}

/**
 * 두 기록을 합친다.
 *
 * 합집합이 아니다. 기구마다 마지막으로 확인된 시각을 보고 최근 쪽을 따른다.
 * 합집합으로 합치면 없어진 기구가 영원히 남는다 — 한 번 "있음"이 들어가면
 * 누구도 지울 수 없게 된다.
 */
export function mergeGymRecords(
  base: GymDirectoryEntry,
  incoming: GymDirectoryEntry,
): GymDirectoryEntry {
  const verified: Record<string, string> = {};
  const present = new Set<string>();
  const absent = new Set<string>();

  const apply = (entry: GymDirectoryEntry) => {
    const fallback = entry.verifiedAt ?? '';
    const stamps = entry.equipmentVerifiedAt ?? {};

    const consider = (id: string, isPresent: boolean) => {
      const at = stamps[id] ?? fallback;
      const known = verified[id];
      // 같은 시각이면 "없음"을 믿는다. 사라진 기구를 남겨두는 쪽이 더 해롭다.
      if (known !== undefined && at < known) return;
      if (known !== undefined && at === known && isPresent) return;
      verified[id] = at;
      if (isPresent) {
        present.add(id);
        absent.delete(id);
      } else {
        absent.add(id);
        present.delete(id);
      }
    };

    for (const id of entry.equipmentIds) consider(id, true);
    for (const id of entry.absentEquipmentIds ?? []) consider(id, false);
  };

  apply(base);
  apply(incoming);

  const newest = [base.verifiedAt, incoming.verifiedAt]
    .filter((value): value is string => Boolean(value))
    .sort()
    .pop();

  return {
    ...base,
    // 사람이 더 최근에 손본 쪽의 이름·주소를 믿는다.
    name: (incoming.verifiedAt ?? '') > (base.verifiedAt ?? '') ? incoming.name : base.name,
    address: incoming.address || base.address,
    location: base.location ?? incoming.location,
    floor: base.floor ?? incoming.floor,
    equipmentIds: [...present].sort(),
    absentEquipmentIds: [...absent].sort(),
    equipmentVerifiedAt: verified,
    source: base.source === 'official' || incoming.source === 'official' ? 'official' : 'community',
    verifiedAt: newest,
  };
}

/* ── 여러 곳을 다니는 사람 ─────────────────────────────── */

/**
 * 세 곳 이상 다니는 사람은 드물지 않다. 평일은 회사 근처, 주말은 집 근처,
 * 가끔 출장지. 매번 손으로 고르게 하면 안 쓰게 된다.
 */
export interface GymRoutine {
  /** 요일별 기본 헬스장 (0=일 … 6=토) */
  byWeekday?: Record<number, string>;
}

/** 그 요일에 갈 곳. 정해둔 게 없으면 마지막으로 쓴 곳. */
export function gymForWeekday(
  book: GymBook,
  weekday: number,
  routine?: GymRoutine,
): GymEntry | undefined {
  const planned = routine?.byWeekday?.[weekday];
  if (planned) {
    const found = book.gyms.find((gym) => gym.id === planned);
    if (found) return found;
  }
  return activeGym(book) ?? mostRecentGym(book);
}

export function mostRecentGym(book: GymBook): GymEntry | undefined {
  return [...book.gyms].sort((a, b) => (b.lastUsedAt ?? '').localeCompare(a.lastUsedAt ?? ''))[0];
}

export interface GymSuggestion {
  gym: GymEntry;
  distanceM: number;
  /** 지금 선택된 곳과 다른가 */
  switchNeeded: boolean;
}

/**
 * 지금 있는 위치로 어디에 왔는지 맞춘다.
 *
 * 헬스장에 도착해서 앱을 열면 이미 그 헬스장으로 맞춰져 있어야 한다.
 * 세 곳을 다니는 사람에게 매번 고르게 하면 잘못 고른 채로 운동하게 된다.
 */
export function suggestGymByLocation(
  book: GymBook,
  here: { lat: number; lng: number },
  directory: readonly GymDirectoryEntry[] = SAMPLE_DIRECTORY,
  withinM = 150,
): GymSuggestion | undefined {
  let best: GymSuggestion | undefined;

  for (const gym of book.gyms) {
    const entry = directory.find((item) => item.id === gym.id);
    if (!entry?.location) continue;
    const distanceM = Math.round(metersApart(here, entry.location));
    if (distanceM > withinM) continue;
    if (!best || distanceM < best.distanceM) {
      best = { gym, distanceM, switchNeeded: gym.id !== book.activeId };
    }
  }

  return best;
}

function metersApart(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  return distanceKm(a, b) * 1000;
}
