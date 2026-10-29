import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { LOW_CONDITION } from '../coach.ts';
import { dayFeelLabel, effectiveCondition, lightenForLowDay } from '../dayFeel.ts';

describe('오늘 컨디션 — 직접 고르기', () => {
  it('고른 것이 기록보다 먼저다', () => {
    assert.equal(effectiveCondition(null, 85), 85);
    assert.equal(effectiveCondition('ok', 55), 55);
    assert.ok(effectiveCondition('low', 95) < LOW_CONDITION);
    assert.ok(effectiveCondition('good', 40) >= LOW_CONDITION);
    assert.equal(dayFeelLabel('low'), '별로예요');
  });

  it('별로인 날 — 한 세트 덜, 무게 5% 덜, 무거운 세트는 건너뜀', () => {
    const items = [
      { id: 'squat', sets: [{ weightKg: 120, top: true }, { weightKg: 100 }, { weightKg: 100 }, { weightKg: 100 }, { weightKg: 100 }] },
      { id: 'curl', sets: [{ weightKg: 10 }, { weightKg: 10 }] },
      { id: 'push-up', sets: [{ weightKg: null }, { weightKg: null }, { weightKg: null }] },
    ];
    const out = lightenForLowDay(items, (kg) => Math.floor(kg / 2.5) * 2.5);
    assert.deepEqual(out[0]!.sets.map((set) => set.weightKg), [95, 95, 95]);
    assert.ok(out[0]!.sets.every((set) => !('top' in set) || !set.top));
    // 두 세트짜리는 그대로 두 세트
    assert.equal(out[1]!.sets.length, 2);
    // 맨몸은 무게 없이 세트만 하나 덜
    assert.deepEqual(out[2]!.sets, [{ weightKg: null }, { weightKg: null }]);
  });

  it('운동 중에 바꿔도 이미 끝낸 세트는 지우지 않는다', () => {
    const items = [{ id: 'bench', sets: [{ weightKg: 80 }, { weightKg: 80 }, { weightKg: 80 }, { weightKg: 80 }] }];
    const out = lightenForLowDay(items, (kg) => kg, () => 4);
    assert.equal(out[0]!.sets.length, 4);
  });
});
