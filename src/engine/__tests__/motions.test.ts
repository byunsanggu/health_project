import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { EXERCISES, exerciseById } from '../exercises.ts';
import { mistakesFor } from '../mistakes.ts';
import { clipBounds, clipFrame, clipPose, effortAt, type Clip } from '../motionKit.ts';
import { faultsFor, motionFor, motionIds } from '../motions.ts';
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
