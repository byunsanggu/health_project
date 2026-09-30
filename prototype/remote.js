/*
 * 서버와 이야기하기 — Supabase(PostgREST · GoTrue)에 대고 fetch만 쓴다.
 *
 * 라이브러리를 안 쓰는 이유가 있다. 이 앱은 한 장짜리 HTML로도 돌아가야
 * 하고, 나중에 서버를 갈아엎을 수도 있다. REST 두 개면 되는 일에 수백
 * 킬로바이트를 얹을 이유가 없다.
 *
 * **열쇠는 사용자가 앱에 직접 넣는다.** 코드에 박아 두지 않는다 — 관장님
 * 계정 정보를 남한테 보낼 일도 없고, 나중에 다른 사람이 자기 서버로
 * 쓰고 싶을 때도 그대로 된다.
 *
 * anon 열쇠는 공개돼도 안전하게 설계된 값이다. 남의 기록은 이 열쇠가
 * 아니라 DB의 RLS 정책이 막는다. service_role 열쇠는 그 정책을 전부
 * 무시하므로 앱에 절대 넣지 않는다.
 */
var Remote = (function () {
  'use strict';

  var KEY = 'volume-coach.remote';

  /*
   * 빌드할 때 박아 넣은 접속 정보.
   *
   * 이게 없으면 앱을 받은 사람이 주소와 열쇠를 손으로 넣어야 하고, 그러면
   * 아무도 동기화를 안 켠다 — 관장님 말이 맞았다. 서버는 하나인데 그 주소를
   * 사용자가 알아야 할 이유가 없다.
   *
   * publishable(anon) 열쇠는 **공개를 전제로 설계된 값**이다. 남의 기록은
   * 이 열쇠가 아니라 DB의 RLS 정책이 막는다. 그래서 브라우저에 박아도 된다 —
   * 세상 모든 Supabase 웹앱이 이렇게 쓴다. 카카오 열쇠와는 성격이 다르다.
   *
   * 빌드에서 넣지 않으면 그냥 비어 있고, 예전처럼 사용자가 넣는 길이 열린다.
   */
  function baked() {
    var defaults = window.__VOLUME_COACH_SERVER__;
    if (!defaults || !defaults.url || !defaults.anonKey) return null;
    return { url: defaults.url, anonKey: defaults.anonKey };
  }

  /**
   * 저장된 접속 정보와 로그인 상태.
   *
   * 박아 넣은 값이 바닥에 깔리고 저장된 값이 그 위에 얹힌다. 순서가 이래야
   * **사용자가 직접 넣은 주소가 이긴다** — 자기 서버를 쓰려는 사람의 설정을
   * 우리가 덮어쓰면 안 된다.
   *
   * 토큰 같은 로그인 상태는 저장된 쪽에만 있으므로 그대로 따라온다.
   */
  function read() {
    var defaults = baked();
    var stored = readStored();
    return defaults ? Object.assign({}, defaults, stored) : stored;
  }

  /** 이 기기에 실제로 적혀 있는 것만. 박아 넣은 값은 안 섞는다. */
  function readStored() {
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

  /*
   * 저장할 때는 **저장된 것에만** 얹는다.
   *
   * read()에 얹으면 박아 넣은 주소와 열쇠가 이 기기에 복사돼 버린다. 그러면
   * 나중에 서버를 옮겨서 새로 빌드해도, 예전에 한 번이라도 로그인한 기기는
   * 옛날 주소를 영영 붙들고 있게 된다.
   */
  function patch(partial) {
    var next = Object.assign(readStored(), partial);
    write(next);
    return read();
  }

  /** 주소 끝의 / 는 붙어 있어도 없어도 되게 만든다. */
  function baseUrl() {
    var url = (read().url || '').trim();
    return url.replace(/\/+$/, '');
  }

  function configured() {
    var state = read();
    return Boolean((state.url || '').trim() && (state.anonKey || '').trim());
  }

  function signedIn() {
    return Boolean(read().accessToken);
  }

  function email() {
    return read().email || null;
  }

  /*
   * 주소와 열쇠가 말이 되는지 미리 본다. 오타 하나 때문에 "안 돼요"를
   * 주고받는 것보다, 넣는 자리에서 바로 알려주는 편이 낫다.
   */
  function looksValid(url, key) {
    var problems = [];
    var trimmed = (url || '').trim();
    if (!/^https:\/\/[a-z0-9-]+\.supabase\.(co|in)\/?$/i.test(trimmed)) {
      problems.push('주소는 https://xxxx.supabase.co 모양이어야 합니다.');
    }
    /*
     * 열쇠 형식이 두 가지다.
     *
     * 예전 것은 JWT(점 두 개로 나뉜 긴 문자열)이고, 새 것은
     * sb_publishable_... / sb_secret_... 이다. 둘 다 받아야 한다 —
     * 새로 만든 프로젝트는 새 형식만 보여주는 경우가 있고, 그걸
     * "열쇠 모양이 아닙니다"로 막으면 사용자는 맞는 값을 들고도
     * 앞으로 못 간다.
     *
     * 막아야 하는 건 형식이 아니라 **권한**이다. service_role과
     * sb_secret_은 보안 정책을 전부 무시하므로 앱에 들어가면 안 된다.
     */
    var trimmedKey = (key || '').trim();
    var isJwt = trimmedKey.split('.').length === 3;
    var isNew = /^sb_(publishable|secret)_/.test(trimmedKey);

    if (!trimmedKey) {
      problems.push('열쇠를 넣어 주세요. Settings → API Keys 에서 복사합니다.');
    } else if (!isJwt && !isNew) {
      problems.push(
        '열쇠 모양이 아닙니다. Settings → API Keys 의 anon / public ' +
        '(또는 publishable) 값을 복사하세요.');
    } else if (/^sb_secret_/.test(trimmedKey)) {
      problems.push(
        'secret 열쇠입니다. 이 열쇠는 보안 정책을 전부 무시하므로 앱에 넣으면 안 됩니다 — ' +
        'publishable 열쇠를 쓰세요.');
    } else if (isJwt && /service_role/.test(atobSafe(trimmedKey.split('.')[1]))) {
      problems.push(
        'service_role 열쇠입니다. 이 열쇠는 보안 정책을 전부 무시하므로 앱에 넣으면 안 됩니다 — ' +
        'anon / public 열쇠를 쓰세요.');
    }
    return problems;
  }

  function atobSafe(text) {
    try {
      return atob(String(text).replace(/-/g, '+').replace(/_/g, '/'));
    } catch (err) {
      void err;
      return '';
    }
  }

  /** 서버가 보내는 오류는 모양이 제각각이다. 사람이 읽을 한 줄로 만든다. */
  function errorText(payload, status) {
    var message = (payload && (payload.error_description || payload.msg || payload.message
      || payload.error || payload.hint)) || '';
    if (/Invalid login credentials/i.test(message)) return '이메일이나 비밀번호가 다릅니다.';
    if (/Email not confirmed/i.test(message)) {
      return '이메일 확인이 아직입니다. 받은 메일의 링크를 누르거나, Supabase에서 Confirm email을 꺼 보세요.';
    }
    if (/User already registered|already been registered/i.test(message)) {
      return '이미 가입된 이메일입니다. 로그인해 주세요.';
    }
    if (/Password should be/i.test(message)) return '비밀번호가 너무 짧습니다. 6자 이상으로 해 주세요.';
    if (status === 404) return '주소가 맞는지 확인해 주세요. 표(schema.sql)를 아직 안 만들었을 수도 있습니다.';
    if (status === 401 || status === 403) return '열쇠가 맞는지 확인해 주세요.';
    return message || ('서버가 ' + status + ' 를 돌려주었습니다.');
  }

  function request(path, options) {
    var state = read();
    var opts = options || {};
    var headers = Object.assign({
      apikey: state.anonKey || '',
      'Content-Type': 'application/json',
    }, opts.headers || {});
    if (opts.auth !== false && state.accessToken) {
      headers.Authorization = 'Bearer ' + state.accessToken;
    }

    return fetch(baseUrl() + path, {
      method: opts.method || 'GET',
      headers: headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    }).then(function (response) {
      return response.text().then(function (text) {
        var payload = null;
        try { payload = text ? JSON.parse(text) : null; } catch (err) { void err; }
        if (!response.ok) {
          var error = new Error(errorText(payload, response.status));
          error.status = response.status;
          throw error;
        }
        return payload;
      });
    }, function () {
      /*
       * fetch 자체가 실패한 경우다. 신호가 없거나 주소가 틀렸거나 CORS다.
       * 어느 쪽인지 브라우저가 안 알려주므로 셋 다 말해 준다.
       */
      throw new Error('서버에 닿지 못했습니다. 인터넷 연결과 주소를 확인해 주세요.');
    });
  }

  /** 토큰이 만료되면 한 번 갱신하고 다시 해 본다. */
  function withAuth(run) {
    return run().catch(function (error) {
      if (error.status !== 401 || !read().refreshToken) throw error;
      return refresh().then(run);
    });
  }

  function saveSession(payload) {
    if (!payload || !payload.access_token) return payload;
    patch({
      accessToken: payload.access_token,
      refreshToken: payload.refresh_token || read().refreshToken,
      email: (payload.user && payload.user.email) || read().email,
    });
    return payload;
  }

  function refresh() {
    return request('/auth/v1/token?grant_type=refresh_token', {
      method: 'POST',
      auth: false,
      body: { refresh_token: read().refreshToken },
    }).then(saveSession, function (error) {
      // 갱신도 안 되면 로그인이 풀린 것이다. 조용히 로그아웃시킨다.
      patch({ accessToken: null, refreshToken: null });
      throw error;
    });
  }

  function signUp(userEmail, password) {
    return request('/auth/v1/signup', {
      method: 'POST',
      auth: false,
      body: { email: userEmail, password: password },
    }).then(function (payload) {
      forgetDeviceLink();
      saveSession(payload);
      /*
       * 이메일 확인이 켜져 있으면 토큰 없이 사용자만 돌아온다. 가입은
       * 됐는데 로그인은 안 된 상태이므로 그대로 말해 준다.
       */
      return {
        signedIn: Boolean(payload && payload.access_token),
        needsConfirm: Boolean(payload && !payload.access_token),
      };
    });
  }

  function signIn(userEmail, password) {
    return request('/auth/v1/token?grant_type=password', {
      method: 'POST',
      auth: false,
      body: { email: userEmail, password: password },
    }).then(function (payload) {
      forgetDeviceLink();
      saveSession(payload);
      return { signedIn: true };
    });
  }

  /**
   * 새 로그인이다 — 이 기기가 이 계정과 맞춰 본 적이 없는 상태로 되돌린다.
   *
   * 이 표시가 남아 있으면 다음 동기화가 이 기기 설정을 계정에 밀어 넣는다.
   * 폰을 물려받았거나 다른 계정으로 갈아탄 경우, 남의 설정이 내 계정을
   * 덮어쓰게 된다.
   *
   * 토큰 갱신에서는 부르지 않는다. 갱신은 같은 사람이 계속 쓰는 중인데,
   * 거기서 지우면 다음 동기화가 이 기기에서 방금 고친 것을 버리고 서버
   * 것을 되살린다.
   */
  function forgetDeviceLink() {
    patch({ cursor: null, settingsSynced: false });
  }

  function signOut() {
    var done = function () {
      patch({ accessToken: null, refreshToken: null });
      forgetDeviceLink();
    };
    if (!signedIn()) { done(); return Promise.resolve(); }
    return request('/auth/v1/logout', { method: 'POST' }).then(done, done);
  }

  /*
   * 표가 제대로 만들어졌는지 한 번 확인한다. schema.sql을 안 돌린 채로
   * 로그인만 하면 나중에 동기화에서 404가 나는데, 그때는 이유를 찾기
   * 어렵다. 여기서 미리 걸러 준다.
   */
  function checkSchema() {
    return withAuth(function () {
      return request('/rest/v1/records?select=id&limit=1');
    }).then(function () { return { ok: true }; }, function (error) {
      if (error.status === 404) {
        return { ok: false, reason: 'records 표가 없습니다. SQL Editor에서 server/schema.sql을 먼저 돌려 주세요.' };
      }
      return { ok: false, reason: error.message };
    });
  }

  /** sync.ts가 기대하는 모양. 이 둘만 있으면 동기화 엔진이 돌아간다. */
  function transport() {
    return {
      pull: function (cursor) {
        var query = '/rest/v1/records'
          + '?select=kind,id,updated_at,synced_at,deleted,body'
          + '&order=synced_at.asc&limit=500'
          + (cursor ? '&synced_at=gt.' + encodeURIComponent(cursor) : '');

        return withAuth(function () { return request(query); }).then(function (rows) {
          var list = rows || [];
          var records = list.map(function (row) {
            return {
              kind: row.kind,
              id: row.id,
              updatedAt: row.updated_at,
              deleted: Boolean(row.deleted),
              body: row.body,
            };
          });
          /*
           * 표시는 서버가 적은 synced_at에서 가져온다. 기기가 적은
           * updated_at을 쓰면 시계가 느린 폰이 올린 기록을 영영 못 받는다.
           */
          var cursorOut = cursor;
          for (var i = 0; i < list.length; i += 1) {
            if (!cursorOut || list[i].synced_at > cursorOut) cursorOut = list[i].synced_at;
          }
          return { records: records, cursor: cursorOut };
        });
      },

      /* 설정은 사람마다 한 줄이라 합칠 일이 없다. 통째로 주고받는다. */
      pullSettings: function () {
        return withAuth(function () {
          return request('/rest/v1/settings?select=updated_at,body&limit=1');
        }).then(function (rows) {
          var row = (rows || [])[0];
          return row ? { updatedAt: row.updated_at, body: row.body } : null;
        }, function (error) {
          // 표가 없으면 설정 없이 간다. 기록 동기화까지 막을 일은 아니다.
          if (error.status === 404) return null;
          throw error;
        });
      },

      pushSettings: function (settings) {
        return withAuth(function () {
          return request('/rest/v1/settings?on_conflict=user_id', {
            method: 'POST',
            headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
            body: [{ updated_at: settings.updatedAt, body: settings.body }],
          });
        }).then(function () {});
      },

      push: function (records) {
        if (!records || records.length === 0) return Promise.resolve();
        return withAuth(function () {
          return request('/rest/v1/rpc/push_records', {
            method: 'POST',
            body: { payload: records },
          });
        }).then(function () {});
      },
    };
  }

  /* ── 카카오·구글로 로그인 ─────────────────────── */

  /**
   * 왜 OAuth를 붙이는가.
   *
   * 이메일 가입은 확인 메일을 보내야 하는데, Supabase 기본 발송은 시간당
   * 두 통이다. 회원 세 분이 동시에 가입하면 세 번째 분은 메일을 못 받는다.
   * 카카오·구글로 들어오면 **메일을 아예 안 보낸다.**
   *
   * 그리고 한국에서 이메일·비밀번호를 새로 만들라는 것은 그 자체로 벽이다.
   * 헬스장 회원분들께는 "카카오로 시작" 한 번이 훨씬 낮다.
   */
  var PROVIDERS = {
    kakao: '카카오',
    google: '구글',
  };

  /*
   * 제공자에게 **무엇을 더 달라고 할 것인가.**
   *
   * 더, 다. 이 값은 요청 목록을 덮어쓰지 못한다 — Supabase가 제공자별
   * 기본 목록을 코드에 박아 두고, 여기 적은 것을 그 **뒤에 붙일 뿐이다.**
   *
   *   oauthScopes := []string{"account_email", "profile_image", "profile_nickname"}
   *   if scopes != "" { oauthScopes = append(oauthScopes, ...) }
   *
   * 그래서 카카오에 "닉네임만 주세요"라고 말할 방법이 없다. 이메일은 늘
   * 같이 요청되고, 비즈앱이 아니면 그 동의항목은 "권한 없음"이라서
   * 카카오가 KOE205로 막는다. 빼는 척하는 값을 여기 적어 두면 고쳐진
   * 줄 알고 다음 사람이 엉뚱한 데를 뒤진다. 비워 둔다.
   *
   * 카카오를 이메일 없이 붙이려면 authorize 주소를 쓰지 않고 우리 서버가
   * 직접 토큰을 교환하는 수밖에 없다(server/README.md 참고).
   *
   * 구글은 기본값이 그대로 맞아서 어차피 더 달라고 할 것이 없다.
   */
  var SCOPES = {};

  /** 돌아올 자리. 조각(#)과 물음표(?)를 뗀 이 페이지 주소다. */
  function returnUrl() {
    return location.origin + location.pathname;
  }

  /**
   * 제공자 화면으로 보낸다.
   *
   * 페이지를 떠나므로, 부르는 쪽은 **떠나기 전에 저장을 끝내 놓아야 한다.**
   * 온보딩 도중에 그냥 보내면 돌아왔을 때 처음부터 다시 하게 된다.
   */
  function oauthStart(provider) {
    if (!PROVIDERS[provider]) return;
    var url = baseUrl() + '/auth/v1/authorize' +
      '?provider=' + encodeURIComponent(provider) +
      '&redirect_to=' + encodeURIComponent(returnUrl());
    if (SCOPES[provider]) url += '&scopes=' + encodeURIComponent(SCOPES[provider]);
    location.href = url;
  }

  /**
   * 돌아왔을 때 주소에 붙어 온 것을 거둔다.
   *
   * Supabase는 토큰을 주소의 # 뒤에 붙여서 돌려준다. 그대로 두면 **주소를
   * 복사해 공유하는 순간 로그인 정보가 같이 간다.** 거두자마자 주소창에서
   * 지운다.
   *
   * 돌아온 게 아니면 null을 준다.
   */
  function captureOAuth() {
    var hash = (location.hash || '').replace(/^#/, '');
    if (!hash) return null;
    if (hash.indexOf('access_token=') < 0 && hash.indexOf('error') < 0) return null;

    var params = new URLSearchParams(hash);
    try {
      history.replaceState(null, '', returnUrl());
    } catch (err) {
      void err;
      location.hash = '';
    }

    var failure = params.get('error_description') || params.get('error');
    if (failure) return { ok: false, message: decodeURIComponent(failure) };

    var token = params.get('access_token');
    if (!token) return { ok: false, message: '로그인 정보를 받지 못했습니다.' };

    forgetDeviceLink();
    patch({
      accessToken: token,
      refreshToken: params.get('refresh_token') || null,
    });

    return { ok: true, provider: params.get('provider') || null };
  }

  /**
   * 내 계정 정보를 받아 이메일을 채운다.
   *
   * 카카오는 비즈앱이 아니면 이메일을 안 준다. 그때는 이메일이 비는데,
   * 그게 정상이다 — 신원은 계정 id이지 이메일이 아니다. 화면이 빈 칸을
   * 보여주지 않게 없으면 없는 대로 둔다.
   */
  function loadIdentity() {
    return withAuth(function () {
      return request('/auth/v1/user', { method: 'GET' });
    }).then(function (user) {
      var email = (user && user.email) || '';
      if (email) patch({ email: email });
      return user;
    }, function () { return null; });
  }

  function providerLabel(provider) {
    return PROVIDERS[provider] || provider;
  }

  /* ── 헬스장 나누기 ────────────────────────────── */

  /**
   * DB 함수 부르기.
   *
   * 읽기(집계)는 로그인 없이도 된다 — 처음 켠 사람이 헬스장을 고를 때
   * 이미 채워진 기구 목록이 보여야 하고, 그 앞에 회원가입을 세우면
   * 크라우드소싱의 값어치가 절반으로 준다.
   */
  function rpc(name, body, options) {
    var run = function () {
      return request('/rest/v1/rpc/' + name, { method: 'POST', body: body || {} });
    };
    return (options && options.anon) ? run() : withAuth(run);
  }

  /**
   * 내가 아는 헬스장과 기구를 올린다.
   *
   * 로그인 안 했으면 조용히 넘어간다. 여기서 막아 세우면 기구 하나 고치려다
   * 로그인 화면을 만나게 되는데, 그건 고치려던 사람을 쫓아내는 것이다.
   */
  function shareGym(gym, equipment) {
    if (!signedIn()) return Promise.resolve(0);
    return rpc('share_gym', { gym: gym, equipment: equipment || [] });
  }

  /** 이 헬스장에 뭐가 있다고들 하는가. 로그인 없이도 읽는다. */
  function sharedEquipment(gymId) {
    return rpc('gym_equipment_ids', { target: gymId }, { anon: true });
  }

  /** 이 헬스장을 쓰는 사람 수. 비율의 분모다. */
  function gymPeople(gymId) {
    return rpc('gym_people', { target: gymId }, { anon: true });
  }

  /** 몇 명이 무엇을 뺐는가. 아파서 뺀 것은 애초에 안 올라가 있다. */
  function gymSkips(gymId) {
    return rpc('gym_skip_counts', { target: gymId }, { anon: true });
  }

  /**
   * 내가 뺀 종목을 남긴다.
   *
   * **아파서 뺀 것은 절대 여기 오면 안 된다.** 건강 정보라서 익명으로
   * 모아도 "이 헬스장 사람들이 허리가 아프다"는 말이 만들어진다. 앱에서
   * 한 번, DB의 check 제약에서 한 번 막는다 — 앱은 여러 버전이 돌아다니지만
   * DB는 하나다.
   */
  function shareSkip(gymId, exerciseId, reason) {
    if (!signedIn()) return Promise.resolve(null);
    if (reason !== 'noEquipment' && reason !== 'dislike') return Promise.resolve(null);
    return rpc('share_skip', { target: gymId, exercise: exerciseId, skip_reason: reason });
  }

  function unshareSkip(gymId, exerciseId) {
    if (!signedIn()) return Promise.resolve(null);
    return rpc('unshare_skip', { target: gymId, exercise: exerciseId });
  }

  /* ── 친구 ──────────────────────────────────────── */

  /**
   * 친구에게 보일 이름을 정하고 내 코드를 받는다.
   *
   * 코드는 처음 한 번만 정해진다. 이름을 바꿔도 그대로여야 한다 —
   * 친구가 적어 둔 코드가 죽으면 안 된다.
   */
  function setProfile(name) {
    if (!signedIn()) return Promise.resolve(null);
    return rpc('set_my_profile', { name: name });
  }

  /**
   * 이번 주 요약을 올린다 — 친구에게 보이는 것 전부.
   *
   * 나온 날 수·목표·연속뿐이다. 무게도 종목도 통증도 담지 않는다.
   * 서버가 내 기록을 뒤져 만들지 않고 **내가 직접 올린다** — 그 통로를
   * 안 여는 것이 이 설계의 요점이다.
   */
  function putWeek(weekStart, days, target, streak) {
    if (!signedIn()) return Promise.resolve(null);
    return rpc('put_week_summary', {
      week: weekStart, days_done: days, week_target: target, streak_weeks: streak,
    });
  }

  function addFriend(code) {
    if (!signedIn()) return Promise.resolve({ ok: false, reason: 'signedOut' });
    return rpc('add_friend', { code: code });
  }

  function removeFriend(userId) {
    if (!signedIn()) return Promise.resolve(null);
    return rpc('remove_friend', { other: userId });
  }

  function sendCheer(userId, kind) {
    if (!signedIn()) return Promise.resolve(false);
    return rpc('send_cheer', { other: userId, cheer_kind: kind });
  }

  function myFriends(weekStart) {
    if (!signedIn()) return Promise.resolve([]);
    return rpc('my_friends', { week: weekStart }).then(function (rows) {
      return rows || [];
    }, function () { return []; });
  }

  function myCheers() {
    if (!signedIn()) return Promise.resolve([]);
    return rpc('my_cheers', {}).then(function (rows) { return rows || []; },
      function () { return []; });
  }

  function markCheersSeen() {
    if (!signedIn()) return Promise.resolve(null);
    return rpc('mark_cheers_seen', {});
  }

  /**
   * 다시 부를 시각과 할 말을 올린다.
   *
   * **판단은 앱이 이미 끝냈다.** 여기서 올라가는 것은 결론뿐이라, 서버는
   * 통증도 세션 기록도 볼 필요가 없다.
   */
  function queueNudge(subscription, at, title, body) {
    if (!signedIn() || !subscription) return Promise.resolve(null);
    return rpc('queue_nudge', {
      sub: subscription,
      at: at,
      nudge_title: title,
      nudge_body: body,
    });
  }

  /**
   * 예약을 지운다.
   *
   * 운동하고 나왔거나 아프다고 적었을 때 부른다. 이게 안 불리면 앱이
   * 거짓말을 한다 — 방금 헬스장에서 나왔는데 두 시간 뒤에 "오늘 한 번
   * 어떠세요"가 울린다.
   */
  function cancelNudge() {
    if (!signedIn()) return Promise.resolve(null);
    return rpc('cancel_nudge', {});
  }

  /** 서버에서 내 기록을 지운다. 지우는 길이 없으면 개인정보를 받을 자격이 없다. */
  function deleteEverything() {
    return withAuth(function () {
      return request('/rest/v1/rpc/delete_my_data', { method: 'POST', body: {} });
    }).then(function () {
      /*
       * 헬스장 쪽도 같이 지운다. 기구 확인과 뺀 종목에는 내 user_id가
       * 붙어 있다. 헬스장 자체는 남는다 — 다른 사람들이 쓰고 있고,
       * 거기엔 내 정보가 없다.
       *
       * 이게 없으면 "다 지웠습니다"가 거짓말이 된다.
       */
      return rpc('delete_my_gym_data', {}).catch(function () { return null; });
    }).then(function () {
      // 알림 예약도 같이. 지웠다면서 며칠 뒤에 알림이 울리면 안 된다.
      return rpc('delete_my_push_data', {}).catch(function () { return null; });
    }).then(function () {
      // 친구·응원·주간 요약도. 남겨 두면 친구 목록에 유령이 남는다.
      return rpc('delete_my_friend_data', {}).catch(function () { return null; });
    });
  }

  /**
   * 엣지 함수 부르기.
   *
   * 로그인 여부와 상관없이 Authorization을 채워 보낸다 — 로그인 안 한
   * 사람도 헬스장은 찾을 수 있어야 하고, 게이트웨이는 이 프로젝트 열쇠를
   * 가진 요청만 함수까지 들여보낸다.
   */
  function callFunction(name, body) {
    var state = read();
    var token = state.accessToken || state.anonKey || '';
    return fetch(baseUrl() + '/functions/v1/' + name, {
      method: 'POST',
      headers: {
        apikey: state.anonKey || '',
        Authorization: 'Bearer ' + token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body || {}),
    }).then(function (response) {
      return response.json().catch(function () { return {}; }).then(function (payload) {
        return { ok: response.ok, status: response.status, payload: payload || {} };
      });
    }, function () {
      return { ok: false, status: 0, payload: {} };
    });
  }

  return {
    read: read,
    baked: baked,
    patch: patch,
    callFunction: callFunction,
    configured: configured,
    signedIn: signedIn,
    email: email,
    looksValid: looksValid,
    signUp: signUp,
    signIn: signIn,
    signOut: signOut,
    checkSchema: checkSchema,
    transport: transport,
    oauthStart: oauthStart,
    captureOAuth: captureOAuth,
    loadIdentity: loadIdentity,
    providerLabel: providerLabel,
    shareGym: shareGym,
    sharedEquipment: sharedEquipment,
    gymPeople: gymPeople,
    gymSkips: gymSkips,
    shareSkip: shareSkip,
    unshareSkip: unshareSkip,
    setProfile: setProfile,
    putWeek: putWeek,
    addFriend: addFriend,
    removeFriend: removeFriend,
    sendCheer: sendCheer,
    myFriends: myFriends,
    myCheers: myCheers,
    markCheersSeen: markCheersSeen,
    queueNudge: queueNudge,
    cancelNudge: cancelNudge,
    deleteEverything: deleteEverything,
  };
})();
