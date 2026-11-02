import { begin, check, onboard } from './lib.mjs';
export default async function ({ page, url }) {
  await page.clock.install({ time: new Date('2026-10-22T18:00:00+09:00') });
  await page.goto(url);
  await onboard(page);
  await begin(page);
  await page.locator('.warm-step').first().click();
  console.log('before', await page.locator('#stretch-left').textContent(), await page.locator('.stretch-now b').textContent());
  await page.locator('.stretch-go').click();
  console.log('after click', await page.locator('#stretch-left').textContent(), await page.locator('.stretch-go').count());
  await page.clock.runFor(1500);
  console.log('after run', await page.locator('#stretch-left').textContent());
  console.log(await page.evaluate(() => JSON.stringify(JSON.parse(localStorage.getItem('volume-coach.proto.state')).settings.mobility)));
}
