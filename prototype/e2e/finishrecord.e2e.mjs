// 운동 끝 창 · 기록 탭 — 처음 온 사람이 한눈에.
//   끝 창: 맨 위 "오늘 운동 끝!"(세트 · 분) → "지난번보다" 한 줄 → 내 선수(포즈) · 오늘 오른 점수 → 다음 도전 → 채운 버튼 하나(오늘 마치기).
//   숫자 셋 · 쓴 부위 그림 · 지난번과 비교 표 · 다음 주 계획은 "자세히" 안에.
//   기록 탭: 이번 주 약속(● ○ · "4번 중 2번" · 요일 칸 한 줄) → 알림 카드 하나 → 내 선수 → 최근 운동 셋 → 늘어난 그래프 → 자세히.
//   알림 카드는 닫으면 다시 안 뜬다(다시 켜도). 화면 글에 해부학 말 · "상체 A" 같은 이름이 없다.
import { check, onboard, skipRest, stageMenu, startWorkout, tab } from './lib.mjs';

const KEY = 'volume-coach.proto.state';
const TECH = /삼각근|삼두|이두|대퇴사두|햄스트링|둔근|승모근|전완|광배|덜어내는 주|피킹|디로드|RIR|1RM|볼륨|세션/;
const DAY_AB = /(상체|하체|전신) [A-E]\b/;

/** 지난 세 번 — 프로그램의 모든 종목을 가볍게(8회 · 여유 4). 오늘 처방이 오르게(지난번보다 한 줄이 뜨게). */
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
      const kg = e.equipment === 'bodyweight' || e.equipment === 'band' ? 0 : e.equipment === 'barbell' ? 30 : 8;
      for (let i = 0; i < 3; i += 1) sets.push({ exerciseId: id, weightKg: kg, reps: 8, rir: 4 });
    });
    const days = ['2026-10-12', '2026-10-15', '2026-10-19'];
    saved.sessions = (saved.sessions || []).concat(days.map((date) => ({ id: 'seed-' + date, date, sets, updatedAt: date + 'T20:00:00.000Z' })));
    localStorage.setItem(key, JSON.stringify(saved));
  }, KEY);
}

async function both(page, shot, name) {
  await shot(name + '-390');
  await page.setViewportSize({ width: 360, height: 640 });
  await page.waitForTimeout(150);
  const wide = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  check(!wide, name + ': 360px에서 옆으로 스크롤됩니다');
  await shot(name + '-360');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(100);
}

/** 앞에 있는가 — a가 b보다 문서에서 먼저 */
function before(page, a, b) {
  return page.evaluate(([x, y]) => {
    const one = document.querySelector(x);
    const two = document.querySelector(y);
    return Boolean(one && two && (one.compareDocumentPosition(two) & Node.DOCUMENT_POSITION_FOLLOWING));
  }, [a, b]);
}

export default async function ({ page, url, shot }) {
  await page.clock.install({ time: new Date('2026-10-22T18:00:00+09:00') }); // 목
  await page.goto(url);
  await onboard(page);
  await seed(page);
  await page.reload();
  await page.waitForSelector('.tabbar [role="tab"]');

  // 오늘 할 세트를 다 한다
  await startWorkout(page);
  for (let i = 0; i < 150; i += 1) {
    if (await page.locator('dialog[open] .summary-hero').count()) break;
    const chip = page.locator('#solo-stage .now-done');
    if (await chip.count()) { await chip.first().click(); await skipRest(page); continue; }
    const next = page.locator('#solo-stage .now-next, #solo-stage .rest-now');
    if (await next.count()) { await next.first().click(); continue; }
    break;
  }
  if (!await page.locator('dialog[open] .summary-hero').count()) {
    if (await page.locator('#solo-stage .stage-more').count()) await stageMenu(page, '운동 끝내기');
    else await page.locator('.start-cta').click();
  }
  const dialog = page.locator('dialog[open]');
  await dialog.locator('.summary-hero').waitFor();

  // 1) 칭찬 먼저 — 큰 한 줄과 세트 수
  check((await dialog.locator('.summary-hero-title').textContent()).trim() === '오늘 운동 끝!', '끝 창 큰 줄: ' + await dialog.locator('.summary-hero-title').textContent());
  check(/^\d+세트/.test((await dialog.locator('.summary-hero-meta').textContent()).trim()), '세트 수가 없습니다');
  check(await dialog.locator('.summary-left').count() === 0, '다 했는데 "아직 남았어요"가 뜹니다');
  // 제목은 쉬운 날 이름
  const title = (await dialog.locator('.modal-head h3').textContent()).trim();
  check(!DAY_AB.test(title) && /\(.+\)/.test(title), '끝 창 제목: ' + title);
  // 지난번보다 한 줄 — 하나만
  check(await dialog.locator('.summary-better').count() === 1, '지난번보다 한 줄이 없습니다');
  const better = (await dialog.locator('.summary-better').textContent()).trim();
  check(/^지난번보다/.test(better) && /kg|회 더|늘었습니다/.test(better), '지난번보다: ' + better);
  // 내 선수 — 끝 창 안의 카드(누르지 않는다), 오늘 오른 점수 한 줄
  check(await dialog.locator('.season-card.is-finish').count() === 1, '끝 창에 내 선수가 없습니다');
  check(/^\+\d+점 · /.test((await dialog.locator('.season-card .season-feedback').textContent()).trim()), '오늘 오른 점수 한 줄이 없습니다');
  check(await dialog.locator('button.season-card').count() === 0, '끝 창의 내 선수를 누를 수 있습니다(요약 창이 덮입니다)');
  // 순서 — 큰 줄 → 지난번보다 → 내 선수 → 자세히
  check(await before(page, 'dialog[open] .summary-hero', 'dialog[open] .summary-better'), '큰 줄보다 지난번보다가 먼저입니다');
  check(await before(page, 'dialog[open] .summary-better', 'dialog[open] .season-card'), '지난번보다보다 내 선수가 먼저입니다');
  check(await before(page, 'dialog[open] .season-card', 'dialog[open] .summary-more'), '자세히가 내 선수보다 먼저입니다');
  // 숫자 셋 · 쓴 부위 그림 · 비교 표 · 다음 주는 자세히 안에(닫혀 있다)
  check(await dialog.locator('.summary-more[open]').count() === 0, '자세히가 펼쳐져 있습니다');
  for (const sel of ['.summary-stats', '.summary-body', '.compare-row']) {
    check(!await dialog.locator(sel).first().isVisible().catch(() => false), sel + '가 자세히 밖에 보입니다');
  }
  // 채운 버튼은 하나 — 오늘 마치기
  const filled = await dialog.locator('.summary-foot .finish:not(.quiet)').allTextContents();
  check(filled.length === 1 && filled[0].trim() === '오늘 마치기', '채운 버튼: ' + filled.join(', '));
  const text = (await dialog.innerText()).replace(/\s+/g, ' ');
  check(!TECH.test(text), '끝 창에 어려운 말: ' + (text.match(new RegExp('.{0,15}(' + TECH.source + ').{0,15}')) || [''])[0]);
  await page.waitForTimeout(300);
  await both(page, shot, '1-finish');
  // 360×640에서도 오늘 마치기가 화면 안
  await page.setViewportSize({ width: 360, height: 640 });
  const foot = await dialog.locator('.summary-foot .finish:not(.quiet)').boundingBox();
  check(foot && foot.y + foot.height <= 640, '360×640에서 오늘 마치기가 화면 밖입니다: ' + JSON.stringify(foot));
  await page.setViewportSize({ width: 390, height: 844 });

  // 자세히 — 숫자 셋 · 쓴 부위 · 지난번과 비교 · 다음 주
  await dialog.locator('.summary-more > summary').click();
  check(await dialog.locator('.summary-stats').isVisible(), '자세히 안에 숫자 셋이 없습니다');
  check(await dialog.locator('.compare-row').count() > 0, '자세히 안에 지난번과 비교가 없습니다');
  const more = (await dialog.innerText()).replace(/\s+/g, ' ');
  check(/다음 주:/.test(more), '자세히 안에 다음 주 한 줄이 없습니다');
  check(!TECH.test(more), '끝 창 자세히에 어려운 말: ' + (more.match(new RegExp('.{0,15}(' + TECH.source + ').{0,15}')) || [''])[0]);
  await dialog.locator('.summary-more > summary').scrollIntoViewIfNeeded();
  await shot('2-finish-more');
  await dialog.locator('.summary-foot .finish', { hasText: '오늘 마치기' }).click();
  for (let i = 0; i < 3 && await page.locator('dialog[open]').count(); i += 1) {
    await page.locator('dialog[open] .modal-close').first().click().catch(() => {});
  }

  // 2) 기록 탭 — 위에서부터 약속 → (알림 하나) → 내 선수 → 최근 운동 셋 → 그래프 → 자세히
  await tab(page, '기록');
  await page.locator('.streak-card .week-strip').waitFor();
  const count = (await page.locator('.streak-card .streak-count').textContent()).trim();
  check(/^\d번 중 \d번/.test(count), '약속 횟수: ' + count);
  check(await page.locator('.streak-card .streak-dots i').count() >= 1, '약속 점이 없습니다');
  check(await page.locator('.week-strip').count() === 1 && await page.locator('.week-strip .day').count() === 7, '요일 칸이 한 줄이 아닙니다');
  const names = (await page.locator('.week-strip .day-name').allTextContents()).join(' ');
  check(names.includes('✓') && !DAY_AB.test(names), '요일 칸: ' + names);
  check(await page.locator('.nudge-wrap').count() <= 1, '알림 카드가 둘 넘게 떴습니다');
  check(await before(page, '.streak-card', '.season-card'), '약속보다 내 선수가 먼저입니다');
  check(await before(page, '.season-card', '.history-list'), '내 선수보다 최근 운동이 먼저입니다');
  check(await page.locator('.history-row').count() === 3, '최근 운동이 셋이 아닙니다: ' + await page.locator('.history-row').count());
  check((await page.locator('.history-row').first().textContent()).includes('오늘'), '최근 운동 맨 위가 오늘이 아닙니다');
  check(await page.locator('.history-more').count() === 1, '더 보기가 없습니다');
  check(await page.locator('.progress-card').count() === 1, '두 번 한 종목인데 그래프가 없습니다');
  check(await before(page, '.history-list', '.progress-card'), '최근 운동보다 그래프가 먼저입니다');
  check(await before(page, '.progress-card', '.record-more'), '그래프보다 자세히가 먼저입니다');
  // 접힌 것 — 리포트 · 부위별 · 등급 · 일정은 위에 없다
  check(await page.locator('.report-cta, .growth-card, .tier-card').count() === 0, '자세히 밖에 리포트 · 부위별 · 등급이 있습니다');
  const week = (await page.locator('#screen').innerText()).replace(/\s+/g, ' ');
  check(!TECH.test(week), '기록 탭에 어려운 말: ' + (week.match(new RegExp('.{0,15}(' + TECH.source + ').{0,15}')) || [''])[0]);
  await both(page, shot, '3-record');

  // 알림 카드 — 닫으면 다시 안 뜬다(다시 켜도)
  const nudge = page.locator('.nudge-wrap');
  check(await nudge.count() === 1, '약속 시각을 안 정했는데 알림 카드가 없습니다');
  const kind = await nudge.getAttribute('data-nudge');
  await nudge.locator('.nudge-close').click();
  check(await page.locator(`.nudge-wrap[data-nudge="${kind}"]`).count() === 0, '닫았는데 알림 카드가 남았습니다');
  await page.reload();
  await page.waitForSelector('.tabbar [role="tab"]');
  await tab(page, '기록');
  await page.locator('.streak-card').waitFor();
  check(await page.locator(`.nudge-wrap[data-nudge="${kind}"]`).count() === 0, '다시 켜니 닫은 알림 카드가 돌아왔습니다');

  // 더 보기 — 지난 기록 전부
  await page.locator('.history-more').click();
  check(await page.locator('.history-row').count() === 4, '더 보기 뒤 기록이 다 안 보입니다');

  // 자세히 — 이번 주 계획 줄 · 리포트 · 부위별 · 등급 · 일정
  await page.locator('.record-more').click();
  check(await page.locator('.report-cta').count() === 1 && await page.locator('.growth-card').count() >= 1, '자세히 안에 리포트 · 부위별이 없습니다');
  check(await page.locator('.week-strip').count() === 1, '자세히를 펼치니 요일 칸이 두 줄입니다');
  await page.locator('.record-more').scrollIntoViewIfNeeded();
  await shot('4-record-more');
}
