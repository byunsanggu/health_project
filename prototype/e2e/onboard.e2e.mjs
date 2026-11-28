// 처음 설정 — 값이 먼저, 동의는 필요할 때: 목표(그림 카드 다섯) → 경력 · 일수 · 성별 → 동의 → 체중(선택) → 준비됐습니다.
//   경력과 성별을 고르기 전에는 넘어가지 않는다(전에는 중급 · 남성 78kg이 미리 골라져 있었다).
//   전문가와 운동한 기간은 "자세히 ›" 안에 있다. 동의 전에는 체중을 저장하지 않는다.
import { check } from './lib.mjs';

const stored = (page) => page.evaluate(() => {
  try { return JSON.parse(localStorage.getItem('volume-coach.proto.state')) || {}; } catch (err) { return {}; }
});

export default async function ({ page, url, shot }) {
  await page.goto(url);

  // 1) 목표 — 그림 카드 다섯, 기본은 근육 키우기. 쓰던 기록 불러오기도 이 장에. 맨 위 오른쪽에 "초기 설정" 글자가 없다
  await page.waitForSelector('.onboarding-head[data-step="goal"]');
  check(await page.locator('.steps.dots .step').count() === 5, '단계 막대가 ' + await page.locator('.steps.dots .step').count() + '개입니다');
  const names = (await page.locator('.goal-card .goal-card-name').allTextContents()).map((t) => t.trim());
  check(names.join(',') === '다이어트,근육 키우기,힘,체력,근력+감량', '목표 카드: ' + names.join(','));
  check(await page.locator('.goal-card svg').count() === 5, '목표 카드에 그림이 없습니다');
  check(await page.locator('.goal-card[aria-pressed="true"]').getAttribute('data-persona') === 'bulk', '기본 목표가 근육 키우기가 아닙니다');
  check(await page.locator('.backup-pick', { hasText: '쓰던 기록이 있습니다' }).count() === 1, '첫 장에 쓰던 기록 불러오기가 없습니다');
  check(!(await page.locator('#status-meta').textContent()).includes('초기 설정'), '맨 위에 "초기 설정"이 남아 있습니다');
  check(await page.locator('.consent-line, #bw').count() === 0, '첫 장에서 동의 · 체중을 묻습니다');
  await shot('1-goal');
  await page.locator('.goal-card[data-persona="strength"]').click();
  check(await page.locator('.goal-card[aria-pressed="true"]').getAttribute('data-persona') === 'strength', '고른 목표가 안 눌립니다');
  await page.locator('.goal-card[data-persona="bulk"]').click();
  await page.click('.wizard-nav .primary');

  // 2) 경력 · 일수 · 성별 — 경력이 안 골라져 있고 막혀 있다. 체중 칸은 아직 없다(건강 정보 — 동의 뒤)
  await page.waitForSelector('.onboarding-head[data-step="me"]');
  const levels = page.locator('.ob-level .segmented button');
  check((await levels.allTextContents()).join(',') === '처음입니다,6개월~2년,2년 이상', '경력 칩: ' + (await levels.allTextContents()).join(','));
  check(await page.locator('.ob-level .segmented button[aria-pressed="true"]').count() === 0, '경력이 미리 골라져 있습니다');
  check(await page.locator('.wizard-nav .primary').isDisabled(), '경력을 안 골랐는데 넘어갈 수 있습니다');
  check(await page.locator('#bw').count() === 0, '동의 전에 체중을 묻습니다');
  await shot('2-level');
  await levels.filter({ hasText: '처음입니다' }).click();
  // 자세히 — 전문가와 운동한 기간. 처음입니다를 고르면 기간은 3개월
  await page.locator('.level-more').click();
  check(await page.locator('.ob-level .segmented button', { hasText: '전문가' }).count() === 1, '자세히에 전문가가 없습니다');
  check(await page.inputValue('#months') === '3', '처음입니다를 골랐는데 기간이 ' + await page.inputValue('#months'));
  // 성별을 고르기 전에는 막혀 있다
  check(await page.locator('.wizard-nav .primary').isDisabled(), '성별을 안 골랐는데 넘어갈 수 있습니다');
  await page.locator('.segmented button', { hasText: '여성' }).click();
  // 반복 스타일 · 헬스장은 처음에 묻지 않는다 — 내 정보에서 바꾼다
  const text = await page.locator('#screen').textContent();
  check(!text.includes('평소 반복 스타일') && !text.includes('어떤 곳인가요'), '반복 스타일 · 헬스장을 처음에 묻습니다');
  // 일수는 2 · 3 · 4일, 더 보기에 나머지
  await page.locator('.days-more').click();
  check(await page.locator('.ob-days .segmented button').count() === 7, '더 보기에 1~7일이 없습니다');
  await page.locator('.ob-days .segmented button', { hasText: /^4일$/ }).click();
  // 동의 전 — 저장소에 체중이 없다
  const early = await stored(page);
  check(!early.answers || early.answers.bodyweightKg === undefined, '동의 전에 체중이 저장됐습니다: ' + JSON.stringify(early.answers));
  await page.click('.wizard-nav .primary');

  // 3) 동의 — "체중 같은 건강 정보를 쓰려면 동의가 필요합니다"로 연다
  await page.waitForSelector('.onboarding-head[data-step="consent"]');
  check((await page.locator('.consent-lead').textContent()).startsWith('체중 같은 건강 정보를 쓰려면 동의가 필요합니다'), '동의 첫 줄: ' + await page.locator('.consent-lead').textContent());
  check(await page.locator('.consent-line').count() === 3, '필수 동의 줄이 셋이 아닙니다');
  await shot('3-consent');
  await page.click('.wizard-nav .primary');

  // 4) 체중(선택) — 여성을 골랐으니 58에서 시작한다. 주 버튼은 "내 운동 만들기"
  await page.waitForSelector('.onboarding-head[data-step="weight"]');
  check(await page.inputValue('#bw') === '58', '여성을 골랐는데 체중이 ' + await page.inputValue('#bw'));
  check((await page.locator('.wizard-nav .primary').textContent()).trim() === '내 운동 만들기', '체중 장 버튼 글자');
  await shot('4-weight');
  await page.click('.wizard-nav .primary');

  // 준비됐습니다 — 주 버튼은 아래에 붙어 넓게 56px, 스크롤 없이 보인다(360×740도)
  await page.waitForSelector('.ready-nav');
  for (const size of [{ width: 390, height: 844 }, { width: 360, height: 740 }]) {
    await page.setViewportSize(size);
    const btn = await page.locator('.wizard-nav .primary').boundingBox();
    check((await page.locator('.wizard-nav .primary').textContent()).trim() === '첫 운동 시작', '준비됐습니다 주 버튼 글자');
    check(btn && btn.y + btn.height <= size.height + 1 && btn.y >= 0, `주 버튼이 화면 밖입니다(${size.width}): ` + JSON.stringify(btn));
    check(btn.height >= 56 && btn.width >= size.width - 40, `주 버튼이 작습니다(${size.width}): ` + JSON.stringify(btn));
  }
  check((await page.locator('.ready-line').textContent()).startsWith('주 4회'), '요약: ' + await page.locator('.ready-line').textContent());
  await shot('5-ready');
  // 동의 뒤 — 체중이 저장됐다
  const late = await stored(page);
  check(late.answers && late.answers.bodyweightKg === 58, '동의 뒤 체중이 저장되지 않았습니다: ' + JSON.stringify(late.answers));
  // 초보 프로그램 — 바벨 데드리프트 · 백 스쿼트로 시작하지 않는다
  const first = await page.locator('.ready-list').textContent();
  check(!/컨벤셔널 데드리프트|백 스쿼트/.test(first), '초보인데 바벨 스쿼트 · 데드리프트가 들었습니다');
  await page.locator('.ready-later').click();
  await page.waitForSelector('.tabbar [role="tab"]');
  const plan = await page.locator('#screen').textContent();
  check(!/컨벤셔널 데드리프트|백 스쿼트/.test(plan), '초보인데 바벨 스쿼트 · 데드리프트가 들었습니다');

  // 부위별로 충분한지 · 요일별 종목은 내 정보 › 프로그램 › 전체 프로그램 보기에
  await page.locator('.tabbar [role="tab"]', { hasText: '내 정보' }).click();
  await page.locator('.program-view').click();
  check(/최소 세트를 채웁니다/.test(await page.locator('dialog .growth-card').textContent()), '부위별로 충분한지에 결론이 없습니다');
  check(await page.locator('dialog .program-day').count() === 4, '주 4회인데 날이 ' + await page.locator('dialog .program-day').count() + '개입니다');
}
