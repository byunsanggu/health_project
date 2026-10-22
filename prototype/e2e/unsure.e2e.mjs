// 이 종목 빼기 › "동작이 자신 없어요" — 빼지 않고 시연을 띄운다. 시연 창이 비지 않고, 오류가 나지 않는다.
//   (전에는 창을 닫자마자 시연을 열어서, 늦게 오는 닫힘 이벤트가 방금 연 시연을 지웠다)
import { check, onboard } from './lib.mjs';

export default async function ({ page, url, shot }) {
  await page.clock.install({ time: new Date('2026-10-22T18:00:00+09:00') });
  await page.goto(url);
  await onboard(page);

  const name = (await page.locator('.plan-row .name').nth(1).textContent()).trim();
  await page.locator('.plan-row .row-menu').first().click();
  await page.locator('dialog .menu-row', { hasText: '이 종목 빼기' }).click();
  await page.locator('dialog .menu-row', { hasText: '동작이 자신 없어요' }).click();
  // 닫힘 이벤트가 늦게 와도 남아 있어야 한다
  await page.clock.runFor(1500);
  await page.waitForTimeout(200);

  check(await page.locator('dialog[open]').count() === 1, '시연 창이 안 떴습니다');
  const title = (await page.locator('dialog .modal-head h3').textContent()).trim();
  check(title.length > 0, '시연 창 제목이 비었습니다');
  check(await page.locator('dialog .demo-stage, dialog .demo-fallback, dialog video').count() > 0, '시연 창이 비었습니다: ' + (await page.locator('dialog').innerHTML()).slice(0, 200));
  await shot('1-demo');

  // 종목은 빠지지 않고 가벼운 무게로 남는다
  await page.locator('dialog .modal-close').click();
  const names = await page.locator('.plan-row .name').allTextContents();
  check(names.some((item) => item.trim() === title || item.trim() === name), '자신 없다고 했는데 종목이 빠졌습니다: ' + names.join(', '));
}
