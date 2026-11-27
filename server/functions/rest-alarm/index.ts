/*
 * 휴식 끝 알림 — 아이폰 잠금 화면에서 음악을 끊지 않고.
 *
 * 아이폰은 화면을 잠그면 웹앱이 소리를 내려고 할 때 듣던 음악을 멈춘다. 시스템 알림의 소리와
 * 애플워치 진동은 음악을 멈추지 않는다. 그런데 웹앱은 알림을 스스로 예약하지 못한다 — 그래서
 * 휴식 중에 화면이 꺼지면 앱이 여기를 부르고, 여기서 휴식이 끝나는 순간까지 기다렸다가 푸시를 쏜다.
 *
 * **문장을 모른다.** 앱이 보내는 것은 "몇 시에(send_at), 몇 번 알람(alarm_id)"과 보낼 곳(구독)뿐이고,
 * 푸시에 싣는 것도 {t:'rest', id} 하나다. "벤치프레스 2세트" 같은 말은 폰 안에 적혀 있고, 푸시가
 * 닿으면 폰의 서비스 워커가 그걸 읽어 띄운다. 종목 · 무게 · 세트는 서버를 지나가지 않는다.
 *
 * 하는 일
 *   1) arm — 사람이 부른다(앱, 그 사람의 로그인 토큰). 토큰의 주인을 확인하고 rest_alarm 표에 한 줄
 *      넣은 뒤 곧바로 202로 답한다. 기다리는 일은 답한 뒤에 뒤에서(EdgeRuntime.waitUntil) 한다 —
 *      화면이 꺼지는 순간이라 앱이 답을 끝까지 못 받을 수도 있다.
 *   2) 기다린다. 몇 초마다 줄이 그대로 있는지 본다. 앱이 지웠으면(화면으로 돌아왔다 · 휴식을 건너뛰었다)
 *      그 자리에서 그만둔다 — 푸시가 안 나간다.
 *   3) 한 번 불린 함수는 오래 못 산다(무료 요금제는 약 150초). 110초를 기다렸는데도 남았으면 자기 자신을
 *      다시 부르고(chain) 끝난다. 이어 불린 쪽이 또 기다린다 — 휴식이 몇 분이어도 이어진다.
 *   4) 시각이 되면 줄을 **지우면서 꺼낸다**(DELETE … RETURNING). 꺼낸 쪽만 보낸다 — 둘이 깨어 있어도
 *      한 번만 울린다. 줄이 없거나 알람 번호가 다르면(새 휴식이 덮어썼다) 안 보낸다.
 *
 * 막는 것
 *   · 남의 줄 — 토큰의 주인은 서버(auth)에게 묻는다. 본문의 id는 믿지 않는다.
 *   · 먼 시각 — 15분보다 먼 휴식은 받지 않는다(표도 16분에서 막는다).
 *   · 많이 걸기 — 한 사람에 기기 셋까지(표의 트리거). 같은 기기는 덮어쓴다.
 *   · 아무 주소 — 보낼 곳은 애플 · 구글 · 모질라 · 마이크로소프트 푸시 서버 주소만 받는다.
 *     안 그러면 이 함수가 남이 적어 준 아무 주소로 요청을 보내게 된다.
 *
 * 넣는 법 (server/README.md ⑦-B)
 *
 *   Supabase → Edge Functions → Deploy a new function
 *     이름: rest-alarm · 파일: index.ts · 이 파일 전체를 붙여넣기
 *     Verify JWT: **켜 둔다** — 로그인한 사람만 부른다.
 *
 *   비밀값은 send-nudges와 같은 것을 그대로 쓴다(Edge Functions → Secrets는 함수끼리 같이 쓴다).
 *     VAPID_PRIVATE_KEY · VAPID_PUBLIC_KEY · VAPID_SUBJECT · SERVICE_ROLE_KEY
 *   SERVICE_ROLE_KEY는 Settings → API의 service_role(eyJ…로 시작하는 것). 자기 자신을 다시 부를 때
 *   Verify JWT를 통과하는 데도 쓴다.
 */
import webpush from 'npm:web-push@3.6.7';

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

/** 15분보다 먼 휴식은 받지 않는다. 앱(src/engine/restAlarm.ts)과 같은 값. */
const MAX_AHEAD_MS = 15 * 60 * 1000;
/** 화면이 꺼지는 사이에 몇 초 늦게 닿는 것은 받는다 — 그때는 바로 보낸다. */
const LATE_OK_MS = 5000;
/** 한 번 불린 함수가 기다리는 시간. 150초 벽보다 넉넉히 앞에서 다음 호출로 넘긴다. */
const BUDGET_MS = 110_000;
/** 이만큼마다 깨어 취소됐는지 본다. */
const POLL_MS = 15_000;
/** 푸시가 폰까지 가는 데 1초쯤 걸린다 — 그만큼 일찍 쏜다. */
const LEAD_MS = 1000;
/** 다시 부르기는 15분 / 110초 ≈ 9번이면 충분하다. 넉넉히 잡되 끝은 있게. */
const MAX_HOPS = 12;

/** 보낼 곳으로 받는 푸시 서버. 브라우저가 주는 구독 주소는 이 중 하나다. */
const PUSH_HOSTS = [
  /^web\.push\.apple\.com$/,
  /^fcm\.googleapis\.com$/,
  /^android\.googleapis\.com$/,
  /^updates\.push\.services\.mozilla\.com$/,
  /^push\.services\.mozilla\.com$/,
  /^[a-z0-9-]+\.notify\.windows\.com$/,
];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const B64URL = /^[A-Za-z0-9_-]+={0,2}$/;

// src/engine/restAlarm.ts와 글자 그대로 같다 — 테스트(restAlarm.test.ts)가 본다.
// <alarm-step>
export interface AlarmStepInput {
  now: number;
  sendAt: number;
  /** 이번 호출이 시작된 시각 */
  startedAt: number;
  /** 한 호출이 기다려도 되는 시간 */
  budgetMs: number;
  /** 이만큼마다 깨어 취소됐는지 본다 */
  pollMs: number;
  /** 푸시가 폰까지 가는 데 걸리는 만큼 일찍 쏜다 */
  leadMs: number;
}

export type AlarmStep =
  | { action: 'send' }
  | { action: 'sleep'; ms: number }
  | { action: 'chain' };

export function alarmStep(input: AlarmStepInput): AlarmStep {
  const fireAt = input.sendAt - input.leadMs;
  const left = fireAt - input.now;
  if (left <= 0) return { action: 'send' };
  const budgetLeft = input.budgetMs - (input.now - input.startedAt);
  if (budgetLeft <= 0) return { action: 'chain' };
  return { action: 'sleep', ms: Math.max(1, Math.min(left, input.pollMs, budgetLeft)) };
}
// </alarm-step>

interface Alarm {
  user_id: string;
  endpoint: string;
  alarm_id: string;
  send_at: number;
}

interface Ctx {
  url: string;
  serviceKey: string;
  self: string;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function env(name: string, fallback?: string): string {
  return (Deno.env.get(name) ?? (fallback ? Deno.env.get(fallback) : '') ?? '').trim();
}

/** 길이가 같을 때만 비교하고, 같은 시간에 끝나게 한다 — 열쇠를 한 글자씩 맞혀 보지 못하게. */
function sameSecret(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function pushHostOk(endpoint: string): boolean {
  try {
    const parsed = new URL(endpoint);
    return parsed.protocol === 'https:' && PUSH_HOSTS.some((host) => host.test(parsed.hostname));
  } catch {
    return false;
  }
}

function admin(ctx: Ctx, extra: Record<string, string> = {}): Record<string, string> {
  return {
    apikey: ctx.serviceKey,
    Authorization: `Bearer ${ctx.serviceKey}`,
    'content-type': 'application/json',
    ...extra,
  };
}

function rowFilter(alarm: Pick<Alarm, 'user_id' | 'endpoint' | 'alarm_id'>): string {
  return `user_id=eq.${alarm.user_id}` +
    `&endpoint=eq.${encodeURIComponent(alarm.endpoint)}` +
    `&alarm_id=eq.${alarm.alarm_id}`;
}

/** 그 알람이 아직 걸려 있는가. 앱이 지웠거나 새 휴식이 덮어썼으면 false. */
async function stillArmed(ctx: Ctx, alarm: Alarm): Promise<boolean> {
  const response = await fetch(`${ctx.url}/rest/v1/rest_alarm?select=alarm_id&${rowFilter(alarm)}`, {
    headers: admin(ctx),
  }).catch(() => null);
  if (!response || !response.ok) return false;
  const rows = await response.json().catch(() => []) as unknown[];
  return Array.isArray(rows) && rows.length === 1;
}

/** 지우면서 꺼낸다. 꺼낸 쪽만 보낸다 — 둘이 깨어 있어도 한 번만 울린다. */
async function claim(ctx: Ctx, alarm: Alarm): Promise<{ p256dh: string; auth_key: string } | null> {
  const response = await fetch(`${ctx.url}/rest/v1/rest_alarm?${rowFilter(alarm)}`, {
    method: 'DELETE',
    headers: admin(ctx, { Prefer: 'return=representation' }),
  }).catch(() => null);
  if (!response || !response.ok) return null;
  const rows = await response.json().catch(() => []) as { p256dh: string; auth_key: string }[];
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

async function send(ctx: Ctx, alarm: Alarm): Promise<void> {
  const row = await claim(ctx, alarm);
  if (!row) return;
  try {
    await webpush.sendNotification(
      { endpoint: alarm.endpoint, keys: { p256dh: row.p256dh, auth: row.auth_key } },
      // 이게 전부다. 문장은 폰에 있다.
      JSON.stringify({ t: 'rest', id: alarm.alarm_id }),
      // 1분 안에 못 닿으면 버린다 — 늦게 온 "휴식 끝"은 소용이 없다
      { TTL: 60, urgency: 'high' },
    );
  } catch (error) {
    // 404 · 410은 구독이 죽은 것. 줄은 이미 지웠다. 이유는 로그에만.
    console.error('rest-alarm send', (error as { statusCode?: number }).statusCode ?? String(error));
  }
}

/** 다음 호출로 넘긴다. 관리자 열쇠로 부른다 — 본문의 user_id는 이 열쇠가 있을 때만 믿는다. */
async function chain(ctx: Ctx, alarm: Alarm, hop: number): Promise<void> {
  if (hop + 1 > MAX_HOPS) return;
  const response = await fetch(ctx.self, {
    method: 'POST',
    headers: admin(ctx),
    body: JSON.stringify({ action: 'chain', hop: hop + 1, ...alarm }),
  }).catch(() => null);
  if (!response || !response.ok) console.error('rest-alarm chain', response?.status ?? 'network');
  await response?.body?.cancel().catch(() => {});
}

/** 시각이 될 때까지 기다린다. 기다리는 사이 취소되면 그만둔다. */
async function wait(ctx: Ctx, alarm: Alarm, hop: number): Promise<void> {
  const startedAt = Date.now();
  for (;;) {
    const step = alarmStep({
      now: Date.now(), sendAt: alarm.send_at, startedAt,
      budgetMs: BUDGET_MS, pollMs: POLL_MS, leadMs: LEAD_MS,
    });
    if (step.action === 'send') return send(ctx, alarm);
    if (step.action === 'chain') {
      if (await stillArmed(ctx, alarm)) await chain(ctx, alarm, hop);
      return;
    }
    await sleep(step.ms);
    if (!(await stillArmed(ctx, alarm))) return;
  }
}

/** 답을 보낸 뒤에도 기다린다. EdgeRuntime이 없는 곳(내 컴퓨터)에서는 답하기 전에 기다린다. */
function background(task: Promise<void>): boolean {
  const runtime = (globalThis as { EdgeRuntime?: { waitUntil(p: Promise<unknown>): void } }).EdgeRuntime;
  const guarded = task.catch((error) => console.error('rest-alarm', String(error)));
  if (runtime && typeof runtime.waitUntil === 'function') {
    runtime.waitUntil(guarded);
    return true;
  }
  return false;
}

async function whoIs(ctx: Ctx, token: string): Promise<string | null> {
  const response = await fetch(`${ctx.url}/auth/v1/user`, {
    headers: { Authorization: `Bearer ${token}`, apikey: ctx.serviceKey },
  }).catch(() => null);
  if (!response || !response.ok) return null;
  const user = await response.json().catch(() => null) as { id?: string } | null;
  // 익명 열쇠(anon)로 부르면 사람이 아니라서 id가 없다
  return user?.id && UUID.test(user.id) ? user.id : null;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ failure: 'method' }, 405);

  const url = env('SUPABASE_URL').replace(/\/+$/, '');
  const serviceKey = env('SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_ROLE_KEY');
  const vapid = [env('VAPID_SUBJECT'), env('VAPID_PUBLIC_KEY'), env('VAPID_PRIVATE_KEY')];
  if (!url || !serviceKey || vapid.some((value) => !value)) return json({ failure: 'notConfigured' }, 503);
  webpush.setVapidDetails(vapid[0], vapid[1], vapid[2]);
  const ctx: Ctx = { url, serviceKey, self: `${url}/functions/v1/rest-alarm` };

  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return json({ failure: 'signedOut' }, 401);
  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || typeof body !== 'object') return json({ failure: 'body' }, 400);

  /* ── 이어 부르기 — 이 함수가 자기 자신을 불렀다 ── */
  if (body.action === 'chain') {
    if (!sameSecret(token, serviceKey)) return json({ failure: 'forbidden' }, 403);
    const alarm: Alarm = {
      user_id: String(body.user_id ?? ''),
      endpoint: String(body.endpoint ?? ''),
      alarm_id: String(body.alarm_id ?? ''),
      send_at: Number(body.send_at),
    };
    const hop = Number(body.hop) || 0;
    if (!UUID.test(alarm.user_id) || !UUID.test(alarm.alarm_id) || !pushHostOk(alarm.endpoint) ||
        !Number.isFinite(alarm.send_at) || hop > MAX_HOPS) {
      return json({ failure: 'body' }, 400);
    }
    if (!(await stillArmed(ctx, alarm))) return json({ ok: true, armed: false });
    const task = wait(ctx, alarm, hop);
    if (!background(task)) await task;
    return json({ ok: true, hop }, 202);
  }

  /* ── 사람이 불렀다 — 토큰의 주인만 믿는다 ── */
  const userId = await whoIs(ctx, token);
  if (!userId) return json({ failure: 'signedOut' }, 401);

  if (body.action === 'cancel') {
    // 앱은 보통 cancel_rest_alarm(RPC)으로 지운다. 이 길은 함수 하나로 다 하고 싶을 때.
    const alarmId = typeof body.alarm_id === 'string' && UUID.test(body.alarm_id) ? body.alarm_id : null;
    await fetch(`${url}/rest/v1/rest_alarm?user_id=eq.${userId}${alarmId ? `&alarm_id=eq.${alarmId}` : ''}`, {
      method: 'DELETE', headers: admin(ctx),
    }).catch(() => null);
    return json({ ok: true });
  }

  if (body.action !== 'arm') return json({ failure: 'action' }, 400);

  const sub = (body.sub ?? {}) as Record<string, unknown>;
  const endpoint = String(sub.endpoint ?? '');
  const p256dh = String(sub.p256dh ?? '');
  const authKey = String(sub.auth ?? '');
  const alarmId = String(body.alarm_id ?? '');
  const sendAt = Number(body.send_at);
  const now = Date.now();

  if (!pushHostOk(endpoint) || endpoint.length > 1024) return json({ failure: 'endpoint' }, 400);
  if (!B64URL.test(p256dh) || p256dh.length > 200 || !B64URL.test(authKey) || authKey.length > 100) {
    return json({ failure: 'keys' }, 400);
  }
  if (!UUID.test(alarmId)) return json({ failure: 'alarm' }, 400);
  if (!Number.isFinite(sendAt) || sendAt < now - LATE_OK_MS || sendAt > now + MAX_AHEAD_MS + LATE_OK_MS) {
    return json({ failure: 'time' }, 400);
  }

  // 함수가 죽어 못 지운 지난 알람은 치운다 — 기기 셋 세기에 들어가지 않게
  await fetch(`${url}/rest/v1/rest_alarm?user_id=eq.${userId}` +
    `&send_at=lt.${encodeURIComponent(new Date(now - 60_000).toISOString())}`, {
    method: 'DELETE', headers: admin(ctx),
  }).catch(() => null);

  const saved = await fetch(`${url}/rest/v1/rest_alarm?on_conflict=user_id,endpoint`, {
    method: 'POST',
    headers: admin(ctx, { Prefer: 'resolution=merge-duplicates,return=minimal' }),
    body: JSON.stringify({
      user_id: userId,
      endpoint,
      p256dh,
      auth_key: authKey,
      alarm_id: alarmId,
      send_at: new Date(sendAt).toISOString(),
      created_at: new Date(now).toISOString(),
    }),
  }).catch(() => null);
  if (!saved || !saved.ok) {
    const detail = saved ? await saved.text().catch(() => '') : 'network';
    // 기기 셋을 넘겼다(트리거) — 많이 건 것. 그 밖의 이유는 로그에만.
    if (/too many active alarms/.test(detail)) return json({ failure: 'tooMany' }, 429);
    console.error('rest-alarm save', saved?.status ?? 'network', detail);
    return json({ failure: 'server' }, 502);
  }

  const alarm: Alarm = { user_id: userId, endpoint, alarm_id: alarmId, send_at: sendAt };
  const task = wait(ctx, alarm, 0);
  if (!background(task)) await task;
  return json({ ok: true }, 202);
});
