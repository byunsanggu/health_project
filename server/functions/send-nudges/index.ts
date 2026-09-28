/*
 * 다시 부르기 — 시간이 된 알림을 보낸다.
 *
 * 몇 분마다 한 번씩 불리면 된다(아래 "거는 법"). 하는 일은 하나다:
 * 보낼 때가 된 줄을 꺼내 푸시로 쏘고 지운다.
 *
 * **판단하지 않는다.**
 *
 * 누구를 언제 부를지, 뭐라고 할지는 앱이 이미 정해서 넣어 뒀다
 * (src/engine/nudge.ts). 여기서 다시 판단하려면 그 사람의 통증과 세션
 * 기록을 읽어야 하는데, 그건 민감정보(개인정보보호법 제23조)다. 읽을
 * 필요가 없는 곳에서 읽게 만들면 언젠가 샌다.
 *
 * 그래서 이 함수가 보는 것은 push_queue 한 표뿐이고, 그 표에는 주소와
 * 시각과 문장밖에 없다.
 *
 * 넣는 법:
 *
 *   1) 열쇠 한 쌍을 만든다 (내 컴퓨터에서, 한 번만)
 *        npx web-push generate-vapid-keys
 *
 *   2) 공개 열쇠는 앱 빌드에  → GitHub Actions secret  VAPID_PUBLIC_KEY
 *      비밀 열쇠는 여기에만   → Supabase secrets       VAPID_PRIVATE_KEY
 *
 *      **비밀 열쇠는 앱 빌드에 절대 넣지 않는다.** 새면 아무나 이 앱
 *      이름으로 남의 폰에 알림을 보낼 수 있다.
 *
 *   3) Supabase → Edge Functions → Deploy a new function
 *      이름: send-nudges · 파일: index.ts · 이 파일 전체를 붙여넣기
 *      Verify JWT: **켜 둔다** — 사람이 부르는 함수가 아니다.
 *
 *   4) 비밀값 넣기 (Edge Functions → Secrets)
 *        VAPID_PRIVATE_KEY   1)에서 나온 비밀 열쇠
 *        VAPID_PUBLIC_KEY    1)에서 나온 공개 열쇠
 *        VAPID_SUBJECT       mailto:관장님메일  (푸시 서버가 연락할 곳)
 *        SERVICE_ROLE_KEY    Settings → API → service_role
 *
 *      service_role은 여기 말고 어디에도 넣지 않는다. 이 함수는 모든
 *      사용자의 예약을 읽어야 해서 어쩔 수 없이 필요하다.
 *
 *   5) 거는 법 — Supabase → Integrations → Cron
 *        일정: 매 15분   (0,15,30,45 * * * *)
 *        하는 일: 이 함수 호출
 */
import webpush from 'npm:web-push@3.6.7';

/** 한 번에 처리할 개수. 밀려도 다음 번에 마저 간다. */
const BATCH = 200;

interface QueueRow {
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth_key: string;
  title: string;
  body: string;
}

function env(name: string): string {
  const value = Deno.env.get(name) ?? '';
  if (!value) throw new Error(`${name}가 없습니다. Edge Functions → Secrets에 넣어 주세요.`);
  return value;
}

Deno.serve(async () => {
  let url: string;
  let serviceKey: string;
  try {
    url = env('SUPABASE_URL');
    serviceKey = env('SERVICE_ROLE_KEY');
    webpush.setVapidDetails(env('VAPID_SUBJECT'), env('VAPID_PUBLIC_KEY'), env('VAPID_PRIVATE_KEY'));
  } catch (error) {
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500, headers: { 'content-type': 'application/json' },
    });
  }

  const headers = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    'content-type': 'application/json',
  };

  const nowIso = new Date().toISOString();
  const dueUrl = `${url}/rest/v1/push_queue` +
    `?select=user_id,endpoint,p256dh,auth_key,title,body` +
    `&send_at=lte.${encodeURIComponent(nowIso)}&limit=${BATCH}`;

  const dueResponse = await fetch(dueUrl, { headers });
  if (!dueResponse.ok) {
    return new Response(JSON.stringify({ error: '예약을 읽지 못했습니다', status: dueResponse.status }), {
      status: 502, headers: { 'content-type': 'application/json' },
    });
  }
  const due: QueueRow[] = await dueResponse.json();

  let sent = 0;
  let gone = 0;
  let failed = 0;

  for (const row of due) {
    const subscription = {
      endpoint: row.endpoint,
      keys: { p256dh: row.p256dh, auth: row.auth_key },
    };
    const payload = JSON.stringify({ kind: 'nudge', title: row.title, body: row.body });

    try {
      await webpush.sendNotification(subscription, payload, { TTL: 6 * 60 * 60 });
      sent += 1;
    } catch (error) {
      /*
       * 404·410은 그 구독이 죽었다는 뜻이다(앱을 지웠거나 알림을 껐다).
       * 지우지 않으면 죽은 주소로 영영 재시도한다.
       */
      const status = (error as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) gone += 1;
      else failed += 1;
    }

    /*
     * 보냈든 죽었든 줄은 지운다. 실패한 것도 지운다 — 다음 알림은 앱이
     * 다시 올린다. 남겨 두면 같은 말이 계속 울린다.
     */
    const deleteUrl = `${url}/rest/v1/push_queue` +
      `?user_id=eq.${row.user_id}&endpoint=eq.${encodeURIComponent(row.endpoint)}`;
    await fetch(deleteUrl, { method: 'DELETE', headers }).catch(() => {});
  }

  return new Response(JSON.stringify({ due: due.length, sent, gone, failed }), {
    headers: { 'content-type': 'application/json' },
  });
});
