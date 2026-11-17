// 3D 썸네일 — 기구 칸 · 크게 보기 · 종목 고르기 목록 · 오늘 목록에 구워 둔 3D 그림이 실제로 뜬다.
//   그림을 못 받으면(막아 둔다) 예전 선 그림이 그대로 보인다.
import { check, gymTab, onboard, FAKE_SPEECH, todayDetail } from './lib.mjs';

const cellNamed = (page, name) => page.locator('.equip-cell', { has: page.locator('.name', { hasText: new RegExp(`^${name}`) }) });
const loaded = (locator) => locator.evaluate((img) => new Promise((done) => {
  const ok = () => done(img.complete && img.naturalWidth > 0 ? img.naturalWidth : 0);
  if (img.complete) ok(); else { img.addEventListener('load', ok); img.addEventListener('error', () => done(0)); }
}));

async function toGymTiles(page, url) {
  await page.goto(url);
  // 처음 설정은 헬스장을 묻지 않는다 — 기구 그림 칸은 내 정보 › 헬스장 › 기구 고치기에 있다
  await onboard(page, { level: '초보' });
  await gymTab(page);
  await page.locator('.gym-here').getByRole('button', { name: '기구 고치기' }).click();
  await page.locator('dialog .chip-row .pick', { hasText: '동네 헬스장' }).click();
  for (let i = 0; i < 8 && await page.locator('.equip-more[aria-expanded="false"]').count(); i += 1) {
    await page.locator('.equip-more[aria-expanded="false"]').first().click();
  }
}

const OPTS = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'ko-KR', timezoneId: 'Asia/Seoul' };
async function freshContext(browser, extra) {
  const context = await browser.newContext({ ...OPTS, ...extra });
  await context.addInitScript(FAKE_SPEECH);
  await context.route('**/vendor/three.min.js', (route) => route.abort());
  return context;
}

export default async function ({ page, url, shot, out }) {
  const browser = page.context().browser();
  await page.clock.install({ time: new Date('2026-10-22T18:00:00+09:00') });
  await toGymTiles(page, url);

  // 기구 칸 — 화면에 들어오면 받는다(lazy). 흔한 것 · 작은 도구 · 운동이 없는 기구까지
  for (const name of ['랫 풀다운', '레그프레스', '스미스머신', '덤벨', '케틀벨', '폼롤러']) {
    const cell = cellNamed(page, name).first();
    check(await cell.count() === 1, name + ' 칸이 없습니다');
    await cell.scrollIntoViewIfNeeded();
    const img = cell.locator('.equip-tile .equip-pic img.pic-img');
    check(await img.count() === 1, name + ' 칸에 3D 그림 자리가 없습니다');
    check(await img.getAttribute('loading') === 'lazy' && await img.getAttribute('decoding') === 'async', name + ': lazy/async가 아닙니다');
    check(Number(await img.getAttribute('width')) > 0 && Number(await img.getAttribute('height')) > 0, name + ': width/height가 없습니다');
    check(await loaded(img) > 0, name + ' 3D 그림이 안 떴습니다');
    await cell.locator('.equip-pic.pic-on').waitFor();
    // 그림이 뜨면 선 그림은 가린다(자리는 그대로)
    check(await cell.locator('svg.equip-art').evaluate((svg) => getComputedStyle(svg).visibility) === 'hidden', name + ': 선 그림이 3D 그림과 겹쳐 보입니다');
    const box = await img.boundingBox();
    check(box.width >= 96 && Math.abs(box.width - box.height) < 2, name + ' 그림 크기: ' + box.width + '×' + box.height);
  }
  await cellNamed(page, '랫 풀다운').first().scrollIntoViewIfNeeded();
  await shot('1-tiles');

  // 크게 — 큰 그림(420px)을 받는다
  await cellNamed(page, '레그프레스').first().locator('.equip-zoom-open').click();
  const zoomImg = page.locator('#equip-zoom .equip-pic img.pic-img');
  check(await loaded(zoomImg) >= 400, '크게 본 그림이 큰 그림이 아닙니다: ' + await loaded(zoomImg));
  check((await zoomImg.boundingBox()).width >= 240, '크게 본 그림이 작습니다');
  await shot('2-zoom');
  await page.locator('#equip-zoom .equip-zoom-close').click();

  // 어두운 화면에서도 같은 그림(바탕만 바뀐다)
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
  await shot('3-tiles-dark');
  await page.evaluate(() => document.documentElement.removeAttribute('data-theme'));

  // 그림을 못 받는 곳 — 선 그림이 그대로 보인다
  const blocked = await freshContext(browser, { serviceWorkers: 'block' });
  await blocked.route('**/thumbs/**', (route) => route.abort());
  const page2 = await blocked.newPage();
  await toGymTiles(page2, url);
  const cell2 = cellNamed(page2, '랫 풀다운').first();
  await cell2.scrollIntoViewIfNeeded();
  await page2.waitForFunction(() => {
    const cells = Array.from(document.querySelectorAll('.equip-cell')).filter((c) => /^랫 풀다운/.test(c.querySelector('.name').textContent));
    return cells.length > 0 && !cells[0].querySelector('img.pic-img');
  });
  check(await cell2.locator('.pic-on').count() === 0, '그림을 못 받았는데 받은 것처럼 표시됩니다');
  check(await cell2.locator('svg.equip-art').evaluate((svg) => getComputedStyle(svg).visibility) === 'visible', '그림을 못 받았을 때 선 그림이 안 보입니다');
  check((await cell2.locator('svg.equip-art').boundingBox()).width >= 96, '대신 보이는 선 그림이 작습니다');
  await page2.screenshot({ path: (out || process.env.E2E_OUT || '.') + '/thumbs-4-fallback.png' }).catch(() => {});
  await blocked.close();

  // 종목 고르기 목록 · 오늘 목록
  const context3 = await freshContext(browser);
  const page3 = await context3.newPage();
  await page3.clock.install({ time: new Date('2026-10-22T18:00:00+09:00') });
  await page3.goto(url);
  await onboard(page3);
  const today = page3.locator('.plan-row .lift-thumb img.pic-img').first();
  check(await loaded(today) > 0, '오늘 목록에 3D 그림이 안 떴습니다');
  await todayDetail(page3); // 세트 · ⋯ · 편집은 오늘 › 자세히 보기 안에
  await page3.locator('.list-edit').click();
  await page3.locator('.head-actions .demo-open', { hasText: '종목 추가' }).click();
  // 오늘 이미 하는 종목(랫 풀다운 등)은 고르기 목록에 없다 — 오늘 목록 쪽에서 본다
  const planned = page3.locator('.plan-row', { hasText: '랫 풀다운' }).first();
  if (await planned.count()) check(await loaded(planned.locator('.lift-thumb img.pic-img')) > 0, '오늘 목록의 랫 풀다운 그림이 안 떴습니다');
  for (const name of ['레그프레스', '덤벨 컬', '케틀벨 스윙', '스미스']) {
    // 긴 목록 아래쪽 줄은 화면에 들어올 때 받는다
    const row = page3.locator('dialog .add-lift-row', { hasText: new RegExp('^' + name) }).first();
    await row.scrollIntoViewIfNeeded();
    const img = row.locator('.lift-thumb img.pic-img');
    check(await img.count() === 1, name + ' 줄에 그림 자리가 없습니다');
    check(await img.getAttribute('loading') === 'lazy' && Number(await img.getAttribute('width')) > 0, name + ' 줄: lazy · 크기 속성이 없습니다');
    check(await loaded(img) > 0, name + ' 줄 그림이 안 떴습니다');
    const thumb = await row.locator('.lift-thumb').boundingBox();
    const nameBox = await row.locator('.name').boundingBox();
    check(thumb.width >= 50 && thumb.x < nameBox.x, name + ' 줄: 그림이 이름 왼쪽에 크게 있어야 합니다');
  }
  await page3.screenshot({ path: (out || process.env.E2E_OUT || '.') + '/thumbs-5-picker.png' }).catch(() => {});
  await context3.close();
}
