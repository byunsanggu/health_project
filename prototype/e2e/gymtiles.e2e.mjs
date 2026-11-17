// 기구 그림 칸 — 이름 아래 흔한 별명, "크게"를 누르면 큰 그림 · 이렇게 생겼습니다 · 이 기구로 하는 운동.
//   카탈로그의 모든 기구가 그림과 함께 나오고(빈 칸 없음), 밝은 화면 · 어두운 화면 전체 칸을 찍어 둔다.
import { join } from 'node:path';
import { check, gymTab, onboard } from './lib.mjs';

const cellNamed = (page, name) => page.locator('.equip-cell', { has: page.locator('.name', { hasText: new RegExp(`^${name}$`) }) });

export default async function ({ page, url, shot, out }) {
  await page.clock.install({ time: new Date('2026-10-22T18:00:00+09:00') });
  await page.goto(url);
  // 처음 설정은 헬스장을 묻지 않는다 — 기구 그림 칸은 내 정보 › 헬스장 › 기구 고치기에 있다
  await onboard(page, { level: '초보' });
  await gymTab(page);
  await page.locator('.gym-here').getByRole('button', { name: '기구 고치기' }).click();
  await page.locator('dialog .chip-row .pick', { hasText: '동네 헬스장' }).click();
  // 덜 흔한 기구까지 전부 펼친다
  for (let i = 0; i < 8 && await page.locator('.equip-more[aria-expanded="false"]').count(); i += 1) {
    await page.locator('.equip-more[aria-expanded="false"]').first().click();
  }
  const total = await page.evaluate(() => window.FitEngine.EQUIPMENT_CATALOG.length);
  check(await page.locator('.equip-tile').count() === total, '그림 칸이 ' + await page.locator('.equip-tile').count() + '개입니다 (카탈로그 ' + total + '개)');
  check(await page.locator('.equip-tile .equip-art-blank').count() === 0, '그림이 빈 칸이 있습니다');
  check(await page.locator('.equip-tile svg.equip-art').count() === total, '그림 없는 칸이 있습니다');
  // 칸마다 3D 그림 자리가 있다(받는 동안 · 못 받으면 위의 선 그림이 보인다 — 실제로 뜨는지는 thumbs.e2e)
  check(await page.locator('.equip-tile .equip-pic img.pic-img').count() === total, '3D 그림 자리가 없는 칸이 있습니다');
  // 그림에 강조색이 실제로 먹는다 (손 닿는 곳)
  const colors = await page.evaluate(() => {
    const key = document.querySelector('.equip-tile svg .k');
    const frame = document.querySelector('.equip-tile svg');
    return [getComputedStyle(key).stroke, getComputedStyle(frame).stroke];
  });
  check(colors[0] !== colors[1], '손 닿는 곳이 뼈대와 같은 색입니다: ' + colors.join(' / '));
  // 그림이 칸에서 충분히 크다
  const box = await page.locator('.equip-tile svg.equip-art').first().boundingBox();
  check(box.width >= 96, '그림이 작습니다: ' + box.width);

  // 이름 아래 별명
  const lat = cellNamed(page, '랫 풀다운');
  check((await lat.locator('.aka').textContent()).includes('위에서 당기는 기계'), '랫 풀다운 별명: ' + await lat.locator('.aka').textContent());
  check((await cellNamed(page, '펙덱 \\(플라이 머신\\)').locator('.aka').textContent()).includes('나비'), '펙덱 별명이 없습니다');
  await fullShot(page, out, 'grid-light');

  // 크게 — 켜고 끄지 않고 그림만 커진다
  const before = await lat.locator('.equip-tile').getAttribute('aria-pressed');
  await lat.locator('.equip-zoom-open').click();
  const zoom = page.locator('#equip-zoom');
  await zoom.waitFor();
  check(await lat.locator('.equip-tile').getAttribute('aria-pressed') === before, '크게를 눌렀는데 있음/없음이 바뀌었습니다');
  const text = (await zoom.innerText()).replace(/\s+/g, ' ');
  for (const need of ['랫 풀다운', '이렇게 생겼습니다', '허벅지', '이 기구로 하는 운동', '랫 풀다운']) {
    check(text.includes(need), '크게 보기에 "' + need + '"가 없습니다: ' + text);
  }
  const big = await zoom.locator('svg.equip-art').boundingBox();
  check(big.width >= 240, '크게 본 그림이 ' + big.width + 'px입니다');
  // 크게 보기는 3D 그림(큰 것)으로 뜬다
  await zoom.locator('.equip-pic.pic-on').waitFor();
  const bigPic = await zoom.locator('img.pic-img').evaluate((img) => [img.naturalWidth, img.getBoundingClientRect().width]);
  check(bigPic[0] >= 400 && bigPic[1] >= 240, '크게 본 3D 그림: ' + bigPic.join(' / '));
  await shot('zoom-light');
  // 여기서 바로 없음으로
  await zoom.locator('.finish').click();
  check(await page.locator('#equip-zoom').count() === 0, '누른 뒤에도 크게 보기가 남았습니다');
  check(await cellNamed(page, '랫 풀다운').locator('.equip-tile').getAttribute('aria-pressed') !== before, '크게 보기에서 눌러도 안 바뀝니다');
  // 헷갈리는 짝 — 레그 익스텐션에는 레그컬과 가르는 말이 있다
  await cellNamed(page, '레그 익스텐션').locator('.equip-zoom-open').click();
  check((await page.locator('#equip-zoom').innerText()).includes('발목 앞'), '레그 익스텐션을 가르는 말이 없습니다');
  await page.locator('#equip-zoom .equip-zoom-close').click();
  check(await page.locator('#equip-zoom').count() === 0, '닫기가 안 됩니다');

  // 어두운 화면
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
  await fullShot(page, out, 'grid-dark');
  await cellNamed(page, '레그프레스').locator('.equip-zoom-open').click();
  await shot('zoom-dark');
}

async function fullShot(page, out, name) {
  // 전체 칸을 한 장으로 — 목록이 화면보다 길어도 통째로 찍힌다
  await page.locator('#equipment-list').screenshot({ path: join(out, 'gymtiles-' + name + '.png') });
}
