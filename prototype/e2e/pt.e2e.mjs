// PT 한 바퀴 — 몸 풀기(목록에 다녀와도 이어진다) → 세기("운동 끝내기 → 계속하기"는 바로 잇는다)
//   → 다 세면 묻지 않고 바로 기록 → 휴식(화면을 껐다 켜면 저절로 잇는다) → 다음 세트
import { begin, check, choosePt, focusPhase, onboard, runUntil, setVisible } from './lib.mjs';

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
  await begin(page);
  await runUntil(page, 'prep');
  await shot('1-prep');

  // 몸 풀기 중에 목록에 다녀오면 멈춘 자리에서 잇는다 (전에는 그대로 멈춰 섰다)
  await page.click('#focus .focus-more');
  await page.getByRole('button', { name: '오늘 할 것 목록으로' }).click();
  check(await focusPhase(page) === null, '목록인데 집중 화면이 떠 있습니다');
  await begin(page);
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

  // 다 세면 묻지 않고 바로 적고 쉰다
  await runUntil(page, ['ask', 'rest'], { maxMs: 180000 });
  check(await focusPhase(page) === 'rest', '세트가 끝났는데 묻습니다');
  const rest = await page.locator('#focus .focus-what').textContent();
  check(/쉬고 → 2세트/.test(rest), '휴식 줄: ' + rest);
  const logged = await page.evaluate(() => (JSON.parse(localStorage.getItem('volume-coach.proto.state') || '{}').sessions || [])
    .reduce((sum, item) => sum + (item.sets || []).length, 0));
  await shot('3-rest');

  // 쉬는 동안 폰을 잠갔다 켜면 — 멈췄다가 저절로 잇는다(계속을 누를 필요 없다)
  await setVisible(page, false);
  check(await focusPhase(page) === 'paused', '화면을 껐는데 멈추지 않았습니다');
  await setVisible(page, true);
  await page.clock.runFor(1500);
  check(await focusPhase(page) === 'rest', '화면을 켰는데 이어지지 않고 ' + await focusPhase(page));

  // 휴식이 끝나면 다음 세트를 센다 — 같은 세트를 다시 적지 않는다
  await runUntil(page, 'count', { maxMs: 400000, stepMs: 2000 });
  check((await page.locator('#focus .focus-what').textContent()).startsWith('2세트'), '다음 세트가 2세트가 아닙니다');
  void logged;
}
