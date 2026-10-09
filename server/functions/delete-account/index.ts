/**
 * 회원 탈퇴 — 계정을 지운다.
 *
 * 앱은 계정을 지울 수 없다. 계정을 지우려면 관리자 열쇠(service_role)가
 * 필요하고, 그 열쇠는 **절대 앱에 들어가면 안 된다** — 앱에 들어가는
 * 순간 아무나 아무 계정이나 지울 수 있다. 그래서 여기서 한다. 관리자
 * 열쇠는 Supabase가 이 함수에만 넣어 준다(SUPABASE_SERVICE_ROLE_KEY,
 * 따로 넣을 필요 없음).
 *
 * 순서가 전부다.
 *   1. 들어온 토큰이 **누구 것인지** 서버에 물어본다. 요청 본문에 적힌
 *      id는 믿지 않는다 — 그걸 믿으면 남의 id를 적어 보내 남의 계정을
 *      지울 수 있다.
 *   2. 그 사람의 계정을 지운다. 운동 기록·설정·친구·헬스장 확인·알림
 *      예약은 전부 계정에 묶여 있어(on delete cascade) 같이 지워진다.
 *      헬스장 자체는 남는다 — 다른 사람들이 쓰고 있고 내 정보가 없다.
 *
 * 개인정보보호법 제36조(삭제 요구)와 앱 마켓 정책이 요구하는 것이다.
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ failure: 'method' }, 405);

  const url = Deno.env.get('SUPABASE_URL');
  const admin = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !admin) return json({ failure: 'notConfigured' }, 503);

  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return json({ failure: 'signedOut' }, 401);

  // 1. 이 토큰은 누구인가 — 서버가 대답한 id만 믿는다.
  const who = await fetch(`${url}/auth/v1/user`, {
    headers: { Authorization: `Bearer ${token}`, apikey: admin },
  });
  if (!who.ok) return json({ failure: 'signedOut' }, 401);
  const user = await who.json().catch(() => null) as { id?: string } | null;
  const id = user?.id;
  // 익명 키(anon)로 부르면 사람이 아니라서 id가 없다.
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) return json({ failure: 'signedOut' }, 401);

  // 2. 계정을 지운다. 묶인 기록은 데이터베이스가 같이 지운다.
  const gone = await fetch(`${url}/auth/v1/admin/users/${id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${admin}`, apikey: admin },
  });
  if (!gone.ok) {
    // 실패 이유는 로그에만 남긴다. 관리자 응답을 그대로 앱에 돌려줄 이유가 없다.
    console.error('delete-account', gone.status, await gone.text().catch(() => ''));
    return json({ failure: 'server' }, 502);
  }

  return json({ ok: true });
});
