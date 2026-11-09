// 화면 꺼도 휴식 끝 소리 — 화면이 켜진 동안에는 아무것도 틀지 않고, 쉬는 중에 화면이 꺼지면 Web Audio로
//   남은 휴식 뒤 알림음을 깔아 둔다(<audio>를 틀면 폰이 듣던 음악을 멈췄다). 돌아오면 멈춘다.
//   아이폰처럼 화면 밖에서 Web Audio가 멈추는 폰만 예전 <audio> 길. 설정에서 끄면 틀지 않는다.
import { check, onboard, setVisible, startWorkout, tab } from './lib.mjs';

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
  await startWorkout(page);

  const plays = () => page.evaluate(() => window.__plays.slice());
  const before = (await plays()).length;   // 첫 터치 때 재생기를 (소리 없이) 깨운 것
  check(before >= 1, '첫 터치 때 재생기를 깨우지 않았습니다');

  // 화면이 켜진 채 쉬면 <audio>를 틀지 않는다 — 음악이 끊기지 않게
  await page.locator('.now-done').click();
  const rest = await page.locator('#rest-remaining').textContent();
  const [m, sec] = rest.trim().split(':').map(Number);
  const seconds = m * 60 + sec;
  check((await plays()).length === before, '화면이 켜져 있는데 휴식 소리를 틀었습니다(음악이 멈춥니다)');
  await page.locator('#rest-host button', { hasText: '+30초' }).click();
  check((await plays()).length === before, '+30초에 휴식 소리를 틀었습니다');

  // 화면이 꺼지면 남은 휴식만큼 Web Audio로 깐다 — <audio>가 아니어서 듣던 음악이 멈추지 않는다
  const bgState = () => page.evaluate(() => window.RestSound.backgroundState());
  await setVisible(page, false);
  const bg = await bgState();
  check(bg && bg.mode === 'webaudio' && bg.sources > 0, '쉬는 중에 화면을 껐는데 Web Audio로 깔지 않았습니다: ' + JSON.stringify(bg));
  check(Math.abs(bg.seconds - (seconds + 30) - 1.5) < 2, `깔아 둔 길이 ${bg.seconds}초 · 남은 휴식 ${seconds + 30}초`);
  check((await plays()).length === before, '화면을 껐더니 <audio>를 틀었습니다 — 음악이 멈춥니다');

  // 다 쉬어도 — 깔아 둔 알림음을 끊지 않는다(화면이 켜질 때까지)
  await page.clock.runFor((seconds + 32) * 1000);
  check(await page.locator('#rest-remaining').count() === 0, '휴식이 안 끝났습니다');
  check(await bgState() !== null, '휴식이 끝나는 순간 깔아 둔 소리를 끊었습니다');

  // 화면을 다시 켜면 멈춘다
  await setVisible(page, true);
  check(await bgState() === null, '화면을 켰는데 화면 밖 소리를 멈추지 않았습니다');

  // 아이폰처럼 화면 밖에서 Web Audio가 멈추는 폰 — 그때만 예전 <audio> 길로
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'platform', { value: 'MacIntel', configurable: true });
    Object.defineProperty(navigator, 'maxTouchPoints', { value: 5, configurable: true });
  });
  await page.locator('.now-done').click();
  await setVisible(page, false);
  const fallback = await bgState();
  check(fallback && fallback.mode === 'audio', '아이폰에서 <audio>로 넘어가지 않았습니다: ' + JSON.stringify(fallback));
  check((await plays()).length === before + 1, '아이폰에서 휴식 끝 소리를 틀지 않았습니다');
  const paused = await page.evaluate(() => window.__pauses);
  await setVisible(page, true);
  check(await page.evaluate(() => window.__pauses) > paused, '돌아왔는데 휴식 소리를 끄지 않았습니다');
  await page.evaluate(() => {
    delete navigator.platform;
    Object.defineProperty(navigator, 'platform', { value: 'Linux x86_64', configurable: true });
    Object.defineProperty(navigator, 'maxTouchPoints', { value: 0, configurable: true });
  });
  await page.locator('#rest-host .rest-skip', { hasText: '건너뛰기' }).click();

  // 설정에서 끄면 틀지 않는다
  await tab(page, '내 정보');
  const row = page.locator('.rest-sound-row');
  check((await row.textContent()).includes('켜짐'), '기본이 켜짐이 아닙니다');
  await shot('1-setting');
  await row.click();
  check((await row.textContent()).includes('꺼짐'), '끄기가 안 됩니다');
  await tab(page, '오늘');
  const count = (await plays()).length;
  await page.locator('.now-done').click();
  await setVisible(page, false);
  check((await plays()).length === count, '꺼 뒀는데 소리를 틀었습니다');
  check(await bgState() === null, '꺼 뒀는데 화면 밖 소리를 깔았습니다');
  await setVisible(page, true);
}
