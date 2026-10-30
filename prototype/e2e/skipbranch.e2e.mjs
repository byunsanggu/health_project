// 종목 빼기 — "오늘만 빼기"는 이유를 안 묻고 오늘만, 되돌릴 수 있다. 빼면 그 자리에 다른 종목이 생기지 않는다.
// 운동 중 종목 이름은 머리띠 한 곳만. 같은 브랜드의 다른 곳(바우짐 · 바우짐 여성점)은 따로 등록되고 구분 표시가 붙는다.
import { check, gymTab, onboard, startWorkout, tab } from './lib.mjs';

const names = async (page) => (await page.locator('.plan-row .name > span:first-child').allTextContents()).map((t) => t.trim());

export default async function ({ page, url, shot }) {
  await page.clock.install({ time: new Date('2026-10-22T18:00:00+09:00') });
  await page.goto(url);
  await onboard(page);
  const before = await names(page);

  // 오늘만 빼기 — 두 번째 종목
  await page.locator('.plan-row .row-menu').nth(1).click();
  await page.locator('dialog .menu-row', { hasText: '이 종목 빼기' }).click();
  await shot('1-exclude');
  await page.locator('dialog .skip-today').click();
  const afterSkip = await names(page);
  check(!afterSkip.includes(before[1]), '오늘만 뺐는데 목록에 있습니다');
  check(afterSkip.length === before.length - 1, `다른 종목이 대신 들어왔습니다: ${afterSkip.join(', ')}`);
  check((await page.locator('.skip-today-line').textContent()).includes(before[1]), '오늘만 뺀 종목이 안 보입니다');
  await shot('2-skipped');
  await page.locator('.skip-undo').click();
  check((await names(page)).includes(before[1]), '되돌리기가 안 됩니다');

  // 앞으로도 빼기(하기 싫어요) — 대신 들어오는 종목이 없다
  await page.locator('.plan-row .row-menu').nth(1).click();
  await page.locator('dialog .menu-row', { hasText: '이 종목 빼기' }).click();
  await page.locator('dialog .menu-row', { hasText: '그냥 하기 싫어요' }).click();
  check((await page.locator('dialog').textContent()).includes('비워 둡니다'), '빈자리를 채운다고 합니다');
  await page.locator('dialog .finish', { hasText: '당분간 빼기' }).click();
  const afterExclude = await names(page);
  check(afterExclude.length === before.length - 1 && !afterExclude.includes(before[1]), `뺐는데 다른 종목이 생겼습니다: ${afterExclude.join(', ')}`);
  check(afterExclude.every((name) => before.includes(name)), '목록에 없던 종목이 생겼습니다: ' + afterExclude.join(', '));

  // 운동 중 — 종목 이름은 머리띠에만
  await startWorkout(page);
  const visible = await page.locator('.lift-name > span:not(.sr-only)').allTextContents();
  check(!visible.some((text) => text.trim() === before[0]), '카드에도 종목 이름이 또 있습니다');
  check((await page.locator('.progress-name > span').first().textContent()).trim() === before[0], '머리띠에 이름이 없습니다');
  await shot('3-one-name');
  await page.locator('.progress-top .demo-open', { hasText: '목록' }).click();

  // 바우짐 · 바우짐 여성점 — 따로 등록, 구분 표시
  await gymTab(page);
  await page.locator('.gym-link').click();
  await page.locator('dialog .choice', { hasText: '동네 헬스장' }).click();
  await page.locator('dialog input[placeholder="헬스장 이름"]').fill('바우짐');
  await page.locator('dialog .finish', { hasText: '등록하기' }).click();
  await page.waitForFunction(() => !document.querySelector('dialog')?.open);
  await page.locator('.register-open').click();
  await page.locator('dialog .choice', { hasText: '동네 헬스장' }).click();
  await page.locator('dialog input[placeholder="헬스장 이름"]').fill('바우짐 여성점');
  await page.locator('dialog .finish', { hasText: '등록하기' }).click();
  await page.waitForFunction(() => !document.querySelector('dialog')?.open);
  const rows = await page.locator('.gym-row .gym-name').allTextContents();
  check(rows.length === 2, '두 곳이 따로 등록되지 않았습니다: ' + rows.join(' / '));
  check(rows.some((text) => text.includes('바우짐 여성점') && text.includes('여성 전용')), '여성점 표시가 없습니다: ' + rows.join(' / '));
  check((await page.locator('.gym-here-name').textContent()).includes('여성 전용'), '지금 다니는 곳에 구분 표시가 없습니다');
  await shot('4-branches');
}
