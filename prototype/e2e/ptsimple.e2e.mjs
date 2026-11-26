// PT 화면을 간단히 — 혼자 운동 화면처럼 그림 하나 · 이름과 한 줄 · 아래에 채운 버튼 하나(다음에 일어날 일) + 일시정지 Ⅱ.
//   단계마다 버튼 글자가 다음 일을 말한다: 지금 시작 / 다음 동작 · 바로 시작 · 워밍업 완료 · 다음 워밍업 · 세트 완료 ·
//   다음 세트 시작 · ▶ 계속(멈추면 Ⅱ는 없다). "세트 완료"는 센 개수까지 적고, "다음 세트 시작"은 휴식을 건너뛴다.
//   나머지(PT 끄기 · 빠르기 · 주머니 모드 · 세트 고치기 · 워밍업 빼기 · 건너뛰기 · 아픈 데 · 운동 끝내기)는 ⋯에, 운동한 시간은 ⋯ 창 제목 아래.
//   "자세히 보기"를 펼친 쪽은 다시 켜도 기억한다.
//   아래 줄은 [Ⅱ] [채운 버튼] [다음 ›] — 다음 ›의 둘째 줄이 어디로 가는지 말한다(첫 운동 · 워밍업 2 · 본 운동 · 2세트 · 다음 운동).
import { begin, check, choosePt, focusPhase, focusText, onboard, ptDetail, ptGo, ptMenu, ptPause, runUntil, skipPrep, skipWarm } from './lib.mjs';

const goText = (page) => focusText(page, '.focus-go');
const reps = async (page) => {
  const text = await page.locator('#focus-num').textContent().catch(() => '');
  return /^\d+$/.test(text) ? Number(text) : 0;
};
const skipSub = (page) => page.evaluate(() => {
  const node = document.querySelector('#focus .focus-skip');
  return node ? node.querySelector('.focus-skip-main').textContent + ' | ' + (node.querySelector('.focus-skip-sub')?.textContent || '') : '';
});
const saved = (page) => page.evaluate(() => (JSON.parse(localStorage.getItem('volume-coach.proto.state') || '{}').settings || {}));

export default async function ({ page, url, shot }) {
  await page.clock.install({ time: new Date('2026-10-22T18:00:00+09:00') });
  await page.goto(url);
  await onboard(page);
  await choosePt(page);
  await begin(page);
  await runUntil(page, 'prep');

  // 몸 풀기 — 지금 시작(곧 시작할 때) → 다음 동작. 옆에 일시정지 Ⅱ
  if (await goText(page) === '지금 시작') await ptGo(page, '지금 시작');
  await page.clock.runFor(500);
  check(await goText(page) === '다음 동작', '몸 풀기 버튼: ' + await goText(page));
  check(await page.locator('#focus .focus-pause[aria-label="일시정지"]').count() === 1, '일시정지 Ⅱ가 없습니다');
  check(await page.locator('#focus .focus-go').count() === 1, '아래 채운 버튼이 하나가 아닙니다');
  check(/^다음 › \| \S/.test(await skipSub(page)), '몸 풀기 다음 ›: ' + await skipSub(page));
  await skipPrep(page);

  // 워밍업 준비 — 바로 시작. ⋯에 옮겨 간 것이 다 있다, 창 제목 아래에 운동한 시간
  check(await runUntil(page, ['warm', 'count']) === 'warm', '첫 종목에 워밍업이 없습니다');
  check(await goText(page) === '바로 시작', '워밍업 준비 버튼: ' + await goText(page));
  check(await skipSub(page) === '다음 › | 워밍업 2', '워밍업 준비 다음 ›: ' + await skipSub(page));
  await page.locator('#focus .focus-menu').click();
  const rows = (await page.locator('dialog .menu-row .name').allTextContents()).map((text) => text.trim());
  for (const want of ['PT 끄기', '빠르기', '주머니 모드', '세트 고치기', '워밍업 빼기', '워밍업 건너뛰기', '아픈 데가 있어요', '운동 끝내기']) {
    check(rows.some((row) => row.startsWith(want)), `⋯에 "${want}"가 없습니다: ${rows.join(' / ')}`);
  }
  check(/운동한 시간 \d+:\d\d/.test(await page.locator('dialog .modal-head .pattern').textContent()), '⋯ 창에 운동한 시간이 없습니다');
  await shot('1-menu');
  await page.locator('dialog .modal-close').click();
  // PT 화면에는 예전 위 띠의 단추들이 없다
  check(await page.locator('#focus .pt-toggle, #focus .end-workout, #focus .pt-rate-chip, #focus .pocket-btn').count() === 0, 'PT 화면에 ⋯로 옮긴 단추가 남아 있습니다');

  // 바로 시작 → 세는 중에는 워밍업 완료 → 워밍업 사이에는 다음 워밍업
  await ptGo(page, '바로 시작');
  for (let i = 0; i < 60 && await reps(page) < 1; i += 1) await page.clock.runFor(500);
  check(await reps(page) >= 1, '바로 시작을 눌렀는데 워밍업을 세지 않습니다');
  check(await goText(page) === '워밍업 완료', '워밍업 세는 중 버튼: ' + await goText(page));
  await ptGo(page, '워밍업 완료');
  await page.clock.runFor(300);
  check(await focusText(page, '#focus-cap') === '휴식', '워밍업 완료 뒤 쉬지 않습니다: ' + await focusText(page, '#focus-cap'));
  check(await goText(page) === '다음 워밍업', '워밍업 사이 버튼: ' + await goText(page));
  check(await skipSub(page) === '다음 › | 본 운동', '워밍업 사이 다음 ›: ' + await skipSub(page));
  check(await page.locator('.warmup-set.done').count() === 1, '워밍업 완료가 목록에 ✓로 안 남았습니다');
  await ptGo(page, '다음 워밍업');
  await page.clock.runFor(300);
  check(/워밍업 2\//.test(await focusText(page, '.focus-what')), '다음 워밍업으로 안 넘어갔습니다: ' + await focusText(page, '.focus-what'));
  check(await goText(page) === '바로 시작', '다음 워밍업 준비 버튼: ' + await goText(page));
  await skipWarm(page);

  // 1세트 준비 — 바로 시작. 멈추면 버튼이 "▶ 계속"이고 Ⅱ는 없다
  await runUntil(page, 'count');
  check(await goText(page) === '바로 시작', '세트 준비 버튼: ' + await goText(page));
  check(await skipSub(page) === '다음 › | 2세트', '세트 준비 다음 ›: ' + await skipSub(page));
  await ptPause(page);
  check(await focusPhase(page) === 'paused', '멈추지 않았습니다');
  check(await goText(page) === '▶ 계속', '멈춘 화면 버튼: ' + await goText(page));
  check(await page.locator('#focus .focus-pause').count() === 0, '멈췄는데 Ⅱ가 남아 있습니다');
  check(await skipSub(page) === '다음 › | 2세트', '멈춘 화면 다음 ›: ' + await skipSub(page));
  await shot('2-paused');
  await page.locator('#focus .pt-resume').click();
  check(await focusPhase(page) === 'count', '계속 뒤에 세트 준비로 안 돌아갔습니다');

  // 세트 완료 — 센 개수까지 적는다
  await ptGo(page, '바로 시작');
  for (let i = 0; i < 120 && await reps(page) < 3; i += 1) await page.clock.runFor(500);
  const counted = await reps(page);
  check(counted >= 3, '세지 않습니다');
  check(await goText(page) === '세트 완료', '세는 중 버튼: ' + await goText(page));
  check(await skipSub(page) === '다음 › | 2세트', '세는 중 다음 ›: ' + await skipSub(page));
  await shot('3-counting');
  await ptGo(page, '세트 완료');
  await runUntil(page, 'rest', { maxMs: 5000, stepMs: 250 });
  const logged = (await saved(page)).todaySets || [];
  check(logged.length === 1 && logged[0].reps === counted, `센 ${counted}개가 아니라: ` + JSON.stringify(logged.map((set) => set.reps)));

  // 쉬는 화면 — 다음 세트 시작 · 휴식 숫자에 +30초 · 다음 운동 ›. 다음 세트 시작을 누르면 휴식을 건너뛰고 바로 2세트 준비
  check(await goText(page) === '다음 세트 시작', '쉬는 화면 버튼: ' + await goText(page));
  check(await page.locator('#focus .focus-badge .focus-chip[aria-label="30초 추가"]').count() === 1, '쉬는 화면 휴식 숫자에 +30초가 없습니다');
  check(/^다음 운동 › \| \S/.test(await skipSub(page)), '쉬는 화면 다음 ›: ' + await skipSub(page));
  check(await page.locator('#focus .focus-dock button').count() === 3, '쉬는 화면 아래 줄 버튼이 셋이 아닙니다');
  await ptDetail(page);
  check(await page.locator('#focus .focus-logged').count() === 1, '자세히에 방금 적은 세트가 없습니다');
  await shot('4-rest-detail');
  await ptGo(page, '다음 세트 시작');
  await page.clock.runFor(300);
  check(await focusPhase(page) === 'count', '다음 세트 시작 뒤에 ' + await focusPhase(page));
  check((await focusText(page, '.focus-what')).startsWith('2세트'), '2세트가 아닙니다: ' + await focusText(page, '.focus-what'));
  check(await page.locator('#focus-rest-time').count() === 0, '휴식이 남아 있습니다');

  // 자세히를 펼친 쪽은 다시 켜도 그대로
  await page.reload();
  await page.waitForTimeout(800);
  await page.clock.runFor(500);
  if (await focusPhase(page) === null && await page.locator('.start-cta').count()) await begin(page);
  await runUntil(page, ['count', 'rest', 'paused'], { maxMs: 20000 });
  check(await page.locator('#focus .focus-detail-toggle').getAttribute('aria-expanded') === 'true', '자세히를 펼쳐 둔 것을 잊었습니다');
  check(await page.locator('#focus .focus-detail').count() === 1, '자세히 칸이 없습니다');

  // PT 끄기(⋯) — 혼자 화면으로, 5초 안에 되돌리기
  await ptMenu(page, 'PT 끄기');
  await page.clock.runFor(300);
  check(await focusPhase(page) === null, 'PT를 껐는데 PT 화면이 남았습니다');
  await page.locator('#pt-toast .undo-btn', { hasText: '되돌리기' }).click();
  await page.clock.runFor(500);
  check(await focusPhase(page) !== null, '되돌리기로 PT가 돌아오지 않았습니다');
}
