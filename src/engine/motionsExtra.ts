/**
 * 5차에 더한 종목의 시연 — 집 · 아파트 헬스장에서 빠지던 것들.
 *
 * 있는 동작을 고쳐 쓰는 것이 먼저다. 같은 몸놀림이면 그 동작의 키 자세를 받아 손에 든 것 · 기구 ·
 * 줄만 바꾼다(덤벨 컬 = 해머 컬의 손 방향만, 덤벨 리버스 런지 = 맨몸 리버스 런지에 덤벨). 몸놀림이
 * 다른 것(밴드 로우 · 스모 스쿼트 · 덤벨 플라이 · 크런치 · 인클라인 푸시업 · 스미스 숄더프레스)만 새로 짓는다.
 *
 * motionKit · motionsUpper · motionsLower · motionsCore · motionsStretch에서 가져오기만 하고 고치지 않는다.
 * motions.ts가 EXTRA_MOTIONS를 표에 더한다.
 */
import {
  ARM_REACH, block, cableTower, flatBench, hangingArms, keys, lying, mat, plank, plant, seatBench, seated, shoulderMid,
  solveFor, solvePose, standing,
  type Clip, type Key, type Prim,
} from './motionKit.ts';
import * as L from './motionsLower.ts';
import * as U from './motionsUpper.ts';
import { stretchMotionFor } from './motionsStretch.ts';
import { BODY, normalize, type ArmSpec, type LegSpec, type Pose3, type Vec3 } from './rig.ts';

type KeyList = [number, string | undefined, Pose3][];

interface Entry {
  make: (fault?: string) => Clip;
  /** 동작으로 보여 줄 수 있는 흔한 실수 (mistakes.ts의 id) */
  faults: readonly string[];
}

const entry = (make: (fault?: string) => Clip, faults: readonly string[] = []): Entry => ({ make, faults });

/** 모든 키 자세를 바꾼 clip */
function mapPoses(clip: Clip, change: (pose: Pose3) => Pose3): Clip {
  return { ...clip, keys: clip.keys.map((key: Key) => ({ ...key, pose: change(key.pose) })) };
}

/** 스미스 머신 레일 — 몸 위로 곧게 (motionsUpper의 것과 같다) */
function smithRails(z: number): Prim[] {
  return [
    { kind: 'post', p: [0.78, 1.1, z], size: [0.06, 2.2, 0.06] },
    { kind: 'post', p: [-0.78, 1.1, z], size: [0.06, 2.2, 0.06] },
    { kind: 'frame', p: [0, 2.2, z], size: [1.62, 0.07, 0.07] },
  ];
}

/* ── 덤벨 컬 ─────────────────────────────────────── */

/** 해머 컬과 같은 몸놀림 — 손바닥이 앞을 본다 */
function dumbbellCurl(id: string, fault?: string): Clip {
  // 손바닥이 앞을 보면 덤벨이 몸통 옆으로 가로놓인다 — 늘어뜨린 팔은 조금 바깥으로 벌려 덤벨이 넓적다리에 닿지 않게
  const supinate = (arm?: ArmSpec): ArmSpec | undefined => {
    if (!arm || !arm.fk) return arm;
    const fk = [...arm.fk];
    if ((fk[3] ?? 0) < 60) { fk[0] = 70; fk[1] = Math.max(fk[1] ?? 0, 18); }
    return { ...arm, fk, turn: 0 };
  };
  return mapPoses(U.curl(id, 'hammer', fault), (pose) => ({ ...pose, armL: supinate(pose.armL), armR: supinate(pose.armR) }));
}

/* ── 인클라인 푸시업 ─────────────────────────────── */

const PRESS_REACH = BODY.upperArm + BODY.forearm;

function inclinePushUp(id: string, fault?: string): Clip {
  const top = 0.45;
  const toeZ = -1.05;
  const shoulderHeight = (angle: number) => shoulderMid(plank(angle, toeZ))[1];
  const highAngle = solveFor(shoulderHeight, 10, 70, top + 0.035 + PRESS_REACH * 0.975);
  const lowAngle = solveFor(shoulderHeight, 5, 60, top + 0.185);
  const handZ = shoulderMid(plank(highAngle, toeZ))[2] + 0.07;
  // 손 자리는 위에서 정하고 내려갈 때 그대로 둔다 — 벤치 끝을 짚은 손
  const hands = (flare = false): { armL: ArmSpec; armR: ArmSpec } => {
    const arm = (side: 1 | -1): ArmSpec => ({
      ik: [side * 0.25, top + 0.022, handZ],
      pole: flare ? [side, 0.25, 0] : [side * 0.45, 0.2, -1],
      point: [side * 0.12, 0, 1],
    });
    return { armL: arm(1), armR: arm(-1) };
  };
  const high = plank(highAngle, toeZ, hands());
  const low = plank(lowAngle, toeZ, hands());
  const list: KeyList = [[0, '내려가기', high], [0.45, '가슴이 벤치 끝 가까이', low], [0.53, '밀기', low], [1, undefined, high]];
  if (fault === 'hips-sag') {
    const sag = (p: Pose3): Pose3 => ({ ...p, pelvis: [p.pelvis[0], p.pelvis[1] - 0.075, p.pelvis[2] + 0.01], spine: -22, pitch: (p.pitch ?? 90) + 8 });
    list[0] = [0, '허리가 처짐', sag(high)];
    list[1] = [0.45, undefined, sag(low)];
    list[2] = [0.53, undefined, sag(low)];
    list[3] = [1, undefined, sag(high)];
  } else if (fault === 'elbow-flare') {
    list[1] = [0.45, '팔꿈치가 벌어짐', { ...low, ...hands(true) }];
    list[2] = [0.53, undefined, { ...low, ...hands(true) }];
  }
  return {
    id, cycle: 2.8, view: [70, 12], keys: keys(...list),
    // 벤치 끝 — 손이 모서리 가까이, 몸 쪽 끝은 손바로 앞에서 끝난다
    scene: [block([0, top / 2, handZ + 0.1], [0.9, top, 0.32]), mat([0, 0, toeZ + 0.35], 0.7, 0.9)],
    work: [0.53, 1], fault,
  };
}

/* ── 한발 카프레이즈 ─────────────────────────────── */

function singleLegCalfRaise(id: string, fault?: string): Clip {
  const clip = L.calfRaise(id, 'dumbbell', fault);
  // 짚은 기둥(왼쪽)이 가리지 않게 일하는 오른 종아리 쪽에서 본다
  return { ...clip, hold: undefined, view: [-70, 8] };
}

/* ── 밴드 로우 ───────────────────────────────────── */

function bandRow(id: string, fault?: string): Clip {
  // 바닥에 앉아 다리를 앞으로 거의 펴고, 발바닥에 밴드를 건다
  const foot = (x: number): LegSpec => ({
    ankle: [x, 0.105, 0.83], fwd: [0, 0.97, 0.24], up: [0, 0.24, -0.97], pole: [x * 1.5, 1, 0.1], ground: [0, 1, 0],
  });
  const body = (pitch: number, extra: Partial<Pose3> = {}): Pose3 => ({
    pelvis: [0, 0.115, 0], pitch, spine: 4, neck: -pitch * 0.4, legL: foot(0.13), legR: foot(-0.13), ...extra,
  });
  const hands = (pose: Pose3, reach: number, up: number, pole: Vec3 = [0.25, 0.2, -1]): Pose3 => ({
    ...pose,
    armL: { ik: [0.09, up, reach], in: 'chest', pole, hand: [0, 1, 0] },
    armR: { ik: [-0.09, up, reach], in: 'chest', pole: [-pole[0], pole[1], pole[2]], hand: [0, 1, 0] },
  });
  const out = hands(body(10), 0.56, 0.12);
  // 끝 자세 — 손은 배꼽 앞, 팔꿈치는 옆구리 뒤로 (시티드 케이블 로우와 같은 손 자리)
  const back = hands(body(-4), 0.24, 0.04, [0.6, 0, -1]);
  const list: KeyList = [[0, '팔꿈치를 뒤로 당기기', out], [0.42, '날개뼈 모으기', back], [0.54, '천천히 펴기', back], [1, undefined, out]];
  if (fault === 'rocking') {
    list[0] = [0, '몸을 앞뒤로 흔듦', hands(body(26, { spine: 12 }), 0.5, 0.3)];
    list[1] = [0.42, undefined, hands(body(-24, { spine: -6 }), 0.24, 0.04, [0.6, 0, -1])];
    list[2] = [0.54, undefined, hands(body(-24, { spine: -6 }), 0.24, 0.04, [0.6, 0, -1])];
    list[3] = [1, undefined, list[0][2]];
  } else if (fault === 'shoulders-up') {
    list[1] = [0.42, '어깨가 귀 쪽으로', { ...back, scap: [1, 0] }];
    list[2] = [0.54, undefined, { ...back, scap: [1, 0] }];
  }
  // 밴드가 걸린 곳 — 두 발바닥 앞꿈치
  const soles = solvePose(out).bones;
  const sole = (b: { a: Vec3; b: Vec3 }): Vec3 => [b.b[0], b.b[1] - 0.01, b.b[2] + 0.02];
  return {
    id, cycle: 2.8, view: [105, 14], keys: keys(...list),
    scene: [mat([0, 0, 0.35], 0.75, 1.5)],
    cables: [{ from: sole(soles.footL), to: 'L' }, { from: sole(soles.footR), to: 'R' }],
    work: [0, 0.42], fault,
  };
}

/* ── 밴드 풀 어파트 ──────────────────────────────── */

function bandPullApart(id: string): Clip {
  const clip = stretchMotionFor('band-pull-apart')!;
  // 뒤쪽 어깨와 앞의 밴드가 같이 보이게 비스듬히 뒤에서
  return { ...clip, id, view: [118, 16], work: [0, 0.42] };
}

/* ── 밴드 레터럴 레이즈 ──────────────────────────── */

function bandLateralRaise(id: string, fault?: string): Clip {
  const clip = U.raise(id, 'lateral', fault);
  // 밴드는 발 바깥쪽 앞에서 — 발 안쪽(0.1)에 걸면 늘어뜨린 손까지 가는 줄이 정강이를 지난다
  return { ...clip, hold: undefined, cables: [{ from: [-0.13, 0.02, 0.08], to: 'R' }, { from: [0.13, 0.02, 0.08], to: 'L' }] };
}

/* ── 덤벨 힙 쓰러스트 ────────────────────────────── */

function dumbbellHipThrust(id: string, fault?: string): Clip {
  const clip = L.hipThrust(id, 'barbell', fault);
  const narrow = (arm: ArmSpec | undefined, side: 1 | -1): ArmSpec | undefined =>
    arm && arm.bar !== undefined ? { ...arm, bar: side * 0.12, pole: [side * 0.8, 1, -0.3] } : arm;
  return {
    // 덤벨 원판이 넓적다리 위에 얹히게 — 바벨보다 원판이 몸 가까이(손 바로 바깥) 있어 조금 더 위로 띄운다
    ...mapPoses(clip, (pose) => ({ ...pose, armL: narrow(pose.armL, 1), armR: narrow(pose.armR, -1), bar: { at: [0, 0.07, 0.195], in: 'pelvis' } })),
    bar: { kind: 'dumbbell' },
  };
}

/* ── 덤벨 리버스 런지 ────────────────────────────── */

function dumbbellReverseLunge(id: string, fault?: string): Clip {
  const clip = L.lunge(id, 'reverse', fault);
  // 팔을 살짝 벌려 덤벨이 넓적다리 옆을 지나게 (그대로 늘어뜨리면 원판이 다리에 묻힌다)
  const arms = hangingArms(90, 8, 6, 75);
  return { ...mapPoses(clip, (pose) => ({ ...pose, ...arms })), hold: { L: 'dumbbell', R: 'dumbbell' } };
}

/* ── 덤벨 스모 스쿼트 ────────────────────────────── */

function dumbbellSumoSquat(id: string, fault?: string): Clip {
  const stance = 0.3;
  const toe = 30;
  const caved = fault === 'knee-cave';
  // 무릎이 안으로 — 발 안쪽으로 13cm쯤 들어온다. 더 모으면 무릎이 다리 사이 덤벨에 부딪힌다
  const legs = (cave = false): { legL: LegSpec; legR: LegSpec } => ({
    legL: plant(stance, 0, toe, cave ? { pole: [-0.05, 0.1, 0.8] } : {}),
    legR: plant(-stance, 0, toe, cave ? { pole: [0.05, 0.1, 0.8] } : {}),
  });
  // 덤벨 하나를 세로로, 두 손으로 위 원판 밑을 쥐고 다리 사이로 늘어뜨린다
  const hang = (pose: Pose3, extra: Partial<Pose3> = {}): Pose3 => {
    const base = { ...pose, ...extra };
    const s = shoulderMid(base);
    // 팔은 살짝 앞으로 — 그대로 내리면 덤벨 위 원판이 골반에 묻힌다
    const ahead = 0.15;
    const handY = s[1] - Math.sqrt((ARM_REACH * 0.975) ** 2 - 0.135 ** 2 - ahead ** 2);
    const z = s[2] + ahead;
    const arm = (side: 1 | -1): ArmSpec => ({ ik: [side * 0.045, handY, z], in: 'world', pole: [side, 0, -0.4], hand: [0, 0, 1] });
    return { ...base, armL: arm(1), armR: arm(-1), bar: { at: [0, handY - 0.065, z], dir: [0, 1, 0] } };
  };
  const top = hang({ pelvis: [0, 0.87, -0.01], pitch: 4, spine: 0, neck: 0, ...legs() });
  const low = hang({ pelvis: [0, 0.5, -0.09], pitch: 16, spine: 2, neck: -8, ...legs() });
  const mid = hang({ pelvis: [0, 0.512, -0.09], pitch: 16, spine: 2, neck: -8, ...legs() });
  const list: KeyList = [[0, '곧게 앉기', top], [0.45, '최저점', low], [0.55, '무릎을 밀며 일어서기', mid], [1, undefined, top]];
  if (caved) {
    list[1] = [0.45, '무릎이 안으로', hang(low, legs(true))];
    list[2] = [0.55, undefined, hang(mid, legs(true))];
  } else if (fault === 'torso-lean') {
    const lean = { pitch: 42, neck: -20, pelvis: [0, 0.52, -0.16] as Vec3 };
    list[1] = [0.45, '상체가 숙여짐', hang(low, lean)];
    list[2] = [0.55, undefined, hang(mid, { ...lean, pelvis: [0, 0.532, -0.16] })];
  }
  return { id, cycle: 3.4, view: [30, 12], keys: keys(...list), scene: [], bar: { kind: 'dumbbell' }, work: [0.55, 1], fault };
}

/* ── 케이블 글루트 킥백 ──────────────────────────── */

function cableGluteKickback(id: string, fault?: string): Clip {
  const clip = L.gluteKickback(id, fault);
  // 낮은 도르래를 마주 보고 서서, 오른 발목 스트랩을 뒤로 민다. 손은 기둥의 손잡이에
  const pulley: Vec3 = [-0.11, 0.1, 0.72];
  return {
    ...clip,
    scene: [
      ...cableTower(pulley, [0, 0, 1]),
      { kind: 'bar', p: [0, 1.18, 0.64], size: [0.016, 0.6] },
      { kind: 'frame', p: [-0.11, 1.18, 0.73], size: [0.05, 0.05, 0.16] },
    ],
    links: undefined,
    cables: [{ from: pulley, to: 'footR' }],
  };
}

/* ── 덤벨 플라이 ─────────────────────────────────── */

function dumbbellFly(id: string, fault?: string): Clip {
  const body = lying();
  // 손잡이는 내내 머리-발 방향 — 위에서는 손바닥이 마주 보고(90), 벌리면 천장을 본다(0).
  // 벌린 곳에서 90 그대로 두면 팔이 돌아 덤벨이 세로로 서고 아래 원판이 벤치 밑으로 내려간다
  const arm = (plane: number, elev: number, elbow: number, turn: number): ArmSpec => ({ fk: [plane, elev, 0, elbow], turn });
  const pose = (plane: number, elev: number, elbow = 20, turn = 0): Pose3 => ({ ...body, armL: arm(plane, elev, elbow, turn), armR: arm(plane, elev, elbow, turn) });
  const top = pose(4, 76, 16, 90);
  // 면 90은 옆으로 수평 — 조금 너머(98)로 가야 덤벨이 어깨 높이, 팔꿈치는 어깨보다 조금 아래까지 내려간다
  const open = pose(98, 84, 24);
  const list: KeyList = [[0, '양옆으로 벌리기', top], [0.45, '가슴이 늘어나는 데까지', open], [0.53, '크게 안듯 모으기', open], [1, undefined, top]];
  if (fault === 'arm-angle') {
    list[1] = [0.45, '팔꿈치를 굽혔다 폄', pose(96, 80, 100, 90)];
    list[2] = [0.53, undefined, pose(96, 80, 100, 90)];
  } else if (fault === 'too-deep') {
    list[1] = [0.45, '너무 깊이 내림', pose(122, 86, 24)];
    list[2] = [0.53, undefined, pose(122, 86, 24)];
  }
  return {
    id, cycle: 3, view: [36, 46], keys: keys(...list), scene: flatBench(-0.72, 0.5),
    hold: { L: 'dumbbell', R: 'dumbbell' }, work: [0.53, 1], fault,
  };
}

/* ── 스미스 인클라인 프레스 ──────────────────────── */

function smithInclinePress(id: string, fault?: string): Clip {
  // 옆에서 보면 원판이 머리와 가슴을 가린다 — 비스듬히 앞에서
  return { ...U.press(id, { implement: 'smith', incline: 30 }, fault), view: [30, 20] };
}

/* ── 스미스 숄더프레스 ───────────────────────────── */

function smithShoulderPress(id: string, fault?: string): Clip {
  const body = seated(0.46, 0, 6, {}, 0.48);
  const s = shoulderMid(body);
  const grip = 0.27;
  // 바는 레일을 따라 곧게 — 얼굴 바로 앞으로 지나 턱 높이까지
  const z = s[2] + 0.15;
  const lockY = s[1] + Math.sqrt((ARM_REACH * 0.975) ** 2 - (grip - 0.18) ** 2 - 0.15 ** 2);
  const at = (y: number, extra: Partial<Pose3> = {}, high = false): Pose3 => ({
    ...body,
    armL: { bar: grip, pole: high ? [1, -0.3, 0] : [0.5, -1, 0.3] },
    armR: { bar: -grip, pole: high ? [-1, -0.3, 0] : [-0.5, -1, 0.3] },
    bar: { at: [0, y, z] }, ...extra,
  });
  const chin = s[1] + 0.06;
  const list: KeyList = [[0, '머리 위로 밀기', at(chin)], [0.42, '팔을 곧게', at(lockY, {}, true)], [0.54, '턱 높이까지 내리기', at(lockY, {}, true)], [1, undefined, at(chin)]];
  if (fault === 'arch') {
    const arched = { pitch: -14, spine: -18 };
    list[1] = [0.42, '등받이에서 허리가 뜸', at(lockY - 0.02, arched, true)];
    list[2] = [0.54, undefined, at(lockY - 0.02, arched, true)];
  } else if (fault === 'half-rep') {
    list[0] = [0, '조금만 내림', at(s[1] + 0.3)];
    list[3] = [1, undefined, at(s[1] + 0.3)];
  }
  return {
    id, cycle: 3, view: [40, 8], keys: keys(...list),
    scene: [...seatBench(0, 84, { seat: 0.46, backLen: 0.9 }), ...smithRails(z + 0.06)],
    bar: { kind: 'smith', plates: 0.225 }, work: [0, 0.42], fault,
  };
}

/* ── 크런치 ──────────────────────────────────────── */

function crunch(id: string, fault?: string): Clip {
  const base = lying({}, 0.15, 0);
  const hands = (pull = false): { armL: ArmSpec; armR: ArmSpec } => {
    // 손끝을 귀 옆에 — 목을 당기는 실수는 손이 뒤통수 뒤로 간다
    const arm = (side: 1 | -1): ArmSpec => ({ ik: [side * 0.12, pull ? 0.46 : 0.43, pull ? -0.07 : 0.0], in: 'chest', pole: [side, 0, 0.2], hand: [0, 0, 1] });
    return { armL: arm(1), armR: arm(-1) };
  };
  const pose = (spine: number, neck: number, extra: Partial<Pose3> = {}, pull = false): Pose3 => ({ ...base, spine, neck, ...hands(pull), ...extra });
  const rest = pose(-5, 0);
  const curled = pose(30, 12);
  const list: KeyList = [[0, '갈비뼈를 말아 올리기', rest], [0.42, '어깨를 띄우기', curled], [0.55, '천천히 내려오기', curled], [1, undefined, rest]];
  if (fault === 'neck') {
    list[1] = [0.42, '목을 당김', pose(16, 40, {}, true)];
    list[2] = [0.55, undefined, pose(16, 40, {}, true)];
  } else if (fault === 'sit-up') {
    const up = { pitch: -40, pelvis: [0, 0.118, 0.2] as Vec3 };
    list[1] = [0.42, '허리까지 들어 올림', pose(20, 10, up)];
    list[2] = [0.55, undefined, pose(20, 10, up)];
  }
  return { id, cycle: 2.6, view: [70, 18], keys: keys(...list), scene: [mat([0, 0, -0.15], 0.75, 1.8)], work: [0, 0.42], fault };
}

/* ── 매트 초보 종목 — 무릎 푸시업 · 버드독 · 슈퍼맨 ─────────── */

/** 바닥을 짚은 손바닥 가운데 높이 · 거의 편 팔로 바닥을 짚었을 때 어깨 높이 (motionsStretch와 같은 값) */
const PALM_Y = 0.022;
const SHOULDER_ON_HANDS = PALM_Y + (BODY.upperArm + BODY.forearm) * 0.975;

/** 바닥을 짚은 손 — 손가락은 머리 쪽 */
const floorHand = (at: Vec3, side: 1 | -1, pole: Vec3 = [side * 0.45, 0.2, -1]): ArmSpec => ({
  ik: [at[0], PALM_Y, at[2]], pole, point: [side * 0.12, 0, 1],
});

/** 무릎 꿇은 다리 — 무릎은 kneeZ에서 바닥, 정강이 · 발등도 바닥(발끝이 뒤) */
function kneelLegs(kneeZ: number, width = 0.11): { legL: LegSpec; legR: LegSpec } {
  const foot = (x: number): LegSpec => ({
    ankle: [x, 0.07, kneeZ - BODY.shin + 0.01], fwd: normalize([0, -0.12, -1]), up: normalize([0, -1, 0.12]), pole: [0, -0.6, 1],
  });
  return { legL: foot(width), legR: foot(-width) };
}

/**
 * 무릎 푸시업 — 푸시업과 같은 몸놀림인데 받침점이 발끝이 아니라 무릎이다. 무릎에서 어깨까지 한 줄로 기울기만
 * 바꾼다(angle = 바닥과 이룬 각). 손 자리는 위에서 정하고 내려갈 때 그대로 둔다.
 */
function kneePushUp(id: string, fault?: string): Clip {
  const kneeZ = -0.55;
  const KNEE_Y = 0.055;
  const body = (angle: number, extra: Partial<Pose3> = {}): Pose3 => {
    const a = (angle * Math.PI) / 180;
    return {
      pelvis: [0, KNEE_Y + Math.sin(a) * (BODY.thigh + 0.02), kneeZ + Math.cos(a) * (BODY.thigh + 0.02)],
      pitch: 90 - angle, spine: 0, neck: -16, ...kneelLegs(kneeZ), ...extra,
    };
  };
  const shoulderHeight = (angle: number) => shoulderMid(body(angle))[1];
  const topAngle = solveFor(shoulderHeight, 10, 70, 0.035 + PRESS_REACH * 0.975);
  const lowAngle = solveFor(shoulderHeight, 2, 50, 0.19);
  const s = shoulderMid(body(topAngle));
  const hands = (flare = false): { armL: ArmSpec; armR: ArmSpec } => ({
    armL: floorHand([0.25, 0, s[2] + 0.06], 1, flare ? [1, 0.25, 0] : undefined),
    armR: floorHand([-0.25, 0, s[2] + 0.06], -1, flare ? [-1, 0.25, 0] : undefined),
  });
  const top = body(topAngle, hands());
  const low = body(lowAngle, hands());
  const list: KeyList = [[0, '내려가기', top], [0.45, '가슴이 바닥 가까이', low], [0.53, '밀기', low], [1, undefined, top]];
  if (fault === 'hips-back') {
    // 엉덩이가 뒤로 빠진 ㅅ자 — 골반이 무릎 위로 물러나고 몸통만 숙인다
    const piked = (p: Pose3): Pose3 => ({ ...p, pelvis: [0, p.pelvis[1] + 0.09, p.pelvis[2] - 0.04], spine: 24 });
    const half = body((topAngle + lowAngle) / 2, hands());
    list[0] = [0, '엉덩이가 뒤로 빠짐', piked(top)];
    list[1] = [0.45, undefined, piked(half)];
    list[2] = [0.53, undefined, piked(half)];
    list[3] = [1, undefined, piked(top)];
  } else if (fault === 'elbow-flare') {
    list[1] = [0.45, '팔꿈치가 벌어짐', { ...low, ...hands(true) }];
    list[2] = [0.53, undefined, { ...low, ...hands(true) }];
  }
  return { id, cycle: 2.6, view: [70, 12], keys: keys(...list), scene: [mat([0, 0, -0.2], 0.8, 1.6)], work: [0.53, 1], fault };
}

/** 네발 자세 몸통 — 무릎은 골반 밑, 어깨가 거의 편 팔 높이에 오게 기울기를 맞춘다 */
function allFours(extra: Partial<Pose3> = {}): Pose3 {
  const base: Pose3 = { pelvis: [0, 0.5, 0], pitch: 88, spine: 0, neck: -6, ...kneelLegs(0), ...extra };
  const pitch = solveFor((p) => shoulderMid({ ...base, pitch: p })[1], 45, 135, SHOULDER_ON_HANDS);
  return { ...base, pitch };
}

/** 버드독 — 네발 자세에서 반대쪽 팔과 다리를 바닥과 나란히 뻗었다 돌아온다 */
function birdDog(id: string, fault?: string): Clip {
  const base = allFours();
  const s = shoulderMid(base);
  const handL = floorHand([0.2, 0, s[2] + 0.03], 1);
  const handR = floorHand([-0.2, 0, s[2] + 0.03], -1);
  const kneel = kneelLegs(0);
  /*
   * 뻗은 팔 · 다리도 닿을 곳(ik)으로 준다 — 한 동작 안에서 팔다리 푸는 방식을 바꾸면(짚은 손 ik → 뻗은 팔 fk)
   * 앞 키 자세가 덮여 쉬는 자세가 사라졌다. 팔은 어깨 높이에서 머리 앞으로, 다리는 엉덩이 높이에서 뒤로.
   */
  const solved = solvePose({ ...base, armL: handL, armR: handR, ...kneel });
  const shoulder = (side: 'L' | 'R') => solved.bones[`upperArm${side}`].a;
  const hip = (side: 'L' | 'R') => solved.bones[`thigh${side}`].a;
  const reach = (side: 'L' | 'R'): ArmSpec => {
    const a = shoulder(side);
    const sign = side === 'L' ? 1 : -1;
    return { ik: [a[0] * 0.8, a[1] + 0.02, a[2] + ARM_REACH * 0.96], pole: [sign * 0.3, -1, 0], point: [0, 0, 1] };
  };
  const leg = (side: 'L' | 'R', lift: number): LegSpec => {
    const h = hip(side);
    const len = (BODY.thigh + BODY.shin) * 0.97;
    const a = (lift * Math.PI) / 180;
    return { ankle: [h[0], h[1] + Math.sin(a) * len, h[2] - Math.cos(a) * len], fwd: [0, -1, 0], up: [0, 0, 1], pole: [0, -1, 0] };
  };
  const pose = (extra: Partial<Pose3>): Pose3 => ({ ...base, armL: handL, armR: handR, ...kneel, ...extra });
  const rest = pose({});
  // 오른팔 · 왼다리
  const rightArm = (lift = 0, extra: Partial<Pose3> = {}) => pose({ armR: reach('R'), legL: leg('L', lift), ...extra });
  const leftArm = (lift = 0, extra: Partial<Pose3> = {}) => pose({ armL: reach('L'), legR: leg('R', lift), ...extra });
  const list: KeyList = [
    [0, '오른팔 · 왼다리 뻗기', rest], [0.2, undefined, rightArm()], [0.32, '1초 멈추고 돌아오기', rightArm()],
    [0.5, '왼팔 · 오른다리 뻗기', rest], [0.7, undefined, leftArm()], [0.82, '1초 멈추고 돌아오기', leftArm()], [1, undefined, rest],
  ];
  if (fault === 'back-arch') {
    const arch = { spine: -20, neck: -22 };
    list[1] = [0.2, '허리가 꺾임', rightArm(24, arch)];
    list[2] = [0.32, undefined, rightArm(24, arch)];
    list[4] = [0.7, '허리가 꺾임', leftArm(24, arch)];
    list[5] = [0.82, undefined, leftArm(24, arch)];
  } else if (fault === 'hip-tilt') {
    list[1] = [0.2, '골반이 기울어짐', rightArm(6, { twist: -16, roll: 8 })];
    list[2] = [0.32, undefined, rightArm(6, { twist: -16, roll: 8 })];
    list[4] = [0.7, '골반이 기울어짐', leftArm(6, { twist: 16, roll: -8 })];
    list[5] = [0.82, undefined, leftArm(6, { twist: 16, roll: -8 })];
  }
  return { id, cycle: 5, view: [80, 16], keys: keys(...list), scene: [mat([0, 0, 0.15], 0.8, 1.4)], work: [0, 1], fault };
}

/** 슈퍼맨 — 엎드려 팔은 머리 위로 뻗고, 팔과 다리를 같이 바닥에서 살짝 들었다 내린다 */
function superman(id: string, fault?: string): Clip {
  const body = (spine: number, legLift: number, armLift: number, neck = 2): Pose3 => {
    const leg: LegSpec = { fk: [-legLift, 3, 0, 2, -72] };
    const arm: ArmSpec = { fk: [8, 168 + armLift, 0, 4], turn: 90 };
    return { pelvis: [0, 0.115, 0], pitch: 90, spine, neck, legL: leg, legR: { ...leg }, armL: arm, armR: { ...arm } };
  };
  const rest = body(0, 0, 0);
  const up = body(-12, 10, 6);
  const list: KeyList = [[0, '팔다리를 같이 들기', rest], [0.38, '1초 멈춤', up], [0.6, '천천히 내리기', up], [1, undefined, rest]];
  if (fault === 'neck') {
    list[1] = [0.38, '고개를 들어 앞을 봄', body(-12, 10, 6, -34)];
    list[2] = [0.6, undefined, body(-12, 10, 6, -34)];
  } else if (fault === 'too-high') {
    list[1] = [0.38, '너무 높이 차올림', body(-30, 26, 12, -10)];
    list[2] = [0.6, undefined, body(-30, 26, 12, -10)];
  }
  return { id, cycle: 3.2, view: [70, 14], keys: keys(...list), scene: [mat([0, 0, 0.1], 0.75, 2.0)], work: [0, 0.6], fault };
}

/* ── 표 ──────────────────────────────────────────── */

export const EXTRA_MOTIONS: Record<string, Entry> = {
  'dumbbell-curl': entry((f) => dumbbellCurl('dumbbell-curl', f), ['swing', 'drop']),
  'incline-push-up': entry((f) => inclinePushUp('incline-push-up', f), ['hips-sag', 'elbow-flare']),
  'bodyweight-squat': entry((f) => L.squat('bodyweight-squat', 'body', f), ['knee-cave', 'heels-up']),
  'single-leg-calf-raise': entry((f) => singleLegCalfRaise('single-leg-calf-raise', f), ['short-range', 'bounce']),
  'band-row': entry((f) => bandRow('band-row', f), ['rocking', 'shoulders-up']),
  'band-pull-apart': entry(() => bandPullApart('band-pull-apart')),
  'band-lateral-raise': entry((f) => bandLateralRaise('band-lateral-raise', f), ['shrug', 'too-high']),
  'dumbbell-hip-thrust': entry((f) => dumbbellHipThrust('dumbbell-hip-thrust', f), ['arch', 'chin-up']),
  'dumbbell-reverse-lunge': entry((f) => dumbbellReverseLunge('dumbbell-reverse-lunge', f), ['knee-cave', 'torso-lean']),
  'dumbbell-sumo-squat': entry((f) => dumbbellSumoSquat('dumbbell-sumo-squat', f), ['knee-cave', 'torso-lean']),
  'cable-glute-kickback': entry((f) => cableGluteKickback('cable-glute-kickback', f), ['arch']),
  'dumbbell-fly': entry((f) => dumbbellFly('dumbbell-fly', f), ['arm-angle', 'too-deep']),
  'smith-incline-press': entry((f) => smithInclinePress('smith-incline-press', f), ['shoulders-up', 'elbow-flare', 'butt-off']),
  'smith-shoulder-press': entry((f) => smithShoulderPress('smith-shoulder-press', f), ['arch', 'half-rep']),
  'crunch': entry((f) => crunch('crunch', f), ['neck', 'sit-up']),
  'knee-push-up': entry((f) => kneePushUp('knee-push-up', f), ['hips-back', 'elbow-flare']),
  'bird-dog': entry((f) => birdDog('bird-dog', f), ['back-arch', 'hip-tilt']),
  'superman': entry((f) => superman('superman', f), ['neck', 'too-high']),
};
