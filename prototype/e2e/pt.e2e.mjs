// PT 한 바퀴 — 몸 풀기(목록에 다녀와도 이어진다) → 세기("운동 끝내기 → 계속하기"는 바로 잇는다)
//   → 무게 물음(화면을 껐다 켜고 ▶ 계속해도 같은 세트를 다시 세지 않는다) → 10초 뒤 저절로 기록 → 휴식 → 다음 세트
import { check, choosePt, focusPhase, onboard, runUntil, setVisible } from './lib.mjs';

async function untilRep(page) {
  for (let i = 0; i < 90; i += 1) {
    if (/^\d+$/.test((await page.locator('#focus-num').textContent().catch(() => '')) || '')) return;
    await page.clock.runFor(1000);
  }
  throw new Error('세기가 시작되지 않았습니다');
}

export default async function ({ page, url, shot }) {
  await page.clock.install({ time: new Date('2026-10-22T18:00:00+09:00') });
  await page.goto(url);
  await onboard(page);
  await choosePt(page);
  await page.click('.start-cta');
  await runUntil(page, 'prep');
  await shot('1-prep');

  // 몸 풀기 중에 목록에 다녀오면 멈춘 자리에서 잇는다 (전에는 그대로 멈춰 섰다)
  await page.click('#focus .focus-more');
  await page.getByRole('button', { name: '오늘 할 것 목록으로' }).click();
  check(await focusPhase(page) === null, '목록인데 집중 화면이 떠 있습니다');
  await page.click('.start-cta');
  await page.clock.runFor(500);
  check(await focusPhase(page) === 'prep', '목록에서 돌아왔는데 ' + await focusPhase(page));
  await page.locator('#focus .focus-btn', { hasText: '몸 풀기 건너뛰기' }).click();

  if (await runUntil(page, ['warm', 'count']) === 'warm') {
    await page.locator('#focus .focus-btn', { hasText: '워밍업 건너뛰기' }).click();
    await runUntil(page, 'count');
  }

  // 세는 중에 "운동 끝내기" → "계속하기"는 그 자리에서 잇는다
  await untilRep(page);
  await page.click('#focus .end-workout');
  await page.locator('dialog').getByRole('button', { name: '계속하기' }).click();
  await page.clock.runFor(500);
  check(await focusPhase(page) === 'count', '계속하기 뒤에 ' + await focusPhase(page));

  await runUntil(page, 'ask', { maxMs: 180000 });
  await shot('2-ask');

  // 묻는 중에 다른 앱으로 갔다 와서 ▶ 계속 — 같은 세트를 처음부터 다시 세면 안 된다
  await setVisible(page, false);
  check(await focusPhase(page) === 'paused', '화면을 껐는데 멈추지 않았습니다');
  await setVisible(page, true);
  await page.locator('#focus .pt-pause').click();
  await page.clock.runFor(1500);
  check(await focusPhase(page) === 'ask', '이어 한 뒤 무게 물음이 아니라 ' + await focusPhase(page));

  // 10초 안 누르면 저절로 적고 쉰다
  await page.clock.runFor(11000);
  check(await focusPhase(page) === 'rest', '10초 뒤 휴식이 아니라 ' + await focusPhase(page));
  const rest = await page.locator('#focus .focus-what').textContent();
  check(/쉬고 → 2세트/.test(rest), '휴식 줄: ' + rest);
  await shot('3-rest');

  // 휴식이 끝나면 다음 세트를 센다
  await runUntil(page, 'count', { maxMs: 400000, stepMs: 2000 });
}
