// 코치 목소리 — 미리 만든 소리 조각을 받아 이어서 튼다. 기기 음성합성은 쓰지 않는다.
//   코치를 고르면 그 목소리 조각을 받고, PT가 말할 때 그 조각을 튼다. 종목 설명도 코치 목소리로.
//   활기찬 코치는 남 · 여 목소리를 고른다. 한 번 받으면 이 폰에 남는다.
import { clipId, speechPieces } from '../../src/engine/speech.ts';
import { COACH_STYLES } from '../../src/engine/coach.ts';
import { check, choosePt, onboard, tab } from './lib.mjs';

export default async function ({ page, url, shot }) {
  const asked = [];
  page.on('request', (request) => {
    const match = request.url().match(/\/voice\/([^/]+)\/([^/]+)$/);
    if (match) asked.push(match[1] + '/' + match[2]);
  });
  // 기기 음성합성을 부르면 실패로 본다 — 코치 목소리만 쓴다
  await page.addInitScript(() => {
    window.speechSynthesis.speak = () => { window.__deviceSpeech = (window.__deviceSpeech || 0) + 1; };
  });
  await page.goto(url);
  await onboard(page);
  await choosePt(page);

  // 빡센 코치를 고르면 그 목소리로 한마디 — 그 말의 조각 파일을 받는다
  await tab(page, '내 정보');
  await page.locator('.coach-settings .coach-style', { hasText: '빡세게' }).click();
  const sample = COACH_STYLES.find((item) => item.id === 'tough').sample;
  await page.waitForFunction((text) => window.__said.includes(text), sample);
  const want = speechPieces(sample).map((piece) => 'tough/' + clipId(piece) + '.mp3');
  await page.waitForFunction(() => true);
  for (let i = 0; i < 50 && !want.every((file) => asked.includes(file)); i += 1) await page.waitForTimeout(100);
  check(want.every((file) => asked.includes(file)), '빡센 코치 조각을 안 받았습니다: ' + want.filter((file) => !asked.includes(file)).join(', '));
  check(asked.includes('tough/manifest.json'), '목소리 목록을 안 읽었습니다');

  // 고른 목소리를 이 폰에 다 받아 둔다 — 다 받으면 "받아 두었습니다"
  await page.locator('#screen .voice-status', { hasText: '받아 두었습니다' }).waitFor({ timeout: 60000 });
  await shot('1-ready');

  // 활기찬 코치 — 여자 목소리를 고르면 그 폴더 조각을 받는다
  await page.locator('#screen .coach-settings .coach-style', { hasText: '활기차게' }).click();
  await page.locator('#screen .coach-settings .segmented button', { hasText: '여자 목소리' }).click();
  await page.waitForFunction(() => window.__said.length > 2);
  for (let i = 0; i < 50 && !asked.some((file) => file.startsWith('energetic-f/') && file.endsWith('.mp3')); i += 1) await page.waitForTimeout(100);
  check(asked.some((file) => file.startsWith('energetic-f/') && file.endsWith('.mp3')), '여자 목소리 조각을 안 받았습니다');
  await tab(page, '오늘');

  // 종목 설명을 코치 목소리로
  await page.locator('.plan-row .row-menu').first().click();
  await page.locator('dialog .menu-row', { hasText: '동작 시연' }).click();
  const button = page.locator('dialog .guide-listen');
  await button.click();
  check((await button.textContent()).includes('그만 듣기'), '설명 듣기 버튼이 바뀌지 않았습니다');
  await page.waitForFunction(() => window.__said.some((text) => /쉽게 알려 줄게요/.test(text)));
  await button.click();
  check((await button.textContent()).includes('설명 듣기'), '그만 듣기가 안 됩니다');
  await shot('2-guide');

  check(!(await page.evaluate(() => window.__deviceSpeech)), '기기 음성합성을 썼습니다');
}
