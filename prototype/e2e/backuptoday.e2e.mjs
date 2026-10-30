// 폰을 바꾸는 날 — 오늘 운동한 뒤 내려받아 바로 불러오면, 오늘 한 세트가 오늘 종목에 다시 붙는다
//   (안 붙으면 다음 세트를 칠 때 오늘 기록이 그 한 세트로 덮인다)
import { join } from 'node:path';
import { check, onboard, startWorkout, tab } from './lib.mjs';

export default async function ({ page, url, out }) {
  await page.clock.install({ time: new Date('2026-10-22T18:00:00+09:00') });
  await page.goto(url);
  await onboard(page);
  await startWorkout(page);
  await page.locator('.now-done').click();
  await page.locator('#rest-host .rest-skip', { hasText: '건너뛰기' }).click();
  await page.locator('.now-done').click();
  await page.locator('#rest-host .rest-skip', { hasText: '건너뛰기' }).click();
  await tab(page, '오늘');
  await page.locator('button', { hasText: '운동 끝내기' }).first().click();
  await page.locator('dialog').getByRole('button', { name: '오늘 마치기' }).click();

  await tab(page, '내 정보');
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: '내 데이터 내려받기' }).click(),
  ]);
  const file = join(out, 'backup-today.json');
  await download.saveAs(file);
  await page.getByRole('button', { name: '전부 삭제' }).click();
  await page.locator('dialog').getByRole('button', { name: '네, 전부 삭제합니다' }).click();
  await page.waitForSelector('.consent-card');

  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.locator('.backup-pick').click()]);
  await chooser.setFiles(file);
  await page.locator('.backup-ready').waitFor();
  const cards = page.locator('.consent-card');
  for (let i = 0; i < await cards.count(); i += 1) {
    const card = cards.nth(i);
    if (await card.locator('.consent-tag.req').count()) await card.locator('.consent-toggle').click();
  }
  await page.locator('.wizard-nav .primary').click();
  await page.locator('dialog .backup-report').first().waitFor();
  await page.locator('dialog .modal-close').click();

  // 오늘 목록의 첫 종목에 두 세트가 끝난 것으로
  const mark = await page.locator('.plan-row .plan-done').first().textContent();
  check(/^2\/\d+$/.test(mark.trim()), '오늘 종목에 끝낸 세트가 안 붙었습니다: ' + mark);
  await tab(page, '기록');
  const rows = await page.locator('.history-row').allTextContents();
  check(rows.length === 1 && rows[0].includes('오늘') && rows[0].includes('2세트'), '진행 탭: ' + rows.join(' / '));
  await tab(page, '오늘');

  // 다시 켜도, 다음 세트를 쳐도 오늘 기록은 두 세트 위에 쌓인다
  await page.reload();
  await startWorkout(page);
  await page.locator('.now-done').click();
  await tab(page, '기록');
  const after = await page.locator('.history-row').first().textContent();
  check(after.includes('3세트'), '불러온 오늘 기록이 덮였습니다: ' + after);
}
