// 스트레칭 중에 "운동 끝내기"로 요약을 열면 — 스트레칭은 거기서 끝나고 코치는 조용하다(요약 위로 정리 말이 나오지 않는다).
//   "스트레칭 끝내기" 단추는 정리 말을 한다. 시계는 요약을 연 그 시각에 멈춘다.
import { begin, check, choosePt, focusPhase, onboard, runUntil } from './lib.mjs';

export default async function ({ page, url, shot }) {
  await page.clock.install({ time: new Date('2026-10-22T18:00:00+09:00') });
  await page.goto(url);
  await onboard(page);
  await page.locator('.start-cta').click();
  await page.locator('dialog .segmented button', { hasText: '20분' }).click();
  await page.locator('dialog .modal-close').click();
  await choosePt(page);
  await begin(page);
  for (let guard = 0; guard < 80; guard += 1) {
    const phase = await runUntil(page, ['prep', 'warm', 'count', 'rest', 'cool'], { maxMs: 400000 });
    if (phase === 'cool') break;
    if (phase === 'prep') await page.locator('#focus .focus-btn', { hasText: '몸 풀기 건너뛰기' }).click();
    else if (phase === 'warm') await page.locator('#focus .focus-btn', { hasText: '워밍업 건너뛰기' }).click();
    else if (phase === 'rest') await page.locator('#focus .focus-btn', { hasText: '바로 시작' }).click();
    else {
      for (let i = 0; i < 120 && !/^\d+$/.test(await page.locator('#focus-num').textContent().catch(() => '')); i += 1) await page.clock.runFor(500);
      await page.locator('#focus .focus-btn', { hasText: '여기까지' }).click();
    }
  }
  check(await focusPhase(page) === 'cool', '스트레칭까지 못 갔습니다');
  await page.clock.runFor(15000);

  const before = await page.evaluate(() => window.__said.length);
  await page.getByRole('button', { name: /요약 보기/ }).first().click();
  await page.clock.runFor(3000);
  check(await page.locator('dialog[open]').count() === 1, '요약이 안 뜹니다');
  const after = await page.evaluate((n) => window.__said.slice(n), before);
  check(after.length === 0, '요약을 열었는데 코치가 말합니다: ' + after.join(' / '));
  const end = await page.evaluate(() => (JSON.parse(localStorage.getItem('volume-coach.proto.state') || '{}').settings || {}).sessionEndedAt);
  check(Boolean(end), '요약을 열며 스트레칭을 끝냈는데 끝 시각이 없습니다');
  await shot('1-summary-quiet');
}
