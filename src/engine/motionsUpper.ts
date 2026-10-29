/**
 * 상체 종목 시연 — 밀기 · 당기기 · 어깨 · 팔.
 *
 * 손이 기구에 붙는 동작(벤치 · 로우 · 풀다운)은 손이 갈 곳을 주고 팔꿈치는 계산에 맡긴다.
 * 팔만 도는 고립 동작(레이즈 · 컬)은 관절 각도로 준다.
 */
import {
  ARM_REACH, STAND_HEIGHT, block, cableTower, chestPoint, dipBars, flatBench, floorHands, footOn, handsOnHips,
  hangingArms, hipHinge, keys, lying, machineFrame, mat, pelvisFromLegs, placeShoulders, plank, plant, pullupBar, rack,
  seatBench, seated, setKey, shoulderMid, solvePose, solveFor, standing, stool,
  type Clip, type Link, type Prim,
} from './motionKit.ts';
import { BODY, add, madd, normalize, scale, sub, type ArmSpec, type LegSpec, type Pose3, type Vec3 } from './rig.ts';

type KeyList = [number, string | undefined, Pose3][];

const DEG = Math.PI / 180;

/** 내리고 → 바닥 → 올리는 기본 네 키 (힘쓰는 구간이 올리는 쪽) */
function pressKeys(top: Pose3, bottom: Pose3, words: [string, string, string]): KeyList {
  return [[0, words[0], top], [0.45, words[1], bottom], [0.53, words[2], bottom], [1, undefined, top]];
}

/** 올리고 → 꼭대기 → 내리는 기본 네 키 (힘쓰는 구간이 올리는 쪽) */
function liftKeys(start: Pose3, end: Pose3, words: [string, string, string]): KeyList {
  return [[0, words[0], start], [0.42, words[1], end], [0.54, words[2], end], [1, undefined, start]];
}

/** i, j번째 키의 자세를 바꾸고 첫 키에 말을 단다 */
function swap(list: KeyList, at: number[], label: string, pose: Pose3): void {
  at.forEach((i, n) => setKey(list, i, n === 0 ? label : list[i]![1], pose));
}

/** 손잡이에 붙은 기계 팔 (손 → 축) */
function levers(pivotL: Vec3, pivotR: Vec3): Link[] {
  return [
    { kind: 'bar', bone: 'handL', u: 0.32, size: [0.018, 0.12], pivot: pivotL, hidden: true },
    { kind: 'bar', bone: 'handR', u: 0.32, size: [0.018, 0.12], pivot: pivotR, hidden: true },
  ];
}

/* ── 벤치프레스 계열 ─────────────────────────────── */

export interface PressOpts {
  implement: 'barbell' | 'dumbbell' | 'smith';
  /** 등판 각 — 0 평평, 30 인클라인, −15 디클라인 */
  incline?: number;
  close?: boolean;
  floor?: boolean;
}

export function press(id: string, opts: PressOpts, fault?: string): Clip {
  const incline = opts.incline ?? 0;
  const floor = Boolean(opts.floor);
  let body: Pose3;
  let scene: Prim[];
  if (floor) {
    body = lying({}, 0.3, 0);
    scene = [mat([0, 0, 0.1], 0.8, 1.9)];
  } else if (incline > 0) {
    body = seated(0.45, 0.25, 90 - incline, { spine: -4, neck: 4 }, 0.5, 0.28);
    scene = seatBench(0.25, incline, { seat: 0.45, backLen: 0.95 });
  } else if (incline < 0) {
    // 디클라인 — 머리 쪽이 낮다. 발목을 높은 쪽 끝의 패드 밑에 건다
    const tilt = -incline;
    const slope = Math.tan(tilt * DEG);
    const padTop = (z: number) => 0.54 + (z + 0.05) * slope;
    const hipZ = 0.34;
    const hook = (x: number): LegSpec => ({ ankle: [x, 0.5, 0.86], fwd: normalize([0, -0.55, 0.84]), up: normalize([0, 0.84, 0.55]), pole: [x * 1.5, 1, 0.4] });
    body = { pelvis: [0, padTop(hipZ) + 0.11, hipZ], pitch: -90 - tilt, spine: -4, neck: 8, legL: hook(0.13), legR: hook(-0.13) };
    scene = [
      { kind: 'pad', p: [0, 0.505, -0.05], size: [0.28, 0.07, 1.25], x: [1, 0, 0], y: normalize([0, Math.cos(tilt * DEG), -Math.sin(tilt * DEG)]) },
      { kind: 'roller', p: [0, 0.6, 0.93], size: [0.05, 0.36] },
      { kind: 'roller', p: [0, 0.44, 0.78], size: [0.05, 0.36] },
      { kind: 'frame', p: [0, 0.27, -0.5], size: [0.06, 0.44, 0.06] },
      { kind: 'frame', p: [0, 0.34, 0.72], size: [0.06, 0.6, 0.06] },
      { kind: 'frame', p: [0, 0.03, 0.1], size: [0.5, 0.06, 1.4] },
    ];
  } else {
    body = lying();
    scene = flatBench(-0.72, 0.5);
  }
  const dumbbell = opts.implement === 'dumbbell';
  if (!dumbbell && !floor) scene = [...scene, ...(opts.implement === 'smith' ? smithRails(body) : rack(incline > 0 ? -0.2 : -0.42, incline > 0 ? 1.35 : 1.05, 0.62))];

  const s = shoulderMid(body);
  const grip = opts.close ? 0.17 : 0.4;
  const reachUp = Math.sqrt((ARM_REACH * 0.985) ** 2 - (grip - 0.18) ** 2);
  // 바가 닿는 곳 — 평평하면 명치 위, 인클라인은 윗가슴, 디클라인은 아랫가슴. 바닥 프레스는 팔꿈치가 바닥에 닿는 데서 멈춘다
  const touchY = incline > 0 ? 0.22 : incline < 0 ? 0.13 : 0.17;
  const touch = chestPoint(body, [0, touchY, floor ? 0.27 : 0.185]);
  const lockout: Vec3 = [0, s[1] + reachUp, opts.implement === 'smith' ? touch[2] : s[2] + 0.02];
  const bottomBar: Vec3 = opts.implement === 'smith' ? [0, touch[1], touch[2]] : touch;
  const pole = (side: 1 | -1, flare = false): Vec3 => flare ? [side, 0.1, -0.3] : opts.close ? [side * 0.25, -0.8, -1] : [side * 0.75, -0.4, -1];

  const pose = (bar: Vec3, extra: Partial<Pose3> = {}, flare = false): Pose3 => {
    if (dumbbell) {
      // 덤벨은 아래에서 넓게(가슴 옆), 위에서 좁게
      const depth = Math.min(1, Math.max(0, (lockout[1] - bar[1]) / Math.max(0.05, lockout[1] - bottomBar[1])));
      const wide = 0.16 + 0.11 * depth;
      const hand = (side: 1 | -1): ArmSpec => ({ ik: [side * wide, bar[1], bar[2]], pole: pole(side, flare), in: 'world', hand: [1, 0, 0] });
      return { ...body, armL: { ...hand(1), pole: chestPole(body, pole(1, flare)) }, armR: { ...hand(-1), pole: chestPole(body, pole(-1, flare)) }, ...extra };
    }
    return {
      ...body,
      armL: { bar: grip, pole: pole(1, flare), in: 'chest' },
      armR: { bar: -grip, pole: pole(-1, flare), in: 'chest' },
      bar: { at: bar },
      ...extra,
    };
  };
  const top = pose(lockout);
  const low = pose(bottomBar);
  const list = pressKeys(top, low, ['내리기', floor ? '팔꿈치가 바닥에' : '가슴에 닿기', '밀기']);
  if (fault === 'elbow-flare') {
    const neck = chestPoint(body, [0, 0.27, floor ? 0.27 : 0.19]);
    swap(list, [1, 2], '팔꿈치가 벌어짐', pose(dumbbell ? bottomBar : neck, {}, true));
  } else if (fault === 'butt-off') {
    const arch = { pelvis: [body.pelvis[0], body.pelvis[1] + 0.09, body.pelvis[2]] as Vec3, spine: -26 };
    setKey(list, 2, '엉덩이가 뜸', pose(bottomBar, arch));
    list.splice(3, 0, [0.75, undefined, pose([0, (bottomBar[1] + lockout[1]) / 2, (bottomBar[2] + lockout[2]) / 2], arch)]);
  } else if (fault === 'shoulders-up') {
    const up = { scap: [0.4, 0.9] };
    setKey(list, 0, '어깨가 들림', pose([lockout[0], lockout[1] + 0.05, lockout[2]], up));
    setKey(list, 1, undefined, pose([bottomBar[0], bottomBar[1] + 0.03, bottomBar[2]], up));
    setKey(list, 2, undefined, pose([bottomBar[0], bottomBar[1] + 0.03, bottomBar[2]], up));
    setKey(list, 3, undefined, pose([lockout[0], lockout[1] + 0.05, lockout[2]], up));
  } else if (fault === 'bounce') {
    list.splice(0, 4, [0, '가슴에서 튕김', top], [0.38, undefined, low], [0.44, undefined, pose([0, bottomBar[1] + 0.07, bottomBar[2]])], [0.5, undefined, low], [0.62, undefined, pose([0, bottomBar[1] + 0.1, bottomBar[2]])], [1, undefined, top]);
  }
  return {
    id, cycle: 3, view: floor ? [40, 26] : incline > 0 ? [64, 16] : [36, 24], keys: keys(...list), scene,
    bar: dumbbell ? undefined : { kind: opts.implement === 'smith' ? 'smith' : 'barbell', plates: 0.225 },
    hold: dumbbell ? { L: 'dumbbell', R: 'dumbbell' } : undefined,
    work: [0.53, 1], fault,
  };
}

/** 가슴 틀 기준 팔꿈치 방향을 세계 방향으로 (손 목표가 세계 좌표일 때) */
function chestPole(body: Pose3, local: Vec3): Vec3 {
  const chest = solvePose(body).frames.chest;
  return [
    chest.x[0] * local[0] + chest.y[0] * local[1] + chest.z[0] * local[2],
    chest.x[1] * local[0] + chest.y[1] * local[1] + chest.z[1] * local[2],
    chest.x[2] * local[0] + chest.y[2] * local[1] + chest.z[2] * local[2],
  ];
}

/** 스미스 머신 레일 — 몸 위로 곧게 */
function smithRails(body: Pose3): Prim[] {
  const z = shoulderMid(body)[2] + 0.08;
  return [
    { kind: 'post', p: [0.78, 1.1, z], size: [0.06, 2.2, 0.06] },
    { kind: 'post', p: [-0.78, 1.1, z], size: [0.06, 2.2, 0.06] },
    { kind: 'frame', p: [0, 2.2, z], size: [1.62, 0.07, 0.07] },
  ];
}

/* ── 머신 체스트 프레스 ──────────────────────────── */

export function machinePress(id: string, upward: boolean, fault?: string): Clip {
  const body = seated(0.46, 0, 10, {}, 0.5);
  const hands = (reach: number, high: number, extra: Partial<ArmSpec> = {}): { armL: ArmSpec; armR: ArmSpec } => ({
    armL: { ik: [0.24, high, reach], in: 'chest', pole: [0.85, -0.7, -0.5], hand: [0, 1, 0], ...extra },
    armR: { ik: [-0.24, high, reach], in: 'chest', pole: [-0.85, -0.7, -0.5], hand: [0, 1, 0], ...extra },
  });
  const close = { ...body, ...hands(0.2, 0.2) };
  const far = { ...body, ...hands(upward ? 0.5 : 0.56, upward ? 0.4 : 0.2) };
  const list = liftKeys(close, far, ['밀기', '끝까지', '천천히 돌아오기']);
  if (fault === 'shoulders-roll') {
    swap(list, [1, 2], '어깨가 앞으로 말림', { ...far, spine: 18, scap: [0.4, 1], ...hands(upward ? 0.5 : 0.58, upward ? 0.36 : 0.16) });
  } else if (fault === 'seat') {
    swap(list, [0, 3], '손잡이가 너무 높음', { ...body, ...hands(0.2, 0.36) });
    swap(list, [1, 2], '손잡이가 너무 높음', { ...body, ...hands(0.46, 0.5) });
  } else if (fault === 'elbow-flare') {
    swap(list, [0, 3], '팔꿈치가 벌어짐', { ...body, ...hands(0.2, 0.22, { pole: [1, 0.15, -0.3] }), armR: { ...hands(0.2, 0.22).armR, pole: [-1, 0.15, -0.3] } });
  }
  const s = shoulderMid(body);
  return {
    id, cycle: 2.8, view: [62, 12], keys: keys(...list),
    scene: [...seatBench(0, 80, { seat: 0.46, backLen: 0.85 }), ...machineFrame(-0.45, 1.75, 1.0)],
    hold: { L: 'dHandle', R: 'dHandle' },
    links: levers([0.42, s[1] + 0.32, s[2] - 0.15], [-0.42, s[1] + 0.32, s[2] - 0.15]),
    work: [0, 0.42], fault,
  };
}

/* ── 푸시업 · 파이크 푸시업 ──────────────────────── */

const PRESS_REACH = BODY.upperArm + BODY.forearm;

export function pushUp(id: string, fault?: string): Clip {
  const toeZ = -0.98;
  const shoulderHeight = (angle: number) => shoulderMid(plank(angle, toeZ))[1];
  const topAngle = solveFor(shoulderHeight, 2, 40, 0.035 + PRESS_REACH * 0.975);
  const lowAngle = solveFor(shoulderHeight, -2, 30, 0.2);
  // 손 자리는 위에서 정하고 내려갈 때 그대로 둔다
  const topBody = plank(topAngle, toeZ);
  const hands = (flare = false) => floorHands(topBody, flare);
  const top = plank(topAngle, toeZ, hands());
  const low = plank(lowAngle, toeZ, hands());
  const list = pressKeys(top, low, ['내려가기', '가슴이 바닥 가까이', '밀기']);
  if (fault === 'hips-sag') {
    const sag = (p: Pose3): Pose3 => ({ ...p, pelvis: [p.pelvis[0], p.pelvis[1] - 0.075, p.pelvis[2] + 0.01], spine: -24, pitch: (p.pitch ?? 90) + 9 });
    swap(list, [0, 3], '허리가 처짐', sag(top));
    swap(list, [1, 2], '허리가 처짐', sag(low));
  } else if (fault === 'elbow-flare') {
    swap(list, [1, 2], '팔꿈치가 벌어짐', { ...low, ...hands(true) });
  }
  return { id, cycle: 2.8, view: [70, 12], keys: keys(...list), scene: [mat([0, 0, -0.35], 0.8, 1.9)], work: [0.53, 1], fault };
}

export function pikePushUp(id: string, fault?: string): Clip {
  // 엉덩이를 높이 든 ㅅ자 — 상체와 팔이 한 줄로 앞 아래를 향하고, 다리는 엉덩이 뒤 아래로 곧게
  const wristReach = PRESS_REACH * 0.97;
  const hands = (s: Vec3): { armL: ArmSpec; armR: ArmSpec } => ({
    armL: { ik: [0.26, 0.022, s[2] + 0.14], pole: [0.6, 0.4, -1], point: [0.1, 0, 1] },
    armR: { ik: [-0.26, 0.022, s[2] + 0.14], pole: [-0.6, 0.4, -1], point: [-0.1, 0, 1] },
  });
  const torso = (pelvis: Vec3, shoulderY: number): Pose3 => {
    const base: Pose3 = { pelvis, pitch: 130, spine: 0, neck: -24 };
    const pitch = solveFor((p) => shoulderMid({ ...base, pitch: p })[1], 95, 178, shoulderY);
    return { ...base, pitch };
  };
  const topPelvis: Vec3 = [0, 0.88, 0];
  const topShoulderY = 0.022 + Math.sqrt(wristReach ** 2 - 0.08 ** 2 - 0.065 ** 2);
  const topTorso = torso(topPelvis, topShoulderY);
  const fixedHands = hands(shoulderMid(topTorso));
  const ballZ = topPelvis[2] - 0.245;
  const feet = { legL: ballAt2(0.12, ballZ, 22), legR: ballAt2(-0.12, ballZ, 22) };
  const top = { ...topTorso, ...feet, ...fixedHands };
  const low = { ...torso([0, 0.84, 0.05], 0.3), ...feet, ...fixedHands };
  const list = pressKeys(top, low, ['머리를 손 앞으로', '정수리가 바닥 가까이', '밀기']);
  if (fault === 'half-rep') swap(list, [1, 2], '조금만 내려감', { ...torso([0, 0.87, 0.02], 0.45), ...feet, ...fixedHands });
  return { id, cycle: 2.8, view: [76, 10], keys: keys(...list), scene: [mat([0, 0, 0], 0.8, 1.6)], work: [0.53, 1], fault };
}

function ballAt2(x: number, z: number, heel: number): LegSpec {
  return footOn([x, 0, z], [0, 1, 0], [0, 0, 1], heel);
}

/* ── 딥스 ───────────────────────────────────────── */

export function dip(id: string, kind: 'chest' | 'triceps' | 'machine', fault?: string): Clip {
  if (kind === 'machine') return machineDip(id, fault);
  const barY = 1.15;
  const half = 0.25;
  const chest = kind === 'chest';
  const legs = { legL: { fk: [chest ? 26 : 12, 4, 0, 80, -20] }, legR: { fk: [chest ? 26 : 12, 4, 0, 80, -20] } };
  const hand = (side: 1 | -1): ArmSpec => ({ ik: [side * half, barY + 0.02, 0.06], pole: chest ? [side * 0.55, 0.1, -1] : [side * 0.15, 0.1, -1], hand: [0, 0, 1] });
  const at = (y: number, z: number, pitch: number, extra: Partial<Pose3> = {}): Pose3 =>
    placeShoulders({ pelvis: [0, 1.2, 0], pitch, spine: 0, neck: chest ? -10 : 0, ...legs, armL: hand(1), armR: hand(-1), ...extra }, [0, y, z]);
  const top = at(barY + 0.57, 0.05, chest ? 10 : 3);
  const low = chest ? at(barY + 0.26, 0.13, 32) : at(barY + 0.3, 0.03, 6);
  const list = pressKeys(top, low, ['내려가기', '어깨가 팔꿈치 높이', '밀어 올리기']);
  if (fault === 'too-deep') swap(list, [1, 2], '너무 깊이', chest ? at(barY + 0.15, 0.16, 38) : at(barY + 0.17, 0.05, 10));
  else if (fault === 'shoulders-up') swap(list, [1, 2], '어깨가 들림', chest ? at(barY + 0.3, 0.12, 30, { scap: [1, 0.4] }) : at(barY + 0.32, 0.03, 6, { scap: [1, 0.4] }));
  else if (fault === 'lean') swap(list, [1, 2], '상체가 숙여짐', at(barY + 0.3, 0.14, 34));
  return { id, cycle: 3, view: [62, 10], keys: keys(...list), scene: dipBars(barY, half, 0.06), work: [0.53, 1], fault };
}

function machineDip(id: string, fault?: string): Clip {
  const body = seated(0.48, 0, 4, {}, 0.48);
  const hands = (y: number, z: number, x = 0.26): { armL: ArmSpec; armR: ArmSpec } => ({
    armL: { ik: [x, y, z], in: 'pelvis', pole: [0.25, 0.3, -1], hand: [0, 0, 1] },
    armR: { ik: [-x, y, z], in: 'pelvis', pole: [-0.25, 0.3, -1], hand: [0, 0, 1] },
  });
  // 위 — 손잡이는 가슴 아래 옆, 팔꿈치는 뒤로. 아래 — 팔이 거의 펴지게 엉덩이 옆 아래까지
  const up = { ...body, ...hands(0.24, 0.16) };
  const down = { ...body, ...hands(-0.12, 0.05, 0.3) };
  const list = liftKeys(up, down, ['아래로 밀기', '끝까지', '천천히 올리기']);
  if (fault === 'lean') swap(list, [1, 2], '상체가 숙여짐', { ...body, pitch: 24, ...hands(-0.06, 0.14, 0.3) });
  else if (fault === 'shoulders-up') swap(list, [0, 3], '어깨가 들림', { ...body, scap: [1, 0.3], ...hands(0.28, 0.16) });
  const s = shoulderMid(body);
  return {
    id, cycle: 2.8, view: [62, 12], keys: keys(...list),
    scene: [...seatBench(0, 82, { seat: 0.48 }), ...machineFrame(-0.45, 1.6, 0.9)],
    hold: { L: 'dHandle', R: 'dHandle' },
    links: levers([0.4, s[1] - 0.05, s[2] - 0.35], [-0.4, s[1] - 0.05, s[2] - 0.35]),
    work: [0, 0.42], fault,
  };
}

/* ── 오버헤드 프레스 ─────────────────────────────── */

export type OverheadKind = 'barbell' | 'dbSeated' | 'dbStanding' | 'arnold' | 'machine';

export function overheadPress(id: string, kind: OverheadKind, fault?: string): Clip {
  const seatedKind = kind === 'dbSeated' || kind === 'arnold' || kind === 'machine';
  const body = seatedKind ? seated(0.46, 0, 6, {}, 0.48) : standing({}, 0.16, 10);
  const s = shoulderMid(body);
  let list: KeyList;
  let hold: Clip['hold'];
  let bar: Clip['bar'];
  let links: Link[] | undefined;
  if (kind === 'barbell') {
    bar = { kind: 'barbell', plates: 0.225 };
    const grip = 0.25;
    const at = (b: Vec3, high: boolean, extra: Partial<Pose3> = {}): Pose3 => ({
      ...body,
      armL: { bar: grip, pole: high ? [1, -0.2, 0] : [0.25, -1, 0.7], in: 'chest' },
      armR: { bar: -grip, pole: high ? [-1, -0.2, 0] : [-0.25, -1, 0.7], in: 'chest' },
      bar: { at: b }, ...extra,
    });
    const rackBar = chestPoint(body, [0, 0.255, 0.15]);
    const lock: Vec3 = [0, s[1] + Math.sqrt((ARM_REACH * 0.985) ** 2 - (grip - 0.18) ** 2), s[2] - 0.01];
    const passing: Vec3 = [0, s[1] + 0.25, s[2] + 0.06];
    list = [[0, '밀어 올리기', at(rackBar, false)], [0.18, '머리를 살짝 뒤로', at(passing, false, { neck: -10 })], [0.42, '머리 위 잠그기', at(lock, true)], [0.54, '천천히 내리기', at(lock, true)], [0.8, undefined, at(passing, false, { neck: -10 })], [1, undefined, at(rackBar, false)]];
    if (fault === 'arch') {
      const arch = { spine: -22, pelvis: [0, STAND_HEIGHT, 0.05] as Vec3 };
      swap(list, [2, 3], '허리를 젖혀서 밂', at([lock[0], lock[1] - 0.03, lock[2] + 0.14], true, arch));
    } else if (fault === 'bar-forward') {
      swap(list, [2, 3], '바가 얼굴 앞으로', at([0, lock[1] - 0.06, lock[2] + 0.22], true));
      swap(list, [1, 4], '바가 얼굴 앞으로', at([0, passing[1], passing[2] + 0.14], false));
    }
  } else {
    hold = kind === 'machine' ? { L: 'dHandle', R: 'dHandle' } : { L: 'dumbbell', R: 'dumbbell' };
    const hands = (wide: number, high: number, ahead: number, pole: Vec3, extra: Partial<Pose3> = {}): Pose3 => ({
      ...body,
      armL: { ik: [s[0] + wide, s[1] + high, s[2] + ahead], pole, hand: kind === 'machine' ? [0, 0, 1] : [1, 0, 0] },
      armR: { ik: [s[0] - wide, s[1] + high, s[2] + ahead], pole: [-pole[0], pole[1], pole[2]], hand: kind === 'machine' ? [0, 0, 1] : [1, 0, 0] },
      ...extra,
    });
    // 아래 — 팔뚝이 서도록 손은 어깨 바깥, 귀 높이 (팔꿈치를 다 접지 않는다)
    const low = hands(0.42, 0.17, 0.05, [1, -0.6, -0.1]);
    const top = hands(0.15, 0.57, 0.0, [1, -0.2, 0]);
    if (kind === 'arnold') {
      const front = hands(0.12, 0.08, 0.18, [0.2, -1, 0.5]);
      const open = hands(0.32, 0.22, 0.08, [1, -0.6, 0.1]);
      list = [[0, '돌리며 올리기', front], [0.18, undefined, open], [0.42, '머리 위', top], [0.54, '돌리며 내리기', top], [0.8, undefined, open], [1, undefined, front]];
    } else {
      list = liftKeys(low, top, ['밀어 올리기', '머리 위', '귀 높이까지 내리기']);
    }
    if (fault === 'arch') {
      const arched: Partial<Pose3> = seatedKind ? { pitch: -16, spine: -20 } : { spine: -22, pelvis: [0, STAND_HEIGHT, 0.05] };
      const t = shoulderMid({ ...body, ...arched });
      const hand = (side: 1 | -1): ArmSpec => ({ ik: [t[0] + side * 0.15, t[1] + 0.55, t[2] + 0.08], pole: [side, -0.2, 0], hand: kind === 'machine' ? [0, 0, 1] : [1, 0, 0] });
      swap(list, kind === 'arnold' ? [2, 3] : [1, 2], seatedKind ? '등받이에서 허리가 뜸' : '허리를 젖혀서 밂', { ...body, ...arched, armL: hand(1), armR: hand(-1) });
    } else if (fault === 'half-rep') {
      const half = hands(0.3, 0.38, 0.03, [1, -0.5, 0]);
      swap(list, kind === 'arnold' ? [0, 5] : [0, 3], '조금만 내림', half);
    }
    if (kind === 'machine') links = levers([0.36, s[1] + 0.8, s[2] - 0.3], [-0.36, s[1] + 0.8, s[2] - 0.3]);
  }
  const scene: Prim[] = seatedKind ? [...seatBench(0, 84, { seat: 0.46, backLen: 0.9 })] : [];
  if (kind === 'machine') scene.push(...machineFrame(-0.45, 2.0, 1.0));
  if (kind === 'barbell') scene.push(...rack(-0.5, 1.4));
  return { id, cycle: 3, view: seatedKind ? [28, 8] : [40, 8], keys: keys(...list), scene, bar, hold, links, work: [0, 0.42], fault };
}

export function landminePress(id: string, fault?: string): Clip {
  const pivot: Vec3 = [0, 0.04, 1.8];
  const legs = { legL: plant(0.13, 0.22, 10), legR: plant(-0.15, -0.22, 10, { heel: 12 }) };
  const body: Pose3 = { pelvis: [0, 0.88, -0.02], pitch: 10, spine: 0, ...legs, ...handsOnHips() };
  const s = shoulderMid(body);
  const start: Vec3 = [s[0] - 0.13, s[1] - 0.05, s[2] + 0.19];
  const radius = Math.hypot(start[1] - pivot[1], start[2] - pivot[2]);
  const endZ = s[2] + 0.5;
  const end: Vec3 = [s[0] - 0.05, pivot[1] + Math.sqrt(radius * radius - (endZ - pivot[2]) ** 2), endZ];
  const at = (hand: Vec3, extra: Partial<Pose3> = {}): Pose3 => ({
    ...body,
    armL: handsOnHips().armL,
    armR: { bar: 0, pole: [-0.5, -1, 0.2] },
    bar: { at: hand, dir: normalize(sub(hand, pivot)) },
    ...extra,
  });
  const list = liftKeys(at(start), at(end), ['앞 위로 밀기', '팔을 쭉', '천천히 내리기']);
  if (fault === 'arch') {
    const arched: Partial<Pose3> = { spine: -20, pitch: 0 };
    const t = solvePose({ ...body, ...arched }).bones.upperArmR.a;
    const hand: Vec3 = [t[0] + 0.05, pivot[1] + Math.sqrt(radius * radius - (t[2] + 0.42 - pivot[2]) ** 2), t[2] + 0.42];
    swap(list, [1, 2], '허리를 젖혀서 밂', at(hand, arched));
  }
  return {
    id, cycle: 2.8, view: [62, 10], keys: keys(...list),
    scene: [{ kind: 'post', p: pivot, size: [0.12, 0.08, 0.12] }],
    bar: { kind: 'landmine', plates: 0.2, pivot }, side: 'R', work: [0, 0.42], fault,
  };
}

/* ── 로우 ───────────────────────────────────────── */

export type RowKind = 'barbell' | 'pendlay' | 'dbBent' | 'oneArm' | 'tBar' | 'chestSupported' | 'cableSeated' | 'machineHigh' | 'inverted';

export function row(id: string, kind: RowKind, fault?: string): Clip {
  switch (kind) {
    case 'oneArm': return oneArmRow(id, fault);
    case 'tBar': return tBarRow(id, fault);
    case 'chestSupported': return supportedRow(id, false, fault);
    case 'machineHigh': return supportedRow(id, true, fault);
    case 'cableSeated': return cableRow(id, fault);
    case 'inverted': return invertedRow(id, fault);
    default: return bentRow(id, kind, fault);
  }
}

function bentRow(id: string, kind: 'barbell' | 'pendlay' | 'dbBent', fault?: string): Clip {
  const pendlay = kind === 'pendlay';
  const db = kind === 'dbBent';
  const legs = { legL: plant(0.15, 0, 10), legR: plant(-0.15, 0, 10) };
  const grip = db ? 0.17 : 0.27;
  const knee = pendlay ? 34 : 24;
  const back = pendlay ? -0.3 : -0.25;
  const base: Pose3 = { pelvis: pelvisFromLegs(legs.legL, knee, back), pitch: pendlay ? 84 : 58, spine: 2, neck: pendlay ? -36 : -28, ...legs };
  const pole = (side: 1 | -1, flare = false): Vec3 => flare ? [side, 0.3, -0.1] : db ? [side * 0.12, 0.6, -1] : [side * 0.35, 0.6, -1];
  const arms = (flare = false): { armL: ArmSpec; armR: ArmSpec } => ({
    armL: { bar: grip, pole: pole(1, flare), hand: db ? [0, 0, 1] : undefined },
    armR: { bar: -grip, pole: pole(-1, flare), hand: db ? [0, 0, 1] : undefined },
  });
  // 아래: 팔이 곧게 늘어진 자리 (펜들레이는 바닥). 위: 바가 갈비뼈 아래에 닿는 자리
  let low: Pose3;
  if (pendlay) low = { ...hipHinge({ ...base, ...arms() }, { knee, back, barY: 0.225, grip, ahead: -0.02 }), neck: -36 };
  else {
    const s = shoulderMid(base);
    const hang = Math.sqrt((ARM_REACH * 0.97) ** 2 - (grip - 0.18) ** 2);
    low = { ...base, ...arms(), bar: { at: [0, s[1] - hang, s[2] - 0.02] } };
  }
  const touch = chestPoint(low, [0, pendlay ? 0.14 : 0.06, 0.2]);
  const high: Pose3 = { ...low, bar: { at: touch } };
  const list = liftKeys(low, high, ['당기기', '갈비뼈에 닿기', '천천히 내리기']);
  if (fault === 'stand-up') {
    const up: Pose3 = { ...low, pitch: (low.pitch ?? 60) - 32, neck: -10 };
    swap(list, [1, 2], '상체가 일어남', { ...up, bar: { at: chestPoint(up, [0, 0.06, 0.2]) } });
  } else if (fault === 'round-back') {
    const round: Pose3 = { ...low, spine: 38, pitch: (low.pitch ?? 60) - 8, neck: -10 };
    const s = shoulderMid(round);
    swap(list, [0, 3], '등이 말림', { ...round, bar: { at: [0, s[1] - 0.57, s[2] - 0.02] } });
  } else if (fault === 'elbow-path') {
    swap(list, [1, 2], '팔꿈치가 옆으로', { ...high, ...arms(true), bar: { at: chestPoint(low, [0, 0.16, 0.22]) } });
  } else if (fault === 'shoulders-up') {
    swap(list, [1, 2], '어깨가 귀 쪽으로', { ...high, scap: [1, 0.2] });
  }
  return {
    id, cycle: 2.8, view: [62, 12], keys: keys(...list), scene: [mat([0, 0, 0.05], 1.9, 1.2)],
    bar: db ? { kind: 'guide' } : { kind: 'barbell', plates: 0.225 },
    hold: db ? { L: 'dumbbell', R: 'dumbbell' } : undefined,
    work: [0, 0.42], fault,
  };
}

function oneArmRow(id: string, fault?: string): Clip {
  const benchX = 0.2;
  const top = 0.45;
  // 왼 무릎과 왼손을 벤치에 — 상체는 바닥과 거의 수평
  const body = (extra: Partial<Pose3> = {}): Pose3 => ({
    pelvis: [0.06, 0.9, -0.12], pitch: 84, yaw: 0, spine: 0, neck: -20,
    // 왼 무릎은 벤치에 — 정강이와 발등을 벤치에 눕힌다
    legL: { ankle: [benchX - 0.02, top + 0.07, -0.52], fwd: normalize([0, -0.2, -1]), up: normalize([0, -1, 0.2]), pole: [0, -1, 0.3] },
    legR: plant(-0.16, -0.08, 10, { pole: [-0.2, 0.2, 1] }),
    armL: { ik: [benchX + 0.02, top + 0.02, 0.42], pole: [1, 0.2, -0.3], point: [0, 0, 1] },
    ...extra,
  });
  const right = (at: Vec3, pole: Vec3 = [-0.15, 1, -0.5]): ArmSpec => ({ ik: at, pole, hand: [0, 0, 1] });
  const targets = (pose: Pose3): { hang: Vec3; pull: Vec3 } => {
    const s = solvePose(pose).bones.upperArmR.a;
    return { hang: [s[0] - 0.02, s[1] - 0.58, s[2] + 0.02], pull: [s[0] - 0.05, s[1] - 0.16, s[2] - 0.22] };
  };
  const t0 = targets(body());
  const list = liftKeys(body({ armR: right(t0.hang) }), body({ armR: right(t0.pull) }), ['팔꿈치를 엉덩이 쪽으로', '끝까지 당기기', '천천히 내리기']);
  if (fault === 'twist') {
    const twisted: Partial<Pose3> = { twist: -32, roll: -10 };
    const t1 = targets(body(twisted));
    swap(list, [1, 2], '몸통이 돌아감', body({ ...twisted, armR: right([t1.pull[0], t1.pull[1] + 0.08, t1.pull[2]]) }));
  } else if (fault === 'shoulders-up') {
    const t1 = targets(body({ scapR: [1, 0.2] }));
    swap(list, [1, 2], '어깨가 귀 쪽으로', body({ armR: right(t1.pull), scapR: [1, 0.2] }));
  }
  return {
    id, cycle: 2.8, view: [-60, 14], keys: keys(...list), scene: flatBench(-0.45, 0.65, top, benchX),
    hold: { R: 'dumbbell' }, side: 'R', work: [0, 0.42], fault,
  };
}

function tBarRow(id: string, fault?: string): Clip {
  const pivot: Vec3 = [0, 0.04, -1.35];
  const legs = { legL: plant(0.22, 0.02, 14), legR: plant(-0.22, 0.02, 14) };
  const base: Pose3 = { pelvis: [0, 0.8, -0.2], pitch: 50, spine: 2, neck: -24, ...legs };
  const hinged = hipHinge(base, { knee: 26, back: -0.22, barY: 0.4, grip: 0.06, ahead: 0.02 });
  const handle = (y: number): Vec3 => {
    const r = Math.hypot(0.4 - pivot[1], hinged.bar!.at[2] - pivot[2]);
    return [0, y, pivot[2] + Math.sqrt(r * r - (y - pivot[1]) ** 2)];
  };
  const at = (pose: Pose3, h: Vec3, flare = false): Pose3 => ({
    ...pose,
    armL: { ik: [0.06, h[1] - 0.025, h[2]], pole: flare ? [1, 0.3, -0.2] : [0.25, 0.6, -1], hand: [0, 0, 1] },
    armR: { ik: [-0.06, h[1] - 0.025, h[2]], pole: flare ? [-1, 0.3, -0.2] : [-0.25, 0.6, -1], hand: [0, 0, 1] },
    bar: { at: h, dir: normalize(sub(h, pivot)) },
  });
  const low = at(hinged, handle(0.4));
  const high = at(hinged, handle(0.68));
  const list = liftKeys(low, high, ['가슴 쪽으로 당기기', '끝까지', '천천히 내리기']);
  if (fault === 'stand-up') swap(list, [1, 2], '상체가 일어남', at({ ...hinged, pitch: 26, neck: -8 }, handle(0.7)));
  else if (fault === 'round-back') swap(list, [0, 3], '등이 말림', at(hipHinge({ ...base, neck: -8 }, { knee: 26, back: -0.22, barY: 0.4, grip: 0.06, ahead: 0.02, spine: 38 }), handle(0.4)));
  else if (fault === 'elbow-path') swap(list, [1, 2], '팔꿈치가 옆으로', at(hinged, handle(0.66), true));
  return {
    id, cycle: 2.8, view: [64, 12], keys: keys(...list), scene: [{ kind: 'post', p: pivot, size: [0.12, 0.08, 0.12] }],
    bar: { kind: 'tbar', plates: 0.2, pivot }, work: [0, 0.42], fault,
  };
}

function supportedRow(id: string, high: boolean, fault?: string): Clip {
  const body = seated(0.5, 0, high ? 0 : -24, { neck: high ? 0 : -8 }, 0.42);
  const hands = (reach: number, up: number, side: number, extra: Partial<ArmSpec> = {}): { armL: ArmSpec; armR: ArmSpec } => ({
    armL: { ik: [side, up, reach], in: 'chest', pole: [0.3, high ? -0.2 : 0.3, -1], hand: [0, 1, 0], ...extra },
    armR: { ik: [-side, up, reach], in: 'chest', pole: [-0.3, high ? -0.2 : 0.3, -1], hand: [0, 1, 0], ...extra },
  });
  const out = { ...body, ...(high ? hands(0.38, 0.72, 0.24) : hands(0.58, 0.16, 0.2)) };
  // 끝 — 팔꿈치는 몸 뒤로, 손은 패드 앞면 옆까지 (가슴 지지라 손이 몸통 뒤로 가지 않는다)
  const back = { ...body, ...(high ? hands(0.3, 0.2, 0.22) : hands(0.2, 0.06, 0.26)) };
  const list = liftKeys(out, back, [high ? '아래 뒤로 당기기' : '뒤로 당기기', '끝까지', '천천히 펴기']);
  if (fault === 'chest-off') swap(list, [1, 2], '가슴이 패드에서 떨어짐', { ...back, pitch: (body.pitch ?? 0) - 24, ...(high ? hands(0.3, 0.22, 0.22) : hands(0.22, 0.1, 0.26)) });
  else if (fault === 'shoulders-up') swap(list, [1, 2], '어깨가 귀 쪽으로', { ...back, scap: [1, 0] });
  const chest = solvePose(body).bones.chest;
  const pad = madd(madd(chest.a, sub(chest.b, chest.a), 0.48), chest.f, 0.19);
  const s = shoulderMid(body);
  return {
    id, cycle: 2.8, view: [70, 12], keys: keys(...list),
    scene: [
      ...stool(0, 0.5),
      { kind: 'pad', p: pad, size: [0.36, 0.42, 0.08], x: [1, 0, 0], y: normalize(sub(chest.b, chest.a)) },
      ...machineFrame(0.75, 1.9, 1.0),
    ],
    hold: { L: 'dHandle', R: 'dHandle' },
    links: levers([0.42, high ? s[1] + 0.55 : s[1] - 0.1, s[2] + 0.62], [-0.42, high ? s[1] + 0.55 : s[1] - 0.1, s[2] + 0.62]),
    work: [0, 0.42], fault,
  };
}

function cableRow(id: string, fault?: string): Clip {
  const pulley: Vec3 = [0, 0.36, 1.25];
  const plate = (x: number): LegSpec => footOn([x, 0.22, 0.86], [0, 0.35, -1], [0, 1, 0.2], 0, [x * 2, 1, 0.3]);
  const body = (pitch: number, extra: Partial<Pose3> = {}): Pose3 => ({
    pelvis: [0, 0.44, 0], pitch, spine: 0, neck: -pitch * 0.4, legL: plate(0.14), legR: plate(-0.14), ...extra,
  });
  const hands = (pose: Pose3, reach: number, up: number, pole: Vec3 = [0.25, 0.2, -1]): Pose3 => ({
    ...pose,
    armL: { ik: [0.055, up, reach], in: 'chest', pole, hand: [0, 1, 0] },
    armR: { ik: [-0.055, up, reach], in: 'chest', pole: [-pole[0], pole[1], pole[2]], hand: [0, 1, 0] },
  });
  const out = hands(body(16), 0.56, 0.16);
  const back = hands(body(-4), 0.12, 0.04);
  const list = liftKeys(out, back, ['배꼽 쪽으로 당기기', '날개뼈 모으기', '천천히 펴기']);
  if (fault === 'rocking') {
    swap(list, [0, 3], '몸을 앞뒤로 흔듦', hands(body(42, { spine: 12 }), 0.56, 0.16));
    swap(list, [1, 2], '몸을 앞뒤로 흔듦', hands(body(-26, { spine: -8 }), 0.12, 0.04));
  } else if (fault === 'shoulders-up') swap(list, [1, 2], '어깨가 귀 쪽으로', { ...back, scap: [1, 0] });
  else if (fault === 'arms') swap(list, [1, 2], '팔로만 당김', hands(body(14), 0.18, 0.16, [0.6, -0.6, -0.5]));
  return {
    id, cycle: 2.8, view: [80, 12], keys: keys(...list),
    scene: [
      { kind: 'pad', p: [0, 0.32, 0.02], size: [0.32, 0.07, 0.6] },
      { kind: 'frame', p: [0, 0.14, 0.4], size: [0.12, 0.28, 1.6] },
      { kind: 'pad', p: [0, 0.26, 0.9], size: [0.5, 0.36, 0.05], x: [1, 0, 0], y: normalize([0, 1, 0.35]) },
      ...cableTower(pulley, [0, 0, 1]),
    ],
    bar: { kind: 'vbar' }, cables: [{ from: pulley, to: 'mid' }], work: [0, 0.42], fault,
  };
}

function invertedRow(id: string, fault?: string): Clip {
  const barY = 0.95;
  const heelZ = 1.05;
  // 뒤꿈치를 바닥에 대고 머리 쪽(−z)으로 일자로 누운 몸. angle은 바닥과 이루는 각
  const body = (angle: number, extra: Partial<Pose3> = {}): Pose3 => {
    const a = angle * DEG;
    const foot = (x: number): LegSpec => ({ ankle: [x, 0.065, heelZ - 0.07], fwd: [0, 1, 0.05], up: [0, 0.05, -1], pole: [0, 1, 0] });
    const ankle: Vec3 = [0, 0.065, heelZ - 0.07];
    const pelvis: Vec3 = [0, ankle[1] + Math.sin(a) * 0.846, ankle[2] - Math.cos(a) * 0.846];
    return { pelvis, pitch: -(90 - angle), spine: 0, neck: 8, legL: foot(0.1), legR: foot(-0.1), ...extra };
  };
  const shoulderY = (angle: number) => shoulderMid(body(angle))[1];
  const lowAngle = solveFor(shoulderY, 5, 50, barY - ARM_REACH * 0.96);
  const highAngle = solveFor(shoulderY, 5, 60, barY - 0.17);
  const barZ = shoulderMid(body(lowAngle))[2];
  const hand = (side: 1 | -1, sag = false): ArmSpec => ({ ik: [side * 0.32, barY, barZ], pole: sag ? [side * 0.6, -1, 0.4] : [side * 0.45, -1, 0.5], hand: [1, 0, 0] });
  const at = (angle: number, extra: Partial<Pose3> = {}) => body(angle, { armL: hand(1), armR: hand(-1), ...extra });
  const list = liftKeys(at(lowAngle), at(highAngle), ['가슴을 바 쪽으로', '날개뼈 모으기', '천천히 내리기']);
  if (fault === 'hips-sag') {
    // 당긴 자리에서 엉덩이가 처진다 — 몸 각도를 줄이고 허리를 젖힌 채 가슴을 바 쪽으로
    swap(list, [1, 2], '허리가 처짐', at(highAngle - 8, { spine: -22 }));
  } else if (fault === 'shoulders-up') swap(list, [1, 2], '어깨가 귀 쪽으로', at(highAngle - 4, { scap: [1, 0] }));
  return {
    id, cycle: 2.8, view: [70, 12], keys: keys(...list),
    scene: [{ kind: 'bar', p: [0, barY, barZ], size: [0.016, 1.3] }, ...rack(barZ - 0.05, barY - 0.05, 0.62)],
    work: [0, 0.42], fault,
  };
}

/* ── 풀업 · 풀다운 ──────────────────────────────── */

export type PullKind = 'pullUp' | 'chinUp' | 'latPulldown' | 'neutralPulldown' | 'assisted';

export function verticalPull(id: string, kind: PullKind, fault?: string): Clip {
  if (kind === 'latPulldown' || kind === 'neutralPulldown') return pulldown(id, kind === 'neutralPulldown', fault);
  const barY = 2.28;
  const chin = kind === 'chinUp';
  const assisted = kind === 'assisted';
  const grip = chin ? 0.17 : 0.37;
  const hand = (side: 1 | -1): ArmSpec => ({ ik: [side * grip, barY, 0], pole: chin ? [side * 0.35, -0.8, 0.55] : [side, -0.8, 0.25], hand: [1, 0, 0] });
  const legs = assisted
    ? { legL: { fk: [12, 4, 0, 96, -12] }, legR: { fk: [12, 4, 0, 96, -12] } }
    : { legL: { fk: [14, 4, 0, 42, -18] }, legR: { fk: [14, 4, 0, 42, -18] } };
  const reach = Math.sqrt((ARM_REACH * 0.995) ** 2 - (grip - 0.18) ** 2);
  const hang = placeShoulders({ pelvis: [0, 1.2, -0.04], pitch: -4, neck: 0, scap: [0.35, 0], ...legs, armL: hand(1), armR: hand(-1) }, [0, barY - reach, -0.035]);
  const top = placeShoulders({ pelvis: [0, 1.62, -0.12], pitch: chin ? -6 : -12, spine: -4, neck: -6, scap: [0, -0.5], ...legs, armL: hand(1), armR: hand(-1) }, [0, barY - (chin ? 0.16 : 0.13), chin ? -0.1 : -0.11]);
  const list = liftKeys(hang, top, ['당기기', '턱이 바 위로', '천천히 내려오기']);
  if (fault === 'kip') {
    const kick = { legL: { fk: [70, 4, 0, 80, -10] }, legR: { fk: [70, 4, 0, 80, -10] } };
    list.splice(1, 0, [0.16, '반동', { ...hang, ...kick, pitch: 12, pelvis: [hang.pelvis[0], hang.pelvis[1] + 0.12, hang.pelvis[2] + 0.06] }]);
  } else if (fault === 'half-rep') {
    swap(list, [0, 3], '끝까지 안 내려옴', placeShoulders({ ...hang, scap: [0, 0] }, [0, barY - reach * 0.62, -0.06]));
  } else if (fault === 'shoulders-up') {
    swap(list, [1, 2], '어깨가 귀 쪽으로', placeShoulders({ ...top, scap: [1, 0.3] }, [0, barY - 0.22, -0.08]));
  }
  const scene = pullupBar(barY, 0);
  if (assisted) scene.push(...machineFrame(0.25, barY + 0.05, 1.0), { kind: 'frame', p: [0, 0.04, 0], size: [1.0, 0.08, 0.8] });
  return {
    id, cycle: 3.2, view: [34, 6], keys: keys(...list), scene,
    links: assisted ? [{ kind: 'pad', bone: ['shinL', 'shinR'], u: 0.3, off: [0, 0, 0.07], size: [0.42, 0.06, 0.24], pivot: [0.45, 0.55, 0.35], leverAt: 0.22 }] : undefined,
    work: [0, 0.42], fault,
  };
}

function pulldown(id: string, neutral: boolean, fault?: string): Clip {
  const pulley: Vec3 = [0, 2.35, 0.08];
  const body = seated(0.48, 0, 0, {}, 0.42, 0.17);
  const grip = neutral ? 0.09 : 0.4;
  const s0 = shoulderMid(body);
  const hold = (side: 1 | -1, pole?: Vec3): ArmSpec => neutral
    ? { ik: [0, 0, 0], pole: pole ?? [side * 0.35, -1, 0.15], hand: [0, 0, 1] }
    : { bar: side * grip, pole: pole ?? [side, -0.9, -0.1] };
  const at = (bar: Vec3, pitch: number, extra: Partial<Pose3> = {}, pole?: (side: 1 | -1) => Vec3): Pose3 => {
    const pose: Pose3 = { ...body, pitch, neck: -pitch * 0.4, ...extra };
    if (neutral) {
      return {
        ...pose,
        armL: { ...hold(1, pole?.(1)), ik: [grip, bar[1], bar[2]] },
        armR: { ...hold(-1, pole?.(-1)), ik: [-grip, bar[1], bar[2]] },
      };
    }
    return { ...pose, armL: hold(1, pole?.(1)), armR: hold(-1, pole?.(-1)), bar: { at: bar } };
  };
  const upBar: Vec3 = [0, s0[1] + Math.sqrt((ARM_REACH * 0.98) ** 2 - (grip - 0.18) ** 2), s0[2] + 0.06];
  const lowBody = { ...body, pitch: -14 };
  const chestBar = chestPoint(lowBody, [0, 0.29, 0.19]);
  const list = liftKeys(at(upBar, -4), at(chestBar, -14), ['쇄골 쪽으로 당기기', '날개뼈 내리기', '천천히 올리기']);
  if (fault === 'lean-back') {
    const leanBody = { ...body, pitch: -38 };
    swap(list, [1, 2], '몸을 뒤로 젖힘', at(chestPoint(leanBody, [0, 0.26, 0.19]), -38));
  } else if (fault === 'arms') {
    swap(list, [1, 2], '팔로만 당김', at([0, chestBar[1] + 0.16, chestBar[2] + 0.12], -6, {}, (side) => [side * 0.3, -0.6, 0.8]));
  } else if (fault === 'shoulders-up') {
    swap(list, [1, 2], '어깨가 귀 쪽으로', at([0, chestBar[1] + 0.06, chestBar[2]], -14, { scap: [1, 0] }));
  }
  const knee = solvePose(body).bones.thighL.b;
  return {
    id, cycle: 3, view: [40, 10], keys: keys(...list),
    scene: [
      ...stool(0, 0.48),
      { kind: 'roller', p: [0, knee[1] + 0.09, knee[2] - 0.08], size: [0.05, 0.5] },
      { kind: 'post', p: [0, 1.2, -0.35], size: [0.1, 2.4, 0.1] },
      { kind: 'frame', p: [0, 2.4, -0.13], size: [0.1, 0.08, 0.5] },
      { kind: 'pulley', p: pulley, size: [0.045, 0.03], x: [1, 0, 0] },
    ],
    bar: { kind: neutral ? 'vbar' : 'lat' }, cables: [{ from: pulley, to: neutral ? 'mid' : 'bar' }], work: [0, 0.42], fault,
  };
}

/* ── 플라이 ─────────────────────────────────────── */

export function fly(id: string, kind: 'cable' | 'lowToHigh' | 'pecDeck', fault?: string): Clip {
  if (kind === 'pecDeck') {
    const body = seated(0.46, 0, 6, {}, 0.46);
    const arm = (plane: number, elbow = 24, elev = 84): ArmSpec => ({ fk: [plane, elev, 0, elbow], turn: 90 });
    const open = { ...body, armL: arm(104), armR: arm(104) };
    const shut = { ...body, armL: arm(14), armR: arm(14) };
    const list = liftKeys(open, shut, ['안으려는 듯 모으기', '가슴 모으기', '천천히 벌리기']);
    if (fault === 'shoulders-up') swap(list, [1, 2], '어깨로 모음', { ...shut, scap: [0.9, 0.8] });
    else if (fault === 'arm-angle') swap(list, [1, 2], '팔꿈치를 폈다 굽혔다', { ...body, armL: arm(18, 80, 80), armR: arm(18, 80, 80) });
    const s = shoulderMid(body);
    return {
      id, cycle: 2.8, view: [20, 16], keys: keys(...list),
      scene: [...seatBench(0, 84, { seat: 0.46, backLen: 0.9 }), ...machineFrame(-0.4, 1.9, 1.2)],
      hold: { L: 'dHandle', R: 'dHandle' }, links: levers([0.2, s[1] + 0.4, s[2] - 0.1], [-0.2, s[1] + 0.4, s[2] - 0.1]),
      work: [0, 0.42], fault,
    };
  }
  const uni = kind === 'lowToHigh';
  const legs = { legL: plant(0.13, 0.18, 10), legR: plant(-0.14, -0.2, 10, { heel: 10 }) };
  const body: Pose3 = { pelvis: [0, 0.89, -0.03], pitch: uni ? 4 : 12, spine: 0, ...legs };
  const arm = (plane: number, elev: number, elbow = 22): ArmSpec => ({ fk: [plane, elev, 0, elbow], turn: 90 });
  let open: Pose3;
  let shut: Pose3;
  let cables: Clip['cables'];
  let scene: Prim[];
  if (uni) {
    open = { ...body, armL: handsOnHips().armL, armR: arm(100, 26) };
    shut = { ...body, armL: handsOnHips().armL, armR: arm(4, 112, 18) };
    const pulley: Vec3 = [-0.95, 0.2, -0.12];
    cables = [{ from: pulley, to: 'R' }];
    scene = cableTower(pulley, [-1, 0, 0]);
  } else {
    open = { ...body, armL: arm(102, 74), armR: arm(102, 74) };
    shut = { ...body, armL: arm(10, 70), armR: arm(10, 70) };
    const left: Vec3 = [0.98, 1.95, -0.25];
    const right: Vec3 = [-0.98, 1.95, -0.25];
    cables = [{ from: left, to: 'L' }, { from: right, to: 'R' }];
    scene = [...cableTower(left, [1, 0, 0]), ...cableTower(right, [-1, 0, 0])];
  }
  const list = liftKeys(open, shut, [uni ? '아래에서 위로 쓸어 올리기' : '안으려는 듯 모으기', '가슴 모으기', '천천히 벌리기']);
  if (fault === 'arm-angle') {
    swap(list, [1, 2], '팔꿈치를 폈다 굽혔다', uni ? { ...shut, armR: arm(10, 100, 90) } : { ...shut, armL: arm(14, 66, 95), armR: arm(14, 66, 95) });
  } else if (fault === 'shoulders-up') swap(list, [1, 2], '어깨로 모음', { ...shut, scap: [0.9, 0.8] });
  return {
    id, cycle: 2.8, view: uni ? [-20, 10] : [20, 12], keys: keys(...list), scene,
    hold: uni ? { R: 'dHandle' } : { L: 'dHandle', R: 'dHandle' }, cables, side: uni ? 'R' : undefined,
    work: [0, 0.42], fault,
  };
}

/* ── 후면 어깨 · 페이스 풀 ───────────────────────── */

export function rearDelt(id: string, kind: 'machine' | 'cable' | 'dumbbell', fault?: string): Clip {
  const arm = (plane: number, elev = 86, elbow = 10, turn = 90): ArmSpec => ({ fk: [plane, elev, 0, elbow], turn });
  if (kind === 'machine') {
    const body = seated(0.5, 0, -8, { neck: -4 }, 0.4);
    const front = { ...body, armL: arm(2), armR: arm(2) };
    const side = { ...body, armL: arm(96), armR: arm(96) };
    const list = liftKeys(front, side, ['옆으로 벌리기', '끝에서 멈춤', '천천히 모으기']);
    if (fault === 'traps') swap(list, [1, 2], '날개뼈를 모으며 등으로', { ...side, scap: [0.3, -1], armL: arm(112, 80, 40), armR: arm(112, 80, 40) });
    else if (fault === 'shrug') swap(list, [1, 2], '어깨가 으쓱', { ...side, scap: [1, 0] });
    const chest = solvePose(body).bones.chest;
    const pad = madd(scale(add(chest.a, chest.b), 0.55), chest.f, 0.19);
    const s = shoulderMid(body);
    return {
      id, cycle: 2.8, view: [150, 18], keys: keys(...list),
      scene: [
        ...stool(0, 0.5),
        { kind: 'pad', p: pad, size: [0.34, 0.5, 0.08], x: [1, 0, 0], y: normalize(sub(chest.b, chest.a)) },
        ...machineFrame(0.6, 1.9, 1.2),
      ],
      hold: { L: 'dHandle', R: 'dHandle' }, links: levers([0.12, s[1] + 0.35, s[2] + 0.2], [-0.12, s[1] + 0.35, s[2] + 0.2]),
      work: [0, 0.42], fault,
    };
  }
  if (kind === 'cable') {
    const body = standing({}, 0.15, 10);
    const pulley: Vec3 = [0.8, 1.45, 0.25];
    const start = { ...body, armL: handsOnHips().armL, armR: arm(-38, 82) };
    const end = { ...body, armL: handsOnHips().armL, armR: arm(96, 84) };
    const list = liftKeys(start, end, ['반대쪽에서 옆으로 당기기', '끝에서 멈춤', '천천히 돌아오기']);
    if (fault === 'traps') swap(list, [1, 2], '날개뼈를 모으며 등으로', { ...end, scapR: [0.3, -1], twist: -16 });
    else if (fault === 'swing') swap(list, [1, 2], '몸을 흔들어 당김', { ...end, twist: -30, pitch: -6 });
    return {
      id, cycle: 2.8, view: [20, 10], keys: keys(...list), scene: cableTower(pulley, [1, 0, 0]),
      hold: { R: 'dHandle' }, cables: [{ from: pulley, to: 'R' }], side: 'R', work: [0, 0.42], fault,
    };
  }
  // 덤벨 — 엉덩이를 접어 숙인 채 옆으로
  const legs = { legL: plant(0.15, 0, 10), legR: plant(-0.15, 0, 10) };
  const body: Pose3 = { pelvis: pelvisFromLegs(legs.legL, 22, -0.25), pitch: 68, spine: 2, neck: -30, ...legs };
  const down = { ...body, armL: arm(84, 10, 16, 90), armR: arm(84, 10, 16, 90) };
  const up = { ...body, armL: arm(84, 82, 20, 90), armR: arm(84, 82, 20, 90) };
  const list = liftKeys(down, up, ['옆으로 벌리기', '어깨 높이', '천천히 내리기']);
  if (fault === 'traps') swap(list, [1, 2], '날개뼈를 모으며 등으로', { ...up, scap: [0.2, -1], armL: arm(100, 70, 60), armR: arm(100, 70, 60) });
  else if (fault === 'swing') {
    list.splice(1, 0, [0.14, '몸을 흔들어 올림', { ...down, pitch: 40, armL: arm(84, 40), armR: arm(84, 40) }]);
  }
  return {
    id, cycle: 2.8, view: [20, 20], keys: keys(...list), scene: [mat([0, 0, 0.05], 1.2, 1.0)],
    hold: { L: 'dumbbell', R: 'dumbbell' }, work: [0, 0.42], fault,
  };
}

export function facePull(id: string, fault?: string): Clip {
  const pulley: Vec3 = [0, 1.78, 1.1];
  const body = standing({ legL: plant(0.13, 0.12, 10), legR: plant(-0.14, -0.18, 10, { heel: 8 }) }, 0.15, 10);
  const hands = (y: number, z: number, side: number, pole: Vec3 = [1, 0.7, -0.3]): Pose3 => ({
    ...body,
    armL: { ik: [side, y, z], pole, hand: [0, 1, 0] },
    armR: { ik: [-side, y, z], pole: [-pole[0], pole[1], pole[2]], hand: [0, 1, 0] },
  });
  const out = hands(1.64, 0.52, 0.08);
  const pulled = hands(1.62, 0.08, 0.2);
  const list = liftKeys(out, pulled, ['얼굴 쪽으로 당기기', '손이 귀 옆에', '천천히 펴기']);
  if (fault === 'too-low') swap(list, [1, 2], '줄을 가슴 쪽으로', hands(1.25, 0.14, 0.16, [0.6, -0.6, -0.6]));
  else if (fault === 'traps') swap(list, [1, 2], '날개뼈를 모으며 등으로', { ...hands(1.6, 0.18, 0.14, [0.5, 0.1, -1]), scap: [0.2, -1] });
  return {
    id, cycle: 2.6, view: [-40, 8], keys: keys(...list), scene: cableTower(pulley, [0, 0, 1]),
    bar: { kind: 'rope' }, cables: [{ from: pulley, to: 'mid' }], work: [0, 0.42], fault,
  };
}

/* ── 레이즈 · 슈러그 ─────────────────────────────── */

export type RaiseKind = 'lateral' | 'cableLateral' | 'machineLateral' | 'front';

export function raise(id: string, kind: RaiseKind, fault?: string): Clip {
  const front = kind === 'front';
  const uni = kind === 'cableLateral';
  const machine = kind === 'machineLateral';
  const plane = front ? 0 : 78;
  const turn = front ? 180 : 90;
  const arm = (elev: number, p = plane, elbow = machine ? 78 : front ? 10 : 16): ArmSpec => ({ fk: [p, elev, 0, elbow], turn });
  const body = machine ? seated(0.48, 0, 4, {}, 0.46) : standing({}, 0.14, 8);
  const pose = (elev: number, extra: Partial<Pose3> = {}, p = plane): Pose3 => uni
    ? { ...body, armL: { ik: [0.47, 1.1, 0.12], pole: [1, -0.4, -0.6], hand: [0, 1, 0] }, armR: arm(elev, p), ...extra }
    : { ...body, armL: arm(elev, p), armR: arm(elev, p), ...extra };
  const low = uni ? pose(18, {}, -26) : pose(12);
  const high = pose(front ? 90 : 86);
  const list = liftKeys(low, high, [front ? '앞으로 올리기' : '옆으로 올리기', '어깨 높이', '천천히 내리기']);
  if (fault === 'shrug') swap(list, [1, 2], '어깨가 으쓱', pose(86, { scap: [1, 0], neck: 4 }));
  else if (fault === 'swing') {
    list.splice(1, 0, [0.12, '몸을 흔들어 올림', pose(32, { pitch: 16, pelvis: [0, STAND_HEIGHT - 0.04, -0.06] })]);
    setKey(list, 2, '몸을 흔들어 올림', pose(front ? 90 : 86, { pitch: -10, spine: -6 }));
  } else if (fault === 'too-high') swap(list, [1, 2], '너무 높이', pose(122, { scap: [0.7, 0] }));
  const scene: Prim[] = [];
  let cables: Clip['cables'];
  if (uni) {
    const pulley: Vec3 = [0.36, 0.16, 0.12];
    scene.push(...cableTower(pulley, [1, 0, 0]));
    cables = [{ from: pulley, to: 'R' }];
  }
  if (machine) scene.push(...seatBench(0, 86, { seat: 0.48 }), ...machineFrame(-0.42, 1.6, 1.1));
  return {
    id, cycle: 2.8, view: front ? [60, 8] : uni ? [-10, 8] : [12, 8], keys: keys(...list), scene,
    hold: machine ? undefined : uni ? { R: 'dHandle' } : { L: 'dumbbell', R: 'dumbbell' },
    links: machine ? [
      { kind: 'pad', bone: 'upperArmL', u: 0.85, off: [-0.05, 0, 0], size: [0.04, 0.16, 0.12] },
      { kind: 'pad', bone: 'upperArmR', u: 0.85, off: [0.05, 0, 0], size: [0.04, 0.16, 0.12] },
    ] : undefined,
    cables, side: uni ? 'R' : undefined, work: [0, 0.42], fault,
  };
}

export function shrug(id: string, barbell: boolean, fault?: string): Clip {
  const arm: ArmSpec = barbell ? { fk: [0, 14, 0, 4], turn: 180 } : { fk: [84, 6, 0, 6], turn: 90 };
  const pose = (shrugUp: number, extra: Partial<Pose3> = {}): Pose3 => standing({ armL: arm, armR: arm, scap: [shrugUp, 0], ...extra });
  const list = liftKeys(pose(0), pose(1), ['어깨를 귀 쪽으로', '꼭대기에서 멈춤', '천천히 내리기']);
  if (fault === 'roll') {
    list.splice(1, 0, [0.14, '어깨를 돌림', pose(0.5, { scap: [0.5, 0.9] })]);
    list.splice(3, 0, [0.48, '어깨를 돌림', pose(0.8, { scap: [0.8, -1] })]);
  }
  return {
    id, cycle: 2.4, view: [40, 6], keys: keys(...list), scene: [],
    bar: barbell ? { kind: 'barbell', plates: 0.225 } : undefined,
    hold: barbell ? undefined : { L: 'dumbbell', R: 'dumbbell' }, work: [0, 0.42], fault,
  };
}

/* ── 컬 ─────────────────────────────────────────── */

export type CurlKind = 'barbell' | 'incline' | 'hammer' | 'preacher' | 'machinePreacher' | 'cable' | 'concentration';

export function curl(id: string, kind: CurlKind, fault?: string): Clip {
  const turn = kind === 'hammer' ? 90 : 0;
  let body: Pose3;
  let arm = (elbow: number, elev = 6): ArmSpec => ({ fk: [4, elev, 0, elbow], turn });
  let scene: Prim[] = [];
  let bar: Clip['bar'];
  let hold: Clip['hold'] = { L: 'dumbbell', R: 'dumbbell' };
  let cables: Clip['cables'];
  let side: Clip['side'];
  let links: Link[] | undefined;
  let lowElbow = 10;
  let highElbow = 140;
  let lowElev = 6;
  let highElev = 14;
  switch (kind) {
    case 'barbell':
      body = standing();
      bar = { kind: 'barbell', plates: 0.16 };
      hold = undefined;
      break;
    case 'cable': {
      body = standing({ pitch: 4 });
      bar = { kind: 'cable' };
      hold = undefined;
      const pulley: Vec3 = [0, 0.12, 0.72];
      cables = [{ from: pulley, to: 'mid' }];
      scene = cableTower(pulley, [0, 0, 1]);
      break;
    }
    case 'incline':
      body = seated(0.45, 0.18, 36, { neck: 10 }, 0.5);
      arm = (elbow: number, elev = -36): ArmSpec => ({ fk: [6, elev, 0, elbow], turn });
      lowElev = -36;
      highElev = -28;
      scene = seatBench(0.18, 54, { seat: 0.45, backLen: 0.95 });
      break;
    case 'preacher':
    case 'machinePreacher': {
      body = seated(0.55, -0.05, -10, { neck: -10 }, 0.4);
      arm = (elbow: number, elev = 48): ArmSpec => ({ fk: [2, elev, 0, elbow], turn: 0 });
      lowElev = 48;
      highElev = 48;
      lowElbow = 24;
      highElbow = 128;
      if (kind === 'preacher') {
        bar = { kind: 'ez' };
        hold = undefined;
      } else {
        hold = { L: 'dHandle', R: 'dHandle' };
      }
      const solved = solvePose({ ...body, armL: arm(24), armR: arm(24) });
      const a = solved.bones.upperArmL;
      const b = solved.bones.upperArmR;
      const along = normalize(sub(a.b, a.a));
      const mid = scale(add(add(a.a, a.b), add(b.a, b.b)), 0.25);
      const padAt = madd(mid, a.f, -0.065);
      scene = [
        { kind: 'pad', p: padAt, size: [0.5, 0.36, 0.07], x: [1, 0, 0], y: along },
        { kind: 'frame', p: [0, padAt[1] / 2, padAt[2] + 0.1], size: [0.07, padAt[1], 0.07] },
        { kind: 'pad', p: [0, 0.515, -0.05], size: [0.3, 0.07, 0.32] },
        { kind: 'frame', p: [0, 0.25, -0.05], size: [0.06, 0.48, 0.06] },
        { kind: 'frame', p: [0, 0.03, 0.05], size: [0.5, 0.06, 0.8] },
      ];
      if (kind === 'machinePreacher') {
        const elbowL = solved.bones.forearmL.a;
        const elbowR = solved.bones.forearmR.a;
        links = levers([elbowL[0] + 0.06, elbowL[1], elbowL[2]], [elbowR[0] - 0.06, elbowR[1], elbowR[2]]);
      }
      break;
    }
    case 'concentration': {
      // 벤치 끝에 앉아 숙이고, 오른 팔꿈치를 오른 넓적다리 안쪽에
      body = seated(0.45, 0, -34, { spine: 10, neck: -20 }, 0.5, 0.3);
      arm = (elbow: number, elev = 38): ArmSpec => ({ fk: [-14, elev, 0, elbow], turn: 0 });
      lowElev = 38;
      highElev = 40;
      lowElbow = 14;
      highElbow = 132;
      hold = { R: 'dumbbell' };
      side = 'R';
      scene = flatBench(-0.4, 0.3, 0.45);
      break;
    }
    default:
      body = standing();
  }
  const pose = (elbow: number, elev: number, extra: Partial<Pose3> = {}): Pose3 => kind === 'concentration'
    ? { ...body, armL: { ik: [0.2, -0.02, 0.28], in: 'pelvis', pole: [1, 0.3, -0.5], point: [0, 0, 1] }, armR: arm(elbow, elev), ...extra }
    : { ...body, armL: arm(elbow, elev), armR: arm(elbow, elev), ...extra };
  const low = pose(lowElbow, lowElev);
  const high = pose(highElbow, highElev);
  const list = liftKeys(low, high, ['올리기', '꽉 쥐기', '천천히 내리기']);
  if (fault === 'swing') {
    list.splice(1, 0, [0.15, '몸을 흔들어 올림', pose(40, lowElev, { pitch: 14, pelvis: [0, STAND_HEIGHT - 0.03, -0.06] })]);
    setKey(list, 2, '몸을 흔들어 올림', pose(highElbow, highElev, { pitch: -14, spine: -8 }));
  } else if (fault === 'elbow-forward') {
    swap(list, [1, 2], '팔꿈치가 앞으로', pose(highElbow - 8, highElev + 36));
  } else if (fault === 'drop' || fault === 'bottom-bounce') {
    list.splice(2, 2, [0.5, fault === 'drop' ? '툭 떨어뜨림' : '아래에서 튕김', high], [0.6, undefined, low], ...(fault === 'bottom-bounce' ? [[0.66, undefined, pose(lowElbow + 30, lowElev)] as [number, string | undefined, Pose3]] : []), [1, undefined, low]);
  }
  return { id, cycle: 2.8, view: kind === 'concentration' ? [-30, 14] : kind === 'incline' ? [70, 10] : [62, 8], keys: keys(...list), scene, bar, hold, cables, links, side, work: [0, 0.42], fault };
}

/* ── 삼두 ───────────────────────────────────────── */

export type TricepsKind = 'pushdown' | 'overheadCable' | 'skull' | 'kickback' | 'dbOverhead' | 'machine';

export function triceps(id: string, kind: TricepsKind, fault?: string): Clip {
  switch (kind) {
    case 'pushdown': {
      const pulley: Vec3 = [0, 2.0, 0.42];
      const body = standing({ pitch: 8 }, 0.15, 10);
      const arm = (elbow: number, elev = 8): ArmSpec => ({ fk: [0, elev, 0, elbow], turn: 180 });
      const pose = (elbow: number, extra: Partial<Pose3> = {}, elev = 8): Pose3 => ({ ...body, armL: arm(elbow, elev), armR: arm(elbow, elev), ...extra });
      const list = liftKeys(pose(96), pose(8), ['아래로 펴기', '끝까지 펴기', '천천히 올리기']);
      if (fault === 'elbow-move') {
        swap(list, [0, 3], '팔꿈치가 앞뒤로', pose(100, {}, 40));
        swap(list, [1, 2], '팔꿈치가 앞뒤로', pose(10, {}, -16));
      } else if (fault === 'lean') swap(list, [1, 2], '상체로 누름', pose(20, { pitch: 38, neck: -14 }, 30));
      return {
        id, cycle: 2.6, view: [62, 8], keys: keys(...list), scene: cableTower(pulley, [0, 0, 1]),
        bar: { kind: 'cable' }, cables: [{ from: pulley, to: 'mid' }], work: [0, 0.42], fault,
      };
    }
    case 'overheadCable': {
      const pulley: Vec3 = [0, 1.55, -0.8];
      const body: Pose3 = { pelvis: [0, 0.88, 0.0], pitch: 24, spine: 0, neck: -10, legL: plant(0.13, 0.3, 10), legR: plant(-0.14, -0.12, 10, { heel: 14 }) };
      const arm = (elbow: number, elev = 152, plane = 12): ArmSpec => ({ fk: [plane, elev, 0, elbow], turn: 90 });
      const pose = (elbow: number, extra: Partial<Pose3> = {}, plane = 12): Pose3 => ({ ...body, armL: arm(elbow, 152, plane), armR: arm(elbow, 152, plane), ...extra });
      const list = liftKeys(pose(128), pose(12), ['머리 위로 펴기', '끝까지 펴기', '천천히 굽히기']);
      if (fault === 'elbow-flare') swap(list, [0, 3], '팔꿈치가 옆으로', pose(124, {}, 64));
      else if (fault === 'arch') swap(list, [1, 2], '허리를 젖혀서 밂', pose(12, { spine: -22, pitch: 6 }));
      return {
        id, cycle: 2.8, view: [68, 8], keys: keys(...list), scene: cableTower(pulley, [0, 0, -1]),
        bar: { kind: 'rope' }, cables: [{ from: pulley, to: 'mid' }], work: [0, 0.42], fault,
      };
    }
    case 'skull': {
      const body = lying();
      const arm = (elbow: number, elev = 104, plane = 4): ArmSpec => ({ fk: [plane, elev, 0, elbow], turn: 180 });
      const pose = (elbow: number, extra: Partial<Pose3> = {}, plane = 4): Pose3 => ({ ...body, armL: arm(elbow, 104, plane), armR: arm(elbow, 104, plane), ...extra });
      const list = pressKeys(pose(14), pose(122), ['이마 쪽으로 굽히기', '이마 위', '펴기']);
      if (fault === 'elbow-flare') swap(list, [1, 2], '팔꿈치가 옆으로', pose(118, {}, 58));
      else if (fault === 'drop') list.splice(0, 4, [0, '툭 떨어뜨림', pose(14)], [0.18, undefined, pose(122)], [0.3, undefined, pose(122)], [1, undefined, pose(14)]);
      return { id, cycle: 2.8, view: [36, 24], keys: keys(...list), scene: flatBench(-0.72, 0.5), bar: { kind: 'ez' }, work: [0.53, 1], fault };
    }
    case 'kickback': {
      const legs = { legL: plant(0.15, 0.12, 10), legR: plant(-0.15, -0.1, 10) };
      const body: Pose3 = { pelvis: pelvisFromLegs(legs.legL, 26, -0.18), pitch: 66, spine: 2, neck: -28, ...legs };
      // 왼손은 왼 무릎 위에
      const knee = solvePose(body).bones.thighL.b;
      const left: ArmSpec = { ik: [knee[0], knee[1] + 0.07, knee[2] - 0.02], pole: [1, 0.3, -0.4], point: [0, -0.2, 1] };
      const arm = (elbow: number, elev = -10): ArmSpec => ({ fk: [0, elev, 0, elbow], turn: 90 });
      const pose = (elbow: number, elev = -10): Pose3 => ({ ...body, armL: left, armR: arm(elbow, elev) });
      const list = liftKeys(pose(96), pose(6), ['뒤로 펴기', '끝까지 펴기', '천천히 굽히기']);
      if (fault === 'elbow-move') swap(list, [0, 3], '팔꿈치가 앞뒤로', pose(100, 30));
      else if (fault === 'drop') list.splice(2, 2, [0.5, '툭 떨어뜨림', pose(6)], [0.6, undefined, pose(96)], [1, undefined, pose(96)]);
      return { id, cycle: 2.6, view: [-70, 10], keys: keys(...list), scene: [], hold: { R: 'dumbbell' }, side: 'R', work: [0, 0.42], fault };
    }
    case 'dbOverhead': {
      const body = seated(0.45, 0, 2, {}, 0.48);
      const hands = (at: Vec3, pole: Vec3 = [0.2, 0.5, 1]): Pose3 => ({
        ...body,
        armL: { ik: [0.035, at[1] + 0.07, at[2]], in: 'chest', pole, hand: [1, 0, 0] },
        armR: { ik: [-0.035, at[1] + 0.07, at[2]], in: 'chest', pole: [-pole[0], pole[1], pole[2]], hand: [1, 0, 0] },
        bar: { at, dir: [0, 1, 0], in: 'chest' },
      });
      const low = hands([0, 0.42, -0.14]);
      const high = hands([0, 0.74, 0.02]);
      const list = liftKeys(low, high, ['머리 위로 펴기', '끝까지 펴기', '천천히 내리기']);
      if (fault === 'elbow-flare') swap(list, [0, 3], '팔꿈치가 옆으로', hands([0, 0.46, -0.1], [1, 0.4, 0.3]));
      else if (fault === 'arch') swap(list, [1, 2], '허리를 젖혀서 밂', { ...hands([0, 0.72, 0.1]), spine: -20, pitch: -10 });
      return { id, cycle: 2.8, view: [70, 8], keys: keys(...list), scene: flatBench(-0.4, 0.3, 0.45), bar: { kind: 'dumbbell' }, work: [0, 0.42], fault };
    }
    default: {
      // 기계 — 위팔을 앞 패드에 얹고 아래팔만 편다
      const body = seated(0.48, 0, 4, {}, 0.46);
      const arm = (elbow: number): ArmSpec => ({ fk: [0, 58, 0, elbow], turn: 90 });
      const pose = (elbow: number, extra: Partial<Pose3> = {}): Pose3 => ({ ...body, armL: arm(elbow), armR: arm(elbow), ...extra });
      const list = liftKeys(pose(118), pose(14), ['펴기', '끝까지 펴기', '천천히 굽히기']);
      if (fault === 'elbow-move') swap(list, [1, 2], '팔꿈치가 들림', { ...body, armL: { fk: [0, 82, 0, 14], turn: 90 }, armR: { fk: [0, 82, 0, 14], turn: 90 } });
      else if (fault === 'elbow-flare') swap(list, [0, 3], '팔꿈치가 옆으로', { ...body, armL: { fk: [40, 58, 0, 118], turn: 90 }, armR: { fk: [40, 58, 0, 118], turn: 90 } });
      const solved = solvePose(pose(118));
      const a = solved.bones.upperArmL;
      const b = solved.bones.upperArmR;
      const padAt = madd(scale(add(add(a.a, a.b), add(b.a, b.b)), 0.25), a.f, -0.065);
      return {
        id, cycle: 2.6, view: [64, 12], keys: keys(...list),
        scene: [
          ...seatBench(0, 86, { seat: 0.48 }),
          { kind: 'pad', p: padAt, size: [0.52, 0.3, 0.07], x: [1, 0, 0], y: normalize(sub(a.b, a.a)) },
          { kind: 'frame', p: [0, padAt[1] / 2, padAt[2] + 0.12], size: [0.07, padAt[1], 0.07] },
          ...machineFrame(-0.42, 1.5, 1.0),
        ],
        hold: { L: 'dHandle', R: 'dHandle' },
        links: levers([a.b[0] + 0.05, a.b[1], a.b[2]], [b.b[0] - 0.05, b.b[1], b.b[2]]),
        work: [0, 0.42], fault,
      };
    }
  }
}

export function straightArmPulldown(id: string, fault?: string): Clip {
  const pulley: Vec3 = [0, 2.05, 0.6];
  const legs = { legL: plant(0.15, 0, 10), legR: plant(-0.15, 0, 10) };
  const body: Pose3 = { pelvis: pelvisFromLegs(legs.legL, 14, -0.1), pitch: 24, spine: 0, neck: -8, ...legs };
  const arm = (elev: number, elbow = 12): ArmSpec => ({ fk: [0, elev, 0, elbow], turn: 180 });
  const pose = (elev: number, extra: Partial<Pose3> = {}, elbow = 12): Pose3 => ({ ...body, armL: arm(elev, elbow), armR: arm(elev, elbow), ...extra });
  const list = liftKeys(pose(122), pose(16), ['팔을 편 채 허벅지까지', '등 조이기', '천천히 올리기']);
  if (fault === 'bend') swap(list, [1, 2], '팔꿈치를 굽혀 당김', pose(28, {}, 80));
  else if (fault === 'shoulders-up') swap(list, [0, 3], '어깨가 귀 쪽으로', pose(126, { scap: [1, 0.3] }));
  return {
    id, cycle: 2.8, view: [70, 8], keys: keys(...list), scene: cableTower(pulley, [0, 0, 1]),
    bar: { kind: 'cable' }, cables: [{ from: pulley, to: 'mid' }], work: [0, 0.42], fault,
  };
}

export function wristCurl(id: string, fault?: string): Clip {
  // 벤치에 앉아 아래팔을 넓적다리에 얹고, 손목만 굽혔다 편다
  const body = seated(0.45, 0, -38, { spine: 10, neck: -16 }, 0.46, 0.17);
  const arm = (wrist: number): ArmSpec => ({ fk: [-6, 52, 0, 64, wrist], turn: 0 });
  const pose = (wrist: number): Pose3 => ({ ...body, armL: arm(wrist), armR: arm(wrist) });
  const list = liftKeys(pose(-40), pose(48), ['손목 말아 올리기', '꽉 쥐기', '천천히 펴기']);
  if (fault === 'drop') list.splice(2, 2, [0.5, '툭 떨어뜨림', pose(48)], [0.6, undefined, pose(-40)], [1, undefined, pose(-40)]);
  return { id, cycle: 2.2, view: [70, 18], keys: keys(...list), scene: flatBench(-0.4, 0.3, 0.45), hold: { L: 'dumbbell', R: 'dumbbell' }, work: [0, 0.42], fault };
}

export { block, solvePose, type Prim };
