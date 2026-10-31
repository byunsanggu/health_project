/*
 * 화면이 꺼져도 울리는 휴식 끝 소리 — 브라우저 쪽.
 *
 * 휴식이 시작될 때 "휴식 길이만큼 무음 + 끝에 알림음" 소리 파일(엔진의
 * restAlarmWav)을 만들어 틀어 둔다. 이미 재생 중인 소리는 폰을 잠가도 끝까지
 * 나온다 — 음악 앱이 그렇게 돈다. 그래서 잠금 화면에서도 휴식 끝에 울린다.
 *
 * 대가가 하나 있다. 소리를 트는 동안 다른 음악 앱이 잠깐 멈추거나 작아질 수
 * 있다. 그래서 설정에서 끌 수 있게 둔다.
 *
 * 브라우저는 손으로 누른 순간에만 소리를 틀게 한다. PT처럼 저절로 시작하는
 * 휴식도 울리게, 첫 터치 때 같은 재생기로 아주 짧은 무음을 한 번 틀어 둔다.
 */
var RestSound = (function () {
  'use strict';

  var audio = null;
  var url = null;
  var woke = false;

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
    load(window.FitEngine.restAlarmWav(0.05, false));
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
  }

  /**
   * 화면이 꺼질 때 코치 소리 한 줄(coachVoice renderTrack)을 튼다. anchor는 그 소리의 0초가
   * 가리키는 시각(ms) — 만든 뒤 지난 만큼 건너뛰고 튼다.
   */
  function playTrack(bytes, anchor, label) {
    var el = player();
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

  return { wake: wake, start: start, stop: stop, playTrack: playTrack };
})();
