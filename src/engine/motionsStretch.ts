/**
 * 몸 풀기 · 마무리 스트레칭 시연 — PT 세션의 동작 하나하나를 종목 시연과 같은 마네킹으로.
 *
 * 몸 풀기(MOBILITY_STEPS)는 움직이는 동작이라 실제 움직임을 한 주기로 돌린다 — 팔 돌리기는
 * 팔이 돌고, 폼롤러는 몸이 롤러 위를 오간다. 마무리 스트레칭(COOLDOWN_STEPS)은 버티는 동작이라
 * 늘린 자세에서 숨에 맞춰 아주 조금만 더 들어갔다 돌아온다 — 크게 반복하면 버티기가 아니다.
 *
 * 한쪽씩 하는 동작은 왼쪽을 짓는다(side: 'L'). 반대쪽은 mirrorClip이 좌우를 뒤집어 만든다 —
 * 반쯤 지나 "반대쪽"이라고 할 때 앱이 그림만 바꿔 끼운다.
 *
 * 기구는 종목 시연과 같은 조각(매트 · 기둥 · 롤러 · 상자)만 쓴다. 벽 · 기둥이 필요한 동작은
 * 몸 자세를 먼저 정하고 손이 닿는 자리에 벽을 세운다 — 손이 벽을 뚫거나 허공을 짚지 않게.
 */
import {
  ballAt, footOn, handsOnHips, keys, mat, pelvisFromLegs, plant, shoulderMid, solveFor, standing,
  type Cable, type Clip, type Link, type Prim,
} from './motionKit.ts';
import { deadBug } from './motionsCore.ts';
import { hipThrust, squat } from './motionsLower.ts';
import {
  BODY, add, madd, normalize, scale, solvePose, sub,
  type ArmSpec, type BoneName, type LegSpec, type Pose3, type Solved, type Vec3,
} from './rig.ts';

type KeyList = [number, string | undefined, Pose3][];
type Side = 'L' | 'R';

const DEG = Math.PI / 180;

/** 버티는 스트레칭의 숨 — 내쉴 때 조금 더 */
const EXHALE = '숨 내쉬며 조금 더';

/* ── 작은 도구 ───────────────────────────────────── */

const M = (v: Vec3): Vec3 => [-v[0], v[1], v[2]];

/** 다 편 다리 길이 (무릎이 아주 살짝 굽은) */
const LEG = (BODY.thigh + BODY.shin) * 0.995;
/** 무릎을 곧게 편 다리 (5° 안) */
const LEG_STRAIGHT = (BODY.thigh + BODY.shin) * 0.999;
/** 바닥을 짚은 손 — 어깨에서 손목까지 거의 편 길이 */
const FLOOR_REACH = (BODY.upperArm + BODY.forearm) * 0.975;
/** 바닥을 짚은 손바닥 가운데 높이 */
const PALM_Y = 0.022;
/** 바닥을 짚고 팔을 거의 폈을 때 어깨 높이 */
const SHOULDER_ON_HANDS = PALM_Y + FLOOR_REACH;
/** 똑바로 섰을 때 골반 높이 */
const STANDING_Y = 0.915;
/** 손바닥 가운데까지 거의 편 팔 */
const STRAIGHT_ARM = (BODY.upperArm + BODY.forearm + BODY.grip) * 0.95;

const solved = (pose: Pose3): Solved => solvePose(pose);
const shoulderOf = (pose: Pose3, side: Side): Vec3 => solved(pose).bones[`upperArm${side}`].a;

/** 각도로 준 다리를 같은 자리의 닿을 곳 다리로 — 한 동작 안에서 다리 푸는 방식을 바꾸지 않으려고 */
function legAsIk(pose: Pose3, side: Side): LegSpec {
  const b = solved(pose).bones;
  const thigh = b[`thigh${side}`];
  const ankle = b[`shin${side}`].b;
  const foot = b[`foot${side}`];
  const mid = scale(add(thigh.a, ankle), 0.5);
  return { ankle, fwd: normalize(sub(foot.b, foot.a)), up: foot.f, pole: normalize(sub(thigh.b, mid), thigh.f) };
}

/** 몸 기울기(pitch)를 찾아 어떤 높이를 맞춘다 */
function pitchFor(pose: Pose3, measure: (s: Solved) => number, want: number, lo: number, hi: number): Pose3 {
  const pitch = solveFor((p) => measure(solved({ ...pose, pitch: p })), lo, hi, want);
  return { ...pose, pitch };
}

/** 바닥을 짚은 손 — 손가락은 앞(머리 쪽) */
const floorHand = (at: Vec3, side: 1 | -1, pole: Vec3, point: Vec3 = [side * 0.12, 0, 1]): ArmSpec => ({ ik: [at[0], PALM_Y, at[2]], pole, point });

/** 벽을 짚은 손 — 손가락은 위, 손바닥은 +z(앞의 벽)를 본다 */
const wallHand = (grip: Vec3, pole: Vec3): ArmSpec => ({ ik: grip, pole, point: [0, 1, 0], hand: [1, 0, 0] });

/** 뒤통수에 댄 손 (가슴 틀) — 팔꿈치는 옆으로 */
const behindHead = (side: 1 | -1): ArmSpec => ({ ik: [side * 0.075, 0.47, -0.1], in: 'chest', pole: [side, 0.25, 0.1] });

/** 무릎 꿇은 다리 — 무릎은 kneeZ에서 바닥, 발등도 바닥 */
function kneelLegs(kneeZ = 0, width = 0.11): { legL: LegSpec; legR: LegSpec } {
  const foot = (x: number): LegSpec => ({ ankle: [x, 0.07, kneeZ - BODY.shin + 0.01], fwd: normalize([0, -0.12, -1]), up: normalize([0, -1, 0.12]), pole: [0, -0.6, 1] });
  return { legL: foot(width), legR: foot(-width) };
}

/** 세운 벽 — 앞(+z)에 z면, 또는 옆(+x)에 x면 */
function wallAt(face: number, axis: 'z' | 'x', center = 0, width = 1.6): Prim {
  return axis === 'z'
    ? { kind: 'post', p: [center, 1.1, face + 0.05], size: [width, 2.2, 0.1] }
    : { kind: 'post', p: [face + 0.05, 1.1, center], size: [0.1, 2.2, width] };
}

/** 세운 기둥 하나 */
const post = (x: number, z: number, h = 2.2): Prim => ({ kind: 'post', p: [x, h / 2, z], size: [0.08, h, 0.08] });

/** 폼롤러 — 길이 방향 x (along으로 바꿀 수 있다) */
const ROLLER_R = 0.075;
const roller = (at: Vec3, len = 0.9, along: Vec3 = [1, 0, 0]): Prim => ({ kind: 'roller', p: [at[0], ROLLER_R, at[2]], size: [ROLLER_R, len], x: along });

/** 버티는 스트레칭 — 늘린 자세에서 숨 한 번 */
function holdClip(id: string, pose: Pose3, deeper: Pose3, label: string, view: [number, number], scene: Prim[], sided = true): Clip {
  return {
    id, cycle: 5, view, keys: keys([0, label, pose], [0.5, EXHALE, deeper], [1, undefined, pose]), scene, work: [0, 1],
    ...(sided ? { side: 'L' as const } : {}),
  };
}

/** 자세를 함수로 주고 주기를 n등분해 키를 만든다 (등속으로 이어 돌린다 — 원 · 걷기 · 페달) */
function sampled(n: number, at: (s: number) => Pose3, labels: [number, string][]): KeyList {
  const list: KeyList = [];
  for (let i = 0; i <= n; i += 1) {
    const s = i / n;
    const label = i < n ? labels.find(([t]) => Math.abs(t - s) < 1e-9)?.[1] : undefined;
    list.push([s, label, at(i === n ? 0 : s)]);
  }
  return list;
}

/* ── 좌우 뒤집기 ─────────────────────────────────── */

function mirrorArm(a: ArmSpec | undefined): ArmSpec | undefined {
  if (!a) return undefined;
  const out: ArmSpec = { ...a };
  if (a.ik) out.ik = M(a.ik);
  if (a.pole) out.pole = M(a.pole);
  if (a.point) out.point = M(a.point);
  // 손잡이 방향은 손바닥을 정하는 데 쓰인다(손바닥 = 손잡이 × 손 방향). 거울에서는 외적의 부호가
  // 바뀌므로 손잡이를 반대로 돌려야 손바닥이 제 쪽을 본다
  if (a.hand) out.hand = [a.hand[0], -a.hand[1], -a.hand[2]];
  return out;
}

function mirrorLeg(l: LegSpec | undefined): LegSpec | undefined {
  if (!l) return undefined;
  const out: LegSpec = { ...l };
  for (const key of ['ankle', 'fwd', 'up', 'pole', 'ground'] as const) {
    const v = l[key];
    if (v) out[key] = M(v);
  }
  return out;
}

/** 자세 하나의 좌우를 뒤집는다 — 왼팔 자리에 오른팔이, 왼쪽으로 돈 몸은 오른쪽으로 */
export function mirrorPose(pose: Pose3): Pose3 {
  const out: Pose3 = { ...pose, pelvis: M(pose.pelvis) };
  for (const key of ['yaw', 'roll', 'twist', 'bend'] as const) {
    const v = pose[key];
    if (v !== undefined) out[key] = -v;
  }
  const swap = <K extends keyof Pose3>(l: K, r: K, map: (v: Pose3[K]) => Pose3[K]) => {
    const left = pose[l];
    const right = pose[r];
    delete out[l];
    delete out[r];
    if (right !== undefined) out[l] = map(right);
    if (left !== undefined) out[r] = map(left);
  };
  swap('armL', 'armR', (v) => mirrorArm(v as ArmSpec) as Pose3['armL']);
  swap('legL', 'legR', (v) => mirrorLeg(v as LegSpec) as Pose3['legL']);
  swap('scapL', 'scapR', (v) => v);
  if (pose.bar) out.bar = { ...pose.bar, at: M(pose.bar.at), dir: M(pose.bar.dir ?? [1, 0, 0]) };
  return out;
}

const swapBone = (bone: BoneName): BoneName => (bone.endsWith('L') ? bone.slice(0, -1) + 'R' : bone.endsWith('R') ? bone.slice(0, -1) + 'L' : bone) as BoneName;
const swapSide = <T extends string>(s: T): T => (s === 'L' ? 'R' : s === 'R' ? 'L' : s) as T;

function mirrorPrim(prim: Prim): Prim {
  const out: Prim = { ...prim, p: M(prim.p) };
  if (prim.x) out.x = M(prim.x);
  if (prim.y) out.y = M(prim.y);
  return out;
}

function mirrorLink(link: Link): Link {
  const pair = Array.isArray(link.bone);
  const out: Link = {
    ...link,
    bone: Array.isArray(link.bone) ? [swapBone(link.bone[0]), swapBone(link.bone[1])] : swapBone(link.bone),
  };
  // 뼈 틀의 옆(x) 축은 거울에서 반대로 선다 — 옆으로 비킨 거리의 부호를 바꾼다
  if (link.off) out.off = [-link.off[0], link.off[1], link.off[2]];
  if (link.pivot) out.pivot = M(link.pivot);
  if (link.fixed) out.fixed = { x: scale(M(link.fixed.x), -1), y: M(link.fixed.y) };
  if (link.leverAt !== undefined && !pair) out.leverAt = -link.leverAt;
  return out;
}

/** 시연 하나의 좌우를 뒤집는다 — 한쪽씩 하는 스트레칭의 반대쪽 */
export function mirrorClip(clip: Clip): Clip {
  const out: Clip = {
    ...clip,
    view: [-clip.view[0], clip.view[1]],
    keys: clip.keys.map((key) => ({ ...key, pose: mirrorPose(key.pose) })),
    scene: clip.scene.map(mirrorPrim),
  };
  if (clip.side) out.side = swapSide(clip.side);
  if (clip.hold) out.hold = { ...(clip.hold.R ? { L: clip.hold.R } : {}), ...(clip.hold.L ? { R: clip.hold.L } : {}) };
  if (clip.cables) {
    out.cables = clip.cables.map((cable): Cable => ({
      from: typeof cable.from === 'string' ? swapSide(cable.from) : M(cable.from),
      to: swapSide(cable.to),
    }));
  }
  if (clip.links) out.links = clip.links.map(mirrorLink);
  if (clip.bar?.pivot) out.bar = { ...clip.bar, pivot: M(clip.bar.pivot) };
  return out;
}

/* ── 시작: 유산소 기구 ───────────────────────────── */

/** 러닝머신 — 벨트 위 제자리 걷기. 디딘 발은 벨트와 같이 뒤로 흐른다 */
function treadmillWalk(id: string): Clip {
  const deck = 0.13;
  const step = 0.3;
  const stance = (x: number, z: number, heel = 0): LegSpec => ballAt(x, z + BODY.ball, 8, heel, deck);
  const swing = (x: number, z: number, lift: number): LegSpec => ({ ankle: [x, deck + BODY.ankle + lift, z], fwd: [0, -0.15, 0.99], up: [0, 0.99, 0.15], pole: [0, 0.2, 1] });
  const arms = (s: number): Partial<Pose3> => {
    // 다리와 반대로 흔드는 팔 — 팔꿈치를 굽혀 빠르게 걷는 팔
    const swingL = Math.cos(2 * Math.PI * s) * -26;
    return { armL: { fk: [0, 8 + swingL, 0, 70], turn: 90 }, armR: { fk: [0, 8 - swingL, 0, 70], turn: 90 } };
  };
  const pose = (legL: LegSpec, legR: LegSpec, y: number, s: number): Pose3 => ({ pelvis: [0, deck + y, -0.05], pitch: 6, spine: 0, neck: 0, legL, legR, ...arms(s) });
  const contact = STANDING_Y - 0.05;
  const mid = STANDING_Y - 0.02;
  const list: KeyList = [
    [0, '숨이 살짝 찰 만큼 빠르게', pose(stance(0.1, step), stance(-0.1, -step, 30), contact, 0)],
    [0.25, undefined, pose(stance(0.1, 0), swing(-0.1, 0, 0.1), mid, 0.25)],
    [0.5, undefined, pose(stance(0.1, -step, 30), stance(-0.1, step), contact, 0.5)],
    [0.75, undefined, pose(swing(0.1, 0, 0.1), stance(-0.1, 0), mid, 0.75)],
    [1, undefined, pose(stance(0.1, step), stance(-0.1, -step, 30), contact, 0)],
  ];
  const rail = (x: number): Prim => ({ kind: 'bar', p: [x, 1.0, 0.62], size: [0.016, 0.5], x: [0, 0, 1] });
  return {
    id, cycle: 1.15, view: [64, 8], keys: keys(...list), linear: true, work: [0, 1],
    scene: [
      { kind: 'frame', p: [0, 0.06, 0.1], size: [0.78, 0.12, 1.8] },
      { kind: 'mat', p: [0, deck - 0.004, 0.08], size: [0.52, 0.01, 1.6] },
      post(0.36, 0.9, 1.3), post(-0.36, 0.9, 1.3),
      { kind: 'pad', p: [0, 1.3, 0.88], size: [0.8, 0.12, 0.22] },
      rail(0.36), rail(-0.36),
    ],
  };
}

/** 실내 사이클 — 안장에 앉아 페달을 돌린다. 발볼이 페달 위, 페달은 크랭크를 따라 돈다 */
function bikeEasy(id: string): Clip {
  const saddle = 0.93;
  const crank: Vec3 = [0, 0.34, 0.2];
  const r = 0.17;
  const pedal = (x: number, a: number): LegSpec => {
    // a = 0이 맨 위, 앞으로 돈다. 발목은 아래(4~5시)에서 살짝 펴진다
    const ball: Vec3 = [x, crank[1] + r * Math.cos(a) + 0.02, crank[2] + r * Math.sin(a)];
    return footOn(ball, [0, 1, 0], [0, 0, 1], 8 + 10 * Math.sin(a), [x * 2, 0.3, 1]);
  };
  const hands = { armL: { ik: [0.22, 1.13, 0.5] as Vec3, pole: [0.5, -0.5, -0.6] as Vec3, hand: [1, 0, 0] as Vec3 }, armR: { ik: [-0.22, 1.13, 0.5] as Vec3, pole: [-0.5, -0.5, -0.6] as Vec3, hand: [1, 0, 0] as Vec3 } };
  const at = (s: number): Pose3 => {
    const a = 2 * Math.PI * s;
    return { pelvis: [0, saddle + 0.09, -0.12], pitch: 28, spine: 6, neck: -12, legL: pedal(0.13, a), legR: pedal(-0.13, a + Math.PI), ...hands };
  };
  const pedalLink = (bone: BoneName): Link => ({ kind: 'pad', bone, u: 0.55, off: [0, 0, -0.015], size: [0.1, 0.12, 0.025], pivot: crank });
  return {
    id, cycle: 1.1, view: [70, 8], keys: keys(...sampled(8, at, [[0, '가볍게 페달 밟기']])), linear: true, work: [0, 1],
    scene: [
      { kind: 'pad', p: [0, saddle - 0.03, -0.1], size: [0.18, 0.06, 0.28] },
      { kind: 'frame', p: [0, (saddle - 0.06) / 2 + 0.1, -0.06], size: [0.05, saddle - 0.2, 0.05], y: normalize([0, 1, -0.25]) },
      { kind: 'plate', p: [0, 0.38, 0.52], size: [0.22, 0.05] },
      { kind: 'frame', p: [0, 0.78, 0.46], size: [0.05, 0.7, 0.05], y: normalize([0, 1, -0.2]) },
      { kind: 'bar', p: [0, 1.13, 0.5], size: [0.016, 0.56] },
      { kind: 'frame', p: [0, 0.03, 0.15], size: [0.5, 0.06, 1.1] },
      { kind: 'frame', p: [0, 0.2, 0.18], size: [0.05, 0.3, 0.05] },
    ],
    links: [pedalLink('footL'), pedalLink('footR')],
  };
}

/** 로잉머신 — 다리로 밀고, 몸을 젖히고, 팔은 마지막에. 돌아갈 때는 거꾸로 */
function rowEasy(id: string): Clip {
  const seatY = 0.36;
  const normal = normalize([0, 0.77, -0.64]);
  const toward = normalize([0, 0.64, 0.77]);
  const feet = { legL: footOn([0.11, 0.24, 0.66], normal, toward, 0, [0.4, 1, 0.2]), legR: footOn([-0.11, 0.24, 0.66], normal, toward, 0, [-0.4, 1, 0.2]) };
  // 손잡이 높이 handY — 팔을 편 자세면 그 높이에서 팔 길이만큼 앞, 당긴 자세면 명치 앞
  const body = (z: number, pitch: number, handY: number, pulled = false): Pose3 => {
    const pose: Pose3 = { pelvis: [0, seatY + 0.085, z], pitch, spine: 4, neck: -6, ...feet };
    const s = shoulderOf(pose, 'L');
    const ahead = pulled ? z + 0.22 : s[2] + Math.sqrt(Math.max(0, STRAIGHT_ARM ** 2 - (s[1] - handY) ** 2 - (s[0] - 0.2) ** 2));
    const pole = (side: 1 | -1): Vec3 => (pulled ? [side * 0.5, -0.3, -1] : [side * 0.4, -1, -0.3]);
    return {
      ...pose,
      armL: { ik: [0.2, handY, ahead], pole: pole(1), hand: [1, 0, 0] },
      armR: { ik: [-0.2, handY, ahead], pole: pole(-1), hand: [1, 0, 0] },
    };
  };
  const catchPose = body(0.28, 24, 0.62);
  const legsDone = body(-0.14, 22, 0.64);
  const swung = body(-0.17, -14, 0.68);
  const finish = body(-0.17, -16, 0.72, true);
  const armsOut = body(-0.17, -14, 0.68);
  const bodyOver = body(-0.12, 22, 0.64);
  const list: KeyList = [
    [0, '다리로 밀기', catchPose],
    [0.24, '몸을 젖히고', legsDone],
    [0.32, '팔은 마지막에', swung],
    [0.42, undefined, finish],
    [0.5, '팔 → 몸 → 다리 순서로 돌아가기', finish],
    [0.6, undefined, armsOut],
    [0.7, undefined, bodyOver],
    [1, undefined, catchPose],
  ];
  const chain: Vec3 = [0, 0.56, 1.1];
  return {
    id, cycle: 3.2, view: [78, 10], keys: keys(...list), work: [0, 0.42],
    scene: [
      { kind: 'frame', p: [0, 0.27, -0.15], size: [0.12, 0.06, 2.1] },
      { kind: 'pad', p: [0, seatY - 0.03, -0.0], size: [0.3, 0.05, 0.3] },
      { kind: 'pad', p: [0, 0.22, 0.72], size: [0.36, 0.3, 0.04], x: [1, 0, 0], y: toward },
      { kind: 'plate', p: [0, 0.5, 1.24], size: [0.26, 0.2] },
      { kind: 'frame', p: [0, 0.03, 1.15], size: [0.5, 0.06, 0.2] },
      { kind: 'frame', p: [0, 0.14, -1.15], size: [0.5, 0.28, 0.08] },
    ],
    links: [{ kind: 'bar', bone: ['handL', 'handR'], u: 0.44, size: [0.016, 0.58] }],
    cables: [{ from: chain, to: 'mid' }],
  };
}

/** 천국의 계단 — 한 계단씩 천천히. 손잡이에 기대지 않고 팔은 자연스럽게 */
function stairsEasy(id: string): Clip {
  const low = 0.14;
  const high = 0.36;
  const stepAt = (x: number, y: number, z: number): LegSpec => ballAt(x, z, 8, 0, y, [x, 0.3, 1]);
  const at = (s: number): Pose3 => {
    const a = 2 * Math.PI * s;
    // 왼발이 위 계단을 딛고 몸을 올리는 동안 오른발은 내려가고, 반대로
    const lY = (low + high) / 2 + ((high - low) / 2) * Math.cos(a);
    const rY = (low + high) / 2 - ((high - low) / 2) * Math.cos(a);
    const lZ = 0.16 + 0.08 * Math.cos(a);
    const rZ = 0.16 - 0.08 * Math.cos(a);
    const top = Math.max(lY, rY);
    const swingL = Math.cos(a) * 18;
    return {
      pelvis: [0, top + 0.68, -0.02], pitch: 10, spine: 2, neck: -6,
      legL: stepAt(0.11, lY, lZ), legR: stepAt(-0.11, rY, rZ),
      armL: { fk: [0, 10 - swingL, 0, 40], turn: 90 }, armR: { fk: [0, 10 + swingL, 0, 40], turn: 90 },
    };
  };
  const tread = (bone: BoneName): Link => ({ kind: 'box', bone, u: 0.55, fixed: { x: [1, 0, 0], y: [0, 1, 0] }, off: [0, -0.025, 0], size: [0.26, 0.05, 0.3] });
  return {
    id, cycle: 1.8, view: [62, 10], keys: keys(...sampled(8, at, [[0, '한 계단씩 천천히']])), linear: true, work: [0, 1],
    scene: [
      { kind: 'frame', p: [0, 0.04, 0.2], size: [0.8, 0.08, 1.0] },
      post(0.36, 0.62, 1.35), post(-0.36, 0.62, 1.35),
      { kind: 'bar', p: [0.36, 1.05, 0.35], size: [0.016, 0.55], x: [0, 0, 1] },
      { kind: 'bar', p: [-0.36, 1.05, 0.35], size: [0.016, 0.55], x: [0, 0, 1] },
      { kind: 'pad', p: [0, 1.35, 0.66], size: [0.8, 0.12, 0.18] },
    ],
    links: [tread('footL'), tread('footR')],
  };
}

/* ── 폼롤러 ──────────────────────────────────────── */

/** 등 위쪽 — 누워 롤러를 날개뼈 밑에, 엉덩이를 들고 발로 밀어 위아래로 */
function rollUpperBack(id: string): Clip {
  const rollerZ = -0.42;
  const contact = ROLLER_R * 2 + 0.07;
  const feet = { legL: plant(0.15, 0.4, 10, { pole: [0.3, 1, 0.5] }), legR: plant(-0.15, 0.4, 10, { pole: [-0.3, 1, 0.5] }) };
  const body = (pelvisZ: number): Pose3 => {
    const base: Pose3 = { pelvis: [0, 0.255, pelvisZ], pitch: -96, spine: -2, neck: 24, ...feet, armL: behindHead(1), armR: behindHead(-1) };
    // 가슴 뼈가 롤러 위(등 두께만큼 위)를 지나도록 기울기를 맞춘다
    const height = (s: Solved): number => {
      const c = s.bones.chest;
      const u = (rollerZ - c.a[2]) / (c.b[2] - c.a[2]);
      return c.a[1] + (c.b[1] - c.a[1]) * Math.max(0, Math.min(1, u));
    };
    return pitchFor(base, height, contact, -125, -80);
  };
  const near = body(0.02);
  const far = body(-0.12);
  const list: KeyList = [[0, '발로 밀어 위로', near], [0.5, '천천히 아래로', far], [1, undefined, near]];
  return { id, cycle: 3, view: [74, 14], keys: keys(...list), scene: [mat([0, 0, -0.05], 0.75, 1.8), roller([0, 0, rollerZ])], work: [0, 1] };
}

/** 옆구리(광배) — 옆으로 누워 겨드랑이 밑에 롤러, 아래팔은 머리 위로 */
function rollLats(id: string): Clip {
  // 왼쪽으로 누운 몸 — 머리는 +x, 몸 앞은 +z
  const rollerX = 0.36;
  const body = (shift: number, bend: number): Pose3 => {
    const base: Pose3 = {
      pelvis: [shift, 0.17, 0], roll: -90, bend, spine: 0, neck: -12,
      armL: { fk: [90, 168, 0, 6], turn: 0 },
      legL: { fk: [4, 0, 0, 6, -20] },
      legR: { fk: [52, -14, 0, 70, -20] },
    };
    const s = shoulderOf(base, 'R');
    return { ...base, armR: floorHand([s[0] - 0.02, 0, 0.32], -1, [0, 0.4, 1], [0, 0, 1]) };
  };
  const a = body(-0.02, 30);
  const b = body(-0.12, 26);
  const hand = a.armR!;
  const list: KeyList = [[0, '겨드랑이 아래부터', a], [0.5, '아픈 곳에서 잠깐 멈춤', { ...b, armR: hand }], [1, undefined, a]];
  return { id, cycle: 3.2, view: [-25, 38], keys: keys(...list), scene: [mat([0.1, 0, 0.05], 1.9, 0.8), roller([rollerX, 0, 0.0], 0.6, [0, 0, 1])], side: 'L', work: [0, 1] };
}

/** 앞허벅지 — 엎드려 팔꿈치로 버티고, 롤러가 무릎 위에서 골반까지 */
function rollQuads(id: string): Clip {
  const rollerZ = -0.42;
  const hipY = ROLLER_R * 2 + 0.07;
  const elbowY = 0.05;
  const travel = 0.24;
  const elbowZ = shoulderMid({ pelvis: [0, hipY, rollerZ + 0.2 + travel / 2], pitch: 78 })[2];
  const body = (dz: number): Pose3 => {
    const pelvisZ = rollerZ + 0.2 + dz;
    const base: Pose3 = { pelvis: [0, hipY, pelvisZ], pitch: 80, spine: 0, neck: -20 };
    // 팔꿈치는 바닥 한 자리 — 어깨가 팔꿈치 둘레로 앞뒤로 기운다
    const shoulderY = (s: Solved) => s.bones.upperArmL.a[1];
    const sz = shoulderMid(base)[2];
    const lean = Math.min(0.95, Math.abs(sz - elbowZ) / BODY.upperArm);
    const want = elbowY + BODY.upperArm * Math.sqrt(1 - lean * lean) * 0.985;
    const posed = pitchFor(base, shoulderY, want, 60, 100);
    const legs = -(90 - (posed.pitch ?? 90));
    return {
      ...posed,
      legL: { fk: [legs, 3, 0, 4, -40] }, legR: { fk: [legs, 3, 0, 4, -40] },
      armL: { ik: [0.13, 0.04, elbowZ + 0.26], pole: [0.1, -1, -0.25], hand: [1, 0, 0] },
      armR: { ik: [-0.13, 0.04, elbowZ + 0.26], pole: [-0.1, -1, -0.25], hand: [1, 0, 0] },
    };
  };
  const knee = body(travel);
  const hip = body(0);
  const list: KeyList = [[0, '골반 쪽으로', knee], [0.5, '무릎 위까지', hip], [1, undefined, knee]];
  return { id, cycle: 3.2, view: [72, 14], keys: keys(...list), scene: [mat([0, 0, -0.2], 0.75, 1.9), roller([0, 0, rollerZ])], work: [0, 1] };
}

/** 엉덩이 — 롤러에 앉아 왼발목을 오른무릎에, 왼쪽 엉덩이로 기대 앞뒤로 */
function rollGlutes(id: string): Clip {
  const rollerZ = 0;
  const mid = (s: Solved) => (s.bones.upperArmL.a[1] + s.bones.upperArmR.a[1]) / 2;
  // 손은 바닥 한 자리 — 몸을 젖혀 어깨가 손 위에 오게
  const lean = pitchFor({ pelvis: [0.04, ROLLER_R * 2 + 0.12, rollerZ], pitch: -30, roll: -7, spine: 10, neck: 8 }, mid, SHOULDER_ON_HANDS * 0.95, -85, 0);
  const sL = shoulderOf(lean, 'L');
  const sR = shoulderOf(lean, 'R');
  const hands = {
    armL: floorHand([sL[0] + 0.05, 0, sL[2] - 0.1], 1, [0.3, 0.2, 1], [0.3, 0, -1]),
    armR: floorHand([sR[0] - 0.05, 0, sR[2] - 0.1], -1, [-0.3, 0.2, 1], [-0.3, 0, -1]),
  };
  const base = (dz: number): Pose3 => {
    const pose: Pose3 = {
      ...lean, pelvis: [0.04, ROLLER_R * 2 + 0.12, rollerZ + dz],
      legR: plant(-0.14, rollerZ + 0.5, 8, { pole: [-0.3, 1, 0.6] }), ...hands,
    };
    const b = solved({ ...pose, legL: { fk: [70, 30, 40, 90, 0] } }).bones;
    // 왼발목 바깥을 오른무릎 바로 위 허벅지에 얹는다
    const kneeR = b.shinR.a;
    const thighDir = normalize(sub(b.thighR.a, b.thighR.b));
    const ankle = add(madd(kneeR, thighDir, 0.07), [0.0, 0.08, 0.0]);
    return { ...pose, legL: { ankle, fwd: normalize([-0.9, 0.1, 0.4]), up: normalize([0, 1, 0.1]), pole: [1, 0.4, 0.3] } };
  };
  const a = base(0.06);
  const b = base(-0.06);
  const list: KeyList = [[0, '왼쪽 엉덩이로 기대 굴리기', a], [0.5, '천천히 앞뒤로', b], [1, undefined, a]];
  return { id, cycle: 2.8, view: [40, 16], keys: keys(...list), scene: [mat([0, 0, 0.05], 0.8, 1.4), roller([0, 0, rollerZ], 0.6)], side: 'L', work: [0, 1] };
}

/** 뒤허벅지 · 종아리 — 앉아 손으로 버티고 엉덩이를 들어, 롤러가 종아리에서 허벅지까지 */
function rollHamsCalves(id: string): Clip {
  const rollerZ = 0.3;
  const hipY = ROLLER_R * 2 + 0.055;
  const from = rollerZ - 0.62;
  const to = rollerZ - 0.3;
  const mid = (s: Solved) => (s.bones.upperArmL.a[1] + s.bones.upperArmR.a[1]) / 2;
  const lean = pitchFor({ pelvis: [0, hipY, (from + to) / 2], pitch: -40, spine: 8, neck: 10 }, mid, SHOULDER_ON_HANDS * 0.94, -85, 0);
  const pitch = lean.pitch ?? -40;
  const s = shoulderMid(lean);
  const hands = {
    armL: floorHand([0.23, 0, s[2] - 0.04], 1, [0.3, 0.2, 1], [0.2, 0, -1]),
    armR: floorHand([-0.23, 0, s[2] - 0.04], -1, [-0.3, 0.2, 1], [-0.2, 0, -1]),
  };
  // 다리는 롤러 위에 수평으로 — 몸을 젖힌 만큼 엉덩이를 굽힌다
  const body = (pelvisZ: number): Pose3 => ({
    ...lean, pelvis: [0, hipY, pelvisZ],
    legL: { fk: [90 + pitch, 3, 0, 3, 10] }, legR: { fk: [90 + pitch, 3, 0, 3, 10] }, ...hands,
  });
  const calves = body(from);
  const hams = body(to);
  const list: KeyList = [[0, '종아리부터', calves], [0.5, '허벅지 뒤까지', hams], [1, undefined, calves]];
  return { id, cycle: 3.4, view: [74, 12], keys: keys(...list), scene: [mat([0, 0, 0.1], 0.75, 1.8), roller([0, 0, rollerZ])], work: [0, 1] };
}

/** 가슴 · 어깨 앞 — 엎드려 롤러를 왼가슴 밑에 세로로, 왼팔을 벌린 채 좌우로 */
function rollChest(id: string): Clip {
  const rollerX = 0.13;
  const rollerZ = 0.42;
  const body = (shift: number, twist: number): Pose3 => {
    const pose: Pose3 = {
      pelvis: [shift, 0.12, 0], pitch: 82, spine: -4, twist, neck: -10,
      legL: { fk: [-8, 4, 0, 3, -65] }, legR: { fk: [-8, 4, 0, 3, -65] },
    };
    const s = shoulderOf(pose, 'R');
    return {
      ...pose,
      armL: { ik: [0.74 + shift, 0.03, rollerZ + 0.05], pole: [0.1, 1, 0.4], point: [1, 0, 0.2] },
      armR: floorHand([s[0] + 0.05, 0, s[2] + 0.28], -1, [-1, 0.4, -0.3], [0.2, 0, 1]),
    };
  };
  const a = body(-0.02, -22);
  const b = body(-0.12, -34);
  const list: KeyList = [[0, '팔을 벌린 채 좌우로', a], [0.5, '어깨 앞까지', { ...b, armR: a.armR! }], [1, undefined, a]];
  return { id, cycle: 3, view: [-25, 34], keys: keys(...list), scene: [mat([0, 0, 0.1], 1.4, 1.9), roller([rollerX, 0, rollerZ], 0.5, [0, 0, 1])], side: 'L', work: [0, 1] };
}

/* ── 움직이는 스트레칭 ───────────────────────────── */

/** 팔 크게 돌리기 — 앞으로 한 바퀴, 뒤로 한 바퀴. 팔은 쭉 편 채로 */
function armCircle(id: string): Clip {
  const arm = (plane: number, elev: number): ArmSpec => ({ fk: [plane, elev, 0, 4], turn: 90 });
  const at = (plane: number, elev: number): Pose3 => standing({ armL: arm(plane, elev), armR: arm(plane, elev), neck: 0 }, 0.15);
  // 앞으로 돌리기: 아래 → 뒤 → 머리 위 → 앞 → 아래
  const forward: [number, number][] = [[0, 2], [170, 14], [150, 45], [115, 110], [80, 178], [0, 125], [0, 60]];
  const back = [...forward].reverse();
  const list: KeyList = [];
  forward.forEach(([p, e], i) => list.push([i / 14, i === 0 ? '앞으로 크게 돌리기' : undefined, at(p, e)]));
  back.forEach(([p, e], i) => list.push([(7 + i) / 14, i === 0 ? '뒤로 크게 돌리기' : undefined, at(p, e)]));
  list.push([1, undefined, at(0, 2)]);
  // 뒤로 도는 첫 키는 앞으로 도는 끝(0, 60)과 이어진다 — 아래(0, 2)에서 한 번 지나간다
  list.splice(7, 0, [6.5 / 14, undefined, at(0, 2)]);
  return { id, cycle: 4, view: [72, 8], keys: keys(...list), scene: [], linear: true, work: [0, 1] };
}

/** 밴드 벌리기 — 가슴 앞에서 양옆으로, 날개뼈를 모으며 */
function bandPullApart(id: string): Clip {
  const arm = (plane: number): ArmSpec => ({ fk: [plane, 88, 0, 4], turn: 180 });
  const at = (plane: number, scap: number): Pose3 => standing({ armL: arm(plane), armR: arm(plane), scap: [0, scap] }, 0.15);
  const front = at(0, 0.2);
  const apart = at(80, -1);
  const list: KeyList = [[0, '양옆으로 벌리기', front], [0.42, '날개뼈 모으기', apart], [0.55, '천천히 모으기', apart], [1, undefined, front]];
  return { id, cycle: 2.6, view: [18, 22], keys: keys(...list), scene: [], cables: [{ from: 'L', to: 'R' }], work: [0, 0.55] };
}

/** W-Y 올리기 — 팔꿈치를 당겨 W, 머리 위로 뻗어 Y */
function wyRaise(id: string): Clip {
  const w = standing({ armL: { fk: [100, 48, 90, 128], turn: 90 }, armR: { fk: [100, 48, 90, 128], turn: 90 }, scap: [0, -1] }, 0.15);
  const y = standing({ armL: { fk: [62, 152, 10, 6], turn: 90 }, armR: { fk: [62, 152, 10, 6], turn: 90 }, scap: [0.4, -0.4] }, 0.15);
  const list: KeyList = [[0, 'W — 팔꿈치를 뒤로 당기기', w], [0.42, 'Y — 머리 위로 뻗기', y], [0.55, '다시 W로', y], [1, undefined, w]];
  return { id, cycle: 3, view: [160, 12], keys: keys(...list), scene: [], work: [0, 1] };
}

/** 네발 자세 몸통 — 무릎은 골반 밑, 기울기는 measure가 want가 되게 */
function quadruped(extra: Partial<Pose3>, measure: (s: Solved) => number, want: number): Pose3 {
  const base: Pose3 = { pelvis: [0, 0.5, 0], pitch: 88, spine: 0, neck: -6, ...kneelLegs(0), ...extra };
  return pitchFor(base, measure, want, 45, 135);
}

/** 등 회전 — 네발 자세에서 왼손을 뒤통수에, 팔꿈치를 바닥 쪽에서 천장 쪽으로 */
function thoracic(id: string): Clip {
  const rightShoulder = (s: Solved) => s.bones.upperArmR.a[1];
  const neutral = quadruped({}, (s) => (s.bones.upperArmL.a[1] + s.bones.upperArmR.a[1]) / 2, SHOULDER_ON_HANDS);
  const sR = shoulderOf(neutral, 'R');
  const hand = floorHand([sR[0] + 0.01, 0, sR[2] + 0.04], -1, [-0.4, 0.2, -1]);
  // 받친 오른팔은 곧게 — 몸을 돌려도 오른어깨 높이는 그대로 둔다
  const body = (twist: number, neck: number): Pose3 => ({ ...quadruped({ twist, neck }, rightShoulder, SHOULDER_ON_HANDS * 0.995), armR: hand, armL: behindHead(1) });
  const closed = body(-14, 4);
  const open = body(48, -18);
  const list: KeyList = [[0, '팔꿈치를 천장 쪽으로 열기', closed], [0.45, '끝에서 멈춤', open], [0.58, '천천히 아래로', open], [1, undefined, closed]];
  return { id, cycle: 3.4, view: [38, 26], keys: keys(...list), scene: [mat([0, 0, 0.2], 0.8, 1.3)], side: 'L', work: [0, 0.45] };
}

/** 서서 몸통 돌리기 — 골반은 앞, 가슴 앞에 팔을 모으고 좌우로 */
function standingRotation(id: string): Clip {
  const arms = {
    armL: { ik: [-0.04, 0.2, 0.2] as Vec3, in: 'chest' as const, pole: [1, -0.3, 0.1] as Vec3 },
    armR: { ik: [0.04, 0.19, 0.21] as Vec3, in: 'chest' as const, pole: [-1, -0.3, 0.1] as Vec3 },
  };
  const at = (twist: number): Pose3 => ({ ...standing({ ...arms, twist, neck: 0 }, 0.17, 10), pelvis: [0, STANDING_Y - 0.03, -0.03] });
  const list: KeyList = [[0, '왼쪽으로 돌리기', at(0)], [0.25, undefined, at(44)], [0.5, '오른쪽으로 돌리기', at(0)], [0.75, undefined, at(-44)], [1, undefined, at(0)]];
  return { id, cycle: 3.6, view: [16, 32], keys: keys(...list), scene: [], work: [0, 1] };
}

/** 고양이 · 소 — 네발 자세에서 등을 둥글게 말았다가 천천히 내린다 */
function catCow(id: string): Clip {
  const mid = (s: Solved) => (s.bones.upperArmL.a[1] + s.bones.upperArmR.a[1]) / 2;
  const neutral = quadruped({}, mid, SHOULDER_ON_HANDS);
  const s = shoulderMid(neutral);
  const hands = { armL: floorHand([0.2, 0, s[2] + 0.03], 1, [0.4, 0.2, -1]), armR: floorHand([-0.2, 0, s[2] + 0.03], -1, [-0.4, 0.2, -1]) };
  const cow = { ...quadruped({ spine: -26, neck: -26 }, mid, SHOULDER_ON_HANDS * 0.99), ...hands };
  const cat = { ...quadruped({ spine: 38, neck: 34 }, mid, SHOULDER_ON_HANDS * 0.99), ...hands };
  const list: KeyList = [[0, '내쉬며 등을 둥글게', cow], [0.42, '끝까지 말기', cat], [0.55, '들이쉬며 등을 내리기', cat], [1, undefined, cow]];
  return { id, cycle: 4, view: [90, 10], keys: keys(...list), scene: [mat([0, 0, 0.2], 0.8, 1.3)], work: [0, 1] };
}

/** 푸시업 · 다운독 — 발은 그 자리, 엉덩이를 높이 들었다가 다시 푸시업 자세로 */
function pushupDog(id: string): Clip {
  const ballZ = -0.88;
  const feet = (heel: number) => ({ legL: footOn([0.11, 0, ballZ], [0, 1, 0], [0, 0, 1], heel), legR: footOn([-0.11, 0, ballZ], [0, 1, 0], [0, 0, 1], heel) });
  const plankAt = (angle: number): Pose3 => {
    const legs = feet(90 - angle);
    const a = angle * DEG;
    const ankle = legs.legL.ankle!;
    const reach = Math.sqrt(LEG * LEG - (BODY.hip - 0.11) ** 2);
    return { pelvis: [0, ankle[1] + Math.sin(a) * reach, ankle[2] + Math.cos(a) * reach], pitch: 90 - angle, spine: 0, neck: -18, ...legs };
  };
  const angle = solveFor((a) => shoulderMid(plankAt(a))[1], 2, 40, SHOULDER_ON_HANDS);
  const top = plankAt(angle);
  const s = shoulderMid(top);
  const hands = { armL: floorHand([0.25, 0, s[2] + 0.06], 1, [0.45, 0.2, -1]), armR: floorHand([-0.25, 0, s[2] + 0.06], -1, [-0.45, 0.2, -1]) };
  const wrist: Vec3 = [0.25, PALM_Y, s[2] + 0.06 - BODY.grip];
  // 다운독: 다리를 곧게 편 채 엉덩이를 들고, 상체는 팔과 한 줄로 손을 향한다. 가는 길에도 팔은 곧게
  const reach = Math.sqrt(LEG * LEG - (BODY.hip - 0.11) ** 2);
  const dogAt = (b: number, heel: number): Pose3 => {
    const legs = feet(heel);
    const ankle = legs.legL.ankle!;
    const pelvis: Vec3 = [0, ankle[1] + Math.sin(b * DEG) * reach, ankle[2] + Math.cos(b * DEG) * reach];
    const base: Pose3 = { pelvis, pitch: 130, spine: 0, neck: -18 * Math.max(0, 1 - (b - angle) / 40), ...legs };
    const dist = (p: number) => {
      const sh = solved({ ...base, pitch: p }).bones.upperArmL.a;
      return Math.hypot(sh[0] - wrist[0], sh[1] - wrist[1], sh[2] - wrist[2]);
    };
    return { ...base, pitch: solveFor(dist, 60, 170, FLOOR_REACH), ...hands };
  };
  // 팔과 등이 한 줄이 되는 엉덩이 높이를 고른다
  let best = 55;
  let bestErr = Infinity;
  for (let b = 30; b <= 80; b += 1) {
    const sv = solved(dogAt(b, 36)).bones;
    const torso = normalize(sub(sv.chest.b, sv.lumbar.a));
    const arm = normalize(sub(wrist, sv.upperArmL.a));
    const err = 1 - (torso[0] * arm[0] + torso[1] * arm[1] + torso[2] * arm[2]);
    if (err < bestErr) { bestErr = err; best = b; }
  }
  const plank = { ...top, ...hands };
  const between = (u: number): Pose3 => (u <= 0 ? plank : dogAt(angle + (best - angle) * u, 90 - angle + (36 - 90 + angle) * u));
  // 가는 길을 여러 키로 — 키 사이는 등속이라 키 간격을 부드럽게(양 끝 천천히) 잡는다
  const smooth = (x: number) => x * x * (3 - 2 * x);
  const list: KeyList = [];
  const n = 6;
  for (let i = 0; i < n; i += 1) list.push([0.42 * (i / n), i === 0 ? '엉덩이를 높이' : undefined, between(smooth(i / n))]);
  list.push([0.42, '발뒤꿈치를 바닥 쪽으로', between(1)]);
  for (let i = 0; i < n; i += 1) list.push([0.58 + 0.42 * (i / n), i === 0 ? '다시 푸시업 자세로' : undefined, between(smooth(1 - i / n))]);
  list.push([1, undefined, plank]);
  return { id, cycle: 3.4, view: [76, 10], keys: keys(...list), scene: [mat([0, 0, -0.3], 0.8, 1.9)], linear: true, work: [0, 1] };
}

/** 벽 푸시업 — 벽에 손을 짚고, 몸을 곧게 편 채 가슴이 벽에 닿을 듯 */
function wallPushup(id: string): Clip {
  const wall = 1.02;
  const feet = { legL: plant(0.14, 0, 8), legR: plant(-0.14, 0, 8) };
  const reach = Math.sqrt(LEG * LEG - (0.14 - BODY.hip) ** 2);
  const lean = (deg: number): Pose3 => {
    const a = deg * DEG;
    const ankle = feet.legL.ankle!;
    return { pelvis: [0, ankle[1] + Math.cos(a) * reach, ankle[2] + Math.sin(a) * reach], pitch: deg, spine: 0, neck: -4, ...feet };
  };
  const grip = (side: 1 | -1): Vec3 => [side * 0.24, 1.32, wall - 0.02];
  const wristOf = (side: 1 | -1): Vec3 => sub(grip(side), [0, BODY.grip, 0]);
  const dist = (deg: number) => {
    const sh = shoulderOf(lean(deg), 'L');
    const w = wristOf(1);
    return Math.hypot(sh[0] - w[0], sh[1] - w[1], sh[2] - w[2]);
  };
  const hands = { armL: wallHand(grip(1), [0.7, -0.6, -0.4]), armR: wallHand(grip(-1), [-0.7, -0.6, -0.4]) };
  const top = { ...lean(solveFor(dist, 5, 45, FLOOR_REACH * 0.985)), ...hands };
  const low = { ...lean(solveFor(dist, 5, 45, 0.33)), ...hands };
  const list: KeyList = [[0, '가슴을 벽 쪽으로', top], [0.45, '닿을 듯 말 듯', low], [0.55, '밀기', low], [1, undefined, top]];
  return { id, cycle: 2.8, view: [80, 8], keys: keys(...list), scene: [wallAt(wall, 'z')], work: [0.55, 1] };
}

/** 손목 · 팔꿈치 돌리기 — 주먹 쥐고 손목을 돌리고, 팔꿈치를 굽혔다 편다 */
function wristElbow(id: string): Clip {
  const fwdArm = (wrist: number, turn: number): ArmSpec => ({ fk: [6, 62, 0, 34, wrist], turn });
  const curlArm = (elbow: number): ArmSpec => ({ fk: [4, 10, 0, elbow], turn: 0 });
  const at = (a: ArmSpec): Pose3 => standing({ armL: a, armR: a, neck: 6 }, 0.15);
  const circle = [fwdArm(48, 180), fwdArm(0, 120), fwdArm(-48, 180), fwdArm(0, 240)];
  const list: KeyList = [];
  for (let i = 0; i < 8; i += 1) list.push([i * 0.06, i === 0 ? '손목 돌리기' : undefined, at(circle[i % 4]!)]);
  list.push([0.48, undefined, at(fwdArm(48, 180))]);
  list.push([0.54, '팔꿈치 굽혔다 펴기', at(curlArm(8))]);
  list.push([0.64, undefined, at(curlArm(138))]);
  list.push([0.74, undefined, at(curlArm(8))]);
  list.push([0.84, undefined, at(curlArm(138))]);
  list.push([0.92, undefined, at(curlArm(8))]);
  list.push([1, undefined, at(circle[0]!)]);
  return { id, cycle: 4.4, view: [40, 10], keys: keys(...list), scene: [], work: [0, 1] };
}

/** 런지 + 몸통 돌리기 — 왼발을 크게 내딛고, 오른손은 바닥, 왼팔을 하늘로 뻗으며 몸통을 연다 */
function worldsGreatest(id: string): Clip {
  const front = plant(0.13, 0.5, 8, { pole: [0.3, 0.2, 1] });
  const back = ballAt(-0.12, -0.72, 4, 62, 0, [0, -0.2, 1]);
  const rightShoulder = (s: Solved) => s.bones.upperArmR.a[1];
  const torso = (twist: number, neck: number): Pose3 => {
    const base: Pose3 = { pelvis: [-0.02, 0.43, -0.02], pitch: 60, spine: 8, twist, neck, legL: front, legR: back };
    return pitchFor(base, rightShoulder, SHOULDER_ON_HANDS * 0.995, 20, 110);
  };
  const closedBody = torso(-6, -14);
  const sR = shoulderOf(closedBody, 'R');
  const hand = floorHand([Math.max(sR[0] + 0.08, -0.06), 0, sR[2] + 0.03], -1, [-0.5, 0.2, -1]);
  // 왼팔은 가슴 틀 기준 각도로 — 닫힐 때는 팔꿈치를 앞발 안쪽 바닥으로, 열 때는 옆(돌린 가슴의 위)으로 뻗는다
  const closed: Pose3 = { ...closedBody, armR: hand, armL: { fk: [-10, 84, 0, 70], turn: 90 } };
  const open: Pose3 = { ...torso(58, -26), armR: hand, armL: { fk: [88, 96, 0, 4], turn: 90 } };
  const list: KeyList = [[0, '왼팔을 하늘로 뻗기', closed], [0.45, '몸통을 끝까지 열기', open], [0.58, '팔꿈치를 발 안쪽으로', open], [1, undefined, closed]];
  return { id, cycle: 4, view: [48, 18], keys: keys(...list), scene: [], side: 'L', work: [0, 0.45] };
}

/** 다리 앞뒤 흔들기 — 기둥을 잡고 허리는 세운 채, 왼다리를 크게 */
function legSwing(id: string): Clip {
  const postX = -0.46;
  const at = (s: number): Pose3 => {
    const c = Math.cos(2 * Math.PI * s);
    // s = 0이 뒤, 0.5가 앞. 내려오는 길에 무릎을 살짝 굽혀 발이 바닥을 쓸지 않는다
    const flex = 22 - 46 * c;
    const knee = 10 + 12 * Math.max(0, 1 - Math.abs(flex - 20) / 45);
    return {
      pelvis: [-0.025, 0.925, -0.02], pitch: 1, spine: 0, neck: 0,
      legR: plant(-0.11, 0, 6),
      legL: { fk: [flex, 4, 0, knee, 10] },
      armR: { ik: [postX + 0.05, 1.08, 0.04], pole: [-0.3, -1, -0.4], hand: [0, 1, 0] },
      armL: { fk: [86, 28, 0, 14], turn: 90 },
    };
  };
  return {
    id, cycle: 1.8, view: [86, 8], keys: keys(...sampled(12, at, [[0, '앞으로 크게'], [0.5, '뒤로 크게']])), linear: true,
    scene: [post(postX, 0.04)], side: 'L', work: [0, 1],
  };
}

/** 맨몸 힙 힌지 — 손은 골반에, 엉덩이를 뒤로 빼며 숙였다 일어난다. 등은 곧게 */
function hipHinge(id: string): Clip {
  const top: Pose3 = { ...standing({ ...handsOnHips(), neck: 0 }, 0.14, 8) };
  const pelvis = pelvisFromLegs(top.legL!, 22, -0.17);
  const low: Pose3 = { ...top, pelvis, pitch: 58, spine: 0, neck: -12 };
  const list: KeyList = [[0, '엉덩이를 뒤로 빼며 숙이기', top], [0.45, '등은 곧게', low], [0.55, '엉덩이를 밀며 일어나기', low], [1, undefined, top]];
  return { id, cycle: 3, view: [84, 8], keys: keys(...list), scene: [], work: [0.55, 1] };
}

/** 발목 앞뒤로 밀기 — 벽 앞에서 왼무릎을 벽 쪽으로 밀었다 뺀다. 뒤꿈치는 바닥에 */
function ankleRock(id: string): Clip {
  const front = plant(0.11, 0.2, 6, { pole: [0.1, 0.2, 1] });
  const back = plant(-0.11, -0.36, 6);
  const torso = (y: number, z: number, pitch: number): Pose3 => ({ pelvis: [0.01, y, z], pitch, spine: 0, neck: -4, legL: front, legR: back });
  // 벽은 뺀 자세에서 팔을 거의 펴고 닿는 곳에
  const s = shoulderMid(torso(0.85, 0, 8));
  const wall = s[2] + 0.5;
  const grip = (side: 1 | -1): Vec3 => [side * 0.24, s[1] - 0.06, wall - 0.02];
  const hands = { armL: wallHand(grip(1), [0.7, -0.6, -0.4]), armR: wallHand(grip(-1), [-0.7, -0.6, -0.4]) };
  const out = { ...torso(0.85, 0, 8), ...hands };
  const inn = { ...torso(0.8, 0.1, 12), ...hands };
  const list: KeyList = [[0, '무릎을 벽 쪽으로', out], [0.45, '뒤꿈치는 바닥에', inn], [0.55, '천천히 빼기', inn], [1, undefined, out]];
  return { id, cycle: 2.4, view: [76, 10], keys: keys(...list), scene: [wallAt(wall, 'z')], side: 'L', work: [0, 0.45] };
}

/** 서서 무릎 · 팔꿈치 닿기 — 무릎을 들어 반대 팔꿈치에, 번갈아 */
function standingKnee(id: string): Clip {
  const arms = { armL: behindHead(1), armR: behindHead(-1) };
  const stand = standing({ ...arms, neck: 0 }, 0.12, 8);
  const lift = (side: Side): Pose3 => {
    const sign = side === 'L' ? 1 : -1;
    const raised: Pose3 = {
      ...stand, pelvis: [-sign * 0.02, STANDING_Y + 0.005, -0.02], twist: sign * 28, spine: 22, bend: sign * 6, neck: 10,
      [side === 'L' ? 'legL' : 'legR']: { fk: [104, -sign * 0, 0, 100, 0] },
    };
    const leg = legAsIk(raised, side);
    return side === 'L' ? { ...raised, legL: leg } : { ...raised, legR: leg };
  };
  const list: KeyList = [[0, '왼무릎 → 오른팔꿈치', stand], [0.22, undefined, lift('L')], [0.32, undefined, lift('L')], [0.5, '오른무릎 → 왼팔꿈치', stand], [0.72, undefined, lift('R')], [0.82, undefined, lift('R')], [1, undefined, stand]];
  return { id, cycle: 3.2, view: [26, 10], keys: keys(...list), scene: [], work: [0, 1] };
}

/* ── 마무리 스트레칭 (버티기) ─────────────────────── */

/** 가슴 — 왼팔을 기둥에 대고(팔꿈치는 어깨 높이), 몸을 오른쪽으로 돌린다 */
function chestDoorway(id: string): Clip {
  const body = (yaw: number, z: number): Pose3 => ({ ...standing({ neck: 0, armR: { fk: [6, 6, 0, 10], turn: 90 } }, 0.14, 8), yaw, pelvis: [0, STANDING_Y, z] });
  const base = body(-18, 0.06);
  const s = shoulderOf(base, 'L');
  // 팔꿈치는 어깨 높이에서 옆 · 살짝 뒤로, 아래팔은 세워 기둥 앞면에
  const elbow = add(s, scale(normalize([1, 0, -0.42]), BODY.upperArm));
  const grip = add(elbow, [0, BODY.forearm + BODY.grip - 0.01, 0]);
  const arm: ArmSpec = { ik: grip, pole: [0.2, -1, -0.1] };
  const postZ = elbow[2] - 0.04 - 0.045;
  const pose = { ...base, armL: arm };
  const deeper = { ...body(-21, 0.07), armL: arm };
  return holdClip(id, pose, deeper, '몸을 반대로 돌리기', [52, 14], [{ kind: 'post', p: [elbow[0] + 0.02, 1.1, postZ], size: [0.1, 2.2, 0.09] }]);
}

/** 광배 — 기둥을 잡고 엉덩이를 뒤 · 오른쪽으로 빼 왼옆구리를 늘린다 */
function latHang(id: string): Clip {
  const feet = { legL: plant(0.13, 0, 8, { pole: [0.2, 0.2, 1] }), legR: plant(-0.13, 0, 8, { pole: [-0.2, 0.2, 1] }) };
  const torso = (back: number, shift: number, bend: number): Pose3 => {
    const p = pelvisFromLegs(feet.legL, 46, back);
    return { pelvis: [shift, p[1], back], pitch: 72, spine: 4, bend, neck: -14, ...feet };
  };
  // 기둥은 두 손이 팔을 거의 펴고 닿는 자리에 — 왼손이 위, 오른손이 아래
  const base = torso(-0.26, -0.08, 20);
  const sL = shoulderOf(base, 'L');
  const sR = shoulderOf(base, 'R');
  const yL = sL[1] + 0.06;
  const yR = sL[1] - 0.06;
  const reachZ = (s: Vec3, y: number) => s[2] + Math.sqrt(Math.max(0, STRAIGHT_ARM ** 2 - (s[1] - y) ** 2 - s[0] ** 2));
  const postZ = Math.min(reachZ(sL, yL), reachZ(sR, yR)) + 0.045;
  const hands = {
    armL: { ik: [0.01, yL, postZ - 0.045] as Vec3, pole: [0.4, -0.3, -1] as Vec3, hand: [0, 1, 0] as Vec3 },
    armR: { ik: [-0.01, yR, postZ - 0.045] as Vec3, pole: [-0.4, -0.6, -1] as Vec3, hand: [0, 1, 0] as Vec3 },
  };
  const pose = { ...base, ...hands };
  const deeper = { ...torso(-0.268, -0.085, 21.5), ...hands };
  return holdClip(id, pose, deeper, '엉덩이를 뒤로, 옆구리 늘리기', [128, 26], [post(0, postZ)]);
}

/** 어깨 뒤쪽 — 왼팔을 가슴 앞으로 당기고 오른팔로 팔꿈치 위를 누른다 */
function crossArm(id: string): Clip {
  const body = (plane: number): Pose3 => {
    const base = standing({ neck: 0, armL: { fk: [plane, 90, 0, 4], turn: 90 } }, 0.14, 8);
    const b = solved(base).bones;
    const elbow = b.forearmL.a;
    // 오른손은 왼팔꿈치 바로 위(어깨 쪽) 바깥에서 몸 쪽으로 감싼다
    const target = add(madd(elbow, normalize(sub(b.upperArmL.a, elbow)), 0.06), [0, -0.03, 0.05]);
    return { ...base, armR: { ik: target, pole: [-0.4, -1, -0.2] } };
  };
  return holdClip(id, body(-42), body(-45), '팔을 가슴 쪽으로 당기기', [24, 10], []);
}

/** 삼두 — 왼팔꿈치를 머리 뒤로 접고 오른손으로 지그시 누른다 */
function tricepsOverhead(id: string): Clip {
  const body = (elev: number): Pose3 => {
    const base = standing({ neck: 8, scapL: [0.7, 0], armL: { fk: [14, elev, 6, 140], turn: 90 } }, 0.14, 8);
    const b = solved(base).bones;
    const elbow = b.forearmL.a;
    return { ...base, armR: { ik: add(elbow, [-0.02, 0.03, 0.04]), pole: [-1, 0.1, 0.3] } };
  };
  return holdClip(id, body(168), body(171), '팔꿈치를 지그시 누르기', [46, 10], []);
}

/** 이두 · 팔 앞쪽 — 왼손바닥을 옆 벽에 대고(손가락은 뒤로) 몸을 오른쪽으로 돌린다 */
function bicepsWall(id: string): Clip {
  const body = (yaw: number): Pose3 => ({ ...standing({ neck: 0, armR: { fk: [6, 6, 0, 10], turn: 90 } }, 0.14, 8), yaw });
  const base = body(-22);
  const s = shoulderOf(base, 'L');
  const wrist = add(s, scale(normalize([1, -0.04, -0.5]), FLOOR_REACH));
  const grip = add(wrist, [0, 0, -BODY.grip]);
  const arm: ArmSpec = { ik: grip, pole: [0, -1, 0.2], point: [0, 0, -1], hand: [0, -1, 0] };
  const wall = grip[0] + 0.02;
  return holdClip(id, { ...base, armL: arm }, { ...body(-25), armL: arm }, '몸을 반대로 돌리기', [-34, 12], [wallAt(wall, 'x', grip[2], 1.4)]);
}

/** 앞허벅지 — 왼발목을 잡아 뒤꿈치를 엉덩이 쪽으로, 무릎은 아래를 보게. 오른손은 기둥 */
function quadStand(id: string): Clip {
  const postX = -0.48;
  const body = (knee: number): Pose3 => {
    const base: Pose3 = {
      pelvis: [-0.025, 0.92, -0.02], pitch: 4, spine: 0, bend: -4, neck: 0,
      legR: plant(-0.11, 0, 6),
      legL: { fk: [-4, 1, 0, knee, -40] },
      armR: { ik: [postX + 0.05, 1.1, 0.06], pole: [-0.3, -1, -0.4], hand: [0, 1, 0] },
    };
    const b = solved(base).bones;
    const ankle = b.shinL.b;
    // 손은 발등 쪽 발목을 감싼다 — 발목 앞(발등 방향)에서 조금 바깥
    const target = add(madd(ankle, b.footL.f, 0.03), [0.04, 0.02, 0]);
    return { ...base, armL: { ik: target, pole: [0.5, -0.2, -1] } };
  };
  return holdClip(id, body(138), body(140), '뒤꿈치를 엉덩이 쪽으로', [90, 8], [post(postX, 0.06)]);
}

/** 뒤허벅지 — 왼다리를 앞에 펴 뒤꿈치를 대고, 등을 편 채 엉덩이부터 숙인다 */
function hamstringReach(id: string): Clip {
  const toeUp = 24 * DEG;
  const heel: Vec3 = [0.11, 0, 0.42];
  const fwd: Vec3 = [0, Math.sin(toeUp), Math.cos(toeUp)];
  const up: Vec3 = [0, Math.cos(toeUp), -Math.sin(toeUp)];
  const legL: LegSpec = { ankle: add(madd(heel, fwd, BODY.heel), scale(up, BODY.ankle)), fwd, up, pole: [0, 0.3, 1] };
  const legR = plant(-0.11, -0.12, 8, { pole: [-0.1, 0.2, 1] });
  const body = (pitch: number, back: number): Pose3 => {
    const pelvis = pelvisFromLegs(legL, 4, back);
    const base: Pose3 = { pelvis, pitch, spine: 4, neck: -14, legL, legR };
    const b = solved(base).bones;
    const knee = b.thighL.b;
    const above = madd(knee, normalize(sub(b.thighL.a, knee)), 0.1);
    return {
      ...base,
      armL: { ik: add(above, [0.06, 0.06, 0]), pole: [0.6, -0.2, -1] },
      armR: { ik: add(above, [-0.05, 0.07, 0.01]), pole: [-0.6, -0.2, -1] },
    };
  };
  return holdClip(id, body(54, -0.1), body(56, -0.105), '등을 편 채 엉덩이부터 숙이기', [82, 8], []);
}

/** 엉덩이 — 누워서 왼발목을 오른무릎에 올리고, 오른허벅지를 가슴 쪽으로 당긴다 */
function figureFour(id: string): Clip {
  const body = (flex: number): Pose3 => {
    const base: Pose3 = { pelvis: [0, 0.11, 0.1], pitch: -90, spine: 6, neck: 14, legR: { fk: [flex, 6, 0, 88, 4] } };
    const b = solved(base).bones;
    const kneeR = b.shinR.a;
    const down = normalize(sub(b.thighR.a, kneeR));
    const front = b.thighR.f;
    // 왼발목 바깥이 오른무릎 바로 밑 허벅지 앞에 얹힌다
    const ankle = add(add(madd(kneeR, down, 0.06), scale(front, 0.085)), [0.02, 0, 0]);
    const legL: LegSpec = { ankle, fwd: normalize([-1, 0.1, 0.25]), up: normalize([0, 0.3, 1]), pole: [1, 0.25, 0.5] };
    // 두 손은 오른허벅지 뒤에서 깍지 — 왼손은 두 다리 사이로
    const behind = add(madd(kneeR, down, 0.17), scale(front, -0.075));
    return {
      ...base, legL,
      armL: { ik: add(behind, [0.03, 0, 0]), pole: [0.8, -0.3, 0.3] },
      armR: { ik: add(behind, [-0.05, 0, 0]), pole: [-0.8, -0.3, 0.3] },
    };
  };
  return holdClip(id, body(104), body(107), '오른허벅지를 가슴 쪽으로', [110, 28], [mat([0, 0, -0.1], 0.75, 1.8)]);
}

/** 종아리 — 벽을 밀고, 뒤에 둔 왼다리는 펴서 뒤꿈치를 바닥에 붙인 채 몸을 앞으로 */
function calfWall(id: string): Clip {
  const back = plant(0.11, -0.52, 6);
  const front = plant(-0.11, 0.16, 6, { pole: [-0.1, 0.2, 1] });
  const reach = Math.sqrt((LEG_STRAIGHT) ** 2 - (0.11 - BODY.hip) ** 2);
  const lean = (deg: number): Pose3 => {
    const a = deg * DEG;
    const ankle = back.ankle!;
    return { pelvis: [0, ankle[1] + Math.cos(a) * reach, ankle[2] + Math.sin(a) * reach], pitch: deg - 2, spine: 0, neck: -4, legL: back, legR: front };
  };
  const base = lean(30);
  const s = shoulderMid(base);
  const wall = s[2] + 0.42;
  const grip = (side: 1 | -1): Vec3 => [side * 0.23, s[1] - 0.02, wall - 0.02];
  const hands = { armL: wallHand(grip(1), [0.7, -0.6, -0.4]), armR: wallHand(grip(-1), [-0.7, -0.6, -0.4]) };
  return holdClip(id, { ...base, ...hands }, { ...lean(31), ...hands }, '뒤꿈치를 붙인 채 앞으로', [84, 8], [wallAt(wall, 'z')]);
}

/** 복부 — 엎드려 팔로 상체를 밀어 올린다. 골반은 바닥에 */
function cobra(id: string): Clip {
  // 허리를 젖히고 골반은 바닥에 — 골반이 기운 만큼 다리를 펴 바닥에 눕힌다
  const body = (pitch: number, spine: number): Pose3 => {
    const legs = { fk: [pitch - 90, 3, 0, 2, -72] };
    return { pelvis: [0, 0.115, 0], pitch, spine, neck: -16, legL: legs, legR: { ...legs } };
  };
  const spine = -46;
  const pitch = solveFor((p) => shoulderMid(body(p, spine))[1], 90, 40, SHOULDER_ON_HANDS * 0.92);
  const pose0 = body(pitch, spine);
  const s = shoulderMid(pose0);
  const hands = { armL: floorHand([0.22, 0, s[2] + 0.03], 1, [0.5, 0.2, -1]), armR: floorHand([-0.22, 0, s[2] + 0.03], -1, [-0.5, 0.2, -1]) };
  return holdClip(id, { ...pose0, ...hands }, { ...body(pitch - 0.5, spine - 2), ...hands }, '팔로 상체를 밀어 올리기', [55, 12], [mat([0, 0, 0.1], 0.75, 1.9)], false);
}

/** 호흡 정리 — 코로 4초 들이쉬며 팔을 옆으로 올리고, 입으로 6초 내쉬며 내린다 */
function breath(id: string): Clip {
  const arm = (elev: number): ArmSpec => ({ fk: [82, elev, 0, 10], turn: 90 });
  const low = standing({ armL: arm(12), armR: arm(12), neck: 2 }, 0.13, 8);
  const high: Pose3 = { ...standing({ armL: arm(84), armR: arm(84), neck: -4, spine: -6, scap: [0.15, -0.4] }, 0.13, 8) };
  const list: KeyList = [[0, '코로 들이쉬기 4초', low], [0.4, '입으로 내쉬기 6초', high], [1, undefined, low]];
  return { id, cycle: 10, view: [16, 8], keys: keys(...list), scene: [], work: [0, 0.4] };
}

/* ── 목록 ────────────────────────────────────────── */

/** 버티는 스트레칭인가 움직이는 동작인가 */
export type StretchStyle = 'hold' | 'move';

interface Entry {
  make: (id: string) => Clip;
  style: StretchStyle;
}

const move = (make: (id: string) => Clip): Entry => ({ make, style: 'move' });
const hold = (make: (id: string) => Clip): Entry => ({ make, style: 'hold' });

const STRETCHES: Record<string, Entry> = {
  // 시작 — 유산소 기구
  'treadmill-walk': move(treadmillWalk),
  'bike-easy': move(bikeEasy),
  'row-easy': move(rowEasy),
  'stairs-easy': move(stairsEasy),
  // 폼롤러
  'roll-upper-back': move(rollUpperBack),
  'roll-lats': move(rollLats),
  'roll-quads': move(rollQuads),
  'roll-glutes': move(rollGlutes),
  'roll-hams-calves': move(rollHamsCalves),
  'roll-chest': move(rollChest),
  // 움직이는 스트레칭
  'arm-circle': move(armCircle),
  'band-pull-apart': move(bandPullApart),
  'wy-raise': move(wyRaise),
  'thoracic': move(thoracic),
  'standing-rotation': move(standingRotation),
  'cat-cow': move(catCow),
  'pushup-dog': move(pushupDog),
  'wall-pushup': move(wallPushup),
  'wrist-elbow': move(wristElbow),
  'bw-squat': move((id) => squat(id, 'body')),
  'worlds-greatest': move(worldsGreatest),
  'leg-swing': move(legSwing),
  'glute-bridge': move((id) => hipThrust(id, 'bridge')),
  'hip-hinge': move(hipHinge),
  'ankle-rock': move(ankleRock),
  'dead-bug': move((id) => deadBug(id)),
  'standing-knee': move(standingKnee),
  // 마무리 스트레칭
  'chest-doorway': hold(chestDoorway),
  'lat-hang': hold(latHang),
  'cross-arm': hold(crossArm),
  'triceps-overhead': hold(tricepsOverhead),
  'biceps-wall': hold(bicepsWall),
  'quad-stand': hold(quadStand),
  'hamstring-reach': hold(hamstringReach),
  'figure-four': hold(figureFour),
  'calf-wall': hold(calfWall),
  'cobra': hold(cobra),
  'breath': move(breath),
};

const cache = new Map<string, Clip>();

/**
 * 몸 풀기 · 마무리 스트레칭 동작 하나의 시연. 없는 동작이면 null.
 *
 * side는 한쪽씩 하는 동작에서 어느 쪽을 보여 줄지 — 기본은 왼쪽('L'). 'R'이면 좌우를 뒤집은
 * 시연을 준다. 양쪽을 같이 하는 동작은 side와 상관없이 같은 시연이다.
 */
export function stretchMotionFor(stepId: string, side: Side | 'left' | 'right' = 'L'): Clip | null {
  const entry = STRETCHES[stepId];
  if (!entry) return null;
  let clip = cache.get(stepId);
  if (!clip) {
    clip = entry.make(stepId);
    cache.set(stepId, clip);
  }
  const want: Side = side === 'right' || side === 'R' ? 'R' : 'L';
  return clip.side && clip.side !== want ? mirrorClip(clip) : clip;
}

/** 버티는 스트레칭('hold')인가 움직이는 동작('move')인가. 없는 동작이면 null */
export function stretchStyle(stepId: string): StretchStyle | null {
  return STRETCHES[stepId]?.style ?? null;
}

/** 시연이 있는 몸 풀기 · 마무리 동작 id 전부 */
export function stretchMotionIds(): string[] {
  return Object.keys(STRETCHES);
}
