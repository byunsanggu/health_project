// 처음 온 초보의 첫날(360×740 폰) — 맨 위 주차 칩 · "처음이세요?" · 헬스장 등록 안내 없이 첫 종목이 첫 화면에 보인다.
//   첫날만 시작 전 한 장(질문 넷), 그 뒤로는 운동 시작 한 번. 운동 화면은 지금 세트 줄이 가려지지 않고, 안내는 한 줄("6~10회 중 힘이 조금 남을 때"),
//   숫자 칸은 48px 이상, kg/lb는 ⋯ › 단위 바꾸기(알림 + 되돌리기).
//   기록이 없으면 횟수 칸은 범위 가운데로 채운다. 좁은 폰에서도 ✕가 "회"와 겹치지 않는다.
//   끝내기 창은 늘 왼쪽 "계속 운동" · 오른쪽 "오늘 마치기". 첫날 요약에는
//   PR · 1회 최대 · 부족이 없다. 혼자 한 날은 마무리 스트레칭을 고를 수 있고, 그림과 초를 센다.
//   기록 탭 첫 주는 큰 0 대신 "첫 주 진행 중", 근성장 막대는 "자세히" 안에.
import { check, onboard, startWorkout, tab, doneSet, openDetail, skipRest, stageMenu } from './lib.mjs';

export default async function ({ page, url, shot }) {
  await page.setViewportSize({ width: 360, height: 740 });
  await page.clock.install({ time: new Date('2026-10-19T18:00:00+09:00') }); // 월
  await page.goto(url);
  await onboard(page, { level: '초보', sex: '여성' });

  // 맨 위 상태 줄에는 주차 · 남길 개수 칩이 없다(설명은 기록 탭 · 운동 중 한 줄에서 연다)
  const status = (await page.locator('#status-meta').textContent()).trim();
  check(!/주차|남기고 멈춤/.test(status), '맨 위에 주차 칩이 남아 있습니다: ' + status);

  // 첫날 오늘 — "처음이세요?" 카드도, 헬스장 등록 안내도 위에 없고, 첫 종목이 첫 화면(360×740) 안에 보인다
  check(await page.locator('.first-tips').count() === 0, '"처음이세요?" 카드가 남아 있습니다');
  check(await page.locator('.gym-link-nudge').count() === 0, '첫날 오늘 화면 위에 헬스장 등록 안내가 있습니다');
  const firstRow = await page.locator('.plan-row').first().boundingBox();
  check(firstRow && firstRow.y + firstRow.height <= 740 - 64, '첫 종목이 첫 화면 밖에 있습니다: ' + JSON.stringify(firstRow));
  check(/이름을 누르면 동작을/.test(await page.locator('.first-hint').textContent()), '모르는 동작을 어디서 보는지 한 줄이 없습니다');
  await shot('1-today');

  // 맨 처음 운동 시작 한 번만 "오늘 운동 준비" — 질문 넷이 펼쳐져 있고, 다음부터는 묻지 않는다는 한 줄
  await page.locator('.start-cta').click();
  check((await page.locator('dialog .modal-head h3').textContent()).trim() === '오늘 운동 준비', '첫날 시작 한 장이 안 뜹니다');
  check(await page.locator('dialog .segmented').count() === 4, '첫날 한 장에 질문 넷이 없습니다');
  check(/다음부터는 묻지 않고/.test(await page.locator('dialog .start-first-note').textContent()), '다음부터 바로 시작한다는 말이 없습니다');
  await page.locator('dialog .start-go').click();
  if (await page.locator('.mobility-skip, .warm-skip').count()) await page.locator('.mobility-skip, .warm-skip').first().click();

  // 운동(간단히) — 360×740 한 화면에 스크롤 없이: 위 한 줄 · 이름 · 그림 · 세트 · 큰 숫자 · 안내 한 줄 · 채운 버튼 하나
  await page.locator('#solo-stage .now-done').waitFor();
  const fits = await page.evaluate(() => { const s = document.getElementById('screen'); return s.scrollHeight <= s.clientHeight + 1; });
  check(fits, '간단히 화면이 360×740에서 스크롤됩니다');
  // 안내는 한 줄 — 범위와 멈출 곳, 누르면 뜻
  const head = await page.locator('.effort-hint').textContent();
  check(/\d+~\d+회 중 힘이 조금 남을 때 멈추세요\./.test(head), '한 줄 안내: ' + head);
  check(await page.locator('.effort-hint').count() === 1, '안내 줄이 하나가 아닙니다');
  const screenText = await page.locator('#screen').innerText();
  check(!/숫자를 눌러 바꿀 수 있습니다|개쯤 남기고 멈춘 뒤|맞춰 짐작한 무게/.test(screenText), '겹치는 안내 줄이 남았습니다');
  await page.locator('.effort-hint').click();
  check(/번쯤 더 할 수 있겠다/.test(await page.locator('dialog').textContent()), '한 줄 안내를 눌러도 뜻이 안 나옵니다');
  await page.locator('dialog .modal-close').click();
  // 큰 숫자 칸은 높이 64px 이상, − / +는 48px 이상
  const tiles = await page.evaluate(() => [...document.querySelectorAll('.stage-tile')].map((n) => n.getBoundingClientRect().height));
  check(tiles.length === 2 && tiles.every((h) => h >= 64), '큰 숫자 칸이 작습니다: ' + JSON.stringify(tiles));
  const steps = await page.evaluate(() => [...document.querySelectorAll('.stage-tile .pt-num-step')].map((n) => Math.min(n.getBoundingClientRect().width, n.getBoundingClientRect().height)));
  check(steps.length === 4 && steps.every((s) => s >= 48), '− / +가 작습니다: ' + JSON.stringify(steps));
  // kg / lb는 ⋯ 메뉴에 — 바꾸면 알리고 되돌릴 수 있다
  await page.locator('.lift-more').click();
  check(await page.locator('dialog .menu-row', { hasText: '동작 보기' }).count() === 0, '운동 화면 ⋯에 동작 보기가 또 있습니다');
  await page.locator('dialog .menu-row', { hasText: '단위 바꾸기 (kg / lb)' }).click();
  check((await page.locator('#pt-toast').textContent()).includes('lb'), '단위를 바꿔도 알리지 않습니다');
  check((await page.locator('.stage-in-weight').getAttribute('aria-label')).includes('lb'), '단위가 lb로 안 바뀌었습니다');
  await page.locator('#pt-toast .undo-btn').click();
  check((await page.locator('.stage-in-weight').getAttribute('aria-label')).includes('kg'), '되돌리기 뒤에 kg이 아닙니다');
  const range = head.match(/(\d+)~(\d+)회/);
  if (range) {
    const mid = Math.round((Number(range[1]) + Number(range[2])) / 2);
    const reps = Number(await page.locator('.stage-in-reps').inputValue());
    check(reps === mid, `기록이 없는데 횟수가 범위 가운데(${mid})가 아닙니다: ${reps}`);
  }
  // 초보 첫 주에는 강도 기법 줄이 없다
  check(await page.locator('.tech-row').count() === 0, '초보 첫 주에 강도 기법이 보입니다');
  // 종목 이름은 잘리지 않는다(두 줄까지 감싼다)
  const name = await page.locator('.stage-name').evaluate((node) => node.scrollWidth <= node.clientWidth + 1);
  check(name, '지금 종목 이름이 잘립니다');
  // 동작 보기 — 그림을 누르면 열린다, 44px 이상
  const demo = page.locator('.lift-demo');
  check((await demo.textContent()).includes('동작 보기'), '운동 화면 그림: ' + await demo.textContent());
  check((await demo.boundingBox()).height >= 44, '동작 보기가 작습니다');
  await shot('2-set-360');

  // 자세히 — 세트 표. 360px에서 남은 세트의 ✕는 44px 이상이고 "회"와 겹치지 않는다. 숫자 칸은 48px 이상
  await openDetail(page);
  const boxes = await page.evaluate(() => [...document.querySelectorAll('.set-box.now .set-in')].map((n) => ({ c: n.className, w: n.getBoundingClientRect().width, h: n.getBoundingClientRect().height })));
  check(boxes.length > 0 && boxes.every((b) => b.h >= 48) && boxes.filter((b) => b.c.includes('weight')).every((b) => b.w >= 72), '숫자 칸이 작습니다: ' + JSON.stringify(boxes));
  check(await page.locator('.set-box .unit-pick').count() === 0, '세트 줄에 단위 버튼이 남아 있습니다');
  const fit = await page.evaluate(() => [...document.querySelectorAll('.set-box')].filter((box) => box.querySelector('.set-remove')).map((box) => {
    const units = [...box.querySelectorAll('.set-unit')];
    const unit = units[units.length - 1].getBoundingClientRect();
    const x = box.querySelector('.set-remove').getBoundingClientRect();
    return { gap: x.left - unit.right, w: x.width, h: x.height };
  }));
  check(fit.length > 0, '남은 세트 줄이 없습니다');
  check(fit.every((row) => row.gap >= 0), '✕가 "회"와 겹칩니다: ' + JSON.stringify(fit));
  check(fit.every((row) => row.w >= 44 && row.h >= 44), '✕가 44px보다 작습니다: ' + JSON.stringify(fit));
  await page.locator('#solo-stage .detail-toggle').click();

  // 한 세트 하고 끝내기(⋯ › 운동 끝내기) — 남은 것을 말하고, 왼쪽 "계속 운동"(권함) · 오른쪽 "오늘 마치기"
  await doneSet(page);
  await stageMenu(page, '운동 끝내기');
  const left = await page.locator('dialog .summary-left').textContent();
  check(/종목\(\d+세트\) 남았습니다/.test(left), '남은 것을 말하지 않습니다: ' + left);
  const foot = (await page.locator('dialog .summary-foot button').allTextContents()).map((t) => t.trim());
  check(foot[0] === '계속 운동' && foot[1] === '오늘 마치기', '아래 버튼: ' + foot.join(', '));
  check(!(await page.locator('dialog .summary-foot button').first().getAttribute('class')).includes('quiet'), '남았을 때 계속 운동이 채워진 버튼이 아닙니다');
  await page.locator('dialog .summary-foot button', { hasText: '계속 운동' }).click();
  check(await page.locator('dialog[open]').count() === 0 && await page.locator('#solo-stage').count() === 1, '계속 운동 뒤에 운동 화면이 아닙니다');

  // 이 종목을 마저 하고 끝낸다 — 첫날 요약에 현장 용어 · "부족"이 없다
  for (let i = 0; i < 10 && (await page.locator('.progress-count b').textContent()) === '1'; i += 1) await doneSet(page);
  await stageMenu(page, '운동 끝내기');
  await page.locator('dialog .summary-more > summary').click();
  const summary = (await page.locator('dialog').innerText()).replace(/\s+/g, ' ');
  check(!/\bPR\b|1회 최대|처방|유효 세트|부족/.test(summary), '첫날 요약에: ' + (summary.match(/.{0,20}(\bPR\b|1회 최대|처방|유효 세트|부족).{0,20}/) || [''])[0]);
  check(summary.includes('진행 중'), '주가 남았는데 "진행 중"이 없습니다');
  const values = await page.locator('dialog .wm-value').allTextContents();
  check(values.every((text) => /^\d+세트$|^보조로$/.test(text.trim())), '부위별 숫자가 정수 세트가 아닙니다: ' + values.join(', '));
  check(/다음 주:/.test(summary), '다음 주 한 줄이 없습니다');
  // 첫 운동 뒤 근육통 안내 — 뻐근한 것은 정상, 관절 통증은 적어 달라고
  const sore = await page.locator('dialog .first-soreness').textContent().catch(() => '');
  check(sore.includes('뻐근할 수 있습니다') && sore.includes('통증으로 적어 주세요'), '첫날 요약에 근육통 안내가 없습니다: ' + sore);
  await shot('3-summary');
  const foot2 = (await page.locator('dialog .summary-foot button').allTextContents()).map((t) => t.trim());
  check(foot2[0] === '계속 운동' && foot2[1] === '오늘 마치기', '다 한 날 아래 버튼 순서: ' + foot2.join(', '));
  await page.locator('dialog .summary-foot button', { hasText: '오늘 마치기' }).click();
  // 끝난 화면 — 카드 한 장: 다음 운동 한 줄, 요약 다시 보기 · 운동 더 하기 · 이어서 하기는 글자 링크
  check(await page.locator('.closed-link').count() === 3, '끝난 화면의 세 링크가 글자 링크가 아닙니다');
  check(/^다음 운동은 .요일 .+입니다\.$/.test((await page.locator('.done-next').textContent()).trim()), '다음 운동 한 줄: ' + await page.locator('.done-next').textContent());
  // 헬스장 주소 등록 안내는 끝난 카드에 섞지 않는다(오늘 › 자세히 안에)
  check(await page.locator('.gym-link-nudge').count() === 0, '끝난 화면에 헬스장 등록 안내가 섞였습니다');

  // 마무리 스트레칭(혼자) — 고르면 그림과 초, 다 세면 저절로 ✓
  await page.locator('.cool-offer').click();
  check((await page.locator('.session-head h2').textContent()).trim() === '마무리 스트레칭', '마무리 스트레칭 화면이 아닙니다');
  check(await page.locator('.stretch-now').count() === 1, '지금 할 동작 칸이 없습니다');
  const secs = Number(((await page.locator('#stretch-left').textContent()).match(/(\d+)초/) || [])[1] || 30);
  await page.locator('.stretch-go').click();
  await page.clock.runFor(2500);
  const ticking = Number(((await page.locator('#stretch-left').textContent()).match(/(\d+)초/) || [])[1]);
  check(ticking < secs, `초가 줄지 않습니다: ${secs} → ${ticking}`);
  await shot('4-cool');
  await page.clock.runFor(secs * 1000 + 1000);
  check(/^1 \//.test((await page.locator('.warm-stage .meta').textContent()).trim()), '다 셌는데 ✓가 안 됩니다');
  await page.locator('.cool-done').click();
  check(await page.locator('.cool-offer').count() === 0, '마친 뒤에도 마무리 스트레칭을 권합니다');

  // 기록 탭 — 큰 0 대신 "첫 주 진행 중", 근성장 막대 · 등급은 자세히 안에, 리포트는 지난 일처럼 말하지 않는다
  await tab(page, '기록');
  const streak = await page.locator('.streak-num').first().textContent();
  check(streak.includes('첫 주') && streak.includes('진행 중'), '연속 카드: ' + streak);
  check(await page.locator('.growth-card.folded').count() === 1 && await page.locator('.growth-list').count() === 0, '초보 첫 주인데 근성장 막대가 펼쳐져 있습니다');
  check(await page.locator('.tier-card').count() === 0, '초보 첫 주인데 등급 카드가 위에 있습니다');
  const report = await page.locator('.report-cta').textContent();
  check(!report.includes('계획은'), '주가 남았는데 리포트가 지난 일처럼 말합니다: ' + report);
  await page.locator('.record-more').click();
  check(await page.locator('.growth-list').count() === 1, '자세히 안에 근성장 막대가 없습니다');
  const growth = await page.locator('.growth-num').allTextContents();
  check(growth.every((text) => !/\d\.\d/.test(text)), '근성장 세트에 소수점: ' + growth.join(', '));
  await shot('5-record');
}
