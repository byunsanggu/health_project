import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  adjustWithinSession,
  estimate1RM,
  prescribeLoad,
  roundToIncrement,
  topWorkingSet,
  type LoadRule,
} from '../load.ts';
import { exerciseById } from '../exercises.ts';
import type { Exercise, SetLog } from '../types.ts';

const bench = exerciseById('barbell-bench-press') as Exercise;
const squat = exerciseById('back-squat') as Exercise;
const rule: LoadRule = { repRange: { min: 8, max: 12 }, targetRir: 2 };

function set(partial: Partial<SetLog> = {}): SetLog {
  return { exerciseId: bench.id, weightKg: 70, reps: 10, rir: 2, ...partial };
}

describe('estimate1RM', () => {
  it('RIR을 더해 실제 수행 가능 반복으로 환산한다', () => {
    const failed = estimate1RM({ weightKg: 100, reps: 10, rir: 0 });
    const withReserve = estimate1RM({ weightKg: 100, reps: 10, rir: 3 });
    assert.ok(withReserve > failed, '여유가 있었다면 1RM 추정치가 더 높다');
  });

  it('1회 이하는 그 중량을 그대로 본다', () => {
    assert.equal(estimate1RM({ weightKg: 150, reps: 1, rir: 0 }), 150);
  });
});

describe('roundToIncrement', () => {
  it('증량 단위에 맞춰 반올림한다', () => {
    assert.equal(roundToIncrement(71.3, 2.5), 72.5);
    assert.equal(roundToIncrement(103, 5), 105);
  });

  it('맨몸 운동은 반올림하지 않는다', () => {
    assert.equal(roundToIncrement(72.4, 0), 72.4);
  });
});

describe('topWorkingSet', () => {
  it('가장 무거운 본세트를 고르고 워밍업은 뺀다', () => {
    const chosen = topWorkingSet(
      [
        set({ weightKg: 100, reps: 5, rir: 5, warmup: true }),
        set({ weightKg: 80, reps: 8 }),
        set({ weightKg: 80, reps: 10 }),
      ],
      bench.id,
    );
    assert.equal(chosen?.weightKg, 80);
    assert.equal(chosen?.reps, 10, '같은 중량이면 반복이 많은 세트');
  });

  it('기록이 없으면 undefined', () => {
    assert.equal(topWorkingSet([], bench.id), undefined);
  });
});

describe('prescribeLoad', () => {
  it('첫 수행이면 중량을 정해주지 않고 시작 안내만 한다', () => {
    const result = prescribeLoad(bench, undefined, rule);
    assert.equal(result.change, 'start');
    assert.equal(result.weightKg, null);
  });

  it('반복 상단 + RIR 여유 → 증량', () => {
    const result = prescribeLoad(bench, [set({ reps: 12, rir: 3 })], rule);
    assert.equal(result.change, 'increase');
    assert.equal(result.weightKg, 72.5);
  });

  it('여유가 크면 두 칸 올린다', () => {
    const result = prescribeLoad(bench, [set({ reps: 12, rir: 4 })], rule);
    assert.equal(result.weightKg, 75, 'RIR 여유 2 이상이면 증량 폭이 두 배');
  });

  it('반복은 채웠지만 실패 직전이면 올리지 않는다', () => {
    const result = prescribeLoad(bench, [set({ reps: 12, rir: 0 })], rule);
    assert.equal(result.change, 'hold');
    assert.equal(result.weightKg, 70, 'RIR부터 확보하는 것이 먼저다');
  });

  it('목표 반복에 못 미쳤는데 너무 가벼우면 증량한다', () => {
    const result = prescribeLoad(bench, [set({ reps: 9, rir: 4 })], rule);
    assert.equal(result.change, 'increase');
  });

  it('목표 하단에도 못 미치면 10% 감량한다', () => {
    const result = prescribeLoad(bench, [set({ reps: 6, rir: 0 })], rule);
    assert.equal(result.change, 'decrease');
    assert.equal(result.weightKg, 62.5);
    assert.ok(result.deltaKg < 0);
  });

  it('범위 안이면 중량 유지하고 반복을 1회 늘린다', () => {
    const result = prescribeLoad(bench, [set({ reps: 10, rir: 2 })], rule);
    assert.equal(result.change, 'hold');
    assert.equal(result.weightKg, 70);
    assert.equal(result.targetReps.min, 11);
  });

  it('종목별 증량 단위를 따른다', () => {
    const result = prescribeLoad(
      squat,
      [{ exerciseId: squat.id, weightKg: 100, reps: 12, rir: 3 }],
      rule,
    );
    assert.equal(result.weightKg, 105, '하체 바벨은 5kg 단위');
  });

  it('처방에는 항상 사용자에게 보여줄 근거가 붙는다', () => {
    for (const last of [set({ reps: 12, rir: 3 }), set({ reps: 6, rir: 0 }), set()]) {
      assert.ok(prescribeLoad(bench, [last], rule).reason.length > 0);
    }
  });
});

describe('adjustWithinSession', () => {
  it('세트가 너무 가벼웠으면 다음 세트를 올린다', () => {
    const result = adjustWithinSession(bench, set({ reps: 12, rir: 4 }), rule);
    assert.ok(result.deltaKg > 0);
  });

  it('실패했는데 반복도 못 채웠으면 다음 세트를 낮춘다', () => {
    const result = adjustWithinSession(bench, set({ reps: 5, rir: 0 }), rule);
    assert.ok(result.deltaKg < 0);
  });

  it('목표대로 했으면 중량을 유지한다', () => {
    const result = adjustWithinSession(bench, set({ reps: 10, rir: 2 }), rule);
    assert.equal(result.deltaKg, 0);
  });
});
