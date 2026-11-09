/*
 * 화면이 꺼져도 울리는 휴식 끝 소리 — 브라우저 쪽.
 *
 * 휴식이 시작될 때 "휴식 길이만큼 무음 + 끝에 알림음" 소리 파일(엔진의
 * restAlarmWav)을 만들어 틀어 둔다. 이미 재생 중인 소리는 폰을 잠가도 끝까지
 * 나온다 — 음악 앱이 그렇게 돈다. 그래서 잠금 화면에서도 휴식 끝에 울린다.
 *
 * 화면이 켜져 있는 동안에는 아무것도 틀지 않는다(코치 목소리는 Web Audio라 음악을 멈추지 않는다). 앱이
 * 화면이 꺼질 때 start · playTrack을 부르고, 돌아오면 stop한다. 화면이 꺼진 동안의 소리도 할 수 있으면
 * Web Audio로 깐다 — 주머니에 폰을 넣고 음악을 들으며 운동해도 음악이 멈추지 않고 코치 소리가 섞여 나온다.
 * 아이폰은 화면을 잠그면 Web Audio가 멈춰서 그때만 <audio>로 튼다(그러면 음악이 멈출 수 있다).
 *
 * 화면이 켜진 채 휴식이 끝나면 chime() — Web Audio로 짧게 띵. 음악을 멈추지 않는다.
 *
 * 브라우저는 손으로 누른 순간에만 소리를 틀게 한다. 화면이 꺼질 때 틀 수 있게 첫 터치 때 같은 재생기를
 * 소리 없이(muted) 한 번 틀어 깨워 둔다 — 소리가 없으면 듣던 음악도 멈추지 않는다.
 */
var RestSound = (function () {
  'use strict';

  var audio = null;
  var url = null;
  var woke = false;
  var ctx = null;

  /*
   * 이 페이지 소리의 성격(사파리 16.4+ · iOS 17의 navigator.audioSession). 평소에는 'transient' — 코치
   * 목소리가 나오는 동안 음악을 잠깐 작게 할 뿐 멈추지 않는다. 화면이 꺼진 뒤 휴식 끝 소리를 틀 때만
   * 'auto'(예전 그대로)로 돌린다. 없는 브라우저에서는 조용히 넘어간다.
   */
  function session(type) {
    try { if (navigator.audioSession) navigator.audioSession.type = type; } catch (err) { void err; }
  }
  session('transient');

  function player() {
    if (!audio) {
      audio = new Audio();
      audio.preload = 'auto';
      audio.setAttribute('playsinline', '');
      audio.addEventListener('ended', release);
    }
    return audio;
  }

  function release() {
    if (url) {
      URL.revokeObjectURL(url);
      url = null;
    }
    if ('mediaSession' in navigator) {
      try { navigator.mediaSession.metadata = null; } catch (err) { void err; }
    }
  }

  function load(bytes) {
    var el = player();
    el.muted = false;
    session('auto');
    release();
    url = URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' }));
    el.src = url;
    var played = el.play();
    if (played && played.catch) played.catch(function () { /* 막혔다 — 알림과 진동이 남는다 */ });
  }

  /** 손으로 누른 순간에 한 번 — 재생기를 깨워 둔다. */
  function wake() {
    if (woke || !window.FitEngine) return;
    woke = true;
    var el = player();
    el.muted = true;
    release();
    url = URL.createObjectURL(new Blob([window.FitEngine.restAlarmWav(0.05, false)], { type: 'audio/wav' }));
    el.src = url;
    var played = el.play();
    if (played && played.catch) played.catch(function () { /* 막혔다 — 다음 터치에 */ woke = false; });
    // 화면이 켜진 채 끝나는 휴식의 띵 — Web Audio도 터치 순간에 깨워 둔다
    var Ctor = window.AudioContext || window.webkitAudioContext;
    if (!ctx && Ctor) { try { ctx = new Ctor(); } catch (err) { ctx = null; } }
    if (ctx && ctx.state === 'suspended') ctx.resume().catch(function () {});
  }

  /** 화면이 켜진 채 휴식이 끝났을 때 — Web Audio로 띵-띵. 듣던 음악을 멈추지 않는다. */
  function chime() {
    if (!ctx) return;
    try {
      var now = ctx.currentTime + 0.02;
      [[0, 880], [0.28, 1175]].forEach(function (tone) {
        var osc = ctx.createOscillator();
        var gain = ctx.createGain();
        osc.frequency.value = tone[1];
        gain.gain.setValueAtTime(0, now + tone[0]);
        gain.gain.linearRampToValueAtTime(0.3, now + tone[0] + 0.01);
        gain.gain.linearRampToValueAtTime(0, now + tone[0] + 0.22);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + tone[0]);
        osc.stop(now + tone[0] + 0.25);
      });
    } catch (err) { void err; }
  }

  /** (<audio> 대신 길) seconds 뒤에 울린다. 잠금 화면에는 무엇을 쉬는 중인지 띄운다. */
  function audioStart(seconds, label) {
    if (!window.FitEngine) return;
    load(window.FitEngine.restAlarmWav(seconds));
    if ('mediaSession' in navigator && window.MediaMetadata) {
      try {
        navigator.mediaSession.metadata = new MediaMetadata({ title: '휴식 중', artist: label || '볼륨 코치', album: '볼륨 코치' });
      } catch (err) { void err; }
    }
  }

  /** 휴식을 건너뛰거나 지웠을 때 — 울리지 않게 멈춘다. */
  function stop() {
    stopWeb();
    if (!audio) return;
    audio.pause();
    audio.removeAttribute('src');
    try { audio.load(); } catch (err) { void err; }
    release();
    session('transient');
  }

  /** 지금 틀고 있는(또는 틀어 둔) 휴식 소리가 있는가 */
  function active() {
    return Boolean(bg) || Boolean(audio && url && !audio.muted && !audio.ended);
  }

  /**
   * 화면이 꺼질 때 코치 소리 한 줄(coachVoice renderTrack)을 튼다. anchor는 그 소리의 0초가
   * 가리키는 시각(ms) — 만든 뒤 지난 만큼 건너뛰고 튼다.
   */
  function audioTrack(bytes, anchor, label) {
    var el = player();
    el.muted = false;
    session('auto');
    release();
    url = URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' }));
    el.src = url;
    var seek = function () {
      el.removeEventListener('loadedmetadata', seek);
      try { el.currentTime = Math.max(0, (Date.now() - anchor) / 1000); } catch (err) { void err; }
    };
    el.addEventListener('loadedmetadata', seek);
    var played = el.play();
    if (played && played.catch) played.catch(function () { /* 막혔다 — 돌아오면 멈춘 자리부터 */ });
    if ('mediaSession' in navigator && window.MediaMetadata) {
      try {
        navigator.mediaSession.metadata = new MediaMetadata({ title: 'PT 진행 중', artist: label || '볼륨 코치', album: '볼륨 코치' });
      } catch (err) { void err; }
    }
  }

  /** 지금 틀고 있는 소리의 자리 — 시계 · 잠금 화면에서 일시정지했으면 멈춘 자리. 없으면 null. */
  function position() {
    // Web Audio로 틀었으면 소리 시계로 — 페이지 타이머는 화면 밖에서 늦게 돌지만 이 시계는 정확하다
    if (bg) {
      var c = bg.ctx;
      var time = Math.max(0, c.currentTime - bg.zero);
      return { time: time, paused: c.state !== 'running', ended: time >= bg.length };
    }
    if (!audio || !url) return null;
    return { time: audio.currentTime, paused: audio.paused, ended: audio.ended };
  }

  /* ── 화면이 꺼진 동안 Web Audio로 ─────────────────────────────
   *
   * <audio>는 폰에게 "이 앱이 음악을 튼다"고 알려서 듣던 음악 앱을 멈춘다. Web Audio는 그러지 않는다
   * (안드로이드 크롬은 Web Audio에 오디오 포커스를 잡지 않는다) — 코치 목소리 · 휴식 끝 소리가 음악 위에
   * 섞여 나온다. 화면 밖에서는 페이지 타이머가 느려지므로 전부 소리 시계(AudioContext 시각)로 미리 깔아 둔다.
   *
   * 무음 구간은 아주 작은 소리(30Hz, 약 −60dBFS)로 채운다. 완전한 0이 이어지면 크롬은 그 탭을 "소리 안
   * 나는 탭"으로 보고 얼리거나(freeze) 버릴 수 있다 — 그러면 다음 말이 안 나온다. 30Hz · −60dBFS는
   * 폰 스피커가 내지 못하는 낮은 소리라 들리지 않고, 크롬이 소리 나는 탭으로 보는 문턱(약 −72dBFS)보다는 크다.
   *
   * 아이폰(사파리)은 화면을 잠그면 AudioContext가 멈춘다 — 그때만 예전 <audio> 길로 간다(음악이 멈출 수
   * 있다. 그래서 PT 화면의 "주머니 모드"가 있다).
   */
  var bg = null;   // { ctx, nodes, zero(트랙 0초의 ctx 시각), length, fallback() }

  function isIOS() {
    var ua = navigator.userAgent || '';
    return /iP(hone|ad|od)/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  }

  /** 화면을 꺼도 음악과 코치 소리가 같이 나오는 폰인가 — 아이폰이 아니고 Web Audio가 있으면. */
  function backgroundMixes() {
    return !isIOS() && Boolean(window.AudioContext || window.webkitAudioContext);
  }

  function webCtx() {
    var c = window.CoachVoice && window.CoachVoice.context ? window.CoachVoice.context() : null;
    if (!c) {
      var Ctor = window.AudioContext || window.webkitAudioContext;
      if (!ctx && Ctor) { try { ctx = new Ctor(); } catch (err) { ctx = null; } }
      c = ctx;
    }
    return c;
  }

  /** Web Audio로 틀 수 있는가 — 아이폰이 아니고, 소리 문맥이 이미 깨어 있어야 한다(화면 밖에서는 깨울 수 없다). */
  function webReady() {
    if (isIOS()) return null;
    var c = webCtx();
    return c && c.state === 'running' ? c : null;
  }

  function stopWeb() {
    if (!bg) return;
    var old = bg;
    bg = null;
    old.nodes.forEach(function (node) {
      try { if (node.stop) node.stop(); } catch (err) { void err; }
      try { node.disconnect(); } catch (err) { void err; }
    });
  }

  /** from부터 seconds 동안 들리지 않는 아주 작은 소리 — 탭이 얼지 않게. */
  function keepAlive(c, from, seconds, nodes) {
    var osc = c.createOscillator();
    var gain = c.createGain();
    osc.frequency.value = 30;
    gain.gain.value = 0.0014;
    osc.connect(gain);
    gain.connect(c.destination);
    osc.start(from);
    osc.stop(from + Math.max(0.1, seconds));
    nodes.push(osc, gain);
  }

  function chimeAt(c, at, nodes) {
    [[0, 880], [0.28, 1175]].forEach(function (tone) {
      var osc = c.createOscillator();
      var gain = c.createGain();
      osc.frequency.value = tone[1];
      gain.gain.setValueAtTime(0, at + tone[0]);
      gain.gain.linearRampToValueAtTime(0.35, at + tone[0] + 0.01);
      gain.gain.linearRampToValueAtTime(0, at + tone[0] + 0.22);
      osc.connect(gain);
      gain.connect(c.destination);
      osc.start(at + tone[0]);
      osc.stop(at + tone[0] + 0.25);
      nodes.push(osc, gain);
    });
  }

  /** 아이폰처럼 화면을 잠그자 소리 문맥이 멈췄으면 그 자리부터 <audio> 길로 넘긴다. */
  function watch(c) {
    if (c.__restWatch) return;
    c.__restWatch = true;
    c.addEventListener('statechange', function () {
      if (!bg || bg.ctx !== c || c.state === 'running' || document.visibilityState !== 'hidden') return;
      var fallback = bg.fallback;
      var at = Math.max(0, c.currentTime - bg.zero);
      stopWeb();
      fallback(at);
    });
  }

  /** 우리가 만든 WAV(16비트 · 모노 · 44바이트 머리)를 바로 소리 버퍼로 — 화면이 꺼지는 순간에 기다릴 틈이 없다. */
  function wavBuffer(c, bytes) {
    var view = new DataView(bytes);
    var rate = view.getUint32(24, true);
    var samples = Math.floor(view.getUint32(40, true) / 2);
    var pcm = new Int16Array(bytes, 44, samples);
    var buffer = c.createBuffer(1, Math.max(1, samples), rate);
    var data = buffer.getChannelData(0);
    for (var i = 0; i < samples; i += 1) data[i] = pcm[i] / 32768;
    return buffer;
  }

  /** seconds 뒤에 울린다 — 화면이 꺼질 때 앱이 부른다. 할 수 있으면 Web Audio로(음악이 멈추지 않는다). */
  function start(seconds, label) {
    var c = webReady();
    if (!c) { audioStart(seconds, label); return; }
    stopWeb();
    session('transient');
    var nodes = [];
    var t0 = c.currentTime + 0.05;
    keepAlive(c, t0, seconds + 1.5, nodes);
    chimeAt(c, t0 + seconds, nodes);
    bg = {
      ctx: c, nodes: nodes, zero: t0, length: seconds + 1.5,
      fallback: function (at) { audioStart(Math.max(0, seconds - at), label); },
    };
    watch(c);
  }

  /**
   * 화면이 꺼질 때 코치 소리 한 줄(coachVoice renderTrack)을 튼다. anchor는 그 소리의 0초가 가리키는
   * 시각(ms) — 만든 뒤 지난 만큼 건너뛰고 튼다. 할 수 있으면 Web Audio로(음악과 같이 나온다).
   */
  function playTrack(bytes, anchor, label) {
    var c = webReady();
    if (!c) { audioTrack(bytes, anchor, label); return; }
    stopWeb();
    session('transient');
    var buffer;
    try { buffer = wavBuffer(c, bytes); } catch (err) { audioTrack(bytes, anchor, label); return; }
    var offset = Math.min(buffer.duration, Math.max(0, (Date.now() - anchor) / 1000));
    var nodes = [];
    var t0 = c.currentTime + 0.05;
    var source = c.createBufferSource();
    source.buffer = buffer;
    source.connect(c.destination);
    source.start(t0, offset);
    nodes.push(source);
    keepAlive(c, t0, buffer.duration - offset, nodes);
    bg = {
      ctx: c, nodes: nodes, zero: t0 - offset, length: buffer.duration,
      fallback: function () { audioTrack(bytes, anchor, label); },
    };
    watch(c);
  }

  /** 지금 화면 밖 소리를 어떻게 틀고 있는가 — 시험이 본다. */
  function backgroundState() {
    if (bg) return { mode: 'webaudio', sources: bg.nodes.length, seconds: Math.round((bg.length - Math.max(0, bg.ctx.currentTime - bg.zero)) * 10) / 10 };
    if (audio && url && !audio.muted && !audio.ended) return { mode: 'audio' };
    return null;
  }

  return {
    wake: wake, start: start, stop: stop, playTrack: playTrack, position: position, chime: chime, active: active,
    backgroundMixes: backgroundMixes, backgroundState: backgroundState,
  };
})();
