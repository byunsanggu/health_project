// 목요일에 시작한 사람 — 이번 주 칸 · 첫 주 약속 · 리포트가 서로 같은 말을 한다
// (전에는 표가 "목 휴식 · 금 전신 C", 오늘 화면은 "내일 · 전신 B", 금요일 운동 전에 리포트,
//  목 · 금을 다 해도 다음 주 "0주 연속")
import { check, onboard, tab } from './lib.mjs';

async function trainOneSet(page) {
  await tab(page, '오늘');
  await page.click('.start-cta');
  await page.locator('.now-done').click();
  await page.locator('button', { hasText: '운동 끝내기' }).first().click();
  await page.locator('dialog').getByRole('button', { name: '오늘 마치기' }).click();
}

export default async function ({ page, url, shot }) {
  await page.clock.install({ time: new Date('2026-10-22T18:00:00+09:00') }); // 목
  await page.goto(url);
  await onboard(page);

  // 주 4회(월 · 화 · 목 · 금) — 시작한 주는 4 × 4/7 ≈ 2번
  await tab(page, '주간');
  const kinds = await page.locator('.week-strip .day').evaluateAll((nodes) =>
    nodes.map((node) => ['done', 'today', 'planned', 'rest', 'before'].find((k) => node.classList.contains(k))));
  check(kinds.join(',') === 'before,before,before,today,planned,rest,rest', '이번 주 칸: ' + kinds.join(','));
  const names = await page.locator('.week-strip .day-name').allTextContents();
  const todayName = names[3];
  await page.locator('.week-strip').scrollIntoViewIfNeeded();
  await shot('1-week');

  await trainOneSet(page);
  check(await page.locator('.report-nudge').count() === 0, '목표 2번 중 1번인데 리포트가 떴습니다');

  // 금요일 — 운동 전에는 리포트가 없고, 오늘 칸은 표와 같은 날
  await page.clock.setSystemTime(new Date('2026-10-23T08:00:00+09:00'));
  await page.reload();
  await tab(page, '오늘');
  check(await page.locator('.report-nudge').count() === 0, '금요일 운동 전에 리포트가 떴습니다');
  await tab(page, '주간');
  const friday = await page.locator('.week-strip .day').nth(4).textContent();
  check(friday.startsWith('오늘'), '금요일 칸이 오늘이 아닙니다: ' + friday);
  check((await page.locator('.week-strip .day').nth(3).textContent()).includes('✓ ' + todayName), '목요일 한 것이 표에 없습니다');

  await trainOneSet(page);
  check(await page.locator('.report-nudge').count() === 1, '첫 주 약속(2번)을 채웠는데 리포트가 없습니다');

  // 다음 주 월요일 — 첫 주를 지켰으니 1주 연속
  await page.clock.setSystemTime(new Date('2026-10-26T08:00:00+09:00'));
  await page.reload();
  await tab(page, '주간');
  const streak = await page.locator('.streak-card .streak-num b').textContent();
  check(streak === '1', '목 · 금 다 했는데 다음 주 연속이 ' + streak);
  await shot('2-monday');
}
