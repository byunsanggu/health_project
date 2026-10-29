/**
 * 하체 종목 시연 — 스쿼트 · 기계 스쿼트 · 레그 프레스 · 런지 · 힌지 · 힙 쓰러스트 · 하체 기계.
 *
 * 서 있는 동작은 발을 바닥에 박아 두고 골반만 움직인다. 무릎 각도는 계산이 정한다 — 그래서
 * 골반을 너무 낮게 잡으면 다리가 못 미치고, 테스트가 그걸 잡는다.
 */
import {
  STAND_HEIGHT, armsCrossed, ballAt, block, flatBench, footOn, handsOnHips, hangingArms, hipHinge, keys, machineFrame, mat,
  placeShoulders, plant, rack, seatBench, seated, setKey, shoulderMid, solvePose, standing,
  type Clip, type Link, type Prim,
} from './motionKit.ts';
import { BODY, add, cross, madd, normalize, scale, sub, type ArmSpec, type LegSpec, type Pose3, type Vec3 } from './rig.ts';

type KeyList = [number, string | undefined, Pose3][];

const DEG = Math.PI / 180;

/** 두 자세의 가운데 (숫자만 섞는다) */
function halfway(a: Pose3, b: Pose3): Pose3 {
  const mid = (x = 0, y = 0) => (x + y) / 2;
  return {
    ...a,
    pelvis: [mid(a.pelvis[0], b.pelvis[0]), mid(a.pelvis[1], b.pelvis[1]), mid(a.pelvis[2], b.pelvis[2])],
    pitch: mid(a.pitch, b.pitch),
    spine: mid(a.spine, b.spine),
  };
}

/** 골반만 옮긴 자세 */
const lift = (p: Pose3, dy: number, dz = 0): Pose3 => ({ ...p, pelvis: [p.pelvis[0], p.pelvis[1] + dy, p.pelvis[2] + dz] });

/* ── 스쿼트 ──────────────────────────────────────── */

export type SquatLoad = 'back' | 'front' | 'goblet' | 'smith' | 'body';

const SQUAT_BOTTOM: Record<SquatLoad, { pelvis: Vec3; pitch: number; neck: number }> = {
  back: { pelvis: [0, 0.45, -0.235], pitch: 40, neck: -20 },
  front: { pelvis: [0, 0.42, -0.15], pitch: 21, neck: -8 },
  goblet: { pelvis: [0, 0.42, -0.165], pitch: 24, neck: -10 },
  smith: { pelvis: [0, 0.45, -0.07], pitch: 24, neck: -10 },
  body: { pelvis: [0, 0.44, -0.2], pitch: 33, neck: -14 },
};

export function squat(id: string, load: SquatLoad, fault?: string): Clip {
  const stance = load === 'goblet' || load === 'body' ? 0.16 : 0.175;
  const footZ = load === 'smith' ? 0.12 : 0;
  const toe = 18;
  const legs = (heel = 0, cave = false): { legL: LegSpec; legR: LegSpec } => ({
    legL: plant(stance, footZ, toe, { heel, pole: cave ? [-0.75, 0.1, 0.65] : undefined }),
    legR: plant(-stance, footZ, toe, { heel, pole: cave ? [0.75, 0.1, 0.65] : undefined }),
  });

  const bottom = SQUAT_BOTTOM[load];
  const top: Pose3 = { pelvis: [0, STAND_HEIGHT, -0.02 + footZ], pitch: 3, spine: 0, neck: 0, ...legs() };
  let low: Pose3 = { pelvis: bottom.pelvis, pitch: bottom.pitch, spine: 2, neck: bottom.neck, ...legs() };

  let bar: Clip['bar'];
  let arms: Partial<Pose3>;
  let lowArms: Partial<Pose3> | undefined;
  if (load === 'back' || load === 'smith') {
    bar = { kind: load === 'smith' ? 'smith' : 'barbell', plates: 0.225 };
    const hold = (side: 1 | -1): ArmSpec => ({ bar: side * 0.43, pole: [side * 0.25, -1, -0.55], in: 'chest' });
    arms = { armL: hold(1), armR: hold(-1), bar: { at: [0, 0.27, -0.088], in: 'chest' } };
  } else if (load === 'front') {
    bar = { kind: 'barbell', plates: 0.225 };
    const hold = (side: 1 | -1): ArmSpec => ({ bar: side * 0.25, pole: [side * 0.2, 0.35, 1], in: 'chest' });
    arms = { armL: hold(1), armR: hold(-1), bar: { at: [0, 0.236, 0.15], in: 'chest' } };
  } else if (load === 'goblet') {
    bar = { kind: 'dumbbell' };
    const hold = (side: 1 | -1): ArmSpec => ({ ik: [side * 0.048, 0.215, 0.2], pole: [side * 0.25, -1, 0.1], in: 'chest', hand: [0, 0, 1] });
    arms = { armL: hold(1), armR: hold(-1), bar: { at: [0, 0.15, 0.205], dir: [0, 1, 0], in: 'chest' } };
  } else {
    arms = { armL: { fk: [0, 18, 0, 12], turn: 180 }, armR: { fk: [0, 18, 0, 12], turn: 180 } };
    lowArms = { armL: { fk: [0, 86, 0, 4], turn: 180 }, armR: { fk: [0, 86, 0, 4], turn: 180 } };
  }
  const upPose: Pose3 = { ...top, ...arms };
  low = { ...low, ...arms, ...lowArms };

  let scene: Prim[] = [];
  if (load === 'smith') {
    scene = [
      { kind: 'post', p: [0.78, 1.1, footZ - 0.1], size: [0.06, 2.2, 0.06] },
      { kind: 'post', p: [-0.78, 1.1, footZ - 0.1], size: [0.06, 2.2, 0.06] },
      { kind: 'frame', p: [0, 2.2, footZ - 0.1], size: [1.62, 0.07, 0.07] },
      { kind: 'frame', p: [0, 0.03, footZ - 0.1], size: [1.62, 0.06, 0.5] },
    ];
  } else if (load === 'back' || load === 'front') {
    scene = rack(-0.55, 1.32);
  }

  const mid = lift(low, 0.012);
  const list: KeyList = [
    [0, '내려가기', upPose],
    [0.45, '최저점', low],
    [0.55, '올라오기', mid],
    [1, undefined, upPose],
  ];

  if (fault === 'knee-cave') {
    setKey(list, 1, '무릎이 안으로', { ...low, ...legs(0, true) });
    setKey(list, 2, '무릎이 안으로', { ...mid, ...legs(0, true) });
    list.splice(3, 0, [0.78, undefined, { ...halfway(mid, upPose), ...legs(0, true) }]);
  } else if (fault === 'heels-up') {
    const heels = { ...legs(22), pelvis: [0, low.pelvis[1] + 0.03, low.pelvis[2] + 0.06] as Vec3 };
    setKey(list, 1, '뒤꿈치가 들림', { ...low, ...heels });
    setKey(list, 2, '뒤꿈치가 들림', { ...mid, ...heels });
  } else if (fault === 'butt-wink') {
    setKey(list, 1, '허리가 말림', { ...low, spine: 34, pitch: low.pitch! - 10 });
    setKey(list, 2, '허리가 말림', { ...mid, spine: 34, pitch: mid.pitch! - 10 });
  } else if (fault === 'hips-first') {
    list.splice(3, 0, [0.72, '엉덩이만 먼저', { ...mid, pelvis: [0, 0.66, -0.25], pitch: 66, spine: 8, neck: -26 }]);
  } else if (fault === 'torso-lean' || fault === 'goblet-lean' || fault === 'elbows-drop') {
    const lean: Partial<Pose3> = { pitch: low.pitch! + 24, neck: low.neck! - 14, pelvis: [0, low.pelvis[1] + 0.02, low.pelvis[2] - 0.05] };
    if (fault === 'goblet-lean' && load === 'goblet') {
      lean.bar = { at: [0, 0.14, 0.3], dir: [0, 1, 0], in: 'chest' };
      lean.armL = { ik: [0.048, 0.205, 0.295], pole: [0.25, -1, 0.1], in: 'chest', hand: [0, 0, 1] };
      lean.armR = { ik: [-0.048, 0.205, 0.295], pole: [-0.25, -1, 0.1], in: 'chest', hand: [0, 0, 1] };
    }
    if (fault === 'elbows-drop' && load === 'front') {
      lean.armL = { bar: 0.25, pole: [0.2, -1, 0.25], in: 'chest' };
      lean.armR = { bar: -0.25, pole: [-0.2, -1, 0.25], in: 'chest' };
    }
    const label = fault === 'elbows-drop' ? '팔꿈치가 떨어짐' : fault === 'goblet-lean' ? '덤벨이 떨어지며 숙여짐' : '상체가 숙여짐';
    setKey(list, 1, label, { ...low, ...lean });
    setKey(list, 2, label, { ...mid, ...lean });
  }

  return { id, cycle: 3.4, view: load === 'back' ? [32, 12] : [38, 12], keys: keys(...list), scene, bar, work: [0.55, 1], fault };
}

/* ── 기계 스쿼트 ─────────────────────────────────── */

export type MachineSquat = 'hack' | 'vSquat' | 'pendulum' | 'belt';

export function machineSquat(id: string, kind: MachineSquat, fault?: string): Clip {
  if (kind === 'belt') return beltSquat(id, fault);
  // 등판이 바닥과 이루는 각 — 핵은 눕고, 브이 스쿼트는 거의 선다
  const angle = kind === 'hack' ? 52 : kind === 'pendulum' ? 60 : 68;
  const a = angle * DEG;
  const along: Vec3 = [0, Math.sin(a), -Math.cos(a)];
  const plateY = 0.1;
  const footZ = 0.3;
  const legs = (cave = false): { legL: LegSpec; legR: LegSpec } => ({
    legL: plant(0.17, footZ, 16, { y: plateY, pole: cave ? [-0.75, 0.1, 0.65] : undefined }),
    legR: plant(-0.17, footZ, 16, { y: plateY, pole: cave ? [0.75, 0.1, 0.65] : undefined }),
  });
  const ankleMid: Vec3 = [0, plateY + BODY.ankle, footZ];
  const topPelvis = madd(ankleMid, along, 0.835);
  // 어깨 패드 옆 손잡이 — 어깨 앞에서 세워 쥐고, 팔꿈치는 아래로
  const hold = (side: 1 | -1): ArmSpec => ({ ik: [side * 0.3, 0.24, 0.2], pole: [side * 0.5, -1, -0.3], in: 'chest', hand: [0, 1, 0] });
  const body = (travel: number, extra: Partial<Pose3> = {}): Pose3 => ({
    pelvis: madd(topPelvis, along, -travel), pitch: -(90 - angle), spine: 0, neck: Math.min(20, (90 - angle) * 0.4),
    ...legs(), armL: hold(1), armR: hold(-1), ...extra,
  });
  const top = body(0.02);
  const low = body(kind === 'hack' ? 0.44 : 0.42);
  const list: KeyList = [
    [0, '내려가기', top],
    [0.45, '최저점', low],
    [0.55, '밀어 올리기', body(0.43)],
    [1, undefined, top],
  ];
  if (fault === 'knee-cave') {
    setKey(list, 1, '무릎이 안으로', { ...low, ...legs(true) });
    setKey(list, 2, '무릎이 안으로', { ...body(0.43), ...legs(true) });
  } else if (fault === 'pad-off') {
    const off = { ...low, pitch: low.pitch! + 22, spine: 18, pelvis: madd(low.pelvis, [0, 0.05, 1], 0.06) };
    setKey(list, 1, '엉덩이가 패드에서 떨어짐', off);
    setKey(list, 2, '엉덩이가 패드에서 떨어짐', off);
  } else if (fault === 'knee-lock') {
    const locked = body(-0.012);
    setKey(list, 0, '무릎을 쫙 펴서 잠금', locked);
    setKey(list, 3, undefined, locked);
  }
  const railMid = madd(topPelvis, along, -0.1);
  const side: Vec3 = [1, 0, 0];
  return {
    id, cycle: 3.4, view: [70, 12], keys: keys(...list),
    scene: [
      { kind: 'box', p: [0, plateY / 2, footZ + 0.02], size: [0.7, plateY, 0.62] },
      { kind: 'frame', p: add(railMid, [0.36, 0, -0.06]), size: [0.07, 1.5, 0.07], x: side, y: along },
      { kind: 'frame', p: add(railMid, [-0.36, 0, -0.06]), size: [0.07, 1.5, 0.07], x: side, y: along },
      { kind: 'frame', p: [0, 0.03, footZ - 0.6], size: [0.85, 0.06, 1.4] },
    ],
    links: [
      { kind: 'pad', bone: 'chest', u: 0.45, off: [0, 0, -0.13], size: [0.34, 0.75, 0.07] },
      { kind: 'pad', bone: 'chest', u: 1.04, off: [0, 0.01, -0.01], size: [0.46, 0.07, 0.15] },
      { kind: 'pad', bone: 'pelvis', u: 0.3, off: [0, 0, -0.16], size: [0.3, 0.3, 0.07] },
      ...([1, -1] as const).flatMap((side): Link[] => [
        { kind: 'post', bone: 'chest', u: 0.84, off: [side * 0.3, 0, 0.2], size: [0.035, 0.18, 0.035] },
        { kind: 'post', bone: 'chest', u: 1.1, off: [side * 0.3, 0, 0.09], size: [0.035, 0.035, 0.26] },
      ]),
    ],
    work: [0.55, 1], fault,
  };
}

function beltSquat(id: string, fault?: string): Clip {
  const deck = 0.22;
  const legs = (cave = false, heel = 0): { legL: LegSpec; legR: LegSpec } => ({
    legL: plant(0.2, 0, 22, { y: deck, heel, pole: cave ? [-0.75, 0.1, 0.65] : undefined }),
    legR: plant(-0.2, 0, 22, { y: deck, heel, pole: cave ? [0.75, 0.1, 0.65] : undefined }),
  });
  const hands = {
    armL: { ik: [0.24, 1.08, 0.22] as Vec3, pole: [0.4, -1, -0.3] as Vec3, hand: [0, 1, 0] as Vec3 },
    armR: { ik: [-0.24, 1.08, 0.22] as Vec3, pole: [-0.4, -1, -0.3] as Vec3, hand: [0, 1, 0] as Vec3 },
  };
  const top: Pose3 = { pelvis: [0, deck + STAND_HEIGHT - 0.01, -0.03], pitch: 6, spine: 0, ...legs(), ...hands };
  const low: Pose3 = { pelvis: [0, deck + 0.45, -0.17], pitch: 16, spine: 2, neck: -6, ...legs(), ...hands };
  const list: KeyList = [[0, '내려가기', top], [0.45, '최저점', low], [0.55, '밀어 올리기', lift(low, 0.01)], [1, undefined, top]];
  if (fault === 'knee-cave') {
    setKey(list, 1, '무릎이 안으로', { ...low, ...legs(true) });
    setKey(list, 2, '무릎이 안으로', { ...lift(low, 0.01), ...legs(true) });
  } else if (fault === 'torso-lean') {
    setKey(list, 1, '상체가 숙여짐', { ...low, pitch: 42, pelvis: [0, deck + 0.47, -0.24] });
    setKey(list, 2, '상체가 숙여짐', { ...low, pitch: 42, pelvis: [0, deck + 0.48, -0.24] });
  } else if (fault === 'heels-up') {
    setKey(list, 1, '뒤꿈치가 들림', { ...low, ...legs(false, 22), pelvis: [0, deck + 0.48, -0.12] });
    setKey(list, 2, '뒤꿈치가 들림', { ...low, ...legs(false, 22), pelvis: [0, deck + 0.49, -0.12] });
  }
  return {
    id, cycle: 3.4, view: [40, 12], keys: keys(...list),
    scene: [
      { kind: 'box', p: [0.42, deck / 2, 0], size: [0.38, deck, 0.7] },
      { kind: 'box', p: [-0.42, deck / 2, 0], size: [0.38, deck, 0.7] },
      { kind: 'frame', p: [0, 0.03, 0], size: [0.46, 0.06, 0.8] },
      { kind: 'post', p: [0.3, 0.54, 0.24], size: [0.05, 1.08, 0.05] },
      { kind: 'post', p: [-0.3, 0.54, 0.24], size: [0.05, 1.08, 0.05] },
      { kind: 'bar', p: [0, 1.08, 0.24], size: [0.018, 0.66] },
      { kind: 'pulley', p: [0, 0.06, 0.02], size: [0.06, 0.04], x: [1, 0, 0] },
    ],
    cables: [{ from: [0, 0.06, 0.02], to: 'pelvis' }],
    links: [{ kind: 'pad', bone: 'pelvis', u: 0.4, off: [0, 0, 0], size: [0.36, 0.08, 0.26] }],
    work: [0.55, 1], fault,
  };
}

/* ── 레그 프레스 ─────────────────────────────────── */

export function legPress(id: string, calf: boolean, fault?: string): Clip {
  const recline = 52;
  const pelvis: Vec3 = [0, 0.44, 0];
  // 발판이 오르내리는 레일 — 앞 위로 40°
  const r: Vec3 = [0, Math.sin(40 * DEG), Math.cos(40 * DEG)];
  const along: Vec3 = [0, Math.cos(40 * DEG), -Math.sin(40 * DEG)];
  const feet = (reach: number, heel = 0, cave = false): { legL: LegSpec; legR: LegSpec } => {
    const at = madd(madd(pelvis, r, reach), along, calf ? -0.05 : 0.05);
    const foot = (x: number): LegSpec => {
      const ball = madd(add(at, [x, 0, 0]), along, BODY.ball * 0.5);
      return footOn(madd(ball, r, BODY.ankle - 0.075), scale(r, -1), along, heel, cave ? [-x * 4, 0.3, 0.7] : [x * 1.5, 0.8, 0.5]);
    };
    return { legL: foot(0.17), legR: foot(-0.17) };
  };
  const hold = (side: 1 | -1): ArmSpec => ({ ik: [side * 0.27, -0.02, 0.12], in: 'pelvis', pole: [side * 0.6, -0.2, -1], hand: [0, 0, 1] });
  const body = (legs: { legL: LegSpec; legR: LegSpec }, extra: Partial<Pose3> = {}): Pose3 => ({
    pelvis, pitch: -recline, spine: 0, neck: 18, ...legs, armL: hold(1), armR: hold(-1), ...extra,
  });
  const list: KeyList = calf
    ? [
      [0, '발끝으로 밀기', body(feet(0.8, -12))],
      [0.42, '끝까지', body(feet(0.8, 26))],
      [0.52, '천천히 내리기', body(feet(0.8, 26))],
      [1, undefined, body(feet(0.8, -12))],
    ]
    : [
      [0, '내리기', body(feet(0.8))],
      [0.45, '무릎이 가슴 쪽으로', body(feet(0.4))],
      [0.55, '밀기', body(feet(0.41))],
      [1, undefined, body(feet(0.8))],
    ];
  if (!calf && fault === 'butt-lift') {
    const curl = body(feet(0.33), { pelvis: [0, 0.48, 0.05], pitch: -recline + 18, spine: 16 });
    setKey(list, 1, '엉덩이가 시트에서 뜸', curl);
    setKey(list, 2, '엉덩이가 시트에서 뜸', curl);
  } else if (!calf && fault === 'knee-lock') {
    setKey(list, 0, '무릎을 쫙 펴서 잠금', body(feet(0.86)));
    setKey(list, 3, undefined, body(feet(0.86)));
  } else if (!calf && fault === 'knee-cave') {
    setKey(list, 1, '무릎이 안으로', body(feet(0.4, 0, true)));
    setKey(list, 2, '무릎이 안으로', body(feet(0.41, 0, true)));
  } else if (calf && fault === 'short-range') {
    setKey(list, 0, '조금만 움직임', body(feet(0.8, 4)));
    setKey(list, 1, '조금만 움직임', body(feet(0.8, 14)));
    setKey(list, 2, '조금만 움직임', body(feet(0.8, 14)));
    setKey(list, 3, undefined, body(feet(0.8, 4)));
  } else if (calf && fault === 'bounce') {
    list.splice(0, 4,
      [0, '아래에서 튕김', body(feet(0.8, -12))], [0.18, undefined, body(feet(0.8, 26))], [0.3, undefined, body(feet(0.8, -12))],
      [0.48, undefined, body(feet(0.8, 26))], [0.6, undefined, body(feet(0.8, -12))], [1, undefined, body(feet(0.8, -12))]);
  }
  // 발판 — 발볼에 붙어 레일을 따라 움직이고, 방향은 그대로
  const plate = { x: [1, 0, 0] as Vec3, y: along };
  const seatBack: Vec3 = [0, Math.cos(recline * DEG), -Math.sin(recline * DEG)];
  const backPad = madd(madd(pelvis, seatBack, 0.42), cross([1, 0, 0], seatBack), -0.13);
  const railCenter = madd(madd(pelvis, r, 0.62), along, -0.05);
  return {
    id, cycle: calf ? 2.6 : 3.4, view: [100, 12], keys: keys(...list),
    scene: [
      { kind: 'pad', p: [0, 0.31, 0.04], size: [0.44, 0.08, 0.42], x: [1, 0, 0], y: normalize([0, 1, 0.25]) },
      { kind: 'pad', p: backPad, size: [0.44, 0.8, 0.08], x: [1, 0, 0], y: seatBack },
      { kind: 'frame', p: add(railCenter, [0.42, -0.05, 0]), size: [0.07, 1.3, 0.07], x: [1, 0, 0], y: r },
      { kind: 'frame', p: add(railCenter, [-0.42, -0.05, 0]), size: [0.07, 1.3, 0.07], x: [1, 0, 0], y: r },
      { kind: 'frame', p: [0, 0.04, 0.4], size: [1.0, 0.08, 1.6] },
      { kind: 'frame', p: [0, 0.16, 0.02], size: [0.08, 0.26, 0.08] },
    ],
    links: [
      { kind: 'pad', bone: 'footL', u: 0.6, off: [-0.17, 0.1, 0.03], size: [0.82, 0.62, 0.05], fixed: plate },
    ],
    work: calf ? [0, 0.42] : [0.55, 1], fault,
  };
}

/* ── 런지 ────────────────────────────────────────── */

export type LungeKind = 'reverse' | 'walking' | 'split' | 'stepUp';

/** 앞다리 = 왼다리. 뒷다리는 발끝으로 */
export function lunge(id: string, kind: LungeKind, fault?: string): Clip {
  if (kind === 'split') return splitSquat(id, fault);
  if (kind === 'stepUp') return stepUp(id, fault);
  const reverse = kind === 'reverse';
  const arms = reverse ? handsOnHips() : hangingArms(90);
  const hold: Clip['hold'] = reverse ? undefined : { L: 'dumbbell', R: 'dumbbell' };
  const together: Pose3 = { ...standing({}, 0.1, 6), ...arms };
  // 앞발 · 뒷발 자리 — 뒤로 딛든 앞으로 딛든 바닥에서의 간격은 같다
  const frontZ = reverse ? 0 : 0.62;
  const backZ = reverse ? -0.72 : -0.1;
  const caved = fault === 'knee-cave';
  const front = plant(0.1, frontZ, 6, caved ? { pole: [-0.8, 0.1, 0.6] } : {});
  const back = (heel: number): LegSpec => ballAt(-0.11, backZ, 4, heel);
  const midZ = (frontZ + backZ) / 2;
  const leaning = fault === 'torso-lean';
  const low: Pose3 = {
    ...together, legL: front, legR: back(62), pelvis: [0, 0.5, midZ + 0.06], pitch: leaning ? 30 : 6, neck: leaning ? -12 : 0,
  };
  const step: Pose3 = reverse
    ? { ...together, legR: { ankle: [-0.11, 0.2, -0.36], fwd: [0, -0.35, 0.94], up: [0, 0.94, 0.35], pole: [0, 0, 1] }, pelvis: [0, 0.88, -0.07] }
    : { ...together, legL: { ankle: [0.1, 0.2, 0.32], fwd: [0, -0.2, 0.98], up: [0, 0.98, 0.2], pole: [0, 0.3, 1] }, pelvis: [0, 0.88, 0.05] };
  const land: Pose3 = reverse
    ? { ...together, legR: back(50), pelvis: [0, 0.74, -0.2], pitch: 5 }
    : { ...together, legL: front, legR: back(40), pelvis: [0, 0.76, 0.2], pitch: 5 };
  const list: KeyList = [
    [0, reverse ? '뒤로 딛기' : '앞으로 딛기', together],
    [0.15, undefined, step],
    [0.3, '내려가기', land],
    [0.48, '최저점', low],
    [0.56, '앞발로 밀기', lift(low, 0.015)],
    [0.74, undefined, land],
    [0.88, undefined, step],
    [1, undefined, together],
  ];
  if (fault === 'knee-cave') {
    setKey(list, 3, '앞무릎이 안으로', low);
    setKey(list, 4, '앞무릎이 안으로', lift(low, 0.015));
  } else if (fault === 'torso-lean') {
    setKey(list, 3, '상체가 앞으로 쏠림', low);
    setKey(list, 4, '상체가 앞으로 쏠림', lift(low, 0.015));
  } else if (fault === 'back-leg') {
    // 뒷발로 밀어 올라옴 — 뒷발 뒤꿈치가 높이 들리고 몸이 앞으로 실린다
    setKey(list, 4, '뒷발로 밀어 올라옴', { ...lift(low, 0.12, 0.12), legR: back(78), pitch: 14 });
  }
  return {
    id, cycle: 4, view: [72, 10], keys: keys(...list), scene: [], hold, side: 'L',
    work: [0.56, 0.88], fault,
  };
}

function splitSquat(id: string, fault?: string): Clip {
  const benchTop = 0.45;
  const caved = fault === 'knee-cave';
  const front = plant(0.11, 0.34, 6, caved ? { pole: [-0.8, 0.1, 0.6] } : {});
  // 뒷발 — 발등을 벤치에 얹는다. 발끝이 뒤를, 발등이 아래를 본다
  const backFoot: LegSpec = { ankle: [-0.12, benchTop + 0.06, -0.58], fwd: normalize([0, -0.22, -1]), up: normalize([0, -1, 0.22]), pole: [0, -0.4, 1] };
  const body = (y: number, extra: Partial<Pose3> = {}): Pose3 => ({
    pelvis: [0, y, -0.06], pitch: 9, spine: 0, legL: front, legR: backFoot, ...hangingArms(90), ...extra,
  });
  const top = body(0.82);
  const low = body(0.5);
  const list: KeyList = [[0, '내려가기', top], [0.45, '최저점', low], [0.55, '앞발로 밀기', body(0.51)], [1, undefined, top]];
  if (fault === 'knee-cave') {
    setKey(list, 1, '앞무릎이 안으로', low);
    setKey(list, 2, '앞무릎이 안으로', body(0.51));
  } else if (fault === 'torso-lean') {
    setKey(list, 1, '상체가 앞으로 쏠림', body(0.52, { pitch: 36, neck: -14 }));
    setKey(list, 2, '상체가 앞으로 쏠림', body(0.53, { pitch: 36, neck: -14 }));
  } else if (fault === 'back-leg') {
    setKey(list, 2, '뒷발로 밀어 올라옴', body(0.6, { pelvis: [0, 0.6, -0.12], pitch: 4 }));
  }
  return {
    id, cycle: 3.6, view: [72, 10], keys: keys(...list),
    scene: flatBench(-1.05, -0.45, benchTop),
    hold: { L: 'dumbbell', R: 'dumbbell' }, side: 'L', work: [0.55, 1], fault,
  };
}

function stepUp(id: string, fault?: string): Clip {
  const box = 0.45;
  const caved = fault === 'knee-cave';
  const onBox = plant(0.11, 0.36, 6, { y: box, pole: caved ? [-0.8, 0.2, 0.6] : undefined });
  const floor = plant(-0.11, -0.16, 6);
  const arms = hangingArms(90);
  const start: Pose3 = { pelvis: [0.01, 0.8, 0.02], pitch: 14, spine: 0, neck: -6, legL: onBox, legR: floor, ...arms };
  const topPose: Pose3 = { pelvis: [0.01, box + STAND_HEIGHT - 0.005, 0.33], pitch: 2, legL: onBox, legR: plant(-0.11, 0.36, 6, { y: box }), ...arms };
  const passing: Pose3 = { ...topPose, pelvis: [0.01, box + 0.86, 0.3], legR: { ankle: [-0.12, box + 0.12, 0.22], fwd: [0, -0.3, 0.95], up: [0, 0.95, 0.3], pole: [0, 0, 1] } };
  const list: KeyList = [
    [0, '앞발로 딛고 올라가기', start],
    [0.3, undefined, passing],
    [0.42, '박스 위에 서기', topPose],
    [0.55, '천천히 내려오기', topPose],
    [0.7, undefined, passing],
    [1, undefined, start],
  ];
  if (fault === 'back-leg') {
    // 뒷발로 바닥을 차고 올라감
    list.splice(1, 0, [0.14, '뒷발로 차고 올라감', { ...start, pelvis: [0.01, 0.92, 0.12], legR: ballAt(-0.11, -0.02, 6, 60), pitch: 22 }]);
  } else if (fault === 'knee-cave') {
    setKey(list, 1, '앞무릎이 안으로', passing);
  }
  return {
    id, cycle: 3.8, view: [72, 10], keys: keys(...list),
    scene: [block([0, box / 2, 0.42], [0.55, box, 0.5])],
    hold: { L: 'dumbbell', R: 'dumbbell' }, side: 'L', work: [0, 0.42], fault,
  };
}

/* ── 데드리프트 ──────────────────────────────────── */

export function deadlift(id: string, fault?: string): Clip {
  const legs = { legL: plant(0.13, 0, 8), legR: plant(-0.13, 0, 8) };
  const hold = (side: 1 | -1): ArmSpec => ({ bar: side * 0.25, pole: [side * 0.25, 0.1, -1] });
  const base: Pose3 = { pelvis: [0, 0.6, -0.3], pitch: 40, spine: 2, neck: -20, ...legs, armL: hold(1), armR: hold(-1) };
  // 바닥 · 무릎 지나기 · 잠그기 — 다리로 골반 자리를 정하고, 팔이 바에 닿게 상체를 기울인다
  const floor = hipHinge({ ...base, neck: -24 }, { knee: 80, back: -0.26, barY: 0.225, ahead: 0.05 });
  const knee = hipHinge({ ...base, neck: -16 }, { knee: 30, back: -0.3, barY: 0.5, ahead: 0.04 });
  const lock = hipHinge({ ...base, neck: 0 }, { knee: 4, back: -0.03, barY: 0.79, ahead: -0.1 });

  const list: KeyList = [
    [0, '바닥에서 밀기', floor],
    [0.2, '무릎 지나기', knee],
    [0.42, '잠그기', lock],
    [0.52, '내려놓기', lock],
    [0.78, undefined, knee],
    [1, undefined, floor],
  ];
  if (fault === 'round-back') {
    const roundFloor = hipHinge({ ...base, neck: -6 }, { knee: 80, back: -0.26, barY: 0.225, ahead: 0.05, spine: 40 });
    const roundKnee = hipHinge({ ...base, neck: -6 }, { knee: 30, back: -0.3, barY: 0.5, ahead: 0.04, spine: 40 });
    setKey(list, 0, '등이 말림', roundFloor);
    setKey(list, 1, '등이 말림', roundKnee);
    setKey(list, 4, undefined, roundKnee);
    setKey(list, 5, undefined, roundFloor);
  } else if (fault === 'bar-away') {
    const farFloor = hipHinge({ ...base, neck: -24 }, { knee: 74, back: -0.24, barY: 0.225, ahead: -0.07 });
    const farKnee = hipHinge({ ...base, neck: -16 }, { knee: 24, back: -0.28, barY: 0.5, ahead: -0.09 });
    setKey(list, 0, '바가 몸에서 멂', farFloor);
    setKey(list, 1, '바가 몸에서 멂', farKnee);
    setKey(list, 4, undefined, farKnee);
    setKey(list, 5, undefined, farFloor);
  } else if (fault === 'hips-first') {
    list.splice(1, 0, [0.1, '엉덩이만 먼저', hipHinge({ ...base, neck: -30 }, { knee: 34, back: -0.33, barY: 0.28, ahead: 0.05 })]);
  } else if (fault === 'lean-back') {
    const lean = leanBack(lock);
    const near = hipHinge({ ...base, neck: -4 }, { knee: 10, back: -0.08, barY: 0.7, ahead: -0.06 });
    setKey(list, 2, '허리를 뒤로 젖힘', lean);
    setKey(list, 3, '허리를 뒤로 젖힘', lean);
    list.splice(2, 0, [0.32, undefined, near]);
    list.splice(5, 0, [0.64, undefined, near]);
  }
  return {
    id, cycle: 3.8, view: [34, 12], keys: keys(...list), scene: [mat([0, 0, 0.05], 1.9, 1.2)],
    bar: { kind: 'barbell', plates: 0.225 }, work: [0, 0.42], fault,
  };
}

/** 잠근 자세에서 엉덩이를 앞으로 밀고 허리를 뒤로 젖힌 실수 — 바는 늘어뜨린 팔 끝에 */
function leanBack(lock: Pose3): Pose3 {
  const lean: Pose3 = { ...lock, pelvis: [0, lock.pelvis[1] - 0.005, lock.pelvis[2] + 0.05], pitch: -14, spine: -12, neck: 8 };
  const s = shoulderMid(lean);
  return { ...lean, bar: { at: [0, s[1] - 0.578, s[2] + 0.11] } };
}

/* ── 힌지 ────────────────────────────────────────── */

export type HingeKind = 'rdl' | 'stiff' | 'sumo' | 'trap' | 'goodMorning' | 'dbRdl' | 'pullThrough' | 'kbSwing';

export function hinge(id: string, kind: HingeKind, fault?: string): Clip {
  if (kind === 'goodMorning') return goodMorning(id, fault);
  if (kind === 'pullThrough') return pullThrough(id, fault);
  if (kind === 'kbSwing') return kettlebellSwing(id, fault);
  const sumo = kind === 'sumo';
  const trap = kind === 'trap';
  const db = kind === 'dbRdl';
  const cave = fault === 'knee-cave';
  const legs = sumo
    ? { legL: plant(0.36, 0, 38, { pole: cave ? [-0.3, 0.1, 1] : undefined }), legR: plant(-0.36, 0, 38, { pole: cave ? [0.3, 0.1, 1] : undefined }) }
    : { legL: plant(0.13, 0, 8), legR: plant(-0.13, 0, 8) };
  const grip = sumo ? 0.17 : trap ? 0.28 : db ? 0.12 : 0.25;
  const hand = (side: 1 | -1): ArmSpec => ({ bar: side * grip, pole: [side * 0.25, 0.1, -1], ...(trap ? { hand: [0, 0, 1] as Vec3 } : {}) });
  const base: Pose3 = { pelvis: [0, 0.8, -0.2], pitch: 30, spine: 2, neck: 0, ...legs, armL: hand(1), armR: hand(-1) };
  const lock = hipHinge(base, { knee: 4, back: -0.03, barY: trap ? 0.76 : sumo ? 0.74 : 0.79, grip, ahead: trap ? 0 : -0.1 });

  // 아래 — RDL은 무릎 아래까지, 스티프는 더 깊게, 스모 · 트랩바는 바닥에서
  const bottom: Record<string, { knee: number; back: number; barY: number; neck: number; ahead: number }> = {
    rdl: { knee: 22, back: -0.3, barY: 0.42, neck: -26, ahead: 0.04 },
    dbRdl: { knee: 22, back: -0.3, barY: 0.42, neck: -26, ahead: 0.04 },
    stiff: { knee: 8, back: -0.33, barY: 0.34, neck: -30, ahead: 0.04 },
    sumo: { knee: 96, back: -0.15, barY: 0.225, neck: -14, ahead: 0.03 },
    trap: { knee: 82, back: -0.17, barY: 0.27, neck: -16, ahead: -0.01 },
  };
  const b = bottom[kind]!;
  const low = hipHinge({ ...base, neck: b.neck }, { knee: b.knee, back: b.back, barY: b.barY, grip, ahead: b.ahead });
  const midway = (lowPose: { knee: number; back: number; barY: number; ahead: number }): Pose3 => hipHinge({ ...base, neck: b.neck / 2 }, {
    knee: (lowPose.knee + 4) / 2, back: (lowPose.back - 0.03) / 2, barY: (lowPose.barY + 0.79) / 2, grip, ahead: (lowPose.ahead - 0.1) / 2,
  });
  const mid = midway(b);
  const fromFloor = sumo || trap;
  const list: KeyList = fromFloor
    ? [[0, '바닥에서 밀기', low], [0.2, undefined, mid], [0.42, '잠그기', lock], [0.52, '내려놓기', lock], [0.78, undefined, mid], [1, undefined, low]]
    : [[0, '엉덩이 뒤로 빼기', lock], [0.22, undefined, mid], [0.45, '최저점', low], [0.55, '엉덩이로 일어서기', low], [0.78, undefined, mid], [1, undefined, lock]];
  const lowAt = fromFloor ? [0, 5] : [2, 3];
  const relabel = (label: string, pose: Pose3) => {
    lowAt.forEach((i, n) => setKey(list, i, n === 0 ? label : list[i]![1], pose));
  };
  if (fault === 'round-back') {
    relabel('등이 말림', hipHinge({ ...base, neck: -8 }, { knee: b.knee, back: b.back, barY: b.barY, grip, ahead: b.ahead, spine: 40 }));
  } else if (fault === 'squatting') {
    relabel('스쿼트처럼 앉음', hipHinge({ ...base, neck: -12 }, { knee: 72, back: -0.2, barY: b.barY, grip, ahead: b.ahead }));
  } else if (fault === 'too-deep') {
    relabel('너무 깊이', hipHinge({ ...base, neck: -8 }, { knee: b.knee, back: b.back - 0.02, barY: 0.16, grip, ahead: b.ahead, spine: 30 }));
  } else if (fault === 'bar-away') {
    relabel(db ? '덤벨이 다리에서 멂' : '바가 몸에서 멂', hipHinge({ ...base, neck: b.neck }, { knee: b.knee, back: b.back + 0.02, barY: b.barY + 0.04, grip, ahead: -0.12 }));
  } else if (fault === 'hips-first' && fromFloor) {
    list.splice(1, 0, [0.12, '엉덩이만 먼저', hipHinge({ ...base, neck: -24 }, { knee: b.knee - 40, back: b.back - 0.08, barY: b.barY + 0.05, grip, ahead: b.ahead })]);
  } else if (fault === 'knee-cave' && sumo) {
    relabel('무릎이 안으로', low);
  } else if (fault === 'lean-back') {
    const lean = leanBack(lock);
    const at = fromFloor ? [2, 3] : [0, 5];
    at.forEach((i, n) => setKey(list, i, n === 0 ? '허리를 뒤로 젖힘' : list[i]![1], lean));
  }
  return {
    id, cycle: fromFloor ? 3.8 : 3.6, view: sumo || trap ? [30, 12] : [62, 12], keys: keys(...list),
    scene: [mat([0, 0, 0.05], 1.9, 1.2)],
    bar: db ? { kind: 'guide' } : { kind: trap ? 'trap' : 'barbell', plates: 0.225 },
    hold: db ? { L: 'dumbbell', R: 'dumbbell' } : undefined,
    work: fromFloor ? [0, 0.42] : [0.55, 1], fault,
  };
}

/** 바 자리(at)에 두 손을 — 바가 없는 동작(로프 · 케틀벨)에서 손 목표로 */
function handsAt(pose: Pose3, half: number, pole: Vec3, hand?: Vec3): Pose3 {
  const at = pose.bar!.at;
  return {
    ...pose,
    armL: { ik: [at[0] + half, at[1], at[2]], pole: [pole[0], pole[1], pole[2]], hand },
    armR: { ik: [at[0] - half, at[1], at[2]], pole: [-pole[0], pole[1], pole[2]], hand },
  };
}

function goodMorning(id: string, fault?: string): Clip {
  const legs = { legL: plant(0.16, 0, 10), legR: plant(-0.16, 0, 10) };
  const hold = (side: 1 | -1): ArmSpec => ({ bar: side * 0.43, pole: [side * 0.25, -1, -0.55], in: 'chest' });
  const onBack = { at: [0, 0.27, -0.088] as Vec3, in: 'chest' as const };
  const top: Pose3 = { pelvis: [0, STAND_HEIGHT, -0.02], pitch: 2, ...legs, armL: hold(1), armR: hold(-1), bar: onBack };
  const low: Pose3 = { pelvis: [0, 0.86, -0.2], pitch: 74, spine: 2, neck: -26, ...legs, armL: hold(1), armR: hold(-1), bar: onBack };
  const list: KeyList = [[0, '엉덩이 뒤로 빼기', top], [0.45, '최저점', low], [0.55, '엉덩이로 일어서기', low], [1, undefined, top]];
  if (fault === 'round-back') {
    setKey(list, 1, '등이 말림', { ...low, spine: 40, pitch: 66 });
    setKey(list, 2, undefined, { ...low, spine: 40, pitch: 66 });
  } else if (fault === 'too-deep') {
    setKey(list, 1, '너무 깊이', { ...low, pitch: 98, spine: 22 });
    setKey(list, 2, undefined, { ...low, pitch: 98, spine: 22 });
  }
  return {
    id, cycle: 3.6, view: [36, 12], keys: keys(...list), scene: rack(-0.55, 1.32),
    bar: { kind: 'barbell', plates: 0.225 }, work: [0.55, 1], fault,
  };
}

function pullThrough(id: string, fault?: string): Clip {
  const legs = { legL: plant(0.2, 0, 14), legR: plant(-0.2, 0, 14) };
  const base: Pose3 = { pelvis: [0, 0.8, -0.2], pitch: 30, spine: 2, neck: 0, ...legs };
  const rope = (p: Pose3) => {
    const withBar = handsAt(p, 0.045, [0.4, 0.2, -1], [0, 1, 0]);
    const { bar: _bar, ...rest } = withBar;
    void _bar;
    return rest as Pose3;
  };
  const top = rope(hipHinge(base, { knee: 4, back: -0.03, barY: 0.8, grip: 0.045, ahead: -0.14 }));
  const low = rope(hipHinge({ ...base, neck: -20 }, { knee: 20, back: -0.27, barY: 0.42, grip: 0.045, ahead: 0.2 }));
  const list: KeyList = [[0, '엉덩이 뒤로 빼기', top], [0.45, '최저점', low], [0.55, '엉덩이로 밀기', low], [1, undefined, top]];
  if (fault === 'squatting') {
    const squatty = rope(hipHinge({ ...base, neck: -10 }, { knee: 80, back: -0.18, barY: 0.36, grip: 0.045, ahead: 0.12 }));
    setKey(list, 1, '스쿼트처럼 앉음', squatty);
    setKey(list, 2, undefined, squatty);
  } else if (fault === 'arms-lift') {
    const lifted = rope(hipHinge(base, { knee: 4, back: -0.03, barY: 1.12, grip: 0.045, ahead: -0.4 }));
    setKey(list, 0, '팔로 당겨 올림', lifted);
    setKey(list, 3, undefined, lifted);
  }
  return {
    id, cycle: 3.2, view: [72, 10], keys: keys(...list),
    scene: [{ kind: 'post', p: [0, 1.1, -0.98], size: [0.12, 2.2, 0.12] }, { kind: 'pulley', p: [0, 0.14, -0.88], size: [0.045, 0.03], x: [1, 0, 0] }],
    bar: { kind: 'rope' }, cables: [{ from: [0, 0.14, -0.88], to: 'mid' }], work: [0.55, 1], fault,
  };
}

function kettlebellSwing(id: string, fault?: string): Clip {
  const legs = { legL: plant(0.19, 0, 12), legR: plant(-0.19, 0, 12) };
  const bell = (side: 1 | -1): ArmSpec => ({ bar: side * 0.035, pole: [side * 0.3, -0.2, -1] });
  const base: Pose3 = { pelvis: [0, 0.8, -0.2], pitch: 30, spine: 2, neck: 0, ...legs, armL: bell(1), armR: bell(-1) };
  const back = hipHinge({ ...base, neck: -24 }, { knee: 18, back: -0.22, barY: 0.52, grip: 0.035, ahead: 0.24 });
  const down = hipHinge({ ...base, neck: -14 }, { knee: 14, back: -0.12, barY: 0.74, grip: 0.035, ahead: -0.16 });
  const upBody: Pose3 = { ...base, pelvis: [0, STAND_HEIGHT, -0.02], pitch: -3, spine: 0 };
  const s = shoulderMid(upBody);
  const up: Pose3 = { ...upBody, bar: { at: [0, s[1] - 0.06, s[2] + 0.58] } };
  const list: KeyList = [[0, '엉덩이 접기', back], [0.22, '엉덩이 튕기기', down], [0.5, '가슴 높이', up], [0.75, undefined, down], [1, undefined, back]];
  if (fault === 'squat-swing') {
    const squatty = hipHinge({ ...base, neck: -10 }, { knee: 82, back: -0.15, barY: 0.4, grip: 0.035, ahead: 0.12 });
    setKey(list, 0, '스쿼트처럼 앉음', squatty);
    setKey(list, 4, undefined, squatty);
  } else if (fault === 'arms-lift') {
    const lifted: Pose3 = { ...upBody, pitch: -12, spine: -10, scap: [0.9, 0] };
    const t = shoulderMid(lifted);
    setKey(list, 2, '팔로 들어 올림', { ...lifted, bar: { at: [0, t[1] + 0.32, t[2] + 0.5] } });
  } else if (fault === 'round-back') {
    const round = hipHinge({ ...base, neck: -8 }, { knee: 18, back: -0.22, barY: 0.52, grip: 0.035, ahead: 0.24, spine: 40 });
    setKey(list, 0, '등이 말림', round);
    setKey(list, 4, undefined, round);
  }
  return {
    id, cycle: 1.8, view: [70, 10], keys: keys(...list), scene: [mat([0, 0, 0.1], 1.1, 1.4)],
    bar: { kind: 'kettlebell' }, work: [0.12, 0.5], fault,
  };
}

/* ── 힙 쓰러스트 · 브릿지 ────────────────────────── */

export type ThrustKind = 'barbell' | 'machine' | 'bridge';

export function hipThrust(id: string, kind: ThrustKind, fault?: string): Clip {
  const bridge = kind === 'bridge';
  // 날개뼈가 걸치는 곳 — 벤치 모서리, 브릿지는 바닥
  const contact: Vec3 = bridge ? [0, 0.075, -0.25] : [0, 0.47, -0.3];
  // 브릿지는 엉덩이를 든 위에서 정강이가 거의 서도록 발을 엉덩이에서 한 뼘 반쯤 떨어뜨린다
  const footZ = bridge ? 0.58 : 0.56;
  const legs = {
    legL: plant(0.17, footZ, 12, { pole: [0.3, 1, 0.4] }),
    legR: plant(-0.17, footZ, 12, { pole: [-0.3, 1, 0.4] }),
  };
  const arms: Partial<Pose3> = bridge
    ? { armL: { ik: [0.3, 0.03, -0.05], pole: [1, 0.3, 0], point: [0.2, 0, 1] }, armR: { ik: [-0.3, 0.03, -0.05], pole: [-1, 0.3, 0], point: [-0.2, 0, 1] } }
    : { armL: { bar: 0.36, pole: [0.6, 1, -0.2] }, armR: { bar: -0.36, pole: [-0.6, 1, -0.2] }, bar: { at: [0, 0.06, 0.17], in: 'pelvis' } };
  // 엉덩이를 든 몸: 어깨에서 무릎까지 일자. 내린 몸: 어깨는 그대로, 엉덩이만 아래로
  const body = (pitch: number, spine: number, neck: number) =>
    placeShoulders({ pelvis: [0, 0.4, 0], pitch, spine, neck, ...legs, ...arms }, contact);
  // 바벨 쓰러스트: 위 = 어깨에서 무릎까지 수평, 아래 = 엉덩이가 내려간 자세.
  // 브릿지: 아래 = 바닥에 누운 자세, 위 = 엉덩이를 든 자세 (어깨는 바닥에)
  const top = bridge ? body(-114, -2, 16) : body(-88, -2, 22);
  const low = bridge ? body(-90, 0, 6) : body(-48, 2, 10);
  const list: KeyList = [[0, '엉덩이로 밀기', low], [0.42, '꽉 조이기', top], [0.55, '내리기', top], [1, undefined, low]];
  if (fault === 'arch') {
    setKey(list, 1, '허리를 젖혀서 올림', body(bridge ? -110 : -82, -30, 4));
    setKey(list, 2, undefined, body(bridge ? -110 : -82, -30, 4));
  } else if (fault === 'chin-up') {
    setKey(list, 1, '턱이 들림', body(bridge ? -114 : -88, -6, -24));
    setKey(list, 2, undefined, body(bridge ? -114 : -88, -6, -24));
  }
  const scene: Prim[] = bridge
    ? [mat([0, 0, 0.05], 0.75, 1.6)]
    : [
      { kind: 'pad', p: [0, 0.39, -0.48], size: [1.2, 0.07, 0.3] },
      { kind: 'frame', p: [0.48, 0.18, -0.48], size: [0.05, 0.36, 0.05] },
      { kind: 'frame', p: [-0.48, 0.18, -0.48], size: [0.05, 0.36, 0.05] },
      { kind: 'frame', p: [0, 0.025, -0.48], size: [1.1, 0.05, 0.08] },
    ];
  if (kind === 'machine') scene.push(...machineFrame(-0.75, 1.0, 1.0));
  return {
    id, cycle: 3, view: [70, 14], keys: keys(...list), scene,
    bar: kind === 'barbell' ? { kind: 'barbell', plates: 0.225 } : undefined,
    links: kind === 'machine' ? [{ kind: 'pad', bone: 'pelvis', u: 0.4, off: [0, 0, 0.16], size: [0.5, 0.1, 0.16], pivot: [0.45, 0.25, -0.5], leverAt: 0.25 }] : undefined,
    work: [0, 0.42], fault,
  };
}

/* ── 백 익스텐션 · 글루트 햄 레이즈 ───────────────── */

export function backExtension(id: string, fault?: string): Clip {
  const pad: Vec3 = [0, 0.98, 0.14];
  const lean = 45;
  const u: Vec3 = [0, Math.cos(lean * DEG), Math.sin(lean * DEG)];
  const ankleMid = madd(pad, u, -0.83);
  const padFace = normalize(cross([1, 0, 0], u));
  const footPlate = (x: number): LegSpec => ({ ankle: [x, ankleMid[1], ankleMid[2]], fwd: padFace, up: u, pole: [0, -0.3, 1] });
  const body = (pitch: number, spine = 0, neck = -10): Pose3 => ({
    pelvis: pad, pitch, spine, neck, legL: footPlate(0.1), legR: footPlate(-0.1), ...armsCrossed(),
  });
  const top = body(lean, 0, -8);
  const low = body(132, 6, 10);
  const list: KeyList = [[0, '엉덩이를 접어 내려가기', top], [0.45, '최저점', low], [0.55, '엉덩이로 올라오기', low], [1, undefined, top]];
  if (fault === 'hyper') {
    setKey(list, 0, '허리를 과하게 젖힘', body(lean - 30, -24, -24));
    setKey(list, 3, undefined, body(lean - 30, -24, -24));
  } else if (fault === 'round-back') {
    setKey(list, 1, '등이 말림', body(118, 44, 20));
    setKey(list, 2, undefined, body(118, 44, 20));
  }
  return {
    id, cycle: 3.2, view: [80, 10], keys: keys(...list),
    scene: [
      { kind: 'pad', p: madd(madd(pad, padFace, -0.13), u, -0.06), size: [0.4, 0.3, 0.12], x: [1, 0, 0], y: u },
      { kind: 'frame', p: madd(madd(pad, padFace, -0.25), [0, -1, 0], 0.45), size: [0.07, 0.95, 0.07] },
      { kind: 'pad', p: madd(add(ankleMid, scale(u, -0.11)), padFace, 0.02), size: [0.5, 0.06, 0.32], x: [1, 0, 0], y: padFace },
      { kind: 'frame', p: [0, 0.04, (pad[2] + ankleMid[2]) / 2], size: [0.7, 0.08, 1.4] },
      { kind: 'frame', p: madd(ankleMid, [0, -1, 0], 0.18), size: [0.07, 0.36, 0.07] },
    ],
    work: [0.55, 1], fault,
  };
}

export function gluteHamRaise(id: string, fault?: string): Clip {
  const knee: Vec3 = [0, 0.95, 0];
  const ankle = (x: number): LegSpec => ({ ankle: [x, 0.97, -0.42], fwd: [0, -0.92, -0.38], up: [0, -0.38, 0.92] });
  // 몸이 무릎을 축으로 앞으로 눕는다 — 무릎에서 머리까지 일자
  const body = (angle: number, hips = 0): Pose3 => {
    const a = angle * DEG;
    const pelvis: Vec3 = [0, knee[1] + Math.cos(a) * BODY.thigh, knee[2] + Math.sin(a) * BODY.thigh];
    return {
      pelvis, pitch: angle + hips, spine: 0, neck: -8,
      legL: { ...ankle(0.1), pole: sub(add(knee, [0.1, 0, 0]), pelvis) },
      legR: { ...ankle(-0.1), pole: sub(add(knee, [-0.1, 0, 0]), pelvis) },
      ...armsCrossed(),
    };
  };
  const top = body(6);
  const low = body(84);
  const list: KeyList = [[0, '천천히 내려가기', top], [0.45, '바닥과 수평', low], [0.55, '뒤허벅지로 당기기', low], [1, undefined, top]];
  if (fault === 'hips-bend') {
    setKey(list, 2, '엉덩이가 접힘', body(60, 50));
    list.splice(3, 0, [0.75, undefined, body(30, 60)]);
  }
  return {
    id, cycle: 3.6, view: [80, 10], keys: keys(...list),
    scene: [
      { kind: 'pad', p: [0, knee[1] - 0.09, 0.08], size: [0.36, 0.14, 0.3] },
      { kind: 'roller', p: [0, 1.02, -0.44], size: [0.05, 0.36] },
      { kind: 'pad', p: [0, 0.82, -0.42], size: [0.34, 0.06, 0.14] },
      { kind: 'frame', p: [0, 0.42, -0.12], size: [0.08, 0.84, 0.08] },
      { kind: 'frame', p: [0, 0.04, -0.1], size: [0.7, 0.08, 1.2] },
    ],
    work: [0.55, 1], fault,
  };
}

/* ── 레그 익스텐션 · 레그 컬 ─────────────────────── */

const handlesAtSeat = (): { armL: ArmSpec; armR: ArmSpec } => ({
  armL: { ik: [0.27, -0.02, 0.06], in: 'pelvis', pole: [1, -0.2, -0.4], hand: [0, 0, 1] },
  armR: { ik: [-0.27, -0.02, 0.06], in: 'pelvis', pole: [-1, -0.2, -0.4], hand: [0, 0, 1] },
});

export function legExtension(id: string, fault?: string): Clip {
  const seat = 0.5;
  const sit = (knee: number, extra: Partial<Pose3> = {}): Pose3 => ({
    pelvis: [0, seat + 0.085, 0], pitch: -12, spine: 0, neck: 6,
    legL: { fk: [102, 3, 0, knee, -8] }, legR: { fk: [102, 3, 0, knee, -8] }, ...handlesAtSeat(), ...extra,
  });
  const bent = sit(88);
  const straight = sit(10);
  const knees = solvePose(bent);
  const kneeZ = knees.bones.shinL.a[2];
  const kneeY = knees.bones.shinL.a[1];
  const list: KeyList = [[0, '펴기', bent], [0.42, '끝에서 멈춤', straight], [0.55, '천천히 내리기', straight], [1, undefined, bent]];
  if (fault === 'hips-up') {
    const up = sit(10, { pelvis: [0, seat + 0.16, 0.02], pitch: -24 });
    setKey(list, 1, '엉덩이가 들림', up);
    setKey(list, 2, '엉덩이가 들림', up);
  } else if (fault === 'kick') {
    list.splice(0, 4, [0, '차고 툭 떨어뜨림', bent], [0.2, undefined, straight], [0.3, undefined, straight], [0.5, undefined, bent], [1, undefined, bent]);
  }
  return {
    id, cycle: 3, view: [90, 8], keys: keys(...list),
    scene: [
      ...seatBench(0, 80, { seat, seatLen: 0.4 }),
      { kind: 'post', p: [0.34, kneeY / 2 + 0.05, kneeZ], size: [0.07, kneeY + 0.1, 0.07] },
      { kind: 'pad', p: [0.3, seat + 0.05, 0.12], size: [0.05, 0.05, 0.22] },
      { kind: 'pad', p: [-0.3, seat + 0.05, 0.12], size: [0.05, 0.05, 0.22] },
      ...machineFrame(-0.6, 1.6, 0.7),
    ],
    links: [{ kind: 'roller', bone: ['shinL', 'shinR'], u: 0.86, off: [0, 0, 0.065], size: [0.055, 0.42], pivot: [0.32, kneeY, kneeZ], leverAt: 0.25 }],
    work: [0, 0.42], fault,
  };
}

export function legCurl(id: string, lyingDown: boolean, fault?: string): Clip {
  if (!lyingDown) return seatedLegCurl(id, fault);
  const top = 0.62;
  // 엎드린 몸 — 머리가 +z, 무릎은 벤치 끝 바로 밖. 넓적다리는 패드에 눕는다 (엉덩이를 조금 접은 채)
  const body = (knee: number, extra: Partial<Pose3> = {}, hip = 18): Pose3 => ({
    pelvis: [0, top + 0.13, 0.12], pitch: 98, spine: -6, neck: -24,
    legL: { fk: [hip, 3, 0, knee, -18] }, legR: { fk: [hip, 3, 0, knee, -18] },
    armL: { ik: [0.24, top - 0.06, 0.76], pole: [1, 0.2, -0.3], hand: [0, 1, 0] },
    armR: { ik: [-0.24, top - 0.06, 0.76], pole: [-1, 0.2, -0.3], hand: [0, 1, 0] },
    ...extra,
  });
  const straight = body(6);
  const bent = body(118);
  const knees = solvePose(straight);
  const kneeY = knees.bones.shinL.a[1];
  const kneeZ = knees.bones.shinL.a[2];
  const list: KeyList = [[0, '당기기', straight], [0.42, '끝까지', bent], [0.52, '천천히 펴기', bent], [1, undefined, straight]];
  if (fault === 'hips-up') {
    // 엉덩이만 들리고 무릎은 패드 끝에 그대로 — 엉덩이가 더 접힌다
    const up = body(118, { pelvis: [0, top + 0.26, 0.06], pitch: 112, spine: 10 }, 50);
    setKey(list, 1, '엉덩이가 들림', up);
    setKey(list, 2, undefined, up);
  } else if (fault === 'drop') {
    list.splice(2, 2, [0.52, '툭 떨어뜨림', bent], [0.62, undefined, straight], [1, undefined, straight]);
  }
  return {
    id, cycle: 3, view: [86, 12], keys: keys(...list),
    scene: [
      { kind: 'pad', p: [0, top - 0.035, 0.2], size: [0.34, 0.07, 1.0] },
      { kind: 'pad', p: [0, top + 0.03, 0.02], size: [0.34, 0.08, 0.36], x: [1, 0, 0], y: normalize([0, 1, -0.25]) },
      { kind: 'frame', p: [0, (top - 0.07) / 2, 0.55], size: [0.06, top - 0.07, 0.06] },
      { kind: 'frame', p: [0, (top - 0.07) / 2, -0.2], size: [0.06, top - 0.07, 0.06] },
      { kind: 'frame', p: [0, 0.03, 0.2], size: [0.6, 0.06, 1.2] },
      { kind: 'post', p: [0.34, kneeY / 2, kneeZ], size: [0.07, kneeY, 0.07] },
    ],
    links: [{ kind: 'roller', bone: ['shinL', 'shinR'], u: 0.9, off: [0, 0, -0.06], size: [0.05, 0.4], pivot: [0.32, kneeY, kneeZ], leverAt: 0.24 }],
    work: [0, 0.42], fault,
  };
}

function seatedLegCurl(id: string, fault?: string): Clip {
  const seat = 0.5;
  const body = (knee: number, extra: Partial<Pose3> = {}): Pose3 => ({
    pelvis: [0, seat + 0.085, 0], pitch: -16, neck: 8,
    legL: { fk: [104, 3, 0, knee, 4] }, legR: { fk: [104, 3, 0, knee, 4] }, ...handlesAtSeat(), ...extra,
  });
  const straight = body(8);
  const bent = body(100);
  const knees = solvePose(straight);
  const kneeY = knees.bones.shinL.a[1];
  const kneeZ = knees.bones.shinL.a[2];
  const thighPad = madd(scale(add(knees.bones.thighL.b, knees.bones.thighR.b), 0.5), [0, 1, -0.1], 0.1);
  const list: KeyList = [[0, '당기기', straight], [0.42, '끝까지', bent], [0.52, '천천히 펴기', bent], [1, undefined, straight]];
  if (fault === 'hips-up') {
    setKey(list, 1, '엉덩이가 들림', body(100, { pelvis: [0, seat + 0.15, 0.04], pitch: -28 }));
    setKey(list, 2, undefined, body(100, { pelvis: [0, seat + 0.15, 0.04], pitch: -28 }));
  } else if (fault === 'drop') {
    list.splice(2, 2, [0.52, '툭 떨어뜨림', bent], [0.62, undefined, straight], [1, undefined, straight]);
  }
  return {
    id, cycle: 3, view: [88, 10], keys: keys(...list),
    scene: [
      ...seatBench(0, 76, { seat, seatLen: 0.42 }),
      { kind: 'pad', p: [thighPad[0], thighPad[1], thighPad[2] - 0.06], size: [0.42, 0.08, 0.14] },
      { kind: 'post', p: [0.34, kneeY / 2 + 0.05, kneeZ], size: [0.07, kneeY + 0.1, 0.07] },
      ...machineFrame(-0.6, 1.5, 0.7),
    ],
    links: [{ kind: 'roller', bone: ['shinL', 'shinR'], u: 0.88, off: [0, 0, -0.06], size: [0.05, 0.42], pivot: [0.32, kneeY, kneeZ], leverAt: 0.24 }],
    work: [0, 0.42], fault,
  };
}

/* ── 카프 레이즈 ─────────────────────────────────── */

export type CalfKind = 'standing' | 'seated' | 'dumbbell';

const LEG_LENGTH = (BODY.thigh + BODY.shin) * 0.997;

function calfKeys(body: (heel: number) => Pose3, low: number, high: number, fault?: string): KeyList {
  if (fault === 'bounce') {
    return [[0, '아래에서 튕김', body(low)], [0.2, undefined, body(high)], [0.32, undefined, body(low)], [0.52, undefined, body(high)], [0.64, undefined, body(low)], [1, undefined, body(low)]];
  }
  const label = fault === 'short-range' ? '조금만 움직임' : undefined;
  return [[0, label ?? '발끝으로 올라가기', body(low)], [0.42, label ?? '끝까지', body(high)], [0.55, label ?? '천천히 내리기', body(high)], [0.92, undefined, body(low)], [1, undefined, body(low)]];
}

export function calfRaise(id: string, kind: CalfKind, fault?: string): Clip {
  const step = 0.08;
  const lowHeel = fault === 'short-range' ? 2 : -18;
  const highHeel = fault === 'short-range' ? 12 : 30;
  if (kind === 'seated') {
    const body = (heel: number): Pose3 => ({
      ...seated(0.45, -0.05, 0, { neck: 0 }),
      legL: ballAt(0.14, 0.42, 6, heel, step, [0.2, 0.6, 1]), legR: ballAt(-0.14, 0.42, 6, heel, step, [-0.2, 0.6, 1]),
      armL: { ik: [0.12, -0.02, 0.36], in: 'pelvis', pole: [1, 0, -0.3], hand: [0, 0, 1] },
      armR: { ik: [-0.12, -0.02, 0.36], in: 'pelvis', pole: [-1, 0, -0.3], hand: [0, 0, 1] },
    });
    return {
      id, cycle: 2.4, view: [80, 10], keys: keys(...calfKeys(body, lowHeel, highHeel, fault)),
      scene: [
        { kind: 'pad', p: [0, 0.415, 0.0], size: [0.36, 0.07, 0.36] },
        block([0, step / 2, 0.42], [0.5, step, 0.22]),
        { kind: 'post', p: [0.36, 0.35, 0.3], size: [0.07, 0.7, 0.07] },
        { kind: 'frame', p: [0, 0.03, 0.2], size: [0.8, 0.06, 0.9] },
      ],
      links: [{ kind: 'pad', bone: ['thighL', 'thighR'], u: 0.85, off: [0, 0, 0.075], size: [0.44, 0.06, 0.12], pivot: [0.36, 0.7, 0.3], leverAt: 0.22 }],
      work: [0, 0.42], fault,
    };
  }
  const single = kind === 'dumbbell';
  const ballZ = 0.02;
  const body = (heel: number): Pose3 => {
    const legL: LegSpec = single ? { fk: [12, 4, 0, 75, -20] } : ballAt(0.13, ballZ, 6, heel, step);
    const legR = ballAt(single ? -0.08 : -0.13, ballZ, 6, heel, step);
    const ankle = legR.ankle!;
    const pelvis: Vec3 = [single ? -0.03 : 0, ankle[1] + LEG_LENGTH, ankle[2] - 0.03];
    const arms: Partial<Pose3> = single
      ? { armL: { ik: [0.45, 1.25, 0.3], pole: [1, -0.6, -0.4], hand: [0, 1, 0] }, armR: { fk: [8, 4, 0, 6], turn: 90 } }
      : { armL: { ik: [0.24, 0.3, 0.22], in: 'chest', pole: [1, -1, -0.2], hand: [1, 0, 0] }, armR: { ik: [-0.24, 0.3, 0.22], in: 'chest', pole: [-1, -1, -0.2], hand: [1, 0, 0] } };
    return { pelvis, pitch: 2, spine: 0, neck: 0, legL, legR, ...arms };
  };
  const scene: Prim[] = [block([0, step / 2, ballZ - 0.06], [single ? 0.4 : 0.6, step, 0.25])];
  if (single) scene.push({ kind: 'post', p: [0.5, 1.0, 0.32], size: [0.08, 2.0, 0.08] });
  else scene.push(...machineFrame(-0.35, 2.0, 0.9));
  return {
    id, cycle: 2.4, view: single ? [70, 8] : [70, 10], keys: keys(...calfKeys(body, lowHeel, highHeel, fault)), scene,
    hold: single ? { R: 'dumbbell' } : undefined,
    // 어깨 패드와 그 앞 손잡이 — 같이 오르내린다
    links: single ? undefined : [
      { kind: 'pad', bone: 'chest', u: 1.04, off: [0, 0.01, -0.01], size: [0.5, 0.08, 0.15] },
      { kind: 'bar', bone: 'chest', u: 0.97, off: [0, 0, 0.22], size: [0.016, 0.62] },
    ],
    side: single ? 'R' : undefined, work: [0, 0.42], fault,
  };
}

/* ── 힙 기계 · 킥백 ──────────────────────────────── */

export function hipMachine(id: string, outward: boolean, fault?: string): Clip {
  const seat = 0.48;
  const body = (abd: number, extra: Partial<Pose3> = {}): Pose3 => ({
    pelvis: [0, seat + 0.085, 0], pitch: -22, neck: 10,
    legL: { fk: [102, abd, 0, 88, 0] }, legR: { fk: [102, abd, 0, 88, 0] }, ...handlesAtSeat(), ...extra,
  });
  const narrow = body(6);
  const wide = body(40);
  const list: KeyList = outward
    ? [[0, '바깥으로 밀기', narrow], [0.42, '끝에서 멈춤', wide], [0.55, '천천히 모으기', wide], [1, undefined, narrow]]
    : [[0, '안으로 모으기', wide], [0.42, '끝에서 멈춤', narrow], [0.55, '천천히 벌리기', narrow], [1, undefined, wide]];
  if (fault === 'swing') {
    setKey(list, 1, '상체를 흔들며 밂', body(outward ? 40 : 6, { pitch: -4, spine: 12, neck: -4 }));
  }
  const side = outward ? 1 : -1;
  return {
    id, cycle: 2.8, view: [12, 18], keys: keys(...list), scene: [...seatBench(0, 70, { seat, seatLen: 0.42 }), ...machineFrame(-0.65, 1.3, 0.9)],
    links: [
      { kind: 'pad', bone: 'thighL', u: 0.88, off: [-side * 0.075, 0, 0], size: [0.04, 0.2, 0.12] },
      { kind: 'pad', bone: 'thighR', u: 0.88, off: [side * 0.075, 0, 0], size: [0.04, 0.2, 0.12] },
    ],
    work: [0, 0.42], fault,
  };
}

export function gluteKickback(id: string, fault?: string): Clip {
  const body = (flex: number, knee: number, extra: Partial<Pose3> = {}): Pose3 => ({
    pelvis: [0, 0.92, -0.02], pitch: 46, spine: 0, neck: -18,
    legL: plant(0.11, 0.04, 6), legR: { fk: [flex, 3, 0, knee, -10] },
    armL: { ik: [0.24, 1.18, 0.62], pole: [1, -1, -0.2], hand: [0, 1, 0] },
    armR: { ik: [-0.24, 1.18, 0.62], pole: [-1, -1, -0.2], hand: [0, 1, 0] },
    ...extra,
  });
  const tucked = body(62, 92);
  const kicked = body(-22, 28);
  const list: KeyList = [[0, '뒤로 밀기', tucked], [0.42, '엉덩이 조이기', kicked], [0.55, '천천히 돌아오기', kicked], [1, undefined, tucked]];
  if (fault === 'arch') {
    setKey(list, 1, '허리를 젖혀서 참', body(-36, 24, { spine: -26, neck: -32 }));
    setKey(list, 2, undefined, body(-36, 24, { spine: -26, neck: -32 }));
  }
  const chest = solvePose(tucked).bones.chest;
  const padAt = scale(add(chest.a, chest.b), 0.5);
  return {
    id, cycle: 2.8, view: [80, 10], keys: keys(...list),
    scene: [
      { kind: 'pad', p: [padAt[0], padAt[1] - 0.17, padAt[2] + 0.03], size: [0.36, 0.08, 0.42], x: [1, 0, 0], y: normalize([0, 1, -0.75]) },
      { kind: 'frame', p: [0, 0.55, 0.38], size: [0.08, 1.1, 0.08] },
      { kind: 'bar', p: [0, 1.18, 0.64], size: [0.016, 0.6] },
      { kind: 'frame', p: [0, 0.03, 0.15], size: [0.7, 0.06, 1.0] },
    ],
    links: [{ kind: 'pad', bone: 'footR', u: 0.4, off: [0, 0, -0.03], size: [0.18, 0.28, 0.04] }],
    side: 'R', work: [0, 0.42], fault,
  };
}
