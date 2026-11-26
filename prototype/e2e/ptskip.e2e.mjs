// PT 화면의 "다음 ›" — 지금 것을 안 하고 넘어가는 길이 늘 아래 줄에 있다: [Ⅱ] [채운 버튼] [다음 ›(어디로 가는지 둘째 줄)].
//   · 워밍업 준비에서 다음 › → 다음 워밍업(✓는 안 남는다), 마지막 워밍업이면 "본 운동"
//   · 본세트 준비에서 다음 › → 적지 않고 다음 세트 준비("2세트"), 5초 안에 되돌리기 → 건너뛰기 전 그대로
//   · 쉬는 동안은 "다음 운동 ›" → 이 운동 남은 세트를 건너뛰고 다음 운동으로 가는 휴식(채운 버튼 "다음 운동 시작")
//   · 멈춘 채 다음 › → 멈춤이 풀리고 새 자리에서 잇는다
//   · 위 "1 / 7"을 누르면 오늘 운동 목록(완료 · 지금 · 남음) — 남은 운동을 누르면 그 운동으로
//   · 앞질러 가면(다음 세트 시작 · 다음 운동 시작) 하던 말과 예약된 말을 끊는다 — 지난 운동 이야기가 이어서 나오지 않는다
import { begin, check, choosePt, focusPhase, focusText, onboard, ptGo, ptPause, runUntil } from './lib.mjs';

const saved = (page) => page.evaluate(() => (JSON.parse(localStorage.getItem('volume-coach.proto.state') || '{}').settings || {}));
const reps = async (page) => {
  const text = await page.locator('#focus-num').textContent().catch(() => '');
  return /^\d+$/.test(text) ? Number(text) : 0;
};
const skipInfo = (page) => page.evaluate(() => {
  const node = document.querySelector('#focus .focus-skip');
  if (!node) return null;
  return {
    main: node.querySelector('.focus-skip-main')?.textContent || '',
    sub: node.querySelector('.focus-skip-sub')?.textContent || '',
    aria: node.getAttribute('aria-label') || '',
    height: node.getBoundingClientRect().height,
  };
});
const skip = (page) => page.locator('#focus .focus-skip').click();
const what = (page) => focusText(page, '.focus-what');
const name = (page) => focusText(page, '.focus-name-text');
const dockButtons = (page) => page.locator('#focus .focus-dock button').count();

/*
 * 코치 목소리의 예약 줄을 흉내 낸다 — speak는 줄 끝에 붙이고, cancel은 줄을 비운다(coachVoice.js가 그렇다:
 * 조각을 이어 붙여 예약하고, cancel이 모두 멈춘다). 앞질러 간 뒤에도 그 전에 넣은 말이 줄에 남아 있으면 그 말이 나온다.
 */
async function watchVoice(page) {
  await page.evaluate(() => {
    window.__queue = [];
    const voice = window.CoachVoice;
    const speak = voice.speak;
    const cancel = voice.cancel;
    voice.speak = function (text) { window.__queue.push({ text, at: Date.now() }); return speak.apply(this, arguments); };
    voice.cancel = function () { window.__queue.length = 0; return cancel.apply(this, arguments); };
  });
}

/** 쉬는 동안 하는 한마디들(네 코치 모두) — 앞질러 간 뒤에 이게 나오면 지난 휴식의 말이 남은 것이다. */
const restTalk = (page) => page.evaluate(() => {
  const E = window.FitEngine;
  const out = [];
  for (const style of ['energetic', 'gentle', 'tough', 'fun']) {
    for (let at = 0; at < 14; at += 1) {
      out.push(E.restBreathLine(style, at), E.restTipLine(style, at), E.readySoonLine(style, at));
      for (const kind of ['lastSet', 'half', 'general']) out.push(E.restCheerLine(style, kind, at));
    }
  }
  return out.map((text) => E.forSpeech(text));
});

/** 앞질러 간 그 순간 — 그 전에 예약된 말이 줄에 남았는지, 그 뒤 몇 초 동안 나온 말. */
async function jumpAndListen(page, press, seconds) {
  const before = await page.evaluate(() => ({ said: window.__said.length, queued: window.__queue.map((item) => item.text) }));
  const at = await page.evaluate(() => Date.now());
  await press();
  const left = await page.evaluate((t) => window.__queue.filter((item) => item.at < t).map((item) => item.text), at);
  await page.clock.runFor(seconds * 1000);
  const after = await page.evaluate((n) => window.__said.slice(n), before.said);
  return { queuedBefore: before.queued, left, after };
}

export default async function ({ page, url, shot }) {
  await page.clock.install({ time: new Date('2026-10-22T18:00:00+09:00') });
  await page.goto(url);
  await onboard(page);
  await choosePt(page);
  await begin(page);
  await runUntil(page, 'prep');
  await watchVoice(page);
  const talk = new Set(await restTalk(page));

  // 몸 풀기 — 다음 동작은 채운 버튼, 다음 ›는 남은 몸 풀기를 건너뛰고 첫 운동으로
  if (await page.locator('#focus .focus-go', { hasText: '지금 시작' }).count()) await ptGo(page, '지금 시작');
  await page.clock.runFor(500);
  const prepSkip = await skipInfo(page);
  check(prepSkip && prepSkip.main === '다음 ›' && /건너뛰고/.test(prepSkip.aria), '몸 풀기에 다음 ›가 없습니다: ' + JSON.stringify(prepSkip));

  // 위 "1 / 7"(몸 풀기 중에는 "운동 전") — 오늘 운동 목록에서 이름을 읽어 둔다
  await page.locator('#focus .focus-progress').click();
  const lifts = (await page.locator('dialog .focus-list-row .name').allTextContents()).map((text) => text.trim());
  check(lifts.length >= 4, '오늘 운동 목록이 짧습니다: ' + lifts.join(' / '));
  await page.locator('dialog .modal-close').click();
  check(prepSkip.sub === lifts[0], `몸 풀기 다음 › 둘째 줄이 첫 운동(${lifts[0]})이 아닙니다: ${prepSkip.sub}`);
  await skip(page);

  // 워밍업 준비 — 다음 ›(워밍업 2). 누르면 다음 워밍업, 건너뛴 워밍업은 ✓가 없다. 되돌리기는 없다
  check(await runUntil(page, ['warm', 'count'], { maxMs: 20000 }) === 'warm', '첫 운동에 워밍업이 없습니다');
  check(await dockButtons(page) === 3, '아래 줄 버튼이 셋이 아닙니다: ' + await dockButtons(page));
  const warmSkip = await skipInfo(page);
  check(warmSkip.sub === '워밍업 2' && warmSkip.aria === '이번 워밍업 건너뛰고 워밍업 2로', '워밍업 다음 ›: ' + JSON.stringify(warmSkip));
  check(warmSkip.height >= 56, '다음 ›가 56px보다 작습니다: ' + warmSkip.height);
  await skip(page);
  await page.clock.runFor(300);
  check(/워밍업 2\//.test(await what(page)), '다음 워밍업으로 안 넘어갔습니다: ' + await what(page));
  check(await page.locator('.warmup-set.done').count() === 0, '건너뛴 워밍업에 ✓가 남았습니다');
  check(await page.locator('#pt-toast .undo-btn').count() === 0, '워밍업을 건너뛰었는데 되돌리기가 뜹니다');
  // 마지막 워밍업 — 다음 ›는 "본 운동"
  const lastWarm = await skipInfo(page);
  check(lastWarm.sub === '본 운동', '마지막 워밍업 다음 ›: ' + JSON.stringify(lastWarm));
  await skip(page);
  await page.clock.runFor(300);

  // 1세트 준비 — 다음 ›(2세트). 누르면 적지 않고 2세트 준비, 되돌리기 → 1세트 준비 그대로
  check(await runUntil(page, 'count', { maxMs: 5000, stepMs: 250 }) === 'count', '워밍업을 건너뛰었는데 1세트가 아닙니다');
  const total = Number(((await what(page)).match(/\/ (\d+)세트/) || [])[1]);
  check(total >= 3, '첫 운동 세트가 셋보다 적습니다: ' + await what(page));
  const setSkip = await skipInfo(page);
  check(setSkip.sub === '2세트' && setSkip.aria === '이번 세트 건너뛰고 2세트로', '1세트 다음 ›: ' + JSON.stringify(setSkip));
  await shot('1-set-lead');
  await skip(page);
  await page.clock.runFor(300);
  check(await focusPhase(page) === 'count', '세트를 건너뛰었는데 ' + await focusPhase(page));
  check((await what(page)).startsWith(`2세트 / ${total}세트`), '2세트 준비가 아닙니다: ' + await what(page));
  check(((await saved(page)).todaySets || []).length === 0, '건너뛴 세트가 기록됐습니다');
  check((((await saved(page)).todayExtras || {}).sets || {})[Object.keys(((await saved(page)).todayExtras || {}).sets || {})[0]] === -1, '건너뛴 세트가 오늘 계획에서 안 빠졌습니다');
  check(/건너뛰었습니다/.test(await page.locator('#pt-toast').textContent()), '건너뛰었다는 알림이 없습니다');
  check(/이번 세트는/.test(await page.evaluate(() => window.__said.join(' '))), '건너뛰었다는 말을 하지 않았습니다');
  await shot('2-skipped-toast');
  await page.locator('#pt-toast .undo-btn', { hasText: '되돌리기' }).click();
  await page.clock.runFor(300);
  check((await what(page)).startsWith(`1세트 / ${total}세트`), '되돌리기 뒤에 1세트 준비가 아닙니다: ' + await what(page));
  const extras = (await saved(page)).todayExtras || {};
  check(Object.values(extras.sets || {}).every((n) => !n), '되돌렸는데 오늘 계획에서 빠진 세트가 남았습니다: ' + JSON.stringify(extras.sets));

  // 1세트를 하고 쉬는 화면 — 다음 운동 ›(둘째 줄 다음 운동 이름) · +30초는 휴식 숫자에 붙어 있다 · 버튼은 셋까지
  await ptGo(page, '바로 시작');
  for (let i = 0; i < 60 && await reps(page) < 2; i += 1) await page.clock.runFor(500);
  await ptGo(page, '세트 완료');
  await runUntil(page, 'rest', { maxMs: 5000, stepMs: 250 });
  const restSkip = await skipInfo(page);
  check(restSkip.main === '다음 운동 ›' && restSkip.sub === lifts[1], '쉬는 화면 다음 ›: ' + JSON.stringify(restSkip));
  check(await page.locator('#focus .focus-badge .focus-chip', { hasText: '+30초' }).count() === 1, '+30초가 휴식 숫자에 없습니다');
  check(await dockButtons(page) === 3, '쉬는 화면 아래 줄 버튼이 셋이 아닙니다');

  // 쉬다가 "다음 세트 시작" — 하던 말(방금 세트 이야기 · 쉬는 시간 안내)을 끊는다. 그 뒤로 쉬는 동안의 한마디가 나오지 않는다
  await page.clock.runFor(4000);
  const midRest = await jumpAndListen(page, () => ptGo(page, '다음 세트 시작'), 15);
  check(midRest.queuedBefore.length > 0, '쉬는 동안 한 말이 없습니다 — 시험이 아무것도 안 본 것입니다');
  check(midRest.left.length === 0, '다음 세트 시작 뒤에도 쉬는 동안의 말이 예약에 남았습니다: ' + midRest.left.join(' / '));
  const leaked = midRest.after.filter((text) => talk.has(text));
  check(leaked.length === 0, '다음 세트 시작 뒤에 쉬는 동안의 말이 나왔습니다: ' + leaked.join(' / '));
  check((await what(page)).startsWith('2세트'), '다음 세트 시작 뒤 2세트가 아닙니다: ' + await what(page));

  // 2세트 준비 중 멈춤 → 다음 › — 멈춤이 풀리고 3세트 준비에서 잇는다(2세트는 적지 않는다)
  await ptPause(page);
  check(await focusPhase(page) === 'paused', '멈추지 않았습니다');
  const pausedSkip = await skipInfo(page);
  check(pausedSkip && pausedSkip.sub === '3세트', '멈춘 화면에 다음 ›(3세트)가 없습니다: ' + JSON.stringify(pausedSkip));
  await shot('3-paused');
  await skip(page);
  await page.clock.runFor(300);
  check(await focusPhase(page) === 'count', '멈춘 채 다음 ›를 눌렀는데 ' + await focusPhase(page));
  check(await page.locator('#focus').getAttribute('data-paused') === '0', '멈춤이 안 풀렸습니다');
  check((await what(page)).startsWith('3세트'), '3세트 준비가 아닙니다: ' + await what(page));
  check(((await saved(page)).todaySets || []).length === 1, '건너뛴 2세트가 기록됐습니다');

  // 남은 세트를 하면 종목이 바뀌는 휴식 — 다음 ›는 없다(채운 버튼이 곧 다음 운동)
  for (let guard = 0; guard < 8; guard += 1) {
    const phase = await runUntil(page, ['count', 'rest'], { maxMs: 10000 });
    if (phase === 'rest' && (await focusText(page, '.focus-pos')).includes('다음 운동')) break;
    if (phase === 'rest') { await ptGo(page, '다음 세트 시작'); await page.clock.runFor(300); continue; }
    await ptGo(page, '바로 시작');
    for (let i = 0; i < 60 && await reps(page) < 1; i += 1) await page.clock.runFor(500);
    await ptGo(page, '세트 완료');
    await page.clock.runFor(300);
  }
  check((await focusText(page, '.focus-pos')).includes('다음 운동'), '종목이 바뀌는 휴식까지 못 갔습니다');
  check(await page.locator('#focus .focus-skip').count() === 0, '종목이 바뀌는 휴식에 다음 ›가 남아 있습니다');

  // 종목이 바뀌는 휴식에서 "다음 운동 시작" — 방금 끝낸 운동 이야기(세트 뒤 한마디 · 이동 안내)를 끊는다
  await page.clock.runFor(2000);
  const switchJump = await jumpAndListen(page, () => ptGo(page, '다음 운동 시작'), 20);
  check(switchJump.queuedBefore.length > 0, '종목이 바뀌는 휴식에 한 말이 없습니다');
  check(switchJump.left.length === 0, '다음 운동 시작 뒤에도 지난 운동 말이 예약에 남았습니다: ' + switchJump.left.join(' / '));
  const old = switchJump.after.filter((text) => text.includes(lifts[0]) || switchJump.queuedBefore.includes(text) || talk.has(text));
  check(old.length === 0, '다음 운동 시작 뒤에 지난 운동 이야기가 나왔습니다: ' + old.join(' / '));
  check(await name(page) === lifts[1], `다음 운동(${lifts[1]})이 아닙니다: ` + await name(page));

  // 둘째 운동 — 1세트를 하고 쉬는 동안 "다음 운동 ›" → 남은 세트를 건너뛰고 셋째 운동으로 가는 휴식
  for (let guard = 0; guard < 6 && await focusPhase(page) !== 'rest'; guard += 1) {
    const phase = await runUntil(page, ['warm', 'count', 'rest'], { maxMs: 10000 });
    if (phase === 'warm') { await skip(page); await page.clock.runFor(300); continue; }
    if (phase === 'count') {
      await ptGo(page, '바로 시작');
      for (let i = 0; i < 60 && await reps(page) < 1; i += 1) await page.clock.runFor(500);
      await ptGo(page, '세트 완료');
      await page.clock.runFor(300);
    }
  }
  check(await focusPhase(page) === 'rest', '둘째 운동 휴식이 아닙니다');
  const liftSkip = await skipInfo(page);
  check(liftSkip.main === '다음 운동 ›' && liftSkip.sub === lifts[2] && liftSkip.aria.startsWith('남은 세트 건너뛰고 ' + lifts[2]),
    '둘째 운동 쉬는 화면 다음 ›: ' + JSON.stringify(liftSkip));
  const loggedBefore = ((await saved(page)).todaySets || []).length;
  await skip(page);
  await page.clock.runFor(300);
  check(await focusPhase(page) === 'rest', '다음 운동 › 뒤에 쉬는 화면이 아닙니다: ' + await focusPhase(page));
  check((await focusText(page, '.focus-pos')).includes('다음 운동') && await name(page) === lifts[2], `${lifts[2]}로 가는 휴식이 아닙니다: ` + await name(page));
  check(await page.locator('#focus .focus-go').textContent() === '다음 운동 시작', '다음 운동 › 뒤 채운 버튼: ' + await page.locator('#focus .focus-go').textContent());
  check(((await saved(page)).todaySets || []).length === loggedBefore, '건너뛴 세트가 기록됐습니다');
  check(/남은 \d세트를 건너뛰었습니다/.test(await page.locator('#pt-toast').textContent()), '운동을 건너뛰었다는 알림이 없습니다');
  check(await page.locator('#pt-toast .undo-btn').count() === 1, '운동 건너뛰기에 되돌리기가 없습니다');
  check(/이 운동은/.test(await page.evaluate(() => window.__said.slice(-3).join(' '))), '운동을 건너뛰었다는 말이 없습니다');
  await shot('4-skip-lift');

  // 위 "3 / N"을 누르면 오늘 운동 목록 — 완료 · 지금 · 남음. 남은 다섯째 운동을 누르면 그 운동으로
  await page.locator('#focus .focus-progress').click();
  const states = (await page.locator('dialog .focus-list-state').allTextContents()).map((text) => text.trim());
  check(states[0] === '완료' && states[1] === '완료' && states[2] === '지금' && states[3] === '남음', '운동 목록 상태: ' + states.join(' / '));
  check(await page.locator('dialog .focus-list-row').nth(0).isDisabled(), '끝낸 운동을 누를 수 있습니다');
  await shot('5-list');
  await page.locator('dialog .focus-list-row').nth(4).click();
  await page.clock.runFor(500);
  check(await name(page) === lifts[4], `목록에서 고른 운동(${lifts[4]})으로 안 갔습니다: ` + await name(page));
  check((await focusText(page, '.progress-count')).replace(/\s/g, '') === `5/${lifts.length}`, '위 숫자가 5번째가 아닙니다: ' + await focusText(page, '.progress-count'));
  check(['warm', 'count'].includes(await focusPhase(page)), '고른 운동을 시작하지 않습니다: ' + await focusPhase(page));
}
