// 서킷 운동 — 오늘 › "오늘은 서킷으로 하기"로 그날 운동을 서킷으로 바꾸고(되돌릴 수 있다), 시계 화면에서 돈다.
//   시간 안에 최대한: +1 바퀴 · 더 한 횟수 · 강도 한 번에 바꾸기 · 멈춰도 같은 화면 → 끝나면 결과가 저장되고
//   기록 탭 최근 운동에 "서킷"으로 뜨며 한 주 약속에 운동한 날로 센다.
//   1분마다: 분이 바뀌면 화면이 저절로 다음 동작으로 넘어가고 코치가 다음 동작을 말한다.
//   360×640 · 390×844에서 가로로 밀리지 않는다.
import { check, onboard, setVisible, tab } from './lib.mjs';

const DAY = 24 * 3600 * 1000;
const START = Date.parse('2026-11-24T18:00:00+09:00'); // 화요일

/** 가로로 밀리는 곳이 없는가 — 문서 전체와 서킷 화면 */
async function noSideScroll(page, label) {
  const over = await page.evaluate(() => {
    const doc = document.documentElement;
    const focus = document.getElementById('focus');
    const screen = document.getElementById('screen');
    const wide = [doc, focus, screen].filter(Boolean).filter((node) => !node.hidden && node.scrollWidth > node.clientWidth + 1);
    return wide.map((node) => (node.id || node.tagName) + ' ' + node.scrollWidth + '>' + node.clientWidth);
  });
  check(over.length === 0, label + ': 가로로 밀립니다 ' + over.join(', '));
}

/** 서킷 카드의 방식이 원하는 것이 될 때까지 "다른 방식으로 바꾸기" */
async function pickFormat(page, prefix) {
  for (let guard = 0; guard < 8; guard += 1) {
    const now = (await page.locator('.circuit-format').textContent()).trim();
    if (now.startsWith(prefix)) return now;
    await page.locator('.circuit-turn').click();
  }
  throw new Error(prefix + ' 방식이 나오지 않습니다');
}

/** 몸 풀기를 건너뛰고 본 운동 바로 시작까지 */
async function toMain(page) {
  await page.locator('.circuit-start').click();
  await page.waitForSelector('#focus:not([hidden])[data-phase="circuit-warm"]');
  await page.locator('.circuit-skip').click();
  await page.waitForSelector('#focus[data-phase="circuit-ready"]');
  await page.locator('.circuit-go-now').click();
  await page.waitForSelector('#focus[data-phase="circuit-main"]');
}

const phase = (page) => page.evaluate(() => document.getElementById('focus').dataset.phase);
const said = (page) => page.evaluate(() => window.__said.join(' | '));

export default async function ({ page, url, shot }) {
  await page.clock.install({ time: new Date(START) });
  await page.goto(url);
  await onboard(page, { days: 4 });

  // 1) 오늘 화면 — 시작 버튼 아래 조용한 링크
  const link = page.locator('.circuit-swap-link');
  await link.waitFor();
  check((await link.textContent()).includes('오늘은 서킷으로 하기'), '오늘 화면에 서킷 링크가 없습니다');
  const dayName = (await page.locator('.today-day').textContent()).trim();
  await page.evaluate(() => document.querySelector('.start-dock').scrollIntoView({ block: 'end' }));
  await shot('1-today-link');

  // 2) 바꾸면 서킷 한 장, 되돌리면 원래 운동
  await link.click();
  await page.locator('.circuit-card').waitFor();
  check((await page.locator('.today-day').textContent()).includes('서킷'), '제목이 서킷으로 바뀌지 않았습니다');
  check(await page.locator('.circuit-move').count() >= 3, '서킷 동작이 셋보다 적습니다');
  check((await page.locator('.circuit-undo').textContent()).includes('원래 운동으로 돌아가기'), '되돌리기 링크가 없습니다');
  await shot('2-circuit-card');
  await page.locator('.circuit-undo').click();
  await page.locator('.circuit-swap-link').waitFor();
  check(await page.locator('.circuit-card').count() === 0, '되돌렸는데 서킷 카드가 남았습니다');
  check((await page.locator('.today-day').textContent()).trim() === dayName, '되돌렸는데 원래 운동이 아닙니다');

  // 3) 시간 안에 최대한 — 시작 → 몸 풀기 건너뛰기 → 바로 시작
  await page.locator('.circuit-swap-link').click();
  await page.locator('.circuit-card').waitFor();
  const format = await pickFormat(page, '시간 안에 최대한');
  const minutes = Number(format.match(/(\d+)분/)[1]);
  await toMain(page);
  check(/^\d+:\d\d$/.test((await page.locator('#circuit-clock').textContent()).trim()), '큰 시계가 없습니다');
  check((await page.locator('.circuit-round').textContent()).includes('+1 바퀴'), '+1 바퀴 버튼이 없습니다');
  check((await page.locator('.focus-next').textContent()).startsWith('다음 · '), '다음 동작이 없습니다');
  check(/시작|출발/.test(await said(page)), '시작 말이 없습니다');
  await page.clock.runFor(3000);
  await shot('3-amrap');

  // +1 바퀴 두 번 → 바퀴 2. 못 채운 바퀴의 횟수 칸은 처음에는 없다(끝나기 2분 전부터 · 끝난 뒤)
  check(await page.locator('.circuit-reps').count() === 0, '처음부터 횟수 칸이 떠 있습니다');
  await page.locator('.circuit-round').click();
  await page.locator('.circuit-round').click();
  check((await page.locator('#circuit-badge-num').textContent()).trim() === '2', '바퀴 수가 2가 아닙니다');

  // 강도 — 한 번 누르면 바뀐다
  const before = (await page.locator('.circuit-amount-num').textContent()).trim() + (await page.locator('.focus-name-text').textContent());
  await page.locator('.circuit-scale-btn[data-scale="easy"]').click();
  check(await page.locator('.circuit-scale-btn[data-scale="easy"]').getAttribute('aria-pressed') === 'true', '쉽게가 눌리지 않았습니다');
  const after = (await page.locator('.circuit-amount-num').textContent()).trim() + (await page.locator('.focus-name-text').textContent());
  check(before !== after, '쉽게로 바꿨는데 동작 · 횟수가 그대로입니다: ' + before);
  // ⋯ › 강도 바꾸기 — 동작마다 한 줄
  await page.locator('.circuit-menu').click();
  await page.locator('dialog[open] .circuit-menu-scale').click();
  await page.locator('dialog[open] .circuit-scale-row').first().waitFor();
  check(await page.locator('dialog[open] .circuit-scale-row').count() >= 3, '강도 바꾸기에 동작이 모자랍니다');
  await shot('4-scale-picker');
  await page.locator('dialog[open] .modal-close').click();

  // 멈춤 — 같은 화면 그대로, 시계도 멈춘다
  await page.locator('.circuit-pause').click();
  check(await phase(page) === 'circuit-main', '멈췄는데 다른 화면이 됐습니다: ' + await phase(page));
  check(await page.evaluate(() => document.getElementById('focus').dataset.paused) === '1', '멈춤 표시가 없습니다');
  check(await page.locator('.circuit-round').count() === 0 && await page.locator('.circuit-resume').count() === 1, '멈춘 화면의 버튼이 계속이 아닙니다');
  const frozen = (await page.locator('#circuit-clock').textContent()).trim();
  await page.clock.runFor(5000);
  check((await page.locator('#circuit-clock').textContent()).trim() === frozen, '멈췄는데 시계가 흐릅니다');
  check((await page.locator('#circuit-badge-num').textContent()).trim() === '2', '멈췄더니 바퀴 수가 바뀌었습니다');
  await page.locator('.circuit-resume').click();
  check(await page.evaluate(() => document.getElementById('focus').dataset.paused) === '0', '계속을 눌렀는데 멈춰 있습니다');

  // 시간이 끝까지 — 저절로 끝나고 기록을 남긴다(시계를 건너뛴다 — 화면이 꺼졌다 켜진 것과 같다)
  await page.clock.fastForward(minutes * 60 * 1000);
  await page.clock.runFor(1000);
  check(/끝/.test(await said(page)), '끝났다는 말이 없습니다');
  check(await phase(page) === 'circuit-breath', '본 운동 뒤 숨 고르기로 넘어가지 않았습니다: ' + await phase(page));
  // 숨 고르며 마지막 바퀴에서 더 한 횟수를 적는다(남긴 기록도 같이 고쳐진다)
  await page.locator('.circuit-reps-more').click();
  await page.locator('.circuit-reps-more').click();
  check((await page.locator('.circuit-reps-num').textContent()).trim() === '2', '더 한 횟수가 2가 아닙니다');
  await shot('5a-breath');
  // 나머지는 건너뛰고 결과
  await page.locator('.circuit-skip').click();
  await page.waitForSelector('dialog[open] .circuit-result-score');
  const score = (await page.locator('dialog[open] .circuit-result-score').textContent()).trim();
  check(score === '2바퀴 + 2회', '결과가 맞지 않습니다: ' + score);
  check((await page.locator('dialog[open] .summary-hero-title').textContent()).includes('서킷'), '결과 화면 제목이 없습니다');
  await shot('5b-result');
  await page.locator('dialog[open] .circuit-result-close').click();
  check((await page.locator('.circuit-start').textContent()).includes('오늘 서킷 완료'), '오늘 화면이 완료로 바뀌지 않았습니다');

  // 저장됐는가 — 다시 열어도 남는다
  await page.reload();
  await page.locator('.circuit-start').waitFor();
  check((await page.locator('.circuit-start').textContent()).includes('오늘 서킷 완료'), '다시 열었더니 오늘 서킷이 사라졌습니다');
  const stored = await page.evaluate(() => {
    const saved = JSON.parse(localStorage.getItem('volume-coach.proto.state'));
    const today = saved.sessions.filter((item) => item.date === '2026-11-24')[0];
    return today && today.circuit ? today.circuit.length : 0;
  });
  check(stored === 1, '오늘 세션에 서킷 기록이 없습니다: ' + stored);

  // 기록 탭 — 최근 운동에 "서킷", 한 주 약속에 한 날
  await tab(page, '기록');
  await page.locator('.history-circuit').first().waitFor();
  check((await page.locator('.history-circuit .history-tag').first().textContent()).trim() === '서킷', '최근 운동에 서킷 딱지가 없습니다');
  check((await page.locator('.history-circuit .history-meta').first().textContent()).includes('2바퀴'), '최근 운동에 결과가 없습니다');
  const promise = (await page.locator('.streak-count').textContent()).trim();
  // 시작한 주(화요일)라 약속은 남은 날만큼 — 몇 번 중이든 서킷 한 날이 들어가야 한다
  check(/^\d번 중 1번/.test(promise), '한 주 약속에 서킷 날이 안 들어갔습니다: ' + promise);
  await page.evaluate(() => document.querySelector('.history-circuit').scrollIntoView({ block: 'center' }));
  await shot('6-record');
  await page.locator('.history-circuit').first().click();
  await page.locator('dialog[open] .circuit-history-score').waitFor();
  await page.locator('dialog[open] .modal-close').click();
  // 기록 › 자세히 — 서킷 기록 카드
  await page.locator('.record-more').click();
  await page.locator('.circuit-bench-card').waitFor();

  // 4) 다음 날 — 1분마다: 분이 바뀌면 저절로 다음 동작
  await page.clock.setSystemTime(new Date(START + DAY));
  await page.reload();
  await tab(page, '오늘');
  await page.locator('.circuit-swap-link').click();
  await page.locator('.circuit-card').waitFor();
  await pickFormat(page, '1분마다');
  await toMain(page);
  check((await page.locator('.focus-pos').textContent()).trim().startsWith('1 /'), '첫 1분이 첫 동작이 아닙니다');
  const first = (await page.locator('.focus-name-text').textContent()).trim();
  await page.clock.runFor(20000);
  check((await page.locator('#focus .focus-cap').textContent()).includes('이번 1분'), '1분마다 배지가 없습니다');
  await shot('7-emom');
  const mark = (await said(page)).length;
  await page.clock.runFor(42000);
  const second = (await page.locator('.focus-name-text').textContent()).trim();
  check((await page.locator('.focus-pos').textContent()).trim().startsWith('2 /'), '1분이 지났는데 다음 동작으로 안 넘어갔습니다');
  check(second !== first, '1분이 지났는데 같은 동작입니다: ' + second);
  check(/다음/.test((await said(page)).slice(mark)) && (await said(page)).slice(mark).includes(second), '다음 동작 말이 없습니다');
  check(Number(await page.evaluate(() => document.getElementById('focus').dataset.beeps)) >= 3, '바뀌기 전 삑 소리가 없습니다');

  // 화면이 꺼졌다 켜져도 시계는 이어 간다 — 멈추지 않고, 돌아오면 그 자리(3분째 · 셋째 동작)
  await setVisible(page, false);
  await page.clock.fastForward(60000);
  await setVisible(page, true);
  await page.clock.runFor(500);
  check(await phase(page) === 'circuit-main' && await page.evaluate(() => document.getElementById('focus').dataset.paused) === '0', '화면을 켰더니 멈춰 있습니다');
  check((await page.locator('.focus-pos').textContent()).trim().startsWith('3 /'), '화면이 꺼진 동안의 시간이 안 흘렀습니다: ' + await page.locator('.focus-pos').textContent());

  // 5) 가로로 밀리지 않는다 — 시계 화면 · 오늘 화면
  for (const size of [{ width: 360, height: 640 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(size);
    await noSideScroll(page, size.width + '×' + size.height + ' 서킷 화면');
    const dock = await page.evaluate(() => {
      const box = document.querySelector('.circuit-dock').getBoundingClientRect();
      return box.bottom <= window.innerHeight + 1 && box.top > 0;
    });
    check(dock, size.width + '×' + size.height + ': 아래 버튼이 화면 밖입니다');
    if (size.width === 360) await shot('8-emom-360');
  }
  // 그만하기 — 여기까지 기록
  await page.locator('.circuit-menu').click();
  await page.locator('dialog[open] .circuit-menu-stop').click();
  await page.locator('dialog[open] .circuit-stop').click();
  await page.waitForSelector('dialog[open] .circuit-result-score');
  check((await page.locator('dialog[open] .circuit-result-score').textContent()).includes('멈춤'), '그만둔 기록이 아닙니다');
  await page.locator('dialog[open] .circuit-result-close').click();
  for (const size of [{ width: 360, height: 640 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(size);
    await noSideScroll(page, size.width + '×' + size.height + ' 오늘 화면');
  }
}
