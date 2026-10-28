// 속도 "빠르게"(한 개 3초)는 앱을 다시 켜도 남는다 — 예전 "보통"과 숫자가 같아 켤 때마다 지워졌다
import { check, onboard, startWorkout } from './lib.mjs';

export default async function ({ page, url }) {
  await page.goto(url);
  await onboard(page);
  await startWorkout(page);
  await page.click('.count-settings');
  await page.locator('.count-speed .chip', { hasText: '빠르게' }).click();
  check((await page.locator('.count-settings').textContent()).includes('속도 3초'), '빠르게를 골랐는데 3초가 아닙니다');
  await page.reload();
  await page.waitForSelector('.count-settings');
  const after = await page.locator('.count-settings').textContent();
  check(after.includes('속도 3초'), '다시 켰더니 ' + after);
}
