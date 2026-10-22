// 편집 › 종목 추가 — 부위별로 묶어 보여 준다(가슴은 가슴끼리, 등은 등끼리, 오늘 쓰는 부위가 앞).
//   부위 칩으로 한 부위만 보고, 검색칸에 "레그"를 끝까지 칠 수 있다(전에는 한 글자마다 칸이 새로 생겨 "레"만 남았다)
import { check, onboard } from './lib.mjs';

export default async function ({ page, url, shot }) {
  await page.clock.install({ time: new Date('2026-10-22T18:00:00+09:00') });
  await page.goto(url);
  await onboard(page);
  await page.locator('.list-edit').click();
  await page.locator('.head-actions .demo-open', { hasText: '종목 추가' }).click();

  const groups = (await page.locator('dialog .add-lift-group > span:first-child').allTextContents()).map((text) => text.trim());
  check(groups.length >= 5, '부위 묶음: ' + groups.join(', '));
  check(new Set(groups).size === groups.length, '같은 부위가 두 번 나옵니다: ' + groups.join(', '));
  // 오늘(상체 A) 쓰는 부위가 하체보다 앞
  check(groups.indexOf('가슴') < groups.indexOf('하체') && groups.indexOf('등') < groups.indexOf('하체'), '오늘 부위가 뒤에 있습니다: ' + groups.join(', '));
  await shot('1-groups');

  // 등만 — 등 · 승모근 종목만 남는다
  await page.locator('dialog .add-lift-regions .chip', { hasText: '등' }).click();
  check((await page.locator('dialog .add-lift-group').count()) === 1, '등을 골랐는데 다른 묶음도 보입니다');
  const details = await page.locator('dialog .add-lift-row .plan-sets').allTextContents();
  check(details.every((text) => !/가슴|삼각근|이두|삼두|대퇴|햄스트링|복근/.test(text)), '등 묶음에 다른 부위: ' + details.join(', '));
  await page.locator('dialog .add-lift-regions .chip', { hasText: '전체' }).click();

  // 검색 — 끝까지 쳐지고, 찾은 것을 넣을 수 있다
  await page.locator('dialog input[type=search]').click();
  await page.keyboard.type('레그프레스', { delay: 40 });
  check(await page.locator('dialog input[type=search]').inputValue() === '레그프레스', '검색칸 글자가 끊깁니다: ' + await page.locator('dialog input[type=search]').inputValue());
  check(await page.evaluate(() => document.activeElement && document.activeElement.type === 'search'), '치는 중에 검색칸이 커서를 잃었습니다');
  await page.locator('dialog .add-lift-row', { hasText: /^레그프레스/ }).first().click();
  const names = await page.locator('.plan-row .name').allTextContents();
  // 끼운 종목에는 "추가" 꼬리표가 붙는다
  check(names.some((name) => /^레그프레스(추가)?$/.test(name.trim())), '넣은 종목이 목록에 없습니다: ' + names.join(', '));
}
