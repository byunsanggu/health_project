// 코치 목소리를 못 받는 폰(지하 · 첫날 · 데이터 꺼짐) — PT 화면이 소리가 안 난다고 말하고, 코치가 한 말을 자막으로 보여 준다.
//   예전에는 아무 말 없이 숫자만 보였다 — 세팅 순서도, 30초 더 쉬는 법도 사라졌다.
import { begin, check, choosePt, onboard, runUntil } from './lib.mjs';

export default async function ({ page, url, shot }) {
  await page.route('**/voice/**', (route) => route.abort());
  await page.clock.install({ time: new Date('2026-10-22T18:00:00+09:00') });
  await page.goto(url);
  await onboard(page);
  await choosePt(page);
  await begin(page);
  await runUntil(page, 'prep');
  await page.clock.runFor(15000);
  const trouble = page.locator('#focus .focus-trouble');
  for (let i = 0; i < 20 && await trouble.count() === 0; i += 1) await page.clock.runFor(500);
  check(await trouble.count() === 1, '소리가 안 나는데 화면이 알려 주지 않습니다');
  check((await trouble.textContent()).includes('화면 글로 안내합니다'), '알림 글: ' + await trouble.textContent());
  check((await page.locator('#focus-say').textContent()).includes('몸부터'), '코치가 한 말이 화면에 없습니다: ' + await page.locator('#focus-say').textContent());
  await shot('1-silent-prep');

  // 세는 동안(첫 개수부터)에는 자막을 숨기고 숫자를 크게
  await page.locator('#focus .focus-btn', { hasText: '몸 풀기 건너뛰기' }).click();
  if (await runUntil(page, ['warm', 'count']) === 'warm') {
    await page.locator('#focus .focus-btn', { hasText: '워밍업 건너뛰기' }).click();
    await runUntil(page, 'count');
  }
  check(await page.locator('#focus-say').count() === 1, '준비 중에 자막이 없습니다');
  for (let i = 0; i < 120 && !/^\d+$/.test(await page.locator('#focus-num').textContent()); i += 1) await page.clock.runFor(500);
  check(await page.locator('#focus-say').count() === 0, '세는 동안에도 자막이 숫자 자리를 차지합니다');
}
