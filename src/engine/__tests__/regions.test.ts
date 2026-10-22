import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { BODY_REGIONS, MUSCLE_GROUPS, groupByRegion, regionOf } from '../muscles.ts';
import { EXERCISES } from '../exercises.ts';
import { primaryMuscle } from '../session.ts';

const byId = (id: string) => EXERCISES.find((exercise) => exercise.id === id)!;

describe('부위로 묶기 — 가슴 · 등 · 어깨 · 팔 · 하체 · 코어', () => {
  it('근육 열네 개가 모두 한 부위에만 들어간다', () => {
    for (const muscle of MUSCLE_GROUPS) {
      const holders = BODY_REGIONS.filter((region) => region.muscles.includes(muscle));
      assert.equal(holders.length, 1, muscle);
    }
    assert.equal(regionOf('sideDelt'), 'shoulders');
    assert.equal(regionOf('traps'), 'back');
    assert.equal(regionOf(undefined), null);
  });

  it('가슴은 가슴끼리, 등은 등끼리 — 섞여 들어온 목록도 묶는다', () => {
    const mixed = ['dumbbell-bench-press', 'lat-pulldown', 'barbell-overhead-press', 'incline-dumbbell-press', 'barbell-row', 'cable-lateral-raise']
      .map(byId);
    const groups = groupByRegion(mixed, primaryMuscle);
    assert.deepEqual(groups.map((group) => group.label), ['가슴', '등', '어깨']);
    assert.deepEqual(groups[0]!.items.map((item) => item.id), ['dumbbell-bench-press', 'incline-dumbbell-press']);
    assert.deepEqual(groups[1]!.items.map((item) => item.id), ['lat-pulldown', 'barbell-row']);
  });

  it('오늘 쓰는 부위를 앞에 둔다 — 하체 날에 가슴이 맨 위에 오지 않는다', () => {
    const groups = groupByRegion(EXERCISES, primaryMuscle, ['quads', 'hamstrings']);
    assert.equal(groups[0]!.label, '하체');
    // 나머지는 정해 둔 차례
    assert.deepEqual(groups.slice(1, 3).map((group) => group.label), ['가슴', '등']);
  });

  it('모든 종목이 어느 묶음엔가 들어간다', () => {
    const groups = groupByRegion(EXERCISES, primaryMuscle);
    assert.equal(groups.reduce((sum, group) => sum + group.items.length, 0), EXERCISES.length);
  });
});
