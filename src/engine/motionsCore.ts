/**
 * 코어 · 버티기 · 걷기 종목 시연.
 */
import {
  ARM_REACH, STAND_HEIGHT, armsCrossed, ballAt, flatBench, hangingArms, keys, lying, machineFrame, mat, placeShoulders,
  plank, plant, pullupBar, seatBench, seated, setKey, shoulderMid, solvePose, solveFor,
  type Clip, type Prim,
} from './motionKit.ts';
import { BODY, add, madd, normalize, scale, sub, type ArmSpec, type LegSpec, type Pose3, type Vec3 } from './rig.ts';

type KeyList = [number, string | undefined, Pose3][];

const DEG = Math.PI / 180;

function liftKeys(start: Pose3, end: Pose3, words: [string, string, string]): KeyList {
  return [[0, words[0], start], [0.42, words[1], end], [0.54, words[2], end], [1, undefined, start]];
}

function swap(list: KeyList, at: number[], label: string, pose: Pose3): void {
  at.forEach((i, n) => setKey(list, i, n === 0 ? label : list[i]![1], pose));
}

/** 바닥에 누워 손바닥을 옆에 짚은 팔 */
const palmsDown = (): { armL: ArmSpec; armR: ArmSpec } => ({
  armL: { ik: [0.3, 0.025, 0.05], pole: [1, 0.4, -0.2], point: [0.15, 0, 1] },
  armR: { ik: [-0.3, 0.025, 0.05], pole: [-1, 0.4, -0.2], point: [-0.15, 0, 1] },
});

/** 무릎 꿇은 다리 — 무릎은 바닥, 발등도 바닥 (뒤로) */
function kneeling(kneeZ = 0): { legL: LegSpec; legR: LegSpec } {
  const foot = (x: number): LegSpec => ({ ankle: [x, 0.07, kneeZ - BODY.shin + 0.01], fwd: normalize([0, -0.12, -1]), up: normalize([0, -1, 0.12]), pole: [0, -0.6, 1] });
  return { legL: foot(0.12), legR: foot(-0.12) };
}

/* ── 크런치 계열 ─────────────────────────────────── */

export type CrunchKind = 'reverse' | 'cable' | 'machine' | 'declineSitUp';

export function crunch(id: string, kind: CrunchKind, fault?: string): Clip {
  switch (kind) {
    case 'cable': return cableCrunch(id, fault);
    case 'machine': return machineCrunch(id, fault);
    case 'declineSitUp': return declineSitUp(id, fault);
    default: return reverseCrunch(id, fault);
  }
}

function reverseCrunch(id: string, fault?: string): Clip {
  const body = (pitch: number, hip: number, spine: number, y: number): Pose3 => ({
    pelvis: [0, y, 0.15], pitch, spine, neck: 0,
    legL: { fk: [hip, 4, 0, 92, -10] }, legR: { fk: [hip, 4, 0, 92, -10] }, ...palmsDown(),
  });
  const rest = body(-90, 88, -4, 0.11);
  const curled = body(-118, 104, 24, 0.16);
  const list = liftKeys(rest, curled, ['골반을 말아 올리기', '무릎이 가슴 쪽으로', '천천히 내리기']);
  if (fault === 'legs-only') swap(list, [1, 2], '다리만 올라감', body(-90, 122, -4, 0.11));
  else if (fault === 'swing') list.splice(0, 4, [0, '반동', rest], [0.2, undefined, body(-124, 110, 28, 0.18)], [0.32, undefined, rest], [0.52, undefined, body(-124, 110, 28, 0.18)], [0.64, undefined, rest], [1, undefined, rest]);
  return { id, cycle: 2.6, view: [76, 18], keys: keys(...list), scene: [mat([0, 0, -0.1], 0.75, 1.8)], work: [0, 0.42], fault };
}

function cableCrunch(id: string, fault?: string): Clip {
  const pulley: Vec3 = [0, 1.95, 0.6];
  const legs = kneeling(0.02);
  const hands = { armL: { ik: [0.11, 0.42, 0.07] as Vec3, in: 'chest' as const, pole: [0.4, -1, 0.6] as Vec3, hand: [0, 1, 0] as Vec3 }, armR: { ik: [-0.11, 0.42, 0.07] as Vec3, in: 'chest' as const, pole: [-0.4, -1, 0.6] as Vec3, hand: [0, 1, 0] as Vec3 } };
  const body = (pelvis: Vec3, pitch: number, spine: number, neck = 10): Pose3 => ({ pelvis, pitch, spine, neck, ...legs, ...hands });
  const up = body([0, 0.5, -0.06], 12, 0);
  const down = body([0, 0.48, -0.08], 34, 58, 20);
  const list = liftKeys(up, down, ['배를 말아 내려가기', '팔꿈치가 허벅지 쪽으로', '천천히 펴기']);
  if (fault === 'hips') swap(list, [1, 2], '엉덩이를 내려 앉음', body([0, 0.37, -0.2], 52, 22));
  else if (fault === 'neck') swap(list, [1, 2], '목을 당김', body([0, 0.49, -0.07], 30, 24, 44));
  return {
    id, cycle: 2.6, view: [72, 10], keys: keys(...list), scene: [mat([0, 0, -0.1], 0.8, 1.0), { kind: 'post', p: [0, 1.1, 0.72], size: [0.12, 2.2, 0.12] }, { kind: 'pulley', p: pulley, size: [0.045, 0.03], x: [1, 0, 0] }],
    bar: { kind: 'rope' }, cables: [{ from: pulley, to: 'mid' }], work: [0, 0.42], fault,
  };
}

function machineCrunch(id: string, fault?: string): Clip {
  const base = seated(0.48, 0, 6, {}, 0.46);
  const hands = { armL: { ik: [0.15, 0.36, 0.14] as Vec3, in: 'chest' as const, pole: [0.6, -1, 0.3] as Vec3, hand: [0, 1, 0] as Vec3 }, armR: { ik: [-0.15, 0.36, 0.14] as Vec3, in: 'chest' as const, pole: [-0.6, -1, 0.3] as Vec3, hand: [0, 1, 0] as Vec3 } };
  const body = (pitch: number, spine: number, neck = 0, extra: Partial<Pose3> = {}): Pose3 => ({ ...base, pitch, spine, neck, ...hands, ...extra });
  const up = body(-6, 0);
  const down = body(6, 48, 12);
  const list = liftKeys(up, down, ['배를 말아 숙이기', '끝까지 말기', '천천히 펴기']);
  if (fault === 'neck') swap(list, [1, 2], '목을 당김', body(0, 22, 42));
  else if (fault === 'hips') swap(list, [1, 2], '엉덩이로 당김', body(30, 10, 6, { pelvis: [0, base.pelvis[1] + 0.06, base.pelvis[2] + 0.06] }));
  return {
    id, cycle: 2.6, view: [72, 10], keys: keys(...list),
    scene: [...seatBench(0, 84, { seat: 0.48 }), ...machineFrame(-0.42, 1.7, 0.9)],
    links: [{ kind: 'pad', bone: 'chest', u: 0.8, off: [0, 0, 0.17], size: [0.36, 0.08, 0.08], pivot: [0.36, 1.55, -0.3], leverAt: 0.2 }],
    work: [0, 0.42], fault,
  };
}

function declineSitUp(id: string, fault?: string): Clip {
  const tilt = 22;
  // 발목은 높은 쪽 끝의 패드 밑에 — 앉아 올라와도 발은 그대로
  const hook = (x: number): LegSpec => ({ ankle: [x, 0.66, 0.8], fwd: normalize([0, -0.5, 0.87]), up: normalize([0, 0.87, 0.5]), pole: [x * 1.5, 1, 0.4] });
  const legs = { legL: hook(0.13), legR: hook(-0.13) };
  const body = (pitch: number, spine: number, neck: number): Pose3 => ({ pelvis: [0, 0.8, 0.32], pitch, spine, neck, ...legs, ...armsCrossed() });
  const down = body(-90 - tilt, 0, 4);
  const up = body(-30, 26, 14);
  const list = liftKeys(down, up, ['배를 말며 일어나기', '끝까지', '천천히 눕기']);
  if (fault === 'neck') swap(list, [1, 2], '목을 당김', body(-54, 10, 46));
  const along: Vec3 = [0, Math.sin(tilt * DEG), Math.cos(tilt * DEG)];
  return {
    id, cycle: 2.8, view: [80, 10], keys: keys(...list),
    scene: [
      { kind: 'pad', p: add([0, 0.6, -0.15], scale(along, -0.05)), size: [0.3, 0.07, 1.25], x: [1, 0, 0], y: normalize([0, along[2], -along[1]]) },
      { kind: 'roller', p: [0, 0.76, 0.86], size: [0.05, 0.36] },
      { kind: 'frame', p: [0, 0.22, -0.6], size: [0.06, 0.4, 0.06] },
      { kind: 'frame', p: [0, 0.42, 0.62], size: [0.06, 0.82, 0.06] },
      { kind: 'frame', p: [0, 0.03, 0.05], size: [0.5, 0.06, 1.4] },
    ],
    work: [0, 0.42], fault,
  };
}

/* ── 레그 레이즈 ─────────────────────────────────── */

export function legRaise(id: string, captain: boolean, fault?: string): Clip {
  if (captain) return captainsChair(id, fault);
  const barY = 2.28;
  const grip = 0.32;
  const hand = (side: 1 | -1): ArmSpec => ({ ik: [side * grip, barY, 0], pole: [side, -0.5, 0.2], hand: [1, 0, 0] });
  const reach = Math.sqrt((ARM_REACH * 0.995) ** 2 - (grip - 0.18) ** 2);
  const at = (hip: number, knee: number, pitch: number, spine: number, z = -0.02): Pose3 =>
    placeShoulders({ pelvis: [0, 1.2, 0], pitch, spine, neck: 0, scap: [0.3, 0], legL: { fk: [hip, 4, 0, knee, -16] }, legR: { fk: [hip, 4, 0, knee, -16] }, armL: hand(1), armR: hand(-1) }, [0, barY - reach, z]);
  const hang = at(4, 6, -2, 0);
  const up = at(96, 10, -16, 14, 0.02);
  const list = liftKeys(hang, up, ['다리 들어 올리기', '골반을 말아 올리기', '천천히 내리기']);
  if (fault === 'swing') {
    list.splice(0, 4, [0, '그네처럼 흔들림', at(4, 6, 14, -6, -0.08)], [0.25, undefined, at(70, 12, -26, 10, 0.1)], [0.5, undefined, at(10, 6, 18, -8, -0.1)], [0.75, undefined, at(80, 14, -24, 10, 0.1)], [1, undefined, at(4, 6, 14, -6, -0.08)]);
  } else if (fault === 'legs-only') swap(list, [1, 2], '다리만 올라감', at(78, 8, -2, 0));
  return { id, cycle: 3, view: [70, 6], keys: keys(...list), scene: pullupBar(barY, 0), work: [0, 0.42], fault };
}

function captainsChair(id: string, fault?: string): Clip {
  const padY = 1.3;
  const hand = (side: 1 | -1): ArmSpec => ({ ik: [side * 0.25, padY + 0.04, 0.3], pole: [side * 0.15, -1, -0.6], hand: [0, 1, 0] });
  const at = (hip: number, knee: number, pitch: number, spine: number): Pose3 =>
    placeShoulders({ pelvis: [0, 1.1, -0.1], pitch, spine, neck: 0, legL: { fk: [hip, 4, 0, knee, -14] }, legR: { fk: [hip, 4, 0, knee, -14] }, armL: hand(1), armR: hand(-1) }, [0, padY + 0.3, -0.06]);
  const hang = at(6, 10, -2, 0);
  const up = at(102, 96, -12, 12);
  const list = liftKeys(hang, up, ['무릎을 가슴 쪽으로', '골반 말기', '천천히 내리기']);
  if (fault === 'legs-only') swap(list, [1, 2], '다리만 올라감', at(84, 90, -2, 0));
  else if (fault === 'swing') list.splice(0, 4, [0, '그네처럼 흔들림', at(6, 10, 10, -4)], [0.25, undefined, at(102, 96, -24, 12)], [0.5, undefined, at(6, 10, 12, -6)], [0.75, undefined, at(102, 96, -24, 12)], [1, undefined, at(6, 10, 10, -4)]);
  return {
    id, cycle: 2.8, view: [62, 8], keys: keys(...list),
    scene: [
      { kind: 'pad', p: [0, padY + 0.05, -0.2], size: [0.4, 0.7, 0.08] },
      { kind: 'pad', p: [0.26, padY - 0.02, 0.12], size: [0.11, 0.07, 0.42] },
      { kind: 'pad', p: [-0.26, padY - 0.02, 0.12], size: [0.11, 0.07, 0.42] },
      { kind: 'post', p: [0.34, padY / 2 + 0.2, -0.25], size: [0.07, padY + 0.4, 0.07] },
      { kind: 'post', p: [-0.34, padY / 2 + 0.2, -0.25], size: [0.07, padY + 0.4, 0.07] },
      { kind: 'frame', p: [0, 0.03, -0.05], size: [0.8, 0.06, 0.7] },
    ],
    work: [0, 0.42], fault,
  };
}

/* ── 버티기 ─────────────────────────────────────── */

export function holdPose(id: string, side: boolean, fault?: string): Clip {
  return side ? sidePlank(id, fault) : frontPlank(id, fault);
}

function frontPlank(id: string, fault?: string): Clip {
  const toeZ = -0.95;
  const elbowHeight = 0.05 + BODY.upperArm;
  const angle = solveFor((a) => shoulderMid(plank(a, toeZ))[1], -5, 25, elbowHeight);
  const forearms = (pose: Pose3): { armL: ArmSpec; armR: ArmSpec } => {
    const s = shoulderMid(pose);
    return {
      armL: { ik: [0.12, 0.04, s[2] + 0.26], pole: [0.1, -1, -0.25], hand: [1, 0, 0] },
      armR: { ik: [-0.12, 0.04, s[2] + 0.26], pole: [-0.1, -1, -0.25], hand: [1, 0, 0] },
    };
  };
  const base = plank(angle, toeZ);
  const arms = forearms(base);
  const hold = (extra: Partial<Pose3> = {}): Pose3 => ({ ...base, ...arms, neck: -24, ...extra });
  const breathe = { pelvis: [base.pelvis[0], base.pelvis[1] + 0.006, base.pelvis[2]] as Vec3 };
  const list: KeyList = [[0, '버티기', hold()], [0.5, '숨 쉬며 버티기', hold(breathe)], [1, undefined, hold()]];
  if (fault === 'hips-sag') {
    const sag = hold({ pelvis: [base.pelvis[0], base.pelvis[1] - 0.09, base.pelvis[2]], spine: -24, pitch: (base.pitch ?? 90) + 8 });
    list.splice(0, 3, [0, '허리가 처짐', sag], [0.5, '허리가 처짐', sag], [1, undefined, sag]);
  } else if (fault === 'hips-high') {
    const high = hold({ pelvis: [base.pelvis[0], base.pelvis[1] + 0.2, base.pelvis[2] - 0.06], spine: 10, pitch: (base.pitch ?? 90) + 18 });
    list.splice(0, 3, [0, '엉덩이가 너무 높음', high], [0.5, '엉덩이가 너무 높음', high], [1, undefined, high]);
  }
  return { id, cycle: 4, view: [70, 14], keys: keys(...list), scene: [mat([0, 0, -0.35], 0.75, 1.9)], work: [0, 1], fault };
}

function sidePlank(id: string, fault?: string): Clip {
  // 오른쪽 아래팔로 버틴다. 머리는 +z, 몸 앞은 +x, 왼쪽이 위
  const elbowHeight = 0.05 + BODY.upperArm;
  const legs = { legL: { fk: [0, -6, 0, 2, 0] }, legR: { fk: [0, 4, 0, 2, 0] } };
  const body = (tilt: number, drop = 0, bend = 0): Pose3 => {
    const base: Pose3 = { pelvis: [0, 0.4, 0], yaw: 90, roll: 90 - tilt, spine: 0, bend, neck: 0, ...legs };
    const solved = solvePose(base);
    const foot = solved.bones.footR;
    const lowest = Math.min(foot.a[1], foot.b[1]);
    return { ...base, pelvis: [0, 0.4 - lowest + 0.005 - drop, 0] };
  };
  const tilt = solveFor((t) => solvePose(body(t)).bones.upperArmR.a[1], 0, 30, elbowHeight);
  const arms = (pose: Pose3): { armL: ArmSpec; armR: ArmSpec } => {
    const s = solvePose(pose).bones.upperArmR.a;
    return {
      armL: { ik: [0.04, 0.16, 0.03], in: 'pelvis', pole: [0.2, 1, -0.5], hand: [0, 1, 0] },
      armR: { ik: [s[0] + 0.26, 0.04, s[2]], pole: [0, -1, 0], hand: [0, 0, 1] },
    };
  };
  const base = body(tilt);
  const hold = { ...base, ...arms(base) };
  const breathe = { ...hold, pelvis: [hold.pelvis[0], hold.pelvis[1] + 0.006, hold.pelvis[2]] as Vec3 };
  const list: KeyList = [[0, '버티기', hold], [0.5, '숨 쉬며 버티기', breathe], [1, undefined, hold]];
  if (fault === 'hips-drop') {
    // 엉덩이는 내려가고 어깨는 그대로 — 기울기를 줄이고, 어깨 높이가 맞도록 옆구리를 굽힌다
    const bend = solveFor((b) => solvePose(body(tilt - 9, 0, b)).bones.upperArmR.a[1], -40, 20, elbowHeight);
    const sagBody = body(tilt - 9, 0, bend);
    const sag = { ...sagBody, ...arms(sagBody) };
    list.splice(0, 3, [0, '엉덩이가 내려감', sag], [0.5, '엉덩이가 내려감', sag], [1, undefined, sag]);
  }
  return { id, cycle: 4, view: [90, 10], keys: keys(...list), scene: [mat([0.1, 0, -0.35], 0.9, 1.9)], work: [0, 1], fault };
}

/* ── 앱 휠 · 데드버그 · 몸통 회전 ────────────────── */

export function abWheel(id: string, fault?: string): Clip {
  const knee: Vec3 = [0, 0.05, -0.02];
  const legs = kneeling(knee[2]);
  const wheelY = 0.09;
  const body = (thigh: number, pitch: number, spine: number, reach: number, sag = 0): Pose3 => {
    const a = thigh * DEG;
    const pelvis: Vec3 = [0, knee[1] + Math.cos(a) * BODY.thigh - sag, knee[2] + Math.sin(a) * BODY.thigh];
    const pose: Pose3 = { pelvis, pitch, spine, neck: -20, ...legs };
    const s = shoulderMid(pose);
    const flat = Math.sqrt(Math.max(0, (ARM_REACH * 0.97) ** 2 - (s[1] - wheelY) ** 2 - 0.0036));
    const wheelZ = s[2] + Math.min(flat, reach);
    return {
      ...pose,
      bar: { at: [0, wheelY, wheelZ] },
      armL: { bar: 0.12, pole: [0.4, -0.3, -1] },
      armR: { bar: -0.12, pole: [-0.4, -0.3, -1] },
    };
  };
  const tucked = body(18, 64, 16, 0.05);
  const out = body(58, 84, 0, 1);
  const list = liftKeys(tucked, out, ['굴려 나가기', '허리가 처지기 전까지', '배로 당겨 돌아오기']);
  if (fault === 'hips-sag') swap(list, [1, 2], '허리가 처짐', { ...body(58, 90, -24, 1) });
  return { id, cycle: 3.4, view: [72, 12], keys: keys(...list), scene: [mat([0, 0, 0.3], 0.8, 1.7)], bar: { kind: 'wheel' }, work: [0.54, 1], fault };
}

export function deadBug(id: string, fault?: string): Clip {
  const body = (armL: number, armR: number, legL: number[], legR: number[], extra: Partial<Pose3> = {}): Pose3 => ({
    pelvis: [0, 0.11, 0.15], pitch: -90, spine: -2, neck: 6,
    armL: { fk: [0, armL, 0, 6], turn: 90 }, armR: { fk: [0, armR, 0, 6], turn: 90 },
    legL: { fk: legL }, legR: { fk: legR }, ...extra,
  });
  const table = [90, 4, 0, 90, 0];
  const long = [16, 4, 0, 6, 0];
  const rest = body(90, 90, table, table);
  const left = body(90, 162, long, table);
  const right = body(162, 90, table, long);
  const list: KeyList = [[0, '오른팔 · 왼다리 뻗기', rest], [0.22, undefined, left], [0.32, '돌아오기', left], [0.5, '왼팔 · 오른다리 뻗기', rest], [0.72, undefined, right], [0.82, '돌아오기', right], [1, undefined, rest]];
  if (fault === 'back-arch') {
    const arch = { spine: -10, neck: 16, pelvis: [0, 0.135, 0.15] as Vec3 };
    setKey(list, 1, '허리가 바닥에서 뜸', body(90, 150, long, table, arch));
    setKey(list, 2, '허리가 바닥에서 뜸', body(90, 150, long, table, arch));
    setKey(list, 4, '허리가 바닥에서 뜸', body(150, 90, table, long, arch));
    setKey(list, 5, '허리가 바닥에서 뜸', body(150, 90, table, long, arch));
  }
  return { id, cycle: 4.4, view: [62, 22], keys: keys(...list), scene: [mat([0, 0, -0.1], 0.75, 1.8)], work: [0, 1], fault };
}

export function torsoRotation(id: string, fault?: string): Clip {
  const base = seated(0.48, 0, 2, {}, 0.46);
  const hands = { armL: { ik: [0.17, 0.3, 0.3] as Vec3, in: 'chest' as const, pole: [0.8, -1, -0.2] as Vec3, hand: [0, 1, 0] as Vec3 }, armR: { ik: [-0.17, 0.3, 0.3] as Vec3, in: 'chest' as const, pole: [-0.8, -1, -0.2] as Vec3, hand: [0, 1, 0] as Vec3 } };
  const at = (twist: number): Pose3 => ({ ...base, twist, ...hands });
  const list: KeyList = [[0, '천천히 돌리기', at(-38)], [0.42, '끝에서 멈춤', at(38)], [0.54, '반대로 돌리기', at(38)], [1, undefined, at(-38)]];
  if (fault === 'swing') list.splice(0, 4, [0, '반동으로 휙', at(-60)], [0.18, undefined, at(60)], [0.36, undefined, at(-60)], [0.54, undefined, at(60)], [0.72, undefined, at(-60)], [1, undefined, at(-60)]);
  return {
    id, cycle: 3.2, view: [20, 26], keys: keys(...list),
    scene: [...seatBench(0, 88, { seat: 0.48, backLen: 0.01 }).slice(0, 1), { kind: 'frame', p: [0, 0.24, 0.05], size: [0.06, 0.44, 0.06] }, { kind: 'frame', p: [0, 0.03, 0.05], size: [0.5, 0.06, 0.5] }, ...machineFrame(-0.5, 1.6, 0.9)],
    links: [{ kind: 'pad', bone: 'chest', u: 0.62, off: [0, 0, 0.2], size: [0.42, 0.18, 0.07] }],
    work: [0, 0.42], fault,
  };
}

/* ── 파머스 워크 ─────────────────────────────────── */

export function farmersWalk(id: string, fault?: string): Clip {
  const step = 0.27;
  // 바닥이 뒤로 흐르는 위에서 제자리 걷기 — 디딘 발은 바닥과 같이 뒤로 간다
  const stance = (x: number, z: number, heel = 0): LegSpec => ballAt(x, z + 0.135, 8, heel);
  const swing = (x: number, z: number, lift: number): LegSpec => ({ ankle: [x, BODY.ankle + lift, z], fwd: [0, -0.15, 0.99], up: [0, 0.99, 0.15], pole: [0, 0.2, 1] });
  const arms = hangingArms(90, 6, 4, 80);
  const lean = fault === 'lean' ? 14 : 0;
  const pose = (legL: LegSpec, legR: LegSpec, y: number, bend = 0): Pose3 => ({
    pelvis: [0, y, -0.03], pitch: 3, spine: 0, bend, neck: 0, legL, legR, ...arms,
  });
  const contact = STAND_HEIGHT - 0.05;
  const mid = STAND_HEIGHT - 0.02;
  const list: KeyList = [
    [0, fault === 'lean' ? '몸이 한쪽으로 기움' : '작은 보폭으로 걷기', pose(stance(0.1, step), stance(-0.1, -step, 30), contact, lean)],
    [0.25, undefined, pose(stance(0.1, 0), swing(-0.1, 0, 0.1), mid, lean)],
    [0.5, undefined, pose(stance(0.1, -step, 30), stance(-0.1, step), contact, lean)],
    [0.75, undefined, pose(swing(0.1, 0, 0.1), stance(-0.1, 0), mid, lean)],
    [1, undefined, pose(stance(0.1, step), stance(-0.1, -step, 30), contact, lean)],
  ];
  return {
    id, cycle: 1.3, view: [70, 8], keys: keys(...list), scene: [], hold: { L: 'dumbbell', R: 'dumbbell' },
    walk: step * 4, linear: true, work: [0, 1], fault,
  };
}

export { flatBench, plant, lying, sub, madd, type Prim };
