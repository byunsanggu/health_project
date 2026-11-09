/*
 * 화면이 꺼져도 울리는 휴식 끝 소리 — 브라우저 쪽.
 *
 * 휴식이 시작될 때 "휴식 길이만큼 무음 + 끝에 알림음" 소리 파일(엔진의
 * restAlarmWav)을 만들어 틀어 둔다. 이미 재생 중인 소리는 폰을 잠가도 끝까지
 * 나온다 — 음악 앱이 그렇게 돈다. 그래서 잠금 화면에서도 휴식 끝에 울린다.
 *
 * 대가가 하나 있다. 이 소리(<audio>)를 트는 동안 폰은 이 앱을 "음악 트는 앱"으로 보고, 듣던 음악 앱
 * (스포티파이 · 유튜브 뮤직)을 멈춘다. 그래서 **화면이 켜져 있는 동안에는 틀지 않는다** — PT는 화면을
 * 켜 두고, 휴식 끝은 화면에서 보이고 코치가 말한다(코치 목소리는 Web Audio라 음악을 멈추지 않는다).
 * 앱이 화면이 꺼질 때만 start · playTrack을 부르고, 돌아오면 stop한다. 설정에서 끌 수도 있다.
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

  /** seconds 뒤에 울린다. 잠금 화면에는 무엇을 쉬는 중인지 띄운다. */
  function start(seconds, label) {
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
    if (!audio) return;
    audio.pause();
    audio.removeAttribute('src');
    try { audio.load(); } catch (err) { void err; }
    release();
    session('transient');
  }

  /** 지금 틀고 있는(또는 틀어 둔) 휴식 소리가 있는가 */
  function active() {
    return Boolean(audio && url && !audio.muted && !audio.ended);
  }

  /**
   * 화면이 꺼질 때 코치 소리 한 줄(coachVoice renderTrack)을 튼다. anchor는 그 소리의 0초가
   * 가리키는 시각(ms) — 만든 뒤 지난 만큼 건너뛰고 튼다.
   */
  function playTrack(bytes, anchor, label) {
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
    if (!audio || !url) return null;
    return { time: audio.currentTime, paused: audio.paused, ended: audio.ended };
  }

  return { wake: wake, start: start, stop: stop, playTrack: playTrack, position: position, chime: chime, active: active };
})();
