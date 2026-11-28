/**
 * 6차에 더한 종목의 시연 — 한국 헬스장 · PT 스튜디오에 흔한데 빠져 있던 것들.
 *
 *   TRX 로우 · TRX 체스트 프레스 — 매달린 띠 두 가닥. 줄 길이가 그대로라 손이 움직이면 몸 각도가 따라 바뀐다
 *   스미스 힙 쓰러스트 — 바벨 힙 쓰러스트의 몸놀림에, 바가 레일을 따라 곧게 위아래로만
 *   스미스 스플릿 스쿼트 — 두 발을 앞뒤로 벌린 채 제자리에서 앉았다 일어난다. 바가 곧게 내려오게 상체 각도를 고정
 *   덤벨 풀오버 — 벤치에 누워 덤벨 하나를 두 손으로, 가슴 위에서 머리 뒤로 반원
 *
 * motionKit · motionsLower에서 가져오기만 하고 고치지 않는다. motions.ts가 GEAR_MOTIONS를 표에 더한다.
 */
import {
  ARM_REACH, LEG_REACH, ballAt, chestPoint, flatBench, keys, lying, mat, plant, shoulderMid, solveFor, solvePose,
  type Clip, type Key, type Prim,
} from './motionKit.ts';
import * as L from './motionsLower.ts';
import { add, madd, normalize, scale, sub, type ArmSpec, type LegSpec, type Pose3, type Vec3 } from './rig.ts';

type KeyList = [number, string | undefined, Pose3][];

interface Entry {
  make: (fault?: string) => Clip;
  /** 동작으로 보여 줄 수 있는 흔한 실수 (mistakes.ts의 id) */
  faults: readonly string[];
}

const entry = (make: (fault?: string) => Clip, faults: readonly string[] = []): Entry => ({ make, faults });

const DEG = Math.PI / 180;
const dist = (a: Vec3, b: Vec3): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** 올리고(당기고) → 끝 → 돌아오는 네 키 */
function liftKeys(start: Pose3, end: Pose3, words: [string, string, string]): KeyList {
  return [[0, words[0], start], [0.42, words[1], end], [0.54, words[2], end], [1, undefined, start]];
}

/** 내리고 → 바닥 → 미는 네 키 (힘쓰는 구간이 미는 쪽) */
function pressKeys(top: Pose3, bottom: Pose3, words: [string, string, string]): KeyList {
  return [[0, words[0], top], [0.45, words[1], bottom], [0.53, words[2], bottom], [1, undefined, top]];
}

/** 스미스 머신 레일 — 바 양 끝 바깥에 선 두 기둥과 위 틀, 바닥 판 */
function smithRails(z: number): Prim[] {
  return [
    { kind: 'post', p: [0.78, 1.1, z], size: [0.06, 2.2, 0.06] },
    { kind: 'post', p: [-0.78, 1.1, z], size: [0.06, 2.2, 0.06] },
    { kind: 'frame', p: [0, 2.2, z], size: [1.62, 0.07, 0.07] },
    { kind: 'frame', p: [0, 0.006, z], size: [1.62, 0.012, 0.5] },
  ];
}

/* ── TRX — 매달린 띠 ─────────────────────────────── */

/** 띠가 걸린 곳의 장면 — 철봉 틀에 짧은 고리. 띠 두 가닥은 이 한 점(anchor)에서 갈라진다 */
function trxScene(anchor: Vec3, floorAt: Vec3, away: 1 | -1): Prim[] {
  // 위 틀 — 띠를 건 가로대와, 사람 반대쪽(away)으로 물러선 기둥 둘. 기둥이 옆에서 볼 때 사람을 가리지 않게 1m 바깥 · 40cm 뒤에
  const top = anchor[1] + 0.12;
  const postZ = anchor[2] + away * 0.4;
  return [
    { kind: 'bar', p: [0, top, anchor[2]], size: [0.016, 2.0] },
    { kind: 'frame', p: [1.0, top, (anchor[2] + postZ) / 2], size: [0.06, 0.06, 0.46] },
    { kind: 'frame', p: [-1.0, top, (anchor[2] + postZ) / 2], size: [0.06, 0.06, 0.46] },
    { kind: 'post', p: [1.0, top / 2, postZ], size: [0.07, top, 0.07] },
    { kind: 'post', p: [-1.0, top / 2, postZ], size: [0.07, top, 0.07] },
    // 가로대에 감은 고리 띠와 갈라지는 고리
    { kind: 'frame', p: [0, anchor[1] + 0.06, anchor[2]], size: [0.035, 0.12, 0.008] },
    { kind: 'box', p: anchor, size: [0.05, 0.05, 0.03] },
    mat(floorAt, 0.8, 1.3),
  ];
}

/**
 * 몸을 일자로 펴고 비스듬히 선 몸. 발목이 ankleZ에 있고, angle은 몸이 바닥과 이루는 각(90 = 똑바로).
 * back = true면 뒤로 기댄 몸(TRX 로우 — 줄을 마주 보고 뒤꿈치로 버틴다), false면 앞으로 기운 몸(체스트 프레스 — 앞꿈치로 버틴다).
 */
function leaningBody(angle: number, ankleZ: number, back: boolean, extra: Partial<Pose3> = {}): Pose3 {
  const a = angle * DEG;
  const reach = LEG_REACH * 0.995;
  let foot: (x: number) => LegSpec;
  let ankleY: number;
  if (back) {
    // 뒤꿈치를 바닥에 대고 발끝은 들린다 — 정강이와 발이 거의 직각
    const toeUp = (90 - angle) * 0.85 * DEG;
    const fwd: Vec3 = [0, Math.sin(toeUp), Math.cos(toeUp)];
    const up: Vec3 = [0, Math.cos(toeUp), -Math.sin(toeUp)];
    ankleY = 0.075 * Math.cos(toeUp) + 0.055 * Math.sin(toeUp);
    foot = (x) => ({ ankle: [x, ankleY, ankleZ], fwd, up, pole: [x * 2, 0.2, 1] });
  } else {
    // 앞꿈치로 선다 — 뒤꿈치를 든 발 (plank와 같다: 발끝이 바닥, 발등이 머리 쪽)
    const fwd: Vec3 = [0, -Math.cos(a), Math.sin(a)];
    const up: Vec3 = [0, Math.sin(a), Math.cos(a)];
    const toe = 0.19;
    ankleY = -fwd[1] * toe + up[1] * 0.075;
    const z = ankleZ;
    foot = (x) => ({ ankle: [x, ankleY, z], fwd, up, pole: [0, -1, 0.1] });
  }
  // 뒤로 기대면 골반이 발목보다 뒤(−z), 앞으로 기울면 앞(+z)
  const dir: Vec3 = back ? [0, Math.sin(a), -Math.cos(a)] : [0, Math.sin(a), Math.cos(a)];
  const pelvis = madd([0, ankleY, ankleZ], dir, reach);
  return {
    pelvis, pitch: back ? -(90 - angle) : 90 - angle, spine: 0, neck: back ? 6 : -6,
    legL: foot(0.11), legR: foot(-0.11), ...extra,
  };
}

/** 두 손에 띠 손잡이 — 손잡이는 세로(손바닥이 마주 보게) */
function trxHands(center: Vec3, width: number, pole: (side: 1 | -1) => Vec3): { armL: ArmSpec; armR: ArmSpec } {
  const arm = (side: 1 | -1): ArmSpec => ({ ik: [center[0] + side * width, center[1], center[2]], pole: pole(side), hand: [0, 1, 0] });
  return { armL: arm(1), armR: arm(-1) };
}

function trxRow(id: string, fault?: string): Clip {
  // 줄을 마주 보고(+z) 뒤로 기댄다. 띠는 앞 위(철봉)에 걸려 있다
  const anchor: Vec3 = [0, 2.25, 0.55];
  const ankleZ = 0.05;
  const lowAngle = 52;
  // 시작 — 팔을 곧게, 손은 어깨에서 띠가 걸린 쪽으로 (띠와 팔이 한 줄)
  const startBody = leaningBody(lowAngle, ankleZ, true);
  const s0 = shoulderMid(startBody);
  const reach = ARM_REACH * 0.95;
  const lowHands = madd(s0, normalize(sub(anchor, s0)), reach);
  const strap = dist(anchor, lowHands);
  // 끝 — 손이 가슴 옆까지. 띠 길이는 그대로라 몸이 손 쪽으로 일어선다
  const endLocal: Vec3 = [0, 0.12, 0.17];
  const highAngle = solveFor((angle) => dist(anchor, chestPoint(leaningBody(angle, ankleZ, true), endLocal)), lowAngle, 85, strap);
  const pull = (side: 1 | -1): Vec3 => [side * 0.35, -0.35, -1];
  const hang = (side: 1 | -1): Vec3 => [side * 0.35, -1, -0.15];
  const at = (angle: number, extra: Partial<Pose3> = {}, high = false): Pose3 => {
    const body = leaningBody(angle, ankleZ, true, extra);
    const center = high ? chestPoint(body, endLocal) : madd(shoulderMid(body), normalize(sub(anchor, shoulderMid(body))), reach);
    return { ...body, ...trxHands(center, high ? 0.2 : 0.11, high ? pull : hang) };
  };
  const low = at(lowAngle);
  const high = at(highAngle, {}, true);
  const list = liftKeys(low, high, ['가슴을 손잡이 쪽으로', '날개뼈 모으기', '천천히 몸을 뒤로']);
  if (fault === 'hips-sag') {
    // 엉덩이가 뒤로 빠지며 처진다 — 골반이 내려가고 몸이 접힌다(무릎도 풀린다)
    const sag = (angle: number, high2: boolean): Pose3 => {
      const base = leaningBody(angle, ankleZ, true);
      const body: Pose3 = { ...base, pelvis: [0, base.pelvis[1] - 0.12, base.pelvis[2] + 0.04], pitch: (base.pitch ?? 0) + 22 };
      const center = high2 ? chestPoint(body, endLocal) : madd(shoulderMid(body), normalize(sub(anchor, shoulderMid(body))), reach);
      return { ...body, ...trxHands(center, high2 ? 0.2 : 0.11, high2 ? pull : hang) };
    };
    list[1] = [0.42, '엉덩이가 처짐', sag(highAngle - 4, true)];
    list[2] = [0.54, undefined, sag(highAngle - 4, true)];
  } else if (fault === 'shoulders-up') {
    const shrug = at(highAngle, { scap: [1, 0] }, true);
    list[1] = [0.42, '어깨가 귀 쪽으로', shrug];
    list[2] = [0.54, undefined, shrug];
  }
  return {
    id, cycle: 2.8, view: [72, 10], keys: keys(...list),
    scene: trxScene(anchor, [0, 0, -0.2], 1),
    hold: { L: 'dHandle', R: 'dHandle' },
    cables: [{ from: anchor, to: 'L', strap: true }, { from: anchor, to: 'R', strap: true }],
    work: [0, 0.42], fault,
  };
}

function trxChestPress(id: string, fault?: string): Clip {
  // 줄을 등지고(+z를 보고) 앞으로 기운다. 띠는 뒤 위(철봉)에 걸려 어깨 옆을 지나 손으로 온다
  const anchor: Vec3 = [0, 2.25, -0.35];
  const toeZ = 0.0;
  const highAngle = 62;
  const startBody = leaningBody(highAngle, toeZ, false);
  const s0 = shoulderMid(startBody);
  const reach = ARM_REACH * 0.95;
  // 위 — 팔을 곧게. 손은 띠가 당기는 쪽의 반대로(띠 · 어깨 · 손이 거의 한 줄)
  const highHands = madd(s0, normalize(sub(s0, anchor)), reach);
  const strap = dist(anchor, highHands);
  // 아래 — 손이 가슴 옆. 띠 길이는 그대로라 몸이 더 눕는다
  const lowLocal: Vec3 = [0, 0.1, 0.13];
  const lowAngle = solveFor((angle) => dist(anchor, chestPoint(leaningBody(angle, toeZ, false), lowLocal)), 25, highAngle, strap);
  const tuck = (side: 1 | -1): Vec3 => [side * 0.45, 0.2, -1];
  const flare = (side: 1 | -1): Vec3 => [side, 0.15, -0.1];
  const at = (angle: number, low: boolean, extra: Partial<Pose3> = {}, pole = tuck): Pose3 => {
    const body = leaningBody(angle, toeZ, false, extra);
    const center = low ? chestPoint(body, lowLocal) : madd(shoulderMid(body), normalize(sub(shoulderMid(body), anchor)), reach);
    return { ...body, ...trxHands(center, low ? 0.24 : 0.14, pole) };
  };
  const top = at(highAngle, false);
  const bottom = at(lowAngle, true);
  const list = pressKeys(top, bottom, ['가슴을 손 사이로 내리기', '손이 가슴 옆', '밀어서 돌아오기']);
  if (fault === 'hips-sag') {
    const sag = (p: Pose3): Pose3 => ({ ...p, pelvis: [p.pelvis[0], p.pelvis[1] - 0.08, p.pelvis[2] - 0.01], spine: -20, pitch: (p.pitch ?? 0) + 8 });
    list[1] = [0.45, '허리가 처짐', sag(bottom)];
    list[2] = [0.53, undefined, sag(bottom)];
  } else if (fault === 'elbow-flare') {
    const wide = at(lowAngle, true, {}, flare);
    list[1] = [0.45, '팔꿈치가 벌어짐', wide];
    list[2] = [0.53, undefined, wide];
  }
  return {
    id, cycle: 2.8, view: [72, 10], keys: keys(...list),
    scene: trxScene(anchor, [0, 0, 0.35], -1),
    hold: { L: 'dHandle', R: 'dHandle' },
    cables: [{ from: anchor, to: 'L', strap: true }, { from: anchor, to: 'R', strap: true }],
    work: [0.53, 1], fault,
  };
}

/* ── 스미스 힙 쓰러스트 ──────────────────────────── */

function smithHipThrust(id: string, fault?: string): Clip {
  const clip = L.hipThrust(id, 'barbell', fault);
  /*
   * 바벨 쓰러스트는 바가 골반에 붙어 다닌다(앞뒤로 2cm쯤 흔들린다). 스미스는 레일이라 곧게만 —
   * 키마다 바 자리를 세계 좌표로 옮기고 앞뒤 자리는 하나로 고정한다. 바는 그대로 골반 위에 얹힌다.
   */
  const bars = clip.keys.map((key: Key) => solvePose(key.pose).bar!.c);
  const z = bars.reduce((sum, c) => sum + c[2], 0) / bars.length;
  return {
    ...clip,
    keys: clip.keys.map((key: Key, i: number) => ({ ...key, pose: { ...key.pose, bar: { at: [0, bars[i]![1], z] as Vec3 } } })),
    scene: [...clip.scene, ...smithRails(z)],
    bar: { kind: 'smith', plates: 0.225 },
    // 앞 위에서 — 레일 사이로 엉덩이와 바가 보이게
    view: [32, 22],
  };
}

/* ── 스미스 스플릿 스쿼트 ────────────────────────── */

function smithSplitSquat(id: string, fault?: string): Clip {
  // 앞발과 뒷발 자리 — 리버스 런지 최저점과 같은 보폭(74cm)
  const frontZ = 0.32;
  const backZ = -0.42;
  const caved = fault === 'knee-cave';
  const front = plant(0.1, frontZ, 6, caved ? { pole: [-0.8, 0.1, 0.6] } : {});
  const back = (heel: number): LegSpec => ballAt(-0.11, backZ, 4, heel);
  // 바는 등 위(승모근)에 — 스미스 스쿼트와 같은 자리 · 손 간격. 상체 각도를 고정해 바가 곧게 내려온다
  const hold = (side: 1 | -1): ArmSpec => ({ bar: side * 0.43, pole: [side * 0.25, -1, -0.55], in: 'chest' });
  const body = (y: number, heel: number, extra: Partial<Pose3> = {}): Pose3 => ({
    pelvis: [0, y, (frontZ + backZ) / 2 + 0.05], pitch: 6, spine: 0, neck: 0, legL: front, legR: back(heel),
    armL: hold(1), armR: hold(-1), bar: { at: [0, 0.27, -0.088], in: 'chest' }, ...extra,
  });
  const top = body(0.79, 46);
  const low = body(0.5, 62);
  const list = pressKeys(top, low, ['곧게 내려가기', '뒷무릎이 바닥 가까이', '앞발로 밀기']);
  if (caved) {
    list[1] = [0.45, '앞무릎이 안으로', low];
    list[2] = [0.53, undefined, low];
  } else if (fault === 'back-leg') {
    // 뒷발로 밀어 올라옴 — 뒤꿈치가 높이 들리고 엉덩이가 먼저 뜬다
    const push = body(0.6, 80);
    list[2] = [0.53, '뒷발로 밀어 올라옴', push];
  }
  const barZ = solvePose(top).bar!.c[2];
  return {
    id, cycle: 3.2, view: [70, 10], keys: keys(...list),
    scene: smithRails(barZ),
    bar: { kind: 'smith', plates: 0.225 }, side: 'L',
    work: [0.53, 1], fault,
  };
}

/* ── 덤벨 풀오버 ─────────────────────────────────── */

function dumbbellPullover(id: string, fault?: string): Clip {
  const body = lying({}, 0.3, 0.43);
  const s = shoulderMid(body);
  // 두 손이 덤벨 위 원판을 감싼다 — 손은 가운데로 모이고, 팔꿈치는 살짝만 굽힌다
  const reach = ARM_REACH * 0.96;
  /** θ = 0이면 팔이 천장으로 곧게, 90이면 머리 뒤로 몸통과 나란히 */
  const dirAt = (theta: number): Vec3 => [0, Math.cos(theta * DEG), -Math.sin(theta * DEG)];
  const at = (theta: number, extra: Partial<Pose3> = {}, bend = 0): Pose3 => {
    const base = { ...body, ...extra };
    const sh = shoulderMid(base);
    const dir = dirAt(theta);
    const grip = madd(sh, dir, reach - bend);
    // 팔꿈치는 바깥 · 위로 (머리 뒤로 갈수록 천장을 본다)
    const pole = (side: 1 | -1): Vec3 => add(scale([side, 0, 0], 0.8), scale(normalize([0, Math.sin(theta * DEG), Math.cos(theta * DEG)]), 0.6));
    const arm = (side: 1 | -1): ArmSpec => ({ ik: [side * 0.05, grip[1], grip[2]], pole: pole(side), hand: [1, 0, 0] });
    // 덤벨은 팔과 한 줄로 — 가운데가 손보다 6.5cm 어깨 쪽
    return { ...base, armL: arm(1), armR: arm(-1), bar: { at: madd(grip, dir, -0.065), dir } };
  };
  /*
   * 손은 어깨를 중심으로 반원을 그린다. 키 두 개(위 · 아래)만 두면 손이 반원의 현을 따라 곧게 가로질러
   * 중간에 팔꿈치가 100°까지 접힌다 — 반원 위에 키를 몇 개 더 찍는다.
   */
  const ARC = [-6, 32, 66, 92];
  const down: KeyList = [[0, '머리 뒤로 크게 내리기', at(ARC[0]!)], [0.15, undefined, at(ARC[1]!)], [0.3, undefined, at(ARC[2]!)], [0.45, '팔이 몸통과 나란히', at(ARC[3]!)]];
  const up: KeyList = [[0.53, '가슴 위로 끌어오기', at(ARC[3]!)], [0.68, undefined, at(ARC[2]!)], [0.84, undefined, at(ARC[1]!)], [1, undefined, at(ARC[0]!)]];
  const list: KeyList = [...down, ...up];
  if (fault === 'elbow-bend') {
    // 팔꿈치를 접어 머리 뒤로 — 풀오버가 팔 뒤쪽 운동이 된다
    const bent = (theta: number, k: number) => at(theta, {}, 0.24 * k);
    list[1] = [0.15, undefined, bent(30, 0.4)];
    list[2] = [0.3, undefined, bent(58, 0.8)];
    list[3] = [0.45, '팔꿈치를 굽혔다 폄', bent(80, 1)];
    list[4] = [0.53, undefined, bent(80, 1)];
    list[5] = [0.68, undefined, bent(58, 0.8)];
    list[6] = [0.84, undefined, bent(30, 0.4)];
  } else if (fault === 'arch') {
    // 내릴 때 허리가 뜨고 갈비뼈가 들린다
    const arched = (theta: number, k: number) => at(theta, { spine: -24 * k, pelvis: [s[0], body.pelvis[1] + 0.05 * k, body.pelvis[2]] });
    list[2] = [0.3, undefined, arched(70, 0.5)];
    list[3] = [0.45, '허리가 뜸', arched(102, 1)];
    list[4] = [0.53, undefined, arched(102, 1)];
    list[5] = [0.68, undefined, arched(70, 0.5)];
  }
  return {
    // 옆에서 조금 위 — 머리 뒤로 넘어가는 반원이 보이게
    id, cycle: 3.2, view: [78, 16], keys: keys(...list), scene: flatBench(-0.52, 0.5),
    bar: { kind: 'dumbbell' }, work: [0.53, 1], fault,
  };
}

/* ── 표 ──────────────────────────────────────────── */

export const GEAR_MOTIONS: Record<string, Entry> = {
  'trx-row': entry((f) => trxRow('trx-row', f), ['hips-sag', 'shoulders-up']),
  'trx-chest-press': entry((f) => trxChestPress('trx-chest-press', f), ['hips-sag', 'elbow-flare']),
  'smith-hip-thrust': entry((f) => smithHipThrust('smith-hip-thrust', f), ['arch', 'chin-up']),
  'smith-split-squat': entry((f) => smithSplitSquat('smith-split-squat', f), ['knee-cave', 'back-leg']),
  'dumbbell-pullover': entry((f) => dumbbellPullover('dumbbell-pullover', f), ['elbow-bend', 'arch']),
};
