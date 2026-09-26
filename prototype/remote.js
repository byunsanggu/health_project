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

  /** 저장된 접속 정보와 로그인 상태. */
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
    var trimmedKey = (key || '').trim();
    if (trimmedKey.split('.').length !== 3) {
      problems.push('열쇠 모양이 아닙니다. Settings → API의 anon / public 값을 복사하세요.');
    } else if (/service_role/.test(atobSafe(trimmedKey.split('.')[1]))) {
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
      saveSession(payload);
      return { signedIn: true };
    });
  }

  function signOut() {
    var done = function () {
      patch({ accessToken: null, refreshToken: null, cursor: null });
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

  /** 서버에서 내 기록을 지운다. 지우는 길이 없으면 개인정보를 받을 자격이 없다. */
  function deleteEverything() {
    return withAuth(function () {
      return request('/rest/v1/rpc/delete_my_data', { method: 'POST', body: {} });
    });
  }

  return {
    read: read,
    patch: patch,
    configured: configured,
    signedIn: signedIn,
    email: email,
    looksValid: looksValid,
    signUp: signUp,
    signIn: signIn,
    signOut: signOut,
    checkSchema: checkSchema,
    transport: transport,
    deleteEverything: deleteEverything,
  };
})();
