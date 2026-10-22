/**
 * 브라우저 테스트 실행기.
 *
 *   node prototype/build.mjs && node prototype/e2e/run.mjs          전부
 *   node prototype/e2e/run.mjs foodlog                              이름에 foodlog가 든 것만
 *
 * 각 테스트는 `이름.e2e.mjs`에서 `export default async function (t)`로
 * 만든다. t에는 page(폰 크기 · 한국어 · 가짜 음성), url, shot(이름)이 있다.
 * 찍은 화면은 E2E_OUT(없으면 임시 폴더)에 남는다.
 */
import { readdir, readFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FAKE_SPEECH, chromium, serve } from './lib.mjs';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const OUT = process.env.E2E_OUT || join(tmpdir(), 'volume-coach-e2e');
const filters = process.argv.slice(2);

const html = await readFile(new URL('../dist/index.html', import.meta.url), 'utf8');
if (/__VOLUME_COACH_SERVER__=\{/.test(html)) {
  console.error('dist에 서버 주소가 들어 있습니다. 서버 없이 다시 빌드하세요: node prototype/build.mjs');
  process.exit(2);
}

const files = (await readdir(HERE))
  .filter((name) => name.endsWith('.e2e.mjs'))
  .filter((name) => filters.length === 0 || filters.some((f) => name.includes(f)))
  .sort();
await mkdir(OUT, { recursive: true });

const server = await serve();
const browser = await (await chromium()).launch();
let failed = 0;

for (const name of files) {
  const label = name.replace('.e2e.mjs', '');
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'ko-KR', timezoneId: 'Asia/Seoul',
  });
  await context.addInitScript(FAKE_SPEECH);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
  const t = {
    page, context, url: server.url,
    shot: (what) => page.screenshot({ path: join(OUT, `${label}-${what}.png`) }),
  };
  const started = Date.now();
  try {
    const run = (await import(join(HERE, name))).default;
    await Promise.race([
      run(t),
      new Promise((_, reject) => setTimeout(() => reject(new Error('90초 안에 끝나지 않았습니다')), 90000)),
    ]);
    if (errors.length) throw new Error('페이지 오류: ' + errors.join(' | '));
    console.log(`ok   ${label} (${((Date.now() - started) / 1000).toFixed(1)}s)`);
  } catch (err) {
    failed += 1;
    await page.screenshot({ path: join(OUT, `${label}-FAILED.png`) }).catch(() => {});
    console.log(`FAIL ${label}: ${err.message.split('\n')[0]}`);
  }
  await context.close();
}

await browser.close();
await server.close();
console.log(`${files.length - failed}/${files.length} 통과 · 화면: ${OUT}`);
process.exit(failed ? 1 : 0);
