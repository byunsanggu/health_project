import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildBodyTrend, type WeighIn } from '../bodyTrend.ts';
import {
  DEFAULT_DIET,
  FOOD_AVOID_OPTIONS,
  LUNCH_MENUS,
  isWeekday,
  mealIdeas,
  normalizeDiet,
  planMeals,
  portionAdvice,
  type DietPrefs,
  type FoodAvoid,
  type MealIdea,
} from '../meals.ts';
import { PROTEIN_FOODS } from '../protein.ts';

const WEDNESDAY = '2026-10-07';
const SATURDAY = '2026-10-10';
const plan = (prefs: Partial<DietPrefs> = {}, date = WEDNESDAY, perMeal = 50, goal: 'cut' | 'hold' | 'grow' = 'hold') =>
  planMeals({ perMeal, prefs: { ...DEFAULT_DIET, ...prefs }, date, goal });
const foods = (meals: readonly MealIdea[]) => meals.flatMap((meal) => meal.items.map((one) => one.food));
const text = (meals: readonly MealIdea[]) => JSON.stringify(meals);

describe('끼니 예시 — 기본', () => {
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
    for (const target of [35, 45, 55, 60]) {
      const day = mealIdeas(target).reduce((sum, idea) => sum + idea.gram, 0);
      assert.ok(day >= target * 3 - 5, `한 끼 ${target}g인데 하루 ${day}g`);
    }
  });

  it('양은 0.5 단위로만 — "계란 2.7개"는 지킬 수 없다', () => {
    for (const target of [33, 47, 58]) {
      for (const idea of mealIdeas(target)) {
        for (const one of idea.items) assert.doesNotMatch(one.amount, /\d\.\d\d|\.[1-46-9]/, one.amount);
      }
    }
  });

  it('칼로리를 말하지 않는다', () => {
    for (const lunch of ['cook', 'cafeteria', 'out'] as const) {
      assert.doesNotMatch(text(plan({ lunch }, WEDNESDAY, 50, 'cut').meals), /kcal|칼로리/);
    }
  });

  it('목표가 없으면 아무것도 없다', () => {
    assert.deepEqual(mealIdeas(0), []);
  });

  it('식단표에 쓰는 음식은 전부 음식표에 있다', () => {
    const names = new Set(PROTEIN_FOODS.map((one) => one.name));
    for (const date of ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', SATURDAY]) {
      for (const budget of ['save', 'normal', 'free'] as const) {
        for (const name of foods(plan({ budget }, date).meals)) assert.ok(names.has(name), name);
      }
    }
  });
});

describe('못 먹는 것', () => {
  it('계란을 못 먹으면 계란이 어디에도 없다', () => {
    for (const date of ['2026-10-05', '2026-10-06', WEDNESDAY, SATURDAY]) {
      assert.ok(!foods(plan({ avoid: ['egg'] }, date).meals).includes('계란'), date);
    }
  });

  it('유제품을 못 먹으면 우유·요거트·보충제가 없다', () => {
    const got = foods(plan({ avoid: ['dairy'] }).meals);
    for (const name of ['우유', '그릭요거트', '단백질 보충제']) assert.ok(!got.includes(name), name);
  });

  it('채식이면 고기·생선이 없다', () => {
    for (const date of ['2026-10-05', '2026-10-06', WEDNESDAY, SATURDAY]) {
      const got = foods(plan({ avoid: ['vegetarian'] }, date).meals);
      for (const name of ['닭가슴살', '닭다리살', '소고기', '돼지 목살', '돼지 앞다리', '고등어', '참치캔', '연어']) {
        assert.ok(!got.includes(name), `${date} ${name}`);
      }
    }
  });

  it('어떤 조합을 골라도 세 끼가 비지 않는다', () => {
    const ids = FOOD_AVOID_OPTIONS.map((option) => option.id);
    // 전부 고른 경우까지 — 두부·콩은 남는다
    const combos: FoodAvoid[][] = [[], ...ids.map((id) => [id]), ['egg', 'dairy'], ['egg', 'dairy', 'vegetarian'], [...ids]];
    for (const avoid of combos) {
      for (const lunch of ['cook', 'cafeteria', 'out'] as const) {
        const meals = plan({ avoid, lunch }).meals;
        for (const meal of ['아침', '점심', '저녁']) {
          assert.ok(meals.some((one) => one.meal === meal), `${avoid.join('+') || '없음'} / ${lunch}: ${meal} 없음`);
        }
      }
    }
  });
});

describe('예산', () => {
  const costOf = (meals: readonly MealIdea[]) => {
    const table = new Map(PROTEIN_FOODS.map((one) => [one.name, one.cost ?? 2]));
    const names = foods(meals).filter((name) => table.has(name));
    return names.reduce((sum, name) => sum + (table.get(name) ?? 2), 0) / names.length;
  };

  it('아끼면 싼 재료가 나온다', () => {
    let save = 0;
    let free = 0;
    for (const date of ['2026-10-05', '2026-10-06', WEDNESDAY, '2026-10-08', SATURDAY]) {
      save += costOf(plan({ budget: 'save' }, date).meals);
      free += costOf(plan({ budget: 'free' }, date).meals);
    }
    assert.ok(save < free, `아끼기 ${save} / 신경 안 씀 ${free}`);
  });

  it('아끼기에는 소고기·연어가 안 나온다', () => {
    for (const date of ['2026-10-05', '2026-10-06', WEDNESDAY, '2026-10-08', SATURDAY]) {
      const got = foods(plan({ budget: 'save' }, date).meals);
      assert.ok(!got.includes('소고기') && !got.includes('연어'), date);
    }
  });
});

describe('날마다 바뀐다', () => {
  it('한 주 동안 저녁이 한 가지만 나오지 않는다', () => {
    const dinners = new Set<string>();
    for (let d = 5; d <= 11; d += 1) {
      const date = `2026-10-${String(d).padStart(2, '0')}`;
      const dinner = plan({}, date).meals.find((one) => one.meal === '저녁')!;
      dinners.add(dinner.items[0]!.food);
    }
    assert.ok(dinners.size >= 2, [...dinners].join(','));
  });

  it('점심과 저녁 주재료가 겹치지 않는다', () => {
    for (let d = 5; d <= 11; d += 1) {
      const meals = plan({ budget: 'free' }, `2026-10-${String(d).padStart(2, '0')}`).meals;
      const lunch = meals.find((one) => one.meal === '점심')!.items[0]!.food;
      const dinner = meals.find((one) => one.meal === '저녁')!.items[0]!.food;
      assert.notEqual(lunch, dinner, `10/${d}`);
    }
  });
});

describe('평일 점심', () => {
  it('평일과 주말을 가린다', () => {
    assert.equal(isWeekday(WEDNESDAY), true);
    assert.equal(isWeekday(SATURDAY), false);
  });

  it('사 먹으면 평일 점심은 메뉴로 나온다', () => {
    const lunch = plan({ lunch: 'out' }).meals.find((one) => one.meal === '점심')!;
    assert.ok(LUNCH_MENUS.some((menu) => menu.name === lunch.items[0]!.food), lunch.items[0]!.food);
    assert.ok((lunch.options ?? []).length > 0, '대안이 없다');
  });

  it('주말에는 사 먹는 사람도 집밥으로 나온다', () => {
    const lunch = plan({ lunch: 'out' }, SATURDAY).meals.find((one) => one.meal === '점심')!;
    assert.ok(!LUNCH_MENUS.some((menu) => menu.name === lunch.items[0]!.food));
  });

  it('돼지고기를 못 먹으면 제육·국밥·돈까스가 안 나온다', () => {
    for (let d = 5; d <= 9; d += 1) {
      const lunch = plan({ lunch: 'out', avoid: ['pork'] }, `2026-10-0${d}`).meals.find((one) => one.meal === '점심')!;
      const all = [lunch.items[0]!.food, ...(lunch.options ?? [])].join(' ');
      assert.doesNotMatch(all, /제육|돼지국밥|돈까스|햄/);
    }
  });

  it('감량 중이면 밥을 줄이는 말을 붙이고, 아니면 안 붙인다', () => {
    const find = (goal: 'cut' | 'grow') => {
      for (let d = 5; d <= 9; d += 1) {
        const lunch = plan({ lunch: 'out' }, `2026-10-0${d}`, 50, goal).meals.find((one) => one.meal === '점심')!;
        if (lunch.items[0]!.food === '제육볶음 정식') return lunch.note ?? '';
      }
      return null;
    };
    const cut = find('cut');
    const grow = find('grow');
    if (cut !== null) assert.match(cut, /반만/);
    if (grow !== null) assert.doesNotMatch(grow, /반만/);
  });

  it('구내식당은 메뉴 대신 담는 법을 말한다', () => {
    const lunch = plan({ lunch: 'cafeteria' }, WEDNESDAY, 50, 'cut').meals.find((one) => one.meal === '점심')!;
    assert.equal(lunch.items[0]!.food, '구내식당');
    assert.match(lunch.note ?? '', /반찬부터/);
    assert.match(lunch.note ?? '', /반 공기/);
  });

  it('간식까지 해도 모자라면 무엇을 더할지 말한다', () => {
    const day = plan({ lunch: 'cafeteria', avoid: ['dairy'] }, WEDNESDAY, 60);
    assert.match(day.shortfall ?? '', /간식까지 해도 .*모자랍니다/);
    assert.match(day.shortfall ?? '', /점심에/);
  });

  it('간식으로 채워지는 날에는 모자란다고 하지 않는다', () => {
    assert.equal(plan({ lunch: 'cook' }, SATURDAY, 50).shortfall, null);
  });
});

describe('저울이 말하는 양 조정', () => {
  const day = (n: number) => new Date(Date.parse('2026-09-01T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
  const trend = (perWeek: number, goal: 'cut' | 'hold' | 'grow') => {
    const weighIns: WeighIn[] = Array.from({ length: 30 }, (_, i) => ({ date: day(i), kg: 80 + (perWeek / 7) * i }));
    return buildBodyTrend({ weighIns, today: day(29), goal });
  };

  it('감량 중 2주 정체면 밥을 줄이라고 한다 — 단백질은 그대로', () => {
    const advice = portionAdvice(trend(0, 'cut'), 'cut')!;
    assert.equal(advice.direction, 'less');
    assert.match(advice.text, /밥을 반 공기/);
    assert.match(advice.text, /단백질은 그대로/);
  });

  it('너무 빨리 빠지면 더 먹으라고 한다', () => {
    assert.equal(portionAdvice(trend(-1.3, 'cut'), 'cut')!.direction, 'more');
  });

  it('잘 빠지고 있으면 그대로', () => {
    assert.equal(portionAdvice(trend(-0.5, 'cut'), 'cut')!.direction, 'keep');
  });

  it('증량 중 정체면 더 먹으라고 한다', () => {
    assert.equal(portionAdvice(trend(0, 'grow'), 'grow')!.direction, 'more');
  });

  it('추세를 모르면 아무 말도 하지 않는다', () => {
    const empty = buildBodyTrend({ weighIns: [], today: day(0), goal: 'cut' });
    assert.equal(portionAdvice(empty, 'cut'), null);
  });

  it('칼로리 숫자를 말하지 않는다', () => {
    for (const perWeek of [-1.3, -0.5, 0, 0.3, 0.9]) {
      for (const goal of ['cut', 'hold', 'grow'] as const) {
        const advice = portionAdvice(trend(perWeek, goal), goal);
        assert.doesNotMatch(advice?.text ?? '', /kcal|칼로리|\d{3,}/);
      }
    }
  });
});

describe('저장된 설정', () => {
  it('이상한 값이 와도 기본값으로 고친다', () => {
    assert.deepEqual(normalizeDiet(null), DEFAULT_DIET);
    assert.deepEqual(normalizeDiet({ avoid: ['egg', 'nonsense'], budget: 'huge', lunch: 'out' }),
      { avoid: ['egg'], budget: 'normal', lunch: 'out' });
  });
});
