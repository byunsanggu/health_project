/**
 * 직접 찍은 시연 영상.
 *
 * 구조를 이렇게 잡은 이유가 있다.
 *
 *   1. 83개를 다 찍고 나서 켜는 게 아니라, 한 개 찍으면 한 개가 바로
 *      나온다. 목록에 id를 적는 순간 그 종목만 영상으로 바뀐다.
 *   2. 없는 종목은 지금의 동작 애니메이션이 그대로 나온다. 빈 칸이
 *      생기지 않으므로 "촬영이 끝날 때까지 출시를 미룬다"가 없다.
 *   3. 404를 찔러 보지 않는다. 있는지 없는지는 이 표가 정한다 —
 *      네트워크가 느린 헬스장에서 영상 없는 종목마다 실패 요청을
 *      날리면 시연이 늦게 뜬다.
 *
 * 파일 이름 규칙:
 *   demo/<종목id>.mp4          정상 수행
 *   demo/<종목id>--mistake.mp4 흔한 실수 (있으면 전환 버튼이 생긴다)
 *
 * 촬영 규격과 순서는 docs/촬영가이드.md, docs/촬영목록.md에 있다.
 */
(function () {
  'use strict';

  var BASE = 'demo/';

  /*
   * 찍은 종목의 id를 여기에 적는다. 실수 컷도 같이 찍었으면 mistake: true.
   *
   * 예시:
   *   { id: 'back-squat', mistake: true },
   *   { id: 'barbell-bench-press', mistake: false },
   */
  var CLIPS = [];

  var INDEX = {};
  CLIPS.forEach(function (clip) { INDEX[clip.id] = clip; });

  window.FitDemoClips = {
    /** 이 종목에 찍어 둔 영상이 있는가. */
    has: function (id) { return Object.prototype.hasOwnProperty.call(INDEX, id); },

    /** 실수 컷도 있는가. 없으면 전환 버튼을 만들지 않는다. */
    hasMistake: function (id) { return Boolean(INDEX[id] && INDEX[id].mistake); },

    /** 정상 컷 주소. */
    src: function (id) { return INDEX[id] ? BASE + id + '.mp4' : null; },

    /** 실수 컷 주소. */
    mistakeSrc: function (id) {
      return INDEX[id] && INDEX[id].mistake ? BASE + id + '--mistake.mp4' : null;
    },

    /** 몇 개나 찍었는가 — 진척을 화면에 보여주는 데 쓴다. */
    count: function () { return CLIPS.length; },

    list: function () { return CLIPS.map(function (clip) { return clip.id; }); },
  };
})();
