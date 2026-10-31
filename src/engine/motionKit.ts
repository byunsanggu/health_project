/**
 * 시연 동작을 짓는 도구 — 장면(벤치 · 랙 · 케이블 · 기계), 발 디딤, 동작 한 주기 풀기.
 *
 * 종목 하나는 Clip 하나다. Clip은 키 자세 몇 개(주기 안의 시점 t에서의 자세)와 그 자리에 놓인
 * 기구로 이루어진다. 렌더러는 Clip을 모른다 — 매 프레임 clipFrame(clip, t)이 돌려주는 뼈 위치와
 * 기구 위치를 그리기만 한다. 그래서 동작이 맞는지는 엔진 테스트가 본다.
 */
import {
  ARM_REACH, BODY, LEG_REACH, STAND_HEIGHT, add, blend, cross, distance, madd, normalize, perpendicular, point, rotateAbout,
  scale, solvePose, sub, wrapCycle,
  type ArmSpec, type BoneName, type LegSpec, type Pose3, type Solved, type Vec3,
} from './rig.ts';

export { ARM_REACH, LEG_REACH, STAND_HEIGHT };

/* ── 기구 조각 ───────────────────────────────────── */

/**
 * 기구 조각.
 *   pad    — 쿠션 (둥근 상자)        frame — 쇠 틀 (각관)       box — 스텝 박스 · 받침
 *   roller — 발목 · 무릎 패드 (원통)   plate — 원판             bar — 쇠 봉
 *   mat    — 바닥 매트                pulley — 도르래           post — 세운 기둥
 * 상자류의 size는 [폭(x), 높이(y), 깊이(z)], 원통류는 [반지름, 길이] — 원통의 길이 방향이 x축이다.
 */
export type PrimKind = 'pad' | 'frame' | 'box' | 'roller' | 'plate' | 'bar' | 'mat' | 'pulley' | 'post';

export interface Prim {
  kind: PrimKind;
  p: Vec3;
  size: number[];
  x?: Vec3;
  y?: Vec3;
}

/** 손에 든 것 */
export type Implement = 'dumbbell' | 'kettlebell' | 'dHandle' | 'plate';

/**
 * 바 종류.
 *   barbell · ez · smith — 원판 낀 봉 (smith는 장면에 레일이 있다)
 *   trap   — 육각 바     landmine · tbar — 한쪽 끝이 바닥 축(pivot)에 꽂힌 봉
 *   cable  — 케이블 손잡이 봉(곧은 바)   lat — 랫풀다운 바   rope — 로프   vbar — V 손잡이
 *   wheel  — 앱 휠     dumbbell — 두 손으로 세워 든 덤벨 하나 (고블릿 스쿼트 등)   kettlebell — 두 손 케틀벨
 *   guide  — 그리지 않는 바. 두 손이 같이 움직이는 길만 정한다 (덤벨 두 개를 든 RDL 등)
 */
export type BarKind = 'barbell' | 'ez' | 'trap' | 'smith' | 'landmine' | 'tbar' | 'cable' | 'lat' | 'rope' | 'vbar' | 'wheel' | 'dumbbell' | 'kettlebell' | 'guide';

export interface ClipBar {
  kind: BarKind;
  /** 원판 반지름 (원판 없는 바는 0) */
  plates?: number;
  /** landmine · tbar — 바닥에 꽂힌 끝 */
  pivot?: Vec3;
}

/** 뼈에 붙어 같이 움직이는 기구 조각 (레그 익스텐션 패드 등) */
export interface Link {
  kind: PrimKind;
  /** 붙는 뼈. 두 개면 그 사이 가운데에 걸친다 (양 정강이에 걸친 패드) */
  bone: BoneName | [BoneName, BoneName];
  /** 뼈 길이 중 어디 (0 = 시작, 1 = 끝) */
  u: number;
  /** 뼈 틀 기준 비켜 놓기 [옆, 길이 방향, 앞] */
  off?: Vec3;
  size: number[];
  /** 있으면 이 점에서 조각까지 쇠 팔을 그린다 (기계의 회전 팔) */
  pivot?: Vec3;
  /** 쇠 팔이 조각의 가운데가 아니라 x축으로 이만큼 비킨 곳에 붙는다 (옆에 달린 팔) */
  leverAt?: number;
  /** 조각의 방향을 뼈를 따라 돌리지 않고 고정 (레일 위 발판). off도 이 축 기준 */
  fixed?: { x: Vec3; y: Vec3 };
  /** 조각은 그리지 않고 쇠 팔만 (손잡이는 손에 든 것으로 그린다) */
  hidden?: boolean;
}

export interface Cable {
  /** 줄이 시작하는 곳 — 도르래 자리, 또는 손(두 손 사이에 건 밴드) */
  from: Vec3 | 'L' | 'R';
  to: 'L' | 'R' | 'mid' | 'bar' | 'pelvis';
}

export interface Key {
  t: number;
  label?: string;
  pose: Pose3;
}

export interface Clip {
  id: string;
  /** 한 번 하는 데 걸리는 시간(초) */
  cycle: number;
  /** 처음 보는 쪽 [수평 각, 내려다보는 각]. 0 = 정면, 90 = 왼쪽 옆 */
  view: [number, number];
  keys: Key[];
  scene: Prim[];
  bar?: ClipBar;
  hold?: { L?: Implement; R?: Implement };
  cables?: Cable[];
  links?: Link[];
  /** 목표 근육이 짧아지며 힘을 쓰는 구간 — 이때 그 근육이 밝아진다 */
  work: [number, number];
  /** 한쪽씩 하는 종목에서 시연하는 쪽 */
  side?: 'L' | 'R';
  /** 걷는 동작 — 한 주기에 바닥이 뒤로 흐르는 거리(m) */
  walk?: number;
  /** 키 사이를 등속으로 (걷기 — 디딘 발이 바닥과 같은 빠르기로 뒤로 가야 미끄러지지 않는다) */
  linear?: boolean;
  /** 흔한 실수를 보여 주는 동작이면 그 실수 id */
  fault?: string;
}

/* ── 한 주기 풀기 ─────────────────────────────────── */

/** 양 끝을 부드럽게 — 실제 동작도 등속이 아니다. */
const ease = (s: number): number => s * s * (3 - 2 * s);

/** 주기 위치 t의 자세와 그 구간의 말. */
export function clipPose(clip: Clip, t: number): { pose: Pose3; label?: string } {
  const at = wrapCycle(t);
  const keys = clip.keys;
  let i = 0;
  while (i < keys.length - 2 && at > keys[i + 1]!.t) i += 1;
  const from = keys[i]!;
  const to = keys[i + 1] ?? from;
  const span = to.t - from.t;
  const s = span <= 0 ? 0 : Math.min(1, Math.max(0, (at - from.t) / span));
  let label: string | undefined;
  for (const key of keys) if (key.t <= at + 1e-9 && key.label) label = key.label;
  return { pose: blend(from.pose, to.pose, clip.linear ? s : ease(s)), label };
}

/** 근육이 일하는 정도 0~1 — work 구간에서 1, 밖에서는 0.3. 경계는 부드럽게. */
export function effortAt(clip: Clip, t: number): number {
  const at = wrapCycle(t);
  const [a, b] = clip.work;
  const inside = a <= b ? at >= a && at <= b : at >= a || at <= b;
  const edge = 0.06;
  const dist = (x: number, y: number) => Math.min(Math.abs(x - y), 1 - Math.abs(x - y));
  const near = Math.min(dist(at, a), dist(at, b));
  const soft = Math.min(1, near / edge);
  return inside ? 0.3 + 0.7 * soft : 0.3;
}

export interface Placed {
  kind: PrimKind | Implement | BarKind | 'cableLine';
  p: Vec3;
  size: number[];
  x: Vec3;
  y: Vec3;
}

export interface ClipFrame {
  solved: Solved;
  label?: string;
  effort: number;
  /** 움직이는 기구 — 바 · 손에 든 것 · 붙은 패드 · 케이블 줄 */
  moving: Placed[];
}

function boneFrame(b: { a: Vec3; b: Vec3; f: Vec3 }): { o: Vec3; x: Vec3; y: Vec3; z: Vec3; len: number } {
  const y = normalize(sub(b.b, b.a));
  const z = normalize(perpendicular(b.f, y), [0, 0, 1]);
  return { o: b.a, x: normalize(cross(y, z)), y, z, len: distance(b.a, b.b) };
}

function linkPoint(solved: Solved, bone: BoneName, u: number, off: Vec3): { p: Vec3; y: Vec3 } {
  const f = boneFrame(solved.bones[bone]);
  let p = madd(f.o, f.y, f.len * u);
  p = madd(p, f.x, off[0]);
  p = madd(p, f.y, off[1]);
  p = madd(p, f.z, off[2]);
  return { p, y: f.y };
}

/** 한 프레임 — 뼈와 움직이는 기구 위치. */
export function clipFrame(clip: Clip, t: number): ClipFrame {
  const { pose, label } = clipPose(clip, t);
  const solved = solvePose(pose);
  const moving: Placed[] = [];
  const up: Vec3 = [0, 1, 0];

  // 바 — 자세에 바가 없으면 두 손 사이에 (컬처럼 팔을 각도로 움직이는 동작)
  if (clip.bar && !solved.bar && !['rope', 'vbar', 'wheel', 'guide'].includes(clip.bar.kind)) {
    const l = solved.hands.L.grip;
    const r = solved.hands.R.grip;
    solved.bar = { c: scale(add(l, r), 0.5), x: normalize(sub(l, r), [1, 0, 0]) };
  }
  if (clip.bar && solved.bar && clip.bar.kind !== 'guide') {
    const { c, x } = solved.bar;
    const kind = clip.bar.kind;
    if ((kind === 'landmine' || kind === 'tbar') && clip.bar.pivot) {
      // 바닥 축에서 쥔 곳까지 — 쥔 곳 너머로 슬리브와 원판이 이어진다
      const along = normalize(sub(c, clip.bar.pivot));
      const len = distance(c, clip.bar.pivot) + 0.32;
      moving.push({ kind, p: madd(clip.bar.pivot, along, len / 2), size: [0.014, len, clip.bar.plates ?? 0.2], x: along, y: normalize(perpendicular(up, along), [0, 0, 1]) });
    } else {
      moving.push({ kind, p: c, size: [0.014, 0, clip.bar.plates ?? 0], x, y: normalize(perpendicular(up, x), [0, 0, 1]) });
    }
  }

  // 손에 든 것
  for (const side of ['L', 'R'] as const) {
    const held = clip.hold?.[side];
    if (!held) continue;
    const hand = solved.hands[side];
    moving.push({ kind: held, p: hand.grip, size: [], x: hand.axis, y: hand.palm });
  }

  // 붙은 패드
  for (const link of clip.links ?? []) {
    const off = link.off ?? [0, 0, 0];
    let p: Vec3;
    let x: Vec3;
    let y: Vec3;
    if (Array.isArray(link.bone)) {
      const left = linkPoint(solved, link.bone[0], link.u, off);
      const right = linkPoint(solved, link.bone[1], link.u, [-off[0], off[1], off[2]]);
      p = scale(add(left.p, right.p), 0.5);
      x = normalize(sub(left.p, right.p), [1, 0, 0]);
      y = normalize(perpendicular(left.y, x), [0, 1, 0]);
    } else if (link.fixed) {
      const at = linkPoint(solved, link.bone, link.u, [0, 0, 0]);
      x = normalize(link.fixed.x);
      y = normalize(perpendicular(link.fixed.y, x));
      const z = cross(x, y);
      p = madd(madd(madd(at.p, x, off[0]), y, off[1]), z, off[2]);
    } else {
      const at = linkPoint(solved, link.bone, link.u, off);
      p = at.p;
      y = at.y;
      x = normalize(cross(y, [0, 0, 1]), [1, 0, 0]);
    }
    if (link.pivot) {
      const end = link.leverAt ? madd(p, x, link.leverAt) : p;
      const arm = sub(end, link.pivot);
      const len = Math.sqrt(arm[0] * arm[0] + arm[1] * arm[1] + arm[2] * arm[2]);
      const along = normalize(arm);
      moving.push({ kind: 'frame', p: madd(link.pivot, along, len / 2), size: [0.05, len, 0.05], x: normalize(cross(along, [0, 0, 1]), [1, 0, 0]), y: along });
    }
    if (!link.hidden) moving.push({ kind: link.kind, p, size: link.size, x, y });
  }

  // 케이블 줄
  for (const cable of clip.cables ?? []) {
    const end = cable.to === 'L' ? solved.hands.L.grip
      : cable.to === 'R' ? solved.hands.R.grip
        : cable.to === 'bar' && solved.bar ? solved.bar.c
          : cable.to === 'pelvis' ? madd(solved.bones.pelvis.a, solved.bones.pelvis.f, 0.12)
            : scale(add(solved.hands.L.grip, solved.hands.R.grip), 0.5);
    const from = cable.from === 'L' || cable.from === 'R' ? solved.hands[cable.from].grip : cable.from;
    const along = normalize(sub(end, from));
    const len = distance(end, from);
    moving.push({ kind: 'cableLine', p: madd(from, along, len / 2), size: [0.004, len], x: along, y: normalize(perpendicular(up, along), [0, 0, 1]) });
  }

  return { solved, label, effort: effortAt(clip, t), moving };
}

/**
 * 한 주기 동안 몸과 움직이는 기구가 차지하는 점들 — 카메라를 맞추는 데 쓴다.
 * 랙 기둥처럼 키보다 큰 고정 기구는 넣지 않는다(넣으면 사람이 작아진다). 몸 밑의 벤치 · 기계는
 * 몸 범위에 거의 들어온다.
 */
export function clipPoints(clip: Clip): Vec3[] {
  const points: Vec3[] = [];
  for (let i = 0; i < 12; i += 1) {
    const frame = clipFrame(clip, i / 12);
    for (const bone of Object.values(frame.solved.bones)) points.push(bone.a, bone.b);
    for (const item of frame.moving) {
      if (item.kind === 'cableLine') continue;
      // 바는 원판 끝까지가 아니라 손 바깥 조금까지만 — 바 끝을 다 넣으면 사람이 작아진다
      const reach = item.kind === 'barbell' || item.kind === 'smith' ? 0.75 : item.kind === 'landmine' || item.kind === 'tbar' ? 0.2 : 0.1;
      points.push(madd(item.p, item.x, reach), madd(item.p, item.x, -reach));
    }
  }
  return points;
}

/** clipPoints의 상자 범위 (바닥 0 포함) */
export function clipBounds(clip: Clip): { min: Vec3; max: Vec3 } {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const p of clipPoints(clip)) {
    for (let i = 0; i < 3; i += 1) {
      min[i] = Math.min(min[i]!, p[i]! - 0.08);
      max[i] = Math.max(max[i]!, p[i]! + 0.08);
    }
  }
  min[1] = Math.min(min[1]!, 0);
  return { min, max };
}

/* ── 발 디딤 ─────────────────────────────────────── */

const DEG = Math.PI / 180;

/**
 * 바닥(높이 y)에 디딘 발. x · z는 발목 바로 아래, out은 발끝이 바깥으로 벌어진 각.
 * heel은 뒤꿈치를 든 각 — 발볼을 축으로 발이 선다(카프 레이즈 · 런지 뒷발).
 */
export function plant(x: number, z: number, out = 10, opts: { y?: number; heel?: number; pole?: Vec3 } = {}): LegSpec {
  const side = x >= 0 ? 1 : -1;
  const y = opts.y ?? 0;
  const flat: Vec3 = [side * Math.sin(out * DEG), 0, Math.cos(out * DEG)];
  const lift = (opts.heel ?? 0) * DEG;
  const fwd: Vec3 = [flat[0] * Math.cos(lift), -Math.sin(lift), flat[2] * Math.cos(lift)];
  const upv: Vec3 = [flat[0] * Math.sin(lift), Math.cos(lift), flat[2] * Math.sin(lift)];
  const ball: Vec3 = [x + flat[0] * BODY.ball, y, z + flat[2] * BODY.ball];
  const ankle = add(madd(ball, fwd, -BODY.ball), scale(upv, BODY.ankle));
  return { ankle, fwd, up: upv, pole: opts.pole ?? add(flat, [0, 0.15, 0]), ground: [0, 1, 0] };
}

/**
 * 면에 댄 발 — 발볼이 ball에 닿고, 발바닥은 면(normal의 반대쪽)을 본다. 발끝은 toward 쪽.
 * heel은 발볼을 축으로 뒤꿈치를 든 각 (음수면 뒤꿈치가 면 아래로 — 스텝 끝에 선 카프 레이즈).
 */
export function footOn(ball: Vec3, normal: Vec3, toward: Vec3, heel = 0, pole?: Vec3): LegSpec {
  const n = normalize(normal);
  const flat = normalize(perpendicular(toward, n));
  const side = normalize(cross(n, flat));
  // side 축 둘레 + 회전이 발끝을 면 쪽으로 내린다(뒤꿈치가 든다)
  const fwd = rotateAbout(flat, side, heel);
  const up = rotateAbout(n, side, heel);
  const ankle = add(madd(ball, fwd, -BODY.ball), scale(up, BODY.ankle));
  return { ankle, fwd, up, pole: pole ?? add(flat, scale(n, 0.15)), ground: n };
}

/** 바닥(높이 y)에서 발볼 자리를 정한 발 — 뒤꿈치를 들어도 발볼은 그대로 */
export function ballAt(x: number, z: number, out = 8, heel = 0, y = 0, pole?: Vec3): LegSpec {
  const side = x >= 0 ? 1 : -1;
  const toward: Vec3 = [side * Math.sin(out * DEG), 0, Math.cos(out * DEG)];
  return footOn([x, y, z], [0, 1, 0], toward, heel, pole);
}

/* ── 장면 ────────────────────────────────────────── */

const X: Vec3 = [1, 0, 0];
const Y: Vec3 = [0, 1, 0];
const Z: Vec3 = [0, 0, 1];

/** 기울인 축 — x축 둘레로 deg (0 = 수평으로 +z, 90 = 위로) */
export function tilt(deg: number): { y: Vec3; z: Vec3 } {
  return { y: rotateAbout(Y, X, -deg), z: rotateAbout(Z, X, -deg) };
}

/** 평평한 벤치. z0~z1 사이, 윗면 높이 top. */
export function flatBench(z0: number, z1: number, top = 0.43, x = 0): Prim[] {
  const len = z1 - z0;
  const mid = (z0 + z1) / 2;
  return [
    { kind: 'pad', p: [x, top - 0.035, mid], size: [0.28, 0.07, len] },
    { kind: 'frame', p: [x, (top - 0.07) / 2, z0 + 0.12], size: [0.05, top - 0.07, 0.05] },
    { kind: 'frame', p: [x, (top - 0.07) / 2, z1 - 0.12], size: [0.05, top - 0.07, 0.05] },
    { kind: 'frame', p: [x, 0.025, z0 + 0.12], size: [0.42, 0.05, 0.06] },
    { kind: 'frame', p: [x, 0.025, z1 - 0.12], size: [0.42, 0.05, 0.06] },
    { kind: 'frame', p: [x, top - 0.09, mid], size: [0.06, 0.04, len - 0.2] },
  ];
}

/**
 * 등받이를 세운 벤치. 엉덩이가 앉는 곳(hip)을 기준으로 앉는 판과 등판을 놓는다.
 * angle은 등판이 바닥에서 선 각 (0 = 평평, 90 = 똑바로). 등판은 −z(머리) 쪽으로 뻗는다.
 */
export function seatBench(hipZ: number, angle: number, opts: { seat?: number; seatLen?: number; backLen?: number; x?: number } = {}): Prim[] {
  const seat = opts.seat ?? 0.45;
  const x = opts.x ?? 0;
  const seatLen = opts.seatLen ?? 0.36;
  const backLen = opts.backLen ?? 0.82;
  const t = angle * DEG;
  // 등판: 엉덩이 뒤에서 시작해 머리 쪽 위로
  const dir: Vec3 = [0, Math.sin(t), -Math.cos(t)];
  const normal: Vec3 = [0, Math.cos(t), Math.sin(t)];
  const start: Vec3 = [x, seat + 0.02, hipZ - 0.1];
  const center = add(madd(start, dir, backLen / 2), scale(normal, -0.035));
  return [
    { kind: 'pad', p: [x, seat - 0.035, hipZ + seatLen / 2 - 0.08], size: [0.3, 0.07, seatLen] },
    { kind: 'pad', p: center, size: [0.28, backLen, 0.07], x: X, y: dir },
    { kind: 'frame', p: [x, (seat - 0.07) / 2, hipZ + 0.05], size: [0.05, seat - 0.07, 0.05] },
    { kind: 'frame', p: [x, 0.025, hipZ + 0.05], size: [0.42, 0.05, 0.06] },
    { kind: 'frame', p: add(madd(start, dir, backLen * 0.55), scale(normal, -0.09)), size: [0.05, backLen * 0.7, 0.04], x: X, y: dir },
    { kind: 'frame', p: [x, 0.025, hipZ - 0.1 - Math.cos(t) * backLen * 0.75], size: [0.42, 0.05, 0.06] },
  ];
}

/** 파워랙 기둥 두 개 (z 위치, 받침 높이) */
export function rack(z: number, hook: number, half = 0.62): Prim[] {
  return [
    { kind: 'post', p: [half, 1.1, z], size: [0.07, 2.2, 0.07] },
    { kind: 'post', p: [-half, 1.1, z], size: [0.07, 2.2, 0.07] },
    { kind: 'frame', p: [half - 0.06, hook, z + 0.05], size: [0.05, 0.05, 0.12] },
    { kind: 'frame', p: [-half + 0.06, hook, z + 0.05], size: [0.05, 0.05, 0.12] },
    { kind: 'frame', p: [0, 2.2, z], size: [half * 2 + 0.07, 0.07, 0.07] },
  ];
}

/** 철봉 (높이 y, z 위치) */
export function pullupBar(y: number, z: number, half = 0.7): Prim[] {
  return [
    { kind: 'bar', p: [0, y, z], size: [0.016, half * 2] },
    { kind: 'post', p: [half, (y + 0.1) / 2, z - 0.05], size: [0.07, y + 0.1, 0.07] },
    { kind: 'post', p: [-half, (y + 0.1) / 2, z - 0.05], size: [0.07, y + 0.1, 0.07] },
  ];
}

/** 평행봉 (높이 y, 간격의 반) */
export function dipBars(y: number, half: number, z = 0): Prim[] {
  return [
    { kind: 'bar', p: [half, y, z + 0.1], size: [0.02, 0.6], x: Z },
    { kind: 'bar', p: [-half, y, z + 0.1], size: [0.02, 0.6], x: Z },
    { kind: 'post', p: [half, y / 2, z + 0.38], size: [0.06, y, 0.06] },
    { kind: 'post', p: [-half, y / 2, z + 0.38], size: [0.06, y, 0.06] },
    { kind: 'post', p: [half, y / 2, z - 0.18], size: [0.06, y, 0.06] },
    { kind: 'post', p: [-half, y / 2, z - 0.18], size: [0.06, y, 0.06] },
  ];
}

/** 케이블 기둥 — 도르래가 at에 있다. 기둥은 도르래 뒤(away 쪽)에 선다. */
export function cableTower(at: Vec3, away: Vec3 = [0, 0, -1]): Prim[] {
  const back = normalize([away[0], 0, away[2]]);
  const base = madd([at[0], 0, at[2]], back, 0.12);
  return [
    { kind: 'post', p: [base[0], 1.1, base[2]], size: [0.1, 2.2, 0.1] },
    { kind: 'frame', p: madd([base[0], 0.03, base[2]], back, -0.05), size: [0.5, 0.06, 0.5] },
    { kind: 'pulley', p: at, size: [0.045, 0.03], x: normalize(cross(back, Y), X) },
  ];
}

/** 바닥 매트 */
export function mat(center: Vec3, w = 0.7, d = 1.9): Prim {
  return { kind: 'mat', p: [center[0], 0.006, center[2]], size: [w, 0.012, d] };
}

/** 스텝 박스 · 받침 */
export function block(center: Vec3, size: Vec3): Prim {
  return { kind: 'box', p: [center[0], center[1], center[2]], size: [...size] };
}

/** 기계 몸통 — 뒤쪽 큰 틀 (그림만) */
export function machineFrame(z: number, h = 1.7, w = 0.9, x = 0): Prim[] {
  return [
    { kind: 'post', p: [x + w / 2, h / 2, z], size: [0.08, h, 0.08] },
    { kind: 'post', p: [x - w / 2, h / 2, z], size: [0.08, h, 0.08] },
    { kind: 'frame', p: [x, h, z], size: [w + 0.08, 0.08, 0.08] },
    { kind: 'frame', p: [x, 0.04, z], size: [w + 0.08, 0.08, 0.5] },
  ];
}

/* ── 작은 도구 ───────────────────────────────────── */

/** 같은 자세에서 몇 가지만 바꾼 자세 */
export function withPose(base: Pose3, change: Partial<Pose3>): Pose3 {
  return { ...base, ...change };
}

/** 키 자세 목록 — [t, 말, 자세] */
export function keys(...list: [number, string | undefined, Pose3][]): Key[] {
  return list.map(([t, label, pose]) => (label ? { t, label, pose } : { t, pose }));
}

/** 왼쪽 값을 오른쪽으로 (x 부호만 뒤집기) */
export const flipX = (v: Vec3): Vec3 => [-v[0], v[1], v[2]];

export const v3 = (x: number, y: number, z: number): Vec3 => [x, y, z];

export { add, madd, normalize, scale, sub, rotateAbout, cross };

/* ── 자세 맞추기 ─────────────────────────────────── */

/** 풀어서 두 어깨 관절의 가운데 */
export function shoulderMid(pose: Pose3): Vec3 {
  const solved = solvePose(pose);
  return scale(add(solved.bones.upperArmL.a, solved.bones.upperArmR.a), 0.5);
}

/** 골반을 옮겨 두 어깨 가운데를 target에 놓는다 (기울기는 그대로) */
export function placeShoulders(pose: Pose3, target: Vec3): Pose3 {
  const now = shoulderMid(pose);
  return { ...pose, pelvis: add(pose.pelvis, sub(target, now)) };
}

/** f가 단조일 때 f(x) = want인 x (구간 [lo, hi]에서 이분법) */
export function solveFor(f: (x: number) => number, lo: number, hi: number, want: number): number {
  let a = lo;
  let b = hi;
  const rising = f(hi) > f(lo);
  for (let i = 0; i < 40; i += 1) {
    const mid = (a + b) / 2;
    const value = f(mid);
    if ((value < want) === rising) a = mid;
    else b = mid;
  }
  return (a + b) / 2;
}

/** 풀린 자세 (장면을 맞출 때 무릎 · 손 위치를 미리 본다) */
export { solvePose };

/* ── 기본 몸 자세 ─────────────────────────────────── */

/** 똑바로 선 자세 — 발 너비(발목 x)와 발끝 각도 */
export function standing(extra: Partial<Pose3> = {}, stance = 0.14, toe = 8): Pose3 {
  return { pelvis: [0, STAND_HEIGHT, -0.02], pitch: 2, spine: 0, neck: 0, legL: plant(stance, 0, toe), legR: plant(-stance, 0, toe), ...extra };
}

/** 등을 대고 누운 몸 (벤치 윗면 높이 top, 머리가 −z). 발은 바닥, 무릎은 위로 */
export function lying(extra: Partial<Pose3> = {}, pelvisZ = 0.3, top = 0.43): Pose3 {
  const feet = top < 0.2 ? 0.32 : 0.42;
  return {
    pelvis: [0, top + 0.118, pelvisZ], pitch: -90, spine: -5, neck: 0,
    legL: plant(top < 0.2 ? 0.16 : 0.3, pelvisZ + feet, 22, { pole: [0.35, 1, 0.5] }),
    legR: plant(top < 0.2 ? -0.16 : -0.3, pelvisZ + feet, 22, { pole: [-0.35, 1, 0.5] }),
    ...extra,
  };
}

/**
 * 앉은 몸 — 앉는 판 높이 seat, 엉덩이 z, 등받이에 기댄 각(lean, 0 = 똑바로).
 * 발은 무릎 앞 바닥에. 무릎 높이에 따라 계산이 각도를 맞춘다.
 */
export function seated(seat: number, hipZ = 0, lean = 0, extra: Partial<Pose3> = {}, footZ = 0.46, stance = 0.19): Pose3 {
  return {
    pelvis: [0, seat + 0.09, hipZ], pitch: -lean, spine: 0, neck: Math.min(lean * 0.6, 12),
    legL: plant(stance, hipZ + footZ, 12, { pole: [0.25, 0.7, 1] }),
    legR: plant(-stance, hipZ + footZ, 12, { pole: [-0.25, 0.7, 1] }),
    ...extra,
  };
}

/** 엎드려 발끝으로 버틴 몸. angle은 몸이 바닥과 이룬 각, 발끝은 z = toeZ에서 바닥에 닿는다 */
export function plank(angle: number, toeZ: number, extra: Partial<Pose3> = {}, width = 0.1): Pose3 {
  const a = (angle * Math.PI) / 180;
  // 발은 정강이와 직각 — 발끝이 바닥을, 발등이 머리 쪽을 본다
  const fwd: Vec3 = [0, -Math.cos(a), Math.sin(a)];
  const up: Vec3 = [0, Math.sin(a), Math.cos(a)];
  const foot = (x: number): LegSpec => {
    const toe: Vec3 = [x, 0, toeZ];
    const ankle = add(madd(toe, fwd, -BODY.toe), scale(up, BODY.ankle));
    return { ankle, fwd, up, pole: [0, -1, 0.1] };
  };
  const legL = foot(width);
  const legR = foot(-width);
  const pelvis: Vec3 = [0, legL.ankle![1] + Math.sin(a) * 0.846, legL.ankle![2] + Math.cos(a) * 0.846];
  return { pelvis, pitch: 90 - angle, spine: 0, neck: -18, legL, legR, ...extra };
}

/** 바닥을 짚은 손 — 손목이 어깨 바로 밑, 손가락은 앞으로 */
export function floorHands(pose: Pose3, flare = false, width = 0.25, ahead = 0.07): { armL: ArmSpec; armR: ArmSpec } {
  const s = shoulderMid(pose);
  const arm = (side: 1 | -1): ArmSpec => ({
    ik: [side * width, 0.022, s[2] + ahead],
    pole: flare ? [side, 0.25, 0] : [side * 0.45, 0.2, -1],
    point: [side * 0.12, 0, 1],
  });
  return { armL: arm(1), armR: arm(-1) };
}

/** 손을 허리에 — 골반 틀 기준 */
export function handsOnHips(): { armL: ArmSpec; armR: ArmSpec } {
  return {
    armL: { ik: [0.19, 0.1, 0.03], in: 'pelvis', pole: [1, 0.2, -0.6], hand: [0, 1, 0] },
    armR: { ik: [-0.19, 0.1, 0.03], in: 'pelvis', pole: [-1, 0.2, -0.6], hand: [0, 1, 0] },
  };
}

/** 팔짱 — 가슴 앞에 손 */
export function armsCrossed(): { armL: ArmSpec; armR: ArmSpec } {
  return {
    armL: { ik: [-0.08, 0.2, 0.15], in: 'chest', pole: [0.6, -1, 0.2] },
    armR: { ik: [0.08, 0.18, 0.16], in: 'chest', pole: [-0.6, -1, 0.2] },
  };
}

/** 늘어뜨린 팔 (각도) — 손잡이 방향 turn (0 앞, 90 중립, 180 회내) */
export function hangingArms(turn = 90, elev = 4, elbow = 6, plane = 8): { armL: ArmSpec; armR: ArmSpec } {
  return { armL: { fk: [plane, elev, 0, elbow], turn }, armR: { fk: [plane, elev, 0, elbow], turn } };
}

/** 키 자세 목록을 바꿔 끼우는 도구 — i번째 키의 말과 자세 */
export function setKey(list: [number, string | undefined, Pose3][], i: number, label: string | undefined, pose: Pose3): void {
  list[i] = [list[i]![0], label, pose];
}

/**
 * 엉덩이 접기 자세.
 *
 * 골반 자리는 다리가 정한다 — 무릎을 knee도 굽히고 엉덩이를 back(z)까지 뺐을 때 골반이 있을 수
 * 있는 높이는 하나다. 그다음 손(바)이 어깨에서 곧게 늘어져 barY에 닿도록 상체 기울기를 찾고,
 * 바는 어깨 바로 밑(ahead만큼 뒤, 음수면 앞)에 둔다. 거꾸로(어깨부터 맞추고 골반을 따라 옮기기)
 * 하면 골반이 다리 길이 밖으로 나간다.
 */
/** 무릎을 knee도 굽히고 골반을 z = back에 두었을 때의 골반 자리 (발은 legL 기준) */
export function pelvisFromLegs(legL: LegSpec, knee: number, back: number): Vec3 {
  const ankle = legL.ankle ?? [0.13, BODY.ankle, 0];
  const k = (knee * Math.PI) / 180;
  const a = BODY.thigh;
  const b = BODY.shin;
  const reach = Math.sqrt(a * a + b * b + 2 * a * b * Math.cos(k)) * 0.998;
  const dx = Math.abs(Math.abs(ankle[0]) - BODY.hip);
  const dz = back - ankle[2];
  const dy = Math.sqrt(Math.max(0.01, reach * reach - dx * dx - dz * dz));
  return [0, ankle[1] + dy, back];
}

export function hipHinge(base: Pose3, opts: { knee: number; back: number; barY: number; grip?: number; ahead?: number; spine?: number }): Pose3 {
  const pelvis = pelvisFromLegs(base.legL!, opts.knee, opts.back);
  const grip = opts.grip ?? 0.25;
  const ahead = opts.ahead ?? 0.04;
  const lateral = Math.abs(grip - BODY.shoulder[0]);
  const hang = Math.sqrt(Math.max(0.04, (ARM_REACH * 0.975) ** 2 - lateral * lateral - ahead * ahead));
  const at = (pitch: number) => shoulderMid({ ...base, pelvis, pitch, spine: opts.spine ?? base.spine ?? 0 });
  const pitch = solveFor((p) => at(p)[1], -20, 135, opts.barY + hang);
  const s = at(pitch);
  return { ...base, pelvis, pitch, spine: opts.spine ?? base.spine ?? 0, bar: { at: [0, opts.barY, s[2] - ahead] } };
}

/** 풀린 자세의 가슴 틀 안 점 → 세계 좌표 (바가 가슴에 닿는 곳 등) */
export function chestPoint(pose: Pose3, local: Vec3): Vec3 {
  return point(solvePose(pose).frames.chest, local);
}

/** 등받이 없는 의자 — 엉덩이 z, 앉는 판 높이 */
export function stool(hipZ: number, seat: number, x = 0): Prim[] {
  return [
    { kind: 'pad', p: [x, seat - 0.035, hipZ + 0.08], size: [0.32, 0.07, 0.36] },
    { kind: 'frame', p: [x, (seat - 0.07) / 2, hipZ + 0.08], size: [0.06, seat - 0.07, 0.06] },
    { kind: 'frame', p: [x, 0.025, hipZ + 0.08], size: [0.42, 0.05, 0.42] },
  ];
}
