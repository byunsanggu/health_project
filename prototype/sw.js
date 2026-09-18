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
const VERSION = 'volume-coach-v1';
const SHELL = ['./', './index.html', './manifest.webmanifest', './icon.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION)
      // 하나라도 실패하면 설치 전체가 실패한다. 개별로 넣는다.
      .then((cache) => Promise.allSettled(SHELL.map((url) => cache.add(url))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== VERSION).map((key) => caches.delete(key))))
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
      fetch(request)
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
  if (url.origin !== self.location.origin) return;

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
      showRestDone(payload).then(resolve, resolve);
    }, delay);
  });
}

self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type === 'rest:start') {
    event.waitUntil(scheduleRest(data));
  } else if (data.type === 'rest:stop') {
    clearRestTimer();
    event.waitUntil(
      self.registration.getNotifications({ tag: REST_TAG })
        .then((list) => list.forEach((item) => item.close()))
        .catch(() => {}),
    );
  } else if (data.type === 'ping') {
    event.source && event.source.postMessage({ type: 'pong', version: VERSION });
  }
});

/**
 * 서버 푸시.
 *
 * 워커가 내려가면 위의 setTimeout도 같이 죽는다. 그래서 확실한 손목 알림은
 * 결국 서버가 예약해 보내주는 푸시다. 서버는 아직 없지만 받는 쪽은 미리
 * 열어둔다 — 나중에 엔드포인트만 붙이면 된다.
 */
self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (err) {
    payload = { body: event.data ? event.data.text() : '' };
  }
  event.waitUntil(showRestDone(payload));
});

self.addEventListener('notificationclick', (event) => {
  const action = event.action;
  event.notification.close();

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ('focus' in client) {
          client.postMessage({ type: 'rest:action', action: action || 'next' });
          return client.focus();
        }
      }
      // 앱이 닫혀 있으면 열어준다.
      return self.clients.openWindow('./index.html?rest=' + encodeURIComponent(action || 'next'));
    }),
  );
});
