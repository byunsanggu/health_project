// PT가 마무리 스트레칭까지 끝내면 운동도 닫힌다 — 오늘 요약이 뜨고, 시계가 멈춘다.
//   예전에는 "오늘 PT 끝입니다" 뒤에도 운동이 열려 있어 폰을 넣고 나가면 10분 뒤 5:01이 15:01이 됐다.
//   스트레칭 카드 밑에 마지막 세트 뒤 휴식 막대가 같이 뜨지 않고, 스트레칭 초는 말한 초를 넘지 않는다.
//   작별 인사(오늘 정리)는 스트레칭이 끝날 때 한 번만.
import { begin, check, choosePt, focusPhase, onboard, runUntil } from './lib.mjs';

export default async function ({ page, url, shot }) {
  await page.clock.install({ time: new Date('2026-10-22T18:00:00+09:00') });
  await page.goto(url);
  await onboard(page);
  // 오늘만 20분 — 종목이 적어 빨리 끝난다
  await page.locator('.start-cta').click();
  await page.locator('dialog .segmented button', { hasText: '20분' }).click();
  await page.locator('dialog .modal-close').click();
  await choosePt(page);
  await begin(page);
  for (let guard = 0; guard < 80; guard += 1) {
    const phase = await runUntil(page, ['prep', 'warm', 'count', 'rest', 'cool'], { maxMs: 400000 });
    if (phase === 'cool') break;
    if (phase === 'prep') await page.locator('#focus .focus-btn', { hasText: '몸 풀기 건너뛰기' }).click();
    else if (phase === 'warm') await page.locator('#focus .focus-btn', { hasText: '워밍업 건너뛰기' }).click();
    else if (phase === 'rest') await page.locator('#focus .focus-btn', { hasText: '바로 시작' }).click();
    else {
      for (let i = 0; i < 120 && !/^\d+$/.test(await page.locator('#focus-num').textContent().catch(() => '')); i += 1) await page.clock.runFor(500);
      await page.locator('#focus .focus-btn', { hasText: '여기까지' }).click();
    }
  }
  check(await focusPhase(page) === 'cool', '스트레칭까지 못 갔습니다');
  // 마지막 세트 뒤 휴식 막대는 스트레칭과 같이 뜨지 않는다
  await page.clock.runFor(500);
  check(!(await page.locator('#rest-host').isVisible().catch(() => false)), '스트레칭 화면에 휴식 막대가 남아 있습니다');
  const saidBefore = await page.evaluate(() => window.__said.join(' '));
  check(!/오늘 PT 끝/.test(saidBefore), '스트레칭 전에 끝인사를 했습니다');

  // 스트레칭 초는 말한 초("40초")를 넘지 않는다 — 말하는 동안은 그대로
  for (let i = 0; i < 40; i += 1) {
    const left = await page.locator('#pt-cool-left').textContent().catch(() => '');
    const name = await page.locator('.pt-cool-name').textContent().catch(() => '');
    if (left) check(Number(left.replace('초', '')) <= 40, `${name} 남은 초가 ${left}입니다`);
    await page.clock.runFor(500);
  }

  // 스트레칭이 저절로 끝나면 — 끝인사 한 번, 요약이 뜨고, 시계가 멈춘다
  for (let i = 0; i < 600 && await focusPhase(page) === 'cool'; i += 1) await page.clock.runFor(1000);
  await page.clock.runFor(1000);
  const said = await page.evaluate(() => window.__said.join(' '));
  check((said.match(/오늘 PT 끝/g) || []).length === 1, '끝인사가 한 번이 아닙니다');
  check(await page.locator('dialog[open]').count() === 1, '스트레칭이 끝났는데 요약이 안 뜹니다');
  await shot('1-summary');
  const elapsed = () => page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem('volume-coach.proto.state') || '{}').settings || {};
    return [state.sessionStartedAt, state.sessionEndedAt];
  });
  const [start, end] = await elapsed();
  check(start && end && end > start, '운동 끝 시각이 적히지 않았습니다');
  const clock = () => page.locator('#session-elapsed').textContent().catch(() => null);
  const shown = await clock();
  check(shown, '운동 시계가 안 보입니다');
  await page.clock.runFor(600000);
  const [, endLater] = await elapsed();
  check(endLater === end, '10분 뒤 운동 끝 시각이 바뀌었습니다');
  if (shown) check(await clock() === shown, `10분 뒤 운동 시계가 갑니다: ${shown} → ${await clock()}`);

  // 앱을 다시 열어도 멈춘 그대로 — 끝난 시각이 저장된다
  await page.reload();
  await page.clock.runFor(2000);
  const reopened = await clock();
  check(reopened, '다시 연 뒤 운동 시계가 안 보입니다');
  await page.clock.runFor(600000);
  if (reopened) check(await clock() === reopened, `다시 연 뒤 운동 시계가 갑니다: ${reopened} → ${await clock()}`);
  if (shown && reopened) check(reopened === shown, `다시 열었더니 시계가 달라졌습니다: ${shown} → ${reopened}`);

  // 몇 분 뒤에 "오늘 마치기"를 눌러도 끝 시각이 밀리지 않는다
  if (!(await page.locator('dialog[open]').count())) {
    await page.getByRole('button', { name: /요약 보기|운동 끝내기/ }).first().click();
  }
  await page.locator('dialog').getByRole('button', { name: '오늘 마치기' }).click();
  await page.clock.runFor(1000);
  const [, endClosed] = await elapsed();
  check(endClosed === end, `오늘 마치기를 누르니 끝 시각이 밀렸습니다: ${end} → ${endClosed}`);
}
