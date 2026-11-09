import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { EXERCISES, exerciseById } from '../exercises.ts';
import { mistakesFor } from '../mistakes.ts';
import { clipBounds, clipFrame, clipPose, effortAt, type Clip } from '../motionKit.ts';
import { faultsFor, motionFor, motionIds } from '../motions.ts';
import { stretchMotionFor } from '../motionsStretch.ts';
import { blend, solvePose, twoBone, type ArmSpec, type LegSpec, type Pose3, type Vec3 } from '../rig.ts';
import type { Exercise } from '../types.ts';

const SAMPLES = 48;

function frames(clip: Clip) {
  return Array.from({ length: SAMPLES + 1 }, (_, i) => clipFrame(clip, i / SAMPLES));
}

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
const angle = (a: Vec3, b: Vec3) => (Math.acos(Math.max(-1, Math.min(1, (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (len(a) * len(b))))) * 180) / Math.PI;

const ex = (id: string) => exerciseById(id) as Exercise;
const clipOf = (id: string, fault?: string) => motionFor({ id }, fault) as Clip;

/** 모든 종목의 바른 동작과 실수 동작 */
function allClips(): { exercise: Exercise; clip: Clip; fault?: string }[] {
  const out: { exercise: Exercise; clip: Clip; fault?: string }[] = [];
  for (const exercise of EXERCISES) {
    out.push({ exercise, clip: motionFor(exercise)! });
    for (const fault of faultsFor(exercise)) out.push({ exercise, clip: motionFor(exercise, fault)!, fault });
  }
  return out;
}

const limbMode = (spec: ArmSpec | LegSpec | undefined): string => {
  if (!spec) return 'none';
  if ('fk' in spec && spec.fk) return 'fk';
  if ('bar' in spec && spec.bar !== undefined) return 'bar';
  return 'ik';
};

describe('rig — 뼈대 풀기', () => {
  it('두 마디 풀기는 닿으면 정확히 닿고, 못 닿으면 못 미친 거리를 돌려준다', () => {
    const near = twoBone([0, 0, 0], [0, -0.4, 0.2], 0.3, 0.3, [0, 0, 1]);
    assert.ok(len(sub(near.end, [0, -0.4, 0.2])) < 1e-6);
    assert.equal(near.miss, 0);
    assert.ok(Math.abs(len(sub(near.mid, [0, 0, 0])) - 0.3) < 1e-6, '첫 마디 길이가 그대로');
    const far = twoBone([0, 0, 0], [0, -1, 0], 0.3, 0.3, [0, 0, 1]);
    assert.ok(Math.abs(far.miss - 0.4) < 1e-6);
  });

  it('왼팔 · 오른팔은 같은 각도에서 좌우만 뒤집힌다', () => {
    const solved = solvePose({ pelvis: [0, 0.92, 0], armL: { fk: [70, 60, 10, 40] }, armR: { fk: [70, 60, 10, 40] } });
    const l = solved.hands.L.grip;
    const r = solved.hands.R.grip;
    assert.ok(Math.abs(l[0] + r[0]) < 1e-9 && Math.abs(l[1] - r[1]) < 1e-9 && Math.abs(l[2] - r[2]) < 1e-9);
    assert.ok(l[0] > 0.3, '옆으로(+x, 그 사람의 왼쪽) 든 왼팔');
  });

  it('앞으로 숙이면(pitch +) 머리가 앞으로 간다', () => {
    const upright = solvePose({ pelvis: [0, 0.92, 0] }).bones.head.b;
    const bowed = solvePose({ pelvis: [0, 0.92, 0], pitch: 45 }).bones.head.b;
    assert.ok(bowed[2] > upright[2] + 0.3 && bowed[1] < upright[1]);
  });

  it('자세 섞기는 숫자만 섞고 한쪽에만 있는 값은 그대로 가져온다', () => {
    const a: Pose3 = { pelvis: [0, 1, 0], pitch: 0 };
    const b: Pose3 = { pelvis: [0, 0, 0], pitch: 40, spine: 10 };
    const mid = blend(a, b, 0.5);
    assert.deepEqual(mid.pelvis, [0, 0.5, 0]);
    assert.equal(mid.pitch, 20);
    assert.equal(mid.spine, 10);
  });
});

describe('motionFor — 종목마다 자기 동작', () => {
  it('114개 종목 모두에 시연 동작이 있다 (패턴으로 뭉뚱그리지 않는다)', () => {
    const ids = new Set(motionIds());
    for (const exercise of EXERCISES) {
      assert.ok(ids.has(exercise.id), `${exercise.id}: 동작이 없다`);
      assert.equal(motionFor(exercise)!.id, exercise.id);
    }
    assert.equal(ids.size, EXERCISES.length, '없는 종목의 동작이 있다');
  });

  it('키 자세는 0에서 시작해 1에서 끝나고, 처음과 끝이 같아 이어 돌려도 튀지 않는다', () => {
    for (const { exercise, clip, fault } of allClips()) {
      const name = `${exercise.id}${fault ? '/' + fault : ''}`;
      assert.equal(clip.keys[0]!.t, 0, `${name}: 0에서 시작하지 않는다`);
      assert.equal(clip.keys[clip.keys.length - 1]!.t, 1, `${name}: 1에서 끝나지 않는다`);
      for (let i = 1; i < clip.keys.length; i += 1) assert.ok(clip.keys[i]!.t > clip.keys[i - 1]!.t, `${name}: 키 순서가 뒤집혔다`);
      assert.deepEqual(clip.keys[0]!.pose, clip.keys[clip.keys.length - 1]!.pose, `${name}: 처음과 끝 자세가 다르다`);
      assert.ok(clip.cycle >= 1 && clip.cycle <= 5, `${name}: 한 번 ${clip.cycle}초`);
      assert.ok(clip.keys[0]!.label, `${name}: 첫 구간 말이 없다`);
      // 마지막 키(1)는 처음(0)과 같은 순간이라 거기 붙인 말은 화면에 나오지 않는다
      assert.equal(clip.keys[clip.keys.length - 1]!.label, undefined, `${name}: 끝 키에 붙은 말은 보이지 않는다`);
    }
  });

  it('한 동작 안에서 팔다리를 움직이는 방식(각도 · 닿을 곳 · 바)이 바뀌지 않는다', () => {
    for (const { exercise, clip, fault } of allClips()) {
      for (const limb of ['armL', 'armR', 'legL', 'legR'] as const) {
        const modes = new Set(clip.keys.map((key) => limbMode(key.pose[limb])));
        assert.equal(modes.size, 1, `${exercise.id}${fault ? '/' + fault : ''} ${limb}: ${[...modes].join(', ')}`);
      }
    }
  });

  it('바른 동작은 손 · 발이 기구와 바닥에 닿는다 (2cm 안)', () => {
    for (const exercise of EXERCISES) {
      const clip = motionFor(exercise)!;
      for (const frame of frames(clip)) {
        const worst = Math.max(frame.solved.miss.armL, frame.solved.miss.armR, frame.solved.miss.legL, frame.solved.miss.legR);
        assert.ok(worst <= 0.02, `${exercise.id}: 손발이 ${worst.toFixed(3)}m 못 미친다`);
      }
    }
  });

  it('실수 동작도 크게 어긋나지 않는다 (손이 쥔 바는 손을 따라간다)', () => {
    for (const { exercise, clip, fault } of allClips()) {
      if (!fault) continue;
      for (const frame of frames(clip)) {
        const worst = Math.max(frame.solved.miss.armL, frame.solved.miss.armR, frame.solved.miss.legL, frame.solved.miss.legR);
        assert.ok(worst <= 0.1, `${exercise.id}/${fault}: ${worst.toFixed(3)}m`);
      }
    }
  });

  it('몸이 바닥을 뚫지 않는다', () => {
    for (const { exercise, clip, fault } of allClips()) {
      for (const frame of frames(clip)) {
        for (const [bone, b] of Object.entries(frame.solved.bones)) {
          const low = Math.min(b.a[1], b.b[1]);
          assert.ok(low > -0.02, `${exercise.id}${fault ? '/' + fault : ''}: ${bone} ${low.toFixed(3)}`);
        }
      }
    }
  });

  it('무릎 · 팔꿈치가 반대로 꺾이거나 접혀 버리지 않는다', () => {
    for (const { exercise, clip, fault } of allClips()) {
      const name = `${exercise.id}${fault ? '/' + fault : ''}`;
      for (const frame of frames(clip)) {
        const b = frame.solved.bones;
        for (const side of ['L', 'R'] as const) {
          const knee = angle(sub(b[`thigh${side}`].b, b[`thigh${side}`].a), sub(b[`shin${side}`].b, b[`shin${side}`].a));
          const elbow = angle(sub(b[`upperArm${side}`].b, b[`upperArm${side}`].a), sub(b[`forearm${side}`].b, b[`forearm${side}`].a));
          // 실수 동작은 너무 깊이 내려가는 것 자체를 보여 주기도 한다 (레그 프레스 엉덩이 들림)
          assert.ok(knee <= (fault ? 158 : 150), `${name}: 무릎 ${knee.toFixed(0)}°`);
          // 팔꿈치는 150°쯤이 끝 — 그보다 접히면 손이 어깨에 붙은 그림이 된다
          assert.ok(elbow <= 150, `${name}: 팔꿈치 ${elbow.toFixed(0)}°`);
          // 무릎은 앞(무릎뼈 쪽)으로 굽지 않는다 — 정강이가 넓적다리 앞쪽으로 접히면 반대로 꺾인 것
          const shin = sub(b[`shin${side}`].b, b[`shin${side}`].a);
          const front = b[`thigh${side}`].f;
          if (knee > 15) assert.ok((shin[0] * front[0] + shin[1] * front[1] + shin[2] * front[2]) < 0.02, `${name}: 무릎이 반대로`);
        }
      }
    }
  });

  it('기구가 종목과 맞다 — 바벨 종목엔 바, 덤벨엔 덤벨, 케이블엔 줄, 기계엔 기계', () => {
    const barKinds = ['barbell', 'ez', 'trap', 'landmine', 'tbar', 'smith'];
    for (const exercise of EXERCISES) {
      const clip = motionFor(exercise)!;
      const held = Object.values(clip.hold ?? {});
      switch (exercise.equipment) {
        case 'barbell':
          assert.ok(clip.bar && barKinds.includes(clip.bar.kind), `${exercise.id}: 바가 없다`);
          break;
        case 'smith':
          assert.equal(clip.bar?.kind, 'smith', exercise.id);
          break;
        case 'dumbbell':
          assert.ok(held.includes('dumbbell') || clip.bar?.kind === 'dumbbell' || clip.bar?.kind === 'kettlebell', `${exercise.id}: 덤벨이 없다`);
          break;
        case 'cable':
          assert.ok((clip.cables ?? []).length > 0, `${exercise.id}: 케이블 줄이 없다`);
          break;
        case 'machine':
          assert.ok(clip.scene.length + (clip.links ?? []).length >= 3, `${exercise.id}: 기계가 없다`);
          break;
        case 'bodyweight':
          assert.ok(!held.includes('dumbbell') && !(clip.bar && barKinds.includes(clip.bar.kind)), `${exercise.id}: 맨몸인데 무게를 든다`);
          break;
        default:
      }
    }
  });

  it('한쪽씩 하는 종목은 시연하는 쪽을 밝힌다', () => {
    for (const exercise of EXERCISES.filter((item) => item.unilateral)) {
      assert.ok(motionFor(exercise)!.side, `${exercise.id}: 어느 쪽인지 없다`);
    }
  });

  it('힘쓰는 구간과 화면 범위가 말이 된다', () => {
    for (const exercise of EXERCISES) {
      const clip = motionFor(exercise)!;
      assert.ok(clip.work[0] >= 0 && clip.work[1] <= 1, exercise.id);
      const bounds = clipBounds(clip);
      assert.ok(bounds.min[1] <= 0 && bounds.max[1] - bounds.min[1] > 0.4, `${exercise.id}: 범위`);
      for (let i = 0; i <= 10; i += 1) {
        const effort = effortAt(clip, i / 10);
        assert.ok(effort >= 0.3 - 1e-9 && effort <= 1 + 1e-9);
      }
      const mid = (clip.work[0] + clip.work[1]) / 2;
      assert.ok(effortAt(clip, mid) > 0.9, `${exercise.id}: 힘쓰는 구간 가운데가 밝지 않다`);
    }
  });
});

describe('흔한 실수를 동작으로', () => {
  it('보여 주는 실수는 그 종목의 실수 목록에 있는 것만', () => {
    for (const exercise of EXERCISES) {
      const known = mistakesFor(exercise).map((item) => item.id);
      for (const fault of faultsFor(exercise)) assert.ok(known.includes(fault), `${exercise.id}: ${fault}`);
    }
  });

  it('실수 동작은 바른 동작과 실제로 다르다', () => {
    for (const exercise of EXERCISES) {
      const good = motionFor(exercise)!;
      for (const fault of faultsFor(exercise)) {
        const bad = motionFor(exercise, fault)!;
        assert.equal(bad.fault, fault);
        let diff = 0;
        for (let i = 0; i <= 24; i += 1) {
          const a = clipFrame(good, i / 24).solved.bones;
          const b = clipFrame(bad, i / 24).solved.bones;
          for (const name of Object.keys(a) as (keyof typeof a)[]) diff = Math.max(diff, len(sub(a[name].b, b[name].b)));
        }
        assert.ok(diff > 0.03, `${exercise.id}/${fault}: 바른 동작과 거의 같다 (${diff.toFixed(3)})`);
        assert.ok(bad.keys.some((key) => key.label), `${exercise.id}/${fault}: 무엇이 틀렸는지 말이 없다`);
      }
    }
  });

  it('그 종목이 못 보여 주는 실수는 없다고 답한다', () => {
    assert.equal(motionFor(ex('back-squat'), 'elbow-flare'), null);
    assert.equal(motionFor({ id: 'no-such-exercise' }), null);
  });
});

describe('종목별 동작이 그 종목답다', () => {
  it('레터럴 레이즈 — 팔이 옆으로 어깨 높이까지', () => {
    const top = clipFrame(clipOf('lateral-raise'), 0.42).solved;
    const shoulder = top.bones.upperArmL.a;
    const hand = top.hands.L.grip;
    assert.ok(Math.abs(hand[1] - shoulder[1]) < 0.12, '손이 어깨 높이가 아니다');
    assert.ok(hand[0] - shoulder[0] > 0.45, '옆으로 뻗지 않았다');
  });

  it('프론트 레이즈 — 팔이 앞으로', () => {
    const top = clipFrame(clipOf('front-raise'), 0.42).solved;
    assert.ok(top.hands.L.grip[2] - top.bones.upperArmL.a[2] > 0.45);
  });

  it('레그 익스텐션 — 무릎을 펴서 발이 올라온다 (예전엔 팔을 굽혔다)', () => {
    const clip = clipOf('leg-extension');
    const low = clipFrame(clip, 0).solved.bones.shinL.b;
    const high = clipFrame(clip, 0.42).solved.bones.shinL.b;
    assert.ok(high[1] - low[1] > 0.25);
    const hands = clipFrame(clip, 0.42).solved.hands.L.grip;
    assert.ok(Math.abs(hands[1] - clipFrame(clip, 0).solved.hands.L.grip[1]) < 0.01, '팔은 움직이지 않는다');
  });

  it('레그 컬 — 발이 엉덩이 쪽으로', () => {
    const clip = clipOf('lying-leg-curl');
    const heel0 = clipFrame(clip, 0).solved.bones.shinL.b;
    const heel1 = clipFrame(clip, 0.42).solved.bones.shinL.b;
    assert.ok(heel1[1] - heel0[1] > 0.3);
  });

  it('바벨 컬 — 바가 허벅지 앞에서 가슴 높이로', () => {
    const clip = clipOf('barbell-curl');
    const low = clipFrame(clip, 0).solved.bar!.c;
    const high = clipFrame(clip, 0.42).solved.bar!.c;
    assert.ok(high[1] - low[1] > 0.35);
  });

  it('벤치프레스 — 바가 가슴에 닿았다가 어깨 위로', () => {
    const clip = clipOf('barbell-bench-press');
    const chest = clipFrame(clip, 0.45).solved;
    const top = clipFrame(clip, 0).solved;
    assert.ok(top.bar!.c[1] - chest.bar!.c[1] > 0.3);
    const front = chest.bones.chest;
    assert.ok(chest.bar!.c[1] - Math.max(front.a[1], front.b[1]) < 0.25, '가슴까지 내려오지 않았다');
  });

  it('데드리프트 — 바닥에서 시작하고, 바는 거의 곧게 오른다', () => {
    const clip = clipOf('conventional-deadlift');
    const bars = frames(clip).map((frame) => frame.solved.bar!.c);
    assert.ok(Math.abs(bars[0]![1] - 0.225) < 0.01, '바닥에서 시작하지 않는다');
    const zs = bars.map((bar) => bar[2]);
    assert.ok(Math.max(...zs) - Math.min(...zs) < 0.12, '바가 앞뒤로 크게 흔들린다');
  });

  it('스쿼트 — 골반이 충분히 내려가고, 무릎은 발끝 쪽으로', () => {
    const clip = clipOf('back-squat');
    const top = clipFrame(clip, 0).solved;
    const low = clipFrame(clip, 0.45).solved;
    assert.ok(top.bones.pelvis.a[1] - low.bones.pelvis.a[1] > 0.35);
    // 무릎이 안으로 모이는 실수에서는 무릎이 더 가운데로
    const caved = clipFrame(clipOf('back-squat', 'knee-cave'), 0.45).solved;
    assert.ok(caved.bones.shinL.a[0] < low.bones.shinL.a[0] - 0.04);
  });

  it('풀업 — 몸이 올라가고 손은 철봉에 그대로', () => {
    const clip = clipOf('pull-up');
    const hang = clipFrame(clip, 0).solved;
    const top = clipFrame(clip, 0.42).solved;
    assert.ok(top.bones.pelvis.a[1] - hang.bones.pelvis.a[1] > 0.3);
    assert.ok(len(sub(top.hands.L.grip, hang.hands.L.grip)) < 0.01);
  });

  it('플랭크 — 버티기라 거의 움직이지 않는다', () => {
    const clip = clipOf('plank');
    const a = clipFrame(clip, 0).solved.bones.pelvis.a;
    const b = clipFrame(clip, 0.5).solved.bones.pelvis.a;
    assert.ok(len(sub(a, b)) < 0.02);
  });

  it('파머스 워크 — 디딘 발이 바닥과 같은 빠르기로 뒤로 간다 (미끄러지지 않는다)', () => {
    const clip = clipOf('farmers-walk');
    assert.ok(clip.walk && clip.walk > 0);
    // 왼발은 앞 반 주기 동안 딛고 있다 — 발끝이 바닥에 붙은 채 바닥과 같이 흐른다
    const toe = (t: number) => clipFrame(clip, t).solved.bones.footL.b;
    for (const t of [0, 0.1, 0.25, 0.4, 0.5]) {
      assert.ok(Math.abs(toe(t)[1]) < 0.01, `발끝이 떴다 (t=${t})`);
      assert.ok(Math.abs(toe(0)[2] - toe(t)[2] - clip.walk * t) < 0.02, `발이 미끄러진다 (t=${t})`);
    }
    assert.equal(clipPose(clip, 0.25).pose.legR!.ankle![1] > 0.1, true, '다른 발은 들고 앞으로');
  });

  it('원암 덤벨 로우 — 오른손만 움직이고 왼손은 벤치에', () => {
    const clip = clipOf('one-arm-dumbbell-row');
    const a = clipFrame(clip, 0).solved.hands;
    const b = clipFrame(clip, 0.42).solved.hands;
    assert.ok(len(sub(a.L.grip, b.L.grip)) < 0.01);
    assert.ok(b.R.grip[1] - a.R.grip[1] > 0.25);
  });

  it('같은 시점이면 같은 그림 — 매 프레임 같은 값을 내고, 한 바퀴 돌면 처음으로', () => {
    const clip = clipOf('kettlebell-swing');
    assert.deepEqual(clipFrame(clip, 0.37), clipFrame(clip, 0.37));
    const once = clipFrame(clip, 0.37).solved.bones.head;
    const again = clipFrame(clip, 1.37).solved.bones.head;
    assert.ok(len(sub(once.a, again.a)) < 1e-9 && len(sub(once.b, again.b)) < 1e-9);
  });
});

describe('3D 시연 검토 반영 — 렌더러 약속', () => {
  it("케이블은 발목 스트랩(footL · footR)에도 걸린다 — 줄 끝이 그 발의 발목", () => {
    const base = clipOf('machine-glute-kickback');
    const from: Vec3 = [0, 0.1, 0.7];
    const clip: Clip = { ...base, cables: [{ from, to: 'footR' }] };
    for (const t of [0, 0.42]) {
      const frame = clipFrame(clip, t);
      const line = frame.moving.find((item) => item.kind === 'cableLine')!;
      const end: Vec3 = [line.p[0] + line.x[0] * line.size[1]! / 2, line.p[1] + line.x[1] * line.size[1]! / 2, line.p[2] + line.x[2] * line.size[1]! / 2];
      const ankle = frame.solved.bones.shinR.b;
      assert.ok(len(sub(end, ankle)) < 0.04, `t=${t}: 줄 끝이 발목에서 ${len(sub(end, ankle)).toFixed(3)}m`);
      const start: Vec3 = [line.p[0] - line.x[0] * line.size[1]! / 2, line.p[1] - line.x[1] * line.size[1]! / 2, line.p[2] - line.x[2] * line.size[1]! / 2];
      assert.ok(len(sub(start, from)) < 1e-6, '줄은 도르래에서 시작');
    }
  });

  it('힙 어브덕션 · 어덕션은 엔진 근육에 없는 중둔근 · 내전근을 밝힌다', () => {
    assert.deepEqual(clipOf('machine-hip-abduction').highlight, { gluteMed: 1 });
    assert.deepEqual(clipOf('machine-hip-adduction').highlight, { adductors: 1 });
  });
});

describe('3D 시연 검토 반영 — 몸 · 기구가 서로 뚫지 않는다', () => {
  const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const lerp = (a: Vec3, b: Vec3, u: number): Vec3 => [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];
  /** 점에서 선분까지 거리 */
  const segDist = (p: Vec3, a: Vec3, b: Vec3) => {
    const ab = sub(b, a);
    const u = Math.max(0, Math.min(1, dot(sub(p, a), ab) / dot(ab, ab)));
    return len(sub(p, lerp(a, b, u)));
  };

  it('시티드 케이블 로우 — 당긴 손잡이가 몸통 속이 아니라 배꼽 앞에 있다 (실수 동작 포함)', () => {
    for (const fault of [undefined, 'rocking', 'shoulders-up', 'arms']) {
      const frame = clipFrame(clipOf('seated-cable-row', fault), 0.44);
      const b = frame.solved.bones;
      const grip = lerp(frame.solved.hands.L.grip, frame.solved.hands.R.grip, 0.5);
      // 몸통 반지름은 앞뒤로 12cm 안팎 — 그보다 넉넉히 떨어져야 손이 몸 밖이다
      assert.ok(segDist(grip, b.chest.a, b.chest.b) > 0.2, `${fault ?? '바른 동작'}: 손잡이가 가슴 축에서 ${segDist(grip, b.chest.a, b.chest.b).toFixed(3)}m`);
      assert.ok(segDist(grip, b.lumbar.a, b.lumbar.b) > 0.2, `${fault ?? '바른 동작'}: 손잡이가 배 축에서 ${segDist(grip, b.lumbar.a, b.lumbar.b).toFixed(3)}m`);
      assert.ok(dot(sub(grip, b.chest.a), b.chest.f) > 0.2, '손잡이는 몸 앞');
    }
  });

  it('프론트 스쿼트 — 팔꿈치는 목 아래, 어깨보다 15cm 넘게 앞 (팔뚝이 얼굴을 가리지 않는다)', () => {
    const clip = clipOf('front-squat');
    for (const t of [0, 0.45]) {
      const b = clipFrame(clip, t).solved.bones;
      for (const side of ['L', 'R'] as const) {
        const elbow = b[`forearm${side}`].a;
        assert.ok(elbow[1] < b.neck.a[1], `t=${t} ${side}: 팔꿈치가 목보다 위`);
        assert.ok(dot(sub(elbow, b[`upperArm${side}`].a), b.chest.f) > 0.15, `t=${t} ${side}: 팔꿈치가 앞으로 나오지 않았다`);
      }
    }
  });

  it('레그 프레스 — 가장 깊은 곳에서도 넓적다리가 가슴을 뚫지 않는다 (22cm 이상)', () => {
    const clip = clipOf('leg-press');
    for (let i = 0; i <= 20; i += 1) {
      const t = 0.4 + (0.2 * i) / 20;
      const b = clipFrame(clip, t).solved.bones;
      for (const side of ['L', 'R'] as const) {
        const thigh = b[`thigh${side}`];
        for (let k = 0; k <= 12; k += 1) {
          const p = lerp(thigh.a, thigh.b, 0.4 + (0.6 * k) / 12);
          const gap = segDist(p, b.chest.a, b.chest.b);
          assert.ok(gap >= 0.22, `t=${t.toFixed(2)} ${side}: 넓적다리가 가슴 축에서 ${gap.toFixed(3)}m`);
        }
      }
    }
  });

  it('스컬 크러셔 — 바가 머리 속으로 들어가지 않는다 (머리 가운데에서 14cm 이상)', () => {
    for (const fault of [undefined, 'elbow-flare', 'drop']) {
      const clip = clipOf('skull-crusher', fault);
      for (const frame of frames(clip)) {
        const head = frame.solved.bones.head;
        // 렌더러의 머리 공 가운데 — 머리뼈 시작에서 8.8cm (반지름 11cm 안팎)
        const center = lerp(head.a, head.b, 0.088 / len(sub(head.b, head.a)));
        const bar = frame.moving.find((item) => item.kind === 'ez')!;
        assert.ok(len(sub(bar.p, center)) >= 0.14, `${fault ?? '바른 동작'}: 바가 머리 가운데에서 ${len(sub(bar.p, center)).toFixed(3)}m`);
      }
    }
  });

  it('덤벨 오버헤드 익스텐션 — 내린 곳에서 위팔은 거의 수직 (25° 안)', () => {
    const b = clipFrame(clipOf('dumbbell-overhead-extension'), 0).solved.bones;
    for (const side of ['L', 'R'] as const) {
      const upper = sub(b[`upperArm${side}`].b, b[`upperArm${side}`].a);
      assert.ok(angle(upper, [0, 1, 0]) < 25, `${side}: 위팔이 수직에서 ${angle(upper, [0, 1, 0]).toFixed(0)}°`);
    }
  });

  it('발이 기구 바닥판 · 스텝 · 패드에 묻히지 않는다 (1.5cm 넘게)', () => {
    for (const exercise of EXERCISES) {
      const clip = motionFor(exercise)!;
      // 돌리지 않은 상자 조각만 (기울인 등판 등은 x · y 축이 따로 있다)
      const boxes = clip.scene.filter((prim) => ['frame', 'box', 'pad'].includes(prim.kind) && !prim.x && !prim.y);
      for (let i = 0; i < 8; i += 1) {
        const b = clipFrame(clip, i / 8).solved.bones;
        for (const side of ['L', 'R'] as const) {
          const foot = b[`foot${side}`];
          for (const [name, p] of [['뒤꿈치', foot.a], ['발끝', foot.b], ['발 가운데', lerp(foot.a, foot.b, 0.5)]] as const) {
            for (const prim of boxes) {
              const inside = [0, 1, 2].every((k) => Math.abs(p[k]! - prim.p[k]!) < prim.size[k]! / 2);
              const depth = prim.p[1] + prim.size[1]! / 2 - p[1];
              assert.ok(!inside || depth <= 0.015, `${exercise.id} t=${i / 8} ${side} ${name}: ${prim.kind}에 ${depth.toFixed(3)}m 묻힘`);
            }
          }
        }
      }
    }
  });

  it('레그 프레스 카프 레이즈 — 발목만 움직이고 무릎 각은 거의 그대로 (6° 안)', () => {
    for (const fault of [undefined, 'short-range', 'bounce']) {
      const clip = clipOf('leg-press-calf-raise', fault);
      for (const side of ['L', 'R'] as const) {
        const knees = frames(clip).map((frame) => {
          const b = frame.solved.bones;
          return angle(sub(b[`thigh${side}`].b, b[`thigh${side}`].a), sub(b[`shin${side}`].b, b[`shin${side}`].a));
        });
        const spread = Math.max(...knees) - Math.min(...knees);
        assert.ok(spread < 6, `${fault ?? '바른 동작'} ${side}: 무릎 각이 ${spread.toFixed(1)}° 바뀐다`);
      }
    }
  });
});

describe('3D 검증에서 남은 것 — 기구가 몸을 뚫지 않는다', () => {
  const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const lerp = (a: Vec3, b: Vec3, u: number): Vec3 => [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];
  const segDist = (p: Vec3, a: Vec3, b: Vec3) => {
    const ab = sub(b, a);
    const u = Math.max(0, Math.min(1, dot(sub(p, a), ab) / dot(ab, ab)));
    return len(sub(p, lerp(a, b, u)));
  };
  /** 두 선분 사이 가장 가까운 거리 (한쪽을 촘촘히 짚어서) */
  const segSegDist = (a: Vec3, b: Vec3, c: Vec3, d: Vec3) => {
    let best = Infinity;
    for (let k = 0; k <= 40; k += 1) best = Math.min(best, segDist(lerp(a, b, k / 40), c, d));
    return best;
  };
  /** 덤벨 원판 두 개의 가운데 — 손잡이 가운데에서 축을 따라 10.5cm */
  const dumbbellHeads = (item: { p: Vec3; x: Vec3 }): Vec3[] => [1, -1].map((s) => [item.p[0] + item.x[0] * 0.105 * s, item.p[1] + item.x[1] * 0.105 * s, item.p[2] + item.x[2] * 0.105 * s] as Vec3);
  const dense = (clip: Clip) => Array.from({ length: 97 }, (_, i) => ({ t: i / 96, frame: clipFrame(clip, i / 96) }));

  it('밴드 풀 어파트 — 다 벌린 곳에서도 밴드가 가슴 앞을 지난다 (가슴 축에서 15cm 이상)', () => {
    for (const clip of [clipOf('band-pull-apart'), stretchMotionFor('band-pull-apart')!]) {
      for (const { t, frame } of dense(clip)) {
        const b = frame.solved.bones;
        const gap = segSegDist(frame.solved.hands.L.grip, frame.solved.hands.R.grip, b.chest.a, b.chest.b);
        assert.ok(gap >= 0.15, `t=${t.toFixed(2)}: 밴드가 가슴 축에서 ${gap.toFixed(3)}m`);
      }
    }
  });

  it('덤벨 오버헤드 익스텐션 — 오가는 내내 덤벨 아래 원판이 머리 밖 (머리 가운데에서 16cm 이상, 실수 동작 포함)', () => {
    for (const fault of [undefined, ...faultsFor(ex('dumbbell-overhead-extension'))]) {
      for (const { t, frame } of dense(clipOf('dumbbell-overhead-extension', fault))) {
        const head = frame.solved.bones.head;
        const center = lerp(head.a, head.b, 0.088 / len(sub(head.b, head.a)));
        const db = frame.moving.find((item) => item.kind === 'dumbbell')!;
        const gap = Math.min(...dumbbellHeads(db).map((p) => len(sub(p, center))));
        assert.ok(gap >= 0.16, `${fault ?? '바른 동작'} t=${t.toFixed(2)}: 원판이 머리 가운데에서 ${gap.toFixed(3)}m`);
      }
    }
  });

  it('덤벨 플라이 — 벌린 곳에서 손잡이는 머리-발 방향으로 눕고, 원판은 벤치보다 높다', () => {
    const open = clipFrame(clipOf('dumbbell-fly'), 0.45);
    for (const db of open.moving.filter((item) => item.kind === 'dumbbell')) {
      assert.ok(Math.abs(db.x[1]) < 0.3, `손잡이가 세로로 섰다 (axis.y ${db.x[1].toFixed(2)})`);
    }
    for (const { t, frame } of dense(clipOf('dumbbell-fly'))) {
      for (const db of frame.moving.filter((item) => item.kind === 'dumbbell')) {
        for (const p of dumbbellHeads(db)) assert.ok(p[1] > 0.5, `t=${t.toFixed(2)}: 원판이 ${p[1].toFixed(3)}m — 벤치 밑으로`);
      }
    }
    // 너무 깊이 내리는 실수는 눈에 띄게 더 아래로
    const deep = clipFrame(clipOf('dumbbell-fly', 'too-deep'), 0.45);
    assert.ok(deep.solved.hands.L.grip[1] < open.solved.hands.L.grip[1] - 0.15, '너무 깊이 내림이 바른 동작과 구별되지 않는다');
  });

  it('머신 크런치 — 회전 팔이 달린 쪽의 반대편에서 본다 (팔이 얼굴 앞을 가로지르지 않게)', () => {
    const clip = clipOf('machine-crunch');
    const pivotX = clip.links!.find((link) => link.pivot)!.pivot![0];
    // view 수평 각 +는 왼쪽(+x)에서 보는 것
    assert.ok(Math.sign(clip.view[0]) !== Math.sign(pivotX), `회전 팔(x=${pivotX})과 같은 쪽(${clip.view[0]}°)에서 본다`);
  });

  it('덤벨이 넓적다리에 묻히지 않는다 (원판 가운데가 넓적다리 축에서 12.5cm 이상, 실수 동작 포함)', () => {
    // 덤벨을 드는 모든 종목. 힙 스러스트만 뺀다 — 덤벨을 골반 위에 얹는 게 바른 자세다
    const holdsDumbbell = (id: string) => [0, 0.25, 0.5].some((t) => clipFrame(clipOf(id), t).moving.some((item) => item.kind === 'dumbbell'));
    const ids = EXERCISES.map((item) => item.id).filter((id) => id !== 'dumbbell-hip-thrust' && holdsDumbbell(id));
    // 다시 묻힌 적이 있는 것들은 꼭 들어 있어야 한다
    for (const id of ['incline-dumbbell-curl', 'triceps-kickback', 'dumbbell-bent-over-row', 'bulgarian-split-squat', 'hammer-curl', 'step-up', 'walking-lunge', 'farmers-walk', 'dumbbell-romanian-deadlift', 'dumbbell-sumo-squat', 'front-raise']) {
      assert.ok(ids.includes(id), `${id}가 덤벨 종목 목록에 없다`);
    }
    for (const id of ids) {
      for (const fault of [undefined, ...faultsFor(ex(id))]) {
        for (const { t, frame } of dense(clipOf(id, fault))) {
          const b = frame.solved.bones;
          for (const db of frame.moving.filter((item) => item.kind === 'dumbbell')) {
            for (const p of dumbbellHeads(db)) {
              for (const side of ['L', 'R'] as const) {
                const gap = segDist(p, b[`thigh${side}`].a, b[`thigh${side}`].b);
                assert.ok(gap >= 0.125, `${id} ${fault ?? '바른 동작'} t=${t.toFixed(2)}: 원판이 넓적다리(${side}) 축에서 ${gap.toFixed(3)}m`);
              }
            }
          }
        }
      }
    }
  });

  it('밴드 레터럴 레이즈 — 발밑에서 손까지 가는 밴드가 정강이를 지나지 않는다', () => {
    for (const fault of [undefined, ...faultsFor(ex('band-lateral-raise'))]) {
      for (const { t, frame } of dense(clipOf('band-lateral-raise', fault))) {
        const b = frame.solved.bones;
        for (const band of frame.moving.filter((item) => item.kind === 'cableLine')) {
          const half = band.size[1]! / 2;
          const a: Vec3 = [band.p[0] - band.x[0] * half, band.p[1] - band.x[1] * half, band.p[2] - band.x[2] * half];
          const z: Vec3 = [band.p[0] + band.x[0] * half, band.p[1] + band.x[1] * half, band.p[2] + band.x[2] * half];
          for (const side of ['L', 'R'] as const) {
            const gap = segSegDist(a, z, b[`shin${side}`].a, b[`shin${side}`].b);
            assert.ok(gap >= 0.048, `${fault ?? '바른 동작'} t=${t.toFixed(2)}: 밴드가 정강이(${side}) 축에서 ${gap.toFixed(3)}m`);
          }
        }
      }
    }
  });
});
