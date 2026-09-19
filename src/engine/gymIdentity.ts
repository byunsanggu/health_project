/**
 * 헬스장 신원 판정.
 *
 * A가 "상구헬스장"을 등록했는데 B가 "상구 헬스장"으로 다시 만들면, 같은 곳의
 * 기구 정보가 두 벌로 쪼개진다. 다섯 명이 각자 반쪽짜리를 채우면 크라우드소싱은
 * 그대로 죽는다.
 *
 * 그렇다고 마구 합치면 더 나쁘다. 미병합은 불편할 뿐이지만, 과병합은 없는
 * 기구로 처방이 나가서 사용자가 헬스장에 가서 못 한다. 그래서 애매하면
 * 합치지 않고 사람에게 묻는다.
 *
 * 판정의 축은 이름이 아니라 위치다. 같은 이름 다른 곳("헬스킹"은 전국에
 * 여럿)과 다른 이름 같은 곳(간판이 바뀌거나 사람마다 다르게 기억한다)이
 * 둘 다 흔하기 때문이다.
 */
import type { GymDirectoryEntry } from './gyms.ts';

export type GymMatchVerdict = 'same' | 'candidate' | 'different';

export interface GymMatch {
  verdict: GymMatchVerdict;
  /** 이름 유사도 (0~1) */
  nameScore: number;
  distanceM?: number;
  /** 왜 이렇게 판정했는지 — 사용자에게 그대로 보여줄 수 있어야 한다 */
  reason: string;
}

export interface ParsedGymName {
  /** 원본 */
  raw: string;
  /** 공백·기호를 털어낸 전체 이름 */
  normalized: string;
  /** 지점 표시를 뗀 부분 — "상구헬스장수원점" → "상구헬스장수원" */
  core: string;
  /** 시설 접미사 앞부분 — "상구헬스장수원점" → "상구" */
  brand: string;
  /** 지점명 — "상구헬스장수원점" → "수원" */
  branch?: string;
  /** '점' 같은 지점 표시가 붙어 있었는가 */
  hasBranchMarker: boolean;
  /** 찾아낸 시설 접미사 — 헬스장 · 피트니스 … */
  facility?: string;
}

/**
 * 시설 접미사.
 *
 * 이게 브랜드와 지점을 가르는 칼이 된다 — "상구헬스장수원점"처럼 띄어쓰기가
 * 없어도 '헬스장'을 찾으면 앞은 브랜드, 뒤는 지점이다.
 * 긴 것부터 본다. '헬스클럽'을 '헬스'로 자르면 안 된다.
 */
const FACILITY_SUFFIXES = [
  '스포츠센터', '스포츠클럽', '피트니스클럽', '헬스클럽', '피트니스', '휘트니스',
  '크로스핏', '헬스장', '트레이닝', '스튜디오', '센터', '헬스', '짐',
  'fitness', 'crossfit', 'studio', 'center', 'club', 'gym',
];

/** 지점 표시. 긴 것부터 떼어낸다. */
const BRANCH_MARKERS = ['지점', '점', 'branch'];

/** 이름 판정에서 의미가 없는 말. 있으나 없으나 같은 곳이다. */
const NOISE = ['주식회사', '㈜', '본점'];

/** 괄호를 지우기 전에 떼야 하는 것들 — (주)를 그냥 지우면 '주'가 브랜드에 남는다. */
const LEGAL_PREFIXES = /\((주|유|사|재|합)\)/g;

export function normalizeGymName(raw: string): ParsedGymName {
  let normalized = raw
    .toLowerCase()
    .replace(LEGAL_PREFIXES, '')
    // 공백·기호를 전부 턴다. "상구 헬스장"과 "상구헬스장"은 같은 이름이다.
    .replace(/[\s·・.,()[\]{}_\-–—/\\'"`!?&+*#@~]/g, '');

  for (const noise of NOISE) normalized = normalized.split(noise).join('');

  let core = normalized;
  let hasBranchMarker = false;
  for (const marker of BRANCH_MARKERS) {
    if (core.length > marker.length && core.endsWith(marker)) {
      core = core.slice(0, -marker.length);
      hasBranchMarker = true;
      break;
    }
  }

  // 시설 접미사를 찾아 앞뒤로 가른다.
  let brand = core;
  let branch: string | undefined;
  let facility: string | undefined;

  for (const suffix of FACILITY_SUFFIXES) {
    const at = core.lastIndexOf(suffix);
    if (at <= 0) continue;
    facility = suffix;
    brand = core.slice(0, at);
    const rest = core.slice(at + suffix.length);
    if (rest.length > 0) branch = rest;
    break;
  }

  return { raw, normalized, core, brand, branch, hasBranchMarker, facility };
}

/* ── 층 ────────────────────────────────────────────────── */

/**
 * 같은 건물 2층과 5층에 다른 헬스장이 있다. 실제로 흔하다.
 * 좌표만 보면 0m라 반드시 같은 곳으로 합쳐지므로, 층은 신원의 일부다.
 */
export function parseFloor(text: string | undefined): number | undefined {
  if (!text) return undefined;
  const cleaned = text.toLowerCase().replace(/\s/g, '');

  const basement = cleaned.match(/(지하|b)(\d+)(층|f)?/);
  if (basement) return -Number(basement[2]);

  const above = cleaned.match(/(\d+)(층|f)/);
  if (above) return Number(above[1]);

  return undefined;
}

export function floorOf(entry: Pick<GymDirectoryEntry, 'address'> & { floor?: number }): number | undefined {
  return entry.floor ?? parseFloor(entry.address);
}

/* ── 결정적 id ─────────────────────────────────────────── */

/**
 * 좌표와 이름에서 id를 만든다.
 *
 * 지금처럼 시각+난수로 만들면 A와 B가 같은 헬스장을 등록해도 영원히 다른
 * id를 갖는다. 서버가 붙는 순간 합칠 근거가 사라진다. 좌표를 격자로 반올림하고
 * 정규화한 이름을 섞으면, 각자 등록해도 같은 값이 나온다.
 *
 * 격자 경계에 걸치면 갈라지는 건 막을 수 없다. 그건 matchGym이 잡는다.
 */
const GRID_DECIMALS = 3; // 약 110m

export function gymKey(input: {
  name: string;
  location?: { lat: number; lng: number };
  address?: string;
  floor?: number;
}): string {
  const parsed = normalizeGymName(input.name);
  const floor = input.floor ?? parseFloor(input.address);
  const cell = input.location
    ? `${input.location.lat.toFixed(GRID_DECIMALS)},${input.location.lng.toFixed(GRID_DECIMALS)}`
    : 'noloc';

  const seed = `${cell}|${parsed.brand}|${parsed.branch ?? ''}|${floor ?? ''}`;
  return `g_${hash(seed)}`;
}

/** FNV-1a. 암호용이 아니라 같은 입력에 같은 값이 나오면 된다. */
function hash(text: string): string {
  let value = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    value ^= text.charCodeAt(i);
    value = Math.imul(value, 0x01000193) >>> 0;
  }
  return value.toString(36).padStart(7, '0');
}

/* ── 이름 유사도 ───────────────────────────────────────── */

/** 문자 2-gram Dice 계수. 한글에서 편집거리보다 오탈자에 덜 민감하다. */
export function nameSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length === 0 || b.length === 0) return 0;
  if (a.length === 1 || b.length === 1) return a === b ? 1 : 0;

  const bigrams = (text: string) => {
    const out = new Map<string, number>();
    for (let i = 0; i < text.length - 1; i += 1) {
      const pair = text.slice(i, i + 2);
      out.set(pair, (out.get(pair) ?? 0) + 1);
    }
    return out;
  };

  const left = bigrams(a);
  const right = bigrams(b);
  let shared = 0;
  for (const [pair, count] of left) {
    const other = right.get(pair);
    if (other) shared += Math.min(count, other);
  }

  return (2 * shared) / (a.length - 1 + b.length - 1);
}

/**
 * 이름 비교는 브랜드로 한다.
 *
 * "상구헬스장"과 "상구피트니스"를 통째로 비교하면 0.2가 나온다. 시설 접미사가
 * 달라서 글자가 안 겹치기 때문인데, 실제로는 간판만 바꾼 같은 곳인 경우가
 * 훨씬 많다. 브랜드끼리 비교해야 "상구" = "상구" 가 보인다.
 */
export function compareNames(a: ParsedGymName, b: ParsedGymName): number {
  const whole = nameSimilarity(a.core, b.core);
  if (!a.brand || !b.brand) return whole;
  // 브랜드가 더 잘 맞으면 그쪽을 믿는다. 접미사 차이로 깎이지 않게 한다.
  return Math.max(whole, nameSimilarity(a.brand, b.brand));
}

/* ── 판정 ──────────────────────────────────────────────── */

export interface MatchOptions {
  /** 이 거리 안이면 같은 자리로 본다 (m) */
  sameSpotM?: number;
  /** GPS 오차를 감안해 후보로 볼 거리 (m) */
  nearbyM?: number;
  /** 같은 자리에서 같은 곳으로 인정할 이름 유사도 */
  sameSpotName?: number;
  /** 떨어져 있어도 같은 곳으로 인정할 이름 유사도 */
  nearbyName?: number;
  /** 이름이 글자까지 같을 때 후보로 띄울 최대 거리 (m) */
  farSameNameM?: number;
}

const DEFAULTS: Required<MatchOptions> = {
  sameSpotM: 50,
  nearbyM: 200,
  sameSpotName: 0.6,
  nearbyName: 0.9,
  farSameNameM: 600,
};

export interface GymIdentityInput {
  name: string;
  address?: string;
  location?: { lat: number; lng: number };
  floor?: number;
}

/**
 * 두 곳이 같은 헬스장인가.
 *
 * 순서가 중요하다. 층과 지점은 거리보다 먼저 본다 — 좌표가 0m여도
 * 3층과 5층은 다른 헬스장이고, 수원점과 이천점은 다른 헬스장이다.
 */
export function matchGym(
  a: GymIdentityInput,
  b: GymIdentityInput,
  options: MatchOptions = {},
): GymMatch {
  const config = { ...DEFAULTS, ...options };
  const left = normalizeGymName(a.name);
  const right = normalizeGymName(b.name);
  const nameScore = round2(compareNames(left, right));
  const distance = a.location && b.location ? metersBetween(a.location, b.location) : undefined;
  const distanceM = distance === undefined ? undefined : Math.round(distance);

  const floorA = a.floor ?? parseFloor(a.address);
  const floorB = b.floor ?? parseFloor(b.address);

  // 1) 층이 다르면 같은 건물이어도 다른 헬스장이다.
  if (floorA !== undefined && floorB !== undefined && floorA !== floorB) {
    return {
      verdict: 'different',
      nameScore,
      distanceM,
      reason: `층이 다릅니다 (${floorLabel(floorA)} · ${floorLabel(floorB)}). 같은 건물이어도 다른 헬스장입니다.`,
    };
  }

  // 2) 지점이 다르면 브랜드가 같아도 다른 헬스장이다.
  const branchVerdict = compareBranch(left, right);
  if (branchVerdict === 'different') {
    return {
      verdict: 'different',
      nameScore,
      distanceM,
      reason: `지점이 다릅니다 (${left.branch ?? left.core} · ${right.branch ?? right.core}). 같은 브랜드라도 기구 구성이 다릅니다.`,
    };
  }

  // 3) 위치를 모르면 이름만으로 합치지 않는다.
  if (distance === undefined) {
    if (nameScore >= config.nearbyName && branchVerdict === 'same') {
      return {
        verdict: 'candidate',
        nameScore,
        reason: '이름이 거의 같지만 위치를 몰라 확인이 필요합니다.',
      };
    }
    return { verdict: 'different', nameScore, reason: '위치 정보가 없어 같은 곳으로 볼 근거가 부족합니다.' };
  }

  const unknownFloor = (floorA === undefined) !== (floorB === undefined);

  // 4) 같은 자리
  if (distance <= config.sameSpotM) {
    if (nameScore >= config.sameSpotName && branchVerdict === 'same') {
      if (unknownFloor) {
        return {
          verdict: 'candidate',
          nameScore,
          distanceM,
          reason: '같은 자리에 이름도 거의 같지만, 한쪽만 층이 적혀 있어 확인이 필요합니다.',
        };
      }
      return {
        verdict: 'same',
        nameScore,
        distanceM,
        reason: `${distanceM}m 안에 있고 이름도 같습니다.`,
      };
    }
    return {
      verdict: 'candidate',
      nameScore,
      distanceM,
      // 같은 자리인데 후보에 그친 이유는 둘 중 하나다 — 이름이 다르거나,
      // 한쪽이 지점을 안 밝혔거나. 어느 쪽인지 말해줘야 사용자가 판단한다.
      reason: branchVerdict === 'unknown'
        ? `${distanceM}m 안에 있고 이름도 같지만, 한쪽만 지점을 밝혔습니다. 같은 지점인지 확인해 주세요.`
        : `${distanceM}m 안에 있지만 이름이 다릅니다. 같은 건물의 다른 헬스장일 수 있습니다.`,
    };
  }

  // 5) GPS 오차 범위
  if (distance <= config.nearbyM && nameScore >= config.nearbyName && branchVerdict === 'same') {
    return {
      verdict: unknownFloor ? 'candidate' : 'same',
      nameScore,
      distanceM,
      reason: `${distanceM}m 떨어져 있지만 이름이 거의 같습니다. 실내에서는 위치가 이만큼 튑니다.`,
    };
  }

  // 6) 이름과 지점이 글자까지 똑같으면 더 멀어도 후보로는 띄운다.
  //    실내·지하에서는 좌표가 수백 m 튀는 일이 드물지 않다. 다만 자동으로
  //    합치지는 않는다 — 진짜 다른 지점일 수도 있다.
  if (distance <= config.farSameNameM && nameScore >= 0.99 && branchVerdict === 'same') {
    return {
      verdict: 'candidate',
      nameScore,
      distanceM,
      reason: `${distanceM}m 떨어져 있지만 이름이 글자까지 같습니다. 같은 곳인지 확인해 주세요.`,
    };
  }

  return {
    verdict: 'different',
    nameScore,
    distanceM,
    reason: `${distanceM}m 떨어져 있습니다.`,
  };
}

/**
 * 지점 비교.
 *
 * 둘 다 지점을 밝혔으면 그게 결정적이다. 한쪽만 밝혔으면 모른다 —
 * "상구헬스장"이 수원점일 수도 이천점일 수도 있다.
 */
function compareBranch(a: ParsedGymName, b: ParsedGymName): 'same' | 'different' | 'unknown' {
  if (a.branch && b.branch) return a.branch === b.branch ? 'same' : 'different';

  // 시설 접미사가 없어 지점을 못 가른 경우 — "스포애니강남점" vs "스포애니역삼점"
  if (a.hasBranchMarker && b.hasBranchMarker && !a.branch && !b.branch) {
    return a.core === b.core ? 'same' : 'different';
  }

  if (a.hasBranchMarker !== b.hasBranchMarker) return 'unknown';
  return 'same';
}

function floorLabel(floor: number): string {
  return floor < 0 ? `지하 ${-floor}층` : `${floor}층`;
}

/* ── 중복 찾기 ─────────────────────────────────────────── */

export interface DuplicateHit {
  entry: GymDirectoryEntry;
  match: GymMatch;
}

/**
 * 등록하려는 곳과 겹치는 기존 항목.
 *
 * 'same'이 하나라도 있으면 새로 만들 이유가 없다. 'candidate'만 있으면
 * 사용자에게 보여주고 고르게 한다.
 */
export function findDuplicates(
  candidate: GymIdentityInput,
  directory: readonly GymDirectoryEntry[],
  options: MatchOptions = {},
): DuplicateHit[] {
  return directory
    .map((entry) => ({
      entry,
      match: matchGym(candidate, {
        name: entry.name,
        address: entry.address,
        location: entry.location,
        floor: (entry as GymDirectoryEntry & { floor?: number }).floor,
      }, options),
    }))
    .filter((hit) => hit.match.verdict !== 'different')
    .sort((a, b) => {
      // 확실한 것부터, 그다음 가까운 것부터
      if (a.match.verdict !== b.match.verdict) return a.match.verdict === 'same' ? -1 : 1;
      if (Math.abs(a.match.nameScore - b.match.nameScore) > 0.15) {
        return b.match.nameScore - a.match.nameScore;
      }
      return (a.match.distanceM ?? 1e9) - (b.match.distanceM ?? 1e9);
    });
}

/* ── 거리 ──────────────────────────────────────────────── */

function metersBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371e3;
  const toRad = (value: number) => (value * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
