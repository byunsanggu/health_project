import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  ENOUGH_DAYS,
  PROTEIN_FOODS,
  PROTEIN_PER_KG,
  bodyGoalOf,
  mealIdeas,
  perMealG,
  proteinHint,
  proteinRisk,
  proteinTargetG,
  proteinWeek,
} from '../protein.ts';
import type { CheckIn } from '../types.ts';

const day = (n: number, base = '2026-09-10'): string =>
  new Date(Date.parse(base + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);

describe('하루 목표', () => {
  it('감량기에 더 먹는다 — 적자에서 근육이 먼저 나간다', () => {
    assert.ok(PROTEIN_PER_KG.cut > PROTEIN_PER_KG.hold);
    assert.ok(proteinTargetG(80, 'cut') > proteinTargetG(80, 'hold'));
  });

  it('5g 단위로 끊는다', () => {
    for (const kg of [52, 63.4, 78, 91, 104]) {
      assert.equal(proteinTargetG(kg, 'cut') % 5, 0, `${kg}kg`);
    }
  });

  it('아주 무거운 사람에게 먹을 수 없는 양을 주지 않는다', () => {
    /* 체지방은 단백질을 요구하지 않는다. 비례를 그대로 쓰면 하루 300g이 나온다. */
    assert.equal(proteinTargetG(150, 'cut'), proteinTargetG(110, 'cut'));
    assert.ok(proteinTargetG(150, 'cut') <= 220);
  });

  it('체중이 없으면 0이다 — 아무 숫자나 지어내지 않는다', () => {
    assert.equal(proteinTargetG(0, 'cut'), 0);
    assert.equal(proteinTargetG(Number.NaN, 'cut'), 0);
  });

  it('목표 조합에서 방향을 읽는다', () => {
    assert.equal(bodyGoalOf(['fatLoss']), 'cut');
    assert.equal(bodyGoalOf(['fatLoss', 'hypertrophy']), 'cut', '감량이 섞이면 감량 쪽이다');
    assert.equal(bodyGoalOf(['hypertrophy']), 'grow');
    assert.equal(bodyGoalOf(['general']), 'hold');
    assert.equal(bodyGoalOf([]), 'hold');
  });
});

describe('감 잡는 말', () => {
  it('하루치를 닭가슴살 몇 덩이로 환산하지 않는다', () => {
    /*
     * "하루 일곱 덩이"는 하루를 통째로 닭으로 때우라는 그림이라
     * 보는 순간 포기한다. 한 끼에 얼마인지로 말해야 오늘 저녁에 쓴다.
     */
    const hint = proteinHint(proteinTargetG(78, 'cut'));
    assert.match(hint, /세 끼에/);
    assert.doesNotMatch(hint, /덩이쯤/);
  });

  it('조사가 어색하지 않다', () => {
    const hint = proteinHint(155);
    assert.doesNotMatch(hint, /덩이이|개이 /);
    assert.match(hint, /덩이가/);
  });

  it('목표가 없으면 아무 말도 하지 않는다', () => {
    assert.equal(proteinHint(0), '');
  });

  it('한 끼 양도 5g 단위다', () => {
    assert.equal(perMealG(155) % 5, 0);
    assert.equal(perMealG(0), 0);
    assert.equal(perMealG(150, 0), 0);
  });

  it('음식표는 한국에서 먹는 것들이고 숫자가 말이 된다', () => {
    assert.ok(PROTEIN_FOODS.length >= 8);
    for (const food of PROTEIN_FOODS) {
      assert.ok(food.gram > 0 && food.gram < 60, food.name);
      assert.ok(food.serving.length > 0, food.name);
    }
  });
});

describe('지킨 날', () => {
  const week = (flags: (boolean | undefined)[]): CheckIn[] =>
    flags.map((hit, i) => ({ date: day(i), proteinHit: hit }) as CheckIn);
  const today = day(6);

  it('답하지 않은 날은 실패로 세지 않는다', () => {
    const result = proteinWeek(week([true, undefined, true]), today);
    assert.equal(result.answered, 2);
    assert.equal(result.hits, 2);
  });

  it('7일 밖은 보지 않는다', () => {
    const old: CheckIn[] = [{ date: day(-10), proteinHit: true } as CheckIn];
    assert.equal(proteinWeek(old, today).answered, 0);
  });

  it('같은 날이 여럿이면 나중 것만 센다', () => {
    const twice: CheckIn[] = [
      { date: day(3), proteinHit: false } as CheckIn,
      { date: day(3), proteinHit: true } as CheckIn,
    ];
    const result = proteinWeek(twice, today);
    assert.equal(result.answered, 1);
    assert.equal(result.hits, 1);
  });

  it('오늘 답했는지 따로 안다', () => {
    const none = proteinWeek(week([true, true]), today);
    assert.equal(none.answeredToday, false);
    const done = proteinWeek([{ date: today, proteinHit: false } as CheckIn], today);
    assert.equal(done.answeredToday, true);
    assert.equal(done.hitToday, false);
  });

  it('나흘이면 충분하다고 말한다 — 완벽을 요구하지 않는다', () => {
    const result = proteinWeek(week(Array.from({ length: ENOUGH_DAYS }, () => true)), today);
    assert.match(result.message, /충분/);
  });

  it('못 채운 주에도 혼내지 않는다', () => {
    const result = proteinWeek(week([false, false, false]), today);
    assert.doesNotMatch(result.message, /실패|안 됩니다|왜/);
  });
});

describe('겹칠 때만 경고한다', () => {
  const answered = (hits: number, total: number): CheckIn[] =>
    Array.from({ length: total }, (_, i) => ({ date: day(i), proteinHit: i < hits }) as CheckIn);
  const today = day(6);

  it('감량 중 + 단백질 모자람이면 경고한다', () => {
    const week = proteinWeek(answered(0, 4), today);
    assert.ok(proteinRisk(week, 'cut', true));
  });

  it('잘하고 있는 주에는 뜨지 않는다 — 나흘 중 사흘은 잘한 것이다', () => {
    const week = proteinWeek(answered(3, 4), today);
    assert.equal(proteinRisk(week, 'cut', true), null);
  });

  it('감량 중이 아니면 뜨지 않는다', () => {
    const week = proteinWeek(answered(0, 4), today);
    assert.equal(proteinRisk(week, 'cut', false), null);
    assert.equal(proteinRisk(week, 'grow', true), null);
  });

  it('아직 며칠 안 적었으면 판단하지 않는다', () => {
    const week = proteinWeek(answered(0, 2), today);
    assert.equal(proteinRisk(week, 'cut', true), null);
  });
});

describe('끼니 예시', () => {
  it('세 끼와 간식을 준다', () => {
    assert.deepEqual(mealIdeas(50).map((idea) => idea.meal), ['아침', '점심', '저녁', '간식']);
  });

  it('점심·저녁은 한 끼 목표에 가깝다', () => {
    for (const target of [35, 40, 45, 50, 55, 60]) {
      for (const idea of mealIdeas(target).filter((one) => one.meal === '점심' || one.meal === '저녁')) {
        assert.ok(Math.abs(idea.gram - target) <= 12, `${target}g 목표에 ${idea.meal} ${idea.gram}g`);
      }
    }
  });

  it('아침이 모자라도 간식까지 합치면 하루를 채운다', () => {
    /* 아침에 계란 다섯 개를 먹는 사람은 없다. 모자란 만큼은 간식이 메운다. */
    for (const target of [35, 45, 55, 60]) {
      const day = mealIdeas(target).reduce((sum, idea) => sum + idea.gram, 0);
      assert.ok(day >= target * 3 - 5, `한 끼 ${target}g인데 하루 ${day}g`);
    }
  });

  it('양은 0.5 단위로만 — "계란 2.7개"는 지킬 수 없다', () => {
    for (const target of [33, 47, 58]) {
      for (const idea of mealIdeas(target)) {
        for (const item of idea.items) assert.doesNotMatch(item.amount, /\d\.\d\d|\.[1-46-9]/, item.amount);
      }
    }
  });

  it('주재료를 한 끼에 먹을 수 없을 만큼 늘리지 않는다', () => {
    const dinner = mealIdeas(120).find((idea) => idea.meal === '저녁')!;
    assert.match(dinner.items[0]!.amount, /^(1|1\.5|2|2\.5)덩이$/);
  });

  it('칼로리를 말하지 않는다', () => {
    assert.doesNotMatch(JSON.stringify(mealIdeas(50)), /kcal|칼로리/);
  });

  it('목표가 없으면 아무것도 없다', () => {
    assert.deepEqual(mealIdeas(0), []);
  });
});
