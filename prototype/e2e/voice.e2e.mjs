// PT 목소리 — 이 폰의 한국어 목소리 중에서 고르고, 높이 · 빠르기를 맞추고, 누르면 그 목소리로
//   바로 들려준다. 말투마다 결이 다르고(빡세게는 빠르고 힘 있게), 고른 것은 다시 열어도 남는다.
import { check, choosePt, onboard, startWorkout } from './lib.mjs';

const PHONE = [
  { name: 'Microsoft SunHi Online (Natural) - Korean (Korea)', lang: 'ko-KR', localService: false },
  { name: 'Yuna', lang: 'ko-KR', localService: true },
  { name: 'Google 한국의', lang: 'ko-KR', localService: false },
  { name: 'Grandma (한국어(대한민국))', lang: 'ko-KR', localService: true },
  { name: 'Samantha', lang: 'en-US', localService: true },
];

const last = (page) => page.evaluate(() => window.__spoken[window.__spoken.length - 1] || null);

export default async function ({ page, url, shot }) {
  // 이 폰에 깔린 목소리 — 가짜 말하기(FAKE_SPEECH) 위에 목록만 바꾼다
  await page.addInitScript((voices) => {
    window.speechSynthesis.getVoices = () => voices;
  }, PHONE);
  await page.clock.install({ time: new Date('2026-10-22T18:00:00+09:00') });
  await page.goto(url);
  await onboard(page);
  await choosePt(page);

  // 오늘 화면 › 운동 방식 — PT면 목소리 고르기가 있다
  await page.locator('.coach-line').click();
  const picks = page.locator('dialog .voice-pick');
  await picks.first().waitFor();
  const names = (await picks.locator('b').allTextContents()).map((text) => text.trim());
  // 자동 + 한국어 셋 (할머니 목소리 · 영어 목소리는 빼고), 자연스러운 것부터
  check(JSON.stringify(names) === JSON.stringify(['자동', 'SunHi', '구글 목소리', 'Yuna']), '목소리 목록: ' + names.join(', '));
  check(await page.locator('dialog .voice-pick[aria-pressed="true"]').textContent().then((t) => t.includes('자동')), '처음엔 자동');
  await shot('1-voices');

  // Yuna를 누르면 그 목소리로 지금 말투(차분하게)의 한마디를 들려준다
  await picks.filter({ hasText: 'Yuna' }).click();
  let said = await last(page);
  check(said && said.voice === 'Yuna', 'Yuna로 들려주지 않았습니다: ' + JSON.stringify(said));
  check(said.text.length > 5, '들려준 말이 없습니다');
  check(await page.locator('dialog .voice-pick[aria-pressed="true"]').textContent().then((t) => t.includes('Yuna')), 'Yuna가 눌려 있지 않습니다');
  const calm = said;
  check(calm.rate < 1 && calm.pitch < 1, '차분하게는 조금 느리고 낮게: ' + JSON.stringify(calm));

  // 높이 낮게 — 같은 목소리, 더 낮게
  await page.locator('dialog .voice-tune', { hasText: '높이' }).locator('button', { hasText: '낮게' }).click();
  said = await last(page);
  check(said.voice === 'Yuna' && said.pitch < calm.pitch, '낮게가 안 됩니다: ' + JSON.stringify(said));

  // 말투를 빡세게로 — 고른 목소리 · 높이는 그대로, 결만 빠르고 힘 있게
  await page.locator('dialog .coach-style', { hasText: '빡세게' }).click();
  said = await last(page);
  check(said.voice === 'Yuna', '말투를 바꿨더니 목소리가 바뀌었습니다');
  check(said.rate > calm.rate && said.rate > 1, '빡세게가 빨라지지 않았습니다: ' + JSON.stringify(said));
  const fired = said;

  // 들어 보기 — 지금 설정 그대로 한 번 더
  await page.locator('dialog .voice-listen').click();
  said = await last(page);
  check(said.voice === 'Yuna' && said.rate === fired.rate && said.pitch === fired.pitch, '들어 보기가 지금 설정과 다릅니다');
  await shot('2-picked');

  // 다시 열어도 남는다 (새로 고쳐도)
  await page.locator('dialog .modal-close').click();
  await page.reload();
  await page.locator('.coach-line').click();
  await page.locator('dialog .voice-pick').first().waitFor();
  check(await page.locator('dialog .voice-pick[aria-pressed="true"]').textContent().then((t) => t.includes('Yuna')), '새로 고친 뒤 고른 목소리가 풀렸습니다');
  check(await page.locator('dialog .voice-tune', { hasText: '높이' }).locator('button[aria-pressed="true"]').textContent().then((t) => t.trim() === '낮게'), '높이가 풀렸습니다');
  await page.locator('dialog .modal-close').click();

  // 운동을 시작하면 PT가 그 목소리로 말한다
  const before = await page.evaluate(() => window.__spoken.length);
  await startWorkout(page);
  await page.clock.runFor(3000);
  const spoken = await page.evaluate((from) => window.__spoken.slice(from), before);
  check(spoken.length > 0, 'PT가 말하지 않았습니다');
  check(spoken.every((item) => item.voice === 'Yuna' && item.rate === fired.rate), '운동 중 목소리가 고른 것과 다릅니다: ' + JSON.stringify(spoken[0]));
}
