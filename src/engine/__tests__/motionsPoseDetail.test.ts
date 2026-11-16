/**
 * 코치 눈으로 본 자세 디테일 — 다 편 팔은 살짝만 굽고(덜 편 반복처럼 보이지 않게), 푸시업 바닥에서는
 * 손목이 팔꿈치 밑에, 엎드리거나 숙인 자세에서 고개를 쳐들지 않는다.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { exerciseById } from '../exercises.ts';
import { clipFrame, clipPose } from '../motionKit.ts';
import { motionFor } from '../motions.ts';
import type { Vec3 } from '../rig.ts';

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a: Vec3) => Math.sqrt(dot(a, a));
const deg = (a: Vec3, b: Vec3) => (Math.acos(Math.max(-1, Math.min(1, dot(a, b) / (len(a) * len(b))))) * 180) / Math.PI;

function clip(id: string) {
  const ex = exerciseById(id as never);
  assert.ok(ex, id);
  const c = motionFor(ex);
  assert.ok(c, id);
  return c;
}

/** 왼 · 오른 팔꿈치가 곧은 데서 굽은 각(°) */
function elbowBend(id: string, t: number): number[] {
  const b = clipFrame(clip(id), t).solved.bones;
  return (['L', 'R'] as const).map((s) => 180 - deg(sub(b[`upperArm${s}`].a, b[`upperArm${s}`].b), sub(b[`forearm${s}`].b, b[`forearm${s}`].a)));
}

describe('자세 디테일 — 다 편 팔', () => {
  // [종목, 다 편 순간] — 미는 동작은 맨 위, 당기는 동작은 시작(팔이 늘어진 자리)
  const locked: [string, number][] = [
    ['barbell-bench-press', 0], ['incline-barbell-press', 0], ['decline-barbell-press', 0], ['close-grip-bench-press', 0], ['floor-press', 0],
    ['dumbbell-bench-press', 0], ['incline-dumbbell-press', 0], ['dumbbell-floor-press', 0],
    ['barbell-overhead-press', 0.45], ['seated-dumbbell-press', 0.45], ['standing-dumbbell-press', 0.45], ['arnold-press', 0.45], ['smith-shoulder-press', 0.45],
    ['chest-dip', 0], ['triceps-dip', 0],
    ['machine-chest-press', 0.45], ['machine-incline-chest-press', 0.45],
    ['barbell-row', 0], ['dumbbell-bent-over-row', 0], ['pendlay-row', 0], ['seated-cable-row', 0], ['band-row', 0],
  ];
  for (const [id, t] of locked) {
    it(`${id} t=${t}: 팔꿈치는 살짝만 굽는다 (4~18°)`, () => {
      for (const bend of elbowBend(id, t)) assert.ok(bend >= 3 && bend <= 18, `${id}: 팔꿈치 ${bend.toFixed(0)}°`);
    });
  }

  const hinges = ['conventional-deadlift', 'romanian-deadlift', 'stiff-leg-deadlift', 'sumo-deadlift', 'trap-bar-deadlift', 'dumbbell-romanian-deadlift'];
  for (const id of hinges) {
    it(`${id}: 바를 든 팔은 한 동작 내내 곧게 늘어진다 (24° 밑, 팔로 당기지 않는다)`, () => {
      for (let i = 0; i <= 20; i += 1) {
        for (const bend of elbowBend(id, i / 20)) assert.ok(bend <= 24, `${id} t=${i / 20}: 팔꿈치 ${bend.toFixed(0)}°`);
      }
    });
  }
});

describe('자세 디테일 — 푸시업 · 고개', () => {
  it('푸시업 바닥에서 아래팔이 거의 선다 (손목이 팔꿈치 밑, 25° 안)', () => {
    for (const id of ['push-up', 'knee-push-up']) {
      const b = clipFrame(clip(id), 0.5).solved.bones;
      for (const s of ['L', 'R'] as const) {
        const tilt = deg(sub(b[`forearm${s}`].a, b[`forearm${s}`].b), [0, 1, 0]);
        assert.ok(tilt <= 25, `${id} ${s}: 아래팔이 ${tilt.toFixed(0)}° 누웠다`);
      }
    }
  });

  it('숙이거나 엎드린 자세에서 고개를 쳐들지 않는다 (목 젖힘 22° 안)', () => {
    const ids = ['push-up', 'plank', 'pendlay-row', 'romanian-deadlift', 'stiff-leg-deadlift', 'dumbbell-romanian-deadlift', 'dumbbell-rear-delt-fly', 'triceps-kickback'];
    for (const id of ids) {
      const c = clip(id);
      for (let i = 0; i <= 10; i += 1) {
        const neck = clipPose(c, i / 10).pose.neck ?? 0;
        assert.ok(neck >= -22, `${id} t=${i / 10}: 목을 ${(-neck).toFixed(0)}° 젖혔다`);
      }
    }
  });
});
