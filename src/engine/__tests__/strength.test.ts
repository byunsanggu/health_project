import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  calibrateFromSet,
  suggestStartingLoad,
  workingWeightFor,
  type LifterProfile,
} from '../strength.ts';
import { DEFAULT_GYM, loadingFor } from '../gym.ts';
import { exerciseById } from '../exercises.ts';
import { index, session, sets } from './helpers.ts';
import type { Exercise } from '../types.ts';

const bench = exerciseById('barbell-bench-press') as Exercise;
const machinePress = exerciseById('machine-chest-press') as Exercise;
const inclineDb = exerciseById('incline-dumbbell-press') as Exercise;
const plank = exerciseById('plank') as Exercise;

const repRange = { min: 8, max: 12 };
const targetRir = 3;

function suggest(exercise: Exercise, args: Partial<Parameters<typeof suggestStartingLoad>[0]> = {}) {
  return suggestStartingLoad({
    exercise,
    repRange,
    targetRir,
    loading: loadingFor(exercise, DEFAULT_GYM),
    index,
    ...args,
  });
}

describe('workingWeightFor', () => {
  it('반복과 RIR이 많을수록 작업 중량이 낮아진다', () => {
    const heavy = workingWeightFor(100, 5, 1);
    const light = workingWeightFor(100, 15, 3);
    assert.ok(heavy > light);
    assert.ok(heavy < 100, '1RM보다는 가볍다');
  });
});

describe('suggestStartingLoad', () => {
  it('근거가 없으면 숫자를 지어내지 않는다', () => {
    const result = suggest(bench);
    assert.equal(result.weightKg, null);
    assert.equal(result.method, 'unknown');
    assert.match(result.rationale, /탐색 세트/);
  });

  it('체중과 경력에서 보수적인 출발점을 낸다', () => {
    const profile: LifterProfile = { bodyweightKg: 75, level: 'beginner', sex: 'male' };
    const result = suggest(bench, { profile });

    assert.equal(result.method, 'bodyweight-ratio');
    assert.ok(result.weightKg! >= 20 && result.weightKg! <= 50, `초급 75kg 남성에게 ${result.weightKg}kg`);
    assert.equal(result.confidence, 'low');
    assert.equal(result.needsCalibration, true);
  });

  it('경력이 올라가면 제안 중량도 올라간다', () => {
    const bw = 75;
    const beginner = suggest(bench, { profile: { bodyweightKg: bw, level: 'beginner' } }).weightKg!;
    const advanced = suggest(bench, { profile: { bodyweightKg: bw, level: 'advanced' } }).weightKg!;
    assert.ok(advanced > beginner);
  });

  it('여성 프로필에는 다른 기준선을 쓴다', () => {
    const male = suggest(bench, { profile: { bodyweightKg: 65, level: 'beginner', sex: 'male' } }).weightKg!;
    const female = suggest(bench, { profile: { bodyweightKg: 65, level: 'beginner', sex: 'female' } }).weightKg!;
    assert.ok(female < male);
    assert.ok(female >= 20, '빈 바보다 가볍게 제안하지는 않는다');
  });

  it('관련 종목 기록이 있으면 그쪽을 더 믿는다', () => {
    const history = [session('2026-09-14', sets('barbell-bench-press', 3, { weightKg: 90, reps: 8, rir: 2 }))];
    const result = suggest(machinePress, { history, profile: { bodyweightKg: 75, level: 'beginner' } });

    assert.equal(result.method, 'related-lift');
    assert.equal(result.confidence, 'medium');
    assert.match(result.rationale, /바벨 벤치프레스/);
    assert.ok(result.weightKg! > 40, '벤치 90kg×8을 하는 사람에게 너무 가볍지 않다');
  });

  it('덤벨 종목은 한쪽 무게로 환산한다', () => {
    const history = [session('2026-09-14', sets('barbell-bench-press', 3, { weightKg: 100, reps: 5, rir: 1 }))];
    const result = suggest(inclineDb, { history });

    assert.ok(result.weightKg! < 50, '양손 합계가 아니라 한쪽 무게여야 한다');
    assert.ok(result.weightKg! > 10);
  });

  it('추정으로 나온 값은 무엇이든 확인을 요구한다', () => {
    const history = [session('2026-09-14', sets('barbell-bench-press', 3, { weightKg: 90, reps: 8, rir: 2 }))];
    for (const result of [
      suggest(machinePress, { history }),
      suggest(bench, { profile: { bodyweightKg: 75, level: 'intermediate' } }),
    ]) {
      assert.equal(result.needsCalibration, true);
    }
  });

  it('환산표에 없는 종목은 모른다고 말한다', () => {
    const result = suggest(plank, { profile: { bodyweightKg: 75, level: 'intermediate' } });
    assert.equal(result.weightKg, null);
    assert.equal(result.method, 'unknown');
  });

  it('제안 중량은 그 헬스장에서 실제로 만들 수 있는 값이다', () => {
    const result = suggest(bench, { profile: { bodyweightKg: 80, level: 'intermediate' } });
    assert.equal((result.weightKg! - 20) % 2.5, 0);
  });
});

describe('calibrateFromSet', () => {
  it('탐색 세트 하나로 작업 중량을 확정한다', () => {
    const result = calibrateFromSet(
      { weightKg: 40, reps: 10, rir: 4 },
      { repRange, targetRir: 2 },
      loadingFor(bench, DEFAULT_GYM),
    );
    assert.ok(result.weightKg >= 37.5 && result.weightKg <= 45, `나온 값 ${result.weightKg}kg`);
    assert.ok(result.estimated1RM > 40);
    assert.match(result.rationale, /추정 1RM/);
  });

  it('같은 중량이라도 여유가 많았으면 더 무겁게 잡는다', () => {
    const easy = calibrateFromSet({ weightKg: 50, reps: 10, rir: 5 }, { repRange, targetRir: 2 });
    const hard = calibrateFromSet({ weightKg: 50, reps: 10, rir: 0 }, { repRange, targetRir: 2 });
    assert.ok(easy.weightKg > hard.weightKg);
  });

  it('추정표보다 탐색 세트가 우선한다', () => {
    // 체중 기준선은 이 사람을 과소평가한다 — 탐색 세트가 그걸 바로잡는다
    const estimated = suggest(bench, { profile: { bodyweightKg: 70, level: 'beginner' } }).weightKg!;
    const calibrated = calibrateFromSet(
      { weightKg: 80, reps: 10, rir: 3 },
      { repRange, targetRir: 3 },
      loadingFor(bench, DEFAULT_GYM),
    ).weightKg;
    assert.ok(calibrated > estimated);
  });
});
