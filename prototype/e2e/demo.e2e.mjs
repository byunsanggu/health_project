// 동작 시연 — 종목마다 자기 동작이 돌고, 멈추고, 보는 쪽을 고르고, 흔한 실수를 동작으로 본 뒤
//   바른 동작으로 돌아온다. 입체(three.js)로 뜨든 평면으로 떨어지든 같은 길이어야 한다.
//   E2E_THREE에 three.min.js 경로를 주면 CDN이 막힌 곳에서도 입체로 본다 (run.mjs 참고).
import { check, onboard } from './lib.mjs';

/**
 * 시연 그림을 읽는다 — 빨간(실수) 화소 수와 그림 전체의 지문. 그림 위 글씨(실수 띠 · 안내)는
 * 캔버스 밖이라 섞이지 않는다. WebGL은 그린 뒤 버퍼를 비우므로, 테스트에서만 버퍼를 남기게
 * 해 두고(아래 initScript) 읽는다. 소프트웨어 WebGL에서는 한 번 읽는 데 1~2초가 걸려서
 * 꼭 필요한 곳에서만 읽는다 (화면 사진은 한 장에 10초가 넘어 쓰지 않는다).
 */
function read(page) {
  return page.evaluate(() => {
    const src = document.querySelector('dialog .demo-canvas');
    const copy = document.createElement('canvas');
    copy.width = src.width;
    copy.height = src.height;
    const ctx = copy.getContext('2d');
    ctx.drawImage(src, 0, 0);
    const { data } = ctx.getImageData(0, 0, copy.width, copy.height);
    let red = 0;
    let hash = 0;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      if (r > 150 && r > g + 70 && r > b + 70) red += 1;
      hash = (hash * 31 + r * 7 + g * 3 + b) % 2147483647;
    }
    return { red, hash };
  });
}

export default async function ({ page, url, shot }) {
  await page.addInitScript(() => {
    // 소프트웨어 WebGL은 한 장 그리는 데 오래 걸린다 — 테스트에서는 화소를 1배로
    Object.defineProperty(window, 'devicePixelRatio', { get: () => 1, configurable: true });
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, options) {
      if (/webgl/.test(type)) return original.call(this, type, { ...(options || {}), preserveDrawingBuffer: true });
      return original.call(this, type, options);
    };
  });
  await page.clock.install({ time: new Date('2026-10-22T18:00:00+09:00') });
  await page.goto(url);
  await onboard(page);

  /** 그림을 ms만큼 돌린다 — 50ms씩 건너뛰어 그 사이 한 장씩만 그린다 */
  const advance = async (ms) => {
    for (let spent = 0; spent < ms; spent += 50) await page.clock.fastForward(50);
  };

  await page.locator('.plan-row .row-menu').first().click();
  await page.locator('dialog .menu-row', { hasText: '동작 시연' }).click();
  await page.locator('dialog .demo-canvas').waitFor();
  await advance(100);

  const note = (await page.locator('dialog .demo-note').textContent()).trim();
  const three = note.includes('3D 모형');
  check(three || note.includes('평면'), '입체인지 평면인지 알리는 말이 없습니다: ' + note);
  // three.js를 대 줬으면 입체로 떠야 한다 — integrity · CORS가 어긋나면 여기서 잡힌다
  if (process.env.E2E_THREE) check(three, 'three.js를 줬는데 입체로 뜨지 않았습니다: ' + note);
  check(await page.locator('dialog .demo-hint:not(.gone)').count() === (three ? 1 : 0), '돌려 보기 안내는 입체일 때만');
  // "1회 3초" — 한 번 하는 데 걸리는 초
  const cycle = Number(((await page.locator('dialog .demo-controls .spacer').textContent()).match(/([\d.]+)초/) || [])[1]);
  check(cycle >= 1 && cycle <= 5, '한 번 걸리는 시간이 이상합니다: ' + cycle);

  // 빠르기 — 1.5배로 두고 본다 (한 바퀴를 덜 그린다)
  await page.locator('dialog .demo-controls .chip', { hasText: '1.5×' }).click();
  check(await page.locator('dialog .demo-controls .chip[aria-pressed="true"]', { hasText: '1.5×' }).count() === 1, '빠르기 칩이 안 눌립니다');
  const lap = (cycle / 1.5) * 1000;

  // 돌고 있다 — 구간 이름이 뜨고, 그림이 바뀐다. 바른 동작에는 빨간 근육이 없다
  check((await page.locator('dialog .demo-caption').textContent()).trim().length > 0, '지금 구간 이름이 없습니다');
  const first = await read(page);
  await advance(250);
  const moved = await read(page);
  check(moved.hash !== first.hash, '시연이 움직이지 않습니다');
  check(first.red < 5 && moved.red < 5, '바른 동작인데 빨간 근육이 있습니다');
  if (!three) await shot('1-2d');

  // 일시정지 — 멈춘 그림은 그대로. 재생 버튼은 빠르기 칩 앞 첫 칩 (글자가 바뀌므로 글자로 찾지 않는다)
  const play = page.locator('dialog .demo-controls').first().locator('.chip').first();
  check((await play.textContent()).trim() === '일시정지', '처음엔 돌고 있어야 합니다');
  await play.click();
  check((await play.textContent()).trim() === '재생', '일시정지 버튼이 재생으로 안 바뀝니다');
  await advance(100);
  const still = (await read(page)).hash;
  await advance(250);
  check((await read(page)).hash === still, '멈췄는데 그림이 움직입니다');

  // 보는 쪽 — 옆을 고르면 그 칩만 눌리고, 그림이 옆에서 본 모습으로 바뀐다
  check(await page.locator('dialog .demo-views .chip').count() === 5, '보는 쪽 칩이 처음 · 정면 · 옆 · 사선 · 뒤가 아닙니다');
  await page.locator('dialog .demo-views .chip', { hasText: '옆' }).click();
  await advance(400);
  const pressed = await page.locator('dialog .demo-views .chip[aria-pressed="true"]').allTextContents();
  check(pressed.length === 1 && pressed[0].trim() === '옆', '눌린 보는 쪽: ' + pressed.join(','));
  check((await read(page)).hash !== still, '옆을 골랐는데 그림이 그대로입니다');
  await play.click();
  check((await play.textContent()).trim() === '일시정지', '다시 재생이 안 됩니다');

  // 흔한 실수를 동작으로 — 위에 띠가 뜨고, 힘쓰는 구간에서 근육이 빨갛게 빛난다
  const shows = page.locator('dialog .mistake-show');
  check(await shows.count() > 0, '실수 동작 보기 버튼이 없습니다');
  await shows.first().click();
  const banner = page.locator('dialog .demo-fault');
  await banner.waitFor({ state: 'visible' });
  check((await banner.textContent()).includes('흔한 실수'), '실수 띠에 흔한 실수라는 말이 없습니다');
  check(await page.locator('dialog .demo-stage.fault').count() === 1, '실수 동작인데 무대 표시가 그대로입니다');
  // 실수 동작은 처음부터 다시 돈다 — 한 바퀴를 몇 군데 끊어 본다
  let red = 0;
  let spent = 0;
  for (const at of [0.25, 0.5, 0.7, 0.85, 1]) {
    await advance(lap * at - spent);
    spent = lap * at;
    red = Math.max(red, (await read(page)).red);
    if (red >= 20) break;
  }
  check(red >= 20, `실수 동작인데 근육이 빨개지지 않습니다 (${red})`);
  if (!three) await shot('2-fault');

  // 바른 동작으로 — 띠는 사라지고 색도 돌아온다
  await page.locator('dialog .demo-fault-back').click();
  check(await banner.isHidden(), '바른 동작을 눌렀는데 실수 띠가 남았습니다');
  check(await page.locator('dialog .demo-stage.fault').count() === 0, '바른 동작인데 무대가 실수 표시입니다');
  await advance(lap * 0.7);
  check((await read(page)).red < 5, '바른 동작으로 돌아왔는데 빨간 근육이 남았습니다');

  // 닫고 다른 종목을 열어도 오류 없이 돈다
  await page.locator('dialog .modal-close').click();
  await advance(200);
  await page.locator('.plan-row .row-menu').nth(1).click();
  await page.locator('dialog .menu-row', { hasText: '동작 시연' }).click();
  await page.locator('dialog .demo-canvas').waitFor();
  await advance(200);
  check((await page.locator('dialog .demo-caption').textContent()).trim().length > 0, '두 번째 종목 시연이 돌지 않습니다');
}
