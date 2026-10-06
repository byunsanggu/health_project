/*
 * 헬스장 찾기 — 서버가 대신 물어본다.
 *
 * 왜 서버를 거치는가:
 *
 *   1. **사용자는 열쇠를 넣지 않는다.** 앱 받은 사람마다 카카오 개발자
 *      계정을 만들어야 한다면 아무도 안 쓴다. 열쇠는 앱 만든 사람 것
 *      하나면 되고, 그건 여기 서버에만 있으면 된다.
 *
 *   2. **열쇠가 브라우저에 안 보인다.** 카카오 REST 열쇠는 Supabase
 *      publishable 열쇠와 달리 공개돼도 되는 값이 아니다. 가져간 사람이
 *      하루 한도를 대신 써 버린다.
 *
 *   3. **도메인·CORS 문제가 없어진다.** 서버끼리 부르는 것이라 브라우저가
 *      막을 일이 없고, 카카오에 도메인을 등록할 필요도 없다.
 *
 * 넣는 법:
 *
 *   supabase secrets set KAKAO_REST_KEY=여기에_REST_API_키
 *   supabase functions deploy gym-search --no-verify-jwt
 *
 * --no-verify-jwt를 쓰는 이유: 로그인 안 한 사람도 헬스장은 찾을 수 있어야
 * 한다. 처음 켠 사람이 제일 먼저 하는 일이 헬스장 고르기인데, 그 앞에
 * 회원가입을 세워 두면 거기서 절반이 나간다. 대신 Supabase 게이트웨이가
 * 이 프로젝트의 열쇠를 가진 요청만 여기까지 들여보낸다.
 */

const KAKAO_ENDPOINT = 'https://dapi.kakao.com/v2/local/search/keyword.json';

/*
 * 네이버는 **대신**이 아니라 **뒤**다.
 *
 * 카카오맵 웹에는 있는 헬스장이 카카오 로컬 API에는 없는 경우가 있다.
 * 두 쪽이 같은 색인을 안 쓴다. 실제로 "바우짐"이 그랬다 — 지도에서는
 * 나오는데 API는 0개를 줬다.
 *
 * 그렇다고 네이버로 갈아타지는 않는다. 네이버 지역검색은 한 번에 다섯
 * 개까지고, 거리순 정렬도 거리 값도 없다. 카카오로 먼저 찾고 **모자랄
 * 때만** 네이버에 한 번 더 물어서 보탠다. 0개보다 다섯 개가 낫다.
 *
 * 열쇠가 없으면 그냥 카카오만 쓴다. 네이버가 막혀도 검색이 멈추지 않는다.
 */
const NAVER_ENDPOINT = 'https://openapi.naver.com/v1/search/local.json';

/** 카카오 결과가 이보다 적으면 네이버에도 물어본다. */
const ENOUGH = 3;

/** 네이버가 한 번에 주는 최대치. 늘릴 수 없다. */
const NAVER_SIZE = 5;

/** 한 번에 돌려줄 개수. 사람은 위에서 다섯 개만 본다. */
const SIZE = 15;

/** 검색어 길이. 한 글자는 전국이 쏟아지고, 너무 길면 장난이다. */
const MIN_QUERY = 2;
const MAX_QUERY = 60;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

/**
 * 돌려줄 때는 필요한 것만 남긴다.
 *
 * 카카오 응답에는 전화번호·상세페이지 주소까지 다 들어 있다. 그대로
 * 흘려보내면 우리가 쓰지도 않는 값이 사용자 기기까지 간다. 쓸 것만 고른다.
 */
interface Slim {
  id: string;
  place_name: string;
  category_name: string;
  address_name: string;
  road_address_name: string;
  x: string;
  y: string;
  distance: string;
}

function slim(doc: Record<string, unknown>): Slim {
  const text = (value: unknown): string => (typeof value === 'string' ? value : '');
  return {
    id: text(doc.id),
    place_name: text(doc.place_name),
    category_name: text(doc.category_name),
    address_name: text(doc.address_name),
    road_address_name: text(doc.road_address_name),
    x: text(doc.x),
    y: text(doc.y),
    distance: text(doc.distance),
  };
}

/* ── 네이버에서 보태기 ───────────────────────────── */

/** 네이버는 제목에 <b> 태그를 섞어 준다. 그대로 두면 화면에 태그가 뜬다. */
function stripTags(value: string): string {
  return value.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').trim();
}

/**
 * 네이버 좌표를 WGS84로.
 *
 * 지금 API는 경위도에 10^7을 곱한 정수를 준다(127.0642060 → 1270642060).
 * 옛 응답은 KATECH이라 그대로 쓰면 엉뚱한 곳이 된다. 그래서 **변환한
 * 결과가 한반도 안에 떨어질 때만** 쓰고, 아니면 좌표를 버린다.
 * 좌표가 없으면 거리만 안 보일 뿐 고르는 데는 지장이 없다.
 */
function naverCoord(mapx: unknown, mapy: unknown): { x: string; y: string } | null {
  const lng = Number(mapx) / 1e7;
  const lat = Number(mapy) / 1e7;
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  if (lng < 124 || lng > 132 || lat < 33 || lat > 39) return null;
  return { x: String(lng), y: String(lat) };
}

/** 같은 곳인지 보는 열쇠. 두 회사가 주소를 다르게 적어서 이름으로 본다. */
function nameKey(name: string): string {
  return name.replace(/\s/g, '').toLowerCase();
}

async function fromNaver(query: string): Promise<Slim[]> {
  const id = Deno.env.get('NAVER_CLIENT_ID');
  const secret = Deno.env.get('NAVER_CLIENT_SECRET');
  if (!id || !secret) return [];

  const params = new URLSearchParams({ query, display: String(NAVER_SIZE) });

  let response: Response;
  try {
    response = await fetch(`${NAVER_ENDPOINT}?${params}`, {
      headers: { 'X-Naver-Client-Id': id, 'X-Naver-Client-Secret': secret },
    });
  } catch {
    // 보태기가 실패해도 카카오 결과는 그대로 간다. 검색을 멈추지 않는다.
    return [];
  }
  if (!response.ok) return [];

  let payload: { items?: unknown };
  try {
    payload = await response.json();
  } catch {
    return [];
  }
  const items = Array.isArray(payload?.items) ? payload.items : [];

  return items.map((raw): Slim | null => {
    const item = raw as Record<string, unknown>;
    const text = (value: unknown): string => (typeof value === 'string' ? value : '');
    const name = stripTags(text(item.title));
    if (!name) return null;

    const road = text(item.roadAddress);
    const jibun = text(item.address);
    const point = naverCoord(item.mapx, item.mapy);

    return {
      /*
       * 네이버는 장소에 고정 id를 안 준다. 이름과 주소로 만든다 —
       * 앱이 이걸로 같은 곳을 두 번 안 담게만 하면 된다.
       */
      id: `naver:${nameKey(name)}@${(road || jibun).replace(/\s/g, '')}`,
      place_name: name,
      category_name: stripTags(text(item.category)),
      address_name: jibun,
      road_address_name: road,
      x: point ? point.x : '',
      y: point ? point.y : '',
      // 네이버는 거리를 안 준다. 좌표가 있으면 앱이 직접 잰다.
      distance: '',
    };
  }).filter((item): item is Slim => item !== null);
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });

/** 좌표처럼 생겼는가. 아무 문자열이나 카카오로 흘려보내지 않는다. */
function coord(value: unknown, limit: number): string | undefined {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || Math.abs(n) > limit) return undefined;
  return String(n);
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ failure: 'server' }, 405);

  const key = Deno.env.get('KAKAO_REST_KEY');
  if (!key) {
    /*
     * 열쇠를 안 넣고 배포한 경우다. 이건 사용자 잘못이 아니라 설정이
     * 덜 된 것이라, 검색이 안 되는 이유를 뭉뚱그리지 않고 그대로 말한다.
     */
    return json({ failure: 'notConfigured' }, 503);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ failure: 'server' }, 400);
  }

  const query = typeof body.query === 'string' ? body.query.trim() : '';
  if (query.length < MIN_QUERY || query.length > MAX_QUERY) {
    return json({ places: [] });
  }

  const params = new URLSearchParams({ query, size: String(SIZE) });

  // 좌표는 있을 때만. 없으면 카카오가 거리 없이 관련도순으로 준다.
  const x = coord(body.x, 180);
  const y = coord(body.y, 90);
  if (x && y) {
    params.set('x', x);
    params.set('y', y);

    /*
     * 거리순은 **동네를 찾을 때만**이다.
     *
     * 카카오는 한 번에 15개까지만 준다. 상호를 친 사람에게 거리순을 쓰면
     * 가까운 가게들이 그 15칸을 먼저 채우고, 정작 찾던 가게가 멀리 있으면
     * 잘려서 "그런 곳 없습니다"가 된다. 실제로 20km 밖의 헬스장이 그렇게
     * 사라졌다.
     *
     * 좌표는 거리순이 아닐 때도 보낸다 — 카카오가 거리를 재서 주기 때문에
     * 목록에 "1.2km"를 띄울 수 있다.
     *
     * area를 안 보내는 옛 앱은 정확도순으로 받는다. 틀렸을 때 덜 나쁜
     * 쪽이다 — 친 말이 목록에서 사라지지는 않는다.
     */
    if (body.area === true) params.set('sort', 'distance');
  }

  let response: Response;
  try {
    response = await fetch(`${KAKAO_ENDPOINT}?${params}`, {
      headers: { Authorization: `KakaoAK ${key}` },
    });
  } catch {
    return json({ failure: 'network' }, 502);
  }

  if (!response.ok) {
    /*
     * 카카오가 준 상태 코드를 그대로 흘려보내지 않는다. 401은 **서버에
     * 넣어 둔 열쇠**가 틀렸다는 뜻인데, 앱이 그걸 받으면 "당신 열쇠가
     * 틀렸습니다"라고 사용자에게 말하게 된다. 사용자는 열쇠를 넣은 적이
     * 없으므로 그 말은 거짓말이다.
     */
    const failure = response.status === 429 ? 'quota' : 'notConfigured';
    return json({ failure }, response.status === 429 ? 429 : 503);
  }

  const payload = await response.json();
  const documents: Record<string, unknown>[] = Array.isArray(payload?.documents)
    ? payload.documents
    : [];

  const places = documents.map(slim);

  /*
   * 카카오가 적게 줬으면 네이버에도 한 번 물어서 보탠다.
   *
   * 이름이 같은 것은 보태지 않는다. 두 회사가 주소를 다르게 적어서
   * 주소로는 같은 곳인지 가릴 수가 없고, 카카오 쪽에는 좌표와 거리가
   * 붙어 있으니 그쪽을 남긴다.
   */
  if (places.length < ENOUGH) {
    const seen = new Set(places.map((place) => nameKey(place.place_name)));
    for (const extra of await fromNaver(query)) {
      const key = nameKey(extra.place_name);
      if (seen.has(key)) continue;
      seen.add(key);
      places.push(extra);
    }
  }

  return json({ places });
});
