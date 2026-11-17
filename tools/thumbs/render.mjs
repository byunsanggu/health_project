/**
 * 운동 · 기구 3D 썸네일을 소스에서 구워 낸다.
 *
 *   node tools/thumbs/render.mjs                    전부 다시 굽기 → prototype/thumbs/{ex,eq}/
 *   node tools/thumbs/render.mjs --only lat-pulldown,eq:dumbbells
 *   node tools/thumbs/render.mjs --sheets <폴더>     굽지 않고 모아 보기 장(PNG, 밝은/어두운)만
 *
 * 그림은 전부 우리 것이다 — prototype/demo3d.js 의 마네킹과 src/engine/motions*.ts 의 기구 장면을
 * 그대로 띄워 한 장면을 찍는다. 바깥 그림 · 모델은 쓰지 않는다.
 * 배경은 투명(바닥은 그림자만) — 앱이 밝은/어두운 바탕 칸 위에 올린다.
 * 같은 기계 · 같은 소스면 같은 파일이 나온다(소프트웨어 렌더러, 시간 · 난수 없음).
 */
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { build } from 'esbuild';
import { chromium } from '../../prototype/e2e/lib.mjs';
import { EX, EQ } from './overrides.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = path.join(ROOT, 'prototype/thumbs');
const SMALL = 160;
const LARGE = 420;
const QUALITY = 0.72;
/** 앱이 그림 밑에 까는 바탕(index.template.html 의 --thumb-bg 와 같다) */
const TILE = { light: '#eceef5', dark: '#a3a9ba' };

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? (args[i + 1] ?? '') : null; };
const only = flag('--only') ? new Set(flag('--only').split(',')) : null;
const sheetsDir = flag('--sheets');
const sheetsOnly = sheetsDir !== null && !args.includes('--render') && !only;

const engine = (await build({ entryPoints: [path.join(ROOT, 'src/engine/index.ts')], bundle: true, format: 'iife', globalName: 'FitEngine', target: 'es2022', write: false })).outputFiles[0].text;
const three = await readFile(path.join(ROOT, 'prototype/vendor/three.min.js'), 'utf8');
const demo3d = await readFile(path.join(ROOT, 'prototype/demo3d.js'), 'utf8');

const browser = await (await chromium()).launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const context = await browser.newContext({ viewport: { width: 1000, height: 1000 }, deviceScaleFactor: 1 });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.setContent('<!doctype html><html><body style="margin:0"></body></html>');
await page.addScriptTag({ content: three });
await page.addScriptTag({ content: engine });
await page.addScriptTag({ content: demo3d });

/* 렌더러를 투명 바탕으로 열고, demo3d 가 그릴 때 쓰는 장면 · 카메라를 붙잡아 둔다 — demo3d.js 는 건드리지 않는다 */
await page.evaluate(() => {
  const Orig = THREE.WebGLRenderer;
  window.__cap = {};
  THREE.WebGLRenderer = function (params) {
    const r = new Orig(Object.assign({}, params, { alpha: true, preserveDrawingBuffer: true, premultipliedAlpha: false }));
    const render = r.render.bind(r);
    r.render = function (scene, camera) { window.__cap = { renderer: r, scene, camera, render }; render(scene, camera); };
    return r;
  };
});

const ids = await page.evaluate(() => ({
  ex: FitEngine.EXERCISES.map((e) => e.id),
  eq: FitEngine.EQUIPMENT_CATALOG.map((i) => ({ id: i.id, uses: FitEngine.exercisesUsing(i.id) })),
}));

const jobs = [];
for (const id of ids.ex) jobs.push({ key: id, dir: 'ex', id, kind: 'ex', ...(EX[id] || {}) });
for (const item of ids.eq) {
  const o = EQ[item.id] || {};
  const src = o.cardio ? { kind: 'cardio', id: o.cardio } : o.st ? { kind: 'st', id: o.st } : { kind: 'ex', id: o.ex || item.uses[0] };
  if (!src.id) throw new Error(`기구 ${item.id}: 대표 동작이 없습니다 — overrides.mjs 의 EQ 에 ex/st 를 적어 주세요`);
  // 같은 운동의 손질(각도 등)은 기구 그림에도 이어받는다. 기구 그림은 근육 색을 빼 기구가 먼저 보이게 한다
  jobs.push({ key: 'eq:' + item.id, dir: 'eq', out: item.id, plain: true, ...(src.kind === 'ex' ? EX[src.id] || {} : {}), ...o, ...src });
}

async function renderJob(job) {
  return page.evaluate(async ({ job, SMALL, LARGE, QUALITY }) => {
    const E = window.FitEngine;
    let clip, opts;
    if (job.kind === 'st') { clip = E.stretchMotionFor(job.id, 'L'); opts = {}; }
    else if (job.kind === 'cardio') { clip = E.cardioMotionFor(job.id); opts = {}; }
    else {
      const ex = E.exerciseById(job.id);
      if (!ex) return { error: 'no exercise ' + job.id };
      clip = E.motionFor(ex);
      opts = { contribution: job.plain ? {} : ex.contribution, pattern: ex.pattern };
      if (job.plain) clip = Object.assign({}, clip, { highlight: undefined });
    }
    if (!clip) return { error: 'no clip' };

    const bonePts = (t) => {
      const b = E.clipFrame(clip, t).solved.bones; const out = [];
      Object.keys(b).forEach((k) => { out.push(b[k].a, b[k].b); });
      return out;
    };
    // 가장 알아보기 쉬운 순간 — 시작 자세에서 관절이 가장 멀리 간 때(대개 반환점)
    let t = job.t;
    if (t == null) {
      const p0 = bonePts(0); let best = 0; t = 0.5;
      for (let i = 1; i < 50; i += 1) {
        const p = bonePts(i / 50); let d = 0;
        for (let j = 0; j < p.length; j += 1) d += Math.hypot(p[j][0] - p0[j][0], p[j][1] - p0[j][1], p[j][2] - p0[j][2]);
        if (d > best + 1e-6) { best = d; t = i / 50; }
      }
      if (best < 0.08) t = 0.5;
    }
    const view = job.view || [clip.view[0], Math.max(12, clip.view[1])];

    const c = document.createElement('canvas');
    c.style.cssText = 'position:fixed;left:0;top:0;width:480px;height:480px;display:block';
    document.body.appendChild(c);
    const h = window.FitDemo3D.mount(c, clip, opts);
    if (!h || !h.three) return { error: 'no 3d' };
    h.pause(); h.setYaw(view[0], view[1]); h.seek(t); h.render();
    const { renderer, scene, render } = window.__cap;
    const frame = E.clipFrame(clip, t);

    scene.background = null; scene.fog = null;
    renderer.setClearColor(0x000000, 0);
    let floor = null;
    scene.children.forEach((m) => { if (m.isMesh && /^Plane/.test(m.geometry.type)) floor = m; });
    if (floor) floor.material = new THREE.ShadowMaterial({ opacity: 0.2 });
    const moving = scene.children[scene.children.length - 1];
    // 마네킹 조각(몸 · 근육)은 장면 바로 밑에 놓인 메시다 — 기구는 무리(group) 안에 있거나 아래에서 새로 얹는다
    const bodyMeshes = new Set(scene.children.filter((m) => m.isMesh && m !== floor));
    // 일하는 근육 색을 작은 그림에서도 보이게 조금 더 진하게 (색은 demo3d 의 인디고 그대로)
    scene.traverse((m) => {
      const mt = m.isMesh && m.material;
      if (mt && mt.emissive && mt.emissive.getHex() !== 0 && mt.emissiveIntensity > 0.02) { mt.color.lerp(mt.emissive, 0.45); mt.emissiveIntensity = Math.min(0.5, mt.emissiveIntensity * 1.5); }
    });

    // 동작에 없는 기구 — 직접 만든 도형을 얹는다
    const hands = { L: frame.solved.hands.L.grip, R: frame.solved.hands.R.grip };
    const mid = [(hands.L[0] + hands.R[0]) / 2, (hands.L[1] + hands.R[1]) / 2, (hands.L[2] + hands.R[2]) / 2];
    if (job.extra === 'ball') {
      moving.visible = false;
      const ball = new THREE.Mesh(new THREE.SphereGeometry(0.15, 32, 20), new THREE.MeshStandardMaterial({ color: 0x3a3f4b, roughness: 0.85 }));
      ball.position.set(mid[0], mid[1] - 0.02, mid[2] + 0.06); ball.castShadow = true; scene.add(ball);
      const band = new THREE.Mesh(new THREE.TorusGeometry(0.151, 0.012, 8, 40), new THREE.MeshStandardMaterial({ color: 0x4a43d6, roughness: 0.6 }));
      band.position.copy(ball.position); band.rotation.x = Math.PI / 2.4; scene.add(band);
    }
    if (job.extra === 'rope') {
      moving.visible = false;
      const mat = new THREE.MeshStandardMaterial({ color: 0x2c2f37, roughness: 0.95 });
      ['L', 'R'].forEach((s, i) => {
        const a = hands[s]; const pts = [];
        for (let k = 0; k <= 40; k += 1) {
          const u = k / 40; const z = a[2] + u * 2.6;
          const wave = Math.sin(u * Math.PI * 3 + (i ? Math.PI : 0)) * 0.16 * (1 - u) * Math.min(1, u * 5);
          pts.push(new THREE.Vector3(a[0] * (1 - u) + (i ? -0.05 : 0.05) * u, Math.max(0.035, a[1] * (1 - u) * (1 - u) + 0.035 + wave), z));
        }
        const rope = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 80, 0.03, 10, false), mat);
        rope.castShadow = true; scene.add(rope);
      });
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 0.3, 16), new THREE.MeshStandardMaterial({ color: 0x4c5363 }));
      post.position.set(0, 0.15, mid[2] + 2.6); post.castShadow = true; scene.add(post);
    }

    // 랙 · 스미스 — 둘 다 키 큰 쇠 틀이라 작은 그림에서 헷갈린다. 다른 곳을 직접 만든 도형으로 또렷하게
    // demo3d 의 쇠 색과 같게 (그쪽처럼 sRGB 색을 선형으로 바꿔 넣는다)
    const lin = (hex) => { const c = new THREE.Color(hex); return c.convertSRGBToLinear ? c.convertSRGBToLinear() : c; };
    const darkMat = new THREE.MeshStandardMaterial({ color: lin(0x2a2e37), roughness: 0.55, metalness: 0.35 });
    const steelMat = new THREE.MeshStandardMaterial({ color: lin(0xb4bbc5), roughness: 0.35, metalness: 0.75 });
    const box = (size, at, mat) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(size[0], size[1], size[2]), mat || darkMat);
      m.position.set(at[0], at[1], at[2]); m.castShadow = true; scene.add(m); return m;
    };
    const rod = (r, a, b, mat) => {
      const A = new THREE.Vector3(a[0], a[1], a[2]); const B = new THREE.Vector3(b[0], b[1], b[2]);
      const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, A.distanceTo(B), 16), mat || steelMat);
      m.position.copy(A).add(B).multiplyScalar(0.5);
      m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize());
      m.castShadow = true; scene.add(m); return m;
    };
    const barItem = frame.moving.find((m) => m.kind === 'smith' || m.kind === 'barbell');
    if (job.extra === 'rack' && barItem) {
      // 열린 우리 모양 — 기둥 넷, 위 · 바닥 틀, 앞 기둥의 J후크, 양옆 안전바. 바는 레일 없이 어깨 위에 얹힌 그대로
      const half = 0.62; const back = -0.55; const front = 0.6; const top = 2.2;
      [half, -half].forEach((x) => {
        box([0.07, top, 0.07], [x, top / 2, front]);
        box([0.07, 0.07, front - back + 0.07], [x, top, (front + back) / 2]);
        box([0.07, 0.05, front - back + 0.3], [x, 0.025, (front + back) / 2]);
        // 안전바 — 앞뒤 기둥을 잇는 긴 쇠 팔 (무릎 높이)
        box([0.06, 0.06, front - back + 0.18], [x * 0.94, 0.62, (front + back) / 2], steelMat);
        // J후크 — 앞 기둥 안쪽에 붙은 받침과 위로 꺾인 끝 (어깨 높이)
        const s = Math.sign(x);
        box([0.06, 0.07, 0.16], [x - s * 0.02, 1.32, front - 0.11]);
        box([0.06, 0.1, 0.03], [x - s * 0.02, 1.38, front - 0.18]);
        // 구멍 줄 — 기둥 앞면의 높이 맞추는 구멍
        for (let y = 0.5; y < 1.9; y += 0.12) box([0.03, 0.025, 0.01], [x, y, front - 0.04], steelMat);
      });
      box([half * 2 + 0.07, 0.07, 0.07], [0, top, front]);
    }
    if (job.extra === 'smith' && barItem) {
      // 바가 세운 레일 두 개에 꿰여 위아래로만 다닌다 — 바 양 끝(손과 원판 사이)에 미끄럼통과 걸쇠, J컵은 없다
      const c = barItem.p; const zr = c[2];
      [0.6, -0.6].forEach((x) => {
        rod(0.022, [x, 0.02, zr], [x, 2.16, zr]);
        box([0.09, 0.03, 0.09], [x, 0.03, zr]);
        box([0.09, 0.04, 0.09], [x, 2.16, zr]);
        // 미끄럼통 — 바를 감싸고 레일을 탄다
        box([0.085, 0.2, 0.085], [x, c[1], zr]);
        // 걸쇠 — 손목을 돌려 거는 고리 (통 뒤로 비스듬히)
        const hook = box([0.025, 0.12, 0.05], [x + Math.sign(x) * 0.0, c[1] - 0.07, zr - 0.07], steelMat);
        hook.rotation.x = -0.6;
        // 레일 옆 기둥에 줄지은 거는 자리
        const px = Math.sign(x) * 0.78;
        for (let y = 0.45; y < 1.95; y += 0.15) box([0.06, 0.025, 0.05], [px - Math.sign(x) * 0.05, y, zr - 0.02], steelMat);
        box([Math.abs(px - x), 0.05, 0.05], [(px + x) / 2, 2.16, zr]);
      });
    }

    // 꽉 차게 — 이 순간의 몸과 기구(메시 상자 모서리)를 보는 방향에서 투영해 거리를 정한다
    scene.updateMatrixWorld(true);
    const all = []; const v = new THREE.Vector3();
    scene.traverse((m) => {
      if (!m.isMesh || m === floor) return;
      for (let p = m; p; p = p.parent) if (!p.visible) return;
      if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
      const bb = m.geometry.boundingBox;
      for (let i = 0; i < 8; i += 1) {
        v.set(i & 1 ? bb.max.x : bb.min.x, i & 2 ? bb.max.y : bb.min.y, i & 4 ? bb.max.z : bb.min.z).applyMatrix4(m.matrixWorld);
        all.push([v.x, Math.max(0, v.y), v.z]);
      }
    });
    const body = [];
    bonePts(t).forEach((p) => { for (let i = 0; i < 8; i += 1) body.push([p[0] + (i & 1 ? 0.13 : -0.13), Math.max(0, p[1] + (i & 2 ? 0.13 : -0.13)), p[2] + (i & 4 ? 0.13 : -0.13)]); });

    const yaw = view[0] * Math.PI / 180; const pitch = view[1] * Math.PI / 180;
    const back = [Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)];
    const fwd = back.map((x) => -x);
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const nrm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return a.map((x) => x / l); };
    const right = nrm(cross(fwd, [0, 1, 0])); const up = cross(right, fwd);
    const FOV = 24; const tan = Math.tan(FOV * Math.PI / 360);
    const fit = (pts) => {
      let center = [0, 0, 0]; let dist = 3;
      pts.forEach((p) => { center = center.map((x, i) => x + p[i] / pts.length); });
      // 원근 때문에 한 번에 안 맞는다 — 화면에 비친 범위의 가운데로 몇 번 옮겨 맞춘다
      for (let it = 0; it < 12; it += 1) {
        let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
        pts.forEach((p) => {
          const d = [p[0] - center[0], p[1] - center[1], p[2] - center[2]];
          const z = dist + dot(d, fwd); const x = dot(d, right) / z; const y = dot(d, up) / z;
          if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
        });
        center = center.map((c0, i) => c0 + right[i] * ((x0 + x1) / 2) * dist + up[i] * ((y0 + y1) / 2) * dist);
        dist *= Math.max(x1 - x0, y1 - y0) / 2 / tan;
      }
      return { center, dist: dist * 1.06 };
    };
    const whole = fit(all.concat(body)); const near = fit(body);
    // 기구가 몸보다 훨씬 크면(케이블 타워 · 긴 매트) 몸이 점이 된다 — 몸 기준 거리의 limit 배까지만 물러난다
    const limit = 1.35 / (job.zoom || 1);
    let cam = whole;
    if (whole.dist > near.dist * limit) {
      const k = (near.dist * limit - near.dist) / (whole.dist - near.dist);
      cam = { dist: near.dist * limit, center: near.center.map((x, i) => x + (whole.center[i] - x) * k) };
    } else if (job.zoom) cam = { dist: whole.dist / job.zoom, center: whole.center };
    // 손에 든 작은 기구(덤벨 · 케틀벨 · 공)가 주인공일 때 — 손 쪽으로 당겨 찍는다
    if (job.focus === 'hands') cam = { dist: near.dist / (job.zoom || 1.25), center: near.center.map((x, i) => (x + mid[i]) / 2) };
    const camera = new THREE.PerspectiveCamera(FOV, 1, 0.05, 60);
    camera.position.set(cam.center[0] + back[0] * cam.dist, cam.center[1] + back[1] * cam.dist, cam.center[2] + back[2] * cam.dist);
    camera.lookAt(cam.center[0], cam.center[1], cam.center[2]);

    const BIG = LARGE * 2;
    renderer.setPixelRatio(1); renderer.setSize(BIG, BIG, false);
    render(scene, camera);
    const shrink = (src, size) => { const o = document.createElement('canvas'); o.width = size; o.height = size; const g = o.getContext('2d'); g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high'; g.drawImage(src, 0, 0, size, size); return o; };
    const large = shrink(c, LARGE);
    // 작은 그림(오늘 목록의 46px 칸)은 따로 한 번 더 — 일하는 근육을 더 진하게, 기구는 바탕 쪽으로 한 발 물린다.
    // 큰 그림은 위에서 이미 떴으니 그대로다. 기구 그림(plain)은 기구가 주인공이라 손대지 않는다
    if (!job.plain) {
      const hot = new THREE.Color(0x4436e8); if (hot.convertSRGBToLinear) hot.convertSRGBToLinear();
      const tile = new THREE.Color(0xb3b8c6); if (tile.convertSRGBToLinear) tile.convertSRGBToLinear();
      const seen = new Set();
      scene.traverse((m) => {
        const mt = m.isMesh && m !== floor && m.material;
        if (!mt || seen.has(mt)) return;
        seen.add(mt);
        if (bodyMeshes.has(m)) {
          if (mt.emissive && mt.emissive.getHex() !== 0 && mt.emissiveIntensity > 0.02) {
            mt.color.lerp(hot, 0.85); mt.emissiveIntensity = Math.min(1, mt.emissiveIntensity * 2.6);
            // 덩어리도 조금 키운다 — 46px에서 점이 아니라 면으로 보이게
            m.matrix.scale(new THREE.Vector3(1.15, 1.15, 1.15)); m.matrixWorldNeedsUpdate = true;
          }
        } else if (mt.color) mt.color.lerp(tile, 0.28);
      });
      render(scene, camera);
    }
    const small = shrink(shrink(c, SMALL * 2), SMALL);
    const res = { t, view, large: large.toDataURL('image/webp', QUALITY), small: small.toDataURL('image/webp', QUALITY), miss: frame.solved.miss || 0 };
    h.dispose(); c.remove();
    return res;
  }, { job, SMALL, LARGE, QUALITY });
}

const bytes = (url) => Buffer.from(url.split(',')[1], 'base64');
if (!sheetsOnly) {
  await mkdir(path.join(OUT, 'ex'), { recursive: true });
  await mkdir(path.join(OUT, 'eq'), { recursive: true });
  const todo = jobs.filter((j) => !only || only.has(j.key));
  const log = [];
  for (const job of todo) {
    const res = await renderJob(job);
    if (res.error) throw new Error(`${job.key}: ${res.error}`);
    const name = job.out || job.id;
    await writeFile(path.join(OUT, job.dir, `${name}.webp`), bytes(res.small));
    await writeFile(path.join(OUT, job.dir, `${name}@3x.webp`), bytes(res.large));
    log.push(`${job.key} t=${res.t} view=${res.view.join(',')}${job.dir === 'eq' ? ' src=' + job.id : ''}`);
  }
  console.log(log.join('\n'));
  console.log('rendered', todo.length, 'errors', JSON.stringify(errors));
}

/* 모아 보기 장 — 앱에서 보이는 크기(80px)와 큰 그림을 밝은/어두운 바탕에 나란히 */
if (sheetsDir !== null) {
  const dir = sheetsDir || path.join(ROOT, 'tools/thumbs/sheets');
  await mkdir(dir, { recursive: true });
  const sheet = await context.newPage();
  for (const group of ['ex', 'eq']) {
    const names = (await readdir(path.join(OUT, group))).filter((n) => n.endsWith('@3x.webp')).map((n) => n.replace('@3x.webp', ''))
      .filter((n) => !only || only.has(group === 'eq' ? 'eq:' + n : n)).sort();
    const cells = [];
    for (const n of names) {
      const big = (await readFile(path.join(OUT, group, `${n}@3x.webp`))).toString('base64');
      const small = (await readFile(path.join(OUT, group, `${n}.webp`))).toString('base64');
      cells.push({ n, big, small });
    }
    const PER = 40;
    for (const theme of ['light', 'dark']) {
      for (let i = 0; i * PER < cells.length; i += 1) {
        const part = cells.slice(i * PER, (i + 1) * PER);
        const fg = theme === 'dark' ? '#e8eaf0' : '#1b1e27';
        const html = `<html><body style="margin:0;font:11px sans-serif;color:${fg};background:${theme === 'dark' ? '#15181e' : '#ffffff'}"><div style="display:flex;flex-wrap:wrap;gap:6px;padding:6px;width:1616px">${part.map((c) => `<div style="width:196px"><div style="display:flex;gap:4px;align-items:flex-end"><img src="data:image/webp;base64,${c.big}" style="width:150px;height:150px;border-radius:14px;background:${TILE[theme]}"><img src="data:image/webp;base64,${c.small}" style="width:40px;height:40px;border-radius:8px;background:${TILE[theme]}"></div><div style="overflow:hidden;white-space:nowrap">${c.n}</div></div>`).join('')}</div></body></html>`;
        await sheet.setViewportSize({ width: 1628, height: 400 });
        await sheet.setContent(html);
        await sheet.waitForFunction(() => Array.from(document.images).every((im) => im.complete));
        const file = path.join(dir, `${group}-${theme}-${i + 1}.png`);
        await sheet.screenshot({ path: file, fullPage: true });
        console.log('sheet', file);
      }
    }
  }
}
await browser.close();
