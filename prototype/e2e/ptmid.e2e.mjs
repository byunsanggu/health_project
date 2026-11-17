// 운동 중에 PT 켜기 — 혼자 하다가 ⋯의 "PT 코치 켜기"를 누르면 그 자리부터 오늘 남은 운동을 끝까지 이끈다.
//   세트마다 묻지 않고, 화면을 안 만져도 멈추지 않는다(예전에는 세 세트 안 만지면 멈춰서 세트마다 다시 켜는 꼴이었다).
//   "PT 끄기"로 언제든 혼자 모드로 돌아간다.
import { check, doneSet, focusPhase, onboard, restGuideOff, runUntil, skipRest, stageMenu, startWorkout } from './lib.mjs';

export default async function ({ page, url, shot }) {
  await page.clock.install({ time: new Date('2026-10-22T18:00:00+09:00') });
  await page.goto(url);
  await onboard(page);
  await restGuideOff(page);
  await startWorkout(page);
  check(await focusPhase(page) === null, '혼자 모드인데 PT 화면이 떴습니다');

  // 혼자 한 세트
  await doneSet(page);
  await skipRest(page);

  // 운동 중에 PT 켜기
  await stageMenu(page, 'PT 코치 켜기');
  if (await runUntil(page, ['warm', 'count', 'prep']) !== 'count') throw new Error('PT를 켰는데 세기가 아니라 ' + await focusPhase(page));
  check((await page.locator('#focus .focus-what').textContent()).startsWith('2세트'), '켠 자리(2세트)부터가 아닙니다');
  await shot('1-on');

  // 손 안 대고 세 세트 넘게 — 멈추지 않고 이어 간다
  let rests = 0;
  let last = null;
  for (let spent = 0; spent < 1500000 && rests < 4; spent += 2000) {
    const phase = await focusPhase(page);
    check(phase !== 'paused', '화면을 안 만졌더니 멈췄습니다');
    check(phase !== 'ask', '세트 끝에 묻습니다');
    if (phase === 'rest' && last !== 'rest') rests += 1;
    last = phase;
    await page.clock.runFor(2000);
  }
  check(rests >= 4, '세트가 이어지지 않습니다 (휴식 ' + rests + '번)');
  await shot('2-going');

  // PT 끄기 — 집중 화면이 닫히고 혼자 모드로
  await page.locator('#focus .pt-toggle').click();
  await page.clock.runFor(500);
  check(await focusPhase(page) === null, 'PT를 껐는데 집중 화면이 남았습니다');
  check(await page.locator('#solo-stage').count() === 1, '혼자 운동 화면으로 안 돌아왔습니다');
  await page.locator('#solo-stage .stage-more').click();
  check(await page.locator('dialog .menu-row', { hasText: 'PT 코치 켜기' }).count() === 1, '⋯에 PT 코치 켜기가 없습니다');
  await page.locator('dialog .modal-close').click();
}
