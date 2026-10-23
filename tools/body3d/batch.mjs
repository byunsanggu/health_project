// 시안 그림을 한꺼번에 그린다 — 썸네일(상반신 · 하반신)과 자세히 보기(앞 · 뒤 전신).
//
//   node tools/body3d/contrib.ts barbell-bench-press pull-up ... > tools/body3d/out/contrib.json
//   node tools/body3d/batch.mjs                         밝은 화면용 → out/light
//   THEME=dark node tools/body3d/batch.mjs               어두운 화면용 → out/dark
import { chromium } from '../../prototype/e2e/lib.mjs';
import { readFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const THEME = process.env.THEME === 'dark' ? 'dark' : 'light';
const OUT = HERE + 'out/' + THEME + '/';
mkdirSync(OUT, { recursive: true });
const contrib = JSON.parse(readFileSync(HERE + 'out/contrib.json', 'utf8'));

// 앱의 색 토큰과 맞춘다 — 밝은 화면 accent #4540c9 · 어두운 화면 #8b87ff 계열
const COLORS = { light: { accent: '4c46d6', clay: 'd9dce3' }, dark: { accent: '7f79ff', clay: '9aa1ae' } }[THEME];

// 정면에 보이는 근육 · 위쪽 근육 (엔진 MUSCLE_GROUPS 순서)
const FRONT = [1, 0, 1, 1, 0, 0, 1, 0, 1, 1, 0, 0, 0, 1];
const UPPER = [1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 1];
const level = (x) => (x > 0 ? 0.25 + 0.75 * Math.min(1, x) : 0);
/*
 * 엔진의 '등'은 광배근과 허리를 한 칸에 둔다. 엉덩이를 접는 종목(데드리프트 · 굿모닝 ·
 * 백 익스텐션)의 '등'은 허리이고, 당기는 종목의 '등'은 광배근이다 — 동작에 따라 나눠 칠한다.
 * 그림 쪽 15번 칸이 허리(척추기립근)다.
 */
const paint = (w, pattern) => {
  const out = w.slice();
  if (pattern === 'hinge') { out[14] = w[1]; out[1] = 0; } else { out[14] = 0; }
  return out.map((x) => level(x).toFixed(3)).join(',');
};
const sum = (w, mask, want) => w.reduce((s, x, i) => s + (mask[i] === want ? x : 0), 0);

const jobs = [];
for (const [id, { w, pattern }] of Object.entries(contrib)) {
  const view = sum(w, FRONT, 0) > sum(w, FRONT, 1) ? 'back' : 'front';
  const upper = sum(w, UPPER, 1) >= sum(w, UPPER, 0);
  jobs.push({
    file: `thumb-${id}.png`,
    q: { view, w: 138, h: 138, ss: 3, fiber: 0, m: paint(w, pattern), ...COLORS, yaw: -10, frame: upper ? '1.29,1.06' : '0.50,1.08' },
  });
}
for (const id of (process.env.DETAIL || 'barbell-bench-press,romanian-deadlift').split(',')) {
  if (!contrib[id]) continue;
  for (const view of ['front', 'back']) {
    jobs.push({ file: `detail-${id}-${view}.png`, q: { view, w: 480, h: 960, ss: 3, fiber: 1, m: paint(contrib[id].w, contrib[id].pattern), ...COLORS } });
  }
}

const browser = await (await chromium()).launch();
const page = await browser.newPage({ viewport: { width: 480, height: 960 } });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
for (const job of jobs) {
  const url = 'file://' + HERE + 'body.html?' + new URLSearchParams(Object.entries(job.q).map(([k, v]) => [k, String(v)])).toString();
  await page.setViewportSize({ width: job.q.w, height: job.q.h });
  await page.goto(url);
  await page.waitForFunction(() => window.done === true, null, { timeout: 600000 });
  await page.locator('#c').screenshot({ path: OUT + job.file, omitBackground: true });
  console.log(THEME, job.file, Math.round(await page.evaluate(() => window.renderMs)) + 'ms');
}
await browser.close();
