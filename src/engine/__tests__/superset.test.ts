import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  MAX_GROUP,
  checkAdd,
  checkPair,
  circuitTiming,
  groupKind,
  groupLabel,
  groupOf,
  orderWithGroups,
  pruneGroups,
  supersetTiming,
  transitionRest,
} from '../superset.ts';
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

describe('크로스핏 세트 — 셋 이상 묶기', () => {
  it('둘이면 슈퍼세트, 셋이면 크로스핏 세트다', () => {
    assert.equal(groupKind(['a', 'b']), 'superset');
    assert.equal(groupKind(['a', 'b', 'c']), 'circuit');
    assert.equal(groupLabel(['a', 'b']), '슈퍼세트');
    assert.equal(groupLabel(['a', 'b', 'c']), '크로스핏 세트');
  });

  it('넣으려는 종목을 이미 있는 것들과 하나씩 다 따진다', () => {
    /*
     * 데드리프트가 이미 들어 있는 바퀴에 바벨 로우를 더하면, 벤치프레스와는
     * 괜찮아도 데드리프트와 막힌다. 하나라도 막히면 못 넣는다.
     */
    const check = checkAdd(
      [by('conventional-deadlift'), by('machine-chest-press')],
      by('barbell-row'),
    );
    assert.equal(check.allowed, false);
    assert.match(check.reason, /허리/);
  });

  it('허리 쓰는 종목이 하나 있으면 맨 앞에 두라고 한다', () => {
    /*
     * 막지는 않는다. 다만 바퀴 후반에는 숨이 차 있고, 그 상태로 허리에
     * 실리는 걸 들면 반복이 아니라 자세가 먼저 떨어진다.
     */
    const check = checkAdd(
      [by('conventional-deadlift'), by('machine-chest-press')],
      by('lateral-raise'),
    );
    assert.equal(check.allowed, true);
    assert.equal(check.quality, 'caution');
    assert.match(check.reason, /맨 앞/);
  });

  it('둘만 묶을 때는 맨 앞 이야기를 하지 않는다', () => {
    // 슈퍼세트는 바퀴가 짧다. 순서 잔소리를 할 자리가 아니다.
    const check = checkAdd([by('conventional-deadlift')], by('machine-chest-press'));
    assert.doesNotMatch(check.reason, /맨 앞/);
  });

  it('같은 종목은 두 번 넣지 못한다', () => {
    const check = checkAdd([by('lat-pulldown'), by('lateral-raise')], by('lat-pulldown'));
    assert.equal(check.allowed, false);
  });

  it('다섯을 넘기지 않는다', () => {
    /*
     * 더 늘리면 한 바퀴가 너무 길어져서, 첫 종목으로 돌아왔을 때 이미
     * 회복이 끝나 있다. 그러면 묶은 뜻이 없다.
     */
    const five = [
      by('barbell-bench-press'),
      by('lat-pulldown'),
      by('lateral-raise'),
      by('barbell-curl'),
      by('triceps-pushdown'),
    ];
    assert.equal(five.length, MAX_GROUP);
    const check = checkAdd(five, by('leg-press'));
    assert.equal(check.allowed, false);
    assert.match(check.reason, new RegExp(String(MAX_GROUP)));
  });

  it('부위가 다르면 넷까지도 그냥 묶인다', () => {
    const check = checkAdd(
      [by('barbell-bench-press'), by('lat-pulldown'), by('lateral-raise')],
      by('hammer-curl'),
    );
    assert.equal(check.allowed, true);
    assert.equal(check.quality, 'fine');
  });

  it('원판 갈아야 하는 것끼리는 넷째라도 주의를 준다', () => {
    /*
     * 벤치프레스와 바벨 컬은 둘 다 원판을 끼운다. 이론상 번갈아 되지만
     * 매 바퀴 무게를 바꿔야 해서 현장에서 안 된다.
     */
    const check = checkAdd(
      [by('barbell-bench-press'), by('lat-pulldown'), by('lateral-raise')],
      by('barbell-curl'),
    );
    assert.equal(check.allowed, true);
    assert.equal(check.quality, 'caution');
    assert.match(check.reason, /원판/);
  });
});

describe('크로스핏 세트 휴식', () => {
  it('바퀴가 길수록 바퀴 뒤에 더 쉰다', () => {
    /*
     * 다섯 동작을 연달아 하고 나면 숨이 찬 정도가 다르다. 여기서 휴식을
     * 깎으면 다음 바퀴의 첫 종목이 무너지고, 아낀 시간만큼 볼륨을 잃는다.
     */
    const two = circuitTiming([by('barbell-bench-press'), by('lat-pulldown')], 70);
    const four = circuitTiming(
      [by('barbell-bench-press'), by('lat-pulldown'), by('lateral-raise'), by('barbell-curl')],
      70,
    );
    assert.equal(two.afterSeconds, 70);
    assert.ok(four.afterSeconds > two.afterSeconds);
  });

  it('종목이 늘수록 한 바퀴에 아끼는 시간도 는다', () => {
    const three = circuitTiming(
      [by('barbell-bench-press'), by('lat-pulldown'), by('lateral-raise')],
      70,
    );
    const two = circuitTiming([by('barbell-bench-press'), by('lat-pulldown')], 70);
    assert.ok(three.savedSeconds > two.savedSeconds);
  });

  it('혼자면 아끼는 것이 없다', () => {
    const one = circuitTiming([by('barbell-bench-press')], 70);
    assert.equal(one.savedSeconds, 0);
    assert.equal(one.afterSeconds, 70);
  });

  it('슈퍼세트 계산은 그대로다', () => {
    // 둘을 묶은 것은 종목 두 개짜리 바퀴와 같은 계산이어야 한다.
    const pair = supersetTiming(by('barbell-bench-press'), by('lat-pulldown'), 70);
    const circuit = circuitTiming([by('barbell-bench-press'), by('lat-pulldown')], 70);
    assert.deepEqual(pair, circuit);
  });

  it('같은 근육으로 이어지면 옮기는 시간보다 더 준다', () => {
    // 바로 이어가면 반복이 절반으로 떨어진다.
    assert.equal(transitionRest(by('lateral-raise'), by('cable-lateral-raise')), 45);
    assert.equal(transitionRest(by('barbell-bench-press'), by('lat-pulldown')), 20);
  });
});

describe('셋 이상 묶음 정리', () => {
  it('넷 중 하나가 빠져도 나머지는 살린다', () => {
    // 하나 빠졌다고 나머지 셋까지 버릴 이유는 없다.
    assert.deepEqual(pruneGroups([['a', 'b', 'c', 'd']], ['a', 'c', 'd']), [['a', 'c', 'd']]);
  });

  it('하나만 남으면 버린다', () => {
    assert.deepEqual(pruneGroups([['a', 'b', 'c']], ['b']), []);
  });

  it('바퀴를 나란히 끌어온다', () => {
    const groups: SupersetGroup[] = [['a', 'b', 'c']];
    assert.deepEqual(orderWithGroups(['a', 'x', 'b', 'y', 'c'], groups), ['a', 'b', 'c', 'x', 'y']);
  });
});
