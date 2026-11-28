// 기구 고르기 — 헬스장에서 서 있는 자리대로 묶고(하체 머신 · 상체 · 복근 머신 · 유산소 · 맨몸 · 소도구),
//   칸마다 "무엇을 하는 기구인지 · 어디 운동인지" 한 줄. PT 스튜디오 유형을 고르면 TRX(매달린 띠)가 켜지고,
//   크게 보기에서 TRX로 하는 운동(TRX 로우 · 체스트 프레스)이 보인다. 부위("종아리")로도 찾아진다.
//   390×844와 360×640에서 찍는다.
import { check, gymTab, onboard } from './lib.mjs';

const cellNamed = (page, name) => page.locator('.equip-cell', { has: page.locator('.name', { hasText: new RegExp(`^${name}$`) }) });

async function groupOf(page, name) {
  // 칸이 들어 있는 묶음 제목 — 칸 앞의 가장 가까운 묶음 머리
  return page.evaluate((target) => {
    const names = Array.from(document.querySelectorAll('#equipment-list .equip-tile .name'));
    const hit = names.find((node) => node.textContent === target);
    if (!hit) return null;
    let node = hit.closest('.equip-grid');
    while (node && !(node.classList && node.classList.contains('equip-group-head'))) node = node.previousElementSibling;
    return node ? node.querySelector('.list-label').textContent : null;
  }, name);
}

export default async function ({ page, url, shot }) {
  await page.clock.install({ time: new Date('2026-10-22T18:00:00+09:00') });
  await page.goto(url);
  await onboard(page, { level: '초보' });
  await gymTab(page);
  await page.locator('.gym-here').getByRole('button', { name: '기구 고치기' }).click();

  // PT 스튜디오 — 스미스 · 케이블 · 덤벨 · TRX
  const chip = page.locator('dialog .chip-row .pick', { hasText: 'PT 스튜디오' });
  check(await chip.count() === 1, 'PT 스튜디오 유형이 없습니다');
  await chip.click();

  // 묶음 — 머신이 하체 · 상체로 갈리고, 유산소가 따로, 맨몸 · 소도구가 맨 뒤
  const heads = (await page.locator('dialog .equip-group-head .list-label').allTextContents()).map((text) => text.trim());
  for (const need of ['하체 머신', '상체 · 복근 머신', '유산소', '맨몸 · 소도구']) check(heads.includes(need), '묶음에 "' + need + '"가 없습니다: ' + heads.join(' / '));
  check(heads[heads.length - 1] === '맨몸 · 소도구', '맨몸 · 소도구가 맨 뒤가 아닙니다: ' + heads.join(' / '));
  check(!heads.some((text) => text.includes('머신 (앉아서')), '예전 "머신" 한 묶음이 남아 있습니다');

  // 기계가 제자리에 — 레그프레스는 하체, 체스트프레스는 상체
  check(await groupOf(page, '레그프레스') === '하체 머신', '레그프레스 묶음: ' + await groupOf(page, '레그프레스'));
  check(await groupOf(page, '체스트프레스 머신') === '상체 · 복근 머신', '체스트프레스 묶음: ' + await groupOf(page, '체스트프레스 머신'));
  check(await groupOf(page, '러닝머신') === '유산소', '러닝머신 묶음: ' + await groupOf(page, '러닝머신'));

  // TRX — 맨몸 · 소도구 묶음에, 켜진 채로, 한 줄 설명과 함께
  for (let i = 0; i < 8 && await page.locator('dialog .equip-more[aria-expanded="false"]').count(); i += 1) {
    await page.locator('dialog .equip-more[aria-expanded="false"]').first().click();
  }
  const trx = cellNamed(page, 'TRX \\(매달린 띠\\)');
  check(await trx.count() === 1, 'TRX 칸이 없습니다');
  check(await trx.locator('.equip-tile').getAttribute('aria-pressed') === 'true', 'PT 스튜디오인데 TRX가 꺼져 있습니다');
  check((await trx.locator('.what').textContent()).includes('몸을 기울여'), 'TRX 한 줄: ' + await trx.locator('.what').textContent());
  // 칸마다 한 줄 — 빈 칸이 없다
  const tiles = await page.locator('dialog .equip-tile').count();
  check(await page.locator('dialog .equip-tile .what').count() === tiles, '한 줄 설명이 없는 칸이 있습니다');

  // 크게 보기 — 무엇을 하는 기구인지 · 생김새 · 이 기구로 하는 운동
  await trx.locator('.equip-zoom-open').click();
  const zoom = page.locator('#equip-zoom');
  await zoom.waitFor();
  const text = (await zoom.innerText()).replace(/\s+/g, ' ');
  for (const need of ['TRX', '매달린 띠', '이렇게 생겼습니다', 'TRX 로우', 'TRX 체스트 프레스', '고무처럼 늘어나면 밴드']) {
    check(text.includes(need), '크게 보기에 "' + need + '"가 없습니다: ' + text);
  }
  await shot('1-trx-zoom-390');
  await zoom.locator('.equip-zoom-close').click();

  // 부위로 찾기 — "종아리"
  const search = page.locator('dialog input[placeholder^="이름이나 생김새로"]');
  await search.fill('종아리');
  const found = await page.locator('dialog .equip-tile .name').allTextContents();
  check(found.includes('카프레이즈 머신'), '"종아리"로 카프레이즈 머신이 안 나옵니다: ' + found.join(', '));
  await search.fill('TRX');
  check((await page.locator('dialog .equip-tile .name').allTextContents()).some((name) => name.startsWith('TRX')), 'TRX로 안 찾아집니다');
  await search.fill('');

  // 하체 머신 묶음이 보이게 두고 찍는다 — 390×844 · 360×640
  await page.locator('dialog .equip-group-head', { hasText: '하체 머신' }).scrollIntoViewIfNeeded();
  await shot('2-lower-390');
  await page.locator('dialog .equip-group-head', { hasText: '맨몸 · 소도구' }).scrollIntoViewIfNeeded();
  await shot('3-gear-390');
  await page.setViewportSize({ width: 360, height: 640 });
  await page.locator('dialog .equip-group-head', { hasText: '하체 머신' }).scrollIntoViewIfNeeded();
  await shot('4-lower-360');
  // 좁은 화면에서도 가로로 넘치지 않는다
  const overflow = await page.evaluate(() => {
    const list = document.getElementById('equipment-list');
    return list.scrollWidth - list.clientWidth;
  });
  check(overflow <= 1, '360px에서 기구 목록이 가로로 넘칩니다: ' + overflow);
  await trx.scrollIntoViewIfNeeded();
  await shot('5-gear-360');
}
