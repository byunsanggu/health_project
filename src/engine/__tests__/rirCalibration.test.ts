import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  applyCalibration,
  calibrateByExercise,
  calibrateRir,
  calibrateSessions,
  correctedRir,
} from '../rirCalibration.ts';
import { intensityForReps, oneRepMax, repsForIntensity, workingWeight } from '../repmax.ts';
import { prescribeLoad } from '../load.ts';
import { aggregateVolume, setEffectiveness } from '../volume.ts';
import { exerciseById } from '../exercises.ts';
import { index, session, sets } from './helpers.ts';
import type { Exercise, SessionLog, SetLog } from '../types.ts';

const BENCH = 'barbell-bench-press';

/** 같은 세트 구성을 4주간 반복한 이력. */
function weeks(pattern: SetLog[]): SessionLog[] {
  return [1, 2, 3, 4].map((week) => ({ date: `2026-09-0${week}`, sets: pattern }));
}

const OVER_REPORTER = weeks([
  { exerciseId: BENCH, weightKg: 80, reps: 8, rir: 0 },
  { exerciseId: BENCH, weightKg: 80, reps: 8, rir: 3 },
  { exerciseId: BENCH, weightKg: 75, reps: 9, rir: 3 },
  { exerciseId: BENCH, weightKg: 75, reps: 8, rir: 3 },
]);

const HONEST = weeks([
  { exerciseId: BENCH, weightKg: 90, reps: 6, rir: 0 },
  { exerciseId: BENCH, weightKg: 80, reps: 8, rir: 2 },
  { exerciseId: BENCH, weightKg: 75, reps: 9, rir: 3 },
  { exerciseId: BENCH, weightKg: 70, reps: 10, rir: 4 },
]);

describe('반복 대비 강도 모델', () => {
  it('반복이 늘수록 강도가 떨어진다', () => {
    assert.equal(intensityForReps(1), 1);
    assert.ok(intensityForReps(5) > intensityForReps(10));
    assert.ok(intensityForReps(10) > intensityForReps(20));
  });

  it('역함수가 제자리로 돌아온다', () => {
    for (const reps of [3, 5, 8, 12, 15, 20]) {
      const back = repsForIntensity(intensityForReps(reps));
      assert.ok(Math.abs(back - reps) < 0.2, `${reps}회 → ${back}`);
    }
  });

  it('고반복 작업 중량을 선형 근사보다 가볍게 처방한다', () => {
    // 처방 방향이 중요하다. 1RM 100kg인 사람의 20회 작업 중량을
    // Epley 역식은 60kg으로 보지만 실제로는 그만큼 못 든다.
    const table = workingWeight(100, 20, 0);
    const epleyInverse = 100 / (1 + 20 / 30);
    assert.ok(table < epleyInverse, `${table} vs ${epleyInverse}`);
  });

  it('작업 중량은 1RM보다 가볍고 반복이 늘수록 더 가볍다', () => {
    assert.ok(workingWeight(100, 5, 0) < 100);
    assert.ok(workingWeight(100, 12, 2) < workingWeight(100, 5, 0));
  });
});

describe('calibrateRir', () => {
  it('기록이 없으면 보정하지 않는다', () => {
    const result = calibrateRir([]);
    assert.equal(result.offset, 0);
    assert.equal(result.applied, false);
    assert.equal(result.confidence, 'none');
  });

  it('실패 세트가 없으면 대조할 기준이 없다', () => {
    const noAnchor = weeks([
      { exerciseId: BENCH, weightKg: 80, reps: 8, rir: 3 },
      { exerciseId: BENCH, weightKg: 75, reps: 9, rir: 3 },
    ]);
    const result = calibrateRir(noAnchor, { asOf: '2026-09-10' });
    assert.equal(result.anchorCount, 0);
    assert.equal(result.applied, false);
    assert.match(result.note, /실패 세트가 없어/);
  });

  it('RIR을 실제보다 높게 신고하면 음수 보정이 나온다', () => {
    const result = calibrateRir(OVER_REPORTER, { asOf: '2026-09-10' });
    assert.ok(result.offset < -1, `offset ${result.offset}`);
    assert.equal(result.applied, true);
    assert.ok(result.signals.some((signal) => signal.includes('높게 신고')));
    assert.ok(result.reliability < 1);
  });

  it('정확히 신고하면 보정이 거의 없고 신뢰도가 높다', () => {
    const result = calibrateRir(HONEST, { asOf: '2026-09-10' });
    assert.ok(Math.abs(result.offset) <= 0.5, `offset ${result.offset}`);
    assert.equal(result.reliability, 1);
  });

  it('실제보다 낮게 신고하면 양수 보정이 나온다', () => {
    const under = weeks([
      { exerciseId: BENCH, weightKg: 90, reps: 6, rir: 0 },
      { exerciseId: BENCH, weightKg: 70, reps: 8, rir: 1 },
      { exerciseId: BENCH, weightKg: 65, reps: 9, rir: 1 },
    ]);
    const result = calibrateRir(under, { asOf: '2026-09-10' });
    assert.ok(result.offset > 0);
  });

  it('표본이 모자라면 계산은 해도 적용하지 않는다', () => {
    const thin = [
      session('2026-09-01',
        [{ exerciseId: BENCH, weightKg: 80, reps: 8, rir: 0 }],
        [{ exerciseId: BENCH, weightKg: 80, reps: 8, rir: 3 }]),
    ];
    const result = calibrateRir(thin, { asOf: '2026-09-10' });
    assert.equal(result.confidence, 'low');
    assert.equal(result.applied, false);
    assert.equal(correctedRir(3, result), 3, '적용 전에는 신고값 그대로');
  });

  it('모든 세트에 같은 RIR만 찍으면 따로 짚어준다', () => {
    const flat = weeks(
      Array.from({ length: 5 }, () => ({ exerciseId: BENCH, weightKg: 70, reps: 10, rir: 2 })),
    );
    const result = calibrateRir(flat, { asOf: '2026-09-10' });
    assert.ok(result.signals.some((signal) => signal.includes('같은 RIR')));
  });

  it('워밍업 세트는 기준으로 쓰지 않는다', () => {
    const withWarmup = weeks([
      { exerciseId: BENCH, weightKg: 40, reps: 10, rir: 0, warmup: true },
      { exerciseId: BENCH, weightKg: 80, reps: 8, rir: 3 },
    ]);
    assert.equal(calibrateRir(withWarmup, { asOf: '2026-09-10' }).anchorCount, 0);
  });

  it('보정값은 과하게 튀지 않도록 묶어둔다', () => {
    const extreme = weeks([
      { exerciseId: BENCH, weightKg: 100, reps: 10, rir: 0 },
      { exerciseId: BENCH, weightKg: 40, reps: 5, rir: 5 },
      { exerciseId: BENCH, weightKg: 40, reps: 5, rir: 5 },
      { exerciseId: BENCH, weightKg: 40, reps: 5, rir: 5 },
    ]);
    const result = calibrateRir(extreme, { asOf: '2026-09-10' });
    assert.ok(result.offset >= -3 && result.offset <= 1);
  });
});

describe('보정 적용', () => {
  it('세트와 세션에 보정을 입힌 사본을 만든다', () => {
    const calibration = calibrateRir(OVER_REPORTER, { asOf: '2026-09-10' });
    const original = OVER_REPORTER[0]!.sets;
    const corrected = applyCalibration(original, calibration);

    assert.ok(corrected[1]!.rir < original[1]!.rir);
    assert.equal(original[1]!.rir, 3, '원본은 그대로 둔다');
    assert.equal(calibrateSessions(OVER_REPORTER, calibration)[0]!.sets.length, original.length);
  });

  it('0~5 밖으로 나가지 않는다', () => {
    const calibration = { ...calibrateRir(OVER_REPORTER, { asOf: '2026-09-10' }), offset: -5, applied: true };
    assert.equal(correctedRir(1, calibration), 0);
    assert.equal(correctedRir(5, { ...calibration, offset: 5 }), 5);
  });

  it('보정된 RIR로 유효 세트를 다시 센다', () => {
    // RIR 5로 신고된 세트는 0.3만 인정되지만, 실제로 RIR 1이었다면 온전한 1세트다
    const set: SetLog = { exerciseId: BENCH, weightKg: 70, reps: 10, rir: 5 };
    assert.equal(setEffectiveness(set), 0.3);
    assert.equal(setEffectiveness(set, { rirOffset: -4 }), 1);
  });

  it('과대 신고자의 볼륨은 보정 후 더 크게 잡힌다', () => {
    const log = [session('2026-09-14', sets(BENCH, 4, { weightKg: 70, reps: 10, rir: 5 }))];
    const raw = aggregateVolume(log, index).chest.effectiveSets;
    const corrected = aggregateVolume(log, index, { rirOffset: -3 }).chest.effectiveSets;
    assert.ok(corrected > raw);
  });

  it('보정이 증량 처방을 막아준다', () => {
    const bench = exerciseById(BENCH) as Exercise;
    const last: SetLog[] = [{ exerciseId: BENCH, weightKg: 80, reps: 12, rir: 3 }];
    const rule = { repRange: { min: 8, max: 12 }, targetRir: 2 };

    const naive = prescribeLoad(bench, last, rule);
    const calibrated = prescribeLoad(bench, last, { ...rule, rirOffset: -2 });

    assert.equal(naive.change, 'increase', '신고를 그대로 믿으면 올린다');
    assert.equal(calibrated.change, 'hold', '실제로는 여유가 없었으므로 유지한다');
    assert.match(calibrated.reason, /보정/, '보정 사실을 사용자에게 숨기지 않는다');
  });
});

describe('calibrateByExercise', () => {
  it('종목별로 따로 본다', () => {
    const mixed = OVER_REPORTER.map((log) => ({
      ...log,
      sets: [...log.sets, { exerciseId: 'back-squat', weightKg: 100, reps: 5, rir: 2 }],
    }));
    const byExercise = calibrateByExercise(mixed, index, { asOf: '2026-09-10' });

    assert.equal(byExercise.length, 1, '기준 세트가 있는 종목만 나온다');
    assert.equal(byExercise[0]?.exerciseId, BENCH);
    assert.equal(byExercise[0]?.name, '바벨 벤치프레스');
  });
});
