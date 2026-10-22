// 전부 삭제 — 식단(민감정보)도 남지 않는다. 다시 설정하고 식단에 다시 동의해도 옛 기록이 돌아오지 않는다
//   (전에는 저장소만 비우고 화면이 들고 있던 칸들을 다음 저장 때 그대로 다시 썼다)
import { check, onboard, tab } from './lib.mjs';

export default async function ({ page, url }) {
  await page.clock.install({ time: new Date('2026-10-22T12:30:00+09:00') });
  await page.goto(url);
  await onboard(page, { consent: 'required' });
  await tab(page, '식단');
  await page.locator('.food-log').getByRole('button', { name: '동의하고 적기 시작' }).click();
  await page.fill('#food-text', '김치찌개 1인분');
  await page.click('.food-calc');
  await page.locator('.food-commit').click();
  check(await page.locator('.food-day .food-entry').count() === 1, '식단이 안 적혔습니다');

  // 운동도 한 세트 하고 마친다 — 오늘 마친 상태도 남으면 안 된다
  await tab(page, '오늘');
  await page.click('.start-cta');
  await page.locator('.now-rir .chip', { hasText: '2회' }).click();
  await page.locator('button', { hasText: '운동 끝내기' }).first().click();
  await page.locator('dialog').getByRole('button', { name: '오늘 마치기' }).click();

  await page.click('#me-btn');
  await page.getByRole('button', { name: '전부 삭제' }).click();
  await page.locator('dialog').getByRole('button', { name: '네, 전부 삭제합니다' }).click();
  await page.waitForSelector('.consent-card');
  const left = await page.evaluate(() => {
    const raw = localStorage.getItem('volume-coach.proto.state');
    return raw ? JSON.parse(raw) : null;
  });
  check(!left || !left.settings || !(left.settings.foodLog || []).length, '지웠는데 저장소에 식단이 남았습니다');

  // 다시 설정하고 식단에 다시 동의해도 빈 식단 · 새 하루
  await onboard(page, { consent: 'required' });
  check(await page.locator('.start-cta').count() === 1, '지웠는데 오늘 운동이 마친 상태로 남았습니다');
  await tab(page, '식단');
  await page.locator('.food-log').getByRole('button', { name: '동의하고 적기 시작' }).click();
  check(await page.locator('.food-day .food-entry').count() === 0, '지운 식단이 돌아왔습니다');
  await tab(page, '진행');
  check(await page.locator('.history-row').count() === 0, '지운 운동 기록이 돌아왔습니다');
}
