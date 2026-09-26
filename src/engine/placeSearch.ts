/**
 * 실제 헬스장 찾기 — 장소 검색 결과를 우리 헬스장 목록으로 옮기는 층.
 *
 * "경기도"를 쳤는데 아무것도 안 나오면 사용자는 앱이 고장 났다고 본다.
 * 검색이 없는 것과 검색이 안 되는 것은 화면에서 구분이 안 되기 때문이다.
 *
 * 여기는 순수 함수만 둔다. 실제로 불러오는 쪽(카카오 로컬 API)은
 * prototype/gymSearch.js에 있고, 이 파일은 그쪽이 준 결과를 다듬는다.
 * 그렇게 갈라 두면 나중에 다른 데이터로 바꿔도 이 판단은 그대로 쓴다.
 *
 * 하나 분명히 해 둘 것: 장소 검색은 **이름과 주소만** 준다. 거기에 핵스쿼트가
 * 있는지는 아무도 모른다. 그건 이 앱이 사람에게 받아서 쌓는 정보고, 검색은
 * 그 앞의 "어느 헬스장인지 정하기"까지만 한다.
 */

export type PlaceKind = 'gym' | 'crossfit' | 'pilates' | 'yoga' | 'other';

/** 검색이 돌려준 장소 하나. 좌표는 있을 수도 없을 수도 있다. */
export interface Place {
  /** 제공자가 준 id. 우리 헬스장 id가 아니다 — 등록할 때 다시 만든다. */
  sourceId: string;
  name: string;
  /** 도로명 주소가 있으면 그것, 없으면 지번 */
  address: string;
  roadAddress?: string;
  jibunAddress?: string;
  location?: { lat: number; lng: number };
  kind: PlaceKind;
  /** 제공자가 붙인 분류 문자열 그대로 */
  category?: string;
  phone?: string;
  /** m 단위. 내 위치를 같이 보냈을 때만 있다. */
  distanceM?: number;
  /** 제공자 상세 페이지 */
  url?: string;
}

/* ── 무엇을 보낼 것인가 ───────────────────────────────── */

/**
 * 광역시·도. 짧게 치는 쪽이 보통이라 별칭을 같이 둔다.
 * "경기"와 "경기도"가 다르게 동작하면 그건 그냥 버그로 보인다.
 */
const REGIONS: readonly string[] = [
  '서울', '서울특별시', '부산', '부산광역시', '대구', '대구광역시',
  '인천', '인천광역시', '광주', '광주광역시', '대전', '대전광역시',
  '울산', '울산광역시', '세종', '세종특별자치시',
  '경기', '경기도', '강원', '강원도', '강원특별자치도',
  '충북', '충청북도', '충남', '충청남도',
  '전북', '전라북도', '전북특별자치도', '전남', '전라남도',
  '경북', '경상북도', '경남', '경상남도',
  '제주', '제주도', '제주특별자치도',
];

/**
 * 시설을 가리키는 말. 이게 질의에 이미 있으면 우리가 덧붙이지 않는다.
 *
 * gymIdentity의 접미사 목록과 겹치지만 일부러 따로 둔다. 저쪽은 "이름에서
 * 브랜드를 떼는" 칼이고 이쪽은 "검색어에 종류가 들어 있나"를 보는 눈이라,
 * 한쪽을 고칠 때 다른 쪽이 따라 움직이면 안 된다.
 */
const FACILITY_WORDS: readonly string[] = [
  '헬스', '휘트니스', '피트니스', '짐', '체육관', '크로스핏', '필라테스', '요가',
  '스포츠센터', '트레이닝', 'gym', 'fitness', 'crossfit',
];

/** 지역만 가리키는 꼬리말. "성남시", "분당구", "정자동", "강남역". */
const PLACE_TAILS: readonly string[] = ['도', '시', '군', '구', '동', '읍', '면', '리', '역'];

const GYM_WORD = '헬스장';

export interface ParsedQuery {
  /** 사용자가 친 그대로 */
  raw: string;
  /** 실제로 제공자에게 보낼 말 */
  query: string;
  /** 우리가 '헬스장'을 붙였는가 — 화면에서 그렇게 찾았다고 말해 줘야 한다 */
  appendedGymWord: boolean;
  /** 보낼 만한가. 한 글자로는 전국이 쏟아진다. */
  searchable: boolean;
}

/**
 * 친 말을 보낼 말로 바꾼다.
 *
 * "경기도" 하나만 보내면 도청이 나온다. 지역만 친 것으로 보이면 '헬스장'을
 * 붙인다. 반대로 "스포애니"처럼 상호를 친 것에 '헬스장'을 붙이면 오히려
 * 지점이 안 잡히므로 그대로 보낸다.
 *
 * 판단 기준은 "시설을 가리키는 말이 이미 있는가"와 "지역처럼 끝나는가"다.
 * 둘 다 아니면 상호로 보고 건드리지 않는다.
 */
export function parsePlaceQuery(raw: string): ParsedQuery {
  const text = (raw ?? '').trim().replace(/\s+/g, ' ');
  if (text.length < 2) {
    return { raw: text, query: text, appendedGymWord: false, searchable: false };
  }

  const lower = text.toLowerCase();
  const hasFacility = FACILITY_WORDS.some((word) => lower.includes(word.toLowerCase()));
  if (hasFacility) {
    return { raw: text, query: text, appendedGymWord: false, searchable: true };
  }

  const words = text.split(' ');
  const last = words[words.length - 1] ?? '';
  const looksRegional =
    words.every((word) => REGIONS.includes(word)) ||
    (last.length >= 2 && PLACE_TAILS.includes(last.slice(-1)));

  return looksRegional
    ? { raw: text, query: `${text} ${GYM_WORD}`, appendedGymWord: true, searchable: true }
    : { raw: text, query: text, appendedGymWord: false, searchable: true };
}

/* ── 무엇이 돌아왔는가 ───────────────────────────────── */

/**
 * 분류 문자열에서 종류를 읽는다.
 *
 * "헬스장"으로 검색해도 필라테스·요가가 섞여 나온다. 빼지는 않는다 —
 * 실제로 거기 다니는 사람이 있고, 맨몸 운동은 어디서든 된다. 대신 뒤로 민다.
 * 긴 말부터 본다: '크로스핏'을 '핏'으로 잘라 읽으면 안 된다.
 */
export function placeKind(category: string | undefined): PlaceKind {
  const text = (category ?? '').toLowerCase();
  if (text.includes('크로스핏') || text.includes('crossfit')) return 'crossfit';
  if (text.includes('필라테스') || text.includes('pilates')) return 'pilates';
  if (text.includes('요가') || text.includes('yoga')) return 'yoga';
  if (
    text.includes('헬스') || text.includes('피트니스') || text.includes('휘트니스') ||
    text.includes('체력단련') || text.includes('스포츠클럽') || text.includes('gym') ||
    text.includes('fitness')
  ) {
    return 'gym';
  }
  return 'other';
}

export const KIND_LABELS_KO: Record<PlaceKind, string> = {
  gym: '헬스장',
  crossfit: '크로스핏',
  pilates: '필라테스',
  yoga: '요가',
  other: '기타',
};

/** 제공자가 준 날것 한 줄. 카카오 로컬 API의 document 모양을 그대로 받는다. */
export interface RawPlace {
  id?: string;
  place_name?: string;
  category_name?: string;
  address_name?: string;
  road_address_name?: string;
  phone?: string;
  x?: string | number;
  y?: string | number;
  distance?: string | number;
  place_url?: string;
}

const numberOr = (value: string | number | undefined): number | undefined => {
  if (value === undefined || value === null || value === '') return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
};

export interface NormalizeOptions {
  /** 내 위치. 제공자가 거리를 안 줬을 때 여기서 잰다. */
  near?: { lat: number; lng: number };
}

/**
 * 날것을 우리 모양으로.
 *
 * 이름이 없는 줄은 버린다. 화면에 빈 줄이 뜨면 사용자는 누를 수가 없다.
 */
export function normalizePlaces(
  raw: readonly RawPlace[],
  options: NormalizeOptions = {},
): Place[] {
  const out: Place[] = [];

  for (const item of raw) {
    const name = (item.place_name ?? '').trim();
    if (name.length === 0) continue;

    const lng = numberOr(item.x);
    const lat = numberOr(item.y);
    const location = lat !== undefined && lng !== undefined ? { lat, lng } : undefined;

    const road = (item.road_address_name ?? '').trim() || undefined;
    const jibun = (item.address_name ?? '').trim() || undefined;

    // 제공자가 잰 거리를 먼저 믿는다. 없고 좌표가 있으면 우리가 잰다.
    const given = numberOr(item.distance);
    const distanceM = given !== undefined
      ? Math.round(given)
      : options.near && location
        ? Math.round(metersApart(options.near, location))
        : undefined;

    out.push({
      sourceId: String(item.id ?? `${name}@${road ?? jibun ?? ''}`),
      name,
      address: road ?? jibun ?? '',
      roadAddress: road,
      jibunAddress: jibun,
      location,
      kind: placeKind(item.category_name),
      category: (item.category_name ?? '').trim() || undefined,
      phone: (item.phone ?? '').trim() || undefined,
      distanceM,
      url: (item.place_url ?? '').trim() || undefined,
    });
  }

  return dedupePlaces(out);
}

/**
 * 같은 곳이 두 번 오는 것을 막는다.
 *
 * 한 건물에 층만 다른 두 지점은 주소가 같아도 다른 곳이다. 그래서 이름까지
 * 같을 때만 접는다 — 애매하면 합치지 않는다. 과병합이 미병합보다 나쁘다는
 * 규칙은 여기서도 같다.
 */
function dedupePlaces(places: readonly Place[]): Place[] {
  const seen = new Set<string>();
  const out: Place[] = [];
  for (const place of places) {
    const key = `${place.name.replace(/\s/g, '')}|${place.address.replace(/\s/g, '')}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(place);
  }
  return out;
}

const KIND_ORDER: Record<PlaceKind, number> = {
  gym: 0, crossfit: 1, other: 2, pilates: 3, yoga: 4,
};

/**
 * 순서.
 *
 * 종류를 거리보다 앞에 둔다. 50m 앞 요가원보다 500m 앞 헬스장이 지금 찾는
 * 곳일 확률이 훨씬 높다. 같은 종류 안에서만 가까운 순이다.
 */
export function rankPlaces(places: readonly Place[]): Place[] {
  return places
    .map((place, i) => ({ place, i }))
    .sort((a, b) => {
      const kind = KIND_ORDER[a.place.kind] - KIND_ORDER[b.place.kind];
      if (kind !== 0) return kind;

      const ad = a.place.distanceM;
      const bd = b.place.distanceM;
      if (ad !== undefined && bd !== undefined && ad !== bd) return ad - bd;
      if (ad !== undefined && bd === undefined) return -1;
      if (ad === undefined && bd !== undefined) return 1;

      return a.i - b.i; // 제공자가 준 순서를 마지막 기준으로 둔다
    })
    .map((entry) => entry.place);
}

/** "1.2km" · "320m" — 거리를 모르면 아무 말도 안 한다. */
export function distanceLabel(distanceM: number | undefined): string | undefined {
  if (distanceM === undefined) return undefined;
  if (distanceM < 1000) return `${Math.round(distanceM / 10) * 10}m`;
  return `${(distanceM / 1000).toFixed(1)}km`;
}

/** 검색 줄 아래에 붙는 한 줄. 종류 · 거리 · 주소. */
export function placeLine(place: Place): string {
  const parts: string[] = [KIND_LABELS_KO[place.kind]];
  const distance = distanceLabel(place.distanceM);
  if (distance) parts.push(distance);
  if (place.address) parts.push(place.address);
  return parts.join(' · ');
}

/* ── 등록으로 넘기기 ─────────────────────────────────── */

export interface PlaceDraft {
  name: string;
  /** 주소 + 층. registerGym이 여기서 층을 읽어 같은 건물 다른 층을 가른다. */
  address: string;
  location?: { lat: number; lng: number };
  /** 검색으로 왔다는 표시 — 나중에 다시 확인할 때 쓴다 */
  sourceId: string;
}

/**
 * 고른 장소를 등록 서식으로.
 *
 * 층은 안 채운다. 카카오도 공공데이터도 층을 주지 않고, 모르는 것을 채워
 * 넣으면 같은 건물 3층과 5층이 한 곳으로 합쳐진다. 비워 두고 사람에게 묻는
 * 편이 낫다 — 그 사람은 지금 그 건물 앞에 있다.
 */
export function placeToDraft(place: Place, floor?: string): PlaceDraft {
  const trimmed = (floor ?? '').trim();
  return {
    name: place.name,
    address: [place.address, trimmed].filter((part) => part.length > 0).join(' '),
    location: place.location,
    sourceId: place.sourceId,
  };
}

/* ── 안 될 때 ────────────────────────────────────────── */

export type SearchFailure =
  | 'noKey' | 'notConfigured' | 'badKey' | 'forbidden' | 'quota' | 'network' | 'server';

/**
 * 왜 안 됐는지를 사람 말로.
 *
 * "검색 실패"는 아무것도 알려주지 않는다. 키가 틀린 것과 지하라서 안 터지는
 * 것은 사용자가 할 일이 완전히 다르다. 어느 쪽인지 말해 주지 않으면 둘 다
 * 그냥 "고장"이 된다.
 */
export function describeSearchFailure(kind: SearchFailure): string {
  switch (kind) {
    case 'noKey':
      return '아직 검색을 켜지 않았습니다. 지금은 헬스장을 직접 등록해서 쓰시면 됩니다.';
    case 'notConfigured':
      /*
       * 서버 쪽 설정이 덜 된 것이다. 사용자는 열쇠를 넣은 적이 없으므로
       * "키가 틀렸습니다"라고 하면 그건 거짓말이고, 사용자가 고칠 수도
       * 없는 일로 고치라고 미는 셈이 된다. 할 수 있는 것만 말한다.
       */
      return '검색이 아직 준비되지 않았습니다. 그동안은 직접 등록으로 넣을 수 있습니다.';
    case 'badKey':
      return '키가 맞지 않습니다. 카카오 개발자 사이트의 REST API 키인지 확인해 주세요.';
    case 'forbidden':
      return '이 키로는 장소 검색을 쓸 수 없습니다. 카카오 개발자 사이트에서 이 앱의 카카오맵 기능을 켜 주세요.';
    case 'quota':
      return '오늘 검색 한도를 다 썼습니다. 내일 다시 되고, 그동안은 직접 등록으로 넣을 수 있습니다.';
    case 'network':
      return '연결이 안 됩니다. 헬스장 지하라면 밖에서 한 번 더 해 보세요 — 등록은 한 번만 하면 됩니다.';
    default:
      return '검색 쪽에 문제가 있습니다. 잠시 뒤에 다시 해 보세요.';
  }
}

/** HTTP 응답 코드를 실패 종류로. */
export function failureFromStatus(status: number): SearchFailure {
  if (status === 401) return 'badKey';
  if (status === 403) return 'forbidden';
  if (status === 429) return 'quota';
  return 'server';
}

/**
 * 카카오 REST API 키인가.
 *
 * 32자리 16진수다. 형식만 본다 — 맞는지는 서버가 안다. 다만 명백히 다른 것을
 * 붙여 넣었을 때 "검색 실패"가 아니라 "이건 키가 아닙니다"라고 말해 주려는
 * 것이다. 사람들은 보통 JavaScript 키나 네이티브 앱 키를 잘못 가져온다.
 */
export function looksLikeKakaoKey(key: string): boolean {
  return /^[0-9a-f]{32}$/i.test((key ?? '').trim());
}

/* ── 자 ──────────────────────────────────────────────── */

function metersApart(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
