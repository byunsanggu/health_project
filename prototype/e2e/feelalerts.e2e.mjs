// 처음 동의 화면 — "전체 동의"로 알림까지 한 번에. 코치 단계에서 알림을 또 묻지 않는다.
// 오늘 컨디션 — 직접 고른다. 별로예요면 세트가 줄고 무게가 내려간다. 내일은 다시 기록대로.
import { check, finishWizard } from './lib.mjs';

const totals = async (page) => {
  const lines = await page.locator('.plan-row .plan-sets').allTextContents();
  let sets = 0;
  let kg = 0;
  for (const line of lines) {
    const m = line.match(/(\d+)세트/);
    if (m) sets += Number(m[1]);
    const w = line.match(/([\d.]+)kg/);
    if (w) kg += Number(w[1]);
  }
  return { sets, kg };
};

export default async function ({ page, context, url, shot }) {
  await context.grantPermissions(['notifications']);
  await page.clock.install({ time: new Date('2026-10-22T18:00:00+09:00') });
  await page.goto(url);

  await page.waitForSelector('.consent-all');
  await page.locator('.consent-all').click();
  const toggles = await page.locator('.consent-card .consent-toggle').evaluateAll((nodes) => nodes.map((n) => n.getAttribute('aria-pressed')));
  check(toggles.length >= 3 && toggles.every((v) => v === 'true'), '전체 동의가 일부만 켰습니다: ' + toggles.join(','));
  check((await page.locator('.alert-consent').textContent()).includes('휴식 끝 알림'), '알림 카드에 받을 알림이 없습니다');
  await shot('1-consent-all');

  // 코치 단계까지 가서 알림을 또 묻지 않는지
  await page.locator('.wizard-nav .primary').click();
  for (let i = 0; i < 10; i += 1) {
    const step = (await page.locator('.session-head h2').textContent()).trim();
    if (step === '코치 · 알림') break;
    if (await page.locator('.wizard-needs').count()) {
      if (step === '경력') await page.locator('.choice', { hasText: '중급' }).first().click();
      else if (step === '내 정보') await page.locator('.segmented button', { hasText: '남성' }).click();
    }
    await page.locator('.wizard-nav .primary').click();
  }
  check(await page.locator('.alert-controls').count() === 0, '코치 단계에서 알림을 또 묻습니다');
  check((await page.locator('#screen, main').first().textContent()).includes('알림은 앞에서 받기로'), '앞에서 정한 알림 안내가 없습니다');
  await shot('2-coach-no-ask');
  await finishWizard(page);

  // 오늘 컨디션 — 기록 %가 보이다가, 고르면 고른 말이 보인다
  const card = page.locator('.stat-card').filter({ hasText: '컨디션' });
  check((await card.locator('.stat-value').textContent()).includes('%'), '처음엔 기록으로 본 %가 보여야 합니다');
  const before = await totals(page);
  await card.locator('.stat-head').click();
  await page.locator('.stat-body .segmented button', { hasText: '별로예요' }).click();
  check((await card.locator('.stat-value').textContent()).includes('별로'), '고른 컨디션이 안 보입니다');
  const after = await totals(page);
  check(after.sets < before.sets, `세트가 안 줄었습니다: ${before.sets} → ${after.sets}`);
  check(after.kg < before.kg, `무게가 안 내려갔습니다: ${before.kg} → ${after.kg}`);
  await shot('3-feel-low');

  // 보통으로 되돌리면 원래대로
  await page.locator('.stat-body .segmented button', { hasText: '보통' }).click();
  const back = await totals(page);
  check(back.sets === before.sets && back.kg === before.kg, `되돌렸는데 그대로가 아닙니다: ${JSON.stringify(before)} → ${JSON.stringify(back)}`);
}
