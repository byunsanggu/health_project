// 5분만 해도 됩니다 — 약속 시각이 지났는데 시작 전이면 시작 자리에 "5분만 하기"가 하나 더 뜬다(주 버튼은 그대로).
//   누르면 PT가 평소대로 시작하고, 움직인 지 5분이 지나면 다음 휴식에서 "5분 됐습니다. 계속할까요?"를 묻는다(세트 중에는 안 묻는다).
//   "여기서 끝내기"는 한 만큼 남기고 짧게 한 날로 센다(시즌 점수 절반). 끝낸 화면은 "실패"라고 하지 않고, 다음 도전 한 줄을 보여 준다.
import { check, choosePt, focusPhase, onboard, restGuideOff } from './lib.mjs';

const KEY = 'volume-coach.proto.state';

/**
 * 지난 월요일에 프로그램의 모든 종목을 가볍게(12회 · 여유 3) 한 기록과 약속(19:00)을 저장소에 넣는다 —
 * 오늘과 다음 처방이 실제로 오르게(다음 도전 한 줄이 뜨게).
 */
async function seed(page) {
  await page.evaluate((key) => {
    const saved = JSON.parse(localStorage.getItem(key));
    const E = window.FitEngine;
    const byId = new Map(E.EXERCISES.map((e) => [e.id, e]));
    const ids = new Set();
    saved.program.templates.forEach((t) => t.slots.forEach((slot) => ids.add(slot.exerciseId)));
    const sets = [];
    ids.forEach((id) => {
      const e = byId.get(id);
      if (!e || (E.isTimed && E.isTimed(e))) return;
      const kg = e.equipment === 'bodyweight' || e.equipment === 'band' ? 0 : e.equipment === 'barbell' ? 40 : 20;
      for (let i = 0; i < 3; i += 1) sets.push({ exerciseId: id, weightKg: kg, reps: 12, rir: 3 });
    });
    saved.sessions = (saved.sessions || []).concat([{ id: 'seed-2026-10-19', date: '2026-10-19', sets, updatedAt: '2026-10-19T20:00:00.000Z' }]);
    saved.settings.promise = [0, 1, 3, 4].map((weekday) => ({ weekday, minutes: 19 * 60 }));
    localStorage.setItem(key, JSON.stringify(saved));
  }, KEY);
}

async function both(page, shot, name) {
  await shot(name + '-390');
  await page.setViewportSize({ width: 360, height: 640 });
  await page.waitForTimeout(50);
  await shot(name + '-360');
  await page.setViewportSize({ width: 390, height: 844 });
}

export default async function ({ page, url, shot }) {
  // 목요일 저녁 7시 반 — 약속(19:00)이 30분 지났다
  await page.clock.install({ time: new Date('2026-10-22T19:30:00+09:00') });
  await page.goto(url);
  await onboard(page);
  // 오래 돌리는 PT — 동작 그림을 꺼 둔다(가짜 시계가 프레임마다 그리느라 느려진다)
  await restGuideOff(page);
  await choosePt(page);
  // 약속을 정하지 않은 사람에게는 안 뜬다
  check(await page.locator('.five-min').count() === 0, '약속이 없는데 5분만 하기가 떴습니다');
  await seed(page);
  await page.reload();
  await page.waitForSelector('.start-cta');
  const five = page.locator('.start-dock .five-min');
  check(await five.count() === 1, '약속 시각이 지났는데 5분만 하기가 없습니다');
  check((await page.locator('.start-cta').textContent()).trim() === '운동 시작', '주 버튼이 바뀌었습니다');
  // 다음 운동 날 오늘 화면 — 실제로 오르는 것이 있으면 한 줄
  const today = await page.locator('.today-challenge').textContent().catch(() => '');
  check(/^오늘 · .+(첫 도전|도전)$/.test(today), '오늘 도전 한 줄이 없습니다: ' + today);
  await both(page, shot, '1-offer');

  await five.click();
  check(await page.locator('#focus:not([hidden])').count() === 1, '5분만 하기를 눌렀는데 PT가 시작하지 않았습니다');

  // 5분이 지나고 다음 휴식에서 묻는다 — 세트 중에는 묻지 않는다
  let asked = false;
  for (let i = 0; i < 450 && !asked; i += 1) {
    if (await page.locator('dialog[open] .five-keep').count()) { asked = true; break; }
    const phase = await focusPhase(page);
    if (phase === 'ask') {
      const feel = page.locator('#focus .focus-feels button').first();
      if (await feel.count()) await feel.click();
    }
    await page.clock.runFor(2000);
  }
  check(asked, '5분이 지나도 계속할지 묻지 않습니다');
  check(['rest', 'paused'].includes(await focusPhase(page)), '쉬는 중이 아닐 때 물었습니다: ' + await focusPhase(page));
  check(await page.evaluate(() => document.getElementById('focus').dataset.paused) === '1', '묻는 동안 PT가 멈추지 않았습니다');
  const said = await page.evaluate(() => window.__said.slice());
  check(said.some((line) => line.includes('5분 됐습니다. 계속할까요?')), '코치가 묻지 않았습니다: ' + said.slice(-3).join(' / '));
  check((await page.locator('dialog .five-keep').textContent()).trim() === '계속하기', '계속하기가 없습니다');
  await both(page, shot, '2-ask');

  await page.locator('dialog .five-end').click();
  await page.waitForSelector('.done-card');
  const title = (await page.locator('.done-title').textContent()).trim();
  check(title === '오늘도 나왔습니다.', '끝낸 화면 제목: ' + title);
  const doneText = await page.locator('.done-card').textContent();
  check(!/실패/.test(doneText), '끝낸 화면에 "실패"가 있습니다');
  check(/짧게 한 날/.test(await page.locator('.done-five').textContent()), '짧게 한 날이라고 말하지 않습니다');
  const teaser = await page.locator('.done-challenge').textContent().catch(() => '');
  check(/^다음 (.요일|운동) · .+도전$/.test(teaser), '다음 도전 한 줄이 없습니다: ' + teaser);
  // 시즌 — 짧게 한 날로 적혔다(점수 절반)
  const short = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)).settings.season.shortDates, KEY);
  check(short.includes('2026-10-22'), '짧게 한 날로 적지 않았습니다: ' + JSON.stringify(short));
  await both(page, shot, '3-done');
}
