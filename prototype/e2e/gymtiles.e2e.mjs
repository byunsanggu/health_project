// 기구 그림 칸 — 이름 아래 흔한 별명, "크게"를 누르면 큰 그림 · 이렇게 생겼습니다 · 이 기구로 하는 운동.
//   카탈로그의 모든 기구가 그림과 함께 나오고(빈 칸 없음), 밝은 화면 · 어두운 화면 전체 칸을 찍어 둔다.
import { join } from 'node:path';
import { check, pickMe } from './lib.mjs';

const cellNamed = (page, name) => page.locator('.equip-cell', { has: page.locator('.name', { hasText: new RegExp(`^${name}$`) }) });

export default async function ({ page, url, shot, out }) {
  await page.clock.install({ time: new Date('2026-10-22T18:00:00+09:00') });
  await page.goto(url);
  await page.waitForSelector('.consent-card');
  const cards = page.locator('.consent-card');
  for (let i = 0; i < await cards.count(); i += 1) {
    if (await cards.nth(i).locator('.consent-tag.req').count()) await cards.nth(i).locator('.consent-toggle').click();
  }
  for (let i = 0; i < 6; i += 1) {
    const step = (await page.locator('.session-head h2').textContent()).trim();
    if (step === '헬스장') break;
    if (step === '나에 대해') await pickMe(page, { level: '초보' });
    await page.locator('.wizard-nav .primary').click();
  }
  await page.locator('.chip-row .pick', { hasText: '동네 헬스장' }).click();
  await page.locator('.equip-toggle').click();
  // 덜 흔한 기구까지 전부 펼친다
  for (let i = 0; i < 8 && await page.locator('.equip-more[aria-expanded="false"]').count(); i += 1) {
    await page.locator('.equip-more[aria-expanded="false"]').first().click();
  }
  const total = await page.evaluate(() => window.FitEngine.EQUIPMENT_CATALOG.length);
  check(await page.locator('.equip-tile').count() === total, '그림 칸이 ' + await page.locator('.equip-tile').count() + '개입니다 (카탈로그 ' + total + '개)');
  check(await page.locator('.equip-tile .equip-art-blank').count() === 0, '그림이 빈 칸이 있습니다');
  check(await page.locator('.equip-tile svg.equip-art').count() === total, '그림 없는 칸이 있습니다');
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
