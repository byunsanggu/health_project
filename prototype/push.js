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
