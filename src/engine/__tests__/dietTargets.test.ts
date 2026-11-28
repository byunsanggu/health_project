import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildBodyTrend, type BodyGoal } from '../bodyTrend.ts';
import {
  dailyTargets, dayTip, fitMealsToTarget, goalOffset, kcalLeftText, startingMaintenance, swapIdeas,
  trendAdjust, weeklyCheckIn,
} from '../dietTargets.ts';
import {
  intakeGuide, minDailyKcal, parseFoodText, portion, foodById, type FoodEntry, type MaintenanceEstimate,
} from '../foodLog.ts';
import { perMealG, proteinTargetG } from '../protein.ts';

const TODAY = '2026-11-28';
function day(offset: number): string {
  return new Date(Date.parse(TODAY + 'T00:00:00Z') - offset * 86400000).toISOString().slice(0, 10);
}

/** 15일 동안 매일 잰 체중 — 주당 weeklyPct% 씩 움직인다 */
function trendOf(goal: BodyGoal, weeklyPct: number, start = 80) {
  const weighIns = Array.from({ length: 15 }, (_, i) => ({
    date: day(14 - i),
    kg: start * (1 + (weeklyPct / 100) * (i / 7)),
  }));
  return buildBodyTrend({ weighIns, today: TODAY, goal });
}

function entry(date: string, meal: FoodEntry['meal'], kcal: number, protein = 0): FoodEntry {
  return { id: date + meal + kcal, date, meal, name: 'x', grams: 0, amount: '', kcal, protein, fat: 0, carbs: 0 };
}

const SHAMING = /실패|잘못|나쁜|초과|폭식|참으세요|먹지 마/;

describe('체중으로 어림한 하루 목표', () => {
  it('유지 칼로리는 체중으로 — 50kg 1,750 · 70kg 2,200 · 90kg 2,650, 120kg 위로는 그대로', () => {
    assert.equal(startingMaintenance(50), 1750);
    assert.equal(startingMaintenance(70), 2200);
    assert.equal(startingMaintenance(90), 2650);
    assert.equal(startingMaintenance(150), startingMaintenance(120));
    assert.equal(startingMaintenance(0), 0);
  });

  it('감량은 주에 체중의 0.5%쯤(250~500kcal), 늘리기는 200~300kcal, 유지는 0', () => {
    for (let kg = 45; kg <= 140; kg += 5) {
      const cut = -goalOffset(kg, 'cut');
      assert.ok(cut >= 250 && cut <= 500, `${kg}kg 감량 ${cut}`);
      const weeklyPct = ((cut * 7) / 7700 / kg) * 100;
      assert.ok(weeklyPct >= 0.3 && weeklyPct <= 0.85, `${kg}kg 주 ${weeklyPct.toFixed(2)}%`);
      const grow = goalOffset(kg, 'grow');
      assert.ok(grow >= 200 && grow <= 300, `${kg}kg 늘리기 ${grow}`);
      assert.equal(goalOffset(kg, 'hold'), 0);
    }
  });

  it('단백질은 몸 카드와 같은 숫자, 탄단지가 칼로리와 맞고, 지방은 체중 × 0.6g 이상', () => {
    for (const goal of ['cut', 'hold', 'grow'] as const) {
      for (const kg of [48, 60, 75, 95, 125]) {
        const t = dailyTargets({ bodyweightKg: kg, goal })!;
        assert.equal(t.protein, proteinTargetG(kg, goal));
        assert.equal(t.source, 'weight');
        assert.equal(t.kcal % 50, 0);
        const fromMacros = t.protein * 4 + t.carbs * 4 + t.fat * 9;
        assert.ok(Math.abs(fromMacros - t.kcal) <= t.kcal * 0.05, `${goal} ${kg}kg: ${t.kcal} vs ${fromMacros}`);
        assert.ok(t.fat >= 0.6 * Math.min(kg, 100) - 3, `${goal} ${kg}kg 지방 ${t.fat}g`);
        assert.ok(t.why.length >= 2 && t.why.some((line) => /체중 .*kg으로 어림/.test(line)));
      }
    }
    const cut70 = dailyTargets({ bodyweightKg: 70, goal: 'cut' })!;
    assert.equal(cut70.kcal, 1800);
    assert.equal(cut70.protein, 140);
  });

  it('체중을 못 받으면 목표를 내지 않는다', () => {
    assert.equal(dailyTargets({ bodyweightKg: 0, goal: 'cut' }), null);
    assert.equal(dailyTargets({ bodyweightKg: Number.NaN, goal: 'hold' }), null);
  });
});

describe('바닥 — 너무 적게 먹으라고 하지 않는다', () => {
  it('바닥은 1,200kcal, 큰 사람은 체중 × 20 (100kg에서 멈춘다)', () => {
    assert.equal(minDailyKcal(50), 1200);
    assert.equal(minDailyKcal(80), 1600);
    assert.equal(minDailyKcal(130), 2000);
    assert.equal(minDailyKcal(undefined), 1200);
  });

  it('적은 것이 실제보다 적어서 유지량이 1,300으로 나와도 감량 목표는 바닥 위에', () => {
    const estimate: MaintenanceEstimate = { kcal: 1300, days: 14, weeklyKg: 0, intakeKcal: 1300 };
    const t = dailyTargets({ bodyweightKg: 58, goal: 'cut', estimate })!;
    assert.equal(t.source, 'log');
    assert.equal(t.kcal, 1200);
    assert.ok(t.floored);
    assert.ok(t.underLogged, '적은 양이 적어 보인다는 말이 없다');
    assert.ok(t.why.some((line) => line.includes('1,200kcal 아래로는')));
  });

  it('어떤 체중 · 목표 · 추세에서도 바닥 아래로 내려가지 않는다', () => {
    for (const kg of [40, 45, 52, 65, 80, 100, 140]) {
      for (const goal of ['cut', 'hold', 'grow'] as const) {
        for (const pct of [-1.5, -0.5, 0, 0.3, 1]) {
          const t = dailyTargets({ bodyweightKg: kg, goal, trend: trendOf(goal, pct, kg) })!;
          assert.ok(t.kcal >= minDailyKcal(kg), `${kg}kg ${goal} ${pct}% → ${t.kcal}`);
          // 처음 목표는 500kcal까지, 저울로 고친 뒤에도 주에 체중의 1%(하루 체중 × 11kcal, 많아야 750)까지
          assert.ok(t.kcal >= t.maintenance - Math.min(750, kg * 11 + 25), `${kg}kg ${goal}: 유지량 ${t.maintenance}에서 ${t.kcal}까지 뺐다`);
          if (pct === -0.5 || !t.adjust) assert.ok(t.offset >= -500);
        }
      }
    }
  });

  it('예전 유지 칼로리 안내도 바닥을 지킨다 — "하루 900kcal"는 나오지 않는다', () => {
    const estimate: MaintenanceEstimate = { kcal: 1300, days: 14, weeklyKg: 0, intakeKcal: 1300 };
    const text = intakeGuide(estimate, 'cut', 58);
    assert.doesNotMatch(text, /900kcal/);
    assert.match(text, /1,200kcal 아래로는 줄이지 않습니다/);
    assert.match(intakeGuide({ ...estimate, kcal: 2700 }, 'cut', 80), /2,300kcal/);
  });

  it('가벼운 사람이 감량을 고르면 폭을 작게 잡고 근육 쪽을 말한다', () => {
    const t = dailyTargets({ bodyweightKg: 45, goal: 'cut' })!;
    assert.equal(t.offset, -250);
    assert.ok(t.why.some((line) => line.includes('가벼운 편')));
  });
});

describe('저울을 보고 고치기', () => {
  it('감량 중 2주째 그대로면 150kcal 낮춘다 (밥 반 공기)', () => {
    const flat = trendOf('cut', 0);
    assert.equal(flat.pace, 'flat');
    assert.equal(trendAdjust(flat, 'cut'), -150);
    const base = dailyTargets({ bodyweightKg: 80, goal: 'cut' })!;
    const t = dailyTargets({ bodyweightKg: 80, goal: 'cut', trend: flat })!;
    assert.equal(t.kcal, base.kcal - 150);
    assert.ok(t.why.some((line) => line.includes('150kcal 낮췄습니다')));
  });

  it('너무 빨리 빠지면 올리고, 늘리는데 안 늘면 올린다', () => {
    assert.equal(trendAdjust(trendOf('cut', -1.3), 'cut'), 200);
    assert.equal(trendAdjust(trendOf('grow', 0), 'grow'), 150);
    assert.equal(trendAdjust(trendOf('grow', 0.25), 'grow'), 0);
    assert.equal(trendAdjust(trendOf('cut', -0.6), 'cut'), 0);
    assert.equal(trendAdjust(null, 'cut'), 0);
  });

  it('먹은 양과 체중으로 낸 유지량에는 저울이 이미 들어 있어 또 고치지 않는다', () => {
    const estimate: MaintenanceEstimate = { kcal: 2500, days: 14, weeklyKg: 0, intakeKcal: 2500 };
    const t = dailyTargets({ bodyweightKg: 80, goal: 'cut', estimate, trend: trendOf('cut', 0) })!;
    assert.equal(t.adjust, 0);
    assert.equal(t.kcal, 2500 - 450);
  });
});

describe('한 주 점검', () => {
  const target80 = (trend = trendOf('cut', 0)) => dailyTargets({ bodyweightKg: 80, goal: 'cut', trend })!;

  it('적은 것도 체중도 없으면 기다린다', () => {
    const t = dailyTargets({ bodyweightKg: 80, goal: 'cut' })!;
    const c = weeklyCheckIn({ entries: [], today: TODAY, targets: t, goal: 'cut', trend: null });
    assert.equal(c.tone, 'wait');
    assert.equal(c.summary, null);
  });

  it('감량 중 2주째 그대로 → 150kcal 덜 아니면 3,000보 더', () => {
    const trend = trendOf('cut', 0);
    const c = weeklyCheckIn({ entries: [], today: TODAY, targets: target80(trend), goal: 'cut', trend });
    assert.equal(c.tone, 'less');
    assert.match(c.advice, /150kcal/);
    assert.match(c.advice, /3,000보/);
  });

  it('바닥에 닿았으면 덜 먹으라고 하지 않고 걷기를 말한다', () => {
    const trend = trendOf('cut', 0, 50);
    const estimate: MaintenanceEstimate = { kcal: 1350, days: 14, weeklyKg: 0, intakeKcal: 1350 };
    const weightOnly = dailyTargets({ bodyweightKg: 50, goal: 'cut', trend })!;
    // 체중 어림: 1,750 − 300 − 150 = 1,300 → 바닥 위. 바닥에 닿는 쪽을 만들려고 가벼운 사람 + 낮은 추정으로 본다
    assert.ok(weightOnly.kcal >= 1200);
    const floored = { ...weightOnly, floored: true, kcal: 1200 };
    const c = weeklyCheckIn({ entries: [], today: TODAY, targets: floored, goal: 'cut', trend });
    assert.match(c.advice, /더 줄이지 않습니다/);
    assert.match(c.advice, /걸어/);
    assert.ok(dailyTargets({ bodyweightKg: 50, goal: 'cut', estimate })!.floored);
  });

  it('너무 빨리 빠지면 무엇보다 먼저 더 먹으라고 한다', () => {
    const trend = trendOf('cut', -1.4);
    const c = weeklyCheckIn({ entries: [], today: TODAY, targets: target80(trend), goal: 'cut', trend });
    assert.equal(c.tone, 'more');
    assert.match(c.advice, /너무 빨리/);
  });

  it('바닥보다 적게 먹은 날이 이틀 넘으면 조심하라고 — 오늘은 아직 안 끝나서 세지 않는다', () => {
    const t = target80();
    const entries = [
      entry(day(0), 'breakfast', 300), entry(day(0), 'lunch', 300),
      entry(day(1), 'lunch', 500), entry(day(1), 'dinner', 500),
      entry(day(2), 'lunch', 400), entry(day(2), 'dinner', 600),
      entry(day(3), 'lunch', 1000), entry(day(3), 'dinner', 1000),
    ];
    const c = weeklyCheckIn({ entries, today: TODAY, targets: t, goal: 'cut', trend: trendOf('cut', -0.5) });
    assert.equal(c.lowDays, 2);
    assert.ok(c.care && c.care.includes('끼니를 거르지'), String(c.care));
    assert.match(c.summary ?? '', /지난 7일 평균/);
  });

  it('단백질이 많이 모자라면 한 줄', () => {
    const t = target80();
    const entries = [0, 1, 2].flatMap((i) => [entry(day(i), 'lunch', 900, 30), entry(day(i), 'dinner', 900, 30)]);
    const c = weeklyCheckIn({ entries, today: TODAY, targets: t, goal: 'cut', trend: trendOf('cut', -0.5) });
    assert.ok(c.protein && c.protein.includes('모자랍니다'));
  });

  it('먹은 양으로 낸 목표면 평균과 비교한다', () => {
    const estimate: MaintenanceEstimate = { kcal: 2400, days: 14, weeklyKg: 0, intakeKcal: 2400 };
    const t = dailyTargets({ bodyweightKg: 80, goal: 'cut', estimate })!;
    const over = [0, 1, 2, 3].flatMap((i) => [entry(day(i), 'lunch', 1200), entry(day(i), 'dinner', 1200)]);
    const c = weeklyCheckIn({ entries: over, today: TODAY, targets: t, goal: 'cut', trend: trendOf('cut', 0) });
    assert.equal(c.tone, 'less');
    assert.match(c.advice, /목표보다 .*많습니다/);
    const near = [0, 1, 2, 3].flatMap((i) => [entry(day(i), 'lunch', 1000), entry(day(i), 'dinner', 950)]);
    assert.equal(weeklyCheckIn({ entries: near, today: TODAY, targets: t, goal: 'cut', trend: trendOf('cut', -0.5) }).tone, 'keep');
  });

  it('어느 경우에도 혼내는 말을 쓰지 않는다', () => {
    for (const goal of ['cut', 'hold', 'grow'] as const) {
      for (const pct of [-1.5, -0.6, -0.2, 0, 0.2, 0.6]) {
        const trend = trendOf(goal, pct);
        const t = dailyTargets({ bodyweightKg: 75, goal, trend })!;
        const c = weeklyCheckIn({ entries: [], today: TODAY, targets: t, goal, trend });
        for (const line of [c.advice, c.care ?? '', ...t.why]) assert.doesNotMatch(line, SHAMING, line);
      }
    }
    assert.doesNotMatch(kcalLeftText(2600, 1800), SHAMING);
  });
});

describe('오늘 막대 · 운동하는 날', () => {
  it('넘어도 괜찮다고 — 한 주 평균으로 본다', () => {
    assert.equal(kcalLeftText(1200, 1800), '600kcal 남음');
    assert.equal(kcalLeftText(1850, 1800), '목표만큼 드셨습니다');
    assert.match(kcalLeftText(2300, 1800), /500kcal 더 — 괜찮습니다/);
  });

  it('운동하는 날과 쉬는 날 — 목표는 같고 언제 먹을지만 다르다', () => {
    const train = dayTip('train', 'cut');
    const rest = dayTip('rest', 'cut');
    const trained = dayTip('trained', 'grow');
    assert.notEqual(train.text, rest.text);
    assert.match(rest.text, /같습니다/);
    assert.match(trained.text, /같습니다/);
    assert.match(train.text, /굶지/);
  });
});

describe('끼니 예시를 목표에 맞추기', () => {
  it('감량하는 작은 사람은 밥 반 공기, 늘리는 큰 사람은 밥을 더 — 감량은 한 공기를 넘지 않는다', () => {
    const small = dailyTargets({ bodyweightKg: 55, goal: 'cut' })!;
    const fitSmall = fitMealsToTarget({ perMeal: perMealG(small.protein), date: '2026-11-25', goal: 'cut', kcal: small.kcal });
    assert.equal(fitSmall.rice, 0.5);
    assert.ok(fitSmall.day.meals.some((meal) => meal.items.some((item) => item.food === '밥' && item.amount === '반 공기')));

    const big = dailyTargets({ bodyweightKg: 80, goal: 'grow' })!;
    const fitBig = fitMealsToTarget({ perMeal: perMealG(big.protein), date: '2026-11-25', goal: 'grow', kcal: big.kcal });
    assert.ok(fitBig.rice >= 1.5, String(fitBig.rice));

    for (const kg of [60, 90, 130]) {
      const t = dailyTargets({ bodyweightKg: kg, goal: 'cut' })!;
      assert.ok(fitMealsToTarget({ perMeal: perMealG(t.protein), date: '2026-11-25', goal: 'cut', kcal: t.kcal }).rice <= 1);
    }
  });

  it('맞춘 하루가 목표에서 크게 벗어나지 않는다(±20%)', () => {
    for (const [kg, goal] of [[55, 'cut'], [70, 'hold'], [80, 'grow'], [65, 'cut']] as const) {
      const t = dailyTargets({ bodyweightKg: kg, goal })!;
      const fit = fitMealsToTarget({ perMeal: perMealG(t.protein), date: '2026-11-25', goal, kcal: t.kcal });
      assert.ok(Math.abs(fit.total - t.kcal) <= t.kcal * 0.2, `${kg}kg ${goal}: 예시 ${fit.total} · 목표 ${t.kcal}`);
      assert.equal(fit.kcal.length, fit.day.meals.length);
    }
  });

  it('감량 중에 모자라도 다그치지 않는다', () => {
    const fit = fitMealsToTarget({ perMeal: 70, date: '2026-11-25', goal: 'cut', kcal: 3000 });
    assert.ok(!fit.note || fit.note.includes('목표 안입니다'));
  });
});

describe('바꿔 먹기', () => {
  it('자주 먹는 라면이 있으면 그것부터, 없으면 목표별 흔한 것', () => {
    const entries = [0, 2, 4].map((i) => ({ ...entry(day(i), 'lunch', 510), foodId: 'ramen' }));
    const ideas = swapIdeas({ entries, goal: 'cut', today: TODAY });
    assert.equal(ideas.length, 2);
    assert.match(ideas[0]!, /^라면 대신/);
    const generic = swapIdeas({ goal: 'cut', today: TODAY });
    assert.match(generic[0]!, /^점심:/);
  });

  it('못 먹는 것은 권하지 않는다', () => {
    const entries = [0, 2, 4].map((i) => ({ ...entry(day(i), 'lunch', 510), foodId: 'ramen' }));
    const ideas = swapIdeas({ entries, goal: 'cut', today: TODAY, avoid: ['egg', 'pork'] });
    assert.ok(ideas.every((line) => !line.includes('계란') && !line.includes('제육')), ideas.join(' / '));
    const grow = swapIdeas({ goal: 'grow', today: TODAY, avoid: ['dairy'] });
    assert.ok(grow.every((line) => !line.includes('우유')), grow.join(' / '));
    assert.ok(grow.some((line) => line.includes('두유')));
    assert.ok(swapIdeas({ goal: 'grow', today: TODAY }).every((line) => !line.includes('두유')));
  });

  it('혼내는 말 없이 두 줄까지', () => {
    for (const goal of ['cut', 'hold', 'grow'] as const) {
      const ideas = swapIdeas({ goal, today: TODAY });
      assert.ok(ideas.length > 0 && ideas.length <= 2);
      for (const line of ideas) assert.doesNotMatch(line, SHAMING);
    }
  });
});

describe('음식표 — 처음 쓰는 사람이 적는 것', () => {
  const ids = (text: string) => parseFoodText(text).items.map((item) => item.food.id);

  it('잘못 읽던 것 — 컵밥 · 곤약밥 · 감자탕 · 닭가슴살 볶음밥 · 편의점 샐러드 · 덮밥 · 오징어볶음', () => {
    assert.deepEqual(ids('컵밥'), ['cup-rice']);
    assert.deepEqual(ids('곤약밥'), ['konjac-rice']);
    assert.deepEqual(ids('감자탕'), ['gamjatang']);
    assert.deepEqual(ids('닭가슴살 볶음밥'), ['chicken-fried-rice']);
    assert.deepEqual(ids('편의점 샐러드'), ['cvs-salad']);
    assert.deepEqual(ids('연어덮밥, 불고기덮밥'), ['salmon-rice', 'bulgogi-rice']);
    assert.deepEqual(ids('오징어볶음'), ['squid-stir']);
    assert.deepEqual(ids('쭈꾸미볶음'), ['jjukkumi']);
  });

  it('없던 것 — 불닭 · 짜파게티 · 해장국 · 닭볶음탕 · 소맥 · 수박 · 반숙란', () => {
    assert.deepEqual(ids('불닭볶음면 1개, 짜파게티'), ['buldak', 'jjapaghetti']);
    assert.deepEqual(ids('해장국이랑 닭볶음탕'), ['haejangguk', 'dakbokkeumtang']);
    assert.deepEqual(ids('소맥 3잔'), ['somaek']);
    assert.deepEqual(ids('수박 한 조각, 복숭아'), ['watermelon', 'peach']);
    assert.deepEqual(ids('반숙란 2개'), ['egg']);
    assert.deepEqual(ids('콜드브루'), ['americano']);
  });

  it('새로 넣은 것의 1인분이 상식 범위다', () => {
    const range = (id: string, lo: number, hi: number) => {
      const item = foodById(id)!;
      const kcal = portion(item, null, null).nutrients.kcal;
      assert.ok(kcal >= lo && kcal <= hi, `${item.name} 1회 ${kcal}kcal (기대 ${lo}~${hi})`);
    };
    range('cup-rice', 380, 560);
    range('konjac-rice', 90, 170);
    range('cvs-salad', 100, 250);
    range('buldak', 480, 600);
    range('jjapaghetti', 550, 650);
    range('gamjatang', 500, 800);
    range('dakbokkeumtang', 350, 600);
    range('somaek', 90, 150);
    range('mix-coffee', 40, 70);
    range('watermelon', 50, 110);
  });
});

describe('처음 적는 사람에게', () => {
  it('끼니마다 칩 여섯 — 모두 음식 하나로 읽힌다', async () => {
    const { starterFoods } = await import('../dietTargets.ts');
    for (const meal of ['breakfast', 'lunch', 'dinner', 'snack'] as const) {
      const list = starterFoods(meal);
      assert.equal(list.length, 6);
      for (const text of list) {
        const parsed = parseFoodText(text);
        assert.equal(parsed.items.length, 1, text);
        assert.equal(parsed.unknown.length, 0, text);
      }
    }
  });
});

describe('고친 까닭을 목표에 맞게 말한다', () => {
  it('늘리는데 안 늘면 "늘지 않아서 올렸습니다", 너무 빨리 빠지면 "빨리 빠져서 올렸습니다"', () => {
    const grow = dailyTargets({ bodyweightKg: 70, goal: 'grow', trend: trendOf('grow', 0, 70) })!;
    assert.ok(grow.why.some((line) => line.includes('늘지 않아서 150kcal 올렸습니다')), grow.why.join(' / '));
    const fast = dailyTargets({ bodyweightKg: 70, goal: 'cut', trend: trendOf('cut', -1.4, 70) })!;
    assert.ok(fast.why.some((line) => line.includes('너무 빨리 빠져서 200kcal 올렸습니다')), fast.why.join(' / '));
  });
});
