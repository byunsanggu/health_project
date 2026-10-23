// 앱에 싣는 3D 몸 그림 장(層)을 그린다 → prototype/body3d/*.png
//
//   node tools/body3d/layers.mjs
//
// 구도 하나마다 PNG 한 장. 위 절반은 빛 장, 아래 절반은 근육 칸 장이다.
//   위:   R = √(몸 색에 곱할 빛 / 1.4) · G = 더할 빛(테두리 · 반짝임) / 0.5 · B = 덮인 정도(가장자리 계단 없애기)
//   아래: R · G = 표면에 가장 가까운 근육 둘 — 번호 × 16 + 가까운 정도(0~15). 15번은 "근육 없음"
// 투명도를 쓰지 않는다 — 브라우저가 반투명 화소를 그릴 때 값을 반올림해서 근육 번호가 깨진다.
import { chromium } from '../../prototype/e2e/lib.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const OUT = fileURLToPath(new URL('../../prototype/body3d/', import.meta.url));
mkdirSync(OUT, { recursive: true });

/*
 * 썸네일(46px 칸, 3배)은 상반신 · 하반신만 크게 살짝 돌려서, 자세히 보기는 전신을 정면으로.
 * 종목이 어느 구도를 쓰는지는 앱(bodyMap3d.js)이 기여도로 고른다.
 */
const FRAMINGS = [
  { name: 'upper-front', view: 'front', w: 138, h: 138, frame: '1.29,1.06', yaw: -10 },
  { name: 'upper-back', view: 'back', w: 138, h: 138, frame: '1.29,1.06', yaw: -10 },
  { name: 'lower-front', view: 'front', w: 138, h: 138, frame: '0.50,1.08', yaw: -10 },
  { name: 'lower-back', view: 'back', w: 138, h: 138, frame: '0.50,1.08', yaw: -10 },
  { name: 'full-front', view: 'front', w: 360, h: 720, frame: '0.885,1.846', yaw: 0 },
  { name: 'full-back', view: 'back', w: 360, h: 720, frame: '0.885,1.846', yaw: 0 },
];

const browser = await (await chromium()).launch();
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));

async function raw(f, mode, ss) {
  const q = new URLSearchParams({ view: f.view, w: f.w, h: f.h, frame: f.frame, yaw: f.yaw, mode, ss });
  await page.setViewportSize({ width: f.w, height: f.h });
  await page.goto('file://' + HERE + 'body.html?' + q.toString());
  await page.waitForFunction(() => window.done === true, null, { timeout: 600000 });
  return Buffer.from(await page.evaluate(() => window.readRaw()), 'base64');
}

for (const f of FRAMINGS) {
  const light = await raw(f, 1, 3);
  const muscle = await raw(f, 2, 1);
  const rgb = Buffer.alloc(f.w * f.h * 2 * 3);
  for (let i = 0; i < f.w * f.h; i += 1) {
    const a = light[i * 4 + 3];
    rgb[i * 3] = a ? light[i * 4] : 0;
    rgb[i * 3 + 1] = a ? light[i * 4 + 1] : 0;
    rgb[i * 3 + 2] = a;
    const j = (f.w * f.h + i) * 3;
    const hit = muscle[i * 4 + 3] > 0;
    rgb[j] = hit ? muscle[i * 4] : 240;
    rgb[j + 1] = hit ? muscle[i * 4 + 1] : 240;
    rgb[j + 2] = 0;
  }
  const png = encodePng(f.w, f.h * 2, rgb);
  writeFileSync(OUT + f.name + '.png', png);
  console.log(f.name, f.w + '×' + f.h * 2, (png.length / 1024).toFixed(1) + 'KB');
}
await browser.close();

/* ── PNG (RGB 8비트) ── 줄마다 다섯 필터 중 가장 작게 줄어드는 것을 고른다 */
function encodePng(width, height, data) {
  const stride = width * 3;
  const out = Buffer.alloc((stride + 1) * height);
  const prev = Buffer.alloc(stride);
  const cand = [0, 1, 2, 3, 4].map(() => Buffer.alloc(stride));
  for (let y = 0; y < height; y += 1) {
    const row = data.subarray(y * stride, (y + 1) * stride);
    const up = y ? data.subarray((y - 1) * stride, y * stride) : prev;
    for (let x = 0; x < stride; x += 1) {
      const a = x >= 3 ? row[x - 3] : 0;
      const b = up[x];
      const c = x >= 3 ? up[x - 3] : 0;
      const p = a + b - c;
      const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      const paeth = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      cand[0][x] = row[x];
      cand[1][x] = (row[x] - a) & 255;
      cand[2][x] = (row[x] - b) & 255;
      cand[3][x] = (row[x] - ((a + b) >> 1)) & 255;
      cand[4][x] = (row[x] - paeth) & 255;
    }
    let best = 0, bestSum = Infinity;
    for (let k = 0; k < 5; k += 1) {
      let sum = 0;
      for (let x = 0; x < stride; x += 1) { const v = cand[k][x]; sum += v < 128 ? v : 256 - v; }
      if (sum < bestSum) { bestSum = sum; best = k; }
    }
    out[y * (stride + 1)] = best;
    cand[best].copy(out, y * (stride + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(out, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
  ]);
}

function chunk(type, body) {
  const len = Buffer.alloc(4); len.writeUInt32BE(body.length);
  const tb = Buffer.concat([Buffer.from(type, 'ascii'), body]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(tb));
  return Buffer.concat([len, tb, crc]);
}

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i += 1) {
    c ^= buf[i];
    for (let k = 0; k < 8; k += 1) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}
