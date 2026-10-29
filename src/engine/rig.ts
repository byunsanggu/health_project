/**
 * 시연용 인체 뼈대.
 *
 * 예전 시연은 관절 각도 몇 개(옆에서 본 굽힘)만 있어서, 팔을 옆으로 드는 동작(레터럴 레이즈)도
 * 무릎을 펴는 동작(레그 익스텐션)도 전부 "팔꿈치 굽히기"로 나왔다. 손이 바를 놓치고, 발이
 * 바닥을 뚫어도 알 길이 없었다.
 *
 * 여기서는 두 가지로 몸을 움직인다.
 *
 *   관절 각도(fk)  — 팔을 몇 도 들고 팔꿈치를 몇 도 굽히는지. 고립 운동에 맞다.
 *   닿을 곳(ik)    — 손바닥이 바 위 어디에, 발이 바닥 어디에 있는지. 팔꿈치 · 무릎은 계산한다.
 *                    벤치프레스 · 데드리프트처럼 손이 기구에 붙어 있는 동작에 맞다.
 *
 * 닿을 곳으로 움직이면 "손이 못 미친 거리"가 나온다. 테스트가 그 거리를 본다 — 시연 데이터를
 * 고치다 손이 바에서 떨어지면 화면을 보기 전에 테스트가 먼저 잡는다.
 *
 * 좌표: y가 위, 사람은 +z를 보고 선다, +x가 그 사람의 왼쪽. 단위는 m, 각도는 도.
 * 오른쪽 팔다리는 왼쪽과 같은 값으로 풀고 좌우를 뒤집는다 — 각도 부호를 양쪽 따로 외울 필요가 없다.
 */

export type Vec3 = [number, number, number];

const DEG = Math.PI / 180;

export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
/** a + b·s */
export const madd = (a: Vec3, b: Vec3, s: number): Vec3 => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];
export const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const length = (a: Vec3): number => Math.sqrt(dot(a, a));
export const distance = (a: Vec3, b: Vec3): number => length(sub(a, b));

/** 길이 1로. 0에 가까우면 fallback을 쓴다 — 곧게 편 팔처럼 방향이 안 정해지는 자리가 있다. */
export function normalize(a: Vec3, fallback: Vec3 = [0, 1, 0]): Vec3 {
  const l = length(a);
  return l < 1e-9 ? fallback : [a[0] / l, a[1] / l, a[2] / l];
}

/** b에서 a 방향 성분을 뺀다 (a는 길이 1). */
export function perpendicular(b: Vec3, a: Vec3): Vec3 {
  return madd(b, a, -dot(b, a));
}

/** 축(길이 1) 둘레로 deg만큼 돌린다. 오른손 법칙. */
export function rotateAbout(v: Vec3, axis: Vec3, deg: number): Vec3 {
  const t = deg * DEG;
  const c = Math.cos(t);
  const s = Math.sin(t);
  const k = axis;
  const kv = cross(k, v);
  const kd = dot(k, v) * (1 - c);
  return [
    v[0] * c + kv[0] * s + k[0] * kd,
    v[1] * c + kv[1] * s + k[1] * kd,
    v[2] * c + kv[2] * s + k[2] * kd,
  ];
}

/** 몸에 붙은 좌표틀. x = 그 몸의 왼쪽, y = 위(뼈 방향), z = 앞. */
export interface Frame { o: Vec3; x: Vec3; y: Vec3; z: Vec3 }

export const WORLD: Frame = { o: [0, 0, 0], x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };

/** 틀의 자기 축 둘레로 돌린다. turn(f,'x',+)는 앞으로 숙이기(위가 앞으로)다. */
export function turn(f: Frame, axis: 'x' | 'y' | 'z', deg: number): Frame {
  if (!deg) return f;
  const k = f[axis];
  return {
    o: f.o,
    x: axis === 'x' ? f.x : rotateAbout(f.x, k, deg),
    y: axis === 'y' ? f.y : rotateAbout(f.y, k, deg),
    z: axis === 'z' ? f.z : rotateAbout(f.z, k, deg),
  };
}

/** 틀 안의 점 → 세계 좌표. */
export function point(f: Frame, local: Vec3): Vec3 {
  return [
    f.o[0] + f.x[0] * local[0] + f.y[0] * local[1] + f.z[0] * local[2],
    f.o[1] + f.x[1] * local[0] + f.y[1] * local[1] + f.z[1] * local[2],
    f.o[2] + f.x[2] * local[0] + f.y[2] * local[1] + f.z[2] * local[2],
  ];
}

/** 틀 안의 방향 → 세계 방향. */
export function direction(f: Frame, local: Vec3): Vec3 {
  return [
    f.x[0] * local[0] + f.y[0] * local[1] + f.z[0] * local[2],
    f.x[1] * local[0] + f.y[1] * local[1] + f.z[1] * local[2],
    f.x[2] * local[0] + f.y[2] * local[1] + f.z[2] * local[2],
  ];
}

/* ── 몸 치수 ─────────────────────────────────────── */

/**
 * 키 172cm 안팎의 표준 몸. 비율은 인체 계측 평균을 따랐다 — 팔이 짧으면 데드리프트에서
 * 바가 무릎에 걸리고, 길면 벤치프레스가 반만 내려간다.
 */
export const BODY = {
  /** 고관절 좌우 간격의 반 */
  hip: 0.09,
  thigh: 0.43,
  shin: 0.42,
  /** 발바닥에서 발목 관절까지 */
  ankle: 0.075,
  heel: 0.055,
  toe: 0.19,
  /** 발목에서 발볼(앞꿈치)까지 */
  ball: 0.135,
  /** 골반 틀에서 허리뼈가 시작하는 곳 */
  lumbarBase: [0, 0.06, -0.025] as Vec3,
  lumbar: 0.16,
  thorax: 0.31,
  /** 가슴 틀에서 왼쪽 어깨 관절 */
  shoulder: [0.18, 0.245, -0.015] as Vec3,
  neck: 0.08,
  upperArm: 0.29,
  forearm: 0.25,
  /** 손목에서 손바닥 가운데(쥔 곳)까지 */
  grip: 0.075,
} as const;

/** 어깨에서 손바닥 가운데까지 다 편 길이 */
export const ARM_REACH = BODY.upperArm + BODY.forearm + BODY.grip;
/** 고관절에서 발목까지 다 편 길이 */
export const LEG_REACH = BODY.thigh + BODY.shin;
/** 무릎을 살짝만 굽히고 섰을 때 골반 높이 */
export const STAND_HEIGHT = 0.915;

/* ── 자세 ───────────────────────────────────────── */

export type FrameName = 'world' | 'pelvis' | 'chest';

/**
 * 팔.
 *   fk  — [올리는 면, 올린 각, 돌림, 팔꿈치, 손목]. 면 0 = 앞으로, 90 = 옆으로. 올린 각 0 = 늘어뜨림,
 *         180 = 머리 위. 돌림 + = 바깥으로. 손목 + = 손바닥 쪽으로 굽힘.
 *   ik  — 손바닥 가운데가 갈 곳(in 틀 기준).  bar — 바 가운데에서 바를 따라 이만큼.
 *   pole — ik · bar일 때 팔꿈치가 향할 쪽.  hand — 손잡이 방향.  turn — fk일 때 손잡이를 돌린 각
 *         (0 = 손바닥이 팔 앞쪽, 90 = 중립, 180 = 손등이 앞쪽).
 */
export interface ArmSpec {
  fk?: number[];
  ik?: Vec3;
  bar?: number;
  in?: FrameName;
  pole?: Vec3;
  hand?: Vec3;
  turn?: number;
  /** ik일 때 손가락이 향할 쪽 — 바닥을 짚는 손(푸시업 · 플랭크). 없으면 손목을 곧게 */
  point?: Vec3;
}

/**
 * 다리.
 *   fk    — [굽힘, 벌림, 돌림, 무릎, 발목]. 발목 + = 발끝을 들어 올림.
 *   ankle — 발목이 갈 곳. fwd · up은 발이 향한 쪽과 발등 쪽(그 틀 기준).  pole — 무릎이 향할 쪽.
 */
export interface LegSpec {
  fk?: number[];
  ankle?: Vec3;
  fwd?: Vec3;
  up?: Vec3;
  pole?: Vec3;
  in?: FrameName;
  /** 딛은 면의 위쪽 — 뒤꿈치를 들면 발가락은 꺾여 이 면에 눕는다 */
  ground?: Vec3;
}

export interface Pose3 {
  /** 골반(두 고관절 사이) 위치 — 세계 좌표 */
  pelvis: Vec3;
  /** 몸 전체 기울기. pitch + = 앞으로 숙임, yaw + = 왼쪽으로 돎, roll + = 오른쪽으로 기울임 */
  pitch?: number;
  yaw?: number;
  roll?: number;
  /** 허리 · 등 굽힘(+ 앞으로 말림, − 뒤로 젖힘) · 비틀기(+ 왼쪽으로) · 옆으로 굽히기(+ 오른쪽으로) */
  spine?: number;
  twist?: number;
  bend?: number;
  /** 목 굽힘 (+ 턱을 당김) */
  neck?: number;
  /** 날개뼈 — [으쓱(0~1), 앞으로 밀기(−1 모으기 ~ 1 밀기)] */
  scap?: number[];
  scapL?: number[];
  scapR?: number[];
  armL?: ArmSpec;
  armR?: ArmSpec;
  legL?: LegSpec;
  legR?: LegSpec;
  /** 바 — 가운데 위치와 축 방향(in 틀 기준) */
  bar?: { at: Vec3; dir?: Vec3; in?: FrameName };
}

/* ── 풀린 뼈 ─────────────────────────────────────── */

export const BONES = [
  'pelvis', 'lumbar', 'chest', 'neck', 'head',
  'upperArmL', 'forearmL', 'handL', 'upperArmR', 'forearmR', 'handR',
  'thighL', 'shinL', 'footL', 'thighR', 'shinR', 'footR',
] as const;
export type BoneName = typeof BONES[number];

/** 뼈 하나 — a에서 b로 뻗고, f가 앞(무릎뼈 · 이두 · 손바닥 · 발등 쪽). */
export interface Bone { a: Vec3; b: Vec3; f: Vec3 }

export interface Hand {
  /** 손바닥 가운데(쥔 곳) */
  grip: Vec3;
  /** 손잡이 방향 */
  axis: Vec3;
  /** 손바닥이 향한 쪽 */
  palm: Vec3;
}

export interface Solved {
  bones: Record<BoneName, Bone>;
  hands: { L: Hand; R: Hand };
  frames: { pelvis: Frame; chest: Frame; head: Frame };
  bar?: { c: Vec3; x: Vec3 };
  /** 손 · 발이 목표에 못 미친 거리(m). 0이면 닿았다 */
  miss: { armL: number; armR: number; legL: number; legR: number };
}

const MIRROR = (v: Vec3): Vec3 => [-v[0], v[1], v[2]];

function frameOf(name: FrameName | undefined, frames: { pelvis: Frame; chest: Frame }): Frame {
  if (name === 'pelvis') return frames.pelvis;
  if (name === 'chest') return frames.chest;
  return WORLD;
}

/**
 * 두 마디 팔다리 풀기. 뿌리 r에서 목표 t로, 첫 마디 a · 둘째 마디 b, 가운데 관절은 pole 쪽으로.
 * 못 미치면 다 편 채로 목표 쪽을 가리키고, 못 미친 거리를 돌려준다.
 */
export function twoBone(r: Vec3, t: Vec3, a: number, b: number, pole: Vec3): { mid: Vec3; end: Vec3; bend: Vec3; miss: number } {
  const v = sub(t, r);
  const raw = length(v);
  const u = normalize(v, [0, -1, 0]);
  const d = Math.min(Math.max(raw, Math.abs(a - b) + 1e-4), (a + b) * 0.9995);
  const miss = Math.max(0, raw - (a + b));
  let w = perpendicular(pole, u);
  if (length(w) < 1e-6) w = perpendicular([0, 0, 1], u);
  if (length(w) < 1e-6) w = perpendicular([1, 0, 0], u);
  w = normalize(w);
  const cosA = (a * a + d * d - b * b) / (2 * a * d);
  const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
  const mid = add(r, add(scale(u, a * cosA), scale(w, a * sinA)));
  return { mid, end: madd(r, u, d), bend: w, miss };
}

/** 위팔 · 아래팔 · 손을 각도로 (왼팔 기준, 가슴 틀 안의 방향). */
function armFk(spec: number[]): { upper: Vec3; front: Vec3; fore: Vec3; foreFront: Vec3; wrist: number } {
  const [plane = 0, elev = 0, rot = 0, elbow = 0, wrist = 0] = spec;
  // 늘어뜨린 팔을 (면, 각)으로 올린다 — 가장 짧은 돌림으로 올려야 앞면이 엉뚱하게 꼬이지 않는다
  const axis = normalize([-Math.cos(plane * DEG), 0, Math.sin(plane * DEG)], [1, 0, 0]);
  let upper = rotateAbout([0, -1, 0], axis, elev);
  let front = rotateAbout([0, 0, 1], axis, elev);
  // 바깥 돌림(+)은 앞면을 바깥(+x)으로 — 왼팔에서 위팔 축 둘레 음의 회전
  front = rotateAbout(front, upper, -rot);
  upper = normalize(upper);
  const e = elbow * DEG;
  const fore = normalize(add(scale(upper, Math.cos(e)), scale(front, Math.sin(e))));
  const foreFront = normalize(add(scale(upper, -Math.sin(e)), scale(front, Math.cos(e))));
  return { upper, front, fore, foreFront, wrist };
}

/** 넓적다리 · 정강이 · 발을 각도로 (왼다리 기준, 골반 틀 안의 방향). */
function legFk(spec: number[]): { thigh: Vec3; front: Vec3; shin: Vec3; shinFront: Vec3; foot: Vec3; footUp: Vec3 } {
  const [flex = 0, abd = 0, rot = 0, knee = 0, ankle = 0] = spec;
  const swing = (v: Vec3): Vec3 => rotateAbout(rotateAbout(v, [0, 0, 1], abd), [1, 0, 0], -flex);
  const thigh = normalize(swing([0, -1, 0]));
  const front = normalize(rotateAbout(swing([0, 0, 1]), thigh, -rot));
  const k = knee * DEG;
  const shin = normalize(add(scale(thigh, Math.cos(k)), scale(front, -Math.sin(k))));
  const shinFront = normalize(add(scale(thigh, Math.sin(k)), scale(front, Math.cos(k))));
  const an = ankle * DEG;
  const foot = normalize(add(scale(shinFront, Math.cos(an)), scale(shin, -Math.sin(an))));
  const footUp = normalize(add(scale(shin, -Math.cos(an)), scale(shinFront, -Math.sin(an))));
  return { thigh, front, shin, shinFront, foot, footUp };
}

function footBone(ankle: Vec3, fwd: Vec3, up: Vec3, ground?: Vec3): Bone {
  const heel = madd(madd(ankle, fwd, -BODY.heel), up, -BODY.ankle);
  let toe = madd(madd(ankle, fwd, BODY.toe), up, -BODY.ankle);
  // 뒤꿈치를 들어 발끝이 면을 파고들면, 발가락을 꺾어 면에 눕힌다 (발볼에서 앞으로)
  if (ground && dot(fwd, ground) < -0.02) {
    const ball = madd(madd(ankle, fwd, BODY.ball), up, -BODY.ankle);
    const flat = normalize(perpendicular(fwd, ground), fwd);
    toe = madd(ball, flat, BODY.toe - BODY.ball);
  }
  return { a: heel, b: toe, f: up };
}

/** 자세 하나를 뼈 위치로 푼다. */
export function solvePose(pose: Pose3): Solved {
  // 골반 · 허리 · 가슴 · 머리
  let pelvis: Frame = { ...WORLD, o: pose.pelvis };
  pelvis = turn(pelvis, 'y', pose.yaw ?? 0);
  pelvis = turn(pelvis, 'x', pose.pitch ?? 0);
  pelvis = turn(pelvis, 'z', pose.roll ?? 0);

  const spine = pose.spine ?? 0;
  const twist = pose.twist ?? 0;
  const bend = pose.bend ?? 0;
  const base = point(pelvis, BODY.lumbarBase);
  let lumbar: Frame = { ...pelvis, o: base };
  lumbar = turn(turn(turn(lumbar, 'x', spine * 0.45), 'y', twist * 0.3), 'z', bend * 0.4);
  const waist = point(lumbar, [0, BODY.lumbar, 0]);
  let chest: Frame = { ...lumbar, o: waist };
  chest = turn(turn(turn(chest, 'x', spine * 0.55), 'y', twist * 0.7), 'z', bend * 0.6);
  const neckBase = point(chest, [0, BODY.thorax, -0.01]);
  const head = turn({ ...chest, o: neckBase }, 'x', pose.neck ?? 0);
  const neckTop = point(head, [0, BODY.neck, 0]);

  const frames = { pelvis, chest, head };

  // 바
  let bar: Solved['bar'];
  if (pose.bar) {
    const f = frameOf(pose.bar.in, frames);
    bar = {
      c: point(f, pose.bar.at),
      x: normalize(direction(f, pose.bar.dir ?? [1, 0, 0]), [1, 0, 0]),
    };
  }

  const bones = {} as Record<BoneName, Bone>;
  bones.pelvis = { a: point(pelvis, [0, -0.07, 0]), b: base, f: pelvis.z };
  bones.lumbar = { a: base, b: waist, f: lumbar.z };
  bones.chest = { a: waist, b: neckBase, f: chest.z };
  bones.neck = { a: neckBase, b: neckTop, f: head.z };
  bones.head = { a: neckTop, b: point(head, [0, BODY.neck + 0.2, 0.01]), f: head.z };

  const miss = { armL: 0, armR: 0, legL: 0, legR: 0 };
  const hands = {} as { L: Hand; R: Hand };

  // 팔
  for (const side of ['L', 'R'] as const) {
    const sign = side === 'L' ? 1 : -1;
    const spec: ArmSpec = (side === 'L' ? pose.armL : pose.armR) ?? { fk: [0, 4, 0, 6] };
    const scap = (side === 'L' ? pose.scapL : pose.scapR) ?? pose.scap ?? [0, 0];
    const shrug = scap[0] ?? 0;
    const reach = scap[1] ?? 0;
    const shoulder = point(chest, [
      sign * (BODY.shoulder[0] - 0.012 * Math.max(0, reach)),
      BODY.shoulder[1] + 0.065 * shrug,
      BODY.shoulder[2] + 0.035 * reach,
    ]);
    const mirrorIf = (v: Vec3): Vec3 => (side === 'L' ? v : MIRROR(v));

    let elbow: Vec3;
    let wrist: Vec3;
    let grip: Vec3;
    let upperFront: Vec3;
    let foreDir: Vec3;
    let foreFront: Vec3;
    let axis: Vec3;
    let palm: Vec3;

    if (spec.fk) {
      const fk = armFk(spec.fk);
      const upper = direction(chest, mirrorIf(fk.upper));
      upperFront = direction(chest, mirrorIf(fk.front));
      foreDir = direction(chest, mirrorIf(fk.fore));
      foreFront = direction(chest, mirrorIf(fk.foreFront));
      elbow = madd(shoulder, upper, BODY.upperArm);
      wrist = madd(elbow, foreDir, BODY.forearm);
      // 손목 굽힘 — 손바닥 쪽(아래팔 앞면)으로
      const handDir = fk.wrist
        ? normalize(add(scale(foreDir, Math.cos(fk.wrist * DEG)), scale(foreFront, Math.sin(fk.wrist * DEG))))
        : foreDir;
      grip = madd(wrist, handDir, BODY.grip);
      // 손잡이: 0 = 손바닥이 아래팔 앞면을 봄(회외), 90 = 중립, 180 = 회내
      const t = spec.turn ?? 0;
      const spin = side === 'L' ? t : -t;
      palm = normalize(rotateAbout(foreFront, foreDir, spin));
      axis = normalize(cross(palm, handDir));
      if (spec.hand) axis = normalize(perpendicular(direction(frameOf(spec.in, frames), spec.hand), handDir), axis);
    } else {
      // 닿을 곳으로
      let target: Vec3;
      let handAxis: Vec3 | undefined;
      if (spec.bar !== undefined && bar) {
        target = madd(bar.c, bar.x, spec.bar);
        handAxis = bar.x;
      } else {
        target = point(frameOf(spec.in, frames), spec.ik ?? [sign * 0.2, 0.8, 0.1]);
      }
      if (spec.hand) handAxis = direction(frameOf(spec.in, frames), spec.hand);
      const pole = normalize(direction(frameOf(spec.in, frames), spec.pole ?? [sign * 0.3, -1, -0.4]), [0, -1, 0]);
      // 바닥을 짚는 손은 손목까지만 풀고, 손바닥은 point 쪽으로 눕힌다
      const pointDir = spec.point ? normalize(direction(frameOf(spec.in, frames), spec.point)) : undefined;
      const reachTo = pointDir ? madd(target, pointDir, -BODY.grip) : target;
      const solved = twoBone(shoulder, reachTo, BODY.upperArm, BODY.forearm + (pointDir ? 0 : BODY.grip), pole);
      miss[side === 'L' ? 'armL' : 'armR'] = solved.miss;
      elbow = solved.mid;
      grip = pointDir ? madd(solved.end, pointDir, BODY.grip) : solved.end;
      const upper = normalize(sub(elbow, shoulder));
      foreDir = normalize(sub(pointDir ? solved.end : grip, elbow));
      // 팔꿈치는 pole 쪽으로 튀어나오고 이두는 그 반대편이다
      upperFront = normalize(perpendicular(scale(solved.bend, -1), upper), [0, 0, 1]);
      const cosE = Math.max(-1, Math.min(1, dot(upper, foreDir)));
      const sinE = Math.sqrt(Math.max(0, 1 - cosE * cosE));
      foreFront = normalize(add(scale(upper, -sinE), scale(upperFront, cosE)), upperFront);
      wrist = pointDir ? solved.end : madd(grip, foreDir, -BODY.grip);
      const handDir = pointDir ?? foreDir;
      axis = normalize(perpendicular(handAxis ?? cross(foreDir, foreFront), handDir), cross(handDir, foreFront));
      palm = normalize(cross(axis, handDir));
      // 손바닥은 팔꿈치가 향한 쪽의 반대(아래팔 앞면) 쪽으로. 바닥을 짚으면 아래로
      if (pointDir ? palm[1] > 0 : dot(palm, foreFront) < 0) palm = scale(palm, -1);
    }

    const handTip = madd(wrist, normalize(sub(grip, wrist)), 0.17);
    bones[`upperArm${side}` as BoneName] = { a: shoulder, b: elbow, f: upperFront };
    bones[`forearm${side}` as BoneName] = { a: elbow, b: wrist, f: foreFront };
    bones[`hand${side}` as BoneName] = { a: wrist, b: handTip, f: palm };
    hands[side] = { grip, axis, palm };
  }

  // 바를 쥔 손이 못 미쳤으면 바를 손 쪽으로 — 손과 바 사이에 틈이 보이지 않게
  if (bar) {
    const held: Vec3[] = [];
    for (const side of ['L', 'R'] as const) {
      const spec = side === 'L' ? pose.armL : pose.armR;
      if (spec && spec.bar !== undefined && !spec.fk) held.push(madd(hands[side].grip, bar.x, -spec.bar));
    }
    if (held.length > 0) {
      const c = held.length === 2 ? scale(add(held[0]!, held[1]!), 0.5) : held[0]!;
      if (distance(c, bar.c) > 1e-6) bar = { c, x: bar.x };
    }
  }

  // 다리
  for (const side of ['L', 'R'] as const) {
    const sign = side === 'L' ? 1 : -1;
    const spec: LegSpec = (side === 'L' ? pose.legL : pose.legR) ?? { fk: [0, 0, 0, 4, 0] };
    const hip = point(pelvis, [sign * BODY.hip, 0, 0]);
    const mirrorIf = (v: Vec3): Vec3 => (side === 'L' ? v : MIRROR(v));
    let knee: Vec3;
    let ankle: Vec3;
    let thighFront: Vec3;
    let shinFront: Vec3;
    let fwd: Vec3;
    let up: Vec3;

    if (spec.fk) {
      const fk = legFk(spec.fk);
      const thigh = direction(pelvis, mirrorIf(fk.thigh));
      const shin = direction(pelvis, mirrorIf(fk.shin));
      thighFront = direction(pelvis, mirrorIf(fk.front));
      shinFront = direction(pelvis, mirrorIf(fk.shinFront));
      knee = madd(hip, thigh, BODY.thigh);
      ankle = madd(knee, shin, BODY.shin);
      fwd = direction(pelvis, mirrorIf(fk.foot));
      up = direction(pelvis, mirrorIf(fk.footUp));
    } else {
      const f = frameOf(spec.in, frames);
      const target = point(f, spec.ankle ?? [sign * BODY.hip, -0.8, 0]);
      const pole = normalize(direction(f, spec.pole ?? [0, 0, 1]), [0, 0, 1]);
      const solved = twoBone(hip, target, BODY.thigh, BODY.shin, pole);
      miss[side === 'L' ? 'legL' : 'legR'] = solved.miss;
      knee = solved.mid;
      ankle = solved.end;
      const thigh = normalize(sub(knee, hip));
      const shin = normalize(sub(ankle, knee));
      // 무릎뼈는 pole 쪽을 본다
      thighFront = normalize(perpendicular(solved.bend, thigh), [0, 0, 1]);
      const sinK = -dot(shin, thighFront);
      const cosK = dot(shin, thigh);
      shinFront = normalize(add(scale(thigh, sinK), scale(thighFront, cosK)), thighFront);
      fwd = normalize(direction(f, spec.fwd ?? [0, 0, 1]), [0, 0, 1]);
      up = normalize(perpendicular(direction(f, spec.up ?? [0, 1, 0]), fwd), [0, 1, 0]);
    }

    bones[`thigh${side}` as BoneName] = { a: hip, b: knee, f: thighFront };
    bones[`shin${side}` as BoneName] = { a: knee, b: ankle, f: shinFront };
    bones[`foot${side}` as BoneName] = footBone(ankle, fwd, up, spec.ground);
  }

  return { bones, hands, frames, bar, miss };
}

/* ── 자세 사이 ──────────────────────────────────── */

/** 두 자세 사이. 숫자 · 숫자 배열은 섞고, 나머지(틀 이름 같은 것)는 앞 자세를 따른다. */
export function blend<T>(a: T, b: T, s: number): T {
  if (typeof a === 'number' && typeof b === 'number') return (a + (b - a) * s) as unknown as T;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.map((value, i) => blend(value, b[i] ?? value, s)) as unknown as T;
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const out: Record<string, unknown> = {};
    const names = new Set([...Object.keys(a as object), ...Object.keys(b as object)]);
    for (const key of names) {
      const left = (a as Record<string, unknown>)[key];
      const right = (b as Record<string, unknown>)[key];
      out[key] = right === undefined ? left : left === undefined ? right : blend(left, right, s);
    }
    return out as T;
  }
  return a;
}

/** 0~1 주기로 접는다 (1.45 % 1 이 0.4499…로 떨어지는 오차까지). */
export function wrapCycle(t: number): number {
  if (t >= 0 && t < 1) return t;
  const w = t % 1;
  return w < 0 ? w + 1 : w;
}
