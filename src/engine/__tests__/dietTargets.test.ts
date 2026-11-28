import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildBodyTrend, type BodyGoal } from '../bodyTrend.ts';
import {
  ACTIVITY_OPTIONS, activityFactor, ageFromBirthYear, bmiOf, bodyMaintenance, dailyTargets, dayTip,
  fitMealsToTarget, goalOffset, kcalLeftText, mifflinBmr, normalizeBodyInfo, startingMaintenance, swapIdeas,
  trendAdjust, weeklyCheckIn, type ActivityLevel, type BodyInfo,
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

/* ── 키 · 나이 · 활동량 (식단 기록 동의 2026-11-28 판) ── */

const body = (heightCm: number | null, birthYear: number | null, activity: ActivityLevel | null = null): BodyInfo =>
  ({ heightCm, birthYear, activity });

describe('키 · 나이 · 성별로 계산 — Mifflin–St Jeor × 활동량', () => {
  it('기초대사량 공식 값 — 남성 +5, 여성 −161', () => {
    // 10 × 70 + 6.25 × 175 − 5 × 30 + 5 = 1,648.75
    assert.equal(mifflinBmr({ kg: 70, heightCm: 175, age: 30, sex: 'male' }), 1649);
    // 10 × 58 + 6.25 × 162 − 5 × 30 − 161 = 1,281.5
    assert.equal(mifflinBmr({ kg: 58, heightCm: 162, age: 30, sex: 'female' }), 1282);
    assert.equal(mifflinBmr({ kg: 70, heightCm: 175, age: 30, sex: 'male' }) - mifflinBmr({ kg: 70, heightCm: 175, age: 30, sex: 'female' }), 166);
    assert.equal(ageFromBirthYear(1996, TODAY), 30);
    assert.equal(ageFromBirthYear(null, TODAY), null);
  });

  it('활동 계수 — 평소 활동량 + 근력 운동 주 1회마다 0.025 (운동하는 날은 여기서 이미 센다)', () => {
    assert.deepEqual(ACTIVITY_OPTIONS.map((option) => option.label), ['주로 앉아 있음', '조금 움직임', '많이 움직임', '몸 쓰는 일']);
    assert.equal(activityFactor('sitting', 3), 1.275);
    assert.equal(activityFactor('light', 4), 1.4);
    assert.equal(activityFactor('moving', 4), 1.55, '많이 움직이고 주 4회 = 흔한 "보통"(1.55)');
    assert.equal(activityFactor('physical', 5), 1.725, '몸 쓰는 일에 주 5회 = 흔한 "많이"(1.725)');
    assert.equal(activityFactor('sitting', 0), 1.2);
    assert.equal(activityFactor('physical', 7), activityFactor('physical', 6), '운동은 6회까지만 센다');
    assert.equal(activityFactor(null, 4), activityFactor('light', 4), '안 고르면 가운데(조금 움직임)');
    assert.equal(activityFactor('light', undefined), activityFactor('light', 3));
    // 계수는 늘 1.2~1.75 — 앉아만 있는 사람보다 낮거나 운동선수보다 높게 잡지 않는다
    for (const option of ACTIVITY_OPTIONS) {
      for (let days = 0; days <= 7; days += 1) {
        const factor = activityFactor(option.id, days);
        assert.ok(factor >= 1.2 && factor <= 1.75, `${option.id} ${days}회 ${factor}`);
      }
    }
  });

  it('남성 70kg · 175cm · 30세 · 조금 움직임 · 주 4회 → 유지 2,300, 감량 1,900', () => {
    const m = bodyMaintenance({ kg: 70, body: body(175, 1996, 'light'), sex: 'male', trainingDays: 4, today: TODAY })!;
    assert.equal(m.bmr, 1649);
    assert.equal(m.factor, 1.4);
    assert.equal(m.kcal, 2300);
    const t = dailyTargets({ bodyweightKg: 70, goal: 'cut', body: body(175, 1996, 'light'), sex: 'male', trainingDays: 4, today: TODAY })!;
    assert.equal(t.source, 'body');
    assert.equal(t.maintenance, 2300);
    assert.equal(t.kcal, 1900);
    assert.equal(t.protein, proteinTargetG(70, 'cut'), '단백질은 그대로 체중으로');
    assert.match(t.method, /키 · 나이 · 성별 · 체중으로 기초대사량/);
    assert.match(t.method, /조금 움직임/);
    assert.match(t.method, /주 4회/);
    assert.ok(t.why[0]!.includes('키 · 나이 · 활동량으로 계산한 유지 칼로리 2,300kcal'), t.why[0]);
  });

  it('여성 58kg · 162cm · 30세 · 앉아서 일함 · 주 3회 → 유지 1,650 (체중 어림 1,950보다 300 낮다)', () => {
    const input = { bodyweightKg: 58, body: body(162, 1996, 'sitting'), sex: 'female' as const, trainingDays: 3, today: TODAY };
    const hold = dailyTargets({ ...input, goal: 'hold' })!;
    assert.equal(hold.source, 'body');
    assert.equal(hold.kcal, 1650);
    assert.equal(startingMaintenance(58), 1950);
    const cut = dailyTargets({ ...input, goal: 'cut' })!;
    assert.equal(cut.kcal, 1350);
    const grow = dailyTargets({ ...input, goal: 'grow' })!;
    assert.equal(grow.kcal, 1650 + goalOffset(58, 'grow'));
  });

  it('활동량이 많을수록, 운동을 자주 할수록 목표가 올라간다', () => {
    let last = 0;
    for (const option of ACTIVITY_OPTIONS) {
      const t = dailyTargets({ bodyweightKg: 75, goal: 'hold', body: body(178, 1990, option.id), sex: 'male', trainingDays: 3, today: TODAY })!;
      assert.ok(t.kcal > last, `${option.label} ${t.kcal}`);
      last = t.kcal;
    }
    const two = dailyTargets({ bodyweightKg: 75, goal: 'hold', body: body(178, 1990, 'light'), sex: 'male', trainingDays: 2, today: TODAY })!;
    const five = dailyTargets({ bodyweightKg: 75, goal: 'hold', body: body(178, 1990, 'light'), sex: 'male', trainingDays: 5, today: TODAY })!;
    assert.ok(five.kcal > two.kcal);
  });

  it('활동량을 안 고르면 가운데로 보고 그렇게 말한다', () => {
    const t = dailyTargets({ bodyweightKg: 70, goal: 'hold', body: body(175, 1996, null), sex: 'male', trainingDays: 4, today: TODAY })!;
    assert.equal(t.source, 'body');
    assert.equal(t.kcal, 2300);
    assert.match(t.method, /안 고르셔서 가운데/);
  });
});

describe('모자라면 체중으로 — 예전 그대로', () => {
  const base = { bodyweightKg: 70, goal: 'cut' as const, sex: 'male' as const, trainingDays: 4, today: TODAY };
  const weightOnly = dailyTargets({ bodyweightKg: 70, goal: 'cut' })!;

  it('키 · 나이 · 활동량이 없으면 예전 숫자와 같다', () => {
    assert.equal(weightOnly.source, 'weight');
    assert.equal(weightOnly.kcal, 1800);
    assert.match(weightOnly.method, /체중만으로 어림/);
    assert.match(weightOnly.method, /키 · 출생 연도 · 활동량을 적으면/);
    assert.equal(dailyTargets({ ...base, body: null })!.kcal, 1800);
  });

  it('키나 출생 연도가 빠지면 체중으로, 무엇을 적으면 되는지 말한다', () => {
    const noYear = dailyTargets({ ...base, body: body(175, null, 'light') })!;
    assert.equal(noYear.source, 'weight');
    assert.equal(noYear.kcal, weightOnly.kcal);
    assert.match(noYear.method, /출생 연도를 적으면/);
    const noHeight = dailyTargets({ ...base, body: body(null, 1996, 'light') })!;
    assert.equal(noHeight.source, 'weight');
    assert.match(noHeight.method, /키를 적으면/);
  });

  it('성별이나 오늘 날짜를 모르면 계산식을 쓰지 않는다', () => {
    assert.equal(dailyTargets({ ...base, sex: null, body: body(175, 1996, 'light') })!.source, 'weight');
    assert.equal(dailyTargets({ ...base, today: undefined, body: body(175, 1996, 'light') })!.source, 'weight');
  });

  it('18세 아래 · 90세 위는 계산식이 맞지 않아 체중으로', () => {
    const teen = dailyTargets({ ...base, body: body(170, 2010, 'light') })!;
    assert.equal(teen.source, 'weight');
    assert.match(teen.method, /18~90세/);
    assert.equal(dailyTargets({ ...base, body: body(170, 2008, 'light') })!.source, 'body', '18세는 계산식');
  });

  it('3주쯤 적고 재서 낸 내 유지 칼로리가 계산식을 이긴다', () => {
    const estimate: MaintenanceEstimate = { kcal: 2500, days: 18, weeklyKg: 0, intakeKcal: 2500 };
    const t = dailyTargets({ ...base, body: body(175, 1996, 'light'), estimate, trend: trendOf('cut', 0, 70) })!;
    assert.equal(t.source, 'log');
    assert.equal(t.maintenance, 2500);
    assert.equal(t.adjust, 0, '먹은 양으로 낸 유지량은 저울로 또 고치지 않는다');
    assert.match(t.method, /18일 동안 먹은 양과 체중 변화로/);
  });

  it('계산식으로 잡은 목표도 2주째 그대로면 150kcal 고친다', () => {
    const t = dailyTargets({ ...base, body: body(175, 1996, 'light'), trend: trendOf('cut', 0, 70) })!;
    assert.equal(t.source, 'body');
    assert.equal(t.adjust, -150);
    assert.equal(t.kcal, 1900 - 150);
  });

  it('저장소 값 고르기 — 범위 밖은 버리고, 셋 다 없으면 null', () => {
    assert.deepEqual(normalizeBodyInfo({ heightCm: 172.36, birthYear: 1990, activity: 'moving' }, TODAY), { heightCm: 172.4, birthYear: 1990, activity: 'moving' });
    assert.deepEqual(normalizeBodyInfo({ heightCm: 90, birthYear: 2020, activity: 'fly' }, TODAY), null);
    assert.deepEqual(normalizeBodyInfo({ heightCm: 160 }, TODAY), { heightCm: 160, birthYear: null, activity: null });
    assert.equal(normalizeBodyInfo(null), null);
    assert.equal(normalizeBodyInfo('170'), null);
  });
});

describe('BMI가 낮으면 감량 폭을 주지 않는다', () => {
  const lean = { sex: 'female' as const, trainingDays: 3, today: TODAY };

  it('BMI 계산', () => {
    assert.equal(bmiOf(70, 175), 22.9);
    assert.equal(bmiOf(50, 170), 17.3);
    assert.equal(bmiOf(70, null), null);
  });

  it('18.5 아래: 감량을 골라도 유지 칼로리 그대로, 부드러운 한마디', () => {
    const t = dailyTargets({ ...lean, bodyweightKg: 50, goal: 'cut', body: body(170, 1998, 'light') })!;
    assert.equal(t.bmiGuard, 'low');
    assert.equal(t.planGoal, 'hold');
    assert.equal(t.offset, 0);
    assert.equal(t.kcal, t.maintenance);
    assert.ok(t.note && t.note.includes('가벼운 편') && t.note.includes('지금 몸을 지키는'), String(t.note));
    assert.doesNotMatch(t.note!, /전문가/);
    assert.ok(t.why[0]!.includes('줄이지 않습니다'), t.why[0]);
    assert.doesNotMatch(t.why.join(' '), /0kcal 덜/);
    // 유지 · 늘리기는 따로 말하지 않는다
    assert.equal(dailyTargets({ ...lean, bodyweightKg: 50, goal: 'grow', body: body(170, 1998, 'light') })!.note, null);
  });

  it('17 아래: 어떤 목표든 유지 아래로 잡지 않고, 전문가와 상의하라고', () => {
    for (const goal of ['cut', 'hold', 'grow'] as const) {
      for (const pct of [-1, 0, 0.5, 1.2]) {
        const t = dailyTargets({ ...lean, bodyweightKg: 45, goal, body: body(170, 1998, 'sitting'), trend: trendOf(goal, pct, 45) })!;
        assert.equal(t.bmiGuard, 'veryLow');
        assert.ok(t.kcal >= t.maintenance, `${goal} ${pct}%: ${t.kcal} < 유지 ${t.maintenance}`);
        assert.ok(t.offset >= 0 && t.adjust >= 0);
        assert.match(t.note ?? '', /전문가와 상의/);
        assert.doesNotMatch(t.note ?? '', SHAMING);
      }
    }
  });

  it('나이를 몰라도 키만 있으면 BMI로 가린다(체중 어림이어도)', () => {
    const t = dailyTargets({ ...lean, bodyweightKg: 50, goal: 'cut', body: body(170, null, null) })!;
    assert.equal(t.source, 'weight');
    assert.equal(t.bmiGuard, 'low');
    assert.equal(t.kcal, startingMaintenance(50));
  });

  it('BMI 18.5 이상이면 예전처럼 감량 — 가벼운 체중이라도 키가 작으면', () => {
    const t = dailyTargets({ ...lean, bodyweightKg: 48, goal: 'cut', body: body(155, 1998, 'light') })!;
    assert.equal(t.bmi, 20);
    assert.equal(t.bmiGuard, null);
    assert.ok(t.offset < 0);
    assert.equal(t.note, null);
  });

  it('한 주 점검도 덜 먹으라고 하지 않는다', () => {
    const trend = trendOf('cut', 0.4, 50);
    const t = dailyTargets({ ...lean, bodyweightKg: 50, goal: 'cut', body: body(170, 1998, 'light'), trend })!;
    const c = weeklyCheckIn({ entries: [], today: TODAY, targets: t, goal: 'cut', trend });
    assert.notEqual(c.tone, 'less');
    assert.doesNotMatch(c.advice, /낮췄습니다|줄이면/);
    const estimate: MaintenanceEstimate = { kcal: 1800, days: 14, weeklyKg: 0, intakeKcal: 1800 };
    const logged = dailyTargets({ ...lean, bodyweightKg: 50, goal: 'cut', body: body(170, 1998, 'light'), estimate })!;
    const over = [0, 1, 2, 3].flatMap((i) => [entry(day(i), 'lunch', 1100), entry(day(i), 'dinner', 1100)]);
    const c2 = weeklyCheckIn({ entries: over, today: TODAY, targets: logged, goal: 'cut', trend: null });
    assert.equal(c2.tone, 'keep');
  });
});

describe('키 · 나이로 계산해도 바닥은 그대로', () => {
  it('작고 나이 든 사람이 감량을 골라도 1,200kcal 아래로 내려가지 않는다', () => {
    // 45kg · 150cm(BMI 20) · 75세 여성 · 앉아서 · 주 2회: 기초대사량 812 × 1.25 ≈ 1,000
    const t = dailyTargets({ bodyweightKg: 45, goal: 'cut', body: body(150, 1951, 'sitting'), sex: 'female', trainingDays: 2, today: TODAY })!;
    assert.equal(t.source, 'body');
    assert.ok(t.maintenance < 1200, String(t.maintenance));
    assert.equal(t.kcal, 1200);
    assert.ok(t.floored);
    assert.ok(t.why.some((line) => line.includes('1,200kcal 아래로는')));
  });

  it('어떤 키 · 나이 · 성별 · 활동량 · 목표 · 추세에서도 바닥 아래로, 주 1%보다 빠르게 빼지 않는다', () => {
    for (const kg of [42, 55, 70, 95, 140]) {
      for (const heightCm of [148, 165, 185]) {
        for (const birthYear of [2006, 1985, 1950]) {
          for (const sex of ['male', 'female'] as const) {
            for (const option of ACTIVITY_OPTIONS) {
              for (const goal of ['cut', 'hold', 'grow'] as const) {
                for (const pct of [-1.5, 0, 1]) {
                  const t = dailyTargets({
                    bodyweightKg: kg, goal, body: body(heightCm, birthYear, option.id), sex, trainingDays: 4,
                    today: TODAY, trend: trendOf(goal, pct, kg),
                  })!;
                  const label = `${kg}kg ${heightCm}cm ${birthYear} ${sex} ${option.id} ${goal} ${pct}%`;
                  assert.ok(t.kcal >= minDailyKcal(kg), `${label} → ${t.kcal}`);
                  assert.ok(t.kcal >= t.maintenance - Math.min(750, kg * 11 + 25), `${label}: 유지 ${t.maintenance}에서 ${t.kcal}`);
                  if (t.bmiGuard) assert.ok(t.kcal >= t.maintenance, `${label}: BMI ${t.bmi}인데 유지 아래`);
                  assert.equal(t.kcal % 50, 0);
                }
              }
            }
          }
        }
      }
    }
  });
});
