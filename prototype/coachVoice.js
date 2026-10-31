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
  var rate = 1;              // 말 빠르기 — 1이 녹음 그대로
  var stretched = {};        // id → 그 빠르기로 늘이거나 줄인 소리 (rate가 바뀌면 버린다)

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

  /** 지금 빠르기의 소리. 1이 아니면 높이는 그대로 두고 길이만 바꾼다(timeStretch). */
  function bufferAtRate(id) {
    var want = rate;
    return bufferFor(id).then(function (buffer) {
      if (!buffer || want === 1) return buffer;
      var key = id + '@' + want;
      if (!stretched[key]) stretched[key] = timeStretch(buffer, want);
      return stretched[key];
    });
  }

  /**
   * 말 빠르기를 바꾼다 — 재생 속도를 올리면 목소리가 다람쥐처럼 높아진다. 그래서 짧은 조각(30ms)을
   * 겹쳐 이어 붙이되, 이음매가 제일 잘 맞는 자리를 찾아 붙인다(WSOLA). 높이는 그대로, 길이만 1/rate.
   */
  function timeStretch(buffer, speed) {
    var c = audio();
    if (!c) return buffer;
    var data = buffer.getChannelData(0);
    var sr = buffer.sampleRate;
    var frame = Math.round(sr * 0.03);
    var hop = Math.floor(frame / 2);
    var search = Math.round(sr * 0.012);
    var length = Math.ceil(data.length / speed) + frame;
    var out = new Float32Array(length);
    var win = new Float32Array(frame);
    for (var w = 0; w < frame; w += 1) win[w] = 0.5 - 0.5 * Math.cos((2 * Math.PI * w) / frame);
    var prev = 0;
    for (var k = 0; k * hop + frame < length; k += 1) {
      var target = Math.round(k * hop * speed);
      var pos = target;
      if (k > 0) {
        // 앞 조각이 자연스럽게 이어질 자리(prev + hop)와 제일 닮은 곳을 target 근처에서 고른다
        var natural = prev + hop;
        var best = -Infinity;
        for (var d = -search; d <= search; d += 2) {
          var at = target + d;
          if (at < 0 || at + hop >= data.length || natural + hop >= data.length) continue;
          var score = 0;
          for (var j = 0; j < hop; j += 4) score += data[at + j] * data[natural + j];
          if (score > best) { best = score; pos = at; }
        }
      }
      if (pos + frame > data.length) break;
      var base = k * hop;
      for (var i = 0; i < frame; i += 1) out[base + i] += data[pos + i] * win[i];
      prev = pos;
    }
    var used = Math.min(length, Math.ceil(data.length / speed));
    var result = c.createBuffer(1, Math.max(1, used), sr);
    result.getChannelData(0).set(out.subarray(0, Math.max(1, used)));
    return result;
  }

  function setRate(next) {
    var value = Number(next) || 1;
    if (value === rate) return;
    rate = value;
    stretched = {};
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
      return Promise.all(flat.map(bufferAtRate)).then(function (loaded) {
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
    stretched = {};
    manifest = null;
    manifestFor = null;
    loadManifest();
  }

  /** 이 목소리 조각을 전부 미리 받아 둔다 — 한 번에 여섯 개씩. 끝나면 오프라인에서도 나온다. */
  function download(onProgress) {
    if (onProgress) prefetch.listeners.push(onProgress);
    if (prefetch.running && prefetch.voice === voice) return;
    var want = voice;
    // 받는 중에 목소리를 바꾸면 앞의 것은 멈춘다 — 앞의 것이 끝나며 새 진행을 지우지 않게 이 판만 고친다
    var run = { voice: want, done: 0, total: 0, running: true, listeners: prefetch.listeners };
    prefetch = run;
    var tell = function () {
      run.listeners.forEach(function (listener) { try { listener(run.done, run.total); } catch (err) { void err; } });
    };
    loadManifest().then(function (list) {
      if (!list || voice !== want) { run.running = false; return; }
      var ids = Object.keys(list);
      run.total = ids.length;
      var next = 0;
      var worker = function () {
        if (voice !== want || next >= ids.length) return Promise.resolve();
        var url = 'voice/' + want + '/' + ids[next++] + '.mp3';
        return fetchCached(url).then(function (response) { if (response) run.done += 1; if (run.done % 25 === 0 || run.done === run.total) tell(); }).then(worker);
      };
      Promise.all([worker(), worker(), worker(), worker(), worker(), worker()]).then(function () {
        run.running = false;
        if (voice !== want) return;
        // 못 받은 조각이 있으면 다 받았다고 하지 않는다 — 다음에 다시 열면 빠진 것만 받는다(나머지는 캐시)
        if (run.done < run.total) { tell(); return; }
        try { localStorage.setItem('coachVoiceReady', want); } catch (err) { void err; }
        tell();
        run.listeners = [];
      });
    });
  }

  /** 이 목소리를 다 받아 두었는가 (이 폰에) */
  function ready(name) {
    try { return localStorage.getItem('coachVoiceReady') === (name || voice); } catch (err) { return false; }
  }

  /*
   * 화면이 꺼져도 이어지는 코치 소리 — 앞으로 할 말들을 한 소리 파일(WAV)로 미리 만든다.
   *
   * 폰을 잠그면 페이지의 타이머가 멈춰서 말을 그때그때 예약할 수 없다. 그런데 이미 틀어 둔
   * 소리 파일은 잠금 화면에서도 끝까지 나온다(휴식 끝 소리와 같은 길). 그래서 "쉬는 시간 무음 →
   * 다음 세트 말 → 하나 둘 셋 … → 세트 뒤 말 → 쉬는 시간 …"을 시간대로 한 줄에 깔아 둔다.
   *
   * events: [{ at: 초, text } | { at: 초, chime: true }]. 앞 말이 아직 안 끝났으면 그 뒤로 민다.
   * 16kHz · 16비트 · 모노 — 목소리에는 충분하고, 8분이면 15MB쯤이다.
   */
  var TRACK_RATE = 16000;

  function renderTrack(events, seconds) {
    var E = window.FitEngine;
    return loadManifest().then(function (list) {
      if (!list || !E) return null;
      var plans = events.map(function (event) {
        if (!event.text) return { event: event, ids: [] };
        var plan = E.speechSentences(event.text, function (sentence) { return Boolean(list[E.clipId(sentence)]); });
        return {
          event: event,
          ids: plan.map(function (sentence) {
            return sentence.map(function (piece) { return E.clipId(piece); }).filter(function (id) { return list[id]; });
          }),
        };
      });
      var wanted = {};
      plans.forEach(function (plan) { plan.ids.forEach(function (sentence) { sentence.forEach(function (id) { wanted[id] = true; }); }); });
      var ids = Object.keys(wanted);
      return Promise.all(ids.map(bufferAtRate)).then(function (loaded) {
        var byId = {};
        ids.forEach(function (id, i) { byId[id] = loaded[i]; });
        var total = Math.max(1, Math.ceil(seconds * TRACK_RATE));
        var bytes = new ArrayBuffer(44 + total * 2);
        var pcm = new Int16Array(bytes, 44, total);
        var free = 0;
        plans.forEach(function (plan) {
          var at = Math.max(plan.event.at, free);
          if (plan.event.chime) { addChime(pcm, at); free = at + 0.7; return; }
          plan.ids.forEach(function (sentence, si) {
            sentence.forEach(function (id, pi) {
              var buffer = byId[id];
              if (!buffer) return;
              addBuffer(pcm, buffer, at);
              at += buffer.duration + (pi < sentence.length - 1 ? PIECE_GAP : 0);
            });
            if (si < plan.ids.length - 1) at += SENTENCE_GAP;
          });
          free = at + 0.12;
        });
        writeWavHeader(new DataView(bytes), total);
        return bytes;
      });
    });
  }

  function addBuffer(pcm, buffer, at) {
    var data = buffer.getChannelData(0);
    var ratio = buffer.sampleRate / TRACK_RATE;
    var start = Math.round(at * TRACK_RATE);
    var length = Math.floor(data.length / ratio);
    for (var i = 0; i < length && start + i < pcm.length; i += 1) {
      if (start + i < 0) continue;
      var src = i * ratio;
      var k = Math.floor(src);
      var frac = src - k;
      var value = data[k] * (1 - frac) + (data[k + 1] || 0) * frac;
      pcm[start + i] = clamp16(pcm[start + i] + value * 32767);
    }
  }

  /** 띵-띵 — 쉬는 시간이 끝나는 자리. 휴식 끝 소리와 같은 높이. */
  function addChime(pcm, at) {
    [[0, 880], [0.28, 1175]].forEach(function (tone) {
      var start = Math.round((at + tone[0]) * TRACK_RATE);
      var length = Math.round(0.22 * TRACK_RATE);
      for (var i = 0; i < length && start + i < pcm.length; i += 1) {
        var fade = Math.min(1, i / 160, (length - i) / 800);
        pcm[start + i] = clamp16(pcm[start + i] + Math.sin((2 * Math.PI * tone[1] * i) / TRACK_RATE) * 0.35 * fade * 32767);
      }
    });
  }

  function clamp16(value) {
    return value > 32767 ? 32767 : value < -32768 ? -32768 : value;
  }

  function writeWavHeader(view, samples) {
    var text = function (at, word) { for (var i = 0; i < word.length; i += 1) view.setUint8(at + i, word.charCodeAt(i)); };
    text(0, 'RIFF'); view.setUint32(4, 36 + samples * 2, true); text(8, 'WAVE');
    text(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
    view.setUint32(24, TRACK_RATE, true); view.setUint32(28, TRACK_RATE * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
    text(36, 'data'); view.setUint32(40, samples * 2, true);
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
    renderTrack: renderTrack,
    setRate: setRate,
    available: function () { return Boolean(window.AudioContext || window.webkitAudioContext); },
    /** 지금 무언가 나오고 있는가 */
    speaking: function () { var c = audio(); return Boolean(c && queueEnd > c.currentTime); },
  };
})();
