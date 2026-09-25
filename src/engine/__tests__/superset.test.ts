import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { checkPair, groupOf, orderWithGroups, pruneGroups, supersetTiming } from '../superset.ts';
import { EXERCISES } from '../exercises.ts';
import type { Exercise } from '../types.ts';
import type { SupersetGroup } from '../superset.ts';

const by = (id: string) => EXERCISES.find((exercise) => exercise.id === id) as Exercise;

describe('슈퍼세트 짝 판정', () => {
  it('길항근이 제일 좋다', () => {
    const check = checkPair(by('barbell-curl'), by('triceps-pushdown'));
    assert.equal(check.quality, 'best');
    assert.equal(check.allowed, true);
  });

  it('허리가 실리는 둘은 막는다', () => {
    /*
     * 시간을 아끼자고 감수할 것이 아니다. 번갈아 하면 허리가 쉴 틈이 없고,
     * 자세가 무너지는 곳이 하필 제일 위험한 곳이다.
     */
    const check = checkPair(by('conventional-deadlift'), by('barbell-row'));
    assert.equal(check.quality, 'blocked');
    assert.equal(check.allowed, false);
  });

  it('같은 종목끼리는 못 묶는다', () => {
    assert.equal(checkPair(by('barbell-curl'), by('barbell-curl')).allowed, false);
  });

  it('원판 기구끼리는 막지 않되 알린다', () => {
    // 이론상 되지만 세트마다 원판을 갈아야 한다. 현장에서 안 되는 이유다.
    const check = checkPair(by('barbell-bench-press'), by('barbell-row'));
    assert.equal(check.quality, 'caution');
    assert.equal(check.allowed, true);
    assert.match(check.reason, /무게를 바꿔야/);
  });

  it('같은 부위는 강도가 준다고 말한다', () => {
    const check = checkPair(by('cable-fly'), by('dumbbell-bench-press'));
    assert.equal(check.quality, 'caution');
    assert.match(check.reason, /무게가 떨어집니다/);
  });

  it('상관없는 부위는 그냥 괜찮다', () => {
    assert.equal(checkPair(by('lateral-raise'), by('leg-press')).quality, 'fine');
  });

  it('조사가 종목 이름에 맞는다', () => {
    // "컨벤셔널 데드리프트와" — 받침 없는 이름
    assert.match(checkPair(by('conventional-deadlift'), by('barbell-row')).reason, /데드리프트와/);
    // "굿모닝과" — 받침 있는 이름
    assert.match(checkPair(by('good-morning'), by('barbell-row')).reason, /굿모닝과/);
  });
});

describe('슈퍼세트 휴식', () => {
  it('두 번 쉴 것을 한 번만 쉰다', () => {
    /*
     * 슈퍼세트는 "쉬지 않고 하는 것"이 아니다. 한 바퀴를 마친 뒤에는
     * 원래대로 쉬어야 하고, 아끼는 건 사이 휴식 한 번이다.
     */
    const timing = supersetTiming(by('barbell-curl'), by('triceps-pushdown'), 70);
    assert.equal(timing.afterSeconds, 70, '바퀴 뒤 휴식은 깎지 않는다');
    assert.ok(timing.betweenSeconds < timing.afterSeconds);
    assert.equal(timing.savedSeconds, 70 * 2 - (timing.betweenSeconds + timing.afterSeconds));
  });

  it('같은 부위면 사이 휴식을 더 준다', () => {
    // 같은 근육을 또 쓰는데 바로 이어가면 반복이 절반으로 떨어진다.
    const same = supersetTiming(by('cable-fly'), by('dumbbell-bench-press'), 70);
    const anta = supersetTiming(by('barbell-curl'), by('triceps-pushdown'), 70);
    assert.ok(same.betweenSeconds > anta.betweenSeconds);
    assert.ok(same.savedSeconds < anta.savedSeconds);
  });

  it('아끼는 시간이 음수가 되지 않는다', () => {
    // 휴식이 아주 짧으면 사이 휴식만으로도 넘어설 수 있다.
    assert.ok(supersetTiming(by('barbell-curl'), by('triceps-pushdown'), 20).savedSeconds >= 0);
  });
});

describe('묶음 관리', () => {
  const groups: SupersetGroup[] = [['a', 'b'], ['c', 'd']];

  it('속한 짝을 찾는다', () => {
    assert.deepEqual(groupOf(groups, 'b'), ['a', 'b']);
    assert.equal(groupOf(groups, 'z'), undefined);
  });

  it('한쪽이 사라진 묶음은 버린다', () => {
    // 한쪽이 없는 슈퍼세트는 그냥 단일 종목이다.
    assert.deepEqual(pruneGroups(groups, ['a', 'c', 'd']), [['c', 'd']]);
  });

  it('짝을 나란히 끌어온다', () => {
    // 떨어져 있으면 번갈아 할 수가 없다.
    assert.deepEqual(orderWithGroups(['a', 'c', 'b', 'd'], groups), ['a', 'b', 'c', 'd']);
  });

  it('앞에 둔 것은 앞에 남는다', () => {
    // 순서를 직접 바꾼 의도는 지키면서 짝만 끌어온다.
    assert.deepEqual(orderWithGroups(['c', 'a', 'd', 'b'], groups), ['c', 'd', 'a', 'b']);
  });

  it('목록에 없는 짝은 끌어오지 않는다', () => {
    assert.deepEqual(orderWithGroups(['a', 'c'], groups), ['a', 'c']);
  });

  it('묶음이 없으면 그대로 둔다', () => {
    assert.deepEqual(orderWithGroups(['b', 'a'], []), ['b', 'a']);
  });
});
