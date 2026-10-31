/**
 * 동작 시연 렌더러.
 *
 * 엔진(motions · rig)이 매 프레임 뼈와 기구 위치를 계산하고, 여기서는 그리기만 한다.
 * 몸은 직접 빚은 매끈한 마네킹이다 — 외부 3D 모델 · 남의 그림을 쓰지 않는다. 근육은 몸 위에
 * 덩어리로 얹었고, 그 종목이 쓰는 근육이 힘쓰는 구간에 밝아진다.
 *
 * three.js가 없으면(오프라인 첫 실행 등) 같은 뼈를 평면에 선으로 그린다.
 */
(function () {
  'use strict';

  var E = window.FitEngine;

  var PALETTE = {
    light: {
      bg: 0xf1f2f6, floor: 0xe5e7ed, grid: 0xd3d7df, skin: 0xd8cbbf, muscle: 0xd0c0b2,
      shorts: 0x2d3240, shoe: 0x30343e, sole: 0xf3f3f3, hair: 0x3a3532,
      accent: 0x4a43d6, fault: 0xd8453a, steel: 0xb4bbc5, dark: 0x2a2e37, pad: 0x3a404d,
      plate: 0x24272e, plateRim: 0x4a43d6, box: 0xb9a184, mat: 0x4c5363, cable: 0x30333a,
    },
    dark: {
      bg: 0x15181e, floor: 0x1d2129, grid: 0x2a303a, skin: 0xbfb1a5, muscle: 0xb6a698,
      shorts: 0x3b4252, shoe: 0x454b58, sole: 0xd9d9d9, hair: 0x2b2725,
      accent: 0x8f89ff, fault: 0xff6a5c, steel: 0x9aa2ad, dark: 0x3a404c, pad: 0x4a5161,
      plate: 0x30343c, plateRim: 0x8f89ff, box: 0x8f7c66, mat: 0x353b47, cable: 0x8b919c,
    },
  };

  /* ── 몸 치수 (렌더용) ───────────────────────── */

  // 팔다리 단면 반지름 — [뼈 길이 비율, 반지름(m)]
  /*
   * 운동 1~2년 한 탄탄한 몸 — 어깨가 넓고 허리가 잘록하다(역삼각형). 보디빌더처럼 키우지 않는다:
   * 초보가 거리감을 느끼고, 덩어리가 관절 · 손 위치를 가려 동작이 덜 보인다.
   */
  var PROFILE = {
    thigh: [[0, 0.09], [0.12, 0.09], [0.42, 0.08], [0.78, 0.063], [1, 0.052]],
    shin: [[0, 0.052], [0.12, 0.058], [0.28, 0.063], [0.58, 0.047], [0.88, 0.035], [1, 0.033]],
    upperArm: [[0, 0.056], [0.22, 0.054], [0.52, 0.05], [0.82, 0.041], [1, 0.037]],
    forearm: [[0, 0.04], [0.2, 0.045], [0.58, 0.035], [1, 0.027]],
    lumbar: [[0, 0.14], [0.5, 0.134], [1, 0.146]],
    chest: [[0, 0.148], [0.3, 0.172], [0.62, 0.188], [0.86, 0.172], [1, 0.106]],
  };

  /*
   * 근육 덩어리 — 뼈 틀 기준. side는 몸 바깥쪽(+)으로, front는 앞(+)으로. r = [옆, 길이, 앞뒤] 반지름.
   * 두 쪽에 다 붙는 것은 pair, 몸통 가운데 하나는 pair 없이. turn은 몸통 곡면을 따라 바깥으로
   * 돌리는 각 — 가슴처럼 둥근 앞면에 붙는 것은 돌려야 가운데만 살짝 솟고 가장자리가 묻힌다.
   * 몸통 앞면(가슴 · 배)은 겉면보다 1cm쯤만 솟게 — 더 안쪽이면 몸통에 묻혀 빛나도 안 보인다.
   */
  var MUSCLES = [
    // 가슴 — 넓고 두툼하게, 아래 경계가 보이게
    { group: 'chest', bone: 'chest', u: 0.62, side: 0.068, front: 0.142, r: [0.082, 0.06, 0.03], pair: true, turn: 18 },
    // 복근 — 세 줄 두 칸(식스팩). 가운데 홈이 보이게 양쪽으로 나눈다
    { group: 'abs', bone: 'lumbar', u: 0.36, side: 0.03, front: 0.112, r: [0.027, 0.04, 0.02], pair: true },
    { group: 'abs', bone: 'lumbar', u: 0.7, side: 0.03, front: 0.116, r: [0.027, 0.04, 0.02], pair: true },
    { group: 'abs', bone: 'chest', u: 0.12, side: 0.03, front: 0.124, r: [0.026, 0.038, 0.02], pair: true },
    // 등 — 광배가 옆으로 퍼져 역삼각형을 만든다
    { group: 'back', bone: 'chest', u: 0.58, side: 0.118, front: -0.022, r: [0.056, 0.11, 0.058], pair: true },
    { group: 'back', bone: 'chest', u: 0.28, side: 0.1, front: -0.03, r: [0.048, 0.11, 0.054], pair: true },
    { group: 'back', bone: 'chest', u: 0.72, side: 0.048, front: -0.064, r: [0.054, 0.075, 0.028], pair: true },
    { group: 'lowBack', bone: 'lumbar', u: 0.5, side: 0.036, front: -0.06, r: [0.032, 0.11, 0.024], pair: true },
    { group: 'traps', bone: 'chest', u: 0.93, side: 0.078, front: -0.03, r: [0.082, 0.056, 0.04], pair: true },
    // 어깨 — 둥글게 솟은 삼각근
    { group: 'frontDelt', bone: 'upperArm', u: 0.13, side: 0.008, front: 0.034, r: [0.034, 0.076, 0.03], pair: true },
    { group: 'sideDelt', bone: 'upperArm', u: 0.12, side: 0.04, front: 0, r: [0.03, 0.078, 0.04], pair: true },
    { group: 'rearDelt', bone: 'upperArm', u: 0.13, side: 0.008, front: -0.034, r: [0.034, 0.076, 0.03], pair: true },
    { group: 'biceps', bone: 'upperArm', u: 0.55, side: 0, front: 0.031, r: [0.032, 0.105, 0.029], pair: true },
    { group: 'triceps', bone: 'upperArm', u: 0.48, side: 0, front: -0.031, r: [0.034, 0.125, 0.03], pair: true },
    { group: 'forearms', bone: 'forearm', u: 0.28, side: 0.01, front: 0.014, r: [0.033, 0.095, 0.031], pair: true },
    // 허벅지 — 반바지 밑으로 앞쪽 근육(무릎 위 물방울)이 보이게 조금 아래로
    { group: 'quads', bone: 'thigh', u: 0.6, side: 0.004, front: 0.044, r: [0.046, 0.17, 0.034], pair: true },
    { group: 'hamstrings', bone: 'thigh', u: 0.58, side: 0, front: -0.044, r: [0.044, 0.16, 0.034], pair: true },
    // 엉덩이 — 반바지 위라 평소엔 바지 색(빛날 때만 색이 든다)
    { group: 'glutes', bone: 'pelvis', u: 0.45, side: 0.072, front: -0.086, r: [0.074, 0.082, 0.054], pair: true, cloth: true },
    { group: 'calves', bone: 'shin', u: 0.28, side: 0, front: -0.036, r: [0.046, 0.1, 0.036], pair: true },
  ];

  /* ── three.js ────────────────────────────────── */

  function colorOf(hex) {
    var color = new THREE.Color(hex);
    return color.convertSRGBToLinear ? color.convertSRGBToLinear() : color;
  }

  function material(hex, options) {
    options = options || {};
    return new THREE.MeshStandardMaterial({
      color: colorOf(hex),
      roughness: options.roughness === undefined ? 0.7 : options.roughness,
      metalness: options.metalness || 0,
    });
  }

  /** 길이 1짜리 회전체 — 프로필대로 굵기가 변한다. 위아래는 둥글게 닫는다. */
  function latheUnit(profile) {
    var points = [];
    var first = profile[0][1];
    var last = profile[profile.length - 1][1];
    var i;
    for (i = 0; i <= 4; i += 1) {
      var a = (i / 4) * (Math.PI / 2);
      points.push(new THREE.Vector2(Math.sin(a) * first, -Math.cos(a) * first * 0.45 + first * 0.45 - first * 0.45));
    }
    profile.forEach(function (p) { points.push(new THREE.Vector2(p[1], p[0])); });
    for (i = 4; i >= 0; i -= 1) {
      var b = (i / 4) * (Math.PI / 2);
      points.push(new THREE.Vector2(Math.sin(b) * last, 1 + Math.cos(b) * last * 0.45));
    }
    return new THREE.LatheGeometry(points, 20);
  }

  /** 둥근 모서리 상자. */
  function roundedBox(w, h, d, r) {
    var geometry = new THREE.BoxGeometry(1, 1, 1, 5, 5, 5);
    var pos = geometry.attributes.position;
    var half = [w / 2, h / 2, d / 2];
    var rr = Math.min(r, half[0], half[1], half[2]);
    var v = [0, 0, 0];
    for (var i = 0; i < pos.count; i += 1) {
      v[0] = pos.getX(i) * w; v[1] = pos.getY(i) * h; v[2] = pos.getZ(i) * d;
      var inner = [0, 0, 0];
      var out = [0, 0, 0];
      for (var k = 0; k < 3; k += 1) {
        var limit = half[k] - rr;
        inner[k] = Math.max(-limit, Math.min(limit, v[k]));
        out[k] = v[k] - inner[k];
      }
      var len = Math.sqrt(out[0] * out[0] + out[1] * out[1] + out[2] * out[2]) || 1;
      pos.setXYZ(i, inner[0] + (out[0] / len) * rr, inner[1] + (out[1] / len) * rr, inner[2] + (out[2] / len) * rr);
    }
    geometry.computeVertexNormals();
    return geometry;
  }

  var tmpX = null;
  var tmpY = null;
  var tmpZ = null;

  /** 메시를 (가운데 p, x축, y축, 크기 s)로 놓는다. 축이 꼬여도 직교로 맞춘다. */
  function place(mesh, p, x, y, sx, sy, sz) {
    tmpY.set(y[0], y[1], y[2]).normalize();
    tmpX.set(x[0], x[1], x[2]);
    tmpX.addScaledVector(tmpY, -tmpX.dot(tmpY));
    if (tmpX.lengthSq() < 1e-8) tmpX.set(1, 0, 0).addScaledVector(tmpY, -tmpY.x);
    tmpX.normalize();
    tmpZ.crossVectors(tmpX, tmpY);
    mesh.matrix.makeBasis(tmpX.multiplyScalar(sx), tmpY.multiplyScalar(sy), tmpZ.multiplyScalar(sz));
    mesh.matrix.setPosition(p[0], p[1], p[2]);
    mesh.matrixWorldNeedsUpdate = true;
  }

  function sub3(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
  function add3(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
  function mul3(a, s) { return [a[0] * s, a[1] * s, a[2] * s]; }
  function dot3(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function len3(a) { return Math.sqrt(dot3(a, a)); }
  function norm3(a) { var l = len3(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }
  function cross3(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }

  /** 뼈 틀 — y = a→b, z = 앞, x = y×z */
  function boneBasis(bone) {
    var y = norm3(sub3(bone.b, bone.a));
    var f = bone.f;
    var z = sub3(f, mul3(y, dot3(f, y)));
    z = len3(z) < 1e-6 ? [0, 0, 1] : norm3(z);
    return { y: y, z: z, x: cross3(y, z), len: len3(sub3(bone.b, bone.a)) };
  }

  /* ── 몸 ───────────────────────────────────────── */

  function buildBody(scene, colors) {
    var mats = {
      skin: material(colors.skin, { roughness: 0.62 }),
      shorts: material(colors.shorts, { roughness: 0.85 }),
      shoe: material(colors.shoe, { roughness: 0.6 }),
      sole: material(colors.sole, { roughness: 0.8 }),
      hair: material(colors.hair, { roughness: 0.9 }),
    };
    var unit = {
      sphere: new THREE.SphereGeometry(1, 20, 14),
      thigh: latheUnit(PROFILE.thigh),
      shin: latheUnit(PROFILE.shin),
      upperArm: latheUnit(PROFILE.upperArm),
      forearm: latheUnit(PROFILE.forearm),
      lumbar: latheUnit(PROFILE.lumbar),
      chest: latheUnit(PROFILE.chest),
      cylinder: new THREE.CylinderGeometry(1, 1, 1, 16),
      hand: roundedBox(1, 1, 1, 0.3),
      shoe: roundedBox(1, 1, 1, 0.3),
    };
    var parts = {};
    function add(name, geometry, mat) {
      var mesh = new THREE.Mesh(geometry, mat);
      mesh.matrixAutoUpdate = false;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      scene.add(mesh);
      parts[name] = mesh;
      return mesh;
    }
    add('pelvis', unit.sphere, mats.shorts);
    add('lumbar', unit.lumbar, mats.skin);
    add('chest', unit.chest, mats.skin);
    add('neck', unit.cylinder, mats.skin);
    add('head', unit.sphere, mats.skin);
    add('hair', unit.sphere, mats.hair);
    // 귀 · 코 — 얼굴이 어느 쪽인지 바로 보이게
    add('earL', unit.sphere, mats.skin);
    add('earR', unit.sphere, mats.skin);
    add('nose', unit.sphere, mats.skin);
    add('waist', unit.cylinder, mats.shorts);
    ['L', 'R'].forEach(function (s) {
      add('upperArm' + s, unit.upperArm, mats.skin);
      add('forearm' + s, unit.forearm, mats.skin);
      add('hand' + s, unit.hand, mats.skin);
      add('shoulder' + s, unit.sphere, mats.skin);
      add('elbow' + s, unit.sphere, mats.skin);
      add('thigh' + s, unit.thigh, mats.skin);
      add('short' + s, unit.thigh, mats.shorts);
      add('shin' + s, unit.shin, mats.skin);
      add('knee' + s, unit.sphere, mats.skin);
      add('ankle' + s, unit.sphere, mats.skin);
      add('shoe' + s, unit.shoe, mats.shoe);
      add('sole' + s, unit.shoe, mats.sole);
    });

    // 근육 덩어리
    var muscles = [];
    MUSCLES.forEach(function (spec) {
      var sides = spec.pair ? ['L', 'R'] : [''];
      sides.forEach(function (s) {
        var mat = material(colors.muscle, { roughness: 0.62 });
        mat.emissive = colorOf(colors.accent);
        mat.emissiveIntensity = 0;
        var mesh = new THREE.Mesh(unit.sphere, mat);
        mesh.matrixAutoUpdate = false;
        mesh.castShadow = false;
        scene.add(mesh);
        muscles.push({ spec: spec, side: s, mesh: mesh, mat: mat });
      });
    });

    return { parts: parts, muscles: muscles, mats: mats, unit: unit };
  }

  /** 뼈 하나에 회전체를 씌운다. width/depth는 단면 배율, ahead는 앞으로 비켜 놓기(m). */
  function wrap(mesh, bone, width, depth, ahead) {
    var basis = boneBasis(bone);
    var at = ahead ? add3(bone.a, mul3(basis.z, ahead)) : bone.a;
    place(mesh, at, basis.x, basis.y, width, basis.len, depth);
  }

  function ball(mesh, p, r) {
    place(mesh, p, [1, 0, 0], [0, 1, 0], r, r, r);
  }

  function poseBody(body, bones) {
    var parts = body.parts;
    var pelvis = boneBasis(bones.pelvis);
    var pelvisCenter = add3(add3(bones.pelvis.a, mul3(pelvis.y, pelvis.len * 0.45)), mul3(pelvis.z, -0.012));
    place(parts.pelvis, pelvisCenter, pelvis.x, pelvis.y, 0.168, 0.118, 0.118);
    wrap(parts.lumbar, bones.lumbar, 1, 0.66, 0.036);
    wrap(parts.chest, bones.chest, 1, 0.62, 0.042);
    var neck = boneBasis(bones.neck);
    place(parts.neck, add3(bones.neck.a, mul3(neck.y, neck.len * 0.5)), neck.x, neck.y, 0.05, neck.len + 0.03, 0.052);
    var head = boneBasis(bones.head);
    var headCenter = add3(add3(bones.head.a, mul3(head.y, 0.088)), mul3(head.z, 0.012));
    place(parts.head, headCenter, head.x, head.y, 0.088, 0.112, 0.1);
    place(parts.hair, add3(add3(headCenter, mul3(head.y, 0.022)), mul3(head.z, -0.018)), head.x, head.y, 0.092, 0.1, 0.094);
    place(parts.earL, add3(add3(headCenter, mul3(head.x, 0.086)), mul3(head.z, -0.006)), head.x, head.y, 0.016, 0.03, 0.022);
    place(parts.earR, add3(add3(headCenter, mul3(head.x, -0.086)), mul3(head.z, -0.006)), head.x, head.y, 0.016, 0.03, 0.022);
    place(parts.nose, add3(add3(headCenter, mul3(head.z, 0.098)), mul3(head.y, -0.012)), head.x, head.y, 0.014, 0.022, 0.016);
    // 반바지 허리 — 골반 위 띠
    var lumbar = boneBasis(bones.lumbar);
    place(parts.waist, add3(add3(bones.lumbar.a, mul3(lumbar.y, 0.03)), mul3(lumbar.z, 0.03)), lumbar.x, lumbar.y, 0.158, 0.06, 0.112);

    ['L', 'R'].forEach(function (s) {
      wrap(parts['upperArm' + s], bones['upperArm' + s], 1, 1, 0);
      wrap(parts['forearm' + s], bones['forearm' + s], 1, 0.92, 0);
      ball(parts['shoulder' + s], bones['upperArm' + s].a, 0.052);
      ball(parts['elbow' + s], bones['forearm' + s].a, 0.037);
      var hand = boneBasis(bones['hand' + s]);
      place(parts['hand' + s], add3(bones['hand' + s].a, mul3(hand.y, 0.055)), hand.x, hand.y, 0.03, 0.1, 0.082);
      wrap(parts['thigh' + s], bones['thigh' + s], 1, 1, 0);
      // 반바지 — 허벅지 가운데쯤까지(속옷처럼 보이지 않게). 조금 헐렁하게
      var thigh = boneBasis(bones['thigh' + s]);
      place(parts['short' + s], add3(bones['thigh' + s].a, mul3(thigh.y, -0.04)), thigh.x, thigh.y, 1.17, thigh.len * 0.66, 1.17);
      wrap(parts['shin' + s], bones['shin' + s], 1, 1, 0);
      ball(parts['knee' + s], bones['shin' + s].a, 0.05);
      ball(parts['ankle' + s], bones['shin' + s].b, 0.034);
      // 신발 — 발바닥 뒤꿈치(a) → 발끝(b), f = 발등 쪽
      var foot = bones['foot' + s];
      var along = norm3(sub3(foot.b, foot.a));
      var up = norm3(sub3(foot.f, mul3(along, dot3(foot.f, along))));
      var side = cross3(up, along);
      var length = len3(sub3(foot.b, foot.a)) + 0.03;
      var mid = mul3(add3(foot.a, foot.b), 0.5);
      place(parts['shoe' + s], add3(mid, mul3(up, 0.045)), side, up, 0.098, 0.075, length);
      place(parts['sole' + s], add3(mid, mul3(up, 0.008)), side, up, 0.104, 0.018, length + 0.006);
    });

    body.muscles.forEach(function (m) {
      var spec = m.spec;
      var name = spec.bone === 'pelvis' || spec.bone === 'lumbar' || spec.bone === 'chest' ? spec.bone : spec.bone + m.side;
      var bone = bones[name];
      if (!bone) return;
      var basis = boneBasis(bone);
      // 바깥쪽: 왼쪽 팔다리는 뼈 틀 −x, 오른쪽은 +x. 몸통은 L이 +x(그 사람의 왼쪽)
      var trunk = spec.bone === 'pelvis' || spec.bone === 'lumbar' || spec.bone === 'chest';
      var outward = trunk ? (m.side === 'R' ? -1 : 1) : (m.side === 'L' ? -1 : 1);
      var p = add3(bone.a, mul3(basis.y, basis.len * spec.u));
      p = add3(p, mul3(basis.x, outward * spec.side));
      p = add3(p, mul3(basis.z, spec.front));
      // 몸통 곡면을 따라 바깥으로 돌린다 (뼈 축 둘레로) — 앞면이 바깥쪽을 향하게
      var turn = (spec.turn || 0) * Math.PI / 180 * outward;
      var x = turn ? add3(mul3(basis.x, Math.cos(turn)), mul3(basis.z, -Math.sin(turn))) : basis.x;
      place(m.mesh, p, x, basis.y, spec.r[0], spec.r[1], spec.r[2] * 0.88);
    });
  }

  /** 근육 색 — 그 종목이 쓰는 비율만큼, 힘쓰는 구간에 더 밝게. */
  function paintMuscles(body, colors, weights, effort, fault) {
    var base = colorOf(colors.muscle);
    var cloth = colorOf(colors.shorts);
    var hot = colorOf(fault ? colors.fault : colors.accent);
    body.muscles.forEach(function (m) {
      var w = weights[m.spec.group] || 0;
      var k = Math.min(1, w * (0.55 + 0.45 * effort) * 1.15);
      m.mat.color.copy(m.spec.cloth ? cloth : base).lerp(hot, k);
      m.mat.emissive.copy(hot);
      m.mat.emissiveIntensity = k * 0.28 * effort;
    });
  }

  /** 엔진 근육 비율 → 그릴 덩어리 무게. 힌지 종목의 '등'은 허리(척추기립근)도 같이. */
  function muscleWeights(contribution, pattern) {
    var out = {};
    Object.keys(contribution || {}).forEach(function (key) {
      var value = contribution[key] || 0;
      out[key] = value >= 0.65 ? 1 : value >= 0.4 ? 0.7 : value >= 0.2 ? 0.4 : 0;
    });
    if (pattern === 'hinge' && out.back) out.lowBack = Math.max(out.back, 0.7);
    else if (out.back && out.abs) out.lowBack = 0.3;
    return out;
  }

  /* ── 기구 ─────────────────────────────────────── */

  function buildKit(colors) {
    return {
      steel: material(colors.steel, { roughness: 0.35, metalness: 0.75 }),
      dark: material(colors.dark, { roughness: 0.55, metalness: 0.35 }),
      pad: material(colors.pad, { roughness: 0.75 }),
      plate: material(colors.plate, { roughness: 0.6 }),
      rim: material(colors.plateRim, { roughness: 0.5 }),
      box: material(colors.box, { roughness: 0.85 }),
      mat: material(colors.mat, { roughness: 0.95 }),
      cable: material(colors.cable, { roughness: 0.5 }),
      cylinder: new THREE.CylinderGeometry(1, 1, 1, 18),
      hex: new THREE.CylinderGeometry(1, 1, 1, 6),
      box1: new THREE.BoxGeometry(1, 1, 1),
      sphere: new THREE.SphereGeometry(1, 16, 12),
      torus: new THREE.TorusGeometry(1, 0.16, 8, 20),
    };
  }

  function mesh(group, geometry, mat, shadow) {
    var m = new THREE.Mesh(geometry, mat);
    m.matrixAutoUpdate = false;
    m.castShadow = shadow !== false;
    m.receiveShadow = true;
    group.add(m);
    return m;
  }

  /** 원통을 x축 방향으로 — 가운데 p, 반지름 r, 길이 len */
  function rod(group, kit, mat, p, x, y, r, len, geometry) {
    // 원통 기본 축이 y이므로 (x → y)로 돌려 놓는다
    var m = mesh(group, geometry || kit.cylinder, mat);
    var z = cross3(norm3(x), norm3(y));
    place(m, p, mul3(y, -1), x, r, len, r);
    void z;
    return m;
  }

  /** 고정 기구 하나 */
  function buildPrim(group, kit, prim) {
    var x = prim.x || [1, 0, 0];
    var y = prim.y || [0, 1, 0];
    var s = prim.size;
    switch (prim.kind) {
      case 'pad': {
        var m = mesh(group, roundedBox(s[0], s[1], s[2], Math.min(0.03, s[1] / 2)), kit.pad);
        place(m, prim.p, x, y, 1, 1, 1);
        return;
      }
      case 'box': {
        var b = mesh(group, roundedBox(s[0], s[1], s[2], 0.02), kit.box);
        place(b, prim.p, x, y, 1, 1, 1);
        return;
      }
      case 'mat': {
        var mt = mesh(group, roundedBox(s[0], s[1], s[2], 0.005), kit.mat, false);
        place(mt, prim.p, x, y, 1, 1, 1);
        return;
      }
      case 'frame':
      case 'post': {
        var f = mesh(group, kit.box1, kit.dark);
        place(f, prim.p, x, y, s[0], s[1], s[2]);
        return;
      }
      case 'roller':
        rod(group, kit, kit.pad, prim.p, x, y, s[0], s[1]);
        return;
      case 'plate':
        rod(group, kit, kit.plate, prim.p, x, y, s[0], s[1]);
        return;
      case 'bar':
        rod(group, kit, kit.steel, prim.p, x, y, s[0], s[1]);
        return;
      case 'pulley':
        rod(group, kit, kit.dark, prim.p, x, y, s[0], s[1]);
        return;
      default:
    }
  }

  /**
   * 움직이는 기구 — 프레임마다 다시 놓는다. 종류별로 메시 묶음을 한 번 만들고 재사용한다.
   */
  function movingKit(group, kit) {
    var pool = {};
    var used = {};
    function take(key, make) {
      var list = pool[key] || (pool[key] = []);
      var index = used[key] || 0;
      used[key] = index + 1;
      if (!list[index]) list[index] = make();
      list[index].visible = true;
      return list[index];
    }
    function start() {
      used = {};
      Object.keys(pool).forEach(function (key) {
        pool[key].forEach(function (item) { item.visible = false; });
      });
    }
    function sub(key, build) {
      return take(key, function () {
        var g = new THREE.Group();
        g.matrixAutoUpdate = false;
        build(g);
        group.add(g);
        return g;
      });
    }
    return { start: start, take: take, sub: sub };
  }

  /** 원판 낀 바 — 길이 len, 원판 반지름 plate, 슬리브 시작 sleeve */
  function barbellGroup(g, kit, len, plate, sleeve) {
    var parts = [];
    function piece(geometry, mat, at, r, l) {
      var m = new THREE.Mesh(geometry, mat);
      m.castShadow = true;
      m.rotation.z = Math.PI / 2;
      m.position.x = at;
      m.scale.set(r, l, r);
      g.add(m);
      parts.push(m);
    }
    piece(kit.cylinder, kit.steel, 0, 0.014, len);
    if (plate > 0) {
      [-1, 1].forEach(function (s) {
        piece(kit.cylinder, kit.steel, s * (sleeve + 0.2), 0.025, 0.4);
        piece(kit.cylinder, kit.dark, s * (sleeve + 0.012), 0.034, 0.025);
        piece(kit.cylinder, kit.plate, s * (sleeve + 0.06), plate, 0.05);
        piece(kit.cylinder, kit.rim, s * (sleeve + 0.06), plate * 1.01, 0.012);
        piece(kit.cylinder, kit.plate, s * (sleeve + 0.115), plate * 0.82, 0.04);
        piece(kit.cylinder, kit.dark, s * (sleeve + 0.152), 0.036, 0.02);
      });
    }
  }

  function dumbbellGroup(g, kit) {
    function piece(geometry, mat, at, r, l) {
      var m = new THREE.Mesh(geometry, mat);
      m.castShadow = true;
      m.rotation.z = Math.PI / 2;
      m.position.x = at;
      m.scale.set(r, l, r);
      g.add(m);
    }
    piece(kit.cylinder, kit.steel, 0, 0.016, 0.14);
    piece(kit.hex, kit.plate, 0.105, 0.058, 0.075);
    piece(kit.hex, kit.plate, -0.105, 0.058, 0.075);
    piece(kit.cylinder, kit.dark, 0.072, 0.03, 0.012);
    piece(kit.cylinder, kit.dark, -0.072, 0.03, 0.012);
  }

  function kettlebellGroup(g, kit) {
    var bell = new THREE.Mesh(kit.sphere, kit.plate);
    bell.position.set(0, -0.13, 0);
    bell.scale.set(0.105, 0.1, 0.105);
    bell.castShadow = true;
    g.add(bell);
    var handle = new THREE.Mesh(kit.torus, kit.plate);
    handle.position.set(0, -0.02, 0);
    handle.scale.set(0.07, 0.06, 0.07);
    handle.castShadow = true;
    g.add(handle);
  }

  function handleGroup(g, kit) {
    var grip = new THREE.Mesh(kit.cylinder, kit.dark);
    grip.rotation.z = Math.PI / 2;
    grip.scale.set(0.016, 0.12, 0.016);
    g.add(grip);
    var ring = new THREE.Mesh(kit.torus, kit.steel);
    ring.position.set(0, 0.045, 0);
    ring.scale.set(0.07, 0.06, 0.07);
    g.add(ring);
  }

  function setGroup(g, p, x, y) {
    var xx = norm3(x);
    var yy = sub3(y, mul3(xx, dot3(y, xx)));
    yy = len3(yy) < 1e-6 ? [0, 1, 0] : norm3(yy);
    var zz = cross3(xx, yy);
    g.matrix.makeBasis(new THREE.Vector3(xx[0], xx[1], xx[2]), new THREE.Vector3(yy[0], yy[1], yy[2]), new THREE.Vector3(zz[0], zz[1], zz[2]));
    g.matrix.setPosition(p[0], p[1], p[2]);
    g.matrixWorldNeedsUpdate = true;
  }

  function drawMoving(movers, kit, clip, frame) {
    movers.start();
    var hands = frame.solved.hands;
    frame.moving.forEach(function (item) {
      var g;
      switch (item.kind) {
        case 'barbell':
        case 'smith':
          g = movers.sub('barbell', function (grp) { barbellGroup(grp, kit, 2.2, item.size[2] || 0.225, 0.655); });
          setGroup(g, item.p, item.x, item.y);
          return;
        case 'ez':
          g = movers.sub('ez', function (grp) { barbellGroup(grp, kit, 1.3, 0.14, 0.42); });
          setGroup(g, item.p, item.x, item.y);
          return;
        case 'cable':
        case 'lat':
          g = movers.sub(item.kind, function (grp) { barbellGroup(grp, kit, item.kind === 'lat' ? 1.2 : 0.95, 0, 0); });
          setGroup(g, item.p, item.x, item.y);
          return;
        case 'trap':
          g = movers.sub('trap', function (grp) {
            // 육각 틀 + 원판
            var hex = [[0.3, 0.32], [0.62, 0], [0.3, -0.32], [-0.3, -0.32], [-0.62, 0], [-0.3, 0.32]];
            for (var i = 0; i < 6; i += 1) {
              var a = hex[i];
              var b = hex[(i + 1) % 6];
              var m = new THREE.Mesh(kit.cylinder, kit.steel);
              var dx = b[0] - a[0];
              var dz = b[1] - a[1];
              m.position.set((a[0] + b[0]) / 2, 0, (a[1] + b[1]) / 2);
              m.rotation.set(Math.PI / 2, 0, -Math.atan2(dx, dz));
              m.scale.set(0.016, Math.sqrt(dx * dx + dz * dz), 0.016);
              m.castShadow = true;
              grp.add(m);
            }
            barbellGroup(grp, kit, 0.01, 0.225, 0.62);
          });
          setGroup(g, item.p, item.x, item.y);
          return;
        case 'landmine':
        case 'tbar':
          g = movers.sub(item.kind + item.size[1].toFixed(2), function (grp) {
            var len = item.size[1];
            var bar = new THREE.Mesh(kit.cylinder, kit.steel);
            bar.rotation.z = Math.PI / 2;
            bar.scale.set(0.016, len, 0.016);
            bar.castShadow = true;
            grp.add(bar);
            var plate = new THREE.Mesh(kit.cylinder, kit.plate);
            plate.rotation.z = Math.PI / 2;
            plate.position.x = len / 2 - 0.12;
            plate.scale.set(item.size[2] || 0.2, 0.05, item.size[2] || 0.2);
            plate.castShadow = true;
            grp.add(plate);
            var sleeve = new THREE.Mesh(kit.cylinder, kit.steel);
            sleeve.rotation.z = Math.PI / 2;
            sleeve.position.x = len / 2 - 0.1;
            sleeve.scale.set(0.025, 0.2, 0.025);
            grp.add(sleeve);
          });
          setGroup(g, item.p, item.x, item.y);
          return;
        case 'wheel':
          g = movers.sub('wheel', function (grp) {
            var w = new THREE.Mesh(kit.cylinder, kit.plate);
            w.rotation.z = Math.PI / 2;
            w.scale.set(0.09, 0.06, 0.09);
            w.castShadow = true;
            grp.add(w);
            var axle = new THREE.Mesh(kit.cylinder, kit.steel);
            axle.rotation.z = Math.PI / 2;
            axle.scale.set(0.012, 0.36, 0.012);
            grp.add(axle);
          });
          setGroup(g, item.p, item.x, item.y);
          return;
        case 'dumbbell':
          g = movers.sub('dumbbell', function (grp) { dumbbellGroup(grp, kit); });
          setGroup(g, item.p, item.x, item.y);
          return;
        case 'kettlebell':
          g = movers.sub('kettlebell', function (grp) { kettlebellGroup(grp, kit); });
          // 손잡이 축은 손, 몸통은 아래로
          setGroup(g, item.p, item.x, [0, 1, 0]);
          return;
        case 'dHandle':
          g = movers.sub('dHandle', function (grp) { handleGroup(grp, kit); });
          setGroup(g, item.p, item.x, item.y);
          return;
        case 'plate':
          g = movers.sub('heldPlate', function (grp) {
            var p = new THREE.Mesh(kit.cylinder, kit.plate);
            p.rotation.x = Math.PI / 2;
            p.scale.set(0.16, 0.035, 0.16);
            p.castShadow = true;
            grp.add(p);
          });
          setGroup(g, item.p, item.x, item.y);
          return;
        case 'cableLine': {
          var line = movers.take('cableLine', function () {
            var m = new THREE.Mesh(kit.cylinder, kit.cable);
            m.matrixAutoUpdate = false;
            m.castShadow = false;
            movers.group.add(m);
            return m;
          });
          place(line, item.p, item.y, item.x, 0.004, item.size[1], 0.004);
          return;
        }
        default: {
          // 붙은 패드 · 회전 팔
          var key = item.kind + ':' + item.size.join(',');
          var part = movers.take(key, function () {
            var geometry;
            var mat;
            if (item.kind === 'roller') { geometry = kit.cylinder; mat = kit.pad; }
            else if (item.kind === 'pad') { geometry = roundedBox(item.size[0], item.size[1], item.size[2], 0.025); mat = kit.pad; }
            else if (item.kind === 'bar') { geometry = kit.cylinder; mat = kit.steel; }
            else { geometry = kit.box1; mat = kit.dark; }
            var m = new THREE.Mesh(geometry, mat);
            m.matrixAutoUpdate = false;
            m.castShadow = true;
            movers.group.add(m);
            return m;
          });
          if (item.kind === 'roller' || item.kind === 'bar') place(part, item.p, mul3(item.y, -1), item.x, item.size[0], item.size[1], item.size[0]);
          else if (item.kind === 'pad') place(part, item.p, item.x, item.y, 1, 1, 1);
          else place(part, item.p, item.x, item.y, item.size[0], item.size[1], item.size[2]);
        }
      }
    });

    // 로프 · V 손잡이 — 케이블 끝에서 두 손으로
    if (clip.bar && (clip.bar.kind === 'rope' || clip.bar.kind === 'vbar')) {
      var mid = mul3(add3(hands.L.grip, hands.R.grip), 0.5);
      var lift = clip.bar.kind === 'rope' ? 0.09 : 0.05;
      var knot = add3(mid, mul3(norm3(sub3(mid, add3(frame.solved.bones.chest.a, [0, 0, 0]))), lift));
      ['L', 'R'].forEach(function (s) {
        var end = hands[s].grip;
        var along = sub3(end, knot);
        var length = len3(along);
        var seg = movers.take('rope', function () {
          var m = new THREE.Mesh(kit.cylinder, clip.bar.kind === 'rope' ? kit.plate : kit.steel);
          m.matrixAutoUpdate = false;
          m.castShadow = true;
          movers.group.add(m);
          return m;
        });
        var dir = norm3(along);
        var ortho = Math.abs(dir[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
        place(seg, mul3(add3(knot, end), 0.5), cross3(dir, ortho), dir, clip.bar.kind === 'rope' ? 0.014 : 0.012, length, clip.bar.kind === 'rope' ? 0.014 : 0.012);
      });
    }
  }

  /* ── 카메라 · 손 조작 ─────────────────────────── */

  var VIEWS = { front: [0, 10], side: [90, 8], diag: [38, 14], back: [180, 12] };

  function mount(canvas, clip, options) {
    options = options || {};
    if (typeof THREE === 'undefined') return null;
    tmpX = new THREE.Vector3();
    tmpY = new THREE.Vector3();
    tmpZ = new THREE.Vector3();

    var colors = options.dark ? PALETTE.dark : PALETTE.light;
    var renderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: false });
    } catch (err) {
      return null;
    }
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    if (THREE.sRGBEncoding) renderer.outputEncoding = THREE.sRGBEncoding;

    var scene = new THREE.Scene();
    scene.background = colorOf(colors.bg);
    scene.fog = new THREE.Fog(colorOf(colors.bg).getHex(), 7, 16);

    var camera = new THREE.PerspectiveCamera(30, 1, 0.05, 40);

    var hemi = new THREE.HemisphereLight(0xffffff, colorOf(colors.floor).getHex(), options.dark ? 0.55 : 0.75);
    scene.add(hemi);
    var key = new THREE.DirectionalLight(0xffffff, options.dark ? 0.75 : 0.85);
    key.position.set(2.2, 4.5, 3.2);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.left = -2.4;
    key.shadow.camera.right = 2.4;
    key.shadow.camera.top = 2.4;
    key.shadow.camera.bottom = -2.4;
    key.shadow.camera.near = 0.5;
    key.shadow.camera.far = 12;
    key.shadow.bias = -0.0006;
    key.shadow.normalBias = 0.02;
    scene.add(key);
    scene.add(key.target);
    var rim = new THREE.DirectionalLight(0xffffff, options.dark ? 0.35 : 0.3);
    rim.position.set(-3, 2.5, -3);
    scene.add(rim);

    // 바닥 — 은은한 격자. 걷는 동작이면 격자가 뒤로 흐른다
    var floor = new THREE.Mesh(new THREE.PlaneGeometry(14, 14), material(colors.floor, { roughness: 1 }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);
    var gridGeometry = new THREE.BufferGeometry();
    var gridPoints = [];
    for (var g = -6; g <= 6; g += 0.5) {
      gridPoints.push(g, 0.001, -6, g, 0.001, 6);
      gridPoints.push(-6, 0.001, g, 6, 0.001, g);
    }
    gridGeometry.setAttribute('position', new THREE.Float32BufferAttribute(gridPoints, 3));
    var grid = new THREE.LineSegments(gridGeometry, new THREE.LineBasicMaterial({ color: colorOf(colors.grid), transparent: true, opacity: 0.7 }));
    scene.add(grid);

    var body = buildBody(scene, colors);
    var kit = buildKit(colors);
    var sceneGroup = new THREE.Group();
    scene.add(sceneGroup);
    var movingGroup = new THREE.Group();
    scene.add(movingGroup);
    var movers = movingKit(movingGroup, kit);
    movers.group = movingGroup;

    var weights = muscleWeights(options.contribution, options.pattern);
    var state = {
      t: 0, playing: true, speed: 1, last: performance.now(), frame: 0,
      clip: null, fault: false, yaw: 0, pitch: 10, zoom: 1, target: [0, 0.9, 0], points: [],
      dragging: null, pointers: {}, pinch: 0, disposed: false,
    };

    function setClip(next, fault) {
      state.clip = next;
      state.fault = Boolean(fault);
      while (sceneGroup.children.length) sceneGroup.remove(sceneGroup.children[0]);
      next.scene.forEach(function (prim) { buildPrim(sceneGroup, kit, prim); });
      state.points = E.clipPoints(next);
      var bounds = E.clipBounds(next);
      state.target = [
        (bounds.min[0] + bounds.max[0]) / 2,
        (bounds.min[1] + bounds.max[1]) / 2,
        (bounds.min[2] + bounds.max[2]) / 2,
      ];
      key.target.position.set(state.target[0], 0, state.target[2]);
      key.position.set(state.target[0] + 2.2, 4.5, state.target[2] + 3.2);
    }

    function setView(name) {
      var view = name && VIEWS[name] ? VIEWS[name] : state.clip.view;
      state.yaw = view[0];
      state.pitch = view[1];
      state.zoom = 1;
    }

    /**
     * 한 주기 동안의 몸 · 기구가 화면에 꽉 차게 — 보는 방향에서 투영한 범위로 거리를 정한다.
     */
    function placeCamera() {
      var rect = canvas.getBoundingClientRect();
      var aspect = Math.max(0.3, rect.width / Math.max(1, rect.height));
      var tanH = Math.tan((camera.fov * Math.PI / 180) / 2);
      var tanW = tanH * aspect;
      var yaw = state.yaw * Math.PI / 180;
      var pitch = state.pitch * Math.PI / 180;
      var back = [Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)];
      var fwd = mul3(back, -1);
      var right = norm3(cross3(fwd, [0, 1, 0]));
      var up = cross3(right, fwd);
      var c = state.target;
      var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      state.points.forEach(function (p) {
        var d = sub3(p, c);
        var x = dot3(d, right);
        var y = dot3(d, up);
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      });
      var center = add3(add3(c, mul3(right, (minX + maxX) / 2)), mul3(up, (minY + maxY) / 2));
      var dist = 0;
      state.points.forEach(function (p) {
        var d = sub3(p, center);
        var x = Math.abs(dot3(d, right));
        var y = Math.abs(dot3(d, up));
        var z = dot3(d, fwd);
        dist = Math.max(dist, x / tanW - z, y / tanH - z);
      });
      dist = Math.max(1.2, dist * 1.08) * state.zoom;
      camera.position.set(center[0] + back[0] * dist, center[1] + back[1] * dist, center[2] + back[2] * dist);
      camera.lookAt(center[0], center[1], center[2]);
    }

    function resize() {
      var rect = canvas.getBoundingClientRect();
      var width = Math.max(1, rect.width);
      var height = Math.max(1, rect.height);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    }

    function draw() {
      var frame = E.clipFrame(state.clip, state.t);
      poseBody(body, frame.solved.bones);
      paintMuscles(body, colors, weights, frame.effort, state.fault);
      drawMoving(movers, kit, state.clip, frame);
      if (state.clip.walk) grid.position.z = -((state.t * state.clip.walk) % 0.5);
      else grid.position.z = 0;
      placeCamera();
      renderer.render(scene, camera);
      return frame;
    }

    function tick(now) {
      if (state.disposed) return;
      state.frame = requestAnimationFrame(tick);
      var delta = Math.min(0.05, (now - state.last) / 1000);
      state.last = now;
      if (state.playing) state.t = (state.t + (delta / state.clip.cycle) * state.speed) % 1;
      var frame = draw();
      if (options.onProgress) options.onProgress(state.t, frame.label, frame.effort);
    }

    // 끌어서 돌려 보기 · 두 손가락으로 확대
    function onDown(event) {
      state.pointers[event.pointerId] = [event.clientX, event.clientY];
      try { canvas.setPointerCapture(event.pointerId); } catch (err) { void err; }
      var ids = Object.keys(state.pointers);
      if (ids.length === 2) {
        var a = state.pointers[ids[0]];
        var b = state.pointers[ids[1]];
        state.pinch = Math.hypot(a[0] - b[0], a[1] - b[1]);
      }
      if (options.onTouch) options.onTouch();
    }
    function onMove(event) {
      var prev = state.pointers[event.pointerId];
      if (!prev) return;
      var ids = Object.keys(state.pointers);
      state.pointers[event.pointerId] = [event.clientX, event.clientY];
      if (ids.length === 2) {
        var a = state.pointers[ids[0]];
        var b = state.pointers[ids[1]];
        var d = Math.hypot(a[0] - b[0], a[1] - b[1]);
        if (state.pinch > 0) state.zoom = Math.max(0.55, Math.min(1.7, state.zoom * (state.pinch / d)));
        state.pinch = d;
        return;
      }
      state.yaw -= (event.clientX - prev[0]) * 0.45;
      state.pitch = Math.max(-4, Math.min(70, state.pitch + (event.clientY - prev[1]) * 0.3));
      event.preventDefault();
    }
    function onUp(event) {
      delete state.pointers[event.pointerId];
      state.pinch = 0;
    }
    function onWheel(event) {
      state.zoom = Math.max(0.55, Math.min(1.7, state.zoom * (event.deltaY > 0 ? 1.08 : 0.93)));
      event.preventDefault();
    }
    canvas.style.touchAction = 'none';
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });

    setClip(clip, options.fault);
    setView(null);
    resize();
    state.frame = requestAnimationFrame(tick);
    window.addEventListener('resize', resize);

    return {
      /** 입체로 그리는 중인지 (WebGL을 못 열면 평면으로 돈다) */
      three: true,
      play: function () { state.playing = true; },
      pause: function () { state.playing = false; },
      toggle: function () { state.playing = !state.playing; return state.playing; },
      isPlaying: function () { return state.playing; },
      setSpeed: function (value) { state.speed = value; },
      seek: function (t) { state.t = t; draw(); },
      setClip: function (next, fault) { setClip(next, fault); state.t = 0; },
      view: function (name) { setView(name); },
      /** 보는 각도를 숫자로 (수평 각, 내려다보는 각) */
      setYaw: function (yaw, pitch) { state.yaw = yaw; state.pitch = pitch; },
      /** 화면 확인용 — 지금 프레임을 바로 그린다 */
      render: function () { resize(); draw(); },
      dispose: function () {
        state.disposed = true;
        cancelAnimationFrame(state.frame);
        window.removeEventListener('resize', resize);
        canvas.removeEventListener('pointerdown', onDown);
        canvas.removeEventListener('pointermove', onMove);
        canvas.removeEventListener('pointerup', onUp);
        canvas.removeEventListener('pointercancel', onUp);
        canvas.removeEventListener('wheel', onWheel);
        // 그래픽 문맥을 브라우저에 돌려준다 — dispose만 하면 문맥이 남아, 폰에서 몇 번 열고 닫으면
        // 개수 한도에 걸려 가장 오래된 3D 그림부터 꺼진다
        renderer.dispose();
        if (renderer.forceContextLoss) renderer.forceContextLoss();
      },
    };
  }

  /* ── 평면 대체 ───────────────────────────────── */

  /**
   * three.js를 못 받아온 곳에서도 같은 뼈를 선으로 그린다. 시점은 Clip이 고른 쪽에서 본 투영이다.
   */
  function mount2d(canvas, clip, options) {
    options = options || {};
    var ctx = canvas.getContext('2d');
    if (!ctx) return null;
    var colors = options.dark ? PALETTE.dark : PALETTE.light;
    var hex = function (n) { return '#' + ('000000' + n.toString(16)).slice(-6); };
    var state = { t: 0, playing: true, speed: 1, last: performance.now(), frame: 0, clip: clip, fault: Boolean(options.fault), yaw: clip.view[0], disposed: false };
    var weights = muscleWeights(options.contribution, options.pattern);
    void weights;

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
      ctx.fillStyle = hex(colors.bg);
      ctx.fillRect(0, 0, width, height);

      var bounds = E.clipBounds(state.clip);
      var yaw = state.yaw * Math.PI / 180;
      var right = [Math.cos(yaw), 0, -Math.sin(yaw)];
      var center = [(bounds.min[0] + bounds.max[0]) / 2, (bounds.min[1] + bounds.max[1]) / 2, (bounds.min[2] + bounds.max[2]) / 2];
      var span = Math.max(bounds.max[1] - bounds.min[1], len3(sub3(bounds.max, bounds.min)) * 0.75);
      var unit = Math.min(height, width) / (span * 1.15);
      var project = function (p) {
        var d = sub3(p, center);
        return [width / 2 + dot3(d, right) * unit, height / 2 - d[1] * unit];
      };

      // 바닥
      var floorY = project([center[0], 0, center[2]])[1];
      ctx.strokeStyle = hex(colors.grid);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, floorY);
      ctx.lineTo(width, floorY);
      ctx.stroke();

      var frame = E.clipFrame(state.clip, state.t);
      var bones = frame.solved.bones;
      var line = function (a, b, w, color) {
        var p = project(a);
        var q = project(b);
        ctx.strokeStyle = color;
        ctx.lineWidth = w;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(p[0], p[1]);
        ctx.lineTo(q[0], q[1]);
        ctx.stroke();
      };

      // 고정 기구 — 가운데를 지나는 선으로
      state.clip.scene.forEach(function (prim) {
        if (prim.kind === 'mat') return;
        var y = prim.y || [0, 1, 0];
        var x = prim.x || [1, 0, 0];
        var s = prim.size;
        var long = s.length === 2 ? mul3(x, s[1] / 2) : (s[1] >= s[2] && s[1] >= s[0] ? mul3(y, s[1] / 2) : s[2] >= s[0] ? mul3(cross3(x, y), s[2] / 2) : mul3(x, s[0] / 2));
        line(sub3(prim.p, long), add3(prim.p, long), prim.kind === 'pad' ? 8 : 4, hex(prim.kind === 'pad' ? colors.pad : colors.dark));
      });

      var skin = hex(colors.skin);
      var deep = hex(state.fault ? colors.fault : colors.accent);
      var order = ['thighR', 'shinR', 'footR', 'upperArmR', 'forearmR', 'handR', 'pelvis', 'lumbar', 'chest', 'neck', 'thighL', 'shinL', 'footL', 'upperArmL', 'forearmL', 'handL'];
      order.forEach(function (name) {
        var bone = bones[name];
        var thick = name === 'chest' || name === 'lumbar' ? 26 : name === 'pelvis' ? 24 : /thigh/.test(name) ? 14 : /shin|upperArm/.test(name) ? 10 : 8;
        line(bone.a, bone.b, thick * unit / 160, /R$/.test(name) ? hex(colors.muscle) : skin);
        // 평면 그림에도 반바지 — 골반과 허벅지 위쪽 2/3를 바지 색으로(맨살 막대 인형으로 보이지 않게)
        if (name === 'pelvis') line(bone.a, bone.b, (thick + 4) * unit / 160, hex(colors.shorts));
        if (/thigh/.test(name)) line(bone.a, add3(bone.a, mul3(sub3(bone.b, bone.a), 0.62)), (thick + 3) * unit / 160, hex(colors.shorts));
      });
      var head = project(add3(bones.head.a, mul3(norm3(sub3(bones.head.b, bones.head.a)), 0.09)));
      ctx.fillStyle = skin;
      ctx.beginPath();
      ctx.arc(head[0], head[1], 0.1 * unit, 0, Math.PI * 2);
      ctx.fill();

      frame.moving.forEach(function (item) {
        if (item.kind === 'cableLine') {
          line(sub3(item.p, mul3(item.x, item.size[1] / 2)), add3(item.p, mul3(item.x, item.size[1] / 2)), 1.5, hex(colors.cable));
        } else if (item.kind === 'barbell' || item.kind === 'smith' || item.kind === 'ez') {
          var c = project(item.p);
          ctx.fillStyle = hex(colors.plate);
          ctx.beginPath();
          ctx.arc(c[0], c[1], (item.kind === 'ez' ? 0.14 : (item.size[2] || 0.225)) * unit, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = deep;
          ctx.beginPath();
          ctx.arc(c[0], c[1], 0.03 * unit, 0, Math.PI * 2);
          ctx.fill();
        } else if (item.kind === 'dumbbell' || item.kind === 'kettlebell') {
          var d = project(item.p);
          ctx.fillStyle = hex(colors.plate);
          ctx.beginPath();
          ctx.arc(d[0], d[1], 0.06 * unit, 0, Math.PI * 2);
          ctx.fill();
        }
      });
      return frame;
    }

    function tick(now) {
      if (state.disposed) return;
      state.frame = requestAnimationFrame(tick);
      var delta = Math.min(0.05, (now - state.last) / 1000);
      state.last = now;
      if (state.playing) state.t = (state.t + (delta / state.clip.cycle) * state.speed) % 1;
      var frame = draw();
      if (options.onProgress) options.onProgress(state.t, frame.label, frame.effort);
    }

    state.frame = requestAnimationFrame(tick);
    return {
      three: false,
      play: function () { state.playing = true; },
      pause: function () { state.playing = false; },
      toggle: function () { state.playing = !state.playing; return state.playing; },
      isPlaying: function () { return state.playing; },
      setSpeed: function (value) { state.speed = value; },
      seek: function (t) { state.t = t; draw(); },
      setClip: function (next, fault) { state.clip = next; state.fault = Boolean(fault); state.t = 0; },
      view: function (name) { state.yaw = name && VIEWS[name] ? VIEWS[name][0] : state.clip.view[0]; },
      render: function () { draw(); },
      dispose: function () { state.disposed = true; cancelAnimationFrame(state.frame); },
    };
  }

  window.FitDemo3D = {
    /** three.js가 있으면 입체로, 없으면 같은 뼈를 평면으로 그린다. */
    mount: function (canvas, clip, options) {
      var handle = typeof THREE !== 'undefined' ? mount(canvas, clip, options) : null;
      return handle || mount2d(canvas, clip, options);
    },
    available: function () { return true; },
    is3d: function () { return typeof THREE !== 'undefined'; },
  };
})();
