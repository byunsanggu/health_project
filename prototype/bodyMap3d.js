/**
 * 3D 근육 그림.
 *
 * bodyMap.js(평면 그림)와 같은 일을 입체로 한다. 몸은 tools/body3d/body.html에서 직접
 * 빚어 미리 그려 둔 장(層)이다 — 외부 3D 모델 · 남의 그림을 쓰지 않는다. 폰에서는 3D를
 * 돌리지 않고, 미리 그린 빛 장에 근육 칸 장을 보고 색만 칠한다. 그래서 종목이 83개든
 * 830개든 그림은 구도마다 한 장이고, 다크 모드 색도 여기서 바꾼다.
 *
 * 장 한 장의 위 절반은 빛(R = √(곱할 빛/1.4) · G = 더할 빛/0.5 · B = 덮인 정도),
 * 아래 절반은 표면에 가장 가까운 근육 둘(번호 × 16 + 가까운 정도 0~15, 15번은 근육 없음)이다.
 *
 * 장은 빌드가 window.__BODY3D__에 data: 주소로 싣는다. 장을 다 읽기 전이나 싣지 못한
 * 판에서는 ready()가 false — 부르는 쪽이 평면 그림을 대신 쓴다.
 */
(function () {
  'use strict';

  var SOURCES = window.__BODY3D__ || null;

  /* 엔진 MUSCLE_GROUPS 순서 + 14번 허리(척추기립근). 그림이 엔진의 '등'을 둘로 나눠 칠한다 */
  var ORDER = ['chest', 'back', 'frontDelt', 'sideDelt', 'rearDelt', 'traps', 'biceps', 'triceps',
    'forearms', 'quads', 'hamstrings', 'glutes', 'calves', 'abs'];
  var LOW_BACK = 14;
  var FRONT = { chest: 1, frontDelt: 1, sideDelt: 1, biceps: 1, forearms: 1, quads: 1, abs: 1 };
  var LOWER = { quads: 1, hamstrings: 1, glutes: 1, calves: 1 };

  var layers = {};
  var status = SOURCES ? 'idle' : 'none';
  var waiters = [];
  var cache = {};

  function load() {
    if (status !== 'idle') return;
    status = 'loading';
    var names = Object.keys(SOURCES);
    var left = names.length;
    names.forEach(function (name) {
      var img = new Image();
      img.onload = function () {
        try {
          var w = img.naturalWidth, h = img.naturalHeight / 2;
          var canvas = document.createElement('canvas');
          canvas.width = w; canvas.height = h * 2;
          var ctx = canvas.getContext('2d', { willReadFrequently: true });
          ctx.drawImage(img, 0, 0);
          var all = ctx.getImageData(0, 0, w, h * 2).data;
          layers[name] = { w: w, h: h, light: all.subarray(0, w * h * 4), muscle: all.subarray(w * h * 4) };
        } catch (err) { void err; }
        done();
      };
      img.onerror = done;
      img.src = SOURCES[name];
    });
    function done() {
      left -= 1;
      if (left > 0) return;
      status = Object.keys(layers).length === names.length ? 'ready' : 'failed';
      var queue = waiters; waiters = [];
      queue.forEach(function (fn) { try { fn(status === 'ready'); } catch (err) { void err; } });
    }
  }

  /* 화면 색 → 빛 계산용 선형 색 */
  var LINEAR = new Float32Array(256);
  for (var i = 0; i < 256; i += 1) LINEAR[i] = Math.pow(i / 255, 2.2);
  var SRGB = new Uint8ClampedArray(4096);
  for (var k = 0; k < 4096; k += 1) SRGB[k] = Math.round(Math.pow(k / 4095, 1 / 2.2) * 255);
  function toSrgb(x) { return SRGB[x <= 0 ? 0 : x >= 1 ? 4095 : (x * 4095) | 0]; }
  function linear(hex) {
    var h = String(hex).replace('#', '');
    return [LINEAR[parseInt(h.slice(0, 2), 16)], LINEAR[parseInt(h.slice(2, 4), 16)], LINEAR[parseInt(h.slice(4, 6), 16)]];
  }

  /**
   * 기여도 → 칸마다 칠할 세기(0~1). 하한을 둬서 0.3짜리도 "쓰이긴 한다"가 보이게 한다(평면 그림과 같다).
   * 엉덩이를 접는 종목(데드리프트 · 굿모닝)의 '등'은 허리다 — 광배근이 아니라 허리를 칠한다.
   */
  function weights(contribution, pattern) {
    var out = new Float32Array(16);
    ORDER.forEach(function (muscle, index) {
      var w = (contribution && contribution[muscle]) || 0;
      out[index] = w > 0 ? 0.25 + 0.75 * Math.min(1, w) : 0;
    });
    if (pattern === 'hinge') { out[LOW_BACK] = out[1]; out[1] = 0; }
    return out;
  }

  /** 앞에서 볼지 뒤에서 볼지, 위를 볼지 아래를 볼지 — 칠할 게 많은 쪽. */
  function framing(contribution, pattern) {
    var front = 0, back = 0, upper = 0, lower = 0;
    ORDER.forEach(function (muscle) {
      var w = (contribution && contribution[muscle]) || 0;
      if (FRONT[muscle]) front += w; else back += w;
      if (LOWER[muscle]) lower += w; else upper += w;
    });
    // 데드리프트의 '등'은 허리 — 아래쪽이다
    if (pattern === 'hinge' && contribution && contribution.back) { upper -= contribution.back; lower += contribution.back; }
    return { side: back > front ? 'back' : 'front', part: lower > upper ? 'lower' : 'upper' };
  }

  function paint(name, w, palette) {
    var layer = layers[name];
    if (!layer) return null;
    var key = name + '|' + Array.prototype.join.call(w, ',') + '|' + palette.clay + '|' + palette.accent;
    if (cache[key]) return cache[key];
    var clay = linear(palette.clay), accent = linear(palette.accent);
    var size = layer.w * layer.h;
    var data = new ImageData(layer.w, layer.h);
    var px = data.data, L = layer.light, M = layer.muscle;
    for (var p = 0; p < size; p += 1) {
      var o = p * 4;
      var cover = L[o + 2];
      if (!cover) continue;
      var g = L[o] / 255;
      var ld = g * g * 1.4;
      var add = (L[o + 1] / 255) * 0.5;
      var m1 = M[o], m2 = M[o + 1];
      var t = Math.max(((m1 & 15) / 15) * w[m1 >> 4], ((m2 & 15) / 15) * w[m2 >> 4]);
      px[o] = toSrgb((clay[0] + (accent[0] - clay[0]) * t) * ld + add * 0.93);
      px[o + 1] = toSrgb((clay[1] + (accent[1] - clay[1]) * t) * ld + add * 0.95);
      px[o + 2] = toSrgb((clay[2] + (accent[2] - clay[2]) * t) * ld + add);
      px[o + 3] = cover;
    }
    cache[key] = data;
    return data;
  }

  function canvasOf(data, label) {
    var canvas = document.createElement('canvas');
    canvas.width = data.width; canvas.height = data.height;
    canvas.getContext('2d').putImageData(data, 0, 0);
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', label || '사용하는 근육');
    return canvas;
  }

  window.FitBody3D = {
    /** 이 판에 3D 장이 실려 있는가 */
    available: function () { return status !== 'none'; },
    ready: function () { return status === 'ready'; },
    /** 장을 다 읽으면 부른다(이미 읽었으면 바로). 실패하면 false로 부른다 */
    whenReady: function (fn) {
      if (status === 'ready' || status === 'failed' || status === 'none') { fn(status === 'ready'); return; }
      waiters.push(fn);
      load();
    },
    /** 근육 칸 차례 — 엔진 MUSCLE_GROUPS와 같아야 한다(테스트가 지킨다) */
    muscles: function () { return ORDER.slice(); },
    weights: weights,
    framing: framing,
    /** 목록 썸네일 한 칸 — 상반신 또는 하반신, 앞 또는 뒤 */
    thumb: function (contribution, pattern, palette, label) {
      if (status !== 'ready') return null;
      var f = framing(contribution, pattern);
      var data = paint(f.part + '-' + f.side, weights(contribution, pattern), palette);
      return data ? canvasOf(data, label) : null;
    },
    /** 전신 한쪽 — side: 'front' | 'back' */
    figure: function (contribution, pattern, side, palette, label) {
      if (status !== 'ready') return null;
      var data = paint('full-' + side, weights(contribution, pattern), palette);
      return data ? canvasOf(data, label) : null;
    },
  };
})();
