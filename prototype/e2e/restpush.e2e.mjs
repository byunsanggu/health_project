// 아이폰 잠금 화면의 휴식 끝 — 알림으로(음악이 안 끊긴다).
//   아이폰은 화면을 잠근 채 <audio>로 휴식 끝 소리를 내면 듣던 음악이 멈춘다. 그래서 쉬는 중에 화면이 꺼지면
//   서버(functions/rest-alarm)에 "이 시각에 한 번"을 맡기고 <audio>는 틀지 않는다. 서버에는 시각과 알람
//   번호만 간다 — 종목 이름 같은 말은 폰 안(Cache Storage)에만 적는다. 돌아오면 지운다.
//   설정 "화면이 잠겼을 때 → 코치 목소리"면 예전처럼 <audio>. 서버에 못 걸면 조용히 예전 길로, 한동안 다시 안 건다.
import { check, onboard, setVisible, startWorkout, tab, doneSet, skipRest } from './lib.mjs';

const SERVER = 'https://p.supabase.test';

/** 화면을 열기 전에 — <audio> 재생을 적고, http 시험 주소에 없는 Cache Storage를 흉내 낸다. */
export async function fakeAudioAndCaches(page) {
  await page.addInitScript(() => {
    window.__plays = [];
    HTMLMediaElement.prototype.play = function () {
      window.__plays.push(this.muted ? 'muted' : 'loud');
      return Promise.resolve();
    };
    HTMLMediaElement.prototype.pause = function () {};
    // 시험 주소는 http라 Cache Storage가 없다(실제 앱은 https) — 같은 모양으로 흉내 낸다
    if (typeof caches === 'undefined') {
      const stores = new Map();
      window.caches = {
        open: (name) => {
          // 휴식 알림 것만 — 다른 것(코치 목소리)은 예전처럼 Cache Storage가 없는 것으로 둔다
          if (!name.startsWith('rest-alarm')) return Promise.reject(new Error('no cache'));
          if (!stores.has(name)) stores.set(name, new Map());
          const store = stores.get(name);
          return Promise.resolve({
            put: (key, response) => response.text().then((text) => { store.set(String(key), text); }),
            match: (key) => Promise.resolve(store.has(String(key)) ? new Response(store.get(String(key))) : undefined),
          });
        },
      };
    }
  });
}

/** 연 뒤에 — 아이폰 · 로그인 · 알림 구독 · 서버. */
export async function fakeIphoneServer(page) {
  /*
   * 아이폰 · 로그인 · 알림 구독 · 서버를 흉내 낸다.
   *   - 아이폰: 화면 밖에서 Web Audio가 멈추는 폰(RestSound.backgroundMixes() === false)
   *   - 서버: fetch를 가로채 적고 답한다. serverDown이면 503.
   */
  await page.evaluate((server) => {
    Object.defineProperty(navigator, 'platform', { value: 'MacIntel', configurable: true });
    Object.defineProperty(navigator, 'maxTouchPoints', { value: 5, configurable: true });
    Object.defineProperty(Notification, 'permission', { get: () => 'granted', configurable: true });
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const jwt = 'x.' + btoa(JSON.stringify({ sub: 'u', exp })).replace(/=+$/, '') + '.y';
    window.Remote.patch({ url: server, anonKey: 'anon', accessToken: jwt, refreshToken: 'r' });
    window.FitPush.configured = () => true;
    window.FitPush.permission = () => 'granted';
    window.FitPush.current = () => Promise.resolve({ endpoint: 'https://web.push.apple.com/QTEST', p256dh: 'BPkey', auth: 'authkey' });
    window.__calls = [];
    window.__serverDown = false;
    const real = window.fetch.bind(window);
    window.fetch = (input, init = {}) => {
      const href = typeof input === 'string' ? input : input.url;
      if (!href.startsWith(server)) return real(input, init);
      const call = { path: href.slice(server.length), method: init.method || 'GET', keepalive: Boolean(init.keepalive), body: init.body || '' };
      window.__calls.push(call);
      if (window.__serverDown && call.path.startsWith('/functions/')) return Promise.resolve(new Response('{}', { status: 503 }));
      if (call.path.startsWith('/functions/v1/rest-alarm')) return Promise.resolve(new Response('{"ok":true}', { status: 202 }));
      if (call.path.startsWith('/rest/v1/rpc/')) return Promise.resolve(new Response('', { status: 204 }));
      return Promise.resolve(new Response('[]', { status: 200 }));
    };
  }, SERVER);
  check(await page.evaluate(() => window.RestSound.backgroundMixes()) === false, '아이폰 흉내가 안 됐습니다');
  await page.evaluate(() => window.FitRestPush.refresh());
}

/** 서버에 간 요청 · 소리 낸 <audio> · 폰에 적힌 알림 문장 · 약속이 다 풀릴 때까지. */
export function probes(page) {
  const calls = (path) => page.evaluate((p) => window.__calls.filter((c) => c.path.startsWith(p)), path);
  const loud = () => page.evaluate(() => window.__plays.filter((p) => p === 'loud').length);
  const record = () => page.evaluate(async () => {
    const cache = await caches.open(window.FitRestPush.CACHE);
    const hit = await cache.match(window.FitRestPush.KEY);
    return hit ? hit.json() : null;
  });
  const settle = async () => { for (let i = 0; i < 5; i += 1) await page.evaluate(() => new Promise((r) => queueMicrotask(r))); await page.waitForTimeout(50); };
  return { calls, loud, record, settle };
}

export default async function ({ page, url, shot }) {
  await page.clock.install({ time: new Date('2026-10-22T18:00:00+09:00') });
  await fakeAudioAndCaches(page);
  await page.goto(url);
  await onboard(page);
  await startWorkout(page);

  await fakeIphoneServer(page);
  const { calls, loud, record, settle } = probes(page);

  // 지금 하는 종목 이름 — 서버로 가면 안 된다
  const exercise = (await page.locator('#solo-stage .stage-name').first().textContent()).trim();
  check(exercise.length > 0, '종목 이름을 못 읽었습니다');

  // 쉬는 중에 화면이 꺼진다 → 알림을 건다, <audio>는 안 튼다
  await doneSet(page);
  const rest = await page.locator('#rest-remaining').textContent();
  const [m, sec] = rest.trim().split(':').map(Number);
  const endsAt = await page.evaluate((s) => Date.now() + s * 1000, m * 60 + sec);
  const loudBefore = await loud();
  await setVisible(page, false);
  await settle();
  const armed = await calls('/functions/v1/rest-alarm');
  check(armed.length === 1, '화면이 꺼졌는데 휴식 알림을 걸지 않았습니다: ' + JSON.stringify(armed));
  const body = JSON.parse(armed[0].body);
  check(body.action === 'arm' && /^[0-9a-f-]{36}$/.test(body.alarm_id), '거는 요청 모양이 다릅니다: ' + armed[0].body);
  check(Math.abs(body.send_at - endsAt) < 1500, `알림 시각이 휴식 끝과 다릅니다: ${body.send_at - endsAt}ms`);
  check(armed[0].keepalive, '화면이 꺼지는 순간이라 keepalive로 보내야 합니다');
  check(Object.keys(body).sort().join(',') === 'action,alarm_id,send_at,sub', '서버에 시각 · 번호 · 구독 말고 다른 것이 갑니다: ' + armed[0].body);
  check(!armed[0].body.includes(exercise) && !/[가-힣]/.test(armed[0].body), '서버로 가는 요청에 종목 이름(한글)이 있습니다: ' + armed[0].body);
  check(await loud() === loudBefore, '알림으로 걸었는데 <audio>를 틀었습니다 — 음악이 멈춥니다');
  check(await page.evaluate(() => window.RestSound.backgroundState()) === null, '알림으로 걸었는데 화면 밖 소리를 깔았습니다');
  // 정확한 말은 폰 안에만
  const saved = await record();
  check(saved && saved.id === body.alarm_id && saved.state === 'armed', '폰에 알림 문장을 적지 않았습니다: ' + JSON.stringify(saved));
  check(/^휴식 끝 · /.test(saved.title), '알림 제목이 "휴식 끝 · …"이 아닙니다: ' + saved.title);
  check(saved.body.includes(exercise) || /세트|종목|마무리/.test(saved.body), '알림 본문에 다음 할 것이 없습니다: ' + saved.body);

  // 돌아오면 지운다 — 같은 알람 번호로
  await setVisible(page, true);
  await settle();
  const cancels = await calls('/rest/v1/rpc/cancel_rest_alarm');
  check(cancels.length === 1 && JSON.parse(cancels[0].body).alarm === body.alarm_id, '돌아왔는데 알림을 지우지 않았습니다: ' + JSON.stringify(cancels));
  check((await record()).state === 'cancelled', '폰의 알림 기록이 취소로 바뀌지 않았습니다');

  // 휴식을 건너뛰면 — 걸어 둔 것이 없으니 또 지우지 않는다(헛요청 없음)
  await skipRest(page);
  await settle();
  check((await calls('/rest/v1/rpc/cancel_rest_alarm')).length === 1, '걸어 둔 것이 없는데 지우는 요청을 또 보냈습니다');

  // 꺼진 채 휴식을 건너뛰는 길(알림의 다음 세트 · PT 넘어가기)도 지운다 — 화면이 꺼진 채 휴식을 하나 걸고 건너뛴다
  await doneSet(page);
  await setVisible(page, false);
  await settle();
  const second = JSON.parse((await calls('/functions/v1/rest-alarm'))[1].body);
  await setVisible(page, true);
  await settle();
  check((await calls('/rest/v1/rpc/cancel_rest_alarm')).some((c) => JSON.parse(c.body).alarm === second.alarm_id), '두 번째 휴식 알림을 지우지 않았습니다');
  await skipRest(page);

  // 설정 — 아이폰에서만 "화면이 잠겼을 때"가 보이고, 기본은 알림
  await tab(page, '내 정보');
  const pushRow = page.locator('.lock-alert-row[data-lock-alert="push"]');
  const voiceRow = page.locator('.lock-alert-row[data-lock-alert="voice"]');
  check(await pushRow.count() === 1 && await voiceRow.count() === 1, '"화면이 잠겼을 때" 설정이 없습니다');
  check(await pushRow.getAttribute('aria-pressed') === 'true', '알림을 쓸 수 있는데 기본이 알림이 아닙니다');
  check((await pushRow.textContent()).includes('음악 안 끊김'), '알림 쪽에 "음악 안 끊김"이 없습니다');
  await pushRow.scrollIntoViewIfNeeded();
  await shot('1-setting-push');

  // (b) 코치 목소리 — 예전 그대로 <audio>, 서버는 안 부른다
  await voiceRow.click();
  check(await page.locator('.lock-alert-row[data-lock-alert="voice"]').getAttribute('aria-pressed') === 'true', '코치 목소리를 골라지지 않습니다');
  await tab(page, '오늘');
  const armsBefore = (await calls('/functions/v1/rest-alarm')).length;
  let count = await loud();
  await doneSet(page);
  await setVisible(page, false);
  await settle();
  check((await calls('/functions/v1/rest-alarm')).length === armsBefore, '코치 목소리를 골랐는데 서버에 알림을 걸었습니다');
  check(await loud() === count + 1, '코치 목소리를 골랐는데 휴식 끝 소리를 틀지 않았습니다(예전 동작)');
  await setVisible(page, true);
  await skipRest(page);

  // 다시 알림으로 — 서버가 안 되면 조용히 예전 길(소리)로, 그리고 한동안은 서버를 다시 안 부른다
  await tab(page, '내 정보');
  await page.locator('.lock-alert-row[data-lock-alert="push"]').click();
  await tab(page, '오늘');
  await page.evaluate(() => { window.__serverDown = true; });
  count = await loud();
  const tries = (await calls('/functions/v1/rest-alarm')).length;
  await doneSet(page);
  await setVisible(page, false);
  await settle();
  check((await calls('/functions/v1/rest-alarm')).length === tries + 1, '알림을 걸어 보지 않았습니다');
  check(await loud() === count + 1, '서버가 안 되는데 예전 길(휴식 끝 소리)로 넘어가지 않았습니다');
  check((await record()).state === 'failed', '실패한 알림이 폰에 "걸림"으로 남았습니다 — 워커 타이머가 안 울립니다');
  await setVisible(page, true);
  await settle();
  check((await calls('/rest/v1/rpc/cancel_rest_alarm')).length === 2, '걸리지도 않은 알림을 지우러 갔습니다');
  await skipRest(page);
  count = await loud();
  await doneSet(page);
  await setVisible(page, false);
  await settle();
  check((await calls('/functions/v1/rest-alarm')).length === tries + 1, '실패한 뒤 곧바로 또 서버를 불렀습니다(스팸)');
  check(await loud() === count + 1, '실패한 뒤에는 바로 예전 길로 가야 합니다');
  await setVisible(page, true);
  await skipRest(page);

  // 안드로이드 · 컴퓨터는 그대로 — 설정도 안 보이고 서버도 안 부른다
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'platform', { value: 'Linux x86_64', configurable: true });
    Object.defineProperty(navigator, 'maxTouchPoints', { value: 0, configurable: true });
  });
  await tab(page, '내 정보');
  check(await page.locator('.lock-alert-row').count() === 0, '아이폰이 아닌데 "화면이 잠겼을 때"가 보입니다');
}
