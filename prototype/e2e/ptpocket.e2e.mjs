// 주머니 모드 — PT 화면에서 한 번 누르면 화면을 켜 둔 채 까만 화면. 주머니 속 터치는 아무것도 누르지 않고,
//   "길게 눌러 풀기"를 1.5초 눌러야 풀린다. 그동안 PT는 계속 센다(아이폰에서 음악과 코치 소리를 같이 듣는 길).
import { begin, check, choosePt, focusPhase, onboard, runUntil } from './lib.mjs';

const reps = async (page) => {
  const text = await page.locator('#focus-num').textContent().catch(() => '');
  return /^\d+$/.test(text) ? Number(text) : 0;
};

export default async function ({ page, url, shot }) {
  await page.clock.install({ time: new Date('2026-10-22T18:00:00+09:00') });
  await page.goto(url);
  await onboard(page);
  await choosePt(page);
  await begin(page);
  await runUntil(page, 'prep');
  await page.locator('#focus .focus-btn', { hasText: '몸 풀기 건너뛰기' }).click();
  if (await runUntil(page, ['warm', 'count']) === 'warm') {
    await page.locator('#focus .focus-btn', { hasText: '워밍업 건너뛰기' }).click();
    await runUntil(page, 'count');
  }
  for (let i = 0; i < 120 && await reps(page) < 1; i += 1) await page.clock.runFor(500);

  await page.locator('#focus .pocket-btn').click();
  const pocket = page.locator('#pocket');
  check(await pocket.isVisible(), '주머니 모드 화면이 안 뜹니다');
  await page.clock.runFor(1500);
  check(/\d+개/.test(await page.locator('#pocket-status').textContent()), '까만 화면에 지금 개수가 없습니다');
  await shot('1-pocket');

  // 주머니 속 터치 — 화면 어디를 눌러도(여기까지 · 일시정지 자리) PT는 그대로 센다
  const before = await reps(page);
  for (const [x, y] of [[195, 780], [100, 780], [300, 760], [195, 400], [60, 150]]) await page.mouse.click(x, y);
  await page.clock.runFor(500);
  check(await pocket.isVisible(), '터치 한 번에 주머니 모드가 풀렸습니다');
  check(await focusPhase(page) === 'count', '주머니 속 터치로 PT가 바뀌었습니다: ' + await focusPhase(page));

  // 짧게 누르면 안 풀린다
  const unlock = page.locator('.pocket-unlock');
  const box = await unlock.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.clock.runFor(600);
  await page.mouse.up();
  await page.clock.runFor(1500);
  check(await pocket.count() === 1, '짧게 눌렀는데 풀렸습니다');

  // 1.5초 길게 누르면 풀린다 — PT는 그동안 계속 셌다
  await page.mouse.down();
  await page.clock.runFor(1700);
  await page.mouse.up();
  check(await pocket.count() === 0, '길게 눌렀는데 안 풀립니다');
  const phase = await focusPhase(page);
  check(phase === 'count' || phase === 'rest', '풀고 나니 PT가 멈췄습니다: ' + phase);
  check(phase === 'rest' || await reps(page) > before, 'PT가 주머니 모드 동안 세지 않았습니다');
}
