/*
 * 실제 헬스장 찾기.
 *
 * 길이 둘인데, 중요한 건 어느 쪽이 기본인가다.
 *
 * **기본은 서버다.** 앱을 받은 사람은 열쇠를 넣지 않는다 — 넣어야 한다면
 * 아무도 안 쓴다. 카카오 열쇠는 앱 만든 사람 것 하나가 서버(엣지 함수)에
 * 있고, 모든 사용자의 검색이 거기를 지나간다. 브라우저에는 열쇠가 없으니
 * 새어 나갈 것도 없고, 카카오에 도메인을 등록할 일도 없다.
 *
 * **기기 열쇠는 만든 사람용 임시 통로다.** 서버를 아직 안 붙였을 때
 * 혼자 시험해 보려고 남겨 둔 길이다. 이 열쇠는 이 기기에만 두고 기록
 * 동기화에 얹지 않는다 — 올리면 남의 기기까지 복사되고, 그건 사용자가
 * 부탁한 적 없는 일이다. 다만 브라우저에서 직접 부르는 이상 이 기기
 * 안에서는 보인다. 감출 수 있는 척하지 않는다.
 *
 * 그래서 순서는 서버 → 기기 열쇠다. 반대로 두면, 서버를 붙인 뒤에도
 * 옛날에 열쇠를 넣어 본 기기만 다르게 동작한다.
 */
var GymSearch = (function () {
  'use strict';

  var KEY = 'volume-coach.gymsearch';
  var ENDPOINT = 'https://dapi.kakao.com/v2/local/search/keyword.json';

  /** 한 번에 받을 개수. 더 받아 봐야 사람은 위에서 다섯 개만 본다. */
  var SIZE = 15;

  function read() {
    try {
      var raw = localStorage.getItem(KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (err) {
      void err;
      return {};
    }
  }

  function write(next) {
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch (err) {
      void err;
    }
  }

  function patch(partial) {
    var next = Object.assign(read(), partial);
    write(next);
    return next;
  }

  function apiKey() {
    return (read().kakaoKey || '').trim();
  }

  /** 서버로 찾을 수 있는가 — 이게 기본 길이다. */
  function serverReady() {
    return typeof Remote !== 'undefined' && Remote.configured();
  }

  /** 어느 쪽으로든 찾을 수 있는가. */
  function configured() {
    return serverReady() || apiKey().length > 0;
  }

  /** 지금 어느 길로 찾고 있는가. 화면이 사실대로 말하려면 필요하다. */
  function route() {
    if (serverReady()) return 'server';
    if (apiKey().length > 0) return 'device';
    return 'none';
  }

  /** 열쇠를 지운다. 검색이 꺼지는 것이고 등록한 헬스장은 그대로 남는다. */
  function forget() {
    write({});
  }

  /**
   * 찾는다.
   *
   * 실패를 예외로 던지지 않고 결과에 담아 돌려준다. 검색이 안 되는 건
   * 흔한 일이고(지하, 한도, 오타 난 열쇠) 그때마다 앱이 멈추면 안 된다.
   * 부르는 쪽은 항상 { ok } 하나만 보면 된다.
   */
  function search(text, options) {
    options = options || {};
    var E = window.FitEngine;
    var parsed = E.parsePlaceQuery(text);

    if (!parsed.searchable) {
      return Promise.resolve({ ok: true, places: [], parsed: parsed });
    }

    /*
     * 내 위치를 같이 보내면 거리를 재서 준다. 위치 동의가 없으면 안 보낸다 —
     * 화면에서만 감추고 좌표를 계속 보내면 동의를 받은 게 아니다.
     * 좌표를 안 보내도 검색 자체는 된다.
     */
    var near = options.near;

    if (serverReady()) return viaServer(parsed, near);
    if (apiKey().length === 0) {
      return Promise.resolve({ ok: false, failure: 'noKey', parsed: parsed });
    }
    return viaDevice(parsed, near);
  }

  /** 서버를 지나간다 — 사용자는 열쇠를 모른다. */
  function viaServer(parsed, near) {
    var E = window.FitEngine;
    var body = { query: parsed.query };
    if (near) { body.x = near.lng; body.y = near.lat; }

    return Remote.callFunction('gym-search', body).then(function (result) {
      if (!result.ok) {
        var failure = result.payload.failure
          || (result.status === 0 ? 'network' : E.failureFromStatus(result.status));
        return { ok: false, failure: failure, parsed: parsed };
      }
      var places = E.rankPlaces(E.normalizePlaces(result.payload.places || [], { near: near }));
      return { ok: true, places: places, parsed: parsed };
    });
  }

  /** 이 기기 열쇠로 직접 부른다 — 서버를 안 붙였을 때만. */
  function viaDevice(parsed, near) {
    var E = window.FitEngine;
    var url = ENDPOINT + '?query=' + encodeURIComponent(parsed.query) + '&size=' + SIZE;

    if (near) {
      url += '&x=' + encodeURIComponent(near.lng) + '&y=' + encodeURIComponent(near.lat);
      url += '&sort=distance';
    }

    return fetch(url, { headers: { Authorization: 'KakaoAK ' + apiKey() } })
      .then(function (response) {
        if (!response.ok) {
          return { ok: false, failure: E.failureFromStatus(response.status), parsed: parsed };
        }
        return response.json().then(function (data) {
          var places = E.rankPlaces(E.normalizePlaces(data.documents || [], { near: near }));
          return { ok: true, places: places, parsed: parsed };
        });
      })
      .catch(function (err) {
        /*
         * 여기로 오는 건 둘 중 하나다: 정말 인터넷이 없거나, 브라우저가
         * 교차 출처로 막았거나. 사용자 입장에서 할 일은 같다 — 밖에서
         * 다시 해 보고, 그래도 안 되면 직접 등록한다.
         */
        void err;
        return { ok: false, failure: 'network', parsed: parsed };
      });
  }

  /**
   * 넣은 열쇠가 실제로 되는지 한 번 확인한다.
   *
   * 형식만 보고 "됐습니다"라고 하면 안 된다. 사람들은 JavaScript 열쇠나
   * 네이티브 앱 열쇠를 잘못 가져오는데, 그건 형식이 같아서 눈으로는 안
   * 갈린다. 실제로 한 번 불러 봐야 안다.
   */
  function verify(key) {
    var E = window.FitEngine;
    var trimmed = (key || '').trim();
    if (!E.looksLikeKakaoKey(trimmed)) {
      return Promise.resolve({ ok: false, failure: 'badKey' });
    }

    return fetch(ENDPOINT + '?query=' + encodeURIComponent('헬스장') + '&size=1', {
      headers: { Authorization: 'KakaoAK ' + trimmed },
    })
      .then(function (response) {
        if (!response.ok) return { ok: false, failure: E.failureFromStatus(response.status) };
        patch({ kakaoKey: trimmed, verifiedAt: new Date().toISOString() });
        return { ok: true };
      })
      .catch(function (err) {
        void err;
        return { ok: false, failure: 'network' };
      });
  }

  return {
    read: read,
    patch: patch,
    forget: forget,
    configured: configured,
    serverReady: serverReady,
    route: route,
    search: search,
    verify: verify,
  };
})();
