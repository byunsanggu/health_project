// body.html을 헤드리스 크롬으로 그려 PNG 한 장으로 남긴다.
//   node tools/body3d/render.mjs out.png view=front w=300 h=600 ss=2 m=1,0,0.5,...
import { chromium } from '../../prototype/e2e/lib.mjs';
import { fileURLToPath } from 'node:url';

const [out, ...rest] = process.argv.slice(2);
const params = new URLSearchParams(rest.join('&'));
const url = 'file://' + fileURLToPath(new URL('./body.html', import.meta.url)) + '?' + params.toString();
const browser = await (await chromium()).launch();
const page = await browser.newPage({ viewport: { width: Number(params.get('w') || 300), height: Number(params.get('h') || 600) } });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
await page.goto(url);
await page.waitForFunction(() => window.done === true, null, { timeout: 600000 });
console.log('render ms', Math.round(await page.evaluate(() => window.renderMs)));
await page.locator('#c').screenshot({ path: out, omitBackground: true });
await browser.close();
