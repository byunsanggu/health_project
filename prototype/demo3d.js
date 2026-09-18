/**
 * 절차적 3D 시연 렌더러.
 *
 * 실제 제품에서는 촬영 영상이나 구매한 3D 에셋이 들어갈 자리다. 여기서는
 * Three.js로 인체를 직접 만들고 엔진의 관절 키프레임으로 움직여, 그 자리에
 * 무엇이 들어가고 어떤 데이터가 필요한지를 보여준다.
 *
 * 외부 모델 파일을 받지 않는 이유는 아티팩트 CSP가 스크립트 외의 외부
 * 리소스를 막기 때문이기도 하고, 관절 각도만으로도 동작의 요점은 전달되기
 * 때문이기도 하다.
 */
(function () {
  'use strict';

  var E = window.FitEngine;
  var DEG = Math.PI / 180;

  function box(width, height, depth, color) {
    var mesh = new THREE.Mesh(
      new THREE.BoxGeometry(width, height, depth),
      new THREE.MeshLambertMaterial({ color: color })
    );
    mesh.castShadow = true;
    return mesh;
  }

  /** 관절에서 아래로 뻗는 마디. 회전축이 관절에 오도록 원점을 위쪽에 둔다. */
  function limb(length, thickness, color) {
    var pivot = new THREE.Group();
    var mesh = box(thickness, length, thickness, color);
    mesh.position.y = -length / 2;
    pivot.add(mesh);
    return pivot;
  }

  /**
   * 서 있는 자세는 발이 바닥에 닿아야 한다.
   *
   * 골반 높이를 고정해두면 무릎을 굽힐수록 발이 공중으로 떠오른다 — 스쿼트가
   * 앉은 자세로 보였던 이유다. 다리 기하에서 골반이 얼마나 내려가야 하는지를
   * 역산하면 키프레임마다 따로 적어줄 필요가 없다.
   */
  function groundedDrop(pose) {
    var hip = -(pose.hip || 0) * DEG;
    var knee = hip + (pose.knee || 0) * DEG;
    var reach = 0.45 * Math.cos(hip) + 0.45 * Math.cos(knee);
    return Math.min(0, reach - 0.9);
  }

  function buildFigure(colors) {
    var root = new THREE.Group();

    var pelvis = new THREE.Group();
    pelvis.position.y = 0.95;
    root.add(pelvis);

    // 상체 — spine 각도로 앞으로 숙인다
    var torso = new THREE.Group();
    pelvis.add(torso);
    var chest = box(0.36, 0.5, 0.2, colors.body);
    chest.position.y = 0.25;
    torso.add(chest);
    var head = box(0.2, 0.22, 0.2, colors.skin);
    head.position.y = 0.62;
    torso.add(head);

    // 팔 — 어깨에서 시작
    var arms = {};
    [-1, 1].forEach(function (side, i) {
      var shoulder = new THREE.Group();
      shoulder.position.set(side * 0.24, 0.44, 0);
      torso.add(shoulder);

      var upper = limb(0.3, 0.09, colors.body);
      shoulder.add(upper);
      var elbow = new THREE.Group();
      elbow.position.y = -0.3;
      upper.add(elbow);
      var fore = limb(0.28, 0.08, colors.skin);
      elbow.add(fore);

      arms[i === 0 ? 'left' : 'right'] = { shoulder: shoulder, elbow: elbow };
    });

    // 다리 — 골반에서 시작
    var legs = {};
    [-1, 1].forEach(function (side, i) {
      var hip = new THREE.Group();
      hip.position.set(side * 0.12, 0, 0);
      pelvis.add(hip);

      var thigh = limb(0.45, 0.12, colors.body);
      hip.add(thigh);
      var knee = new THREE.Group();
      knee.position.y = -0.45;
      thigh.add(knee);
      var shin = limb(0.45, 0.1, colors.body);
      knee.add(shin);
      var ankle = new THREE.Group();
      ankle.position.y = -0.45;
      shin.add(ankle);
      var foot = box(0.11, 0.06, 0.24, colors.skin);
      foot.position.set(0, -0.03, 0.06);
      ankle.add(foot);

      legs[i === 0 ? 'left' : 'right'] = { hip: hip, knee: knee, ankle: ankle };
    });

    return { root: root, pelvis: pelvis, torso: torso, arms: arms, legs: legs };
  }

  /** 자세를 실제 관절 회전으로 옮긴다. */
  function applyPose(figure, pose, orientation) {
    figure.torso.rotation.x = (pose.spine || 0) * DEG;

    ['left', 'right'].forEach(function (side, i) {
      var leg = figure.legs[side];
      var arm = figure.arms[side];
      // 런지·걷기는 좌우 다리가 반대로 움직인다
      var offset = (pose.split || 0) * (i === 0 ? 1 : -1);

      leg.hip.rotation.x = -(pose.hip || 0) * DEG + (offset ? offset * 0.9 : 0);
      leg.knee.rotation.x = (pose.knee || 0) * DEG * (offset < 0 ? 1.15 : 1);
      leg.ankle.rotation.x = (pose.ankle || 0) * DEG;
      leg.hip.position.z = offset * 0.6;

      arm.shoulder.rotation.x = -(pose.shoulder || 0) * DEG;
      arm.elbow.rotation.x = (pose.elbow || 0) * DEG;
    });

    // 자세 유형에 따라 몸 전체를 돌려 눕히거나 숙인다
    var root = figure.root;
    root.rotation.set(0, 0, 0);
    root.position.set(0, 0, 0);

    if (orientation === 'standing' || orientation === 'bentOver') {
      root.position.y = groundedDrop(pose) + (pose.rootY || 0);
    } else if (orientation === 'prone') {
      // 엎드려 버티기 — 몸을 수평으로 눕히고 팔뚝으로 받친다.
      // 위팔 0.3m가 그대로 지지대라, 어깨 높이를 0.3으로 두면 팔뚝이 바닥에 닿는다.
      root.rotation.x = Math.PI / 2;
      root.position.y = 0.3;
      root.position.z = -0.45;
    } else if (orientation === 'supine') {
      root.rotation.x = -Math.PI / 2;
      root.position.y = 0.45;
      root.position.z = -0.4;
    } else if (orientation === 'seated') {
      root.position.y = -0.25;
    } else if (orientation === 'hanging') {
      root.position.y = (pose.rootY || 0) + 0.25;
    }
  }

  var CAMERA = {
    side: { x: 3.4, y: 1.3, z: 0.2 },
    front: { x: 0.2, y: 1.3, z: 3.4 },
    threeQuarter: { x: 2.5, y: 1.5, z: 2.3 },
  };

  /**
   * 캔버스에 시연을 띄운다.
   * 반환된 핸들로 재생/정지·속도·정리를 제어한다.
   */
  function mount(canvas, demo, options) {
    options = options || {};
    if (typeof THREE === 'undefined') return null;

    var dark = options.dark;
    var colors = dark
      ? { body: 0x8b87ff, skin: 0xb9b5ff, ground: 0x1f232a, bg: 0x181b21 }
      : { body: 0x4540c9, skin: 0x7d79e0, ground: 0xe4e7ec, bg: 0xf4f5f8 };

    var renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));

    var scene = new THREE.Scene();
    scene.background = new THREE.Color(colors.bg);

    var camera = new THREE.PerspectiveCamera(38, 1, 0.1, 50);
    var view = CAMERA[demo.view] || CAMERA.side;
    camera.position.set(view.x, view.y, view.z);
    camera.lookAt(0, 0.85, 0);

    scene.add(new THREE.AmbientLight(0xffffff, dark ? 0.55 : 0.75));
    var key = new THREE.DirectionalLight(0xffffff, dark ? 0.7 : 0.6);
    key.position.set(3, 5, 4);
    scene.add(key);

    var ground = new THREE.Mesh(
      new THREE.PlaneGeometry(8, 8),
      new THREE.MeshLambertMaterial({ color: colors.ground })
    );
    ground.rotation.x = -Math.PI / 2;
    scene.add(ground);

    var figure = buildFigure(colors);
    scene.add(figure.root);

    var state = { t: 0, playing: true, speed: 1, last: performance.now(), frame: 0 };

    function resize() {
      var rect = canvas.getBoundingClientRect();
      var width = Math.max(1, rect.width);
      var height = Math.max(1, rect.height);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    }

    function tick(now) {
      state.frame = requestAnimationFrame(tick);
      var delta = Math.min(0.05, (now - state.last) / 1000);
      state.last = now;

      if (state.playing) {
        state.t = (state.t + (delta / demo.cycleSeconds) * state.speed) % 1;
        if (options.onProgress) options.onProgress(state.t, E.labelAt(demo, state.t));
      }

      applyPose(figure, E.poseAt(demo, state.t), demo.orientation);
      renderer.render(scene, camera);
    }

    resize();
    state.frame = requestAnimationFrame(tick);
    window.addEventListener('resize', resize);

    return {
      play: function () { state.playing = true; },
      pause: function () { state.playing = false; },
      toggle: function () { state.playing = !state.playing; return state.playing; },
      isPlaying: function () { return state.playing; },
      setSpeed: function (value) { state.speed = value; },
      seek: function (t) { state.t = t; },
      dispose: function () {
        cancelAnimationFrame(state.frame);
        window.removeEventListener('resize', resize);
        renderer.dispose();
      },
    };
  }

  /* ── 2D 폴백 ───────────────────────────────────── */

  /**
   * three.js를 못 받아온 환경에서도 동작은 보여준다.
   *
   * 관절 회전이 전부 X축이라 옆모습에는 손실이 없다 — 앞뒤(z) × 높이(y)
   * 평면에서 같은 각도를 그대로 풀면 3D와 같은 동작이 나온다.
   */
  function skeleton(pose, orientation) {
    var rad = function (deg) { return (deg || 0) * DEG; };
    var spine = rad(pose.spine);

    function along(point, length, angle, sign) {
      return {
        z: point.z + sign * length * Math.sin(angle),
        y: point.y + sign * length * Math.cos(angle),
      };
    }

    var pelvis = { z: 0, y: 0.95 };
    var shoulder = along(pelvis, 0.44, spine, 1);
    var head = along(pelvis, 0.68, spine, 1);

    var bones = [[pelvis, shoulder]];
    var limbs = [];

    [1, -1].forEach(function (side) {
      // 팔 — 어깨 굴곡은 상체 각도 위에 쌓인다
      var armAngle = spine - rad(pose.shoulder);
      var elbow = along(shoulder, 0.3, armAngle, -1);
      var hand = along(elbow, 0.28, armAngle + rad(pose.elbow), -1);

      // 다리 — 런지·걷기는 좌우가 반대로 벌어진다
      var offset = (pose.split || 0) * side;
      var hipPoint = { z: pelvis.z + offset * 0.6, y: pelvis.y };
      var hipAngle = -rad(pose.hip) + offset * 0.9;
      var knee = along(hipPoint, 0.45, hipAngle, -1);
      var kneeAngle = hipAngle + rad(pose.knee) * (offset < 0 ? 1.15 : 1);
      var ankle = along(knee, 0.45, kneeAngle, -1);
      var toe = along(ankle, 0.22, kneeAngle + rad(pose.ankle) + Math.PI / 2, 1);

      limbs.push([shoulder, elbow], [elbow, hand], [hipPoint, knee], [knee, ankle], [ankle, toe]);
    });

    var points = bones.concat(limbs);
    var drop = orientation === 'standing' || orientation === 'bentOver'
      ? groundedDrop(pose) + (pose.rootY || 0)
      : 0;

    var lay = function (point) {
      if (orientation === 'prone') return { z: point.y - 1.05, y: 0.3 - point.z };
      if (orientation === 'supine') return { z: point.y - 1.1, y: 0.45 + point.z };
      if (orientation === 'seated') return { z: point.z, y: point.y - 0.25 };
      if (orientation === 'hanging') return { z: point.z, y: point.y + (pose.rootY || 0) + 0.25 };
      return { z: point.z, y: point.y + drop };
    };

    return {
      segments: points.map(function (pair) { return [lay(pair[0]), lay(pair[1])]; }),
      head: lay(head),
    };
  }

  function mount2d(canvas, demo, options) {
    options = options || {};
    var ctx = canvas.getContext('2d');
    if (!ctx) return null;

    var dark = options.dark;
    var ink = dark ? '#b9b5ff' : '#4540c9';
    var ground = dark ? '#2b3038' : '#d3d7de';
    var bg = dark ? '#181b21' : '#f4f5f8';
    var state = { t: 0, playing: true, speed: 1, last: performance.now(), frame: 0 };

    function draw() {
      var rect = canvas.getBoundingClientRect();
      var ratio = Math.min(2, window.devicePixelRatio || 1);
      var width = Math.max(1, rect.width);
      var height = Math.max(1, rect.height);
      if (canvas.width !== Math.round(width * ratio)) {
        canvas.width = Math.round(width * ratio);
        canvas.height = Math.round(height * ratio);
      }
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, width, height);

      var scale = height / 2.4;
      var baseline = height * 0.92;
      var originX = width * 0.5;
      var project = function (point) {
        return [originX - point.z * scale, baseline - point.y * scale];
      };

      ctx.strokeStyle = ground;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, baseline);
      ctx.lineTo(width, baseline);
      ctx.stroke();

      var figure = skeleton(E.poseAt(demo, state.t), demo.orientation);
      ctx.strokeStyle = ink;
      ctx.lineWidth = Math.max(3, height * 0.018);
      ctx.lineCap = 'round';
      figure.segments.forEach(function (segment) {
        var a = project(segment[0]);
        var b = project(segment[1]);
        ctx.beginPath();
        ctx.moveTo(a[0], a[1]);
        ctx.lineTo(b[0], b[1]);
        ctx.stroke();
      });

      var head = project(figure.head);
      ctx.fillStyle = ink;
      ctx.beginPath();
      ctx.arc(head[0], head[1], Math.max(5, height * 0.035), 0, Math.PI * 2);
      ctx.fill();
    }

    function tick(now) {
      state.frame = requestAnimationFrame(tick);
      var delta = Math.min(0.05, (now - state.last) / 1000);
      state.last = now;
      if (state.playing) {
        state.t = (state.t + (delta / demo.cycleSeconds) * state.speed) % 1;
        if (options.onProgress) options.onProgress(state.t, E.labelAt(demo, state.t));
      }
      draw();
    }

    state.frame = requestAnimationFrame(tick);
    return {
      play: function () { state.playing = true; },
      pause: function () { state.playing = false; },
      toggle: function () { state.playing = !state.playing; return state.playing; },
      isPlaying: function () { return state.playing; },
      setSpeed: function (value) { state.speed = value; },
      seek: function (t) { state.t = t; },
      dispose: function () { cancelAnimationFrame(state.frame); },
    };
  }

  window.FitDemo3D = {
    /** three.js가 있으면 3D로, 없으면 같은 데이터를 평면으로 그린다. */
    mount: function (canvas, demo, options) {
      return typeof THREE !== 'undefined' ? mount(canvas, demo, options) : mount2d(canvas, demo, options);
    },
    available: function () { return true; },
    is3d: function () { return typeof THREE !== 'undefined'; },
  };
})();
