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

  // 마지막 워밍업이 끝나면 PT 화면이 사라지지 않고 바로 1세트 준비로 — 빈틈에 목록의 "1세트 완료"가 뜨면
  // 누르는 순간 하지 않은 세트가 기록됐다
  let phase = await focusPhase(page);
  for (let i = 0; i < 1200 && phase === 'warm'; i += 1) {
    await page.clock.runFor(250);
    phase = await focusPhase(page);
    check(phase !== null, '워밍업과 1세트 사이에 PT 화면이 사라졌습니다');
  }
  check(phase === 'count', '워밍업 뒤에 1세트로 가지 않고 ' + phase);
  check((await page.locator('#focus .focus-what').textContent()).startsWith('1세트'), '워밍업 뒤가 1세트가 아닙니다');
  // 준비 시간은 "준비"와 남은 초로 — "준비 40"처럼 개수로 읽히지 않게
  check(/^\d+초$/.test(await page.locator('#focus-num').textContent()), '준비 숫자: ' + await page.locator('#focus-num').textContent());
  check((await page.locator('#focus-cap').textContent()) === '준비', '준비 표시가 없습니다');
  const logged = await page.evaluate(() => (JSON.parse(localStorage.getItem('volume-coach.proto.state') || '{}').settings || {}).todaySets || []);
  check(logged.filter((set) => !set.warmup).length === 0, '하지 않은 세트가 적혔습니다: ' + JSON.stringify(logged));
  await shot('2-set1-lead');
}
