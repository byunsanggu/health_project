// 처음 쓰는 사람의 헬스장 · 기구 · 순서 — 설문에서 헬스장 이름을 적고, 그림 칸에서 기구를 고르고,
//   오늘 목록에서 바로 순서를 바꾸고, 헬스장 탭에서 설문이 만든 이름표를 실제 헬스장으로 연결한다.
//   연결해도 기구와 기록은 그대로 가고, 헬스장이 둘로 갈라지지 않는다.
import { check, finishWizard, tab } from './lib.mjs';

async function toGymStep(page) {
  await page.waitForSelector('.consent-card');
  const cards = page.locator('.consent-card');
  for (let i = 0; i < await cards.count(); i += 1) {
    const card = cards.nth(i);
    if (await card.locator('.consent-tag.req').count() > 0) await card.locator('.consent-toggle').click();
  }
  for (let i = 0; i < 6; i += 1) {
    const step = (await page.locator('.session-head h2').textContent()).trim();
    if (step === '헬스장 기구') return;
    if (await page.locator('.wizard-needs').count()) {
      if (step === '경력') await page.locator('.choice', { hasText: '초보' }).first().click();
      else if (step === '내 정보') await page.locator('.segmented button', { hasText: '남성' }).click();
    }
    await page.locator('.wizard-nav .primary').click();
  }
  throw new Error('헬스장 기구 단계에 못 갔습니다');
}

const tileNamed = (page, name) => page.locator('.equip-tile', { has: page.locator('.name', { hasText: new RegExp(`^${name}$`) }) });

export default async function ({ page, url, shot }) {
  await page.clock.install({ time: new Date('2026-10-22T18:00:00+09:00') });
  await page.goto(url);
  await toGymStep(page);

  // 어디 다니세요? — 이름을 치는 동안 칸이 바뀌지 않는다
  const name = page.locator('#onb-gym-name');
  await name.click();
  await page.keyboard.type('역삼 튼튼짐', { delay: 30 });
  check(await name.inputValue() === '역삼 튼튼짐', '헬스장 이름이 끊깁니다: ' + await name.inputValue());

  // 비슷한 곳 고르기 → 그림 칸이 채워진다
  await page.locator('.chip-row .pick', { hasText: '동네 헬스장' }).click();
  check(await page.locator('.chip-row .pick[aria-pressed="true"]', { hasText: '동네 헬스장' }).count() === 1, '고른 유형이 표시되지 않습니다');
  check(await page.locator('#onb-gym-name').inputValue() === '역삼 튼튼짐', '유형을 고르니 이름이 지워졌습니다');
  const tiles = await page.locator('.equip-tile').count();
  check(tiles >= 15 && tiles <= 35, '처음 보이는 그림 칸이 ' + tiles + '개입니다 (흔한 것만 보여야 합니다)');
  await shot('1-gymstep');

  // 레그프레스 끄고 다시 켜기
  const press = tileNamed(page, '레그프레스');
  check(await press.getAttribute('aria-pressed') === 'true', '동네 헬스장인데 레그프레스가 꺼져 있습니다');
  await press.click();
  check(await tileNamed(page, '레그프레스').getAttribute('aria-pressed') === 'false', '눌러도 안 꺼집니다');
  await tileNamed(page, '레그프레스').click();

  // 덜 흔한 기구 펼치기
  const before = await page.locator('.equip-tile').count();
  await page.locator('.equip-more').filter({ hasText: '더 보기' }).last().click();
  check(await page.locator('.equip-tile').count() > before, '더 보기가 안 펼쳐집니다');
  // 찾기
  await page.locator('input[placeholder^="이름이나 생김새로"]').fill('굽은 봉');
  check((await page.locator('.equip-tile .name').allTextContents()).some((text) => text.includes('EZ')), '굽은 봉으로 EZ 바가 안 나옵니다');
  await page.locator('input[placeholder^="이름이나 생김새로"]').fill('');
  const onCount = Number((await page.locator('.sheet-head .meta', { hasText: '켜짐' }).textContent()).match(/(\d+)개 켜짐/)[1]);

  await finishWizard(page, { level: '초보' });

  // 오늘 — 연결 안내, 바로 순서 바꾸기
  const nudge = await page.locator('.gym-link-nudge').textContent();
  check(nudge.includes('역삼 튼튼짐') && nudge.includes('연결 전'), '오늘 화면 안내: ' + nudge);
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
  await tab(page, '헬스장');
  const here = await page.locator('.gym-here').textContent();
  check(here.includes('역삼 튼튼짐') && here.includes('아직 연결 안 됨'), '헬스장 칸: ' + here);
  check(here.includes('기구 ' + onCount + '개'), '설문에서 고른 기구 수(' + onCount + ')가 안 맞습니다: ' + here);
  // 검색이 없을 때는 연결하기 하나만 — 따로 등록하는 칸이 같이 있으면 헬스장이 둘로 갈라진다
  check(await page.locator('.register-open').count() === 0, '이름표인데 직접 등록 버튼이 같이 있습니다');
  await shot('3-gymtab');

  // 연결하기 — 유형 → 층 → 등록
  await page.locator('.gym-link').click();
  check((await page.locator('dialog').textContent()).includes('내 헬스장 연결'), '연결 창이 아닙니다');
  await page.locator('dialog .choice', { hasText: '동네 헬스장' }).click();
  check(await page.locator('dialog input[placeholder="헬스장 이름"]').inputValue() === '역삼 튼튼짐', '이름이 안 넘어왔습니다');
  await page.locator('dialog input[placeholder^="예: 역삼동"]').fill('역삼동');
  await page.locator('dialog input[placeholder^="층"]').fill('3층');
  await page.locator('dialog .finish', { hasText: '등록하기' }).click();
  await page.waitForFunction(() => !document.querySelector('dialog')?.open);

  const linked = await page.locator('.gym-here').textContent();
  check(linked.includes('역삼 튼튼짐') && linked.includes('역삼동 · 3층') && !linked.includes('연결 안 됨'), '연결 뒤 칸: ' + linked);
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
  await tab(page, '헬스장');
  check((await page.locator('.gym-here').textContent()).includes('3층'), '다시 켜니 연결이 사라졌습니다');
}
