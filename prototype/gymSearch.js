/*
 * 실제 헬스장 찾기 — 카카오 로컬 API에 대고 fetch만 쓴다.
 *
 * remote.js와 같은 규칙이다: 라이브러리 없이, 열쇠는 사용자가 직접 넣고,
 * 코드에는 아무것도 박아 두지 않는다.
 *
 * 다만 remote.js와 다른 점이 하나 있고, 그게 중요하다.
 *
 * **이 열쇠는 이 기기에만 둔다. 서버로 올리지 않는다.**
 *
 * Supabase의 anon 열쇠는 공개돼도 안전하게 설계된 값이지만, 카카오 REST
 * 열쇠는 그렇지 않다 — 가져간 사람이 그 사람의 하루 한도를 대신 써 버릴
 * 수 있다. 기록 동기화에 얹어서 올리면 남의 기기에도 복사되고, 그건
 * 사용자가 부탁한 적 없는 일이다. 그래서 sharedSettings()에 넣지 않는다.
 *
 * 그래도 브라우저에서 부르는 이상 열쇠는 이 기기 안에서는 보인다. 감출 수
 * 있는 척하지 않고 화면에 그대로 적어 둔다.
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

  function configured() {
    return apiKey().length > 0;
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
    if (!configured()) {
      return Promise.resolve({ ok: false, failure: 'noKey', parsed: parsed });
    }

    var url = ENDPOINT + '?query=' + encodeURIComponent(parsed.query) + '&size=' + SIZE;

    /*
     * 내 위치를 같이 보내면 카카오가 거리를 재서 준다. 위치 동의가 없으면
     * 안 보낸다 — 화면에서만 감추고 좌표를 계속 보내면 동의를 받은 게 아니다.
     * 좌표를 안 보내도 검색 자체는 된다.
     */
    var near = options.near;
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
    search: search,
    verify: verify,
  };
})();
