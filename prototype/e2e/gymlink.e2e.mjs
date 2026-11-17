// 검색이 될 때 — 설문에서 적은 이름으로 헬스장 탭 검색이 바로 채워지고, 고른 곳이 이름표 자리를
//   대신한다(헬스장이 둘로 안 갈라지고, 설문에서 고른 기구가 그대로 간다). 카카오 응답은 가짜로 준다.
import { check, gymTab, onboard, tab } from './lib.mjs';

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
  // 이름표에 적은 이름으로 검색이 채워져 있다
  check(await page.locator('#gym-search').inputValue() === '역삼 튼튼짐', '검색칸이 비어 있습니다');
  check((await page.locator('.sheet', { hasText: '헬스장 찾기' }).textContent()).includes('자리를 대신합니다'), '연결 중이라는 안내가 없습니다');
  await page.locator('.search-row', { hasText: '테헤란로' }).locator('.pick').waitFor();
  check((await page.locator('.search-row', { hasText: '테헤란로' }).locator('.pick').textContent()).trim() === '여기예요', '같은 이름이 "등록됨"으로 막혔습니다');
  await shot('1-search');
  await page.locator('.search-row', { hasText: '테헤란로' }).locator('.pick').click();
  await page.locator('dialog .finish', { hasText: '등록하기' }).click();
  await page.waitForFunction(() => !document.querySelector('dialog')?.open);

  const after = await page.locator('.gym-here').textContent();
  check(after.includes('테헤란로 152') && !after.includes('등록 안 됨'), '연결 뒤 칸: ' + after);
  check(after.includes('기구 ' + kit + '개'), '연결하니 기구가 바뀌었습니다: ' + after);
  check(await page.locator('.gym-row').count() === 0, '이름표와 연결한 곳이 둘로 갈라졌습니다');
  check(await page.evaluate(() => window.scrollY) === 0, '연결한 뒤 칸이 화면 밖에 있습니다');
  await shot('2-linked');
}

// 처음 설정은 헬스장을 묻지 않는다 — 이름은 내 정보 › 헬스장 › 이름 바꾸기에서 적는다
async function onboardWithName(page, name) {
  await onboard(page);
  await gymTab(page);
  await page.locator('.gym-here').getByRole('button', { name: '이름 바꾸기' }).click();
  await page.locator('dialog .text-input').fill(name);
  await page.locator('dialog .finish', { hasText: '바꾸기' }).click();
  await page.waitForFunction(() => !document.querySelector('dialog')?.open);
  await tab(page, '오늘');
}
