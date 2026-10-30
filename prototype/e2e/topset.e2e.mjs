// 주 1회 무거운 세트 — 중급이 켜면 이번 주 차례인 바벨 메인 종목 앞에 1~3회 무거운 세트가 하나 붙는다.
//   그 뒤 원래 세트(백오프)는 무게가 그대로고(2회 했다고 깎지 않는다), 기록에는 무거운 세트로 남는다.
import { check, onboard, startWorkout, tab } from './lib.mjs';

export default async function ({ page, url, shot }) {
  await page.clock.install({ time: new Date('2026-10-22T18:00:00+09:00') });
  await page.goto(url);
  await onboard(page, { level: '중급' });

  // 켜기 — 이번 주 종목을 말해 준다
  await tab(page, '내 정보');
  const row = page.locator('.top-set-row');
  check((await row.textContent()).includes('꺼짐'), '기본이 꺼짐이 아닙니다');
  await row.click();
  const text = await row.textContent();
  check(text.includes('켜짐') && text.includes('이번 주:'), '켠 뒤: ' + text);
  await shot('1-on');

  // 이번 주 종목의 지난주 기록을 넣고, 그 종목이 있는 날로 바꾼다
  const pick = await page.evaluate(() => {
    const saved = JSON.parse(localStorage.getItem('volume-coach.proto.state'));
    const choice = window.FitEngine.topSetPick(saved.program.templates, '2026-10-22');
    const exercise = window.FitEngine.EXERCISES.find((e) => e.id === choice.exerciseId);
    saved.sessions = (saved.sessions || []).concat([{
      id: 'last', date: '2026-10-15', updatedAt: '2026-10-15T10:00:00Z',
      sets: [8, 8, 8].map((reps) => ({ exerciseId: exercise.id, weightKg: 60, reps, rir: 2 })),
    }]);
    localStorage.setItem('volume-coach.proto.state', JSON.stringify(saved));
    return { name: exercise.name, day: saved.program.templates[choice.templateIndex].name };
  });
  await page.reload();
  await page.waitForSelector('.tabbar [role="tab"]');
  await tab(page, '오늘');
  await page.locator('.day-switch').click();
  await page.locator('dialog .day-row', { hasText: pick.day }).first().click();
  await page.waitForFunction(() => !document.querySelector('dialog')?.open);

  const plan = await page.locator('.plan-row', { has: page.locator('.name', { hasText: pick.name }) }).first().locator('.plan-sets').textContent();
  check(plan.includes('무거운 1세트') && plan.includes('1–3회'), `${pick.name} 줄: ${plan}`);
  const heavyKg = Number(plan.match(/무거운 1세트 ([\d.]+)kg/)[1]);
  check(heavyKg > 60, '무거운 세트가 지난 기록보다 가볍습니다: ' + heavyKg);
  await shot('2-plan');

  // 다른 종목에는 안 붙는다
  const all = await page.locator('.plan-row .plan-sets').allTextContents();
  check(all.filter((line) => line.includes('무거운 1세트')).length === 1, '무거운 세트가 둘 이상입니다');

  // 그 종목으로 가서 무거운 세트를 한다
  await startWorkout(page);
  for (let i = 0; i < 12; i += 1) {
    if ((await page.locator('.progress-name > span').first().textContent()).trim() === pick.name) break;
    await page.locator('.now-done').click();
    await page.locator('#rest-host .rest-skip', { hasText: '건너뛰기' }).click().catch(() => {});
  }
  check((await page.locator('.top-tag').textContent()).includes('무거운 세트'), '무거운 세트 표시가 없습니다');
  await page.locator('input[aria-label$="반복 수"]').first().fill('2');
  await page.locator('input[aria-label$="반복 수"]').first().dispatchEvent('change');
  await shot('3-top');
  const backoffBefore = await page.evaluate(() => document.querySelectorAll('.set-plan .set-plan-line')[0]?.textContent || '');
  await page.locator('.now-done').click();
  const kg = Number(await page.locator('.big-input').first().inputValue());
  check(kg <= 60 && kg >= 50, `무거운 세트 뒤 백오프가 ${kg}kg (전: ${backoffBefore})`);
  check(await page.locator('.top-tag').count() === 0, '2세트도 무거운 세트로 표시됩니다');

  const saved = await page.evaluate(() => localStorage.getItem('volume-coach.proto.state'));
  check(/"reps":2,"rir":\d,"top":true/.test(saved) || /"top":true/.test(saved), '기록에 무거운 세트 표시가 없습니다');
}
