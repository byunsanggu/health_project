// 몸 풀기 — 오늘 목록에는 운동만(몸 풀기 목록을 따로 또 두지 않는다). 운동 시작을 누르면 몸 풀기 카드가 먼저:
//   카드 한 장에 동작 하나(그림 · 남은 초, 초는 저절로 간다), 아래에 붙은 "다음 동작" 하나,
//   글자 링크 "몸 풀기 건너뛰기" · "전체 목록 보기". 마지막 동작에서는 "첫 운동 시작: …".
import { begin, check, onboard, todayDetail } from './lib.mjs';

const count = async (page) => (await page.locator('.warm-count').textContent()).trim();

export default async function ({ page, url, shot }) {
  await page.clock.install({ time: new Date('2026-10-22T18:00:00+09:00') });
  await page.goto(url);
  await onboard(page);

  // 오늘 간단히 — 운동 이름만, 몸 풀기 목록은 없다
  const names = (await page.locator('.plan-row .name > span:first-child').allTextContents()).map((t) => t.trim());
  check(names.length >= 2 && !names.some((name) => name.startsWith('몸 풀기')), '종목 목록이 이상합니다: ' + names.join(', '));
  check(await page.locator('.warm-sheet').count() === 0, '간단히 화면에 몸 풀기 목록이 또 있습니다');
  await shot('1-list');

  // 시작 — 몸 풀기 카드 한 장
  await begin(page);
  const moves = Number((await count(page)).match(/\/ (\d+)/)[1]);
  check((await count(page)) === '몸 풀기 1 / ' + moves, '몸 풀기 머리줄: ' + await count(page));
  check(await page.locator('.warm-card .live-motion').count() === 1, '몸 풀기 동작 그림이 없습니다');
  check((await page.locator('.start-dock .warm-next').textContent()).trim() === '다음 동작', '아래 버튼이 "다음 동작"이 아닙니다');
  check((await page.locator('.warm-skip').textContent()).trim() === '몸 풀기 건너뛰기', '건너뛰기 글자 링크가 없습니다');
  check((await page.locator('.warm-list-toggle').textContent()).trim() === '전체 목록 보기', '전체 목록 보기가 없습니다');
  check(await page.locator('.warm-step').count() === 0, '동작 목록이 처음부터 펼쳐져 있습니다');
  // 초는 저절로 간다 — 다 세면 다음 동작으로
  const secs = Number(((await page.locator('#stretch-left').textContent()).match(/(\d+)초/) || [])[1] || 120);
  await page.clock.runFor(2500);
  const ticking = Number(((await page.locator('#stretch-left').textContent()).match(/(\d+)초/) || [])[1] || 120);
  check(ticking < secs, `몸 풀기 초가 저절로 줄지 않습니다: ${secs} → ${ticking}`);
  await shot('2-card');
  await page.clock.runFor(secs * 1000 + 1000);
  check((await count(page)) === '몸 풀기 2 / ' + moves, '다 셌는데 다음 동작으로 안 넘어갑니다: ' + await count(page));
  await page.locator('.warm-next').click();
  check((await count(page)) === '몸 풀기 3 / ' + moves, '다음 동작을 눌러도 안 넘어갑니다: ' + await count(page));

  // 전체 목록 — 한 동작에 ✓, 누르면 그 동작으로
  await page.locator('.warm-list-toggle').click();
  check(await page.locator('.warm-list .warm-step').count() === moves, '전체 목록에 동작이 다 없습니다');
  check(await page.locator('.warm-step[aria-pressed="true"]').count() === 2, '한 동작 ✓가 맞지 않습니다');
  await page.locator('.warm-list-toggle').click();

  // 껐다 켜도 몸 풀기에서 잇는다
  await page.reload();
  await page.waitForSelector('.tabbar [role="tab"]');
  check((await count(page)) === '몸 풀기 3 / ' + moves, '다시 켜니 몸 풀기 자리가 사라졌습니다: ' + await page.locator('#screen').innerText());

  // 끝까지 — 마지막 동작에서는 "첫 운동 시작: 첫 종목"
  for (let i = 0; i < moves && await page.locator('.warm-next').count(); i += 1) await page.locator('.warm-next').click();
  const done = (await page.locator('.start-dock .warm-done').textContent()).trim();
  check(done === '첫 운동 시작: ' + names[0], '마지막 동작 버튼: ' + done);
  await page.locator('.warm-done').click();
  check(await page.locator('.warm-card').count() === 0, '몸 풀기 뒤에 운동 화면이 아닙니다');
  check((await page.locator('#screen').textContent()).includes(names[0]), '몸 풀기 뒤 첫 종목이 아닙니다');
  await shot('3-lift');

  // 목록으로 갔다 다시 시작해도 몸 풀기를 또 하지 않는다
  await page.goBack({ waitUntil: 'commit' }).catch(() => null);
  await page.waitForSelector('.start-cta');
  await todayDetail(page);
  check((await page.locator('.warm-sheet .meta').textContent()).includes('오늘 했음'), '몸 풀기 칸이 했음으로 안 바뀝니다');
  await begin(page);
  check(await page.locator('.warm-card').count() === 0, '몸 풀기를 또 합니다');
}
