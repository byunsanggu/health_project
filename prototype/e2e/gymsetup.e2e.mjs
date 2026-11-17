// 처음 쓰는 사람의 헬스장 · 기구 · 순서 — 내 정보 › 헬스장에서 이름을 적고, 그림 칸에서 기구를 고르고,
//   오늘 목록에서 바로 순서를 바꾸고, 헬스장 탭에서 설문이 만든 이름표를 실제 헬스장으로 연결한다.
//   연결해도 기구와 기록은 그대로 가고, 헬스장이 둘로 갈라지지 않는다.
import { check, gymTab, onboard, tab, todayDetail } from './lib.mjs';

const tileNamed = (page, name) => page.locator('.equip-tile', { has: page.locator('.name', { hasText: new RegExp(`^${name}$`) }) });

export default async function ({ page, url, shot }) {
  await page.clock.install({ time: new Date('2026-10-22T18:00:00+09:00') });
  await page.goto(url);
  // 처음 설정은 헬스장을 묻지 않는다(잘 모르겠어요 = 흔한 기구) — 이름 · 유형 · 기구는 내 정보 › 헬스장에서
  await onboard(page, { level: '초보' });
  await gymTab(page);

  // 이름 바꾸기 — 이름을 치는 동안 칸이 바뀌지 않는다
  await page.locator('.gym-here').getByRole('button', { name: '이름 바꾸기' }).click();
  const name = page.locator('dialog .text-input');
  await name.fill('');
  await name.click();
  await page.keyboard.type('역삼 튼튼짐', { delay: 30 });
  check(await name.inputValue() === '역삼 튼튼짐', '헬스장 이름이 끊깁니다: ' + await name.inputValue());
  await page.locator('dialog .finish', { hasText: '바꾸기' }).click();
  await page.waitForFunction(() => !document.querySelector('dialog')?.open);

  // 기구 고치기 → 비슷한 곳 고르기 → 그림 칸이 채워진다(흔한 것만 먼저)
  await page.locator('.gym-here').getByRole('button', { name: '기구 고치기' }).click();
  await page.locator('dialog .chip-row .pick', { hasText: '동네 헬스장' }).click();
  const tiles = await page.locator('dialog .equip-tile').count();
  check(tiles >= 15 && tiles <= 35, '처음 보이는 그림 칸이 ' + tiles + '개입니다 (흔한 것만 보여야 합니다)');
  await shot('1-gymstep');

  // 레그프레스 끄고 다시 켜기
  const press = tileNamed(page, '레그프레스');
  check(await press.getAttribute('aria-pressed') === 'true', '동네 헬스장인데 레그프레스가 꺼져 있습니다');
  await press.click();
  check(await tileNamed(page, '레그프레스').getAttribute('aria-pressed') === 'false', '눌러도 안 꺼집니다');
  await tileNamed(page, '레그프레스').click();

  // 덜 흔한 기구 펼치기
  const before = await page.locator('dialog .equip-tile').count();
  await page.locator('dialog .equip-more').filter({ hasText: '더 보기' }).last().click();
  check(await page.locator('dialog .equip-tile').count() > before, '더 보기가 안 펼쳐집니다');
  // 찾기
  await page.locator('dialog input[placeholder^="이름이나 생김새로"]').fill('굽은 봉');
  check((await page.locator('dialog .equip-tile .name').allTextContents()).some((text) => text.includes('EZ')), '굽은 봉으로 EZ 바가 안 나옵니다');
  await page.locator('dialog input[placeholder^="이름이나 생김새로"]').fill('');
  // 기구는 "켜짐"이 아니라 "있음"으로 센다 — 개수 줄은 "기구 N개"
  const onCount = Number((await page.locator('dialog #equip-count').textContent()).match(/기구 (\d+)개/)[1]);
  // 켜도 열리는 종목이 없는 기구(폼롤러 — 위에서 펼친 맨몸 · 소도구 묶음)는 칸에 그렇다고 적는다
  const roller = tileNamed(page, '폼롤러');
  check(await roller.count() === 1, '펼친 묶음에 폼롤러가 없습니다');
  check((await roller.textContent()).includes('아직 이 기구로 하는 종목이 없습니다'), '폼롤러 칸: ' + await roller.textContent());
  await page.locator('dialog .modal-close').click();
  await tab(page, '오늘');

  // 오늘 — 연결 안내, 바로 순서 바꾸기
  check(await page.locator('.gym-link-nudge').count() === 0, '첫날 오늘 화면에 헬스장 등록 안내가 떠 있습니다');
  // 제목 옆 "1주차" 칩은 없다
  check(!(await page.locator('.session-head').first().textContent()).includes('주차'), '오늘 머리에 주차가 또 있습니다');
  check(!(await page.locator('#status-meta').textContent()).includes('주차'), '맨 위 상태 줄에 주차 칩이 남아 있습니다');
  await todayDetail(page); // 순서 바꾸기 · ⋯은 오늘 › 자세히 보기 안에
  const names = async () => (await page.locator('.plan-row .plan-main .name > span:first-child').allTextContents());
  const first = await names();
  await page.locator('.list-order').click();
  check(await page.locator('.plan-row.reordering').count() === first.length, '순서 바꾸기를 눌러도 ↑↓가 안 붙습니다');
  await page.locator('.plan-row.reordering').first().locator('button[aria-label$="아래로"]').click();
  const moved = await names();
  check(moved[0] === first[1] && moved[1] === first[0], '아래로가 안 됩니다: ' + moved.join(', '));
  await shot('2-reorder');
  await page.locator('.order-done .finish', { hasText: '이 순서로 하기' }).click();
  check(await page.locator('.plan-row.reordering').count() === 0, '순서 바꾸기가 안 닫힙니다');

  // ⋯ 메뉴 — 맨 뒤로 미루기
  await page.locator('.plan-row .row-menu').first().click();
  await page.locator('dialog .menu-row', { hasText: '맨 뒤로 미루기' }).click();
  const pushed = await names();
  check(pushed[pushed.length - 1] === moved[0], '맨 뒤로가 안 됩니다: ' + pushed.join(', '));

  // 헬스장 탭 — 지금 다니는 곳
  await gymTab(page);
  const here = await page.locator('.gym-here').textContent();
  check(here.includes('역삼 튼튼짐') && here.includes('아직 등록 안 됨'), '헬스장 칸: ' + here);
  check(here.includes('기구 ' + onCount + '개'), '고른 기구 수(' + onCount + ')가 안 맞습니다: ' + here);
  // 검색이 없을 때는 연결하기 하나만 — 따로 등록하는 칸이 같이 있으면 헬스장이 둘로 갈라진다
  check(await page.locator('.register-open').count() === 0, '이름표인데 직접 등록 버튼이 같이 있습니다');
  await shot('3-gymtab');

  // 연결하기 — 한 장에서: 이름(넘어와 있다) · 어떤 곳 · 누가 보는지 · 동네 · 층 → 등록하고 기구 고르기
  await page.locator('.gym-link').click();
  check((await page.locator('dialog').textContent()).includes('내 헬스장 등록'), '등록 창이 아닙니다');
  check(await page.locator('dialog .choice', { hasText: '동네 헬스장' }).count() === 0, '유형부터 고르게 합니다');
  check(await page.locator('dialog input[placeholder="헬스장 이름"]').inputValue() === '역삼 튼튼짐', '이름이 안 넘어왔습니다');
  check(await page.locator('dialog .gym-kind .pick[aria-pressed="true"]').textContent() === '일반 헬스장', '일반 헬스장이 기본이 아닙니다');
  check((await page.locator('dialog').textContent()).includes('고른 기구 ' + onCount + '개'), '설문에서 고른 기구를 가져간다는 말이 없습니다');
  await page.locator('dialog input[placeholder^="예: 역삼동"]').fill('역삼동');
  await page.locator('dialog input[placeholder^="층"]').fill('3층');
  await page.locator('dialog .finish', { hasText: '등록하고 기구 고르기' }).click();
  // 등록하면 바로 기구 그림 칸 — 설문에서 고른 것이 그대로 켜져 있다
  await page.locator('dialog .equip-tile').first().waitFor();
  check((await page.locator('dialog #modal-title').textContent()) === '기구 고르기', '등록 뒤 기구 고르기로 안 갑니다');
  check((await page.locator('dialog #equip-count').textContent()).includes('기구 ' + onCount + '개'), '기구 수가 바뀌었습니다: ' + await page.locator('dialog #equip-count').textContent());
  await page.locator('dialog .equip-done').click();
  await page.waitForFunction(() => !document.querySelector('dialog')?.open);

  const linked = await page.locator('.gym-here').textContent();
  check(linked.includes('역삼 튼튼짐') && linked.includes('역삼동 · 3층') && !linked.includes('등록 안 됨'), '연결 뒤 칸: ' + linked);
  check(linked.includes('기구 ' + onCount + '개'), '연결하니 기구가 바뀌었습니다: ' + linked);
  check(await page.locator('.gym-row').count() === 0, '이름표와 연결한 곳이 둘로 갈라졌습니다');
  await shot('4-linked');

  // 기구 고치기 — 그림 칸, 붙여넣기는 접혀 있다
  await page.locator('.gym-here .finish', { hasText: '기구 고치기' }).click();
  check(await page.locator('dialog .equip-tile').count() > 10, '기구 고치기에 그림 칸이 없습니다');
  check(await page.locator('dialog details.equip-paste-box[open]').count() === 0, '붙여넣기가 펼쳐져 있습니다');
  await shot('5-equipment');
  await page.locator('dialog .modal-close').click();

  // 껐다 켜도 남고, 오늘 안내는 사라진다
  await page.reload();
  await page.waitForSelector('.tabbar [role="tab"]');
  await tab(page, '오늘');
  check(await page.locator('.gym-link-nudge').count() === 0, '연결했는데 오늘 안내가 남았습니다');
  await gymTab(page);
  check((await page.locator('.gym-here').textContent()).includes('3층'), '다시 켜니 연결이 사라졌습니다');
}
