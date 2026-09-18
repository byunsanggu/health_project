import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { planWarmup, warmedMusclesOf } from '../warmup.ts';
import { DEFAULT_GYM, loadingFor } from '../gym.ts';
import { exerciseById } from '../exercises.ts';
import type { Exercise } from '../types.ts';

const squat = exerciseById('back-squat') as Exercise;
const bench = exerciseById('barbell-bench-press') as Exercise;
const incline = exerciseById('incline-dumbbell-press') as Exercise;
const pushdown = exerciseById('triceps-pushdown') as Exercise;
const plank = exerciseById('plank') as Exercise;

function plan(exercise: Exercise, weight: number, reps: number, warmed: Parameters<typeof planWarmup>[0]['alreadyWarmedMuscles'] = []) {
  const loading = loadingFor(exercise, DEFAULT_GYM);
  return planWarmup({
    exercise,
    workingWeightKg: weight,
    workingReps: reps,
    loading,
    barKg: loading?.kind === 'barbell' ? loading.barKg : undefined,
    alreadyWarmedMuscles: warmed,
  });
}

describe('워밍업 램프', () => {
  it('가벼운 것부터 무거운 것으로 올라간다', () => {
    const { sets } = plan(squat, 140, 5);
    assert.ok(sets.length >= 4);
    for (let i = 1; i < sets.length; i += 1) {
      assert.ok(sets[i]!.weightKg > sets[i - 1]!.weightKg);
    }
  });

  it('무거워질수록 반복을 줄인다', () => {
    const { sets } = plan(squat, 140, 5);
    for (let i = 1; i < sets.length; i += 1) {
      assert.ok(sets[i]!.reps <= sets[i - 1]!.reps, `${i}번째`);
    }
  });

  it('본세트 중량을 넘지 않는다', () => {
    const { sets } = plan(bench, 90, 8);
    assert.ok(sets.every((set) => set.weightKg < 90));
  });

  it('바벨 종목은 빈 바부터 시작한다', () => {
    const { sets } = plan(squat, 140, 5);
    assert.equal(sets[0]!.weightKg, 20);
    assert.equal(sets[0]!.note, '빈 바');
  });

  it('본세트가 빈 바에 가까우면 빈 바 세트를 넣지 않는다', () => {
    const { sets } = plan(squat, 30, 8);
    assert.ok(!sets.some((set) => set.note === '빈 바'));
  });

  it('고중량일수록 램프를 더 밟는다', () => {
    const heavy = plan(bench, 100, 4).sets.length;
    const moderate = plan(bench, 100, 10).sets.length;
    assert.ok(heavy > moderate);
  });

  it('이미 데워진 부위의 복합 동작은 짧게 끝낸다', () => {
    const cold = plan(incline, 30, 10).sets.length;
    const warm = plan(incline, 30, 10, ['chest', 'frontDelt']).sets.length;
    assert.ok(warm < cold);
    assert.ok(warm > 0, '중량 감각은 잡는다');
  });

  it('이미 데워진 부위의 고립 운동은 생략한다', () => {
    const result = plan(pushdown, 40, 12, ['triceps']);
    assert.equal(result.sets.length, 0);
    assert.match(result.note, /이미 데워진/);
  });

  it('첫 고립 운동은 한 세트만 붙인다', () => {
    assert.equal(plan(exerciseById('lateral-raise') as Exercise, 12, 15).sets.length, 1);
  });

  it('같은 중량이 두 번 나오지 않는다', () => {
    const { sets } = plan(squat, 60, 8);
    assert.equal(new Set(sets.map((set) => set.weightKg)).size, sets.length);
  });

  it('맨몸 종목은 램프를 만들지 않는다', () => {
    const result = plan(plank, 0, 30);
    assert.equal(result.sets.length, 0);
    assert.match(result.note, /맨몸/);
  });

  it('실패까지 가지 말라고 항상 붙인다', () => {
    for (const [exercise, weight, reps] of [[squat, 140, 5], [pushdown, 40, 12]] as const) {
      assert.match(plan(exercise, weight, reps).note, /실패까지 가지 않습니다/);
    }
  });

  it('기구에서 만들 수 있는 중량으로 맞춘다', () => {
    for (const set of plan(bench, 90, 8).sets) {
      assert.equal((set.weightKg - 20) % 2.5, 0, `${set.weightKg}kg`);
    }
  });

  it('소요 시간을 함께 준다', () => {
    const result = plan(squat, 140, 5);
    assert.ok(result.estimatedSeconds > 60);
    assert.ok(result.estimatedSeconds < 600);
  });
});

describe('warmedMusclesOf', () => {
  it('그 종목이 자극한 부위를 돌려준다', () => {
    const muscles = warmedMusclesOf(bench);
    assert.ok(muscles.includes('chest'));
    assert.ok(muscles.includes('triceps'), '협응근도 데워진다');
    assert.ok(!muscles.includes('quads'));
  });
});
