// PT 빠르기 — PT를 켜고 운동하는 중에 그 자리에서 바꾸고, 종목마다 따로 저장된다.
//   예: 페이스 풀은 보통, 데드리프트는 1.25배. 바꾼 종목에만 남고 다른 종목은 기본 빠르기 그대로.
import { begin, check, choosePt, onboard, runUntil, skipPrep, skipWarm, focusPhase } from './lib.mjs';

const savedRates = (page) => page.evaluate(() =>
  (JSON.parse(localStorage.getItem('volume-coach.proto.state') || '{}').settings || {}).ptRateByExercise || {});
const pressed = (page) => page.locator('dialog .pt-rate button[aria-pressed="true"]').first().textContent();
// ⋯의 빠르기 줄 — "빠르기 · 보통"
const rateRow = async (page) => {
  await page.locator('#focus .focus-menu').click();
  const text = await page.locator('dialog .menu-row', { hasText: '빠르기' }).textContent();
  return text;
};
/** ⋯ › 빠르기에서 고른다 — 고르면 창이 닫힌다 */
async function pickRate(page, label) {
  await page.locator('#focus .focus-menu').click();
  await page.locator('dialog .menu-row', { hasText: '빠르기' }).click();
  await page.locator('dialog .pt-rate button', { hasText: label }).click();
}

export default async function ({ page, url, shot }) {
  await page.clock.install({ time: new Date('2026-10-22T18:00:00+09:00') });
  await page.goto(url);
  await onboard(page);
  await choosePt(page);
  await begin(page);
  await runUntil(page, 'prep');
  await skipPrep(page);
  await runUntil(page, ['warm', 'count']);

  // 빠르기는 ⋯ 안에 — PT 화면에는 다섯 칸도 단추도 늘 떠 있지 않다
  check(await page.locator('#focus .pt-rate, #focus .pt-rate-chip').count() === 0, '빠르기가 PT 화면에 늘 떠 있습니다');
  const first = await rateRow(page);
  check(first.includes('보통'), '처음 빠르기: ' + first);
  await page.locator('dialog .menu-row', { hasText: '빠르기' }).click();
  check(await page.locator('dialog .pt-rate').count() === 1, '빠르기를 눌렀는데 칸이 안 열립니다');
  check((await pressed(page)).trim() === '보통', '처음 빠르기: ' + await pressed(page));
  await page.locator('dialog .pt-rate button', { hasText: '1.25배' }).click();
  check(await page.locator('dialog[open]').count() === 0, '고른 뒤에도 창이 열려 있습니다');
  const after = await rateRow(page);
  check(after.includes('1.25배'), '눌렀는데 1.25배가 아닙니다: ' + after);
  await shot('1-rate');
  await page.locator('dialog .modal-close').click();

  // 이 종목에만 저장된다
  const rates = await savedRates(page);
  const ids = Object.keys(rates);
  check(ids.length === 1 && rates[ids[0]] === 1.25, '종목별로 저장되지 않았습니다: ' + JSON.stringify(rates));

  // 보통으로 되돌리면 저장도 지운다(기본 빠르기를 따른다)
  await pickRate(page, '보통');
  check(Object.keys(await savedRates(page)).length === 0, '보통으로 돌렸는데 남았습니다: ' + JSON.stringify(await savedRates(page)));

  // 세는 중에 바꾸면 그 자리에서 박자가 바뀐다 — 다음 세트까지 기다리지 않는다
  if (await focusPhase(page) === 'warm') await skipWarm(page);
  await runUntil(page, 'count');
  const repAt = async () => {
    let last = await page.locator('#focus-num').textContent();
    for (let t = 0; t < 30000; t += 100) {
      await page.clock.runFor(100);
      const now = await page.locator('#focus-num').textContent().catch(() => last);
      if (/^\d+$/.test(now) && now !== last) return t;
      last = now;
    }
    return null;
  };
  // 준비 중에는 "8초"처럼 초가 붙는다 — 숫자만 있을 때가 센 개수
  const reps = async () => { const text = await page.locator('#focus-num').textContent().catch(() => ''); return /^\d+$/.test(text) ? Number(text) : 0; };
  for (let i = 0; i < 120 && await reps() < 2; i += 1) await page.clock.runFor(500);
  check(await reps() >= 2, '세트를 세지 않습니다');
  await repAt();
  const slow = await repAt();
  await pickRate(page, '1.5배');
  const fast = await repAt();
  check(slow && fast && fast < slow * 0.8, `빠르기를 바꿨는데 박자가 그대로입니다: ${slow}ms → ${fast}ms`);
}
