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

  // PT 화면 제목 옆에 빠르기 단추 하나 — 다섯 칸은 눌러야 열린다(화면 맨 위를 차지하지 않는다)
  check(await page.locator('#focus .pt-rate').count() === 0, '빠르기 다섯 칸이 늘 펼쳐져 있습니다');
  const chip = page.locator('#focus .pt-rate-chip');
  check(await chip.count() === 1, 'PT 화면에 빠르기 단추가 없습니다');
  check((await chip.textContent()).includes('보통'), '처음 빠르기: ' + await chip.textContent());
  await chip.click();
  check(await page.locator('#focus .pt-rate').count() === 1, '빠르기 단추를 눌렀는데 칸이 안 열립니다');
  check((await pressed(page)).trim() === '보통', '처음 빠르기: ' + await pressed(page));
  await page.locator('#focus .pt-rate button', { hasText: '1.25배' }).click();
  check((await page.locator('#focus .pt-rate-chip').textContent()).includes('1.25배'), '눌렀는데 1.25배가 아닙니다: ' + await page.locator('#focus .pt-rate-chip').textContent());
  await shot('1-rate');

  // 이 종목에만 저장된다
  const rates = await savedRates(page);
  const ids = Object.keys(rates);
  check(ids.length === 1 && rates[ids[0]] === 1.25, '종목별로 저장되지 않았습니다: ' + JSON.stringify(rates));

  // 보통으로 되돌리면 저장도 지운다(기본 빠르기를 따른다)
  await page.locator('#focus .pt-rate-chip').click();
  await page.locator('#focus .pt-rate button', { hasText: '보통' }).click();
  check(Object.keys(await savedRates(page)).length === 0, '보통으로 돌렸는데 남았습니다: ' + JSON.stringify(await savedRates(page)));

  // 세는 중에 바꾸면 그 자리에서 박자가 바뀐다 — 다음 세트까지 기다리지 않는다
  if (await page.locator('#focus .focus-btn', { hasText: '워밍업 건너뛰기' }).count()) {
    await page.locator('#focus .focus-btn', { hasText: '워밍업 건너뛰기' }).click();
  }
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
  for (let i = 0; i < 120 && Number(await page.locator('#focus-num').textContent().catch(() => '0')) < 2; i += 1) await page.clock.runFor(500);
  check(Number(await page.locator('#focus-num').textContent()) >= 2, '세트를 세지 않습니다');
  await repAt();
  const slow = await repAt();
  await page.locator('#focus .pt-rate-chip').click();
  await page.locator('#focus .pt-rate button', { hasText: '1.5배' }).click();
  const fast = await repAt();
  check(slow && fast && fast < slow * 0.8, `빠르기를 바꿨는데 박자가 그대로입니다: ${slow}ms → ${fast}ms`);
}
