// 검색이 될 때 — 설문에서 적은 이름으로 헬스장 탭 검색이 바로 채워지고, 고른 곳이 이름표 자리를
//   대신한다(헬스장이 둘로 안 갈라지고, 설문에서 고른 기구가 그대로 간다). 카카오 응답은 가짜로 준다.
import { check, gymTab, pickMe, tab } from './lib.mjs';

export default async function ({ page, url, shot }) {
  await page.clock.install({ time: new Date('2026-10-22T18:00:00+09:00') });
  await page.addInitScript(() => {
    localStorage.setItem('volume-coach.gymsearch', JSON.stringify({ kakaoKey: 'test-key-0123456789abcdef0123456789ab' }));
  });
  await page.route('https://dapi.kakao.com/**', (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    headers: { 'access-control-allow-origin': '*' },
    body: JSON.stringify({ documents: [
      { id: '111', place_name: '역삼 튼튼짐', category_name: '스포츠,레저 > 피트니스 > 헬스클럽', road_address_name: '서울 강남구 테헤란로 152 지하1층', address_name: '서울 강남구 역삼동 737', x: '127.036', y: '37.500' },
      { id: '222', place_name: '역삼 튼튼짐 2호점', category_name: '스포츠,레저 > 피트니스 > 헬스클럽', road_address_name: '서울 강남구 논현로 508', x: '127.03', y: '37.50' },
    ] }),
  }));
  await page.goto(url);
  await page.waitForSelector('.consent-card');
  await onboardWithName(page, '역삼 튼튼짐');

  await gymTab(page);
  const before = await page.locator('.gym-here').textContent();
  const kit = before.match(/기구 (\d+)개/)[1];
  await page.locator('.gym-link').click();
  // 설문에서 적은 이름으로 검색이 채워져 있다
  check(await page.locator('#gym-search').inputValue() === '역삼 튼튼짐', '검색칸이 비어 있습니다');
  check((await page.locator('.sheet', { hasText: '헬스장 찾기' }).textContent()).includes('자리를 대신합니다'), '연결 중이라는 안내가 없습니다');
  await page.locator('.search-row', { hasText: '테헤란로' }).locator('.pick').waitFor();
  check((await page.locator('.search-row', { hasText: '테헤란로' }).locator('.pick').textContent()).trim() === '여기예요', '같은 이름이 "등록됨"으로 막혔습니다');
  await shot('1-search');
  await page.locator('.search-row', { hasText: '테헤란로' }).locator('.pick').click();
  await page.locator('dialog .finish', { hasText: '등록하기' }).click();
  await page.waitForFunction(() => !document.querySelector('dialog')?.open);

  const after = await page.locator('.gym-here').textContent();
  check(after.includes('테헤란로 152') && !after.includes('연결 안 됨'), '연결 뒤 칸: ' + after);
  check(after.includes('기구 ' + kit + '개'), '연결하니 기구가 바뀌었습니다: ' + after);
  check(await page.locator('.gym-row').count() === 0, '이름표와 연결한 곳이 둘로 갈라졌습니다');
  check(await page.evaluate(() => window.scrollY) === 0, '연결한 뒤 칸이 화면 밖에 있습니다');
  await shot('2-linked');
}

async function onboardWithName(page, name) {
  const cards = page.locator('.consent-card');
  for (let i = 0; i < await cards.count(); i += 1) {
    const card = cards.nth(i);
    if (await card.locator('.consent-tag.req').count() > 0) await card.locator('.consent-toggle').click();
  }
  for (let i = 0; i < 14; i += 1) {
    const step = (await page.locator('.session-head h2').textContent()).trim();
    if (step === '나에 대해') await pickMe(page);
    if (step === '헬스장') await page.locator('#onb-gym-name').fill(name);
    const next = page.locator('.wizard-nav .primary');
    const text = (await next.textContent()).trim();
    await next.click();
    if (text === '이 프로그램으로 시작') break;
  }
  await page.waitForSelector('.tabbar [role="tab"]');
}
