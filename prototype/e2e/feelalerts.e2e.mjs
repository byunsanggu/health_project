// 처음 동의 화면 — "전체 동의"로 알림까지 한 번에. 선택 항목은 접혀 있어도 동의한 수가 보인다.
// 오늘 컨디션 — 시작하기를 누르면 뜨는 한 장에서 고른다. 별로예요면 세트가 줄고 무게가 내려간다. 내일은 다시 기록대로.
import { check, finishWizard, pickMe } from './lib.mjs';

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
  check(/선택 항목 \d+개.*— 5개 동의함/.test(await page.locator('.consent-more').textContent()), '접힌 선택 항목에 동의한 수가 없습니다: ' + await page.locator('.consent-more').textContent());
  await page.locator('.consent-more').click();
  const toggles = await page.locator('.consent-card .consent-toggle').evaluateAll((nodes) => nodes.map((n) => n.getAttribute('aria-pressed')));
  check(toggles.length >= 8 && toggles.every((v) => v === 'true'), '전체 동의가 일부만 켰습니다: ' + toggles.join(','));
  check((await page.locator('.alert-consent').textContent()).includes('휴식 끝 알림'), '알림 카드에 받을 알림이 없습니다');
  await shot('1-consent-all');

  // 뒤 단계에서 알림을 또 묻지 않는다
  await page.locator('.wizard-nav .primary').click();
  for (let i = 0; i < 6 && await page.locator('.wizard-nav').count(); i += 1) {
    check(await page.locator('.alert-controls').count() === 0, '설정 중에 알림을 또 묻습니다');
    if ((await page.locator('.wizard-nav .primary').textContent()).trim() === '이 프로그램으로 시작') break;
    if ((await page.locator('.session-head h2').textContent()).trim() === '나에 대해') await pickMe(page);
    await page.locator('.wizard-nav .primary').click();
  }
  await finishWizard(page);

  // 오늘 컨디션 — 시작하기 한 장에서 고르면 목록 위에 한 줄로 남는다
  check(await page.locator('.today-adjust').count() === 0, '바꾼 게 없는데 오늘 조정 줄이 있습니다');
  const before = await totals(page);
  await page.locator('.start-cta').click();
  await page.locator('dialog .segmented button', { hasText: '별로예요' }).click();
  await shot('2-start-sheet');
  await page.locator('dialog .modal-close').click();
  check((await page.locator('.today-adjust').textContent()).includes('별로'), '고른 컨디션이 안 보입니다');
  const after = await totals(page);
  check(after.sets < before.sets, `세트가 안 줄었습니다: ${before.sets} → ${after.sets}`);
  check(after.kg < before.kg, `무게가 안 내려갔습니다: ${before.kg} → ${after.kg}`);
  await shot('3-feel-low');

  // 보통으로 되돌리면 원래대로 — 조정 줄을 눌러 같은 한 장을 연다
  await page.locator('.today-adjust').click();
  await page.locator('dialog .segmented button', { hasText: '보통' }).click();
  await page.locator('dialog .start-go').click();
  const back = await totals(page);
  check(back.sets === before.sets && back.kg === before.kg, `되돌렸는데 그대로가 아닙니다: ${JSON.stringify(before)} → ${JSON.stringify(back)}`);
  check(await page.locator('.today-adjust').count() === 0, '되돌렸는데 오늘 조정 줄이 남았습니다');
}
