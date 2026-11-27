// 처음 온 초보의 길 — 처음 설정 순서(목표 → 경력 · 일수 · 성별 → 동의 → 체중 → 준비됐습니다),
//   오늘 화면(제목 한 줄 · 첫 운동 큰 카드 · 작은 그림 칸 · 운동 시작), 질문 하나짜리 시작 창("오늘 몸 어때요?"),
//   첫 운동 날 안내 셋(무게 숫자 · 세트 완료 · 쉬는 화면 — 한 번씩, 아무 곳이나 누르면 닫힘, 가리키는 것을 가리지 않음, 기기에 기억).
//   360×640 · 390×844 둘 다 가로로 밀리지 않는다. 혼자 · PT 둘 다.
import { begin, check, choosePt, focusPhase, ptGo, runUntil, skipPrep, skipWarm } from './lib.mjs';

const SMALL = { width: 360, height: 640 };
const BIG = { width: 390, height: 844 };

async function noSideScroll(page, label) {
  const wide = await page.evaluate(() => {
    const doc = document.documentElement;
    const screen = document.getElementById('screen');
    return { doc: doc.scrollWidth - doc.clientWidth, screen: screen ? screen.scrollWidth - screen.clientWidth : 0 };
  });
  check(wide.doc <= 1 && wide.screen <= 1, `${label}: 가로로 밀립니다 ` + JSON.stringify(wide));
}

const overlap = (a, b) => a && b && a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/** 안내 말풍선 — 떠 있으면 { hint, text, box }, 없으면 null */
async function tip(page) {
  const node = page.locator('#first-tip');
  if (!(await node.count())) return null;
  return {
    hint: await node.getAttribute('data-hint'),
    text: (await node.locator('.first-tip-text').textContent()).trim(),
    box: await node.boundingBox(),
    passThrough: await node.evaluate((el) => getComputedStyle(el).pointerEvents === 'none'),
  };
}

async function expectTip(page, hint, text, targetSelector) {
  await page.clock.runFor(400);
  const now = await tip(page);
  check(now && now.hint === hint, `"${text}" 안내가 없습니다: ` + JSON.stringify(now));
  check(now.text === text, '안내 글자: ' + now.text);
  check(now.passThrough, '안내가 누름을 가로챕니다');
  const target = await page.locator(targetSelector).first().boundingBox();
  check(!overlap(now.box, target), `"${text}" 안내가 가리키는 것을 가립니다: ` + JSON.stringify({ tip: now.box, target }));
  return now;
}

export default async function ({ page, url, shot }) {
  await page.clock.install({ time: new Date('2026-11-09T10:00:00+09:00') }); // 월요일 오전
  await page.setViewportSize(SMALL);
  await page.goto(url);

  // 1) 처음 설정 — 장 순서와 장마다 가로 밀림 없음
  const order = [];
  for (let guard = 0; guard < 8; guard += 1) {
    await page.waitForSelector('.onboarding-head, .tabbar [role="tab"]:visible');
    const step = await page.evaluate(() => document.querySelector('.onboarding-head')?.dataset.step || null);
    if (!step) break;
    order.push(step);
    await noSideScroll(page, '처음 설정 ' + step);
    await shot('1-' + order.length + '-' + step + '-360');
    if (step === 'goal') {
      check(await page.locator('#bw, .consent-line').count() === 0, '목표 장에서 체중 · 동의를 묻습니다');
      await page.locator('.wizard-nav .primary').click();
    } else if (step === 'me') {
      check(await page.locator('#bw').count() === 0, '동의 전에 체중을 묻습니다');
      await page.locator('.ob-level .segmented button', { hasText: '처음입니다' }).click();
      await page.locator('.segmented button', { hasText: '여성' }).click();
      await page.locator('.wizard-nav .primary').click();
    } else if (step === 'consent') {
      check((await page.locator('.consent-lead').textContent()).includes('체중 같은 건강 정보를 쓰려면 동의가 필요합니다'), '동의 장 첫 줄이 다릅니다');
      await page.locator('.wizard-nav .primary').click();
    } else if (step === 'weight') {
      await page.locator('.wizard-nav .primary').click();
    } else if (step === 'ready') {
      await page.locator('.ready-later').click();
    }
  }
  check(order.join(',') === 'goal,me,consent,weight,ready', '처음 설정 순서: ' + order.join(','));

  // 2) 오늘 — 위에서 아래로 하는 순서: 제목 한 줄 → 첫 운동 큰 카드 → 작은 그림 칸 → 운동 시작
  await page.waitForSelector('.start-cta');
  for (const size of [SMALL, BIG]) {
    await page.setViewportSize(size);
    await page.waitForTimeout(100);
    const title = (await page.locator('.today-title').textContent()).trim();
    check(/^오늘은 \S.* · \d+개 · 약 \d+분$/.test(title), '오늘 제목: ' + title);
    const lifts = Number(title.match(/ · (\d+)개/)[1]);
    const card = page.locator('.first-card');
    check(await card.count() === 1, '첫 운동 카드가 없습니다');
    check((await card.textContent()).includes('첫 운동'), '첫 운동 카드에 "첫 운동"이 없습니다');
    check(await card.locator('.lift-thumb').count() === 1 && (await card.locator('.name').textContent()).trim().length > 0, '첫 운동 카드에 그림 · 이름이 없습니다');
    check(await card.locator('.first-plan, .first-challenge').count() === 1, '첫 운동 카드에 아래 한 줄이 없습니다');
    check(await page.locator('.today-strip .strip-item').count() === lifts - 1, '작은 그림 칸 수가 맞지 않습니다');
    const head = await page.locator('.today-title').boundingBox();
    const cardBox = await card.boundingBox();
    const strip = await page.locator('.today-strip').boundingBox();
    const cta = await page.locator('.start-cta').boundingBox();
    check(head.y < cardBox.y && cardBox.y < strip.y && strip.y < cta.y, '오늘 화면 순서: ' + JSON.stringify({ head, cardBox, strip, cta }));
    check(cta.height >= 56 && cta.width >= size.width - 40 && cta.y + cta.height <= size.height, `운동 시작이 크고 보이지 않습니다(${size.width}): ` + JSON.stringify(cta));
    // 채운 버튼은 운동 시작 하나뿐
    check(await page.locator('#screen .finish:not(.quiet)').count() === 1, '오늘 화면에 채운 버튼이 여럿입니다');
    check(await page.locator('.season-card, .today-diff').count() === 0, '오늘 화면에 내 선수 카드 · "평소와 다릅니다"가 남아 있습니다');
    await noSideScroll(page, '오늘 ' + size.width);
    await shot('2-today-' + size.width);
  }
  // 작은 칸을 누르면 그 운동의 동작 보기
  await page.locator('.today-strip .strip-item').first().click();
  check(await page.locator('dialog[open]').count() === 1, '작은 그림 칸을 눌러도 동작 보기가 안 열립니다');
  await page.locator('dialog[open] .modal-close').click();
  await page.setViewportSize(SMALL);

  // 3) 시작 창 — 질문 하나, 큰 버튼 셋. 별로예요면 아픈 데를 이어서 묻는다
  await page.locator('.start-cta').click();
  check((await page.locator('dialog[open] .modal-head h3').textContent()).trim() === '오늘 몸 어때요?', '시작 창 제목');
  const faces = (await page.locator('dialog[open] .feel-pick b').allTextContents()).map((t) => t.trim());
  check(faces.join(',') === '좋아요,보통,별로예요', '시작 창 버튼: ' + faces.join(','));
  check((await page.locator('dialog[open] .start-more').textContent()).includes('시간 · 코치 바꾸기'), '시간 · 코치 바꾸기 링크가 없습니다');
  check(await page.locator('dialog[open] .segmented').count() === 0, '시작 창에 예전 질문 넷이 남아 있습니다');
  const pickBox = await page.locator('dialog[open] .feel-pick').first().boundingBox();
  check(pickBox.height >= 64, '시작 창 버튼이 작습니다: ' + JSON.stringify(pickBox));
  await noSideScroll(page, '시작 창');
  await shot('3-start-360');
  await page.locator('dialog[open] .feel-pick[data-feel="low"]').click();
  check((await page.locator('dialog[open] .modal-head h3').textContent()).trim() === '아픈 데가 있나요?', '별로예요 뒤에 아픈 데를 안 묻습니다');
  check(await page.locator('dialog[open] .pain-no').count() === 1 && await page.locator('dialog[open] .pain-yes').count() === 1, '없어요 · 있어요가 없습니다');
  await shot('3-start-low-360');
  // 닫으면 시작하지 않고, 고른 몸 상태는 오늘 줄에 남는다
  await page.locator('dialog[open] .modal-close').click();
  check(await page.locator('.warm-skip, #solo-stage').count() === 0, '창을 닫았는데 운동이 시작됐습니다');
  check((await page.locator('.today-adjust').textContent()).includes('별로예요'), '고른 몸 상태가 오늘 줄에 없습니다');
  // 다시 시작 — 지금 몸 상태(별로예요)가 눌려 있다 → 있어요 → 통증 동의 → 통증 창의 "이대로 시작"
  await page.locator('.start-cta').click();
  check(await page.locator('dialog[open] .feel-pick[aria-pressed="true"]').getAttribute('data-feel') === 'low', '지금 몸 상태가 눌려 있지 않습니다');
  await page.locator('dialog[open] .feel-pick[data-feel="low"]').click();
  await page.locator('dialog[open] .pain-yes').click();
  const agree = page.locator('dialog[open] .finish', { hasText: '통증 기록에 동의하기' });
  if (await agree.count()) await agree.click();
  check(await page.locator('dialog[open] .pain-start').count() === 1, '통증 창에 "이대로 시작"이 없습니다');
  await page.locator('dialog[open] .pain-start').click();
  check(await page.locator('dialog[open]').count() === 0, '이대로 시작 뒤에 창이 남았습니다');

  // 4) 첫 운동 — 안내 셋이 하나씩
  await page.locator('.warm-skip').click();
  await page.locator('#solo-stage .now-done').waitFor();
  const t1 = await expectTip(page, 'weight', '숫자를 누르면 바로 바꿀 수 있어요', '#solo-stage .stage-tile');
  check(t1.box.x >= 0 && t1.box.x + t1.box.width <= SMALL.width, '안내가 화면 밖으로 나갑니다: ' + JSON.stringify(t1.box));
  await noSideScroll(page, '운동 화면');
  await shot('4-tip-weight-360');
  // 아무 곳이나 누르면 닫히고, 다음 안내(세트 완료)
  await page.locator('#solo-stage .stage-name').click();
  check(await tip(page) === null || (await tip(page)).hint !== 'weight', '눌렀는데 무게 안내가 안 닫힙니다');
  await expectTip(page, 'done', '다 했으면 여기를 누르세요', '#solo-stage .now-done');
  await shot('4-tip-done-360');
  // 세트 완료를 누르면(안내는 누름을 막지 않는다) 기록되고 쉬는 화면 — 쉬는 안내
  await page.locator('#solo-stage .now-done').click();
  await page.locator('#solo-stage .stage-rest').waitFor();
  await expectTip(page, 'rest', '쉬는 동안 다음 동작을 보여 드려요', '#solo-stage .stage-rest');
  await shot('4-tip-rest-360');
  await page.setViewportSize(BIG);
  await page.clock.runFor(200);
  const bigTip = await tip(page);
  check(bigTip && !overlap(bigTip.box, await page.locator('#solo-stage .stage-rest').boundingBox()), '390에서 쉬는 안내가 시계를 가립니다');
  await shot('4-tip-rest-390');
  await page.locator('#solo-stage .rest-now').click();
  await page.clock.runFor(400);
  check(await tip(page) === null, '세 안내를 다 본 뒤에도 안내가 뜹니다: ' + JSON.stringify(await tip(page)));
  // 기기에 기억 — 다시 켜도 안 뜬다
  const seen = await page.evaluate(() => JSON.parse(localStorage.getItem('volume-coach.firstHints') || '{}'));
  check(seen.weight && seen.done && seen.rest, '본 안내가 기억되지 않았습니다: ' + JSON.stringify(seen));
  await page.reload();
  await page.waitForSelector('.tabbar [role="tab"]');
  if (await page.locator('.start-cta').count() && !(await page.locator('#solo-stage').count())) await begin(page);
  await page.clock.runFor(400);
  check(await tip(page) === null, '다시 켰더니 안내가 또 뜹니다');

  // 5) PT도 같은 안내 — 새 사람(저장소를 비우고)으로
  await page.setViewportSize(SMALL);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForSelector('.onboarding-head[data-step="goal"]');
  await page.locator('.wizard-nav .primary').click();
  await page.locator('.ob-level .segmented button', { hasText: '처음입니다' }).click();
  await page.locator('.segmented button', { hasText: '남성' }).click();
  await page.locator('.wizard-nav .primary').click();
  await page.locator('.wizard-nav .primary').click(); // 동의
  await page.locator('.wizard-nav .primary').click(); // 체중
  await page.locator('.ready-later').click();
  await choosePt(page);
  await begin(page);
  await runUntil(page, 'prep');
  await skipPrep(page);
  if (await runUntil(page, ['warm', 'count']) === 'warm') await skipWarm(page);
  await runUntil(page, 'count');
  await expectTip(page, 'weight', '숫자를 누르면 바로 바꿀 수 있어요', '#focus .pt-weight-input');
  await shot('5-pt-tip-weight-360');
  await ptGo(page, '바로 시작');
  for (let i = 0; i < 40 && !(await page.locator('#focus .focus-go.focus-done').count()); i += 1) await page.clock.runFor(500);
  await expectTip(page, 'done', '다 했으면 여기를 누르세요', '#focus .focus-go');
  await shot('5-pt-tip-done-360');
  await ptGo(page, '세트 완료');
  for (let i = 0; i < 20 && await focusPhase(page) !== 'rest'; i += 1) {
    // 세트 뒤에 "어땠어요?"를 물으면 하나 고른다
    if (await focusPhase(page) === 'ask') await page.locator('#focus .focus-feels button').first().click();
    else await page.clock.runFor(500);
  }
  await expectTip(page, 'rest', '쉬는 동안 다음 동작을 보여 드려요', '#focus #focus-rest-time');
  await shot('5-pt-tip-rest-360');
}
