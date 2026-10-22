// 혼자 모드 — 시작 → 남은 횟수 눌러 세트 기록 → 휴식 → 종목을 다 하면 다음 종목으로
//   → 앱을 다시 켜도 이어진다 → 운동 끝내기는 요약을 연다
import { check, onboard } from './lib.mjs';

export default async function ({ page, url, shot }) {
  await page.clock.install({ time: new Date('2026-10-22T18:00:00+09:00') });
  await page.goto(url);
  await onboard(page);
  await page.click('.start-cta');
  check(await page.locator('.progress-count b').textContent() === '1', '첫 종목이 아닙니다');

  // 첫 종목을 끝까지 — 세트마다 "2회" 누르고, 쉬는 시간은 건너뛴다
  for (let i = 0; i < 12; i += 1) {
    if (await page.locator('.progress-count b').textContent() !== '1') break;
    const chip = page.locator('.now-rir .chip', { hasText: '2회' });
    if (!await chip.count()) break;
    await chip.click();
    check(await page.locator('#rest-host').isVisible(), '세트를 기록했는데 휴식이 안 뜹니다');
    if (i === 0) await shot('1-rest');
    await page.locator('#rest-host .rest-skip').first().click();
  }
  check(await page.locator('.progress-count b').textContent() === '2', '첫 종목을 마쳤는데 다음 종목으로 안 넘어갔습니다');

  // 다시 켜도 그 자리
  await page.reload();
  await page.waitForSelector('.progress-count');
  check(await page.locator('.progress-count b').textContent() === '2', '다시 켰더니 다른 종목입니다');

  await page.locator('.end-workout, button', { hasText: '운동 끝내기' }).first().click();
  await page.locator('dialog').waitFor();
  check((await page.locator('dialog').textContent()).length > 50, '요약이 비어 있습니다');
  await shot('2-summary');

  // 오늘을 마치면 운동 시간이 거기서 멈춘다 — 90분 뒤에 봐도 같은 시간
  await page.locator('dialog').getByRole('button', { name: '오늘 마치기' }).click();
  const minutes = async () => (await page.locator('#screen').textContent()).match(/(\d+)분 동안/)?.[1];
  const before = await minutes();
  check(before, '마친 화면에 운동 시간이 없습니다');
  await page.clock.fastForward(90 * 60 * 1000);
  await page.locator('.tabbar [role="tab"]', { hasText: '주간' }).click();
  await page.locator('.tabbar [role="tab"]', { hasText: '오늘' }).click();
  check(await minutes() === before, `마친 뒤 시간이 ${before}분 → ${await minutes()}분으로 늘었습니다`);
}
