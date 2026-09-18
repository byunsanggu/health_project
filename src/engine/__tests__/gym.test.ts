import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  DEFAULT_GYM,
  availableEquipmentOf,
  describePlates,
  isAvailableAt,
  loadableWeights,
  loadingFor,
  nearestLoadable,
  platePlan,
  stepAround,
  type BarbellLoading,
  type StackLoading,
} from '../gym.ts';
import { exerciseById } from '../exercises.ts';
import type { Exercise } from '../types.ts';

const bench = exerciseById('barbell-bench-press') as Exercise;
const pushdown = exerciseById('triceps-pushdown') as Exercise;
const legPress = exerciseById('leg-press') as Exercise;

const olympic: BarbellLoading = {
  kind: 'barbell',
  barKg: 20,
  plates: [25, 20, 15, 10, 5, 2.5, 1.25],
};

describe('loadableWeights', () => {
  it('빈 바부터 시작하고 좌우 대칭으로만 만든다', () => {
    const weights = loadableWeights(olympic);
    assert.equal(weights[0], 20, '빈 바');
    assert.ok(weights.includes(22.5), '1.25kg 한 쌍');
    assert.ok(!weights.includes(21.25), '한쪽에만 끼울 수는 없다');
  });

  it('보유하지 않은 플레이트로는 만들 수 없는 중량을 내지 않는다', () => {
    // 25와 10만 있는 헬스장
    const sparse: BarbellLoading = { kind: 'barbell', barKg: 20, plates: [25, 10] };
    const weights = loadableWeights(sparse);
    assert.ok(weights.includes(40), '20 + 10×2');
    assert.ok(!weights.includes(45), '2.5kg 한 쌍이 없으므로 불가능');
  });

  it('플레이트 보유 개수를 반영한다', () => {
    const limited: BarbellLoading = {
      kind: 'barbell', barKg: 20, plates: [20], plateCounts: { 20: 1 },
    };
    assert.deepEqual(loadableWeights(limited), [20, 60], '한쪽에 한 장까지만');
  });

  it('스택은 보조추까지 계산한다', () => {
    const stack: StackLoading = { kind: 'stack', minKg: 5, stepKg: 5, maxKg: 20, addOnKg: [2.5] };
    assert.deepEqual(loadableWeights(stack), [5, 7.5, 10, 12.5, 15, 17.5, 20, 22.5]);
  });

  it('플레이트식 머신은 빈 캐리지 무게부터 센다', () => {
    const spec = loadingFor(legPress, DEFAULT_GYM)!;
    const weights = loadableWeights(spec);
    assert.equal(weights[0], 20, '캐리지만 20kg');
  });

  it('덤벨은 보유한 것만 쓸 수 있다', () => {
    const spec = loadingFor(exerciseById('seated-dumbbell-press') as Exercise, DEFAULT_GYM)!;
    const weights = loadableWeights(spec);
    assert.ok(weights.includes(22));
    assert.ok(!weights.includes(23), '23kg 덤벨은 없다');
  });
});

describe('nearestLoadable', () => {
  const spec = loadingFor(pushdown, DEFAULT_GYM)!;

  it('가장 가까운 눈금으로 맞춘다', () => {
    assert.equal(nearestLoadable(36, spec), 35);
    assert.equal(nearestLoadable(36.5, spec), 37.5);
  });

  it('방향을 지정하면 의도를 잃지 않는다', () => {
    assert.equal(nearestLoadable(36, spec, 'up'), 37.5, '증량 중이면 위로');
    assert.equal(nearestLoadable(36, spec, 'down'), 35, '감량 중이면 아래로');
  });

  it('기구 범위를 벗어나면 가장 가까운 끝으로 붙인다', () => {
    assert.equal(nearestLoadable(500, spec, 'up'), 102.5);
    assert.equal(nearestLoadable(1, spec, 'down'), 5);
  });
});

describe('stepAround', () => {
  it('기구마다 한 칸의 크기가 다르다', () => {
    assert.equal(stepAround(80, olympic), 2.5, '올림픽 바는 1.25kg 한 쌍');
    assert.equal(stepAround(160, loadingFor(legPress, DEFAULT_GYM)!), 10, '레그프레스는 5kg 한 쌍 × 양쪽');
    assert.equal(stepAround(50, loadingFor(pushdown, DEFAULT_GYM)!), 2.5, '스택 + 보조추');
  });
});

describe('platePlan', () => {
  it('한쪽에 끼울 플레이트를 무거운 것부터 알려준다', () => {
    const plan = platePlan(82.5, olympic)!;
    assert.equal(plan.baseKg, 20);
    assert.deepEqual(plan.perSide, [25, 5, 1.25]);
    assert.equal(plan.totalKg, 82.5);
  });

  it('플레이트 합계가 항상 처방 중량과 맞는다', () => {
    for (const target of [60, 72.5, 100, 137.5]) {
      const plan = platePlan(target, olympic)!;
      const sum = plan.baseKg + plan.perSide.reduce((acc, plate) => acc + plate, 0) * 2;
      assert.equal(sum, plan.totalKg, `${target}kg`);
    }
  });

  it('빈 바면 플레이트가 없다', () => {
    assert.deepEqual(platePlan(20, olympic)!.perSide, []);
    assert.match(describePlates(platePlan(20, olympic)), /빈 바/);
  });

  it('스택 머신에는 플레이트 계산이 없다', () => {
    assert.equal(platePlan(50, loadingFor(pushdown, DEFAULT_GYM)!), null);
  });

  it('사람이 읽을 수 있는 한 줄로 바꿔준다', () => {
    assert.equal(describePlates(platePlan(100, olympic)), '20kg + 한쪽 25 · 15');
  });
});

describe('보유 기구', () => {
  it('종목 단위로 없다고 표시할 수 있다', () => {
    const gym = { ...DEFAULT_GYM, overrides: { 'hack-squat': 'unavailable' as const } };
    assert.equal(isAvailableAt(exerciseById('hack-squat') as Exercise, gym), false);
    assert.equal(loadingFor(exerciseById('hack-squat') as Exercise, gym), null);
  });

  it('기구 종류 단위로 없다고 하면 관련 종목이 전부 빠진다', () => {
    const gym = { ...DEFAULT_GYM, missingEquipment: ['cable' as const] };
    assert.equal(isAvailableAt(pushdown, gym), false);
    assert.ok(!availableEquipmentOf(gym).includes('cable'));
    assert.ok(availableEquipmentOf(gym).includes('barbell'));
  });

  it('기본 프로필은 흔한 예외를 이미 담고 있다', () => {
    const curl = loadingFor(exerciseById('barbell-curl') as Exercise, DEFAULT_GYM)!;
    assert.equal(curl.kind, 'barbell');
    assert.equal((curl as BarbellLoading).barKg, 10, '컬은 EZ바');
    assert.equal(loadingFor(bench, DEFAULT_GYM)!.kind, 'barbell');
    assert.equal(loadingFor(legPress, DEFAULT_GYM)!.kind, 'plateLoaded');
  });
});
