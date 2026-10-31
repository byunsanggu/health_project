// 화면을 꺼도 PT 소리 — 쉬는 중에 폰을 잠그면 미리 만든 소리 파일(쉬는 시간 · 다음 세트 말 · 세기)을 튼다.
//   다시 켜면 꺼져 있던 동안 센 세트가 기록돼 있고, PT는 멈추지 않고 그 자리부터 잇는다.
import { check, choosePt, focusPhase, onboard, begin, runUntil, setVisible } from './lib.mjs';

// 오늘 적힌 본세트 수 — 화면의 칸은 지금 종목 것만이라(다 하면 다음 종목으로 넘어간다) 저장된 기록으로 센다
const doneSets = (page) => page.evaluate(() => {
  const saved = JSON.parse(localStorage.getItem('volume-coach.proto.state') || '{}');
  return ((saved.settings && saved.settings.todaySets) || []).length;
});

export default async function ({ page, url, shot }) {
  await page.clock.install({ time: new Date('2026-10-22T18:00:00+09:00') });
  await page.goto(url);
  await onboard(page);
  await choosePt(page);
  await page.evaluate(() => {
    window.RestSound.playTrack = (bytes, anchor) => { window.__track = { bytes: bytes.byteLength, offset: (Date.now() - anchor) / 1000, anchor }; };
    // 실제로는 소리 파일이 시계와 같이 흐른다 — 앱은 돌아왔을 때 소리가 간 자리까지만 세트로 적는다
    const real = window.RestSound.position;
    window.RestSound.position = () => (window.__track
      ? { time: (Date.now() - window.__track.anchor) / 1000, paused: false, ended: false }
      : real());
  });

  await begin(page);
  await runUntil(page, 'prep');
  await page.locator('#focus .focus-btn', { hasText: '몸 풀기 건너뛰기' }).click();
  if (await runUntil(page, ['warm', 'count']) === 'warm') {
    await page.locator('#focus .focus-btn', { hasText: '워밍업 건너뛰기' }).click();
    await runUntil(page, 'count');
  }
  await runUntil(page, 'rest', { maxMs: 180000 });
  const before = await doneSets(page);

  // 소리 파일을 만들 시간 — 실제 시간으로 잠깐
  for (let i = 0; i < 40; i += 1) {
    await page.waitForTimeout(150);
    await page.clock.runFor(100);
  }

  // 쉬는 중에 폰을 잠근다 → 소리 파일을 튼다
  await setVisible(page, false);
  const track = await page.evaluate(() => window.__track);
  check(track && track.bytes > 200000, '화면을 껐는데 PT 소리 파일을 틀지 않았습니다: ' + JSON.stringify(track));
  // 소리 파일의 0초는 휴식이 시작된 때 — 지금까지 쉰 만큼 건너뛰고 튼다
  check(track.offset >= 0 && track.offset < 30, '소리 파일 시작 자리가 이상합니다: ' + track.offset);

  // 4분 뒤에 켠다 — 그동안 소리 파일이 다음 세트를 셌다
  await page.clock.runFor(240000);
  await setVisible(page, true);
  await page.clock.runFor(500);
  const after = await doneSets(page);
  const phase = await focusPhase(page);
  check(phase !== 'paused', '화면을 켰는데 PT가 멈춰 있습니다');
  check(after > before, `꺼져 있던 동안 센 세트가 기록되지 않았습니다: ${before} → ${after}`);
  await shot('1-back');
}
