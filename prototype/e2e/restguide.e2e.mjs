// PT — 쉬는 동안 다음 운동을 바로 보여 주고(동작이 돈다) 잡는 법 · 동작 · 흔한 실수를 말해 준다.
//   종목이 바뀌는 휴식이면 "다음 종목, ○○!" 뒤에 이어서, 같은 종목 세트 사이에도 동작은 화면에.
import { begin, check, choosePt, onboard, runUntil } from './lib.mjs';

export default async function ({ page, url, shot }) {
  await page.clock.install({ time: new Date('2026-10-22T18:00:00+09:00') });
  await page.goto(url);
  await onboard(page);
  await choosePt(page);
  await page.evaluate(() => {
    window.__said = [];
    const speak = window.CoachVoice.speak;
    window.CoachVoice.speak = (text) => { window.__said.push(text); return speak.call(window.CoachVoice, text); };
  });
  await begin(page);
  await runUntil(page, 'prep');
  // 몸 풀기도 동작이 화면에 돈다
  await page.locator('#focus .focus-btn', { hasText: '지금 시작' }).click().catch(() => {});
  await page.clock.runFor(300);
  check(await page.locator('#focus .stretch-motion canvas').count() === 1, '몸 풀기 동작이 안 보입니다');
  await shot('0-prep');
  await page.locator('#focus .focus-btn', { hasText: '몸 풀기 건너뛰기' }).click();
  await runUntil(page, ['warm', 'count']);
  // 워밍업 · 세트 하는 동안에도 그 운동 동작이 개수 위에(같은 캔버스를 이어 쓴다)
  check(await page.locator('#focus .set-motion canvas').count() === 1, '운동 중 동작이 안 보입니다');
  check(await page.locator('#focus .focus-ring').count() === 1, '개수 원이 없습니다');
  await shot('0-set');
  if (await page.locator('#focus .focus-btn', { hasText: '워밍업 건너뛰기' }).count()) {
    await page.locator('#focus .focus-btn', { hasText: '워밍업 건너뛰기' }).click();
  }
  // 그날 첫 종목 — 앞에 쉬는 시간이 없으니 첫 세트 앞(또는 첫 워밍업 앞)에서 하는 법을 말했다
  const said0 = await page.evaluate(() => window.__said.join(' | '));
  check(/하는 법/.test(said0), '첫 종목 앞에서 하는 법을 말하지 않았습니다: ' + said0.slice(0, 200));

  // 같은 종목 세트 사이 휴식 — 동작과 세 줄이 화면에
  await runUntil(page, 'rest', { maxMs: 180000 });
  await page.clock.runFor(300);
  check(await page.locator('#focus .rest-guide').count() === 1, '쉬는 동안 운동 설명 칸이 없습니다');
  check(await page.locator('#focus .rest-guide .live-motion').count() === 1, '쉬는 동안 동작이 안 보입니다');
  const lines = await page.locator('#focus .rest-guide-lines li b').allTextContents();
  check(lines.join(',') === '준비,동작,주의', '세 줄이 아닙니다: ' + lines.join(','));
  await shot('1-rest');

  // 끄면 칸이 사라진다(설정)
  const before = await page.evaluate(() => JSON.parse(localStorage.getItem('volume-coach.proto.state')).settings.restGuide);
  check(before !== false, '기본이 꺼져 있습니다');
}
