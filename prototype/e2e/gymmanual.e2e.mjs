// 검색에 없는 헬스장(회사 · 아파트) 직접 등록 — "LG전자 러닝센터에 있는데 검색이 되지 않고 등록이 되지 않아".
//   검색 결과가 없을 때 · 검색이 실패할 때 · 답이 안 올 때(찾는 중) 모두 "직접 등록"이 눈에 띄게 있고,
//   이름은 검색한 말로 채워져 있고, 회사 헬스장은 기본이 "나만 보기"이고, 등록하면 바로 기구 그림 칸으로 간다.
//   등록한 곳이 설문이 만든 이름표 자리를 넘겨받는다(둘로 안 갈라진다 · 설문에서 고른 기구 그대로 · 오늘 화면 "등록하기" 안내 사라짐).
//   나만 보기로 등록한 회사 헬스장은 집(홈짐)으로 대하지 않는다. 서버 없이 되고, 다시 켜도 남는다.
import { check, gymTab, onboard, tab } from './lib.mjs';

export default async function ({ page, url, shot }) {
  await page.clock.install({ time: new Date('2026-10-22T18:00:00+09:00') });
  await page.addInitScript(() => {
    localStorage.setItem('volume-coach.gymsearch', JSON.stringify({ kakaoKey: 'test-key-0123456789abcdef0123456789ab' }));
  });
  let mode = 'hang';
  await page.route('https://dapi.kakao.com/**', (route) => {
    if (mode === 'hang') return undefined; // 답이 안 온다 — 지하에서 매달린 요청
    if (mode === 'fail') return route.abort();
    return route.fulfill({
      status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify({ documents: [] }),
    });
  });
  await page.goto(url);
  await onboard(page);

  // 첫날 오늘 화면에는 등록 안내가 없다(첫 운동을 마친 뒤 한 번만) — 내 정보 › 헬스장에서 등록한다
  check(await page.locator('.gym-link-nudge').count() === 0, '첫날 오늘 화면에 등록 안내가 떠 있습니다');
  await gymTab(page);
  await page.locator('.gym-link').click();
  const kit = (await page.locator('.gym-here').textContent()).match(/기구 (\d+)개/)[1];
  // 아직 아무것도 안 쳤을 때도 직접 등록으로 가는 문이 있다
  check(await page.locator('#gym-results .register-open').count() === 1, '검색 전에는 직접 등록 버튼이 없습니다');

  // 1) 답이 안 올 때 — "찾는 중…"에서도 직접 등록이 보인다
  await page.locator('#gym-search').fill('LG전자 러닝센터');
  await page.locator('#gym-results', { hasText: '찾는 중' }).waitFor();
  check(await page.locator('#gym-results .register-open').isVisible(), '찾는 중에는 직접 등록 버튼이 없습니다');

  // 2) 검색이 실패할 때(인터넷 없음)
  mode = 'fail';
  await page.locator('#gym-search').fill('LG전자 러닝센터 ');
  await page.locator('#gym-results .notice', { hasText: '검색이 안 됩니다' }).waitFor();
  check(await page.locator('#gym-results .register-open.loud').isVisible(), '검색 실패인데 직접 등록이 크게 안 보입니다');

  // 3) 결과가 없을 때
  mode = 'empty';
  await page.locator('#gym-search').fill('LG전자 러닝센터');
  await page.locator('#gym-results .notice', { hasText: '검색에 나오지 않습니다' }).waitFor();
  const loud = page.locator('#gym-results .register-open.loud');
  check((await loud.textContent()).includes('검색에 없어요') && (await loud.textContent()).includes('직접 등록'), '버튼: ' + await loud.textContent());
  await shot('1-missed');
  await loud.click();

  // 한 장짜리 등록 창 — 이름은 검색한 말, 회사 헬스장은 기본이 나만 보기
  const dialog = page.locator('dialog');
  check(await dialog.locator('#gym-reg-name').inputValue() === 'LG전자 러닝센터', '검색한 이름이 안 채워졌습니다');
  check((await dialog.locator('.gym-kind .pick[aria-pressed="true"]').textContent()).includes('회사'), '회사 · 아파트가 기본이 아닙니다');
  check((await dialog.locator('.gym-see[aria-pressed="true"]').textContent()).includes('나만 보기'), '기본이 나만 보기가 아닙니다');
  check(await dialog.locator('.choice', { hasText: '프랜차이즈' }).count() === 0, '유형부터 고르게 합니다');
  await shot('2-form');
  // 이름을 지우고 누르면 무엇이 빠졌는지 말한다
  await dialog.locator('#gym-reg-name').fill('');
  await dialog.locator('.gym-reg-submit').click();
  check((await dialog.locator('#gym-reg-name-warn').textContent()).includes('이름을 적어 주세요'), '이름이 비었는데 아무 말이 없습니다');
  await dialog.locator('#gym-reg-name').fill('LG전자 러닝센터');
  await dialog.locator('input[placeholder^="층"]').fill('지하 1층');
  await dialog.locator('.gym-reg-submit').click();

  // 바로 기구 고르기 — 설문에서 고른 기구가 그대로
  await dialog.locator('.equip-tile').first().waitFor();
  check(await dialog.locator('#modal-title').textContent() === '기구 고르기', '등록 뒤 기구 고르기로 안 갑니다');
  check((await dialog.locator('#equip-count').textContent()).includes('기구 ' + kit + '개'), '설문에서 고른 기구가 안 넘어왔습니다');
  check(await dialog.locator('.equip-group-head .list-label').first().textContent() !== '집에 흔한 것 — 맨몸 · 소도구', '회사 헬스장을 집으로 대합니다');
  await shot('3-equipment');
  await dialog.locator('.equip-done').click();
  await page.waitForFunction(() => !document.querySelector('dialog')?.open);

  // 이름표 자리를 넘겨받았다
  const here = await page.locator('.gym-here').textContent();
  check(here.includes('LG전자 러닝센터') && here.includes('지하 1층') && !here.includes('등록 안 됨') && !here.includes('홈짐'), '등록 뒤 칸: ' + here);
  check(here.includes('사용 중') && here.includes('지금 다니는 곳'), '등록 뒤 머리: ' + here);
  check(await page.locator('.gym-row').count() === 0, '이름표와 등록한 곳이 둘로 갈라졌습니다');
  check(await page.locator('.gym-link').count() === 0, '등록했는데 "찾아서 등록하기"가 남았습니다');
  const saved = await page.evaluate(() => JSON.stringify(localStorage));
  check(saved.includes('LG전자 러닝센터') && saved.includes('onlyMe'), '나만 보기 표시가 저장되지 않았습니다');
  await shot('4-registered');
  await tab(page, '오늘');
  check(await page.locator('.gym-link-nudge').count() === 0, '등록했는데 오늘 화면 안내가 남았습니다');

  // 다시 켜도 남는다
  await page.reload();
  await page.waitForSelector('.tabbar [role="tab"]');
  check(await page.locator('.gym-link-nudge').count() === 0, '다시 켜니 등록 안내가 돌아왔습니다');
  await gymTab(page);
  check((await page.locator('.gym-here').textContent()).includes('LG전자 러닝센터'), '다시 켜니 등록이 사라졌습니다');

  // 한 곳 더 — 이번에는 따로 추가된다. 닫아 둔 초안이 되살아나지 않는다
  await page.locator('#gym-search').fill('우리 아파트 헬스장');
  await page.locator('#gym-results .register-open.loud').click();
  check(await dialog.locator('#gym-reg-name').inputValue() === '우리 아파트 헬스장', '예전 초안이 되살아났습니다');
  await dialog.locator('.gym-see', { hasText: '나누기' }).click();
  check(await dialog.locator('#gym-reg-name').inputValue() === '우리 아파트 헬스장', '고르니 이름이 지워졌습니다');
  await dialog.locator('.gym-reg-submit').click();
  await dialog.locator('.equip-done').click();
  await page.waitForFunction(() => !document.querySelector('dialog')?.open);
  check(await page.locator('.gym-row').count() === 2, '두 번째 헬스장이 따로 추가되지 않았습니다');
}
