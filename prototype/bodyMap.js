/**
 * 근육 지도.
 *
 * 경쟁 앱들이 쓰는 "근육에 색이 칠해진 인체 렌더"와 같은 일을 하되,
 * 두 가지가 다르다.
 *
 *   1. 그림을 직접 그린다. 남의 렌더를 베끼거나 따라 그리지 않는다.
 *      해부학 자체는 저작물이 아니지만 특정 일러스트는 저작물이다.
 *   2. 종목마다 고정된 그림 한 장이 아니라, 엔진의 기여도(contribution)를
 *      그대로 농도로 칠한다. 데드리프트에서 둔근 1.0과 대퇴사두 0.3이
 *      같은 색으로 보이면 안 된다 — 그건 사실과 다르다.
 *
 * 그래서 이 파일에는 "종목별 그림"이 없다. 몸 하나와 근육 칸 14개가 있고,
 * 색은 계산해서 넣는다. 종목이 83개든 830개든 그림은 한 장이다.
 *
 * 정면에 7개, 후면에 7개. 한 근육은 한쪽에만 나온다 — 양쪽에 칠하면
 * "두 군데가 켜졌다"로 잘못 읽힌다.
 */
(function () {
  'use strict';

  /* 정면·후면을 한 좌표계에 나란히 둔다. 정면 중심 x=30, 후면 중심 x=90. */
  var SILHOUETTE =
    // ── 정면 ──
    '<circle cx="30" cy="12" r="6.2"/>' +
    '<path d="M22 20 h16 l5 2 -2 12 -3 6 v12 h-16 v-12 l-3 -6 -2 -12 Z"/>' +
    '<path d="M17 23 14 32 13 44 14 54 18 54 19 44 20 32 Z"/>' +
    '<path d="M43 23 46 32 47 44 46 54 42 54 41 44 40 32 Z"/>' +
    '<path d="M22 52 21 70 22 84 22 95 28 95 29 84 29 70 29 52 Z"/>' +
    '<path d="M31 52 31 70 31 84 32 95 38 95 38 84 39 70 38 52 Z"/>' +
    // ── 후면 ──
    '<circle cx="90" cy="12" r="6.2"/>' +
    '<path d="M82 20 h16 l5 2 -2 12 -3 6 v14 h-16 v-14 l-3 -6 -2 -12 Z"/>' +
    '<path d="M77 23 74 32 73 44 74 54 78 54 79 44 80 32 Z"/>' +
    '<path d="M103 23 106 32 107 44 106 54 102 54 101 44 100 32 Z"/>' +
    '<path d="M82 54 81 70 82 84 82 95 88 95 89 84 89 70 89 54 Z"/>' +
    '<path d="M91 54 91 70 91 84 92 95 98 95 98 84 99 70 98 54 Z"/>';

  /*
   * 근육 한 칸. 좌우 대칭이라 보통 두 개씩이다.
   * side는 어느 그림에 그리는지 — 범례에서 "뒤에서 보세요"를 띄우는 데 쓴다.
   */
  var MUSCLES = {
    chest:      { side: 'front', d: '<ellipse cx="26.2" cy="31.8" rx="4.0" ry="4.0"/><ellipse cx="33.8" cy="31.8" rx="4.0" ry="4.0"/>' },
    frontDelt:  { side: 'front', d: '<ellipse cx="20" cy="24.2" rx="3.2" ry="3.2"/><ellipse cx="40" cy="24.2" rx="3.2" ry="3.2"/>' },
    sideDelt:   { side: 'front', d: '<ellipse cx="16.5" cy="26.5" rx="2.8" ry="3.6"/><ellipse cx="43.5" cy="26.5" rx="2.8" ry="3.6"/>' },
    biceps:     { side: 'front', d: '<ellipse cx="15" cy="37" rx="2.8" ry="5"/><ellipse cx="45" cy="37" rx="2.8" ry="5"/>' },
    forearms:   { side: 'front', d: '<ellipse cx="13.6" cy="48" rx="2.4" ry="5"/><ellipse cx="46.4" cy="48" rx="2.4" ry="5"/>' },
    abs:        { side: 'front', d: '<rect x="26.5" y="37" width="7" height="13" rx="3"/>' },
    quads:      { side: 'front', d: '<ellipse cx="25.5" cy="64" rx="4" ry="9"/><ellipse cx="34.5" cy="64" rx="4" ry="9"/>' },

    traps:      { side: 'back',  d: '<path d="M84 21 90 19 96 21 93 32 87 32 Z"/>' },
    back:       { side: 'back',  d: '<path d="M81.6 30 89 30 89 47 83 40 Z"/><path d="M98.4 30 91 30 91 47 97 40 Z"/>' },
    rearDelt:   { side: 'back',  d: '<ellipse cx="79" cy="25.5" rx="3.2" ry="3.4"/><ellipse cx="101" cy="25.5" rx="3.2" ry="3.4"/>' },
    triceps:    { side: 'back',  d: '<ellipse cx="75" cy="37" rx="2.8" ry="5"/><ellipse cx="105" cy="37" rx="2.8" ry="5"/>' },
    glutes:     { side: 'back',  d: '<ellipse cx="85.5" cy="54" rx="4.8" ry="5"/><ellipse cx="94.5" cy="54" rx="4.8" ry="5"/>' },
    hamstrings: { side: 'back',  d: '<ellipse cx="85.5" cy="68" rx="4" ry="8"/><ellipse cx="94.5" cy="68" rx="4" ry="8"/>' },
    calves:     { side: 'back',  d: '<ellipse cx="85.5" cy="83" rx="3.2" ry="6"/><ellipse cx="94.5" cy="83" rx="3.2" ry="6"/>' },
  };

  var NS = 'http://www.w3.org/2000/svg';

  /*
   * 기여도를 불투명도로.
   *
   * 그대로 쓰면 0.3짜리가 거의 안 보인다. 하한을 둬서 "쓰이긴 한다"가
   * 보이게 하되, 주동근과 확실히 벌어지게 남겨 둔다.
   */
  function opacityFor(weight) {
    if (!(weight > 0)) return 0;
    return 0.22 + 0.78 * Math.min(1, weight);
  }

  function node(tag, attrs, html) {
    var element = document.createElementNS(NS, tag);
    for (var key in attrs) element.setAttribute(key, attrs[key]);
    if (html != null) element.innerHTML = html;
    return element;
  }

  window.FitBodyMap = {
    /** 이 그림이 아는 근육인가. 엔진에 근육이 추가되면 테스트가 잡는다. */
    has: function (muscle) { return Object.prototype.hasOwnProperty.call(MUSCLES, muscle); },

    /** 정면에 그리는가, 후면에 그리는가. */
    sideOf: function (muscle) { return MUSCLES[muscle] ? MUSCLES[muscle].side : null; },

    muscles: function () { return Object.keys(MUSCLES); },

    /**
     * 기여도 표를 받아 칠한 몸 그림 하나를 돌려준다.
     *
     * contribution은 { glutes: 1, hamstrings: 0.9, ... } 형태 —
     * 엔진의 Exercise.contribution을 그대로 넣으면 된다.
     */
    render: function (contribution, label) {
      var svg = node('svg', {
        viewBox: '0 0 120 100',
        class: 'body-map',
        role: 'img',
        'aria-label': label || '사용하는 근육',
      });

      // 몸은 아주 흐리게 깔고, 근육만 위에 얹는다.
      svg.appendChild(node('g', {
        class: 'body-silhouette',
        fill: 'currentColor',
        'fill-opacity': '0.10',
        stroke: 'currentColor',
        'stroke-opacity': '0.28',
        'stroke-width': '0.7',
      }, SILHOUETTE));

      var worked = node('g', { class: 'body-muscles', fill: 'currentColor', stroke: 'none' });
      for (var muscle in MUSCLES) {
        var weight = (contribution && contribution[muscle]) || 0;
        if (weight <= 0) continue;
        worked.appendChild(node('g', {
          'data-muscle': muscle,
          'fill-opacity': opacityFor(weight).toFixed(2),
        }, MUSCLES[muscle].d));
      }
      svg.appendChild(worked);

      // 정면/후면 표시 — 없으면 왜 두 개인지 알 수 없다.
      svg.appendChild(node('g', {
        class: 'body-side-label',
        fill: 'currentColor',
        'fill-opacity': '0.55',
        'font-size': '6',
        'text-anchor': 'middle',
      },
        '<text x="30" y="99">앞</text><text x="90" y="99">뒤</text>'));

      return svg;
    },
  };
})();
