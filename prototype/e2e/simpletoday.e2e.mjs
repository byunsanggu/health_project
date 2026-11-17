// 오늘 간단히 — 제목 한 줄 · 첫 운동 · 이름만 적은 목록 · "자세히 보기 ›"(고른 쪽을 기억) · 아래에 붙은 "운동 시작".
//   맨 처음만 "오늘 운동 준비" 한 장, 그 뒤로는 운동 시작 → 몸 풀기 건너뛰기 → 1세트까지 두 번.
//   "오늘은 평소와 다릅니다 ›"(오늘 조정)에서 바꾼 것은 목록에 바로 반영된다. 지난번에 아프다고 했으면 오늘 화면에서 바로 묻는다.
//   끝난 날은 카드 한 장(다음 운동 · 마무리 스트레칭 · 글자 링크), 이번 주를 다 채운 날은 쉬는 날 글.
import { adjustToday, check, onboard, todayDetail } from './lib.mjs';

const DAY = 24 * 3600 * 1000;
const logSet = (page) => page.locator('.now-done').or(page.getByRole('button', { name: /^1세트 완료/ })).first();

async function closeDialogs(page) {
  for (let i = 0; i < 4 && await page.locator('dialog[open]').count(); i += 1) {
    await page.locator('dialog[open] .modal-close').first().click().catch(() => {});
    await page.waitForTimeout(150);
  }
}

/** 한 세트 하고 오늘을 닫는다 — 목록의 "운동 끝내기 · 1세트 요약" → 오늘 마치기 */
async function trainDay(page) {
  await page.locator('.start-cta').click();
  if (await page.locator('dialog[open] .start-go').count()) await page.locator('dialog[open] .start-go').click();
  if (await page.locator('.warm-skip').count()) await page.locator('.warm-skip').click();
  await logSet(page).click();
  await page.goBack({ waitUntil: 'commit' }).catch(() => null);
  await page.waitForSelector('.start-cta');
  await page.locator('#screen button', { hasText: /세트 요약$/ }).click();
  await page.locator('dialog[open] button', { hasText: '오늘 마치기' }).click();
  await closeDialogs(page);
}

async function nextDay(page, days = 1) {
  await page.clock.fastForward(days * DAY);
  await page.reload();
  await page.waitForSelector('.tabbar [role="tab"]');
}

export default async function ({ page, url, shot }) {
  await page.setViewportSize({ width: 360, height: 740 });
  await page.clock.install({ time: new Date('2026-11-09T09:00:00+09:00') }); // 월
  await page.goto(url);
  await onboard(page);

  // 1) 간단히 — 제목 · 한 줄 · 첫 운동 · 이름 목록. 줄마다 ⋯ · 세트 줄은 없다. 시작 버튼은 아래에 붙어 있다
  const title = (await page.locator('.today-title').textContent()).trim();
  check(/^오늘은 .+입니다$/.test(title), '오늘 제목: ' + title);
  check(/^운동 \d+개 · 약 \d+분$/.test((await page.locator('.today-sub').textContent()).trim()), '한 줄: ' + await page.locator('.today-sub').textContent());
  const names = (await page.locator('.simple-row .name').allTextContents()).map((t) => t.trim());
  check((await page.locator('.today-hero').textContent()).includes('첫 운동') && (await page.locator('.today-hero').textContent()).includes(names[0]), '첫 운동 카드가 없습니다');
  check(await page.locator('.simple-row .lift-thumb').count() === names.length, '줄마다 작은 그림이 없습니다');
  check(await page.locator('.row-menu, .plan-sets, .list-edit, .list-order').count() === 0, '간단히에 자세한 것이 섞였습니다');
  const cta = await page.locator('.start-cta').boundingBox();
  check(cta.height >= 56 && cta.y + cta.height <= 740, '운동 시작이 아래에 붙은 56px 버튼이 아닙니다: ' + JSON.stringify(cta));
  check((await page.locator('.start-dock .today-diff').textContent()).includes('오늘은 평소와 다릅니다'), '"오늘은 평소와 다릅니다" 줄이 없습니다');
  await page.locator('.simple-row').nth(1).click();
  check(await page.locator('dialog[open]').count() === 1, '이름을 눌러도 동작 보기가 안 열립니다');
  await closeDialogs(page);
  await shot('1-simple');

  // 2) 자세히 보기 — 세트 · ⋯ · 순서 바꾸기 · 편집 · 유산소 · 다른 날로 바꾸기. 고른 쪽을 기억한다
  await todayDetail(page);
  check(await page.locator('.plan-row .row-menu').count() === names.length, '자세히에 줄마다 ⋯이 없습니다');
  check(await page.locator('.plan-row .plan-sets').count() === names.length, '자세히에 세트 · 무게 줄이 없습니다');
  for (const sel of ['.list-order', '.list-edit', '.extras-toggle', '.day-switch']) check(await page.locator(sel).count() === 1, '자세히에 없습니다: ' + sel);
  await shot('2-detail');
  await page.reload();
  await page.waitForSelector('.today-more');
  check(await page.locator('.today-more').getAttribute('aria-expanded') === 'true', '다시 켜니 자세히가 접혔습니다');
  await page.locator('.today-more').click();
  check(await page.locator('.row-menu').count() === 0, '간단히로 안 돌아갑니다');

  // 3) 맨 처음 운동 시작 — "오늘 운동 준비" 한 장. 보통 · 어깨 4를 골라 둔다(고른 몸 상태는 다음 날의 기본)
  await page.locator('.start-cta').click();
  check((await page.locator('dialog .modal-head h3').textContent()).trim() === '오늘 운동 준비', '첫날 한 장이 안 뜹니다');
  await page.locator('dialog .segmented button', { hasText: '보통' }).click();
  await page.locator('dialog .segmented button', { hasText: '있어요' }).click();
  // 통증 기록은 따로 동의한다(민감정보)
  const agree = page.locator('dialog[open] .finish', { hasText: '통증 기록에 동의하기' });
  if (await agree.count()) await agree.click();
  await page.locator('#pain-shoulder').fill('4');
  await page.locator('#pain-shoulder').press('Tab');
  await closeDialogs(page);
  check((await page.locator('.today-adjust').textContent()).includes('어깨 4'), '고른 통증이 오늘 줄에 없습니다');
  await trainDay(page);

  // 4) 끝난 날 — 카드 한 장
  check((await page.locator('.done-card .done-title').textContent()).trim() === '오늘 운동을 마쳤습니다.', '끝난 카드 제목이 없습니다');
  check(/^다음 운동은 .요일 .+입니다\.$/.test((await page.locator('.done-next').textContent()).trim()), '다음 운동 한 줄: ' + await page.locator('.done-next').textContent());
  check(/^마무리 스트레칭 \d+분$/.test((await page.locator('.done-card .cool-offer').textContent()).trim()), '마무리 스트레칭 버튼이 없습니다');
  const links = (await page.locator('.done-card .closed-link').allTextContents()).map((t) => t.trim());
  check(links.join('|') === '요약 다시 보기|운동 더 하기|아직 안 끝났습니다 — 이어서 하기', '끝난 카드 링크: ' + links.join('|'));
  check(await page.locator('.streak-card, .preview-card').count() === 0, '끝난 화면에 카드가 여럿입니다');
  await shot('3-done');

  // 5) 다음 날 — 지난번 통증을 오늘 화면에서 바로 묻는다. 몸 상태는 지난번(보통) 그대로
  await nextDay(page);
  check((await page.locator('.pain-ask').textContent()).includes('어깨'), '지난번 통증을 묻지 않습니다');
  check((await page.locator('.today-adjust').textContent()).includes('몸 보통'), '지난번 몸 상태(보통)가 기본이 아닙니다');
  await shot('4-pain-ask');
  await page.locator('.pain-ask-hurt').click();
  check(await page.locator('dialog[open] #pain-shoulder').inputValue() === '4', '지난번 점수가 채워져 있지 않습니다');
  await closeDialogs(page);
  check(await page.locator('.pain-ask').count() === 0, '답했는데 또 묻습니다');
  check((await page.locator('.today-adjust').textContent()).includes('어깨 4'), '아직 아프다고 했는데 오늘 줄에 없습니다');

  // 6) 오늘 조정 — 30분을 고르면 목록이 바로 줄고, 오늘 줄에 남는다
  const before = Number((await page.locator('.today-sub').textContent()).match(/약 (\d+)분/)[1]);
  await adjustToday(page);
  check((await page.locator('dialog .modal-head h3').textContent()).trim() === '오늘 조정', '창 이름이 "오늘 조정"이 아닙니다');
  await page.locator('dialog .segmented button', { hasText: /^30분$/ }).click();
  await closeDialogs(page);
  const after = Number((await page.locator('.today-sub').textContent()).match(/약 (\d+)분/)[1]);
  check(after < before && (await page.locator('.today-adjust').textContent()).includes('30분'), `30분을 골랐는데 그대로입니다: ${before} → ${after}`);

  // 7) 돌아온 날 — 운동 시작 → 몸 풀기 건너뛰기 → 1세트, 두 번
  await page.locator('.start-cta').click();
  check(await page.locator('dialog[open]').count() === 0, '돌아온 날에도 시작 창이 뜹니다');
  await page.locator('.warm-skip').click();
  check(await logSet(page).isVisible(), '두 번 눌렀는데 1세트 버튼이 안 보입니다');
  await shot('5-set1');
  await page.goBack({ waitUntil: 'commit' }).catch(() => null);
  await page.waitForSelector('.start-cta');

  // 8) 이번 주를 다 채우면 쉬는 날 — 하루씩 한 세트 하고 닫는다
  for (let i = 0; i < 6 && !(await page.locator('.today-title').textContent().catch(() => '')).includes('쉬는 날'); i += 1) {
    if (await page.locator('.start-cta').count()) await trainDay(page);
    await nextDay(page);
  }
  check((await page.locator('.today-title').textContent()).trim() === '오늘은 쉬는 날입니다', '이번 주를 다 했는데 쉬는 날이 아닙니다');
  check((await page.locator('.rest-day-text').first().textContent()).length > 10, '쉬는 날 글이 없습니다');
  await shot('6-rest');
}
