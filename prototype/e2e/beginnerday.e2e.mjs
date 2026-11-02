// 처음 온 초보의 첫날(360px 폰) — 위 상태 줄은 할 일("4개 남기고 멈춤")로 쓰고 누르면 뜻을 풀어 준다.
//   "처음이세요?" 카드는 닫으면 다시 안 뜬다. 세트 칸은 하는 동안 "숫자를 눌러 바꿀 수 있습니다"를 말하고,
//   기록이 없으면 횟수 칸은 범위 가운데로 채운다. 좁은 폰에서도 ✕가 "회"와 겹치지 않는다.
//   세트가 남았는데 끝내기를 누르면 무엇이 남았는지 말하고 "계속하기"가 앞이다. 첫날 요약에는
//   PR · 1회 최대 · 부족이 없다. 혼자 한 날은 마무리 스트레칭을 고를 수 있고, 그림과 초를 센다.
//   기록 탭 첫 주는 큰 0 대신 "첫 주 진행 중", 근성장 막대는 "자세히" 안에.
import { check, onboard, startWorkout, tab } from './lib.mjs';

export default async function ({ page, url, shot }) {
  await page.setViewportSize({ width: 360, height: 740 });
  await page.clock.install({ time: new Date('2026-10-19T18:00:00+09:00') }); // 월
  await page.goto(url);
  await onboard(page, { level: '초보', sex: '여성' });

  // 위 상태 줄 — "여유 4개"가 아니라 하라는 말, 누르면 뜻
  const status = (await page.locator('#status-meta').textContent()).trim();
  check(/개 남기고 멈춤|끝까지 하기/.test(status) && !/여유/.test(status), '상태 줄: ' + status);
  await page.locator('#status-meta .status-help').click();
  check(/번쯤 더 할 수 있겠다/.test(await page.locator('dialog').textContent()), '상태 줄을 눌러도 뜻이 안 나옵니다');
  await page.locator('dialog .modal-close').click();

  // 처음이세요? — 닫으면 다시 안 뜬다
  const tips = page.locator('.first-tips');
  check(await tips.count() === 1, '"처음이세요?" 카드가 없습니다');
  check(/이름이나 그림을 누르면/.test(await tips.textContent()), '모르는 동작을 어디서 보는지 말하지 않습니다');
  await shot('1-today');
  await tips.locator('.first-tips-close').click();
  check(await page.locator('.first-tips').count() === 0, '닫았는데 남아 있습니다');
  await page.reload();
  await page.waitForSelector('.tabbar [role="tab"]');
  check(await page.locator('.first-tips').count() === 0, '다시 켜니 "처음이세요?"가 또 뜹니다');

  // 운동 — 하는 동안 "숫자를 눌러", 첫 두 주 한 줄 안내, 횟수는 범위 가운데
  await startWorkout(page);
  const head = await page.locator('.set-strip-head').first().textContent();
  check(head.includes('숫자를 눌러'), '하는 중에 숫자를 고치라는 말이 없습니다: ' + head);
  check(await page.locator('.effort-hint').count() === 1, '첫 주 세트 안내 한 줄이 없습니다');
  const range = head.match(/(\d+)~(\d+)회/);
  if (range) {
    const mid = Math.round((Number(range[1]) + Number(range[2])) / 2);
    const reps = Number(await page.locator('.set-box.now .set-in-reps').inputValue());
    check(reps === mid, `기록이 없는데 횟수가 범위 가운데(${mid})가 아닙니다: ${reps}`);
  }
  // 초보 첫 주에는 강도 기법 줄이 없다
  check(await page.locator('.tech-row').count() === 0, '초보 첫 주에 강도 기법이 보입니다');

  // 360px — 남은 세트의 ✕는 44px 이상이고 "회"와 겹치지 않는다
  const fit = await page.evaluate(() => [...document.querySelectorAll('.set-box')].filter((box) => box.querySelector('.set-remove')).map((box) => {
    const units = [...box.querySelectorAll('.set-unit')];
    const unit = units[units.length - 1].getBoundingClientRect();
    const x = box.querySelector('.set-remove').getBoundingClientRect();
    return { gap: x.left - unit.right, w: x.width, h: x.height };
  }));
  check(fit.length > 0, '남은 세트 줄이 없습니다');
  check(fit.every((row) => row.gap >= 0), '✕가 "회"와 겹칩니다: ' + JSON.stringify(fit));
  check(fit.every((row) => row.w >= 44 && row.h >= 44), '✕가 44px보다 작습니다: ' + JSON.stringify(fit));
  // 종목 이름은 잘리지 않는다(두 줄까지 감싼다)
  const name = await page.locator('.progress-name > span').first().evaluate((node) => node.scrollWidth <= node.clientWidth + 1);
  check(name, '지금 종목 이름이 잘립니다');
  // 동작 보기 칩 — 크게, "시연"이 아니라 "동작 보기"
  const demo = page.locator('.lift-demo');
  check((await demo.textContent()).includes('동작 보기'), '운동 카드 칩: ' + await demo.textContent());
  check((await demo.boundingBox()).height >= 44, '동작 보기 칩이 작습니다');
  await shot('2-set-360');

  // 한 세트 하고 끝내기 — 남은 것을 말하고 "계속하기"가 앞
  await page.locator('.now-done').click();
  await page.locator('.end-workout').first().click();
  const left = await page.locator('dialog .summary-left').textContent();
  check(/종목\(\d+세트\) 남았습니다/.test(left), '남은 것을 말하지 않습니다: ' + left);
  const foot = await page.locator('dialog .summary-foot button').allTextContents();
  check(foot[0].trim() === '계속하기' && foot.includes('오늘 마치기'), '아래 버튼: ' + foot.join(', '));
  await page.locator('dialog .summary-foot button', { hasText: '계속하기' }).click();
  check(await page.locator('dialog[open]').count() === 0 && await page.locator('.progress-head').count() === 1, '계속하기 뒤에 운동 화면이 아닙니다');

  // 이 종목을 마저 하고 끝낸다 — 첫날 요약에 현장 용어 · "부족"이 없다
  while (await page.locator('.now-done').count() && (await page.locator('.now-done-sub').textContent()).includes('남음')) {
    await page.locator('.now-done').click();
    if (await page.locator('#rest-host .rest-skip', { hasText: '건너뛰기' }).count()) await page.locator('#rest-host .rest-skip', { hasText: '건너뛰기' }).click();
  }
  await page.locator('.now-done').click();
  await page.locator('.end-workout').first().click();
  await page.locator('dialog .summary-more > summary').click();
  const summary = (await page.locator('dialog').innerText()).replace(/\s+/g, ' ');
  check(!/\bPR\b|1회 최대|처방|유효 세트|부족/.test(summary), '첫날 요약에: ' + (summary.match(/.{0,20}(\bPR\b|1회 최대|처방|유효 세트|부족).{0,20}/) || [''])[0]);
  check(summary.includes('진행 중'), '주가 남았는데 "진행 중"이 없습니다');
  const values = await page.locator('dialog .wm-value').allTextContents();
  check(values.every((text) => /^\d+세트$|^보조로$/.test(text.trim())), '부위별 숫자가 정수 세트가 아닙니다: ' + values.join(', '));
  check(/다음 주:/.test(summary), '다음 주 한 줄이 없습니다');
  await shot('3-summary');
  await page.locator('dialog .summary-foot button', { hasText: '오늘 마치기' }).click();

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
