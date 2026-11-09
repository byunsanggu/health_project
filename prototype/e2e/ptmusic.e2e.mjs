// PT 중에 듣던 음악이 끊기지 않는다 — 화면이 켜져 있는 동안은 <audio>로 소리를 내지 않는다(코치 목소리는 Web Audio).
//   예전에는 1세트가 끝나 휴식이 시작되면 휴식 끝 소리(<audio>)를 틀어서 폰이 스포티파이 · 유튜브 뮤직을 멈췄다.
//   쉬는 중에 화면이 꺼지면 그때 튼다(잠금 화면에서도 휴식 끝 · 코치 소리가 나오게).
import { begin, check, choosePt, onboard, runUntil, setVisible } from './lib.mjs';

export default async function ({ page, url }) {
  await page.addInitScript(() => {
    window.__plays = [];
    HTMLMediaElement.prototype.play = function () {
      window.__plays.push({ muted: this.muted, src: this.src });
      return Promise.resolve();
    };
    HTMLMediaElement.prototype.pause = function () {};
  });
  await page.clock.install({ time: new Date('2026-10-22T18:00:00+09:00') });
  await page.goto(url);
  await onboard(page);
  await choosePt(page);
  await begin(page);
  await runUntil(page, 'prep');
  await page.locator('#focus .focus-btn', { hasText: '몸 풀기 건너뛰기' }).click();
  if (await runUntil(page, ['warm', 'count']) === 'warm') {
    await page.locator('#focus .focus-btn', { hasText: '워밍업 건너뛰기' }).click();
    await runUntil(page, 'count');
  }
  for (let i = 0; i < 120 && !/^\d+$/.test(await page.locator('#focus-num').textContent().catch(() => '')); i += 1) await page.clock.runFor(500);
  await page.locator('#focus .focus-btn', { hasText: '여기까지' }).click();
  await runUntil(page, 'rest');
  await page.clock.runFor(5000);
  const loud = () => page.evaluate(() => window.__plays.filter((one) => !one.muted).length);
  check(await loud() === 0, '화면이 켜진 채 쉬는데 <audio>를 틀었습니다 — 듣던 음악이 멈춥니다');
  await setVisible(page, false);
  check(await loud() >= 1, '쉬는 중에 화면을 껐는데 휴식 끝 소리를 안 틀었습니다');
  await setVisible(page, true);
}
