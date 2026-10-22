// PT를 켜 두고 자리를 비우면 — 세 세트 동안 화면을 안 만지면 멈춘다 (아무도 안 한 세트를 계속 적지 않는다)
import { check, choosePt, focusPhase, onboard, runUntil } from './lib.mjs';

export default async function ({ page, url, shot }) {
  await page.clock.install({ time: new Date('2026-10-22T18:00:00+09:00') });
  await page.goto(url);
  await onboard(page);
  await choosePt(page);
  await page.click('.start-cta');
  await runUntil(page, 'prep');
  await page.locator('#focus .focus-btn', { hasText: '몸 풀기 건너뛰기' }).click();
  if (await runUntil(page, ['warm', 'count']) === 'warm') {
    await page.locator('#focus .focus-btn', { hasText: '워밍업 건너뛰기' }).click();
  }

  // 여기서부터 손을 안 댄다
  let asks = 0;
  let last = null;
  for (let spent = 0; spent < 1200000; spent += 2000) {
    const phase = await focusPhase(page);
    if (phase === 'paused') break;
    if (phase === 'ask' && last !== 'ask') asks += 1;
    last = phase;
    await page.clock.runFor(2000);
  }
  check(await focusPhase(page) === 'paused', '자리를 비웠는데 멈추지 않았습니다');
  check(asks === 3, `멈추기 전에 물은 세트가 ${asks}개`);
  check((await page.locator('#focus .focus-what').textContent()).includes('화면을 안 만지셔서'), '왜 멈췄는지 말하지 않습니다');
  await shot('1-away');

  // 돌아와서 ▶ 계속 — 다시 이어 간다
  await page.locator('#focus .pt-pause').click();
  await runUntil(page, ['count', 'rest'], { maxMs: 300000, stepMs: 2000 });
}
