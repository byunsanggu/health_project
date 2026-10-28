// 화면 꺼도 휴식 끝 소리 — 세트를 끝내면 "휴식 길이만큼 무음 + 알림음" 소리 파일을 틀어 둔다
//   (잠금 화면에서도 재생은 계속되므로 끝에서 울린다). 건너뛰면 멈추고, 설정에서 끄면 틀지 않는다.
import { check, onboard } from './lib.mjs';

export default async function ({ page, url, shot }) {
  await page.clock.install({ time: new Date('2026-10-22T18:00:00+09:00') });
  await page.addInitScript(() => {
    window.__plays = [];
    window.__pauses = 0;
    HTMLMediaElement.prototype.play = function () {
      window.__plays.push(this.src);
      return Promise.resolve();
    };
    HTMLMediaElement.prototype.pause = function () { window.__pauses += 1; };
  });
  await page.goto(url);
  await onboard(page);
  await page.click('.start-cta');

  const plays = () => page.evaluate(() => window.__plays.slice());
  const before = (await plays()).length;   // 첫 터치 때 재생기를 깨운 것
  check(before >= 1, '첫 터치 때 재생기를 깨우지 않았습니다');

  await page.locator('.now-done').click();
  const rest = await page.locator('#rest-remaining').textContent();
  const [m, sec] = rest.trim().split(':').map(Number);
  const seconds = m * 60 + sec;
  const after = await plays();
  check(after.length === before + 1, '세트를 끝냈는데 소리를 안 틀었습니다');
  // 소리 길이 = 휴식 + 알림음(약 1초) — 8kHz 8비트라 1초 8000바이트
  const size = await page.evaluate(async (src) => (await (await fetch(src)).arrayBuffer()).byteLength, after[after.length - 1]);
  const wavSeconds = (size - 44) / 8000;
  check(Math.abs(wavSeconds - seconds - 1.02) < 1.5, `소리 길이 ${wavSeconds.toFixed(1)}초 · 휴식 ${seconds}초`);

  // +30초 하면 다시 맞춘다
  await page.locator('#rest-host button', { hasText: '+30초' }).click();
  check((await plays()).length === before + 2, '+30초 뒤 소리를 다시 맞추지 않았습니다');

  // 다 쉬면 — 지금 울리는 알림음을 끊지 않는다
  const quiet = await page.evaluate(() => window.__pauses);
  await page.clock.runFor((seconds + 32) * 1000);
  check(await page.locator('#rest-remaining').count() === 0, '휴식이 안 끝났습니다');
  check(await page.evaluate(() => window.__pauses) === quiet, '휴식이 끝나는 순간 알림음을 끊었습니다');

  // 건너뛰면 멈춘다
  await page.locator('.now-done').click();
  const paused = await page.evaluate(() => window.__pauses);
  await page.locator('#rest-host .rest-skip', { hasText: '건너뛰기' }).click();
  check(await page.evaluate(() => window.__pauses) > paused, '휴식을 건너뛰었는데 소리를 멈추지 않았습니다');

  // 설정에서 끄면 틀지 않는다
  await page.locator('#me-btn').click();
  const row = page.locator('.rest-sound-row');
  check((await row.textContent()).includes('켜짐'), '기본이 켜짐이 아닙니다');
  await shot('1-setting');
  await row.click();
  check((await row.textContent()).includes('꺼짐'), '끄기가 안 됩니다');
  await page.locator('#me-btn').click();
  const count = (await plays()).length;
  await page.locator('.now-done').click();
  check((await plays()).length === count, '꺼 뒀는데 소리를 틀었습니다');
}
