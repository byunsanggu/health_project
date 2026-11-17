// PT가 이끄는 날의 마무리 운동 — 코치가 말없이 서 있지 않는다.
//   화면이 뜨면 무엇을 몇 분 하는지 소개하고, 시계를 누르면 시작 · 절반 · 1분 전 · 10초 전 · 끝을 말한다.
import { adjustToday, agreeConsent, begin, check, choosePt, focusPhase, pickMe } from './lib.mjs';

export default async function ({ page, url, shot }) {
  await page.clock.install({ time: new Date('2026-10-22T18:00:00+09:00') });
  await page.goto(url);
  // 체력 기르기 — 근력 운동 뒤에 마무리 운동이 붙는다
  await agreeConsent(page);
  await pickMe(page, { days: 4 });
  await page.locator('.goal-persona[data-persona="crossfit"]').click();
  await page.locator('.wizard-nav .primary').click();
  await page.locator('.ready-later').click();
  await page.waitForSelector('.tabbar [role="tab"]');
  await adjustToday(page);
  await page.locator('dialog .segmented button', { hasText: '20분' }).click();
  await page.locator('dialog .modal-close').click();
  await choosePt(page);
  await begin(page);

  const onFinisher = () => page.evaluate(() => document.querySelector('.session-head h2')?.textContent === '마무리 운동');
  for (let guard = 0; guard < 400 && !(await onFinisher()); guard += 1) {
    const phase = await focusPhase(page);
    if (phase === 'prep') await page.locator('#focus .focus-btn', { hasText: '몸 풀기 건너뛰기' }).click();
    else if (phase === 'warm') await page.locator('#focus .focus-btn', { hasText: '워밍업 건너뛰기' }).click();
    else if (phase === 'rest') await page.locator('#focus .focus-btn', { hasText: '바로 시작' }).click();
    else if (phase === 'count' && /^\d+$/.test(await page.locator('#focus-num').textContent().catch(() => ''))) {
      await page.locator('#focus .focus-btn', { hasText: '여기까지' }).click();
    } else await page.clock.runFor(1000);
  }
  check(await onFinisher(), 'PT가 마무리 운동 화면까지 못 갔습니다');
  check(await focusPhase(page) !== 'cool', '마무리 운동을 건너뛰고 스트레칭으로 갔습니다');

  // 소개 — 마지막 세트 뒤 한마디가 끝난 뒤에 무엇을 몇 분 하는지
  const said = () => page.evaluate(() => window.__said.join(' | '));
  const before = (await said()).length;
  await page.clock.runFor(15000);
  const intro = (await said()).slice(before);
  check(/(마무리|보너스|유산소).*\d+분.*시계 시작을 눌러/.test(intro), '마무리 운동 소개가 없습니다: ' + intro.slice(-200));
  check((await page.locator('#coach-say').textContent()).includes('분'), '화면 말풍선에 소개가 없습니다');
  const minutes = Number((await page.locator('.finisher-card .meta').textContent()).match(/(\d+)분/)[1]);
  const cardio = /유산소/.test(intro);
  await shot('1-intro');

  // 시계 시작 → 시작 한마디
  let mark = (await said()).length;
  await page.locator('.finisher-start').click();
  check(/시작|출발/.test((await said()).slice(mark)), '시계를 눌렀는데 시작 말이 없습니다');
  if (cardio) {
    mark = (await said()).length;
    await page.clock.runFor(21000);
    check(/정도로|편하게|세게/.test((await said()).slice(mark)), '유산소인데 세기 한마디가 없습니다');
  }
  // 절반
  mark = (await said()).length;
  await page.clock.runFor(minutes * 30000 - (cardio ? 21000 : 0) + 1000);
  check(/절반|반 왔/.test((await said()).slice(mark)), '절반 말이 없습니다');
  // 1분 전 (3분 넘을 때)
  if (minutes >= 3) {
    mark = (await said()).length;
    await page.clock.runFor(minutes * 30000 - 60000);
    check(/1분 남았/.test((await said()).slice(mark)), '1분 남았다는 말이 없습니다');
  }
  // 10초 전 · 끝
  mark = (await said()).length;
  await page.clock.runFor(51000);
  check(/10초/.test((await said()).slice(mark)), '10초 전 말이 없습니다');
  mark = (await said()).length;
  await page.clock.runFor(11000);
  check(/끝/.test((await said()).slice(mark)) && /기록/.test((await said()).slice(mark)), '끝났다는 말이 없습니다');
  await shot('2-done');
}
