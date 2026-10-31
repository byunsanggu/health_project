// 짧은 날 PT를 끝까지 — 평소 60분 · 오늘 20분에서 −는 15분(평소 값에서 빼면 55분이 됐다)
//   → 세트마다 묻지 않고 "여기까지"로 바로 적힌다 · 마지막 세트 뒤에 "한 번 더"라고 하지 않는다
//   → 스트레칭 중 멈춘 채로 끝내도 일시정지 화면이 남지 않는다
import { begin, check, choosePt, focusPhase, onboard, runUntil, setVisible } from './lib.mjs';

export default async function ({ page, url, shot }) {
  await page.clock.install({ time: new Date('2026-10-22T18:00:00+09:00') });
  await page.goto(url);
  await onboard(page);

  // 오늘만 20분 — 시작 전 한 장에서 고른다. 짧은 날이 되고 목록 위에 한 줄로 남는다
  await page.locator('.start-cta').click();
  await page.locator('dialog .segmented button', { hasText: '20분' }).click();
  await page.locator('dialog .modal-close').click();
  check((await page.locator('.today-adjust').textContent()).includes('20분'), '오늘 시간이 안 보입니다');
  check(await page.locator('.short-note').count() === 1, '20분인데 짧은 날이 아닙니다');

  await choosePt(page);
  await begin(page);
  let sets = 0;
  let lastLines = [];
  for (let guard = 0; guard < 80; guard += 1) {
    const phase = await runUntil(page, ['prep', 'warm', 'count', 'ask', 'rest', 'cool'], { maxMs: 400000 });
    check(phase !== 'ask', '세트 끝에 묻습니다');
    if (phase === 'cool') break;
    if (phase === 'prep') await page.locator('#focus .focus-btn', { hasText: '몸 풀기 건너뛰기' }).click();
    else if (phase === 'warm') await page.locator('#focus .focus-btn', { hasText: '워밍업 건너뛰기' }).click();
    else if (phase === 'rest') await page.locator('#focus .focus-btn', { hasText: '바로 시작' }).click();
    else if (phase === 'count') {
      // 세 개씩만 세고 "여기까지" — 그 자리에서 기록되고 쉰다
      for (let i = 0; i < 120; i += 1) {
        if (Number(await page.locator('#focus-num').textContent().catch(() => '0')) >= 3) break;
        await page.clock.runFor(500);
      }
      const last = (await page.locator('#focus .focus-next').textContent()).includes('오늘 마지막 세트');
      const before = await page.evaluate(() => window.__said.length);
      await page.locator('#focus .focus-btn', { hasText: '여기까지' }).click();
      sets += 1;
      if (last) {
        await page.clock.runFor(300);
        lastLines = await page.evaluate((from) => window.__said.slice(from), before);
      }
    }
  }
  check(await focusPhase(page) === 'cool', '스트레칭까지 못 갔습니다');
  check(sets >= 2, `세트가 ${sets}개뿐입니다`);
  check(!lastLines.some((line) => /한 번 더|한 세트 더/.test(line)), '마지막 세트 뒤에 한 번 더라고 했습니다: ' + lastLines.join(' / '));
  // 스트레칭 자세가 화면에 돈다
  await page.clock.runFor(1500);
  check(await page.locator('.pt-cool .stretch-motion canvas').count() === 1, '스트레칭 동작이 안 보입니다');
  await shot('1-cool');

  // 스트레칭 중에 다른 앱으로 갔다가 와서, 멈춘 채로 끝낸다
  await setVisible(page, false);
  await setVisible(page, true);
  await page.getByRole('button', { name: '스트레칭 끝내기' }).first().click();
  await page.clock.runFor(500);
  const after = await focusPhase(page);
  check(after !== 'paused', '스트레칭을 끝냈는데 일시정지 화면이 떴습니다');
  check(after !== 'rest', '스트레칭을 끝냈는데 마지막 세트 뒤 휴식이 다시 떴습니다');
  await shot('2-after');
}
