// 임시 — U2 문구 점검용. 끝나면 지운다.
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { finishWizard, gymTab, pickMe, tab } from './lib.mjs';

export default async function ({ page, url, out }) {
  await page.clock.install({ time: new Date('2026-10-22T18:00:00+09:00') });
  await page.goto(url);
  await page.waitForSelector('.consent-card');
  const dump = [];
  const grab = async (label) => dump.push('### ' + label + '\n' + (await page.locator('#screen').innerText()));
  const cards = page.locator('.consent-card');
  for (let i = 0; i < await cards.count(); i += 1) {
    if (await cards.nth(i).locator('.consent-tag.req').count()) await cards.nth(i).locator('.consent-toggle').click();
  }
  await grab('consent');
  await page.click('.wizard-nav .primary');
  await pickMe(page, { level: '초보', sex: '여성' });
  await grab('me');
  await page.click('.wizard-nav .primary');
  await page.locator('.chip-row .pick', { hasText: '동네 헬스장' }).click();
  await grab('gym');
  await page.click('.wizard-nav .primary');
  await grab('result');
  await finishWizard(page, { level: '초보', sex: '여성' });
  await grab('today');
  await tab(page, '내 정보');
  await page.locator('.block-toggle').click();
  await grab('me-settings');
  await gymTab(page);
  await grab('me-gym');
  await tab(page, '식단');
  await grab('diet');
  await tab(page, '오늘');
  await page.locator('.extras-toggle', { hasText: '유산소' }).click();
  await grab('extras');
  await writeFile(join(out, 'u2-dump.txt'), dump.join('\n\n'));
}
