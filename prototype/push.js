/**
 * 다시 부르기 — 브라우저 쪽.
 *
 * 며칠 뒤에 울려야 하는 알림은 앱이 직접 못 건다. 앱이 닫혀 있고, 서비스
 * 워커도 몇 분이면 내려간다. 서버가 보내주는 수밖에 없다.
 *
 * 그런데 **서버가 판단하게 두지는 않는다.** 판단하려면 그 사람의 통증과
 * 세션 기록을 읽어야 하는데, 그건 민감정보다. 읽을 필요가 없는 곳에서
 * 읽게 만들면 언젠가 샌다.
 *
 * 그래서 이렇게 나눈다.
 *
 *   앱  — 누구를 언제 부를지, 뭐라고 할지 정한다 (nudge.ts)
 *   서버 — 앱이 적어 둔 것을 시간 맞춰 보내기만 한다
 *
 * 앱을 열 때마다 다시 계산해서 덮어쓰므로, 예약은 늘 최신 하나만 남는다.
 */
(function () {
  'use strict';

  /*
   * iOS는 **홈 화면에 설치한 PWA만** 푸시를 받는다(16.4+). 사파리 탭에서는
   * 권한 창조차 안 뜬다. 그래서 켤 수 있는지 물어보는 쪽이 먼저다 — 눌러도
   * 아무 일이 없는 버튼을 띄우면 사용자는 자기가 잘못한 줄 안다.
   */
  function supported() {
    return 'serviceWorker' in navigator &&
      'PushManager' in window &&
      'Notification' in window;
  }

  function permission() {
    return supported() ? Notification.permission : 'unsupported';
  }

  /** 빌드에 박힌 공개 열쇠. 없으면 이 기능 자체가 없는 것이다. */
  function publicKey() {
    var baked = window.__VOLUME_COACH_SERVER__ || {};
    return baked.vapidPublicKey || '';
  }

  function configured() {
    return supported() && publicKey().length > 0;
  }

  /** base64url → Uint8Array. 브라우저가 그 꼴로만 받는다. */
  function decodeKey(base64) {
    var padded = base64.replace(/-/g, '+').replace(/_/g, '/');
    while (padded.length % 4) padded += '=';
    var raw = atob(padded);
    var out = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
    return out;
  }

  /** ArrayBuffer → base64url. 서버에 실어 보낼 꼴. */
  function encodeKey(buffer) {
    var bytes = new Uint8Array(buffer);
    var binary = '';
    for (var i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function registration() {
    if (!('serviceWorker' in navigator)) return Promise.reject(new Error('서비스 워커가 없습니다.'));
    return navigator.serviceWorker.ready;
  }

  /** 지금 구독이 있으면 그것을, 없으면 null. 권한을 묻지 않는다. */
  function current() {
    if (!configured()) return Promise.resolve(null);
    return registration()
      .then(function (reg) { return reg.pushManager.getSubscription(); })
      .catch(function () { return null; });
  }

  function toRow(subscription) {
    if (!subscription) return null;
    var json = subscription.toJSON ? subscription.toJSON() : {};
    var keys = json.keys || {};
    return {
      endpoint: subscription.endpoint,
      p256dh: keys.p256dh || encodeKey(subscription.getKey('p256dh')),
      auth: keys.auth || encodeKey(subscription.getKey('auth')),
    };
  }

  /**
   * 켜기 — 권한을 묻고 구독한다.
   *
   * 권한은 **사용자가 누른 그 순간에** 물어야 한다. 앱을 켜자마자 묻는
   * 브라우저 창은 대부분 거절당하고, 한 번 거절되면 다시 못 묻는다.
   */
  function enable() {
    if (!configured()) return Promise.resolve({ ok: false, reason: 'unsupported' });

    return Notification.requestPermission().then(function (result) {
      if (result !== 'granted') return { ok: false, reason: result };

      return registration().then(function (reg) {
        return reg.pushManager.subscribe({
          // 소리 없이 데이터만 받는 구독은 브라우저가 거부한다. 늘 보이는 알림이다.
          userVisibleOnly: true,
          applicationServerKey: decodeKey(publicKey()),
        });
      }).then(function (subscription) {
        return { ok: true, subscription: toRow(subscription) };
      });
    }).catch(function (error) {
      return { ok: false, reason: 'error', message: error.message };
    });
  }

  /** 끄기 — 구독을 버리고 예약도 지운다. 지우는 쪽은 부르는 곳에서. */
  function disable() {
    return current().then(function (subscription) {
      if (!subscription) return true;
      return subscription.unsubscribe().catch(function () { return false; });
    });
  }

  window.FitPush = {
    supported: supported,
    configured: configured,
    permission: permission,
    current: function () { return current().then(toRow); },
    enable: enable,
    disable: disable,
  };
})();

/**
 * 휴식 끝 알림 — 아이폰 잠금 화면에서 음악을 끊지 않고.
 *
 * 아이폰은 화면을 잠근 채 웹앱이 소리를 내려면 음악 앱처럼(<audio>) 틀어야 하고, 그러면 듣던
 * 애플 뮤직 · 스포티파이가 멈춘다. 시스템 알림의 소리와 애플워치 진동은 음악을 멈추지 않는다.
 * 그래서 쉬는 중에 화면이 잠기면 서버(functions/rest-alarm)에게 "이 시각에 한 번"을 맡긴다.
 *
 * **서버에는 시각과 아무 뜻 없는 알람 번호만 간다.** "휴식 끝 · 2세트 시작" 같은 말은 여기서
 * 폰 안(Cache Storage)에 적어 두고, 푸시가 닿으면 서비스 워커(sw.js)가 그걸 읽어 띄운다.
 *
 * 앱(app.js)이 부르는 것
 *   prime()   휴식이 시작될 때 — 구독을 확인하고 토큰을 미리 갱신한다(화면이 꺼지는 순간에는 틈이 없다)
 *   ready()   지금 걸 수 있는가 — 동기. 아니면 앱이 예전 길(코치 목소리)로 간다
 *   arm()     화면이 꺼질 때. 실패하면 false — 앱이 예전 길로 넘어간다
 *   cancel()  화면으로 돌아왔을 때 · 휴식을 건너뛰거나 끝냈을 때
 */
(function () {
  'use strict';

  /** 서비스 워커와 같이 쓰는 곳. 이름을 바꾸면 sw.js의 REST_ALARM_CACHE도 같이. */
  var CACHE = 'rest-alarm-v1';
  // 주소의 폴더 · 물음표와 상관없이 워커와 같은 열쇠가 되게 — 출처 + 고정 경로
  var KEY = location.origin + '/__rest-alarm__/next';
  /** 걸기에 실패하면 이만큼은 예전 길로 — 신호 없는 지하에서 화면을 켤 때마다 다시 시도하지 않는다. */
  var COOLDOWN_MS = 10 * 60 * 1000;

  var sub = null;
  var checked = false;
  var armed = null;     // { id, sendAt, pending }
  var failUntil = 0;
  var lastCall = null;  // 시험이 본다 — 서버에 보낸 그대로

  function hasRemote() {
    return typeof Remote !== 'undefined' && Remote.configured() && Remote.signedIn();
  }

  function configured() {
    return Boolean(window.FitPush && window.FitPush.configured() && hasRemote());
  }

  /** 구독을 다시 읽는다. 권한을 묻지 않는다. */
  function refresh() {
    if (!configured()) { sub = null; checked = true; return Promise.resolve(null); }
    return window.FitPush.current().then(function (row) {
      sub = row || null;
      checked = true;
      return sub;
    }, function () { sub = null; checked = true; return null; });
  }

  function prime() {
    if (!configured()) return Promise.resolve(false);
    var fresh = Remote.freshen ? Remote.freshen() : Promise.resolve(true);
    return Promise.all([refresh(), fresh]).then(function (both) { return Boolean(both[0]) && both[1] !== false; });
  }

  function permitted() {
    return typeof Notification !== 'undefined' && Notification.permission === 'granted';
  }

  /** 지금 걸 수 있는가. 화면이 꺼지는 순간에 부르므로 기다리지 않고 답한다. */
  function ready() {
    if (!configured() || !sub || !permitted()) return false;
    if (navigator.onLine === false) return false;
    return Date.now() >= failUntil;
  }

  /** 알림을 켤 수 있게 다 갖췄는데 구독만 없는가 — 설정의 "알림 켜기" 단추를 보일지. */
  function subscribed() {
    return Boolean(sub);
  }

  function newId() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    var bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    var hex = Array.prototype.map.call(bytes, function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
    return hex.slice(0, 8) + '-' + hex.slice(8, 12) + '-' + hex.slice(12, 16) + '-' + hex.slice(16, 20) + '-' + hex.slice(20);
  }

  /** 폰 안에 적는다 — 서비스 워커가 푸시를 받으면 이걸 읽는다. 서버에는 안 간다. */
  function remember(record) {
    if (typeof caches === 'undefined') return Promise.resolve(false);
    return caches.open(CACHE).then(function (cache) {
      return cache.put(KEY, new Response(JSON.stringify(record), { headers: { 'content-type': 'application/json' } }));
    }).then(function () { return true; }, function () { return false; });
  }

  /**
   * 화면이 꺼질 때 — endsAt(ms)에 "title · body"로 울리게 건다. 걸리면 true.
   * 앱은 true를 기다리지 않고 바로 소리를 안 튼다(음악이 안 멈추게). false가 오면 예전 길로 넘어간다.
   */
  function arm(input) {
    if (!ready() || !window.FitEngine || !FitEngine.planRestAlarm) return Promise.resolve(false);
    var plan = FitEngine.planRestAlarm({ now: Date.now(), endsAt: input.endsAt });
    if (!plan) return Promise.resolve(false);
    var id = newId();
    var record = { id: id, title: input.title, body: input.body, sendAt: plan.sendAt, state: 'armed' };
    var stored = remember(record);
    lastCall = { alarm_id: id, send_at: plan.sendAt, endpoint: sub.endpoint };
    var pending = Remote.armRestAlarm(sub, id, plan.sendAt).then(function (result) {
      if (result && result.ok) return true;
      // 401은 토큰 — 다음 휴식 시작 때 갱신된다. 나머지(오프라인 · 서버 없음)는 한동안 예전 길로
      failUntil = Date.now() + (result && result.status === 401 ? 60 * 1000 : COOLDOWN_MS);
      if (armed && armed.id === id) armed = null;
      return stored.then(function () { return remember({ id: id, state: 'failed' }); }).then(function () { return false; });
    });
    // 앞서 걸어 둔 것(같은 휴식을 +30초 한 경우)은 서버에서 덮어쓰인다 — 같은 기기라 한 줄이다
    armed = { id: id, sendAt: plan.sendAt, pending: pending };
    return pending;
  }

  /** 지금 걸려 있는 알람을 지운다. 걸던 요청이 아직 가는 중이면 그게 닿은 뒤에 지운다(순서가 뒤바뀌면 남는다). */
  function cancel() {
    if (!armed) return Promise.resolve(false);
    var gone = armed;
    armed = null;
    remember({ id: gone.id, state: 'cancelled' });
    return gone.pending.then(function (ok) {
      if (!ok) return false;
      return Remote.cancelRestAlarm(gone.id).then(function () { return true; }, function () { return false; });
    });
  }

  function isArmed() {
    return Boolean(armed);
  }

  window.FitRestPush = {
    configured: configured,
    refresh: refresh,
    prime: prime,
    ready: ready,
    subscribed: subscribed,
    checked: function () { return checked; },
    arm: arm,
    cancel: cancel,
    armed: isArmed,
    lastCall: function () { return lastCall; },
    CACHE: CACHE,
    KEY: KEY,
  };
})();
