// 안드로이드 뒤로가기 — 맨 위 층만 닫는다 (창 → 운동 화면 → 다른 탭 → 설정 단계)
// (전에는 창을 연 채 뒤로가기를 누르면 앱이 통째로 닫혔다)
import { check, onboard, tab, startWorkout } from './lib.mjs';

const back = async (page) => {
  await page.goBack({ waitUntil: 'commit' }).catch(() => null);
  await page.waitForTimeout(150);
};

export default async function ({ page, url }) {
  await page.goto(url);
  // 설정 단계 — 뒤로가기는 이전 단계
  await page.waitForSelector('.consent-card');
  const cards = page.locator('.consent-card');
  for (let i = 0; i < await cards.count(); i += 1) {
    if (await cards.nth(i).locator('.consent-tag.req').count()) await cards.nth(i).locator('.consent-toggle').click();
  }
  await page.click('.wizard-nav .primary');
  check(await page.locator('.session-head h2').textContent() === '경력', '경력 단계가 아닙니다');
  await back(page);
  check(await page.locator('.session-head h2').textContent() === '동의', '뒤로가기로 이전 단계에 안 갔습니다');
  await page.reload();
  await onboard(page);
  const home = page.url();

  // 다른 탭 → 오늘
  await tab(page, '식단');
  await back(page);
  check(await page.locator('.tabbar [aria-selected="true"]').textContent() === '오늘', '다른 탭에서 뒤로가기가 오늘로 안 갔습니다');
  check(page.url() === home, '앱을 나갔습니다');

  // 창 → 닫힘 (화면은 그대로)
  await page.locator('.coach-line').click();
  await page.locator('dialog[open]').waitFor();
  await back(page);
  check(await page.locator('dialog[open]').count() === 0, '창이 안 닫혔습니다');
  check(await page.locator('.start-cta').count() === 1, '창을 닫았는데 오늘 화면이 아닙니다');

  // 운동 화면 위의 창 → 창만 닫히고, 한 번 더 누르면 목록으로
  await startWorkout(page);
  await page.locator('button', { hasText: '운동 끝내기' }).first().click();
  await page.locator('dialog[open]').waitFor();
  await back(page);
  check(await page.locator('dialog[open]').count() === 0, '운동 화면의 창이 안 닫혔습니다');
  check(await page.locator('.progress-head').count() === 1, '창만 닫혀야 하는데 운동 화면을 나갔습니다');
  await back(page);
  check(await page.locator('.start-cta').count() === 1, '운동 화면에서 뒤로가기가 목록으로 안 갔습니다');
  check(page.url() === home, '앱을 나갔습니다');
}
