// 처음 설정 — 경력과 성별을 고르기 전에는 넘어가지 않는다 (전에는 중급 · 남성 78kg이 미리 골라져 있었다)
//   세 장: 동의 · 세 가지만 알려 주세요 · 준비됐습니다. 전문가와 운동한 기간은 "자세히 ›" 안에 있다.
import { agreeConsent, check } from './lib.mjs';

export default async function ({ page, url, shot }) {
  await page.goto(url);
  await agreeConsent(page);

  // 처음 설정은 세 장 — 맨 위 막대 셋 (전에는 넷, 그 전에는 여덟이었다)
  check(await page.locator('.steps.dots .step').count() === 3, '단계 막대가 ' + await page.locator('.steps.dots .step').count() + '개입니다');

  // 경력이 안 골라져 있고, 내 운동 만들기가 막혀 있다
  const levels = page.locator('.ob-level .segmented button');
  check((await levels.allTextContents()).join(',') === '처음입니다,6개월~2년,2년 이상', '경력 칩: ' + (await levels.allTextContents()).join(','));
  check(await page.locator('.ob-level .segmented button[aria-pressed="true"]').count() === 0, '경력이 미리 골라져 있습니다');
  check(await page.locator('.wizard-nav .primary').isDisabled(), '경력을 안 골랐는데 넘어갈 수 있습니다');
  await shot('1-level');
  await levels.filter({ hasText: '처음입니다' }).click();
  // 자세히 — 전문가와 운동한 기간. 처음입니다를 고르면 기간은 3개월
  await page.locator('.level-more').click();
  check(await page.locator('.ob-level .segmented button', { hasText: '전문가' }).count() === 1, '자세히에 전문가가 없습니다');
  check(await page.inputValue('#months') === '3', '처음입니다를 골랐는데 기간이 ' + await page.inputValue('#months'));

  // 성별을 고르기 전에는 막혀 있고, 여성을 고르면 체중이 58에서 시작한다
  check(await page.locator('.wizard-nav .primary').isDisabled(), '성별을 안 골랐는데 넘어갈 수 있습니다');
  await page.locator('.segmented button', { hasText: '여성' }).click();
  check(await page.inputValue('#bw') === '58', '여성을 골랐는데 체중이 ' + await page.inputValue('#bw'));
  // 반복 스타일 · 헬스장은 처음에 묻지 않는다 — 내 정보에서 바꾼다
  const text = await page.locator('#screen').textContent();
  check(!text.includes('평소 반복 스타일') && !text.includes('어떤 곳인가요'), '반복 스타일 · 헬스장을 처음에 묻습니다');
  // 일수는 2 · 3 · 4일, 더 보기에 나머지
  await page.locator('.days-more').click();
  check(await page.locator('.ob-days .segmented button').count() === 7, '더 보기에 1~7일이 없습니다');
  await page.locator('.ob-days .segmented button', { hasText: /^4일$/ }).click();
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
  await shot('2-ready');
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
