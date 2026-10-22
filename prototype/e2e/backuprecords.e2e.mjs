// 설문 답이 없는 백업(기록만 든 파일) — 설문은 새로 하고, 기록은 설문을 마칠 때 들어간다
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { check, finishWizard, tab } from './lib.mjs';

export default async function ({ page, url, out }) {
  await page.clock.install({ time: new Date('2026-10-22T18:00:00+09:00') });
  await page.goto(url);
  await page.waitForSelector('.consent-card');

  const file = join(out, 'backup-records-only.json');
  await writeFile(file, JSON.stringify({
    운동기록: [{ date: '2026-10-20', sets: [{ exerciseId: 'leg-press', weightKg: 100, reps: 10, rir: 2 }] }],
  }));
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.locator('.backup-pick').click()]);
  await chooser.setFiles(file);
  const ready = await page.locator('.backup-ready').textContent();
  check(ready.includes('설문은 새로 합니다'), '설문 이야기가 없습니다: ' + ready);

  const cards = page.locator('.consent-card');
  for (let i = 0; i < await cards.count(); i += 1) {
    const card = cards.nth(i);
    if (await card.locator('.consent-tag.req').count()) await card.locator('.consent-toggle').click();
  }
  check((await page.locator('.wizard-nav .primary').textContent()).trim() === '다음', '설문 없이 이어 하려 합니다');
  await finishWizard(page);

  await page.locator('dialog .backup-report').first().waitFor();
  check((await page.locator('dialog').textContent()).includes('운동 기록 1일'), '설문을 마쳤는데 기록 알림이 없습니다');
  await page.locator('dialog .modal-close').click();
  await tab(page, '진행');
  const rows = await page.locator('.history-row').allTextContents();
  check(rows.length === 1 && rows[0].includes('10월 20일'), '진행 탭: ' + rows.join(' / '));
}
