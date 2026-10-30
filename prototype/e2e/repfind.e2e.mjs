// 반복 기능을 찾기 쉬운가 — 내 정보의 "반복 · 강도"에서 한 곳에서 보고 바꾸고, 종목 줄(세트 · 무게 · 반복)을
//   누르면 바로 그 종목 반복 수가 열리고, 직접 정한 종목은 목록에 표시된다. 여러 종목을 늘 많이 하면
//   종목마다가 아니라 평소 반복 스타일을 한 번 묻는다.
import { check, onboard, tab } from './lib.mjs';

export default async function ({ page, url, shot }) {
  await page.clock.install({ time: new Date('2026-10-22T18:00:00+09:00') });
  await page.goto(url);
  await onboard(page);

  // 내 정보 › 반복 · 강도 — 스타일 · 무거운 세트가 한 곳에
  const pressed = page.locator('.rep-settings .rep-style-pick[aria-pressed="true"]');
  await tab(page, '내 정보');
  check(await page.locator('.rep-settings .rep-style-pick').count() === 5, '스타일 칩이 없습니다');
  check((await pressed.textContent()).includes('목표에 맞춰'), '지금 스타일: ' + await pressed.textContent());
  check(await page.locator('.rep-settings .top-set-row').count() === 1, '무거운 세트 켜기가 없습니다');
  await shot('1-settings');
  await tab(page, '오늘');
  const dialog = page.locator('dialog');

  // 종목 줄을 누르면 그 종목 반복 수
  const name = (await page.locator('.plan-row .name > span:first-child').nth(0).textContent()).trim();
  await page.locator('.plan-sets-btn').first().click();
  check((await dialog.locator('#modal-title').textContent()).includes(name), '누른 종목의 반복 수 창이 아닙니다');
  await dialog.locator('.rep-presets .pick', { hasText: /^10~15회$/ }).click();
  await dialog.locator('.rep-save').click();
  const row = page.locator('.plan-row', { has: page.locator('.name', { hasText: name }) }).first();
  check(await row.locator('.own-tag').count() === 1, '직접 정한 종목 표시가 없습니다');
  await shot('2-own');

  // 지난주에 종목 넷을 늘 많이 했다 → 평소 스타일을 한 번 묻는다
  await page.evaluate(() => {
    const key = 'volume-coach.proto.state';
    const saved = JSON.parse(localStorage.getItem(key));
    const ids = [...new Set(saved.program.templates.flatMap((t) => t.slots.map((s) => s.exerciseId)))].slice(0, 6);
    const sets = (reps) => ids.flatMap((id) => reps.map((count) => ({ exerciseId: id, weightKg: 20, reps: count, rir: 2 })));
    saved.sessions = (saved.sessions || []).concat([
      { id: 'w1', date: '2026-10-12', updatedAt: '2026-10-12T10:00:00Z', sets: sets([22, 21, 20]) },
      { id: 'w2', date: '2026-10-15', updatedAt: '2026-10-15T10:00:00Z', sets: sets([22, 20, 20]) },
    ]);
    localStorage.setItem(key, JSON.stringify(saved));
  });
  await page.reload();
  await page.waitForSelector('.tabbar [role="tab"]');
  const tip = page.locator('.rep-suggest-style');
  check(await tip.count() === 1, '여러 종목을 늘 많이 했는데 스타일을 묻지 않습니다');
  check(await page.locator('.rep-suggest').count() === 1, '종목마다 따로 또 묻습니다');
  await shot('3-style-tip');
  await tip.locator('.rep-suggest-yes').click();
  check(await page.locator('.rep-suggest-style').count() === 0, '바꾼 뒤에도 묻습니다');
  await tab(page, '내 정보');
  check((await pressed.textContent()).includes('가볍게 많이'), '바꿨는데 반복 방식이 그대로입니다');
}
