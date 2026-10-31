// PT 워밍업 — 코치가 세어 준 워밍업은 1세트 위 워밍업 줄에 저절로 ✓가 붙는다.
import { check, choosePt, focusPhase, onboard, begin, runUntil } from './lib.mjs';

export default async function ({ page, url, shot }) {
  await page.clock.install({ time: new Date('2026-10-22T18:00:00+09:00') });
  await page.goto(url);
  await onboard(page);
  await choosePt(page);
  await begin(page);
  await runUntil(page, 'prep');
  await page.locator('#focus .focus-btn', { hasText: '몸 풀기 건너뛰기' }).click();
  check(await runUntil(page, ['warm', 'count']) === 'warm', '첫 종목에 워밍업이 없습니다');
  check(await page.locator('.warmup-set.done').count() === 0, '워밍업을 하기도 전에 ✓가 있습니다');

  // 첫 워밍업을 다 세면 ✓
  for (let i = 0; i < 120 && await page.locator('.warmup-set.done').count() === 0; i += 1) await page.clock.runFor(1000);
  check(await page.locator('.warmup-set.done').count() === 1, '세어 준 워밍업에 ✓가 안 붙었습니다');
  check(await page.locator('#focus .focus-warm-row.done').count() === 1, 'PT 화면의 워밍업 줄에 ✓가 없습니다');
  check(await focusPhase(page) !== 'paused', 'PT가 멈췄습니다');
  await shot('1-warm-check');
}
