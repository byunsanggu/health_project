// 3D 근육 그림 — 오늘 목록의 썸네일이 입체 그림으로 바뀌고(평면 그림은 장을 읽기 전 잠깐만),
//   주로 쓰는 근육이 실제로 칠해진다. 동작 시연의 "쓰는 근육"은 앞 · 뒤 전신 한 쌍.
import { check, onboard } from './lib.mjs';

/** 캔버스에서 칠한 색(파란 보라)이 든 화소 수 */
async function painted(locator) {
  return locator.evaluate((canvas) => {
    const { data } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
    let count = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] > 200 && data[i + 2] > data[i] + 50 && data[i + 2] > data[i + 1] + 50) count += 1;
    }
    return count;
  });
}

export default async function ({ page, url, shot }) {
  await page.clock.install({ time: new Date('2026-10-22T18:00:00+09:00') });
  await page.goto(url);
  await onboard(page);
  await page.waitForFunction(() => document.querySelectorAll('.lift-thumb.three canvas').length > 0);

  const lifts = await page.locator('.plan-row .row-menu').count();
  check(await page.locator('.lift-thumb.three canvas').count() === lifts, '입체 썸네일 수가 종목 수와 다릅니다');
  check(await page.locator('.lift-thumb .thumb-body').count() === 0, '평면 그림이 남아 있습니다');
  const first = page.locator('.lift-thumb.three canvas').first();
  check(await painted(first) > 40, '첫 종목 썸네일에 칠한 근육이 없습니다');
  await shot('1-list');

  // 동작 시연 › 쓰는 근육 — 앞 · 뒤 두 장, 벤치프레스는 앞(가슴)이 더 칠해진다
  await page.locator('.plan-row .row-menu').first().click();
  await page.locator('dialog .menu-row', { hasText: '동작 시연' }).click();
  const pair = page.locator('dialog .body3d-pair canvas');
  await pair.first().waitFor();
  check(await pair.count() === 2, '앞 · 뒤 그림이 두 장이 아닙니다');
  const front = await painted(pair.nth(0));
  const back = await painted(pair.nth(1));
  check(front > 200 && front > back, `앞(가슴) ${front} · 뒤 ${back} — 벤치프레스인데 앞이 덜 칠해졌습니다`);
  await page.locator('dialog .body3d-pair').scrollIntoViewIfNeeded();
  await shot('2-demo');
}
