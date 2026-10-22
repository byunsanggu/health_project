// 빡세게 코치의 첫날 — 시작할 때 "무리하지 않습니다"라고 했으면, 세트 앞에서도 세트 중에도
//   "오늘이 마지막인 것처럼 · 밀어요, 끝까지!"를 말하지 않는다
import { check, onboard, runUntil } from './lib.mjs';

// 자세 신호("끝까지 내려와서")나 "횟수는 끝까지 채웁니다"는 끝까지 밀자는 말이 아니다 — 각오 · 재촉만 본다
const ALL_OUT = /마지막인 것처럼|갈아 넣|끝까지 갑니다|밀어요, 끝까지|끝까지 버팁니다|더 할 수 있어요|다 쏟고|포기하지 않습니다|버티는 사람/;

export default async function ({ page, url, shot }) {
  await page.clock.install({ time: new Date('2026-10-22T18:00:00+09:00') });
  await page.goto(url);
  await onboard(page);
  await page.locator('.coach-line').click();
  await page.locator('dialog .coach-mode', { hasText: 'PT' }).click();
  await page.locator('dialog .coach-style', { hasText: '빡세게' }).click();
  await page.locator('dialog .modal-close').click();
  await page.evaluate(() => { window.__said = []; });

  await page.click('.start-cta');
  await runUntil(page, 'prep');
  await page.locator('#focus .focus-btn', { hasText: '몸 풀기 건너뛰기' }).click();
  if (await runUntil(page, ['warm', 'count']) === 'warm') {
    await page.locator('#focus .focus-btn', { hasText: '워밍업 건너뛰기' }).click();
    await runUntil(page, 'count');
  }
  // 첫 세트를 끝까지 센다 — 끝나기 두 개 전의 재촉까지 들어야 한다
  await runUntil(page, 'ask', { maxMs: 180000 });
  await shot('1-ask');

  const said = await page.evaluate(() => window.__said.slice());
  check(said.some((line) => /무리하지 않습니다/.test(line)), '첫날 시작 말이 없습니다: ' + said.slice(0, 6).join(' / '));
  check(said.some((line) => /정확하게|깔끔하게|자세/.test(line)), '세트 앞 각오가 없습니다: ' + said.join(' / '));
  const wrong = said.filter((line) => ALL_OUT.test(line));
  check(wrong.length === 0, '첫날인데 끝까지 가자는 말: ' + wrong.join(' | '));
}
