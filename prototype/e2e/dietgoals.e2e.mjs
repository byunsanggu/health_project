// 식단 — 하루 목표(칼로리 · 단백질 막대, 탄단지는 자세히 뒤) · 처음 칩 · 끼니 예시가 목표에 맞는다
//       · 어제랑 같게 · 넘어도 혼내지 않는다 · 2주째 체중 그대로면 목표를 150kcal 낮추고 걷기를 말한다
import { check, finishWizard, tab } from './lib.mjs';

const KEY = 'volume-coach.proto.state';

export default async function ({ page, url, shot }) {
  await page.clock.install({ time: new Date('2026-11-25T12:30:00+09:00') });
  await page.goto(url);
  await finishWizard(page, { goal: 'cut', weight: 70 });
  await tab(page, '식단');

  // 동의 전에는 목표를 내지 않는다(칼로리 계산은 식단 기록 동의가 받은 일이다)
  check(await page.locator('.food-goals').count() === 0, '동의 전에 칼로리 목표가 보입니다');
  await page.locator('.food-log').getByRole('button', { name: '동의하고 적기 시작' }).click();

  // 다이어트 · 70kg — 유지 2,200에서 400 덜 = 1,800kcal, 단백질 2.0g/kg = 140g
  const goals = page.locator('.food-goals');
  await goals.waitFor();
  check(await page.locator('.food-log .sheet-head h3').textContent() === '오늘 목표', '카드 머리: ' + await page.locator('.food-log .sheet-head h3').textContent());
  check(await page.locator('.food-kcal').textContent() === '0', '아직 안 먹었는데 칼로리: ' + await page.locator('.food-kcal').textContent());
  const unit = await page.locator('.food-kcal-unit').textContent();
  check(unit.includes('1,800kcal'), '칼로리 목표: ' + unit);
  const protein = await page.locator('.food-goals .protein-meter:not(.food-kcal-meter) b').first().textContent();
  check(protein.includes('/ 140g'), '단백질 목표: ' + protein);
  check(await page.locator('.food-goals .macro-meter').count() === 0, '탄수화물 · 지방이 자세히 밖에 있습니다');
  check((await page.locator('.food-day-kind').textContent()) === '운동하는 날', '운동하는 날 표시: ' + await page.locator('.food-day-kind').textContent());
  check(await page.locator('.food-input-title').textContent() === '먹은 것 적기', '할 일 하나가 안 보입니다');

  // 처음이라 "자주 먹는 것"이 비었으면 끼니마다 흔한 것 여섯
  const starters = page.locator('.food-starter');
  check(await starters.count() === 6, `처음 칩 ${await starters.count()}개`);
  await shot('1-goal-empty');
  await starters.filter({ hasText: '김치찌개' }).click();
  const entries = page.locator('.food-day .food-entry');
  check(await entries.count() === 1, '칩을 눌러도 안 들어갔습니다');
  check(await starters.count() === 0 && await page.locator('.food-again').count() > 0, '적은 뒤에도 처음 칩이 남았습니다');

  // 예전에 잘못 읽던 것 — 컵밥은 쌀밥이 아니고 편의점 샐러드는 잎채소만이 아니다
  await page.fill('#food-text', '컵밥이랑 편의점 샐러드');
  await page.click('.food-calc');
  const names = await page.locator('.food-preview .food-row b').allTextContents();
  check(names.join(',') === '컵밥,편의점 샐러드', '읽은 음식: ' + names.join(','));
  await page.click('.food-commit');

  // 자세히 — 탄수화물 · 지방 막대와 이 숫자를 정한 법
  await page.locator('.food-more-toggle').click();
  check(await page.locator('.food-more .macro-meter.carbs').count() === 1 && await page.locator('.food-more .macro-meter.fat').count() === 1, '자세히에 탄수화물 · 지방이 없습니다');
  const why = (await page.locator('.food-why').allTextContents()).join(' ');
  check(why.includes('체중 70kg으로 어림'), '정한 법: ' + why);
  await shot('2-detail');
  await page.locator('.food-more-toggle').click();

  // 끼니 예시 — 목표 칼로리에 맞춘 밥 양, 끼니마다 칼로리, 바꿔 먹기
  const meals = page.locator('.meal-card');
  check((await meals.locator('.sheet-head .meta').textContent()).includes('하루 1,800kcal'), '끼니 예시가 목표를 모릅니다');
  check(await meals.locator('.meal-kcal').count() >= 3, '끼니마다 칼로리가 없습니다');
  const items = (await meals.locator('.meal-items').allTextContents()).join(' / ');
  check(/밥 (반 공기|한 공기)/.test(items) && !items.includes('한 공기 반'), '감량인데 밥 양: ' + items);
  const swaps = await meals.locator('.meal-swap').count();
  check(swaps >= 1 && swaps <= 2, `바꿔 먹기 ${swaps}줄`);
  await meals.scrollIntoViewIfNeeded();
  await shot('3-meals');

  // 저녁도 적어 둔다 — 다음 날 "어제랑 같게"를 보려고
  await page.fill('#food-text', '저녁 닭가슴살 1개, 밥 반 공기');
  await page.click('.food-calc');
  await page.click('.food-commit');
  const day1 = await entries.count();

  // 넘어도 혼내지 않는다
  await page.fill('#food-text', '저녁 삼겹살 3인분');
  await page.click('.food-calc');
  await page.click('.food-commit');
  const left = await page.locator('.food-kcal-left').textContent();
  check(left.includes('괜찮습니다') && !/초과|실패/.test(left), '넘었을 때 말: ' + left);
  await entries.filter({ hasText: '삼겹살' }).click();
  await page.locator('dialog .food-delete').click();
  check(await entries.count() === day1, '삼겹살이 안 지워졌습니다');

  // 다음 날 아침 — 하루를 통째로
  await page.clock.setSystemTime(new Date('2026-11-26T08:10:00+09:00'));
  await tab(page, '오늘');
  await tab(page, '식단');
  const copyDay = page.locator('.food-copy-day');
  check(await copyDay.count() === 1, '어제랑 같게가 없습니다');
  check((await copyDay.textContent()).includes('하루 전체 ' + day1 + '가지'), '어제랑 같게: ' + await copyDay.textContent());
  await shot('4-copy-day');
  await copyDay.click();
  check(await entries.count() === day1, `어제랑 같게 뒤 ${await entries.count()}줄 (어제 ${day1}줄)`);
  check(await page.locator('.food-checkin .food-week-row').count() >= 1, '이번 주 점검에 평균이 없습니다');

  // 2주째 체중이 그대로인 사람 — 목표를 150kcal 낮추고, 더 줄이는 대신 걷기도 말한다
  await page.evaluate((key) => {
    const saved = JSON.parse(localStorage.getItem(key));
    const today = Date.parse('2026-11-26T00:00:00Z');
    for (let i = 15; i >= 1; i -= 1) {
      const date = new Date(today - i * 86400000).toISOString().slice(0, 10);
      saved.checkIns.push({ id: 'checkin-' + date, date, bodyweightKg: 70, updatedAt: new Date(today).toISOString() });
    }
    localStorage.setItem(key, JSON.stringify(saved));
  }, KEY);
  await page.reload();
  await tab(page, '식단');
  const unit2 = await page.locator('.food-kcal-unit').textContent();
  check(unit2.includes('1,650kcal'), '2주째 그대로인데 목표: ' + unit2);
  const advice = await page.locator('.food-checkin .food-advice').textContent();
  check(advice.includes('150kcal') && advice.includes('3,000보'), '점검 한 줄: ' + advice);
  await page.locator('.food-checkin').scrollIntoViewIfNeeded();
  await shot('5-checkin');

  // 좁은 폰에서도 가로로 넘치지 않는다
  for (const [w, h] of [[360, 640], [390, 844]]) {
    await page.setViewportSize({ width: w, height: h });
    await page.locator('.session-head').first().scrollIntoViewIfNeeded();
    const wide = await page.evaluate(() => Math.max(document.documentElement.scrollWidth,
      ...[...document.querySelectorAll('.food-log *, .meal-card *')].map((node) => Math.ceil(node.getBoundingClientRect().right))));
    check(wide <= w, `${w}px에서 가로 ${wide}px`);
    await shot(`6-top-${w}`);
    await page.locator('.meal-card').scrollIntoViewIfNeeded();
    await shot(`7-meals-${w}`);
  }
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.locator('.session-head').first().scrollIntoViewIfNeeded();
  await shot('8-dark');
  await page.emulateMedia({ colorScheme: 'light' });
}
