import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { EXERCISES } from '../exercises.ts';
import { PATTERN_LABELS_KO, demoCoverage, demoFor, labelAt, poseAt } from '../demos.ts';
import { MOVEMENT_PATTERNS_OR_EMPTY } from './demos.fixtures.ts';

describe('demoFor', () => {
  it('모든 종목에 시연이 있다', () => {
    for (const exercise of EXERCISES) {
      const demo = demoFor(exercise);
      assert.equal(demo.exerciseId, exercise.id);
      assert.ok(demo.keyframes.length >= 2, `${exercise.id}: 키프레임이 부족하다`);
      assert.ok(demo.cues.length > 0, `${exercise.id}: 큐가 없다`);
      assert.ok(demo.mistakes.length > 0, `${exercise.id}: 실수 항목이 없다`);
      assert.ok(demo.cycleSeconds > 0);
    }
  });

  it('키프레임은 0에서 시작해 1에서 끝나고 순서가 단조롭다', () => {
    for (const exercise of EXERCISES) {
      const frames = demoFor(exercise).keyframes;
      assert.equal(frames[0]!.t, 0, `${exercise.id}: 0에서 시작하지 않는다`);
      assert.equal(frames[frames.length - 1]!.t, 1, `${exercise.id}: 1에서 끝나지 않는다`);
      for (let i = 1; i < frames.length; i += 1) {
        assert.ok(frames[i]!.t > frames[i - 1]!.t, `${exercise.id}: 키프레임 순서가 뒤집혔다`);
      }
    }
  });

  it('반복 동작은 시작과 끝 자세가 같다 — 이어 붙여도 튀지 않는다', () => {
    for (const exercise of EXERCISES) {
      const demo = demoFor(exercise);
      assert.deepEqual(poseAt(demo, 0), poseAt(demo, 1), `${exercise.id}: 주기가 이어지지 않는다`);
    }
  });

  it('종목별 오버라이드는 패턴 기본값을 덮어쓴다', () => {
    const squat = demoFor(EXERCISES.find((item) => item.id === 'back-squat')!);
    assert.match(squat.cues.join(' '), /승모근/);
    assert.equal(squat.pattern, 'squat');
  });

  it('등척성 종목은 반복이 아니라 버티기다', () => {
    const plank = demoFor(EXERCISES.find((item) => item.id === 'plank')!);
    assert.equal(plank.orientation, 'prone');
    // 자세가 사실상 변하지 않아야 한다 (호흡만큼만)
    const start = poseAt(plank, 0);
    const middle = poseAt(plank, 0.5);
    assert.ok(Math.abs(start.hip - middle.hip) < 10, '플랭크가 크런치처럼 움직인다');
  });

  it('아직 에셋이 없으므로 절차적 시연이다', () => {
    for (const exercise of EXERCISES) {
      const demo = demoFor(exercise);
      assert.equal(demo.source, 'procedural');
      assert.equal(demo.assetUrl, undefined);
    }
  });

  it('모든 동작 패턴에 한국어 이름이 있다', () => {
    for (const pattern of MOVEMENT_PATTERNS_OR_EMPTY) {
      assert.ok(PATTERN_LABELS_KO[pattern], `${pattern}: 이름이 없다`);
    }
  });
});

describe('poseAt', () => {
  it('키프레임 위에서는 그 자세를 그대로 낸다', () => {
    const demo = demoFor(EXERCISES.find((item) => item.id === 'barbell-overhead-press')!);
    const frame = demo.keyframes[1]!;
    const pose = poseAt(demo, frame.t);
    assert.equal(pose.shoulder, frame.pose.shoulder);
    assert.equal(pose.elbow, frame.pose.elbow);
  });

  it('키프레임 사이는 보간한다', () => {
    const demo = demoFor(EXERCISES.find((item) => item.id === 'barbell-curl')!);
    const mid = poseAt(demo, 0.225);
    const start = poseAt(demo, 0);
    const peak = poseAt(demo, 0.45);
    assert.ok(mid.elbow > start.elbow && mid.elbow < peak.elbow);
  });

  it('주기를 벗어난 t도 같은 자세로 감는다', () => {
    const demo = demoFor(EXERCISES.find((item) => item.id === 'back-squat')!);
    // t % 1 에 남는 부동소수 오차까지 같기를 요구할 수는 없다
    const close = (a: Record<string, number>, b: Record<string, number>) => {
      for (const key of Object.keys(a)) {
        assert.ok(Math.abs(a[key]! - b[key]!) < 1e-6, `${key}: ${a[key]} vs ${b[key]}`);
      }
    };
    close(poseAt(demo, 1.3), poseAt(demo, 0.3));
    close(poseAt(demo, -0.7), poseAt(demo, 0.3));
  });
});

describe('labelAt', () => {
  it('구간에 들어간 키프레임의 말을 돌려준다', () => {
    const demo = demoFor(EXERCISES.find((item) => item.id === 'back-squat')!);
    assert.equal(labelAt(demo, 0), '시작');
    assert.equal(labelAt(demo, 0.45), '최저점');
  });

  it('부동소수 오차로 구간 경계를 놓치지 않는다', () => {
    const demo = demoFor(EXERCISES.find((item) => item.id === 'back-squat')!);
    // (0.45 % 1)이 0.4499…로 떨어지던 자리
    assert.equal(labelAt(demo, 1.45), '최저점');
  });
});

describe('demoCoverage', () => {
  it('패턴별 종목 수와 맞춤 큐가 작성된 종목 수를 센다', () => {
    const coverage = demoCoverage(EXERCISES);
    assert.equal(coverage.total, EXERCISES.length);
    assert.ok(coverage.withOverride > 0);
    assert.equal(
      Object.values(coverage.byPattern).reduce((sum, count) => sum + count, 0),
      EXERCISES.length,
    );
  });
});
