// 반복 수를 사람에게 — 내 정보에서 "가볍게 많이"를 고르면 그대로 처방하고, 종목마다 직접 정한 반복이 블록보다
//   먼저이고, 블록 유형을 바꾸면 처방 횟수가 실제로 바뀐다. 처방보다 두 번 연속 많이 했으면
//   "바꿀까요?"를 묻고 — 안 누르면 그대로, "그대로 두기"면 다시 안 묻는다.
import { check, onboard, tab } from './lib.mjs';

const rowReps = async (page, name) => (await page.locator('.plan-row', { has: page.locator('.name', { hasText: name }) })
  .first().locator('.plan-sets').textContent()).trim();

export default async function ({ page, url, shot }) {
  await page.clock.install({ time: new Date('2026-10-22T18:00:00+09:00') });
  await page.goto(url);
  await onboard(page);
  // 반복 스타일은 처음 설정에서 묻지 않는다 — 내 정보 › 반복 · 강도에서 고른다
  await tab(page, '내 정보');
  await page.locator('.rep-style-pick', { hasText: '가볍게 많이' }).click();
  check(await page.locator('.rep-style-pick[aria-pressed="true"]', { hasText: '가볍게 많이' }).count() === 1, '스타일이 안 골라집니다');
  await shot('1-style');
  await tab(page, '오늘');

  // 가볍게 많이 — 주 종목도 10–15회
  const lines = await page.locator('.plan-row .plan-sets').allTextContents();
  check(lines.some((line) => /10–15회/.test(line)), '가볍게 많이를 골랐는데 10–15회가 없습니다: ' + lines.join(' / '));
  check(!lines.some((line) => /[456]–[68]회/.test(line)), '가볍게 많이인데 저반복이 있습니다: ' + lines.join(' / '));
  const first = (await page.locator('.plan-row .name > span:first-child').allTextContents())[0].trim();
  const second = (await page.locator('.plan-row .name > span:first-child').allTextContents())[1].trim();

  // 종목마다 — 첫 종목만 6~10회로
  await page.locator('.plan-row .row-menu').first().click();
  await page.locator('dialog .menu-row', { hasText: '이 종목 반복 수' }).click();
  await page.locator('dialog .rep-presets .pick', { hasText: /^6~10회$/ }).click();
  await shot('2-override');
  await page.locator('dialog .rep-save').click();
  check(/6–10회/.test(await rowReps(page, first)), '직접 정한 반복이 안 들어갔습니다: ' + await rowReps(page, first));

  // 블록 유형(내 정보) — 고밀도(8~12)로 바꾸면 다른 종목은 바뀌고, 직접 정한 종목은 그대로
  await tab(page, '내 정보');
  await page.locator('.block-toggle').click();
  await page.locator('.choice', { hasText: '고밀도' }).click();
  await tab(page, '오늘');
  check(/8–12회/.test(await rowReps(page, second)), '블록을 바꿨는데 처방 횟수가 그대로입니다: ' + await rowReps(page, second));
  check(/6–10회/.test(await rowReps(page, first)), '직접 정한 반복이 블록에 덮였습니다: ' + await rowReps(page, first));
  await tab(page, '내 정보');
  if (await page.locator('.block-toggle[aria-expanded="false"]').count()) await page.locator('.block-toggle').click();
  await page.locator('.block-style .choice', { hasText: '근비대' }).first().click();
  await tab(page, '오늘');

  // 바꿀까요? — 지난주 두 번, 두 번째 종목을 처방보다 훨씬 많이 했다(이번 주 순서는 그대로 두려고 지난주로)
  const secondId = await page.evaluate((name) => window.FitEngine.EXERCISES.find((e) => e.name === name).id, second);
  await page.evaluate((id) => {
    const key = 'volume-coach.proto.state';
    const saved = JSON.parse(localStorage.getItem(key));
    const sets = (reps) => reps.map((count) => ({ exerciseId: id, weightKg: 20, reps: count, rir: 2 }));
    saved.sessions = (saved.sessions || []).concat([
      { id: 's1', date: '2026-10-12', updatedAt: '2026-10-12T10:00:00Z', sets: sets([20, 19, 18]) },
      { id: 's2', date: '2026-10-15', updatedAt: '2026-10-15T10:00:00Z', sets: sets([20, 18, 18]) },
    ]);
    localStorage.setItem(key, JSON.stringify(saved));
  }, secondId);
  await page.reload();
  await page.waitForSelector('.tabbar [role="tab"]');
  const tip = page.locator('.rep-suggest');
  check(await tip.count() === 1, '처방보다 늘 많이 했는데 묻지 않습니다');
  check((await tip.textContent()).includes(second) && (await tip.textContent()).includes('12~20회'), '제안: ' + await tip.textContent());
  await shot('3-suggest');

  // 안 누르면 그대로 — 처방은 안 바뀐다
  const before = await rowReps(page, second);
  await page.reload();
  await page.waitForSelector('.tabbar [role="tab"]');
  check(await rowReps(page, second) === before, '답하지 않았는데 처방이 바뀌었습니다');

  // 그대로 두기 — 다시 묻지 않는다
  await page.locator('.rep-suggest-no').click();
  check(await page.locator('.rep-suggest').count() === 0, '그대로 두기 뒤에도 묻습니다');
  await page.reload();
  await page.waitForSelector('.tabbar [role="tab"]');
  check(await page.locator('.rep-suggest').count() === 0, '다시 켜니 또 묻습니다');
  check(await rowReps(page, second) === before, '그대로 두기인데 처방이 바뀌었습니다');
}
