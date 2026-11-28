// 어시스트 풀업 — 스택 숫자는 "도움"이다(클수록 쉽다). 지난번에 도움 30kg으로 다 채웠으면 오늘은 도움 25kg,
//   화면에는 "도움 25kg"과 "숫자가 작을수록 어렵습니다". 지난번과 비교에서도 도움이 줄면 는 것이다.
import { check, onboard, openDetail, startWorkout, tab, todayDetail } from './lib.mjs';

const KEY = 'volume-coach.proto.state';

export default async function ({ page, url, shot }) {
  await page.clock.install({ time: new Date('2026-10-22T18:00:00+09:00') });
  await page.goto(url);
  await onboard(page, { level: '중급', days: 4 });

  // 오늘 할 날의 첫 당기기 자리를 어시스트 풀업으로 바꾸고, 지난주에 도움 30kg으로 위 끝까지 한 기록을 넣는다
  const day = await page.evaluate((key) => {
    const saved = JSON.parse(localStorage.getItem(key));
    const E = window.FitEngine;
    const pulls = [];
    saved.program.templates.forEach((template, d) => template.slots.forEach((slot, i) => {
      const exercise = E.EXERCISES.find((item) => item.id === slot.exerciseId);
      if (exercise && (exercise.pattern === 'verticalPull' || exercise.pattern === 'horizontalPull')) pulls.push([d, i]);
    }));
    pulls.forEach(([d, i]) => {
      const slot = saved.program.templates[d].slots[i];
      if (pulls.findIndex(([dd]) => dd === d) === pulls.findIndex(([dd, ii]) => dd === d && ii === i)) {
        saved.program.templates[d].slots[i] = Object.assign({}, slot, { exerciseId: 'assisted-pull-up', repRange: { min: 6, max: 10 } });
      }
    });
    // 이 헬스장에 어시스트 풀업 머신이 있다고 고른다 — 없으면 오늘 화면이 다른 당기기로 바꾼다
    const add = (ids) => (ids.indexOf('assisted-pull-up-machine') < 0 ? ids.concat(['assisted-pull-up-machine']) : ids);
    saved.answers.gym.equipmentIds = add(saved.answers.gym.equipmentIds || []);
    ((saved.settings.gymBook && saved.settings.gymBook.gyms) || []).forEach((gym) => { gym.equipmentIds = add(gym.equipmentIds || []); });
    saved.sessions = (saved.sessions || []).concat([{
      // 기계 무게는 그 헬스장 기록만 본다 — 다니는 헬스장 id를 붙인다
      id: 'assist-last', date: '2026-10-15', updatedAt: '2026-10-15T10:00:00Z',
      gymId: saved.settings.gymBook ? saved.settings.gymBook.activeId : undefined,
      sets: [10, 10, 10].map((reps) => ({ exerciseId: 'assisted-pull-up', weightKg: 30, reps, rir: 3 })),
    }]);
    localStorage.setItem(key, JSON.stringify(saved));
    return pulls.length;
  }, KEY);
  check(day > 0, '당기기 자리가 없습니다');
  await page.reload();
  await page.waitForSelector('.tabbar [role="tab"]');

  // 어시스트 풀업이 있는 날로 — 오늘 화면 › 자세히 › 날 바꾸기
  await tab(page, '오늘');
  await todayDetail(page);
  let row = page.locator('.plan-row', { has: page.locator('.name', { hasText: '어시스트 풀업' }) }).first();
  if (!(await row.count())) {
    await page.locator('.day-switch').click();
    const rows = page.locator('dialog .day-row');
    for (let i = 0; i < await rows.count(); i += 1) {
      if ((await rows.nth(i).textContent()).includes('어시스트')) { await rows.nth(i).click(); break; }
    }
    await page.waitForFunction(() => !document.querySelector('dialog')?.open);
    row = page.locator('.plan-row', { has: page.locator('.name', { hasText: '어시스트 풀업' }) }).first();
  }
  check(await row.count() === 1, '어시스트 풀업 줄이 없습니다');
  const plan = await row.textContent();
  check(/도움 25kg/.test(plan), '도움을 줄이지 않았습니다(30kg으로 다 채웠으면 25kg): ' + plan);
  check(!/도움 35kg|\b35kg/.test(plan), '도움이 늘었습니다: ' + plan);
  await row.scrollIntoViewIfNeeded();
  await shot('1-plan');

  // 운동 화면 — 숫자 칸에 "도움", 아래에 숫자가 작을수록 어렵다는 말
  await startWorkout(page);
  await openDetail(page);
  for (let i = 0; i < 10; i += 1) {
    const name = (await page.locator('.stage-name').textContent()).trim();
    if (name === '어시스트 풀업') break;
    const next = page.locator('.step-nav button', { hasText: '다음 운동' });
    if (!(await next.count())) break;
    await next.first().click();
  }
  check((await page.locator('.stage-name').textContent()).trim() === '어시스트 풀업', '어시스트 풀업 화면으로 못 갔습니다');
  check((await page.locator('.stage-sub.assist-hint').textContent()).includes('숫자가 작을수록 어렵습니다'), '도움 설명이 없습니다');
  check(Number(await page.locator('#stage-in-weight').inputValue()) === 25, '운동 화면의 도움이 25kg이 아닙니다');
  check(await page.locator('.set-strip .assist-word').count() > 0, '세트 줄에 "도움"이 없습니다');
  await shot('2-stage-390');
  await page.setViewportSize({ width: 360, height: 640 });
  await shot('2-stage-360');
  await page.setViewportSize({ width: 390, height: 844 });
}
