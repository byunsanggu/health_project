// 세트 칸 — 몇 세트 했는지 한눈에 보이고, 세트는 "완료" 하나로 끝내고, 끝낸 세트를 고쳐도 지금 할 세트로 돌아가지 않는다.
//   예전에는 "고치기"가 그 세트를 안 한 것으로 되돌려서 2세트를 끝냈는데 1세트 화면이 떴다.
import { check, onboard, startWorkout, tab } from './lib.mjs';

export default async function ({ page, url, shot }) {
  await page.clock.install({ time: new Date('2026-10-22T18:00:00+09:00') });
  await page.goto(url);
  await onboard(page);
  await startWorkout(page);

  const head = async () => {
    const boxes = page.locator('.set-strip').first().locator('.set-box');
    return (await boxes.count()) + '세트 중 ' + (await page.locator('.set-strip').first().locator('.set-box.done').count()) + '세트 끝';
  };
  const total = await page.locator('.set-strip').first().locator('.set-box').count();
  check(total >= 3, '세트 칸이 ' + total + '개입니다');
  check((await head()) === total + '세트 중 0세트 끝', '처음 머리줄: ' + await head());
  check((await page.locator('.set-box.now').first().textContent()).includes('지금'), '지금 할 칸 표시가 없습니다');

  // 세트 끝내기는 버튼 하나 — 남은 힘을 묻지 않는다
  check(await page.locator('.now-rir').count() === 0, '남은 힘 버튼이 아직 있습니다');
  check((await page.locator('.now-done').textContent()).includes('1세트 완료'), '완료 버튼: ' + await page.locator('.now-done').textContent());
  await shot('0-simple');

  await page.locator('.now-done').click();
  await page.locator('.now-done').click();
  check((await head()) === total + '세트 중 2세트 끝', '두 세트 뒤 머리줄: ' + await head());
  check(await page.locator('.set-strip').first().locator('.set-box.done').count() === 2, '✓ 칸이 둘이 아닙니다');
  check((await page.locator('.now-line b').first().textContent()).startsWith('3세트'), '지금 세트: ' + await page.locator('.now-line b').first().textContent());
  await shot('1-strip');

  // 1세트 횟수를 고친다 — 지금 할 세트는 그대로 3세트
  await page.locator('.set-box.done').first().click();
  await page.locator('dialog .set-edit-reps').fill('7');
  check(await page.locator('dialog .rir-row').count() === 0, '고치는 창에서도 남은 힘을 묻습니다');
  await shot('2-edit');
  await page.locator('dialog .set-edit-save').click();
  await page.waitForFunction(() => !document.querySelector('dialog')?.open);
  check((await page.locator('.set-box.done').first().textContent()).includes('×7'), '고친 횟수가 칸에 없습니다');
  check((await head()) === total + '세트 중 2세트 끝', '고치고 나서 머리줄: ' + await head());
  check((await page.locator('.now-line b').first().textContent()).startsWith('3세트'), '고쳤더니 지금 세트가 바뀌었습니다');

  // 기록에도 고친 값이 들어갔다
  const saved = await page.evaluate(() => localStorage.getItem('volume-coach.proto.state') || '');
  check(saved.includes('"reps":7'), '저장된 기록에 고친 횟수가 없습니다');
  await shot('3-after');

  // 원하는 사람은 내 정보에서 묻기를 켠다 — 켜면 "몇 개 더" 버튼이 돌아온다
  await tab(page, '내 정보');
  await page.locator('.coach-settings .segmented button', { hasText: '남은 횟수' }).click();
  await tab(page, '오늘');
  await page.locator('.now-rir .chip', { hasText: '2개 더' }).waitFor();
  check(await page.locator('.now-done').count() === 0, '묻기를 켰는데 완료 버튼이 그대로입니다');
}
