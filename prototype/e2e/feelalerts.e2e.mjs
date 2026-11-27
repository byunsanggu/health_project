// 처음 동의 화면 — "전체 동의"로 알림까지 한 번에. 선택 항목은 접혀 있어도 동의한 수가 보인다.
// 오늘 컨디션 — 시작하기를 누르면 뜨는 한 장에서 고른다. 별로예요면 세트가 줄고 무게가 내려간다. 내일은 다시 기록대로.
import { adjustToday, agreeConsent, check, finishWizard, todayDetail } from './lib.mjs';

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

  // 전체 동의하기는 "선택 항목 보기" 안의 작은 버튼이다(동의 장은 목표 · 경력 다음)
  await agreeConsent(page, { press: false });
  await page.waitForSelector('.consent-more');
  check(await page.locator('.consent-all').count() === 0, '전체 동의가 접힌 채로 보입니다');
  await page.locator('.consent-more').click();
  await page.locator('.consent-all').click();
  check(/5개 동의함/.test(await page.locator('.consent-more').textContent()), '선택 항목에 동의한 수가 없습니다: ' + await page.locator('.consent-more').textContent());
  const toggles = await page.locator('.consent-card .consent-toggle').evaluateAll((nodes) => nodes.map((n) => n.getAttribute('aria-pressed')));
  check(toggles.length >= 5 && toggles.every((v) => v === 'true'), '전체 동의가 일부만 켰습니다: ' + toggles.join(','));
  check((await page.locator('.alert-consent').textContent()).includes('휴식 끝 알림'), '알림 카드에 받을 알림이 없습니다');
  await shot('1-consent-all');

  // 뒤 단계에서 알림을 또 묻지 않는다
  await page.locator('.wizard-nav .primary').click();
  await page.waitForSelector('.ob-q');
  check(await page.locator('.alert-controls').count() === 0, '설정 중에 알림을 또 묻습니다');
  await finishWizard(page);

  // 오늘 컨디션 — 시작하기 한 장에서 고르면 목록 위에 한 줄로 남는다
  check(await page.locator('.today-adjust').count() === 0, '바꾼 게 없는데 오늘 조정 줄이 있습니다');
  await todayDetail(page); // 세트 · ⋯ · 편집은 오늘 › 자세히 보기 안에
  const before = await totals(page);
  await adjustToday(page); // 오늘 조정 — "오늘은 평소와 다릅니다 ›"에서 질문 넷
  // 고르지 않으면 좋아요 — 계획대로
  check(await page.locator('dialog .segmented button[aria-pressed="true"]', { hasText: '좋아요' }).count() === 1, '처음부터 좋아요가 아닙니다');
  await page.locator('dialog .segmented button', { hasText: '별로예요' }).click();
  await shot('2-start-sheet');
  await page.locator('dialog .modal-close').click();
  check((await page.locator('.today-adjust').textContent()).includes('별로'), '고른 컨디션이 안 보입니다');
  const after = await totals(page);
  check(after.sets < before.sets, `세트가 안 줄었습니다: ${before.sets} → ${after.sets}`);
  check(after.kg < before.kg, `무게가 안 내려갔습니다: ${before.kg} → ${after.kg}`);
  await shot('3-feel-low');

  // 좋아요로 되돌리면 원래대로 — 조정 줄을 눌러 같은 한 장을 연다
  await page.locator('.today-adjust').click();
  await page.locator('dialog .segmented button', { hasText: '좋아요' }).click();
  await page.locator('dialog .start-go').click();
  const back = await totals(page);
  check(back.sets === before.sets && back.kg === before.kg, `되돌렸는데 그대로가 아닙니다: ${JSON.stringify(before)} → ${JSON.stringify(back)}`);
  check(await page.locator('.today-adjust').count() === 0, '되돌렸는데 오늘 조정 줄이 남았습니다');
}
