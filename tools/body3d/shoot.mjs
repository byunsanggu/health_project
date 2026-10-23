// 시안 페이지의 한 부분을 폰 크기(390px)로 찍는다.
//   node tools/body3d/shoot.mjs out.png '#part-list' [light|dark]
import { chromium } from '../../prototype/e2e/lib.mjs';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const [out, selector, scheme] = process.argv.slice(2);
const browser = await (await chromium()).launch();
const page = await browser.newPage({ viewport: { width: 390, height: 800 }, deviceScaleFactor: 3, colorScheme: scheme || 'light' });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
await page.goto('file://' + HERE + 'out/preview.html');
await page.waitForFunction(() => window.ready === true);
await page.waitForTimeout(300);
await page.locator(selector || '.pv').screenshot({ path: out });
await browser.close();
