// 60초 처음 설정 — 목표 · 몇 가지만 알려 주세요 · 동의 · 체중 · 준비됐습니다, 장마다 아래에 붙은 넓은 버튼 하나.
//   처음 켠 순간부터 1세트 화면까지 8번 이하로 누른다(360×740 · 390×844 둘 다). 기본값(근육 키우기 · 주 3일 · 체중)은
//   그대로 두고 넘어갈 수 있고, 직접 고르는 것은 경력 · 성별 둘뿐이다. 동의가 체중보다 먼저다.
//   필수 동의는 줄마다 따로 보이고 따로 펼쳐 읽는다 — 건강정보(민감정보)도 자기 줄이 있다. 선택은 기본으로 꺼져 있다.
//   초기 설정 다시 하기는 같은 장을 쓰고 기록을 지우지 않는다.
import { agreeConsent, check, gymTab } from './lib.mjs';

const SIZES = [{ width: 360, height: 740 }, { width: 390, height: 844 }];

async function pinned(page, size, label) {
  const btn = page.locator('.wizard-nav .primary');
  const box = await btn.boundingBox();
  check(box && box.y >= 0 && box.y + box.height <= size.height + 1, `${label}: 주 버튼이 화면 밖입니다(${size.width}) ` + JSON.stringify(box));
  check(box.height >= 56 && box.width >= size.width - 40, `${label}: 주 버튼이 작습니다(${size.width}) ` + JSON.stringify(box));
  // 채운 버튼은 하나뿐
  check(await page.locator('#screen .primary, #screen .finish:not(.quiet)').count() === 1, `${label}: 채운 버튼이 하나가 아닙니다`);
}

/** 저장소(volume-coach.proto.state)를 읽는다. */
async function stored(page) {
  return page.evaluate(() => {
    try { return JSON.parse(localStorage.getItem('volume-coach.proto.state')) || {}; } catch (err) { return {}; }
  });
}

/** 저장소에 남은 운동 기록 — 횟수를 적은 세트 수. */
async function storedSets(page) {
  const saved = await stored(page);
  return (saved.sessions || []).reduce((sum, session) => sum + (session.sets || []).filter((set) => !set.warmup && set.reps > 0).length, 0);
}

async function storedConsent(page) {
  const saved = await stored(page);
  return (saved.settings && saved.settings.consent) || null;
}

export default async function ({ page, url, shot }) {
  await page.clock.install({ time: new Date('2026-11-17T18:00:00+09:00') });

  // 1) 동의 화면 — 필수 셋이 한 줄씩, 줄마다 펼쳐진다. 선택은 접혀 있고 꺼져 있다.
  await page.setViewportSize(SIZES[0]);
  await page.goto(url);
  await agreeConsent(page, { press: false });
  check((await page.locator('.session-head h2').textContent()).trim() === '시작하기 전에 동의가 필요합니다', '동의 화면 제목');
  const lines = page.locator('.consent-line');
  check(await lines.count() === 3, '필수 줄이 ' + await lines.count() + '개입니다');
  const ids = await lines.evaluateAll((nodes) => nodes.map((node) => node.dataset.consent));
  check(ids.join() === 'terms,privacy,healthData', '필수 줄: ' + ids.join());
  for (let i = 0; i < 3; i += 1) {
    const line = lines.nth(i);
    check(await line.isVisible(), i + '번째 필수 줄이 안 보입니다');
    const head = await line.locator('.consent-head').boundingBox();
    check(head.height <= 60, i + '번째 줄이 한 줄이 아닙니다: ' + head.height);
    check(await line.locator('.consent-body').count() === 0, i + '번째 줄이 처음부터 펼쳐져 있습니다');
  }
  check((await lines.nth(2).textContent()).includes('건강정보') && !(await lines.nth(1).textContent()).includes('건강정보'), '건강정보가 따로 한 줄이 아닙니다');
  check(await page.locator('.consent-more[aria-expanded="false"]').count() === 1, '선택 항목이 접혀 있지 않습니다');
  check(await page.locator('.consent-toggle').count() === 0 && await page.locator('.consent-all').count() === 0, '선택 항목 · 전체 동의가 처음부터 보입니다');
  await pinned(page, SIZES[0], '동의');
  check((await page.locator('.wizard-nav .primary').textContent()).trim() === '필수 항목에 동의하고 시작합니다', '동의 버튼 글자');
  await shot('1-consent-360');
  for (let i = 0; i < 3; i += 1) {
    await lines.nth(i).locator('.consent-view').click();
    const body = await lines.nth(i).locator('.consent-body').textContent();
    check(body.includes('수집 항목') && body.includes('보유 기간') && body.includes('거부하면'), i + '번째 줄 전문이 안 펼쳐집니다: ' + body);
  }
  check((await lines.nth(2).locator('.consent-body').textContent()).includes('체중'), '건강정보 전문에 체중이 없습니다');
  await shot('2-consent-open');
  await lines.nth(0).locator('.consent-view').click();
  check(await lines.nth(0).locator('.consent-body').count() === 0, '내용 접기가 안 됩니다');
  // 선택 항목 보기 — 펼쳐도 모두 꺼져 있고, 전체 동의는 주 버튼보다 작다
  await page.locator('.consent-more').click();
  const pressed = await page.locator('.consent-card .consent-toggle').evaluateAll((nodes) => nodes.map((n) => n.getAttribute('aria-pressed')));
  check(pressed.length >= 5 && pressed.every((value) => value === 'false'), '선택 항목이 미리 켜져 있습니다: ' + pressed.join());
  const all = await page.locator('.consent-all').boundingBox();
  const main = await page.locator('.wizard-nav .primary').boundingBox();
  check(all.height < main.height, '전체 동의가 주 버튼만큼 큽니다');

  // 2) 처음부터 1세트까지 — 탭 수를 센다(두 화면 크기)
  for (const size of SIZES) {
    await page.evaluate(() => localStorage.clear());
    await page.setViewportSize(size);
    await page.goto(url);
    await page.waitForSelector('.onboarding-head[data-step="goal"]');
    let taps = 0;
    const tap = async (locator) => { await locator.click(); taps += 1; };

    // 목표 — 그림 카드 다섯, 기본은 근육 키우기라 그대로 넘어간다
    check((await page.locator('.session-head h2').textContent()).trim() === '운동 목표를 골라 주세요', '첫 장 제목');
    check(await page.locator('.goal-persona').count() === 5, '목표 카드가 다섯이 아닙니다');
    check((await page.locator('.goal-persona[aria-pressed="true"] .goal-card-name').textContent()).trim() === '근육 키우기', '기본 목표가 근육 키우기가 아닙니다');
    await pinned(page, size, '목표');
    if (size.width === 360) await shot('3-goal-360');
    await tap(page.locator('.wizard-nav .primary'));

    // 몇 가지만 알려 주세요 — 기본값: 주 3일. 경력 · 성별 전에는 막혀 있다.
    check((await page.locator('.session-head h2').textContent()).trim() === '몇 가지만 알려 주세요', '두 번째 장 제목');
    check(await page.locator('.ob-days .segmented button[aria-pressed="true"]').textContent() === '3일', '기본 일수가 3일이 아닙니다');
    check(await page.locator('.ob-days .segmented button').count() === 3, '일수 칩이 2 · 3 · 4일 셋이 아닙니다');
    check(await page.locator('.ob-q').first().locator('.segmented button', { hasText: '전문가' }).count() === 0, '전문가가 자세히 밖에 있습니다');
    check(await page.locator('#months').count() === 0, '운동한 기간이 자세히 밖에 있습니다');
    check(await page.locator('.equip-tile, #onb-gym-name').count() === 0, '처음 설정에 기구 · 헬스장 칸이 있습니다');
    check(await page.locator('.wizard-nav .primary').isDisabled(), '경력 · 성별 전에 넘어갈 수 있습니다');
    if (size.width === 360) await shot('3-me-360');
    await tap(page.locator('.ob-q').first().locator('.segmented button', { hasText: '처음입니다' }));
    await tap(page.locator('.segmented button', { hasText: '여성' }));
    await pinned(page, size, '몇 가지');
    check((await page.locator('.wizard-nav .primary').textContent()).trim() === '다음', '두 번째 장 버튼 글자');
    await tap(page.locator('.wizard-nav .primary'));

    // 동의 — 필수만, 주 버튼 하나
    check(await page.locator('.onboarding-head').getAttribute('data-step') === 'consent', '세 번째 장이 동의가 아닙니다');
    await pinned(page, size, '동의');
    await tap(page.locator('.wizard-nav .primary'));

    // 체중(선택) — 여성이라 58에서 시작, 그대로 둬도 된다
    check(await page.inputValue('#bw') === '58', '여성인데 체중이 ' + await page.inputValue('#bw'));
    await pinned(page, size, '체중');
    check((await page.locator('.wizard-nav .primary').textContent()).trim() === '내 운동 만들기', '체중 장 버튼 글자');
    await tap(page.locator('.wizard-nav .primary'));

    // 준비됐습니다 — 한 문장과 첫 세 종목, 첫 운동 시작 · 나중에 하겠습니다
    await page.waitForSelector('.ready-nav');
    check((await page.locator('.session-head h2').textContent()).trim() === '준비됐습니다', '세 번째 장 제목');
    const line = (await page.locator('.ready-line').textContent()).trim();
    check(/^주 3회, 한 번에 약 \d+분입니다\. 오늘은 .+ 운동부터 시작합니다\.$/.test(line), '요약: ' + line);
    check(await page.locator('.ready-list li').count() === 3, '첫 세 종목이 아닙니다');
    check(await page.locator('.ready-later', { hasText: '나중에 하겠습니다' }).count() === 1, '나중에 하겠습니다가 없습니다');
    check(await page.locator('.growth-card, .program-more').count() === 0, '준비됐습니다에 프로그램 전체가 남아 있습니다');
    await pinned(page, size, '준비됐습니다');
    check((await page.locator('.wizard-nav .primary').textContent()).trim() === '첫 운동 시작', '세 번째 장 버튼 글자');
    await shot('4-ready-' + size.width);
    await tap(page.locator('.wizard-nav .primary'));

    // 바로 몸 풀기 — "오늘 운동 준비" 한 장 없이. 건너뛰면 1세트.
    check(await page.locator('dialog[open]').count() === 0, '첫 운동 시작 뒤에 창이 또 뜹니다');
    await page.locator('.warm-skip').waitFor();
    await tap(page.locator('.warm-skip'));
    await page.locator('.now-done').first().waitFor();
    check((await page.locator('.now-done').first().textContent()).includes('1세트'), '1세트 화면이 아닙니다');
    await shot('5-set1-' + size.width);
    check(taps <= 8, `${size.width}: 1세트까지 ${taps}번 눌렀습니다`);

    // 선택 동의는 기본으로 안 받았다
    const consent = await storedConsent(page);
    check(consent && ['terms', 'privacy', 'healthData'].every((id) => consent.includes(id)), '필수 동의가 저장되지 않았습니다: ' + JSON.stringify(consent));
    check(['painData', 'dietLog', 'location', 'marketing'].every((id) => !consent.includes(id)), '선택 동의가 켜져 있습니다: ' + consent.join());
  }

  // 3) 초기 설정 다시 하기 — 같은 장, 기록은 그대로
  await page.locator('.now-done').first().click();
  // 다음 날 열면 오늘 운동은 지난 기록이 된다(운동 중에는 다시 설정할 수 없다)
  await page.clock.setSystemTime(new Date('2026-11-18T18:00:00+09:00'));
  await page.reload();
  await page.waitForSelector('.tabbar [role="tab"]');
  const before = await storedSets(page);
  check(before >= 1, '한 세트가 저장되지 않았습니다');
  await gymTab(page);
  await page.getByRole('button', { name: '초기 설정 다시 하기' }).click();
  await page.locator('dialog .redo-go').click();
  check((await page.locator('.session-head h2').textContent()).trim() === '운동 목표를 골라 주세요', '다시 하기가 같은 장이 아닙니다');
  await page.locator('.wizard-nav .primary').click();
  check((await page.locator('.session-head h2').textContent()).trim() === '몇 가지만 알려 주세요', '다시 하기 둘째 장이 아닙니다');
  check(await page.locator('.ob-q').first().locator('.segmented button[aria-pressed="true"]').count() === 1, '지금 경력이 골라져 있지 않습니다');
  await page.locator('.ob-days .segmented button', { hasText: /^2일$/ }).click();
  await page.locator('.wizard-nav .primary').click();
  // 다시 하기에는 동의 장이 없다 — 바로 체중
  check(await page.locator('.consent-line').count() === 0, '다시 하기에서 동의를 또 받습니다');
  check(await page.locator('.onboarding-head').getAttribute('data-step') === 'weight', '다시 하기 셋째 장이 체중이 아닙니다');
  await page.locator('.wizard-nav .primary').click();
  await page.waitForSelector('.ready-nav');
  check((await page.locator('.ready-line').textContent()).startsWith('주 2회'), '다시 짠 요약: ' + await page.locator('.ready-line').textContent());
  await page.locator('.ready-later, .ready-go').last().click();
  await page.waitForSelector('.tabbar [role="tab"]');
  check(await storedSets(page) === before, '다시 설정했더니 기록이 바뀌었습니다');
  // 전체 프로그램 · 부위별로 충분한지는 내 정보 › 프로그램에서
  await page.locator('.tabbar [role="tab"]', { hasText: '내 정보' }).click();
  await page.locator('.me-sections button', { hasText: '설정' }).click();
  await page.locator('.program-view').click();
  check((await page.locator('dialog .growth-card h3').textContent()).trim() === '부위별로 충분한지', '전체 프로그램에 부위별 막대가 없습니다');
  check(await page.locator('dialog .program-day').count() === 2, '주 2회인데 날이 ' + await page.locator('dialog .program-day').count() + '개입니다');
}
