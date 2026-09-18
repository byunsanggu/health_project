import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { exerciseById } from '../exercises.ts';
import { DEFAULT_GYM } from '../gym.ts';
import { planAroundOccupied } from '../occupancy.ts';
import type { PlannedExercise } from '../session.ts';

/** 세트 구성은 판단에 쓰이지 않는다. 종목 순서만 맞으면 된다. */
function plannedFrom(ids: string[]): PlannedExercise[] {
  return ids.map((id) => {
    const exercise = exerciseById(id);
    assert.ok(exercise, `${id}: 종목이 없다`);
    return {
      exercise: exercise!,
      sets: [{ setNumber: 1, weightKg: 60, targetReps: { min: 8, max: 12 }, targetRir: 2 }],
      painRuling: {
        exerciseId: id,
        action: 'allow' as const,
        message: '',
        loadMultiplier: 1,
        substitutes: [],
      },
      note: '',
    };
  });
}

const LOWER = ['back-squat', 'romanian-deadlift', 'leg-press', 'lying-leg-curl', 'standing-calf-raise'];

describe('planAroundOccupied', () => {
  it('뒤에 할 종목이 있으면 대체하지 않고 순서를 바꾼다', () => {
    const plan = planAroundOccupied({
      exercises: plannedFrom(LOWER),
      exerciseId: 'back-squat',
      gym: DEFAULT_GYM,
    });

    assert.equal(plan.action, 'reorder');
    assert.ok(plan.now, '당겨올 종목이 없다');
    // 랙이 막혔으니 같은 랙을 쓰는 루마니안 데드리프트는 후보가 아니다
    assert.notEqual(plan.now!.id, 'romanian-deadlift');
    assert.ok(plan.deferredTo !== undefined && plan.deferredTo > 0);
  });

  it('랙이 막히면 그 랙을 쓰는 종목이 전부 막힌다', () => {
    const plan = planAroundOccupied({
      exercises: plannedFrom(['back-squat', 'romanian-deadlift', 'barbell-row']),
      exerciseId: 'back-squat',
      gym: DEFAULT_GYM,
    });

    // 셋 다 바벨이다. 당겨올 것도 바벨 대체도 없다.
    assert.notEqual(plan.action, 'reorder');
    for (const option of plan.options) {
      assert.notEqual(option.exercise.equipment, 'barbell', `${option.exercise.name}이 후보로 남았다`);
    }
  });

  it('머신 한 대가 막혔다고 다른 머신까지 막지는 않는다', () => {
    const plan = planAroundOccupied({
      exercises: plannedFrom(LOWER),
      exerciseId: 'leg-press',
      completed: ['back-squat', 'romanian-deadlift'],
      gym: DEFAULT_GYM,
    });

    assert.equal(plan.action, 'reorder');
    assert.equal(plan.now!.id, 'lying-leg-curl');
  });

  it('메인 복합 동작은 미룰 곳이 없으면 대체보다 기다리기를 권한다', () => {
    const plan = planAroundOccupied({
      exercises: plannedFrom(LOWER),
      exerciseId: 'back-squat',
      completed: LOWER.slice(1),
      gym: DEFAULT_GYM,
    });

    assert.equal(plan.action, 'wait');
    // 기다리라고 하면서도 직접 고를 선택지는 준다
    assert.ok(plan.options.length > 0, '선택지를 아예 안 주면 앱을 끄게 된다');
  });

  it('마지막 고립 종목은 기다리지 않고 대체한다', () => {
    const plan = planAroundOccupied({
      exercises: plannedFrom(LOWER),
      exerciseId: 'standing-calf-raise',
      completed: LOWER.slice(0, 4),
      gym: DEFAULT_GYM,
    });

    assert.equal(plan.action, 'substitute');
    assert.ok(plan.now, '대체 종목이 없다');
    assert.notEqual(plan.now!.id, 'standing-calf-raise');
  });

  it('오늘 이미 하기로 한 종목은 대체 후보가 아니다 — 중복이 된다', () => {
    const planned = plannedFrom(LOWER);
    const plan = planAroundOccupied({
      exercises: planned,
      exerciseId: 'leg-press',
      gym: DEFAULT_GYM,
    });

    const todays = new Set(planned.map((item) => item.exercise.id));
    for (const option of plan.options) {
      assert.ok(!todays.has(option.exercise.id), `${option.exercise.name}이 중복으로 제안됐다`);
    }
  });

  it('붐비는 기구를 표시하면 그 기구 종목은 후보에서 빠진다', () => {
    const plan = planAroundOccupied({
      exercises: plannedFrom(LOWER),
      exerciseId: 'lying-leg-curl',
      completed: LOWER.slice(0, 3),
      busyEquipment: ['machine', 'cable'],
      gym: DEFAULT_GYM,
    });

    for (const option of plan.options) {
      assert.ok(
        option.exercise.equipment !== 'machine' && option.exercise.equipment !== 'cable',
        `${option.exercise.name}이 붐비는 기구인데 제안됐다`,
      );
    }
  });

  it('같은 근육이라도 동작 결이 다르면 그렇다고 적는다', () => {
    const plan = planAroundOccupied({
      exercises: plannedFrom(LOWER),
      exerciseId: 'lying-leg-curl',
      completed: LOWER.slice(0, 3),
      busyEquipment: ['machine', 'cable'],
      gym: DEFAULT_GYM,
    });

    const crossPattern = plan.options.filter((option) => option.exercise.pattern !== 'isolation');
    assert.ok(crossPattern.length > 0, '패턴이 다른 후보가 없어 검증할 수 없다');
    for (const option of crossPattern) {
      assert.match(option.note, /동작 결이 다름/);
    }
  });

  it('통증이 있으면 통증 게이트를 통과한 종목만 제안한다', () => {
    const plan = planAroundOccupied({
      exercises: plannedFrom(LOWER),
      exerciseId: 'leg-press',
      completed: LOWER.filter((id) => id !== 'leg-press'),
      pain: [{ joint: 'knee', score: 6 }],
      gym: DEFAULT_GYM,
    });

    for (const option of plan.options) {
      const stress = option.exercise.jointStress.knee ?? 0;
      assert.ok(stress < 3, `${option.exercise.name}: 무릎 부담 ${stress}인데 제안됐다`);
    }
  });

  it('부위가 바뀌면 워밍업을 다시 해야 한다고 알린다', () => {
    const plan = planAroundOccupied({
      exercises: plannedFrom(LOWER),
      exerciseId: 'leg-press',
      completed: ['back-squat', 'romanian-deadlift'],
      gym: DEFAULT_GYM,
    });

    assert.equal(plan.needsRewarmup, true);
    assert.match(plan.reason, /데우고/);
  });

  it('조사를 붙여서 말한다', () => {
    for (const id of LOWER) {
      const plan = planAroundOccupied({ exercises: plannedFrom(LOWER), exerciseId: id, gym: DEFAULT_GYM });
      // 받침 없는 말에 '은/을', 받침 있는 말에 '는/를'이 붙으면 틀린 것이다
      assert.doesNotMatch(
        plan.reason,
        /트은|트를 대신|즈은|스은|프레스은|컬는|컬를|근는|을\(를\)|은\(는\)|\(으\)로/,
        `${id}: ${plan.reason}`,
      );
    }
  });

  it('세션에 없는 종목을 물으면 그렇다고 말한다', () => {
    const plan = planAroundOccupied({
      exercises: plannedFrom(LOWER),
      exerciseId: 'barbell-bench-press',
      gym: DEFAULT_GYM,
    });
    assert.equal(plan.action, 'wait');
    assert.match(plan.reason, /세션에 없는/);
  });
});
