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
    params.set('sort', 'distance');
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

  return json({ places: documents.map(slim) });
});
