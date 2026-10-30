/**
 * 코치 목소리 — 미리 만든 소리 조각을 이어서 튼다.
 *
 * 기기 음성합성은 쓰지 않는다. 말은 엔진이 조각으로 나누고(E.speechSentences), 여기서는 그 조각
 * 파일을 받아 Web Audio로 빈틈 없이 이어 튼다 — 조각 사이 60ms, 문장 사이 280ms. 소리 파일은
 * voice/<목소리>/<조각 id>.mp3 (tools/voice가 만든다).
 *
 * 고른 목소리 하나만 받는다(약 9MB). 받은 파일은 Cache Storage에 두어 지하 헬스장에서도 나온다.
 * 아직 못 받은 조각은 건너뛴다 — 화면 글은 그대로 있으니 박자가 멈추지는 않는다.
 *
 * 아이폰은 사람이 화면을 누른 순간에만 소리를 연다. 첫 터치에 AudioContext를 깨운다.
 */
(function () {
  var CACHE = 'coach-voice-v1';
  var PIECE_GAP = 0.06;
  var SENTENCE_GAP = 0.28;

  var ctx = null;
  var voice = null;          // 지금 목소리 이름
  var manifest = null;       // 그 목소리의 조각 id 집합
  var manifestFor = null;
  var loading = null;
  var buffers = {};          // id → AudioBuffer (이 목소리 것만)
  var playing = [];          // 지금 울리거나 예약된 소리
  var queueEnd = 0;          // 예약된 마지막 소리가 끝나는 때 (ctx 시각)
  var generation = 0;        // cancel할 때마다 올린다 — 받는 중이던 말은 버린다
  var prefetch = { voice: null, done: 0, total: 0, running: false, listeners: [] };

  function audio() {
    if (ctx) return ctx;
    var Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return null;
    try { ctx = new Ctor(); } catch (err) { ctx = null; }
    return ctx;
  }

  /** 사람이 누른 순간에 부른다 — 아이폰은 그때만 소리를 연다. */
  function unlock() {
    var c = audio();
    if (c && c.state === 'suspended') c.resume().catch(function () {});
  }
  ['pointerdown', 'touchend', 'keydown'].forEach(function (type) {
    window.addEventListener(type, unlock, { passive: true, capture: true });
  });

  function base() {
    return 'voice/' + voice + '/';
  }

  function loadManifest() {
    if (manifest && manifestFor === voice) return Promise.resolve(manifest);
    if (loading && loading.voice === voice) return loading.promise;
    var want = voice;
    var promise = fetchCached(base() + 'manifest.json').then(function (response) {
      if (!response) throw new Error('목록이 없습니다');
      return response.json();
    }).then(function (data) {
      if (voice !== want) return manifest;
      manifest = {};
      (data.clips || []).forEach(function (id) { manifest[id] = true; });
      manifestFor = want;
      return manifest;
    }).catch(function () {
      if (voice === want) { manifest = null; manifestFor = null; }
      return null;
    }).then(function (value) {
      loading = null;
      return value;
    });
    loading = { voice: want, promise: promise };
    return promise;
  }

  /** 캐시에 있으면 캐시, 없으면 받아서 캐시에 넣는다. 못 받으면 null. */
  function fetchCached(url) {
    var store = window.caches ? window.caches.open(CACHE).catch(function () { return null; }) : Promise.resolve(null);
    return store.then(function (cache) {
      var hit = cache ? cache.match(url).catch(function () { return null; }) : Promise.resolve(null);
      return hit.then(function (found) {
        if (found) return found;
        return fetch(url).then(function (response) {
          if (!response.ok) return null;
          if (cache) cache.put(url, response.clone()).catch(function () {});
          return response;
        }).catch(function () { return null; });
      });
    });
  }

  function bufferFor(id) {
    if (buffers[id]) return Promise.resolve(buffers[id]);
    var c = audio();
    if (!c) return Promise.resolve(null);
    var want = voice;
    return fetchCached(base() + id + '.mp3').then(function (response) {
      return response ? response.arrayBuffer() : null;
    }).then(function (data) {
      if (!data) return null;
      return new Promise(function (resolve) {
        // 옛 사파리는 콜백 형식만 받는다
        c.decodeAudioData(data, resolve, function () { resolve(null); });
      });
    }).then(function (buffer) {
      if (buffer && voice === want) buffers[id] = buffer;
      return buffer;
    }).catch(function () { return null; });
  }

  /** 말 하나를 조각으로 나눠 예약한다. 앞 말이 아직 나오는 중이면 그 뒤에 이어 붙는다. */
  function speak(text) {
    if (!text || !voice) return;
    if (Array.isArray(window.__said)) window.__said.push(text);  // 브라우저 테스트가 들은 말을 본다
    var mine = generation;
    loadManifest().then(function (list) {
      if (mine !== generation || !list) return;
      var E = window.FitEngine;
      var plan = E.speechSentences(text, function (sentence) { return Boolean(list[E.clipId(sentence)]); });
      var ids = plan.map(function (sentence) {
        return sentence.map(function (piece) { return E.clipId(piece); }).filter(function (id) { return list[id]; });
      });
      var flat = [].concat.apply([], ids);
      return Promise.all(flat.map(bufferFor)).then(function (loaded) {
        if (mine !== generation) return;
        var c = audio();
        if (!c) return;
        var at = Math.max(c.currentTime + 0.05, queueEnd);
        var k = 0;
        ids.forEach(function (sentence, si) {
          sentence.forEach(function (id, pi) {
            var buffer = loaded[k++];
            if (!buffer) return;
            var source = c.createBufferSource();
            source.buffer = buffer;
            source.connect(c.destination);
            source.start(at);
            playing.push(source);
            source.onended = function () { playing = playing.filter(function (item) { return item !== source; }); };
            at += buffer.duration + (pi < sentence.length - 1 ? PIECE_GAP : 0);
          });
          if (si < ids.length - 1) at += SENTENCE_GAP;
        });
        queueEnd = at + 0.12;
      });
    });
  }

  /** 하던 말을 끊고 예약도 지운다. */
  function cancel() {
    generation += 1;
    playing.forEach(function (source) { try { source.stop(); } catch (err) { void err; } });
    playing = [];
    queueEnd = 0;
  }

  /** 목소리를 바꾼다. 바뀌면 받아 둔 소리를 버리고 새 목록을 읽는다. */
  function setVoice(name) {
    if (name === voice) return;
    cancel();
    voice = name;
    buffers = {};
    manifest = null;
    manifestFor = null;
    loadManifest();
  }

  /** 이 목소리 조각을 전부 미리 받아 둔다 — 한 번에 여섯 개씩. 끝나면 오프라인에서도 나온다. */
  function download(onProgress) {
    if (onProgress) prefetch.listeners.push(onProgress);
    if (prefetch.running && prefetch.voice === voice) return;
    var want = voice;
    prefetch = { voice: want, done: 0, total: 0, running: true, listeners: prefetch.listeners };
    loadManifest().then(function (list) {
      if (!list || voice !== want) { prefetch.running = false; return; }
      var ids = Object.keys(list);
      prefetch.total = ids.length;
      var next = 0;
      var tell = function () {
        prefetch.listeners.forEach(function (listener) { try { listener(prefetch.done, prefetch.total); } catch (err) { void err; } });
      };
      var worker = function () {
        if (voice !== want || next >= ids.length) return Promise.resolve();
        var url = 'voice/' + want + '/' + ids[next++] + '.mp3';
        return fetchCached(url).then(function () { prefetch.done += 1; if (prefetch.done % 25 === 0 || prefetch.done === prefetch.total) tell(); }).then(worker);
      };
      Promise.all([worker(), worker(), worker(), worker(), worker(), worker()]).then(function () {
        prefetch.running = false;
        if (voice === want) try { localStorage.setItem('coachVoiceReady', want); } catch (err) { void err; }
        tell();
        prefetch.listeners = [];
      });
    });
  }

  /** 이 목소리를 다 받아 두었는가 (이 폰에) */
  function ready(name) {
    try { return localStorage.getItem('coachVoiceReady') === (name || voice); } catch (err) { return false; }
  }

  function progress() {
    return { done: prefetch.done, total: prefetch.total, running: prefetch.running && prefetch.voice === voice };
  }

  window.CoachVoice = {
    setVoice: setVoice,
    speak: speak,
    cancel: cancel,
    unlock: unlock,
    download: download,
    ready: ready,
    progress: progress,
    available: function () { return Boolean(window.AudioContext || window.webkitAudioContext); },
    /** 지금 무언가 나오고 있는가 */
    speaking: function () { var c = audio(); return Boolean(c && queueEnd > c.currentTime); },
  };
})();
