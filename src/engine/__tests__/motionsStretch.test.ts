import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { clipBounds, clipFrame, effortAt, type Clip, type Prim } from '../motionKit.ts';
import { mirrorClip, stretchMotionFor, stretchMotionIds, stretchStyle } from '../motionsStretch.ts';
import { COOLDOWN_STEPS, MOBILITY_STEPS } from '../ptSession.ts';
import type { ArmSpec, BoneName, LegSpec, Solved, Vec3 } from '../rig.ts';

const SAMPLES = 48;
const STEPS = [...MOBILITY_STEPS, ...COOLDOWN_STEPS];

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const angle = (a: Vec3, b: Vec3) => (Math.acos(Math.max(-1, Math.min(1, dot(a, b) / (len(a) * len(b))))) * 180) / Math.PI;
const mirror = (v: Vec3): Vec3 => [-v[0], v[1], v[2]];

const clipOf = (id: string, side: 'L' | 'R' = 'L') => stretchMotionFor(id, side) as Clip;
const frames = (clip: Clip) => Array.from({ length: SAMPLES + 1 }, (_, i) => clipFrame(clip, i / SAMPLES));
const at = (id: string, t: number, side: 'L' | 'R' = 'L'): Solved => clipFrame(clipOf(id, side), t).solved;

/** 모든 시연 — 한쪽씩 하는 동작은 양쪽 다 */
function allClips(): { name: string; clip: Clip }[] {
  const out: { name: string; clip: Clip }[] = [];
  for (const step of STEPS) {
    out.push({ name: step.id, clip: clipOf(step.id) });
    if (step.sides) out.push({ name: `${step.id}/R`, clip: clipOf(step.id, 'R') });
  }
  return out;
}

const limbMode = (spec: ArmSpec | LegSpec | undefined): string => {
  if (!spec) return 'none';
  if ('fk' in spec && spec.fk) return 'fk';
  if ('bar' in spec && spec.bar !== undefined) return 'bar';
  return 'ik';
};

/** 한 주기 동안 뼈 끝이 가장 멀리 움직인 거리 */
function maxTravel(clip: Clip): number {
  const all = frames(clip);
  const first = all[0]!.solved.bones;
  let most = 0;
  for (const frame of all) {
    for (const [name, bone] of Object.entries(frame.solved.bones)) {
      const start = first[name as BoneName];
      most = Math.max(most, len(sub(bone.a, start.a)), len(sub(bone.b, start.b)));
    }
  }
  return most;
}

/** 선분 ab와 점 p 사이 거리 */
function segmentDistance(p: Vec3, a: Vec3, b: Vec3): number {
  const ab = sub(b, a);
  const u = Math.max(0, Math.min(1, dot(sub(p, a), ab) / Math.max(1e-12, dot(ab, ab))));
  return len(sub(p, [a[0] + ab[0] * u, a[1] + ab[1] * u, a[2] + ab[2] * u]));
}

/** 두 선분 사이 (가까운) 거리 — 잘게 나눠 잰다 */
function segmentsDistance(a0: Vec3, a1: Vec3, b0: Vec3, b1: Vec3): number {
  let best = Infinity;
  for (let i = 0; i <= 20; i += 1) {
    const u = i / 20;
    best = Math.min(best, segmentDistance([a0[0] + (a1[0] - a0[0]) * u, a0[1] + (a1[1] - a0[1]) * u, a0[2] + (a1[2] - a0[2]) * u], b0, b1));
  }
  return best;
}

/** 벽 — 한 수평 방향으로 넓은 세운 판 */
function walls(clip: Clip): Prim[] {
  return clip.scene.filter((prim) => prim.kind === 'post' && Math.max(prim.size[0]!, prim.size[2]!) > 0.5);
}

describe('stretchMotionFor — 몸 풀기 · 마무리 스트레칭 동작마다 시연', () => {
  it('몸 풀기 · 마무리 스트레칭(호흡 포함)의 모든 동작에 시연이 있다', () => {
    const ids = new Set(stretchMotionIds());
    for (const step of STEPS) {
      assert.ok(ids.has(step.id), `${step.id}: 시연이 없다`);
      assert.equal(clipOf(step.id).id, step.id);
    }
    assert.equal(ids.size, STEPS.length, '없는 동작의 시연이 있다');
    assert.ok(stretchMotionFor('breath'), '호흡 정리도 시연이 있다');
    assert.equal(stretchMotionFor('no-such-step'), null);
    assert.equal(stretchStyle('no-such-step'), null);
  });

  it('키 자세는 0에서 시작해 1에서 끝나고, 처음과 끝이 같아 이어 돌려도 튀지 않는다', () => {
    for (const { name, clip } of allClips()) {
      assert.equal(clip.keys[0]!.t, 0, `${name}: 0에서 시작하지 않는다`);
      assert.equal(clip.keys[clip.keys.length - 1]!.t, 1, `${name}: 1에서 끝나지 않는다`);
      for (let i = 1; i < clip.keys.length; i += 1) assert.ok(clip.keys[i]!.t > clip.keys[i - 1]!.t, `${name}: 키 순서가 뒤집혔다`);
      assert.deepEqual(clip.keys[0]!.pose, clip.keys[clip.keys.length - 1]!.pose, `${name}: 처음과 끝 자세가 다르다`);
      assert.ok(clip.cycle >= 1 && clip.cycle <= 10, `${name}: 한 번 ${clip.cycle}초`);
      assert.ok(clip.keys[0]!.label, `${name}: 첫 구간 말이 없다`);
      assert.equal(clip.keys[clip.keys.length - 1]!.label, undefined, `${name}: 끝 키에 붙은 말은 보이지 않는다`);
      for (const key of clip.keys) if (key.label) assert.ok(/[가-힣]/.test(key.label) && key.label.length <= 22, `${name}: "${key.label}"`);
    }
  });

  it('한 동작 안에서 팔다리를 움직이는 방식(각도 · 닿을 곳)이 바뀌지 않는다', () => {
    for (const { name, clip } of allClips()) {
      for (const limb of ['armL', 'armR', 'legL', 'legR'] as const) {
        const modes = new Set(clip.keys.map((key) => limbMode(key.pose[limb])));
        assert.equal(modes.size, 1, `${name} ${limb}: ${[...modes].join(', ')}`);
      }
    }
  });

  it('모든 순간이 풀린다 — 숫자가 깨지지 않고, 손발이 닿을 곳에 닿는다 (2cm 안)', () => {
    for (const { name, clip } of allClips()) {
      for (const [i, frame] of frames(clip).entries()) {
        for (const [bone, b] of Object.entries(frame.solved.bones)) {
          for (const v of [b.a, b.b, b.f]) assert.ok(v.every(Number.isFinite), `${name} t=${i / SAMPLES}: ${bone}`);
        }
        const { armL, armR, legL, legR } = frame.solved.miss;
        const worst = Math.max(armL, armR, legL, legR);
        assert.ok(worst <= 0.02, `${name} t=${(i / SAMPLES).toFixed(2)}: 손발이 ${worst.toFixed(3)}m 못 미친다`);
      }
    }
  });

  it('몸이 바닥을 뚫지 않는다', () => {
    for (const { name, clip } of allClips()) {
      for (const frame of frames(clip)) {
        for (const [bone, b] of Object.entries(frame.solved.bones)) {
          const low = Math.min(b.a[1], b.b[1]);
          assert.ok(low > -0.02, `${name}: ${bone} ${low.toFixed(3)}`);
        }
      }
    }
  });

  it('무릎 · 팔꿈치가 반대로 꺾이거나 접혀 버리지 않는다', () => {
    for (const { name, clip } of allClips()) {
      for (const frame of frames(clip)) {
        const b = frame.solved.bones;
        for (const side of ['L', 'R'] as const) {
          const knee = angle(sub(b[`thigh${side}`].b, b[`thigh${side}`].a), sub(b[`shin${side}`].b, b[`shin${side}`].a));
          const elbow = angle(sub(b[`upperArm${side}`].b, b[`upperArm${side}`].a), sub(b[`forearm${side}`].b, b[`forearm${side}`].a));
          assert.ok(knee <= 150, `${name}: 무릎 ${knee.toFixed(0)}°`);
          assert.ok(elbow <= 150, `${name}: 팔꿈치 ${elbow.toFixed(0)}°`);
          if (knee > 15) assert.ok(dot(sub(b[`shin${side}`].b, b[`shin${side}`].a), b[`thigh${side}`].f) < 0.02, `${name}: 무릎이 반대로`);
        }
      }
    }
  });

  it('바닥을 짚은 손은 바닥에, 디딘 발은 바닥(이나 기구 윗면)에 붙어 있다', () => {
    for (const { name, clip } of allClips()) {
      const tops = [0, ...clip.scene.map((prim) => prim.p[1] + prim.size[1]! / 2)];
      // 한 동작 내내 같은 자리를 짚고 디딘 손발만 본다
      const planted = <K extends 'armL' | 'armR' | 'legL' | 'legR'>(limb: K) => {
        const first = clip.keys[0]!.pose[limb];
        return clip.keys.every((key) => JSON.stringify(key.pose[limb]) === JSON.stringify(first)) ? first : undefined;
      };
      for (const frame of frames(clip)) {
        for (const side of ['L', 'R'] as const) {
          const arm = planted(`arm${side}`) as ArmSpec | undefined;
          if (arm?.point && arm.ik && !arm.in && arm.ik[1] < 0.05) {
            const grip = frame.solved.hands[side].grip;
            assert.ok(Math.abs(grip[1] - arm.ik[1]) < 0.01, `${name}: ${side}손이 바닥에서 떴다 (${grip[1].toFixed(3)})`);
          }
          const leg = planted(`leg${side}`) as LegSpec | undefined;
          // 발판 · 페달이 따라 움직이는 동작(기구 조각이 발에 붙은 것)은 빼고
          if (leg?.ground && leg.ground[1] > 0.99 && !clip.links) {
            const foot = frame.solved.bones[`foot${side}`];
            const sole = foot.b[1];
            assert.ok(tops.some((top) => Math.abs(sole - top) < 0.015), `${name}: ${side}발이 바닥에 닿지 않는다 (${sole.toFixed(3)})`);
          }
        }
      }
    }
  });

  it('벽을 짚은 손은 벽면에 닿고, 몸은 벽을 뚫지 않는다', () => {
    for (const { name, clip } of allClips()) {
      for (const wall of walls(clip)) {
        const axis = wall.size[0]! < wall.size[2]! ? 0 : 2;
        const side = Math.sign(-wall.p[axis]!) || -1;
        const face = wall.p[axis]! + side * (wall.size[axis]! / 2);
        let touching = 0;
        for (const frame of frames(clip)) {
          for (const [bone, b] of Object.entries(frame.solved.bones)) {
            for (const p of [b.a, b.b]) assert.ok((p[axis]! - face) * side > -0.01, `${name}: ${bone}가 벽을 뚫었다`);
          }
          for (const hand of ['L', 'R'] as const) {
            if (Math.abs(frame.solved.hands[hand].grip[axis]! - face) < 0.035) touching += 1;
          }
        }
        assert.ok(touching >= SAMPLES, `${name}: 벽을 짚은 손이 없다`);
      }
    }
  });

  it('힘쓰는 구간과 화면 범위가 말이 된다', () => {
    for (const { name, clip } of allClips()) {
      assert.ok(clip.work[0] >= 0 && clip.work[1] <= 1, name);
      const mid = (clip.work[0] + clip.work[1]) / 2;
      assert.ok(effortAt(clip, mid) > 0.9, `${name}: 힘쓰는 구간 가운데가 밝지 않다`);
      const bounds = clipBounds(clip);
      assert.ok(bounds.min[1] <= 0 && bounds.max[1] - bounds.min[1] > 0.4, `${name}: 범위`);
      assert.ok(clip.view[1] >= 0 && clip.view[1] <= 60, `${name}: 위에서 내려다보는 각 ${clip.view[1]}`);
    }
  });
});

describe('버티는 스트레칭과 움직이는 동작', () => {
  it('마무리 스트레칭은 버티기, 몸 풀기는 움직이는 동작이다 (호흡은 숨에 맞춰 움직인다)', () => {
    for (const step of MOBILITY_STEPS) assert.equal(stretchStyle(step.id), 'move', step.id);
    for (const step of COOLDOWN_STEPS) assert.equal(stretchStyle(step.id), step.id === 'breath' ? 'move' : 'hold', step.id);
  });

  it('버티는 스트레칭은 늘린 자세에서 숨 쉬듯 조금만 움직인다 (5cm 안)', () => {
    for (const step of COOLDOWN_STEPS.filter((item) => stretchStyle(item.id) === 'hold')) {
      const travel = maxTravel(clipOf(step.id));
      assert.ok(travel < 0.05, `${step.id}: ${travel.toFixed(3)}m — 버티기인데 크게 움직인다`);
      assert.ok(travel > 0.005, `${step.id}: 숨 쉬는 움직임도 없다`);
    }
  });

  it('움직이는 동작은 눈에 띄게 움직인다 (10cm 넘게)', () => {
    for (const step of STEPS.filter((item) => stretchStyle(item.id) === 'move')) {
      const travel = maxTravel(clipOf(step.id));
      assert.ok(travel > 0.1, `${step.id}: ${travel.toFixed(3)}m밖에 안 움직인다`);
    }
  });
});

describe('한쪽씩 하는 동작 — 반대쪽은 좌우를 뒤집은 그림', () => {
  const swapName = (name: string) => (name.endsWith('L') ? name.slice(0, -1) + 'R' : name.endsWith('R') ? name.slice(0, -1) + 'L' : name) as BoneName;

  it('한쪽씩 하는 동작은 왼쪽을 보여 주고, 오른쪽을 달라면 오른쪽을 준다', () => {
    for (const step of STEPS) {
      const left = clipOf(step.id, 'L');
      const right = clipOf(step.id, 'R');
      if (step.sides) {
        assert.equal(left.side, 'L', step.id);
        assert.equal(right.side, 'R', step.id);
        assert.deepEqual(stretchMotionFor(step.id, 'right'), right, `${step.id}: 'right'도 오른쪽`);
        assert.deepEqual(stretchMotionFor(step.id), left, `${step.id}: 기본은 왼쪽`);
      } else {
        assert.equal(right, left, `${step.id}: 양쪽을 같이 하는 동작은 같은 시연`);
      }
    }
  });

  it('반대쪽 시연은 모든 순간 뼈 · 손바닥 방향까지 정확히 좌우 대칭이다', () => {
    for (const step of STEPS.filter((item) => item.sides)) {
      const left = clipOf(step.id, 'L');
      const right = clipOf(step.id, 'R');
      for (let i = 0; i <= 24; i += 1) {
        const a = clipFrame(left, i / 24);
        const b = clipFrame(right, i / 24);
        for (const name of Object.keys(a.solved.bones) as BoneName[]) {
          const orig = a.solved.bones[name];
          const flip = b.solved.bones[swapName(name)];
          for (const key of ['a', 'b', 'f'] as const) {
            assert.ok(len(sub(mirror(orig[key]), flip[key])) < 1e-6, `${step.id} t=${i / 24}: ${name}.${key}`);
          }
        }
        for (const hand of ['L', 'R'] as const) {
          const other = hand === 'L' ? 'R' : 'L';
          assert.ok(len(sub(mirror(a.solved.hands[hand].palm), b.solved.hands[other].palm)) < 1e-6, `${step.id}: ${hand} 손바닥`);
        }
        assert.equal(a.label, b.label);
        assert.equal(a.moving.length, b.moving.length);
        for (const [n, item] of a.moving.entries()) assert.ok(len(sub(mirror(item.p), b.moving[n]!.p)) < 1e-6, `${step.id}: 움직이는 기구`);
      }
      left.scene.forEach((prim, n) => assert.deepEqual(right.scene[n]!.p, mirror(prim.p), `${step.id}: 기구 자리`));
      assert.deepEqual(right.view, [-left.view[0], left.view[1]], `${step.id}: 보는 쪽도 반대로`);
    }
  });

  it('두 번 뒤집으면 처음 그대로', () => {
    for (const step of STEPS.filter((item) => item.sides)) {
      const clip = clipOf(step.id);
      assert.deepEqual(mirrorClip(mirrorClip(clip)), clip, step.id);
    }
  });
});

describe('동작이 그 스트레칭답다 (설명과 맞다)', () => {
  it('앞허벅지 — 발목을 잡고 뒤꿈치는 엉덩이 쪽, 무릎은 아래를 본다', () => {
    const s = at('quad-stand', 0);
    const b = s.bones;
    const thigh = sub(b.thighL.b, b.thighL.a);
    assert.ok(angle(thigh, [0, -1, 0]) < 15, `무릎이 아래를 보지 않는다 (${angle(thigh, [0, -1, 0]).toFixed(0)}°)`);
    const heel = b.shinL.b;
    assert.ok(heel[2] < b.pelvis.a[2] && heel[1] > 0.6, '뒤꿈치가 엉덩이 쪽으로 올라오지 않았다');
    assert.ok(len(sub(s.hands.L.grip, heel)) < 0.1, '왼손이 발목을 잡지 않았다');
    assert.ok(Math.abs(b.footR.b[1]) < 0.015, '오른발로 선다');
  });

  it('엉덩이 — 누워서 왼발목을 오른무릎에 올리고, 두 손으로 오른허벅지를 당긴다', () => {
    const s = at('figure-four', 0);
    const b = s.bones;
    assert.ok(b.chest.a[1] < 0.15 && b.head.b[1] < 0.3, '누운 자세가 아니다');
    assert.ok(len(sub(b.shinL.b, b.shinR.a)) < 0.13, '왼발목이 오른무릎 위에 있지 않다');
    assert.ok(b.thighL.b[0] > b.thighL.a[0] + 0.12, '왼무릎이 바깥으로 열리지 않았다');
    for (const hand of ['L', 'R'] as const) assert.ok(segmentDistance(s.hands[hand].grip, b.thighR.a, b.thighR.b) < 0.12, `${hand}손이 오른허벅지에 없다`);
  });

  it('뒤허벅지 — 앞다리는 펴서 뒤꿈치를 대고, 등을 편 채 엉덩이부터 숙인다', () => {
    const b = at('hamstring-reach', 0).bones;
    const knee = angle(sub(b.thighL.b, b.thighL.a), sub(b.shinL.b, b.shinL.a));
    assert.ok(knee < 10, `앞무릎이 굽었다 (${knee.toFixed(0)}°)`);
    assert.ok(Math.abs(b.footL.a[1]) < 0.015 && b.footL.b[1] > 0.04, '앞발 뒤꿈치를 대고 발끝을 들지 않았다');
    const torso = sub(b.chest.b, b.lumbar.a);
    assert.ok(angle(torso, [0, 1, 0]) > 40, '숙이지 않았다');
    assert.ok(angle(sub(b.lumbar.b, b.lumbar.a), sub(b.chest.b, b.chest.a)) < 10, '등이 둥글게 말렸다');
  });

  it('종아리 — 뒤에 둔 다리는 펴고 뒤꿈치를 바닥에, 손은 벽', () => {
    const b = at('calf-wall', 0).bones;
    const knee = angle(sub(b.thighL.b, b.thighL.a), sub(b.shinL.b, b.shinL.a));
    assert.ok(knee < 8, `뒷무릎이 굽었다 (${knee.toFixed(0)}°)`);
    assert.ok(Math.abs(b.footL.a[1]) < 0.01 && Math.abs(b.footL.b[1]) < 0.01, '뒤꿈치가 떴다');
    assert.ok(b.shinL.a[2] > b.shinL.b[2] + 0.1, '발목이 굽지 않았다 (몸이 앞으로 기울지 않았다)');
  });

  it('가슴 — 팔꿈치는 어깨 높이, 아래팔은 세워 기둥에, 팔은 몸통 뒤로', () => {
    const clip = clipOf('chest-doorway');
    const s = clipFrame(clip, 0).solved;
    const b = s.bones;
    assert.ok(Math.abs(b.upperArmL.b[1] - b.upperArmL.a[1]) < 0.05, '팔꿈치가 어깨 높이가 아니다');
    assert.ok(angle(sub(b.forearmL.b, b.forearmL.a), [0, 1, 0]) < 15, '아래팔이 서 있지 않다');
    const post = clip.scene.find((prim) => prim.kind === 'post')!;
    assert.ok(segmentsDistance(b.forearmL.a, b.forearmL.b, [post.p[0], 0.5, post.p[2]], [post.p[0], 2, post.p[2]]) < 0.1, '아래팔이 기둥에 닿지 않는다');
    // 몸을 돌려 팔이 가슴 앞면보다 뒤에 있다
    const front = s.frames.chest.z;
    assert.ok(dot(sub(b.upperArmL.b, b.upperArmL.a), front) < -0.05, '팔이 몸통 뒤로 가지 않았다');
  });

  it('어깨 뒤쪽 · 삼두 — 팔을 가슴 앞으로 / 머리 뒤로 접고 반대 손이 팔꿈치를 누른다', () => {
    const cross = at('cross-arm', 0);
    assert.ok(cross.hands.L.grip[0] < -0.1, '왼팔이 가슴 앞을 가로지르지 않았다');
    assert.ok(len(sub(cross.hands.R.grip, cross.bones.forearmL.a)) < 0.12, '오른손이 왼팔꿈치 근처에 없다');
    const tri = at('triceps-overhead', 0);
    const head = tri.bones.head;
    assert.ok(tri.bones.forearmL.a[1] > head.a[1] + 0.12, '팔꿈치가 머리 높이로 올라가지 않았다');
    assert.ok(tri.hands.L.grip[2] < head.a[2] && tri.hands.L.grip[1] < tri.bones.forearmL.a[1] - 0.15, '손이 머리 뒤로 내려가지 않았다');
    assert.ok(len(sub(tri.hands.R.grip, tri.bones.forearmL.a)) < 0.1, '오른손이 팔꿈치를 누르지 않는다');
  });

  it('복부(코브라) — 골반은 바닥, 팔로 상체를 밀어 올린다', () => {
    const b = at('cobra', 0).bones;
    assert.ok(b.pelvis.a[1] < 0.15, '골반이 떴다');
    assert.ok(b.upperArmL.a[1] > 0.4, '상체가 올라오지 않았다');
    assert.ok(Math.abs(b.forearmL.b[2] - b.upperArmL.a[2]) < 0.12, '손이 어깨 밑에 있지 않다');
  });

  it('팔 돌리기 · 다리 흔들기 · 런지 돌리기 — 끝까지 움직인다', () => {
    const circle = frames(clipOf('arm-circle')).map((frame) => frame.solved);
    assert.ok(circle.some((s) => s.hands.L.grip[1] > s.bones.head.b[1]), '팔이 머리 위로 가지 않는다');
    assert.ok(circle.some((s) => s.hands.L.grip[2] < s.bones.upperArmL.a[2] - 0.3), '팔이 뒤로 가지 않는다');
    assert.ok(circle.some((s) => s.hands.L.grip[2] > s.bones.upperArmL.a[2] + 0.4), '팔이 앞으로 가지 않는다');
    const swing = frames(clipOf('leg-swing')).map((frame) => frame.solved.bones.shinL.b[2]);
    assert.ok(Math.max(...swing) > 0.5 && Math.min(...swing) < -0.25, '다리를 앞뒤로 크게 흔들지 않는다');
    const open = at('worlds-greatest', 0.5);
    assert.ok(open.hands.L.grip[1] > open.bones.head.b[1] + 0.2, '왼팔을 하늘로 뻗지 않았다');
    assert.ok(Math.abs(open.hands.R.grip[1] - 0.022) < 0.01, '오른손은 바닥');
    const book = at('thoracic', 0.5);
    assert.ok(book.bones.forearmL.a[1] > book.bones.upperArmL.a[1] + 0.1, '등 회전에서 팔꿈치가 천장 쪽으로 열리지 않았다');
  });

  it('밴드 벌리기는 두 손 사이에 밴드가 걸린다', () => {
    const clip = clipOf('band-pull-apart');
    assert.deepEqual(clip.cables, [{ from: 'L', to: 'R' }]);
    const band = clipFrame(clip, 0.45).moving.find((item) => item.kind === 'cableLine')!;
    const s = clipFrame(clip, 0.45).solved;
    assert.ok(Math.abs(band.size[1]! - len(sub(s.hands.L.grip, s.hands.R.grip))) < 1e-6, '밴드 길이가 두 손 사이와 다르다');
    assert.ok(band.size[1]! > 1, '양옆으로 벌리지 않았다');
  });

  it('폼롤러 — 몸이 롤러 위를 오가고, 롤러를 뚫지 않는다', () => {
    for (const id of ['roll-upper-back', 'roll-lats', 'roll-quads', 'roll-glutes', 'roll-hams-calves', 'roll-chest']) {
      const clip = clipOf(id);
      const roller = clip.scene.find((prim) => prim.kind === 'roller')!;
      const along = roller.x ?? [1, 0, 0];
      const half = roller.size[1]! / 2;
      const ends: [Vec3, Vec3] = [
        [roller.p[0] - along[0] * half, roller.p[1], roller.p[2] - along[2] * half],
        [roller.p[0] + along[0] * half, roller.p[1], roller.p[2] + along[2] * half],
      ];
      const r = roller.size[0]!;
      for (const frame of frames(clip)) {
        let nearest = Infinity;
        for (const [name, bone] of Object.entries(frame.solved.bones)) {
          if (/hand|forearm|foot/.test(name)) continue;
          const d = segmentsDistance(bone.a, bone.b, ends[0], ends[1]);
          assert.ok(d > r - 0.005, `${id}: ${name}가 롤러를 뚫었다 (${d.toFixed(3)})`);
          nearest = Math.min(nearest, d);
        }
        assert.ok(nearest < r + 0.13, `${id}: 몸이 롤러에 얹혀 있지 않다 (${nearest.toFixed(3)})`);
      }
      const travel = Math.max(...frames(clip).map((frame) => len(sub(frame.solved.bones.pelvis.a, frames(clip)[0]!.solved.bones.pelvis.a))));
      assert.ok(travel > 0.05, `${id}: 몸이 롤러 위를 오가지 않는다`);
    }
  });

  it('호흡 — 들이쉬는 4초 동안 팔이 오르고 내쉬는 6초 동안 내린다', () => {
    const clip = clipOf('breath');
    assert.equal(clip.cycle, 10);
    const hand = (t: number) => clipFrame(clip, t).solved.hands.L.grip[1];
    assert.ok(hand(0.4) - hand(0) > 0.4, '팔이 오르지 않는다');
    assert.ok(hand(0.2) > hand(0) && hand(0.7) < hand(0.4), '숨 쉬는 박자가 아니다');
  });
});
