// PT 빠르기 — PT를 켜고 운동하는 중에 그 자리에서 바꾸고, 종목마다 따로 저장된다.
//   예: 페이스 풀은 보통, 데드리프트는 1.25배. 바꾼 종목에만 남고 다른 종목은 기본 빠르기 그대로.
import { begin, check, choosePt, onboard, runUntil } from './lib.mjs';

const savedRates = (page) => page.evaluate(() =>
  (JSON.parse(localStorage.getItem('volume-coach.proto.state') || '{}').settings || {}).ptRateByExercise || {});
const pressed = (page) => page.locator('#focus .pt-rate button[aria-pressed="true"]').first().textContent();

export default async function ({ page, url, shot }) {
  await page.clock.install({ time: new Date('2026-10-22T18:00:00+09:00') });
  await page.goto(url);
  await onboard(page);
  await choosePt(page);
  await begin(page);
  await runUntil(page, 'prep');
  await page.locator('#focus .focus-btn', { hasText: '몸 풀기 건너뛰기' }).click();
  await runUntil(page, ['warm', 'count']);

  // PT 화면에 빠르기 줄이 있다 — 처음엔 보통
  check(await page.locator('#focus .pt-rate').count() === 1, 'PT 화면에 빠르기 줄이 없습니다');
  check((await pressed(page)).trim() === '보통', '처음 빠르기: ' + await pressed(page));
  await page.locator('#focus .pt-rate button', { hasText: '1.25배' }).click();
  check((await pressed(page)).trim() === '1.25배', '눌렀는데 1.25배가 아닙니다: ' + await pressed(page));
  await shot('1-rate');

  // 이 종목에만 저장된다
  const rates = await savedRates(page);
  const ids = Object.keys(rates);
  check(ids.length === 1 && rates[ids[0]] === 1.25, '종목별로 저장되지 않았습니다: ' + JSON.stringify(rates));

  // 보통으로 되돌리면 저장도 지운다(기본 빠르기를 따른다)
  await page.locator('#focus .pt-rate button', { hasText: '보통' }).click();
  check(Object.keys(await savedRates(page)).length === 0, '보통으로 돌렸는데 남았습니다: ' + JSON.stringify(await savedRates(page)));
}
