import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { findSubstitutes, screenExercise, screenSession, similarity } from '../pain.ts';
import { exerciseById } from '../exercises.ts';
import type { Exercise } from '../types.ts';

const ohp = exerciseById('barbell-overhead-press') as Exercise;
const deadlift = exerciseById('conventional-deadlift') as Exercise;
const pushdown = exerciseById('triceps-pushdown') as Exercise;
const benchPress = exerciseById('barbell-bench-press') as Exercise;
const machinePress = exerciseById('machine-chest-press') as Exercise;

describe('screenExercise', () => {
  it('통증이 없으면 아무 제한도 걸지 않는다', () => {
    const ruling = screenExercise(ohp, []);
    assert.equal(ruling.action, 'allow');
    assert.equal(ruling.loadMultiplier, 1);
  });

  it('경미한 통증(1~2점)은 고부하 종목만 감량한다', () => {
    assert.equal(screenExercise(ohp, [{ joint: 'shoulder', score: 2 }]).action, 'reduceLoad');
    assert.equal(screenExercise(pushdown, [{ joint: 'shoulder', score: 2 }]).action, 'allow');
  });

  it('3점 이상이면 고부하 종목을 대체한다', () => {
    const ruling = screenExercise(ohp, [{ joint: 'shoulder', score: 4 }]);
    assert.equal(ruling.action, 'substitute');
    assert.ok(ruling.substitutes.length > 0);
    assert.ok(
      ruling.substitutes.every((e) => (e.jointStress.shoulder ?? 0) < 0.6),
      '대체 종목은 아픈 관절 부하가 낮아야 한다',
    );
  });

  it('중간 부하 종목은 대체까지 가지 않고 감량으로 끝낸다', () => {
    const ruling = screenExercise(machinePress, [{ joint: 'shoulder', score: 4 }]);
    assert.equal(ruling.action, 'reduceLoad');
    assert.equal(ruling.loadMultiplier, 0.9);
  });

  it('7점 이상이면 중단시키고 진료를 권한다', () => {
    const ruling = screenExercise(ohp, [{ joint: 'shoulder', score: 8 }]);
    assert.equal(ruling.action, 'stop');
    assert.match(ruling.message, /전문의/);
  });

  it('관련 없는 관절의 통증은 무시한다', () => {
    assert.equal(screenExercise(ohp, [{ joint: 'ankle', score: 8 }]).action, 'allow');
  });

  it('여러 통증이 있으면 가장 심한 판정을 따른다', () => {
    const ruling = screenExercise(deadlift, [
      { joint: 'wrist', score: 2 },
      { joint: 'lowBack', score: 8 },
    ]);
    assert.equal(ruling.action, 'stop');
    assert.equal(ruling.joint, 'lowBack');
  });

  it('0점 보고는 통증으로 치지 않는다', () => {
    assert.equal(screenExercise(ohp, [{ joint: 'shoulder', score: 0 }]).action, 'allow');
  });
});

describe('findSubstitutes', () => {
  it('허리가 아픈 데드리프트를 허리 부담이 적은 힌지로 바꾼다', () => {
    const substitutes = findSubstitutes(deadlift, [{ joint: 'lowBack', score: 4 }]);
    assert.ok(substitutes.length > 0);
    assert.ok(
      substitutes.every((e) => (e.jointStress.lowBack ?? 0) < (deadlift.jointStress.lowBack ?? 1)),
    );
    assert.ok(
      substitutes.some((e) => (e.contribution.glutes ?? 0) >= 0.7 || (e.contribution.hamstrings ?? 0) >= 0.7),
      '원래 노리던 근육을 계속 자극해야 대체다',
    );
  });

  it('대안이 없으면 억지로 내놓지 않는다', () => {
    assert.deepEqual(findSubstitutes(ohp, [{ joint: 'shoulder', score: 9 }]), []);
  });

  it('보유 기구로만 제안한다', () => {
    const substitutes = findSubstitutes(benchPress, [{ joint: 'shoulder', score: 4 }], {
      availableEquipment: ['dumbbell', 'bodyweight'],
    });
    assert.ok(substitutes.every((e) => ['dumbbell', 'bodyweight'].includes(e.equipment)));
  });
});

describe('similarity', () => {
  it('같은 종목은 1', () => {
    assert.equal(Math.round(similarity(benchPress, benchPress) * 100) / 100, 1);
  });

  it('가슴 프레스끼리는 가슴-스쿼트보다 훨씬 가깝다', () => {
    const squat = exerciseById('back-squat') as Exercise;
    assert.ok(similarity(benchPress, machinePress) > similarity(benchPress, squat));
  });
});

describe('screenSession', () => {
  it('세션 전체를 유지/교체/제외로 분류한다', () => {
    const screen = screenSession([ohp, pushdown, benchPress], [{ joint: 'shoulder', score: 4 }]);
    assert.equal(screen.rulings.length, 3);
    assert.ok(screen.swap.some((r) => r.exerciseId === ohp.id));
    assert.ok(screen.keep.some((r) => r.exerciseId === pushdown.id));
    assert.equal(screen.medicalAdvisory, false);
  });

  it('7점 이상이 하나라도 있으면 의료 상담 플래그를 세운다', () => {
    const screen = screenSession([ohp], [{ joint: 'shoulder', score: 7 }]);
    assert.equal(screen.medicalAdvisory, true);
    assert.equal(screen.drop.length, 1);
  });
});
