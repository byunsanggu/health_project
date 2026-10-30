// 식단 탭 — 동의 → 말하듯 적기 → 미리보기 → 적기 → 자주 먹는 것 · 고치기 · 직접 넣기
//          → 다음 날 "어제 점심 그대로" → 단백질 자동 체크 → 동의 철회하면 지워짐
import { check, onboard, tab } from './lib.mjs';

export default async function ({ page, url, shot }) {
  await page.clock.install({ time: new Date('2026-10-22T12:30:00+09:00') });
  await page.goto(url);
  await onboard(page, { consent: 'required' });
  await tab(page, '식단');

  const card = page.locator('.food-log');
  const agree = card.getByRole('button', { name: '동의하고 적기 시작' });
  await agree.waitFor();
  check(await page.locator('#food-text').count() === 0, '동의 전에 적는 칸이 보입니다');
  await shot('1-consent');
  await agree.click();

  // 말하듯 적고 계산 — 아직 기록하지 않는다
  await page.fill('#food-text', '점심에 김치찌개 1인분이랑 공기밥, 계란 2개');
  await page.click('.food-calc');
  const names = await page.locator('.food-preview .food-row b').allTextContents();
  check(names.join(',') === '김치찌개,쌀밥,계란', '읽은 음식: ' + names.join(','));
  const commit = page.locator('.food-commit');
  check(await commit.textContent() === '점심으로 적기', '적기 버튼: ' + await commit.textContent());
  const entries = page.locator('.food-day .food-entry');
  check(await entries.count() === 0, '확인 전에 기록됐습니다');
  await shot('2-preview');
  await commit.click();

  check(await entries.count() === 3, `적힌 줄 ${await entries.count()}개`);
  const kcal = Number((await page.locator('.food-kcal').textContent()).replace(/,/g, ''));
  check(kcal > 600 && kcal < 760, '오늘 칼로리 ' + kcal);
  check(await page.locator('.macro-bar i').count() === 3, '탄단지 막대가 세 칸이 아닙니다');
  check(await page.inputValue('#food-text') === '', '적은 뒤에도 글이 남아 있습니다');
  await page.locator('.macro-bar i.protein').hover();
  check(/단백질 \d+%/.test(await page.locator('.food-log .chart-tip').textContent()), '막대 말풍선이 안 뜹니다');

  // 자주 먹는 것 — 한 번 누르면 들어간다
  await page.locator('.food-again', { hasText: '계란 2개' }).click();
  check(await entries.count() === 4, '자주 먹는 것을 눌러도 안 들어갔습니다');

  // 고치기 — 두 배, 그다음 지우기
  await entries.filter({ hasText: '김치찌개' }).click();
  await page.locator('dialog .food-scale', { hasText: '두 배' }).click();
  const doubled = await page.locator('dialog .food-edit-now').textContent();
  check(doubled.startsWith('2인분'), '두 배 뒤 양: ' + doubled);
  await page.locator('dialog .food-delete').click();
  check(await entries.count() === 3, '지워지지 않았습니다');

  // 음식표에 없는 것 — 직접 넣기. 칼로리 없이는 안 들어간다
  await page.fill('#food-text', '마라탕 1그릇');
  await page.click('.food-calc');
  await page.locator('.food-preview .food-row.unknown .pick').click();
  const dialog = page.locator('dialog');
  check(await dialog.locator('.food-custom input').first().inputValue() === '마라탕', '이름이 미리 안 채워졌습니다');
  await dialog.locator('.food-custom-save').click();
  check((await dialog.locator('.food-custom .warn').textContent()).length > 0, '칼로리 없이 넣어졌습니다');
  await dialog.locator('.food-field', { hasText: '칼로리' }).locator('input').fill('800');
  await dialog.locator('.food-custom-save').click();
  check(await entries.filter({ hasText: '마라탕' }).count() === 1, '직접 넣은 것이 안 보입니다');
  check(await page.locator('.food-preview').count() === 0, '다 처리했는데 미리보기가 남아 있습니다');
  await shot('3-day1');

  // 다음 날 — 어제 점심 그대로
  await page.clock.setSystemTime(new Date('2026-10-23T12:40:00+09:00'));
  await tab(page, '오늘');
  await tab(page, '식단');
  check(await entries.count() === 0, '다음 날인데 어제 것이 오늘에 보입니다');
  const copy = page.locator('.food-copy');
  check((await copy.textContent()).includes('어제 점심 그대로'), '어제 점심 줄이 없습니다');
  await copy.click();
  check(await entries.count() === 4, `어제 점심을 넣은 뒤 ${await entries.count()}줄`);

  // 단백질을 채우면 몸 카드의 "채웠나요"가 저절로 켜진다
  check(await page.locator('.protein-toggle').getAttribute('aria-pressed') === 'false', '단백질이 미리 켜져 있습니다');
  await page.fill('#food-text', '저녁 닭가슴살 600g');
  await page.click('.food-calc');
  check(await page.locator('.food-commit').textContent() === '저녁으로 적기', '글의 끼니를 안 따랐습니다');
  await page.click('.food-commit');
  check(await page.locator('.protein-toggle').getAttribute('aria-pressed') === 'true', '단백질 체크가 안 켜졌습니다');
  check((await page.locator('.protein-meter-left').textContent()).includes('채웠습니다'), '단백질 막대가 채움을 말하지 않습니다');
  check(await page.locator('.food-week-row').count() >= 1, '지난 7일 평균이 없습니다');

  // 어제 것 적기 — 깜빡한 저녁을 다음 날 적는다. 끼니는 저녁으로 미리 골라 둔다
  await page.locator('.food-yesterday').click();
  check(await page.locator('.food-back').count() === 1, '어제 적기 표시가 없습니다');
  check(await entries.count() === 4, `어제는 4줄이어야 하는데 ${await entries.count()}줄`);
  check(await page.locator('.food-meal-pick[aria-pressed="true"]').textContent() === '저녁', '어제 적기의 끼니가 저녁이 아닙니다');
  await page.fill('#food-text', '바나나 1개');
  await page.click('.food-calc');
  await page.click('.food-commit');
  check(await entries.count() === 5, '어제에 안 들어갔습니다');
  await shot('4-yesterday');
  await page.locator('.food-back .pick', { hasText: '오늘로' }).click();
  check(await entries.count() === 5 && await page.locator('.food-back').count() === 0, '오늘로 돌아오지 않았습니다');
  check(await entries.filter({ hasText: '바나나' }).count() === 0, '어제 적은 것이 오늘에 들어갔습니다');

  // 껐다 켜도 남는다
  await page.reload();
  await tab(page, '식단');
  check(await entries.count() === 5, `다시 연 뒤 ${await entries.count()}줄`);
  await shot('5-day2');
  await page.locator('.food-week').scrollIntoViewIfNeeded();
  await shot('5-day2-meals');
  await page.emulateMedia({ colorScheme: 'dark' });
  await shot('6-dark');
  await page.emulateMedia({ colorScheme: 'light' });

  // 동의를 철회하면 기록이 지워진다
  await tab(page, '내 정보');
  const row = page.locator('.status-row', { hasText: '식단 기록' });
  await row.getByRole('button', { name: '철회' }).click();
  await tab(page, '식단');
  await agree.click();
  check(await entries.count() === 0, '철회했는데 기록이 남았습니다');
  check(await page.locator('.food-again').count() === 0, '철회했는데 자주 먹는 것이 남았습니다');
}
