/**
 * 서비스 워커 — 오프라인 구동과 휴식 알림.
 *
 * 헬스장 지하에는 신호가 없다. 저장은 이미 로컬이 원본이지만, 앱 자체를
 * 못 받아오면 아무 소용이 없다. 셸을 캐시에 넣어두고 네트워크가 없으면
 * 캐시에서 띄운다.
 *
 * 알림을 페이지가 아니라 여기서 띄우는 이유 — 세트 사이에 폰을 주머니에
 * 넣는 게 정상이다. 화면이 꺼지면 페이지의 타이머는 throttle되거나 멈추지만,
 * 서비스 워커의 알림은 시계까지 간다.
 */
const VERSION = 'volume-coach-v5';
/*
 * 운동 · 기구 3D 썸네일(thumbs/, tools/thumbs가 굽는다). 설치할 때 한꺼번에 받지 않는다 —
 * 수백 장이라 설치가 느려진다. 화면에 처음 뜰 때 받아 담아 두고, 그 뒤로는 캐시에서 준다(오프라인에서도 뜬다).
 * 앱 화면 캐시(VERSION)와 따로 둬서 앱이 새로 올라가도 다시 받지 않는다. 그림을 다시 구우면 이 이름을 올린다.
 */
const THUMBS = 'exercise-thumbs-v4';
const SHELL = ['./', './index.html', './manifest.webmanifest', './icon.svg'];
/*
 * 입체 시연이 쓰는 three.js — 앱과 같은 주소에 둔다(예전엔 CDN). 버전이 박혀 바뀌지 않으므로
 * 처음 설치할 때 받아 두고 캐시에서 준다 — 지하 헬스장에서도 시연이 평면으로 떨어지지 않게.
 */
const THREE_JS = new URL('./vendor/three.min.js', self.location.href).href;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION)
      // 하나라도 실패하면 설치 전체가 실패한다. 개별로 넣는다.
      .then((cache) => Promise.allSettled(SHELL.concat(THREE_JS).map((url) => cache.add(url))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      // 코치 목소리 캐시(coach-voice-*)는 앱이 관리한다 — 워커가 바뀌어도 지우지 않는다(다시 받으려면 9MB)
      // 잠금 화면 휴식 알림의 문장(rest-alarm-*)도 앱이 적는다 — 지우면 푸시가 와도 기본 문장만 뜬다
      .then((keys) => Promise.all(keys.filter((key) => key !== VERSION && key !== THUMBS && !key.startsWith('coach-voice') && !key.startsWith('rest-alarm')).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

/**
 * 페이지 요청은 네트워크 우선, 실패하면 캐시.
 * 나머지 동일 출처 GET은 캐시 우선 — 폰트와 아이콘까지 오프라인에서 뜬다.
 */
self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  if (request.mode === 'navigate') {
    event.respondWith(
      /*
       * 브라우저 HTTP 캐시를 건너뛰고 서버에 확인한다(바뀐 게 없으면 304라 가볍다).
       * 안 그러면 새로 올린 화면이 몇 분 동안 옛날 것으로 뜬다 — "버튼이 없다"가 그거였다.
       */
      fetch(request.url, { cache: 'no-cache', credentials: 'same-origin' })
        .then((response) => {
          const copy = response.clone();
          caches.open(VERSION).then((cache) => cache.put(request, copy)).catch(() => {});
          return response;
        })
        .catch(() => caches.match(request).then((hit) => hit || caches.match('./index.html'))),
    );
    return;
  }

  const url = new URL(request.url);
  if (request.url === THREE_JS) {
    event.respondWith(
      caches.match(THREE_JS).then((hit) => hit || fetch(request).then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(VERSION).then((cache) => cache.put(THREE_JS, copy)).catch(() => {});
        }
        return response;
      })),
    );
    return;
  }
  if (url.origin !== self.location.origin) return;
  // 코치 목소리 조각은 앱(coachVoice.js)이 직접 캐시에 담는다 — 여기서 또 담으면 두 벌이 된다
  if (url.pathname.includes('/voice/')) return;

  if (url.pathname.includes('/thumbs/')) {
    event.respondWith(
      caches.open(THUMBS).then((cache) => cache.match(request).then((hit) => hit || fetch(request).then((response) => {
        if (response.ok) cache.put(request, response.clone()).catch(() => {});
        return response;
      }))),
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((hit) => {
      if (hit) return hit;
      return fetch(request).then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(VERSION).then((cache) => cache.put(request, copy)).catch(() => {});
        }
        return response;
      });
    }),
  );
});

/* ── 휴식 알림 ──────────────────────────────────── */

const REST_TAG = 'rest-timer';
let restTimer = null;

/**
 * 손목에서 읽히는 알림.
 *
 * 애플워치·갤럭시워치는 폰 알림을 그대로 미러링한다. 시계 화면은 좁으니
 * 제목은 짧게, 본문 첫 줄에 다음에 할 것을 둔다. 진동 패턴은 주머니 속에서도
 * 구분되도록 두 번 끊어 친다.
 */
function showRestDone(payload) {
  return self.registration.showNotification('휴식 끝', {
    body: payload.body || '다음 세트를 시작하세요.',
    tag: REST_TAG,
    renotify: true,
    icon: './icon.svg',
    badge: './icon.svg',
    vibrate: [220, 120, 220],
    silent: false,
    data: { kind: 'rest-done', ...payload },
    actions: [
      { action: 'next', title: '다음 세트' },
      { action: 'extend', title: '+30초' },
    ],
  });
}

function clearRestTimer() {
  if (restTimer) clearTimeout(restTimer);
  restTimer = null;
}

function scheduleRest(payload) {
  clearRestTimer();
  const delay = Math.max(0, payload.endsAt - Date.now());
  // waitUntil로 잡아두면 대기 중에 워커가 내려가는 것을 늦출 수 있다.
  return new Promise((resolve) => {
    restTimer = setTimeout(() => {
      restTimer = null;
      // 같은 휴식 끝을 서버 푸시(잠금 화면 알림)가 맡았으면 여기서는 띄우지 않는다 — 두 번 울린다
      readRestAlarm().then((record) => {
        const pushed = record && record.state === 'armed' && Math.abs((record.sendAt || 0) - payload.endsAt) < 5000;
        return pushed ? null : showRestDone(payload);
      }).then(resolve, resolve);
    }, delay);
  });
}

/* ── 잠금 화면 휴식 알림 (아이폰 · functions/rest-alarm) ──────
 *
 * 아이폰은 화면을 잠근 채 웹앱이 소리를 내면 듣던 음악이 멈춘다. 그래서 잠긴 동안의 휴식 끝은
 * 서버가 그 시각에 푸시로 보낸다. 푸시에는 {t:'rest', id}뿐이다 — 문장은 앱이 화면이 꺼지기 직전에
 * 이 폰의 Cache Storage에 적어 둔 것(push.js FitRestPush)을 여기서 읽는다. 없으면 기본 문장.
 *
 * 아이폰은 받은 푸시마다 알림을 꼭 띄워야 한다(안 띄우면 구독을 끊는다). 그래서 이미 취소한 알람
 * (화면으로 돌아온 바로 그 순간에 출발한 푸시)이라도 조용한 한 줄을 띄우고 곧 닫는다.
 */
const REST_ALARM_TAG = 'rest-alarm';
const REST_ALARM_CACHE = 'rest-alarm-v1';
const REST_ALARM_KEY = self.location.origin + '/__rest-alarm__/next';

function readRestAlarm() {
  return caches.open(REST_ALARM_CACHE)
    .then((cache) => cache.match(REST_ALARM_KEY))
    .then((hit) => (hit ? hit.json() : null))
    .catch(() => null);
}

function showRestAlarm(id) {
  return Promise.all([
    readRestAlarm(),
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).catch(() => []),
  ]).then(([record, clients]) => {
    const mine = Boolean(record && record.id === id);
    // 취소했거나 앱을 보고 있다 — 앱이 이미 휴식을 알고 있다. 띄우되 조용히, 곧 닫는다
    const stale = (mine && record.state === 'cancelled') || clients.some((client) => client.visibilityState === 'visible');
    const fresh = mine && !stale && record.title;
    const title = fresh ? record.title : '휴식 끝';
    const body = stale ? '휴식이 끝났습니다' : fresh ? (record.body || '다음 세트를 시작하세요') : '다음 세트를 시작하세요';
    return self.registration.showNotification(title, {
      body,
      tag: REST_ALARM_TAG,
      renotify: !stale,
      icon: './icon.svg',
      badge: './icon.svg',
      vibrate: stale ? [] : [220, 120, 220],
      silent: stale,
      data: { kind: 'rest-alarm', id },
    }).then(() => {
      if (!stale) return null;
      return new Promise((resolve) => setTimeout(resolve, 4000))
        .then(() => self.registration.getNotifications({ tag: REST_ALARM_TAG }))
        .then((list) => list.forEach((item) => item.close()))
        .catch(() => {});
    });
  });
}

self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type === 'rest:start') {
    event.waitUntil(scheduleRest(data));
  } else if (data.type === 'rest:stop') {
    clearRestTimer();
    // 잠금 화면에 떠 있던 휴식 끝 알림도 같이 걷는다 — 앱으로 돌아왔다
    event.waitUntil(Promise.all([REST_TAG, REST_ALARM_TAG].map((tag) =>
      self.registration.getNotifications({ tag })
        .then((list) => list.forEach((item) => item.close()))
        .catch(() => {}))));
  } else if (data.type === 'ping') {
    event.source && event.source.postMessage({ type: 'pong', version: VERSION });
  }
});

/**
 * 서버 푸시.
 *
 * 두 가지가 같은 문으로 들어온다.
 *
 *   · 휴식 끝 — 워커가 내려가면 위의 setTimeout이 같이 죽으므로, 확실한
 *     손목 알림은 결국 서버가 예약해 보내주는 것이다.
 *   · 다시 부르기 — 며칠 뒤에 울려야 하는 것이라 setTimeout으로는 아예
 *     안 된다.
 *
 * **보낸 쪽이 적은 제목과 본문을 그대로 띄운다.** 여기서 문장을 만들지
 * 않는다 — 무엇을 말할지는 앱이 정했고(nudge.ts), 그 판단에는 통증·연속
 * 같은 것이 들어간다. 워커는 그걸 알 필요가 없다.
 */
const NUDGE_TAG = 'come-back';

function showNudge(payload) {
  return self.registration.showNotification(payload.title || '볼륨 코치', {
    body: payload.body || '',
    tag: payload.tag || NUDGE_TAG,
    renotify: false,
    icon: './icon.svg',
    badge: './icon.svg',
    // 휴식 끝과 달리 급한 일이 아니다. 한 번만 짧게 친다.
    vibrate: [180],
    data: { kind: 'nudge', ...payload },
  });
}

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (err) {
    payload = { body: event.data ? event.data.text() : '' };
  }
  event.waitUntil(payload.t === 'rest' ? showRestAlarm(String(payload.id || ''))
    : payload.kind === 'rest-done' ? showRestDone(payload) : showNudge(payload));
});

self.addEventListener('notificationclick', (event) => {
  const action = event.action;
  const kind = (event.notification.data || {}).kind;
  event.notification.close();

  /*
   * 다시 부르기(약속 · 운동 알림)는 곧장 오늘 운동으로 연다 — 알림을 누른 것이 "하겠다"는 뜻이다.
   * 앱이 쉬는 날 · 마친 날 · 아픈 날인지 보고 아니면 바로 시작한다(app.js quickStart, ?go=start).
   * 휴식 동작은 같이 보내지 않는다 — 며칠 전에 끝난 세션의 "다음 세트"가 그 자리에서 눌린다.
   * 알림 내용에는 운동 숫자를 싣지 않는다. 열면 이 폰이 이 폰의 기록으로 정한다.
   */
  const nudge = kind === 'nudge';
  /*
   * 잠금 화면 휴식 알림(rest-alarm)은 앱을 열어 주기만 한다. 휴식은 이미 끝났고, 열리면 앱이 그
   * 시각과 대조해 다음 세트로 간다(PT는 이어서 센다). "다음 세트"를 대신 눌러 주지 않는다.
   */
  const restAlarm = kind === 'rest-alarm';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ('focus' in client) {
          if (!restAlarm) client.postMessage(nudge ? { type: 'go:start' } : { type: 'rest:action', action: action || 'next' });
          return client.focus();
        }
      }
      // 앱이 닫혀 있으면 열어준다.
      return self.clients.openWindow(
        nudge ? './index.html?go=start' : restAlarm ? './index.html' : './index.html?rest=' + encodeURIComponent(action || 'next'));
    }),
  );
});
