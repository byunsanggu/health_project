// 아이폰에서 처음 PT를 시작하면 한 번 — 주머니 모드를 알려 준다(화면을 잠그면 음악이 멈출 수 있어서). 두 번째부터는 안 묻는다.
import { begin, check, choosePt, onboard, runUntil, tab } from './lib.mjs';

export default async function ({ page, url }) {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'platform', { value: 'MacIntel', configurable: true });
    Object.defineProperty(navigator, 'maxTouchPoints', { value: 5, configurable: true });
  });
  await page.clock.install({ time: new Date('2026-10-22T18:00:00+09:00') });
  await page.goto(url);
  await onboard(page);
  await choosePt(page);
  // 설정 글도 아이폰에 맞게 — 된다고 하지 않는다
  await tab(page, '내 정보');
  check((await page.locator('.music-note').textContent()).includes('주머니 모드'), '아이폰 설정 글에 주머니 모드 안내가 없습니다');
  await tab(page, '오늘');
  await begin(page);
  await runUntil(page, 'prep');
  await page.clock.runFor(1500);
  const offer = page.locator('#pt-toast');
  check((await offer.textContent()).includes('주머니 모드'), '아이폰인데 주머니 모드를 알려 주지 않았습니다');
  await offer.locator('button', { hasText: '주머니 모드' }).click();
  check(await page.locator('#pocket').isVisible(), '알림에서 눌렀는데 주머니 모드가 안 뜹니다');
  await page.evaluate(() => document.getElementById('pocket').remove());
  // 한 번만
  await page.reload();
  await page.clock.runFor(1500);
  if (await page.locator('.start-cta').count()) await begin(page);
  await page.clock.runFor(1500);
  const again = await page.evaluate(() => (document.getElementById('pt-toast') || {}).textContent || '');
  check(!again.includes('주머니 모드'), '주머니 모드 안내를 또 했습니다');
}
