import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  FOODS, amountLabel, byMeal, entryFromParsed, foodById, intakeAverage, intakeGuide, isFullDay,
  macroShare, maintenanceEstimate, mealForHour, normalizeFoodLog, parseFoodText, portion,
  recentFoods, rescaleEntry, searchFoods, totalsFor, type FoodEntry,
} from '../foodLog.ts';

const ALCOHOL = new Set(['beer', 'soju', 'makgeolli', 'wine', 'highball']);

describe('음식표', () => {
  it('칼로리가 탄단지와 맞는다 (단백질·탄수 4, 지방 9kcal/g — 술 빼고 ±20%)', () => {
    for (const item of FOODS) {
      if (ALCOHOL.has(item.id) || item.per100.kcal < 15) continue;
      const atwater = item.per100.protein * 4 + item.per100.carbs * 4 + item.per100.fat * 9;
      // 채소·과일처럼 칼로리가 아주 낮은 것은 식이섬유 때문에 몇 kcal 어긋난다
      const gap = Math.abs(atwater - item.per100.kcal);
      assert.ok(gap <= Math.max(item.per100.kcal * 0.2, 6), `${item.name}: 표 ${item.per100.kcal}kcal · 계산 ${Math.round(atwater)}kcal`);
    }
  });

  it('1인분 칼로리가 상식 범위다', () => {
    const range = (id: string, lo: number, hi: number) => {
      const item = foodById(id)!;
      const kcal = portion(item, null, null).nutrients.kcal;
      assert.ok(kcal >= lo && kcal <= hi, `${item.name} 1회 ${kcal}kcal (기대 ${lo}~${hi})`);
    };
    range('rice', 280, 330);
    range('egg', 60, 85);
    range('banana', 80, 110);
    range('chicken-breast', 100, 140);
    range('kimchi-stew', 150, 350);
    range('jjajangmyeon', 650, 900);
    range('pork-belly', 550, 750);
    range('ramen', 450, 550);
    range('gimbap', 350, 500);
    range('soju', 330, 450);
    range('protein-powder', 100, 140);
    range('udon', 350, 500);
    range('omurice', 550, 800);
    range('pork-galbi', 450, 700);
    range('fish-cake', 60, 110);
  });

  it('흔히 먹는데 빠졌던 것들 — 돼지고기 · 어묵 · 우동 · 포도 · 브로콜리 · 갈비 · 하이볼', () => {
    const ids = (text: string) => parseFoodText(text).items.map((item) => item.food.id);
    assert.deepEqual(ids('돼지고기 200g, 어묵 2장, 우동'), ['pork-neck', 'fish-cake', 'udon']);
    assert.deepEqual(ids('포도 반 송이랑 브로콜리'), ['grape', 'broccoli']);
    assert.deepEqual(ids('갈비 1인분, 닭갈비'), ['pork-galbi', 'dakgalbi']);
    assert.deepEqual(ids('LA갈비'), ['la-galbi']);
    assert.deepEqual(ids('하이볼 2잔'), ['highball']);
    assert.deepEqual(ids('스테이크 200g'), ['beef-sirloin']);
  });

  it('이름 · 별명이 겹치지 않는다 (입력이 엉뚱한 음식으로 가지 않게)', () => {
    const seen = new Map<string, string>();
    for (const item of FOODS) {
      for (const name of [item.name, ...item.aliases]) {
        const key = name.replace(/\s+/g, '');
        assert.ok(!seen.has(key) || seen.get(key) === item.id, `"${name}"가 ${seen.get(key)}와 ${item.id}에 같이 있다`);
        seen.set(key, item.id);
      }
    }
  });
});

describe('말로 적은 것 읽기', () => {
  it('"닭가슴살 100g, 밥 반 공기, 계란 2개"', () => {
    const { items, unknown } = parseFoodText('닭가슴살 100g, 밥 반 공기, 계란 2개');
    assert.deepEqual(unknown, []);
    assert.deepEqual(items.map((item) => [item.food.id, item.grams, item.amount]), [
      ['chicken-breast', 100, '100g'],
      ['rice', 105, '반 공기'],
      ['egg', 100, '2개'],
    ]);
    const total = totalsFor(items.map((item, i) => entryFromParsed(item, '2026-10-22', 'lunch', 'e' + i)));
    assert.ok(total.protein > 36 && total.protein < 40, String(total.protein)); // 23 + 2.7 + 12.6
    assert.ok(total.kcal > 380 && total.kcal < 440, String(total.kcal));
  });

  it('끼니 말과 "랑 · 하고"로 나눈다', () => {
    const { items } = parseFoodText('점심에 김치찌개 1인분이랑 공기밥 하고 김치');
    assert.deepEqual(items.map((item) => item.food.id), ['kimchi-stew', 'rice', 'kimchi']);
    assert.ok(items.every((item) => item.meal === 'lunch'));
    assert.equal(items[0]!.grams, 400);
    assert.equal(items[1]!.grams, 210);
  });

  it('긴 이름이 이긴다 — 닭가슴살 소시지는 닭가슴살이 아니다', () => {
    assert.equal(parseFoodText('닭가슴살 소시지 2개').items[0]!.food.id, 'chicken-sausage');
  });

  it('"사과"를 "사"와 "과"로 쪼개지 않고, 나누는 말이 없어도 음식마다 따로 본다', () => {
    const { items, unknown } = parseFoodText('사과 1개와 우유');
    assert.deepEqual(unknown, []);
    assert.deepEqual(items.map((item) => [item.food.id, item.amount]), [['apple', '1개'], ['milk', '1컵']]);
    const two = parseFoodText('밥 반 공기 김치 1접시');
    assert.deepEqual(two.items.map((item) => [item.food.id, item.amount]), [['rice', '반 공기'], ['kimchi', '1접시']]);
    assert.equal(parseFoodText('1인분 김치찌개').items[0]!.grams, 400);
  });

  it('양을 여러 말로 적어도 — 한 공기 반 · 두 개 · 반마리 · 3잔 · 500ml', () => {
    const grams = (text: string) => parseFoodText(text).items[0]!.grams;
    assert.equal(grams('밥 한 공기 반'), 315);
    assert.equal(grams('계란 두 개'), 100);
    assert.equal(grams('치킨 반마리'), 450);
    assert.equal(grams('소주 3잔'), 150);
    assert.equal(grams('맥주 500ml'), 500);
    assert.equal(grams('삼겹살 2인분'), 400);
    assert.equal(grams('바나나 1/2개'), 55);
  });

  it('양을 안 적으면 그 음식의 1회 양 — 두부는 반 모', () => {
    const tofu = parseFoodText('두부').items[0]!;
    assert.equal(tofu.grams, 150);
    assert.equal(tofu.amount, '반 모');
  });

  it('숫자만 크게 적으면 g으로 본다 — "닭다리살 150"', () => {
    assert.equal(parseFoodText('닭다리살 150').items[0]!.grams, 150);
  });

  it('그 음식에 없는 단위는 1인분으로 본다', () => {
    const item = parseFoodText('김치찌개 1개').items[0]!;
    assert.equal(item.grams, 400);
    assert.equal(item.guessedUnit, true);
  });

  it('모르는 음식은 따로 돌려준다', () => {
    const { items, unknown } = parseFoodText('마라탕, 밥 1공기');
    assert.deepEqual(unknown, ['마라탕']);
    assert.equal(items.length, 1);
  });
});

describe('찾기 · 계산', () => {
  it('앞부분이 맞는 것 먼저', () => {
    assert.equal(searchFoods('닭가')[0]!.id, 'chicken-breast');
    assert.ok(searchFoods('김치').some((item) => item.id === 'kimchi-stew'));
    assert.deepEqual(searchFoods(''), []);
  });

  it('양 바꾸기 — 두 배면 두 배', () => {
    const entry = entryFromParsed(parseFoodText('밥 1공기').items[0]!, '2026-10-22', 'lunch', 'a');
    const double = rescaleEntry(entry, 2);
    assert.equal(double.grams, 420);
    assert.equal(double.amount, '2공기');
    assert.ok(Math.abs(double.kcal - entry.kcal * 2) <= 1);
    assert.equal(rescaleEntry(entry, 0.5).amount, '반 공기');
  });

  it('탄단지 비율은 100%', () => {
    const share = macroShare({ kcal: 500, protein: 30, fat: 10, carbs: 60 });
    assert.equal(share.protein + share.fat + share.carbs, 100);
    assert.equal(amountLabel(2, '개'), '2개');
  });

  it('지금 시각으로 끼니를 고른다', () => {
    assert.equal(mealForHour(7), 'breakfast');
    assert.equal(mealForHour(12.5), 'lunch');
    assert.equal(mealForHour(19), 'dinner');
    assert.equal(mealForHour(23), 'snack');
  });
});

function entry(date: string, meal: FoodEntry['meal'], kcal: number, protein = 20): FoodEntry {
  return { id: date + meal + kcal, date, meal, name: 'x', grams: 100, amount: '100g', kcal, protein, fat: 10, carbs: 50 };
}

function day(offset: number): string {
  return new Date(Date.UTC(2026, 9, 22) - offset * 86400000).toISOString().slice(0, 10);
}

describe('몇 주 모이면', () => {
  it('아침만 적은 날은 평균에 넣지 않는다', () => {
    assert.equal(isFullDay([entry(day(0), 'breakfast', 400)]), false);
    assert.equal(isFullDay([entry(day(0), 'breakfast', 400), entry(day(0), 'lunch', 700)]), true);
    const avg = intakeAverage([
      entry(day(0), 'breakfast', 400),
      entry(day(1), 'breakfast', 500), entry(day(1), 'dinner', 1500),
    ], day(0));
    assert.deepEqual(avg && { days: avg.days, kcal: avg.kcal }, { days: 1, kcal: 2000 });
  });

  it('먹은 양과 저울로 유지 칼로리를 낸다 — 2,400kcal 먹고 주 0.3kg 빠지면 ≈2,730', () => {
    const log: FoodEntry[] = [];
    const weights: { date: string; kg: number }[] = [];
    for (let i = 0; i < 14; i += 1) {
      log.push(entry(day(i), 'lunch', 1200), entry(day(i), 'dinner', 1200));
      if (i % 2 === 0) weights.push({ date: day(i), kg: 80 + (0.3 / 7) * i });
    }
    const est = maintenanceEstimate(log, weights, day(0))!;
    assert.ok(est.kcal >= 2700 && est.kcal <= 2750, String(est.kcal));
    assert.equal(est.weeklyKg, -0.3);
    assert.match(intakeGuide(est, 'cut'), /2,3\d0kcal/);
  });

  it('모자라면 내지 않는다 (다 적은 날 10일 · 체중 4번)', () => {
    const log = [entry(day(0), 'lunch', 1200), entry(day(0), 'dinner', 1200)];
    assert.equal(maintenanceEstimate(log, [{ date: day(0), kg: 80 }], day(0)), null);
  });

  it('자주 먹는 것 · 끼니별 묶기 · 저장값 정리', () => {
    const a = entryFromParsed(parseFoodText('계란 2개').items[0]!, day(1), 'breakfast', 'a');
    const b = entryFromParsed(parseFoodText('계란 3개').items[0]!, day(0), 'breakfast', 'b');
    const c = entryFromParsed(parseFoodText('밥 1공기').items[0]!, day(0), 'lunch', 'c');
    const recent = recentFoods([a, b, c]);
    assert.equal(recent[0]!.foodId, 'egg');
    assert.equal(recent[0]!.amount, '3개');
    assert.deepEqual(byMeal([a, c]).map((group) => group.entries.length), [1, 1, 0, 0]);
    assert.deepEqual(normalizeFoodLog([null, { id: 1 }, { ...a, meal: 'brunch' }]).map((e) => e.meal), ['snack']);
  });
});
