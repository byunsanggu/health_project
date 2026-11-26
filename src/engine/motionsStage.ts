/**
 * 대회 무대 동작 — 시즌(season.ts)의 "내 선수"가 하는 포즈.
 *
 * 종목 시연과 같은 마네킹 · 같은 뼈대(rig.ts) · 같은 도구(motionKit.ts)로 짓는다. 외부 3D 모델이나
 * 남의 그림 · 실제 대회의 정해진 포즈 규정은 쓰지 않는다 — 누구나 하는 일반적인 힘주기 동작이다.
 *
 *   stage-idle      — 홈 카드에서 숨 쉬며 서 있기
 *   stage-walk      — 무대로 걸어 나오기 (바닥이 뒤로 흐르는 제자리 걷기)
 *   stage-front     — 앞에서 두 팔 들어 힘주기
 *   stage-side      — 옆으로 서서 팔을 모아 힘주기
 *   stage-lockout   — 플랫폼: 바닥에서 들어 잠그고 버티기
 *
 * posture(0..1)는 자란 자세 — 가슴을 조금 더 펴고 날개뼈를 모은다. 0이면 기본 자세.
 */
import { BODY, rotateAbout, type ArmSpec, type LegSpec, type Pose3, type Vec3 } from './rig.ts';
import { ballAt, hangingArms, hipHinge, keys, mat, plant, standing, type Clip } from './motionKit.ts';

type KeyList = [number, string | undefined, Pose3][];

export const STAGE_MOTION_IDS = ['stage-idle', 'stage-walk', 'stage-front', 'stage-side', 'stage-lockout'] as const;
export type StageMotionId = typeof STAGE_MOTION_IDS[number];

/** 무대별 대회 당일 순서 — 걸어 나와서 포즈 둘 */
export const STAGE_ROUTINES: Record<'physique' | 'platform' | 'open', StageMotionId[]> = {
  physique: ['stage-walk', 'stage-front', 'stage-side'],
  platform: ['stage-walk', 'stage-lockout', 'stage-front'],
  open: ['stage-walk', 'stage-front', 'stage-side'],
};

/** 자란 자세 — 가슴을 펴고(척추를 살짝 젖힘) 날개뼈를 모은다 */
function upright(pose: Pose3, posture: number): Pose3 {
  if (!posture) return pose;
  const scap = pose.scap ?? [0, 0];
  return {
    ...pose,
    spine: (pose.spine ?? 0) - 4 * posture,
    neck: (pose.neck ?? 0) + 2 * posture,
    scap: [scap[0] ?? 0, (scap[1] ?? 0) - 0.35 * posture],
  };
}

function relaxed(posture: number, breath = 0): Pose3 {
  return upright(standing({ ...hangingArms(90, 7, 8, 10), scap: [0.04 * breath, -0.1 * breath], spine: -1.5 * breath }, 0.15, 10), posture);
}

function idle(posture: number): Clip {
  const list: KeyList = [
    [0, undefined, relaxed(posture)],
    [0.5, undefined, relaxed(posture, 1)],
    [1, undefined, relaxed(posture)],
  ];
  return { id: 'stage-idle', cycle: 4.2, view: [18, 6], keys: keys(...list), scene: [], work: [0, 0] };
}

function walk(posture: number): Clip {
  const step = 0.3;
  const stance = (x: number, z: number, heel = 0): LegSpec => ballAt(x, z + 0.135, 8, heel);
  const swing = (x: number, z: number, lift: number): LegSpec => ({ ankle: [x, BODY.ankle + lift, z], fwd: [0, -0.15, 0.99], up: [0, 0.99, 0.15], pole: [0, 0.2, 1] });
  // 팔은 다리와 엇갈려 앞뒤로 — 면 0(앞) 기준, 음수 각은 뒤로
  const arms = (left: number): { armL: ArmSpec; armR: ArmSpec } => ({
    armL: { fk: [0, left, 0, 14], turn: 90 },
    armR: { fk: [0, -left, 0, 14], turn: 90 },
  });
  const pose = (legL: LegSpec, legR: LegSpec, y: number, left: number): Pose3 => upright({
    pelvis: [0, y, -0.03], pitch: 3, spine: 0, neck: 0, legL, legR, ...arms(left),
  }, posture);
  const contact = BODY.thigh + BODY.shin + BODY.ankle - 0.03;
  const mid = contact + 0.025;
  const list: KeyList = [
    [0, undefined, pose(stance(0.1, step), stance(-0.1, -step, 30), contact, -16)],
    [0.25, undefined, pose(stance(0.1, 0), swing(-0.1, 0, 0.1), mid, 0)],
    [0.5, undefined, pose(stance(0.1, -step, 30), stance(-0.1, step), contact, 16)],
    [0.75, undefined, pose(swing(0.1, 0, 0.1), stance(-0.1, 0), mid, 0)],
    [1, undefined, pose(stance(0.1, step), stance(-0.1, -step, 30), contact, -16)],
  ];
  return { id: 'stage-walk', cycle: 1.15, view: [40, 6], keys: keys(...list), scene: [], walk: step * 4, linear: true, work: [0, 0] };
}

/**
 * 앞에서 두 팔 들어 힘주기 — 위팔을 옆으로 어깨 높이까지, 아래팔은 위로 세운다.
 * 팔을 들 때 숨을 들이쉬듯 가슴을 펴고, 버티는 동안 조금 더 조인다.
 */
function front(posture: number): Clip {
  const legs = { legL: plant(0.2, 0.02, 16), legR: plant(-0.2, 0.02, 16) };
  const base = (extra: Partial<Pose3>): Pose3 => upright({ pelvis: [0, 0.905, -0.02], pitch: 1, spine: 0, neck: 0, ...legs, ...extra }, posture);
  const rest = base({ ...hangingArms(90, 8, 10, 12) });
  const flex = (squeeze: number): Pose3 => base({
    spine: -3 - 2 * squeeze,
    neck: 2,
    scap: [0.12 + 0.05 * squeeze, -0.25],
    armL: { fk: [92, 96 + 4 * squeeze, 88, 108 + 8 * squeeze, 10], turn: 20 },
    armR: { fk: [92, 96 + 4 * squeeze, 88, 108 + 8 * squeeze, 10], turn: 20 },
  });
  const list: KeyList = [
    [0, undefined, rest],
    [0.24, undefined, flex(0)],
    [0.5, undefined, flex(1)],
    [0.76, undefined, flex(0.6)],
    [1, undefined, rest],
  ];
  return { id: 'stage-front', cycle: 4.4, view: [14, 6], keys: keys(...list), scene: [], work: [0.24, 0.76] };
}

/** 다리 하나를 몸과 같이 돌린다 (y축 둘레 yaw도) */
function turnLeg(leg: LegSpec, yaw: number): LegSpec {
  const axis: Vec3 = [0, 1, 0];
  const r = (v?: Vec3): Vec3 | undefined => (v ? rotateAbout(v, axis, yaw) : undefined);
  return { ...leg, ankle: r(leg.ankle), fwd: r(leg.fwd), up: r(leg.up), pole: r(leg.pole) };
}

/**
 * 옆으로 서서 힘주기 — 몸을 왼쪽으로 돌려 오른쪽 옆구리를 앞(보는 쪽)에 둔다. 앞쪽 다리는 무릎을 살짝
 * 굽혀 발끝으로, 두 팔은 배 앞에서 모아 가슴 · 팔을 조인다.
 */
function side(posture: number): Clip {
  const yaw = 62;
  const legL = turnLeg(plant(0.13, -0.04, 12), yaw);
  const legR = turnLeg(plant(-0.11, 0.1, 18, { heel: 22 }), yaw);
  const base = (extra: Partial<Pose3>): Pose3 => upright({ pelvis: rotateAbout([0, 0.9, -0.02], [0, 1, 0], yaw), yaw, pitch: 1, spine: 0, neck: 0, legL, legR, ...extra }, posture);
  const rest = base({ ...hangingArms(90, 8, 10, 12) });
  const flex = (squeeze: number): Pose3 => base({
    spine: -3 - 2 * squeeze,
    twist: -10 - 6 * squeeze,
    neck: 4,
    scap: [0.06, 0.15],
    // 앞쪽(오른)팔은 굽혀 배 앞으로, 뒤쪽(왼)팔은 그 손목 쪽으로
    armR: { fk: [8, 34 + 6 * squeeze, 30, 96 + 6 * squeeze, 8], turn: 40 },
    armL: { fk: [28, 40 + 4 * squeeze, 60, 104, 0], turn: 80 },
  });
  const list: KeyList = [
    [0, undefined, rest],
    [0.24, undefined, flex(0)],
    [0.5, undefined, flex(1)],
    [0.76, undefined, flex(0.6)],
    [1, undefined, rest],
  ];
  return { id: 'stage-side', cycle: 4.4, view: [14, 6], keys: keys(...list), scene: [], work: [0.24, 0.76] };
}

/** 플랫폼 — 바닥에서 들어 잠그고 버틴 뒤 내려놓는다 (데드리프트 시연과 같은 힌지 도구로) */
function lockout(posture: number): Clip {
  const legs = { legL: plant(0.13, 0, 8), legR: plant(-0.13, 0, 8) };
  const hold = (s: 1 | -1): ArmSpec => ({ bar: s * 0.25, pole: [s * 0.25, 0.1, -1] });
  const base: Pose3 = { pelvis: [0, 0.6, -0.3], pitch: 40, spine: 2, neck: -20, ...legs, armL: hold(1), armR: hold(-1) };
  const floor = hipHinge({ ...base, neck: -24 }, { knee: 80, back: -0.26, barY: 0.225, ahead: 0.05 });
  const knee = hipHinge({ ...base, neck: -16 }, { knee: 30, back: -0.3, barY: 0.5, ahead: 0.04 });
  const lock = hipHinge({ ...base, neck: 0, scap: [0.08, -0.3 - 0.3 * posture] }, { knee: 4, back: -0.03, barY: 0.79, ahead: -0.1 });
  const list: KeyList = [
    [0, undefined, floor],
    [0.18, undefined, knee],
    [0.34, undefined, lock],
    [0.78, undefined, lock],
    [0.9, undefined, knee],
    [1, undefined, floor],
  ];
  return {
    id: 'stage-lockout', cycle: 4.6, view: [24, 8], keys: keys(...list), scene: [mat([0, 0, 0.05], 2.1, 1.4)],
    bar: { kind: 'barbell', plates: 0.225 }, work: [0, 0.34],
  };
}

const MAKERS: Record<StageMotionId, (posture: number) => Clip> = {
  'stage-idle': idle,
  'stage-walk': walk,
  'stage-front': front,
  'stage-side': side,
  'stage-lockout': lockout,
};

const cache = new Map<string, Clip>();

/** 무대 동작. posture는 0..1 (0.1 단위로 맞춰 같은 그림을 다시 쓴다). 모르는 id면 null. */
export function stageMotionFor(id: string, posture = 0): Clip | null {
  const make = MAKERS[id as StageMotionId];
  if (!make) return null;
  const p = Math.round(Math.max(0, Math.min(1, posture || 0)) * 10) / 10;
  const key = id + ':' + p;
  let clip = cache.get(key);
  if (!clip) {
    clip = make(p);
    cache.set(key, clip);
  }
  return clip;
}
