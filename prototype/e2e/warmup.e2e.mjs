// 몸 풀기는 따로 — 오늘 목록에는 종목만 있고 몸 풀기는 그 위 "시작 전" 칸에. 시작하면 머리띠가
//   "종목 1"이 아니라 "몸 풀기"로 뜨고, 다 하면 첫 종목으로 간다. 지금 하는 종목 이름은 크게.
import { check, onboard } from './lib.mjs';

export default async function ({ page, url, shot }) {
  await page.clock.install({ time: new Date('2026-10-22T18:00:00+09:00') });
  await page.goto(url);
  await onboard(page);

  // 목록에 몸 풀기가 섞이지 않는다
  const names = (await page.locator('.plan-row .name > span:first-child').allTextContents()).map((t) => t.trim());
  check(!names.some((name) => name.startsWith('몸 풀기')), '종목 목록에 몸 풀기가 섞여 있습니다: ' + names.join(', '));
  const sheet = page.locator('.warm-sheet');
  check(await sheet.count() === 1 && (await sheet.locator('h3').textContent()).includes('몸 풀기'), '몸 풀기 칸이 따로 없습니다');
  // 접혀 있다 — 한 줄로 무엇을 하는지만, 누르면 펼친다
  check(await sheet.locator('.warm-moves').count() === 0, '몸 풀기가 펼쳐져 있어 목록을 밀어냅니다');
  await sheet.locator('.warm-summary').click();
  check(await page.locator('.warm-sheet .warm-moves li').count() >= 2, '펼쳐도 몸 풀기 동작이 안 보입니다');
  await page.locator('.warm-sheet .warm-toggle').click();
  const size = await page.locator('.plan-row .name.lift-name-big').first().evaluate((node) => parseFloat(getComputedStyle(node).fontSize));
  check(size >= 17, '목록의 종목 이름이 작습니다: ' + size);
  await shot('1-list');

  // 시작 — 몸 풀기 단계
  await page.locator('.start-cta').click();
  const head = (await page.locator('.progress-name > span').first().textContent()).trim();
  check(head.startsWith('몸 풀기'), '시작했는데 머리띠가 몸 풀기가 아닙니다: ' + head);
  check((await page.locator('.progress-count').textContent()).includes('준비'), '머리띠가 종목 번호를 말합니다');
  await page.locator('.warm-step').first().click();
  check(await page.locator('.warm-step[aria-pressed="true"]').count() === 1, '동작을 눌러도 ✓가 안 됩니다');
  check((await page.locator('.warm-done').textContent()).includes(names[0]), '다음 종목을 말하지 않습니다');
  await shot('2-stage');

  // 껐다 켜도 몸 풀기에서 잇는다
  await page.reload();
  await page.waitForSelector('.tabbar [role="tab"]');
  check((await page.locator('.progress-name > span').first().textContent()).trim().startsWith('몸 풀기'), '다시 켜니 몸 풀기가 사라졌습니다');
  check(await page.locator('.warm-step[aria-pressed="true"]').count() === 1, '체크한 동작이 사라졌습니다');

  // 끝 — 첫 종목, 이름이 크게
  await page.locator('.warm-done').click();
  const lift = page.locator('.progress-name > span').first();
  check((await lift.textContent()).trim() === names[0], '몸 풀기 뒤 첫 종목이 아닙니다: ' + await lift.textContent());
  const big = await lift.evaluate((node) => parseFloat(getComputedStyle(node).fontSize));
  check(big >= 20, '지금 종목 이름이 작습니다: ' + big);
  check((await page.locator('.progress-count').textContent()).includes('1'), '종목 번호가 없습니다');
  await shot('3-lift');

  // 목록으로 갔다 다시 시작해도 몸 풀기를 또 하지 않는다
  await page.locator('.progress-top .demo-open', { hasText: '목록' }).click();
  check((await page.locator('.warm-sheet .meta').textContent()).includes('오늘 했음'), '몸 풀기 칸이 했음으로 안 바뀝니다');
  await page.locator('.start-cta').click();
  check((await page.locator('.progress-name > span').first().textContent()).trim() === names[0], '몸 풀기를 또 합니다');
}
