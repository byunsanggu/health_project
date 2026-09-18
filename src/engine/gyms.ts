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
  /** 등록된 보유 기구 */
  equipmentIds: string[];
  /** 누가 올린 정보인가 — 기구 목록의 신뢰도가 여기서 갈린다 */
  source: DirectorySource;
  /** 마지막으로 확인된 날짜 */
  verifiedAt?: string;
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
    note,
    equipmentIds: [...entry.equipmentIds],
  };
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
