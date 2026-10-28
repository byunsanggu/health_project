// 방금 적은 세트 5초 되돌리기 · 진행 탭의 운동 기록(누르면 그날 세트 · 지난날은 지우기)
import { check, onboard, tab } from './lib.mjs';

export default async function ({ page, url, shot }) {
  await page.clock.install({ time: new Date('2026-10-22T18:00:00+09:00') });
  await page.goto(url);
  await onboard(page);
  await page.click('.start-cta');

  // 잘못 누른 세트 — 바로 되돌린다
  await page.locator('.now-done').click();
  const strip = page.locator('#rest-host .undo-strip');
  check((await strip.textContent()).includes('1세트 기록했습니다'), '되돌리기 줄이 없습니다');
  await shot('1-undo');
  await strip.getByRole('button', { name: '되돌리기' }).click();
  check((await page.locator('.now-done').textContent()).includes('1세트'), '되돌렸는데 1세트가 아닙니다');
  check(await page.locator('#rest-host').isHidden(), '되돌렸는데 휴식이 돕니다');

  // 다시 적으면 5초 뒤 되돌리기 줄은 사라진다
  await page.locator('.now-done').click();
  await page.clock.runFor(5500);
  check(await page.locator('#rest-host .undo-strip').count() === 0, '5초가 지났는데 되돌리기가 남았습니다');
  await page.locator('#rest-host .rest-skip', { hasText: '건너뛰기' }).click();
  await page.locator('.now-done').click();

  // 오늘 기록이 진행 탭 맨 위에
  await tab(page, '진행');
  check((await page.locator('.history-row').first().textContent()).includes('오늘'), '진행 탭에 오늘 기록이 없습니다');
  check((await page.locator('.history-row').first().textContent()).includes('2세트'), '오늘 세트 수가 다릅니다');
  await tab(page, '오늘');
  await page.locator('button', { hasText: '운동 끝내기' }).first().click();
  await page.locator('dialog').getByRole('button', { name: '오늘 마치기' }).click();

  // 다음 날 — 어제 기록을 열고 지운다
  await page.clock.setSystemTime(new Date('2026-10-23T18:00:00+09:00'));
  await page.reload();
  await tab(page, '진행');
  const row = page.locator('.history-row').first();
  check((await row.textContent()).includes('10월 22일 (목)'), '어제 기록이 없습니다: ' + await row.textContent());
  await row.click();
  check(await page.locator('dialog .history-set').count() === 2, '그날 세트가 다 안 보입니다');
  await shot('2-day');
  await page.locator('dialog .history-delete').click();
  await page.locator('dialog').getByRole('button', { name: '지우기' }).click();
  check(await page.locator('.history-row').count() === 0, '지웠는데 기록이 남았습니다');
  await page.reload();
  await tab(page, '진행');
  check(await page.locator('.history-row').count() === 0, '다시 켰더니 지운 기록이 돌아왔습니다');
}
