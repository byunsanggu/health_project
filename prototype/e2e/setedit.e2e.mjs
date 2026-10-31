// 세트 줄 미리 고치기 — 고친 무게는 앞 세트를 끝내도 · 다시 켜도 그대로, 0kg은 받지 않고, ✓는 두 번 눌러야 지운다.
//   전에는 다음 세트를 40kg으로 고쳐도 앞 세트를 끝내면 말없이 45kg으로 돌아갔고, 다시 켜면 고친 값이 사라졌다.
import { check, onboard, startWorkout } from './lib.mjs';

const weights = (page) => page.locator('.set-strip').first().locator('.set-box .set-in-weight')
  .evaluateAll((inputs) => inputs.map((input) => input.value));
const saved = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('volume-coach.proto.state')).settings.todaySets);

export default async function ({ page, url, shot }) {
  await page.clock.install({ time: new Date('2026-10-22T18:00:00+09:00') });
  await page.goto(url);
  await onboard(page);
  await startWorkout(page);

  const start = await weights(page);
  check(start.length >= 3 && Number(start[0]) > 0, '처음 무게 칸: ' + JSON.stringify(start));
  const planned = Number(start[0]);

  // 바벨 종목에 0kg — 받지 않는다(기록이 0kg으로 남고 무게 칸이 사라졌다)
  const now = page.locator('.set-box.now .set-in-weight');
  await now.fill('0');
  await now.press('Enter');
  await now.blur();
  check(Number((await weights(page))[0]) === planned, '0kg을 받았습니다: ' + JSON.stringify(await weights(page)));

  // 2세트를 미리 낮춘다 → 1세트를 끝내도 2세트는 고친 값
  const lower = planned - 5;
  const second = page.locator('.set-strip').first().locator('.set-box').nth(1).locator('.set-in-weight');
  await second.fill(String(lower));
  await second.press('Enter');
  await second.blur();
  await page.locator('.now-done').click();
  const afterDone = await weights(page);
  check(Number(afterDone[1]) === lower, '1세트를 끝내니 고친 2세트 무게가 돌아갔습니다: ' + JSON.stringify(afterDone));
  await shot('0-kept');

  // 다시 켜도 그대로
  await page.reload();
  await page.locator('.set-strip').first().waitFor();
  const reloaded = await weights(page);
  check(Number(reloaded[1]) === lower && Number(reloaded[2]) === lower, '다시 켜니 고친 무게가 사라졌습니다: ' + JSON.stringify(reloaded));

  // ✓ 한 번은 "지울까요?" — 기록은 그대로, 한 번 더 눌러야 지운다
  const undo = page.locator('.set-box.done .set-undo').first();
  await undo.click();
  check((await undo.textContent()).includes('지울까요'), '한 번 눌렀는데 묻지 않았습니다: ' + await undo.textContent());
  check((await saved(page)).length === 1, '한 번 눌렀는데 기록이 지워졌습니다');
  await shot('1-armed');
  await page.locator('.set-box.done .set-undo').first().click();
  check((await saved(page)).length === 0, '두 번 눌렀는데 기록이 남았습니다');
}
