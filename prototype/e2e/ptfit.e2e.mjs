// PT 화면이 작은 폰(360×640 · 375×667)부터 큰 폰(390×844)까지 스크롤 없이 들어간다 —
//   쉬는 시간 · 세 줄(준비 · 동작 · 주의) · 버튼, 준비 중 남은 초, 워밍업 동작이 화면 안에.
//   예전에는 종목이 바뀌는 휴식의 남은 시간이 390×844에서도 화면 밖이었고, "준비 30"이 원 밖으로 삐져나갔다.
import { begin, check, choosePt, focusPhase, onboard, runUntil } from './lib.mjs';

const SIZES = [[360, 640], [375, 667], [390, 844]];

async function fits(page, label) {
  for (const [width, height] of SIZES) {
    await page.setViewportSize({ width, height });
    await page.clock.runFor(100);
    const bad = await page.evaluate(() => {
      const host = document.getElementById('focus');
      const vh = window.innerHeight;
      const out = [];
      if (!host || host.hidden) return ['PT 화면이 없습니다'];
      for (const sel of ['#focus-rest-time', '#focus-num', '.focus-actions', '.rest-guide-lines li', '.focus-what', '.focus-logged', '.focus-say', '.focus-demo']) {
        for (const node of host.querySelectorAll(sel)) {
          const box = node.getBoundingClientRect();
          if (box.height === 0) continue;
          if (box.bottom > vh + 1 || box.top < -1) out.push(`${sel} ${Math.round(box.top)}~${Math.round(box.bottom)} (화면 ${vh})`);
        }
      }
      for (const scroller of [host, host.querySelector('.focus-middle')]) {
        if (scroller && scroller.scrollHeight > scroller.clientHeight + 2) out.push(`${scroller.className} 스크롤 ${scroller.scrollHeight}>${scroller.clientHeight}`);
      }
      if (document.documentElement.scrollWidth > document.documentElement.clientWidth + 1) out.push('가로 스크롤');
      // 원 안의 숫자는 원 안에
      const ring = host.querySelector('.focus-ring');
      const num = host.querySelector('.focus-ring #focus-num');
      if (ring && num) {
        const r = ring.getBoundingClientRect();
        const n = num.getBoundingClientRect();
        if (n.left < r.left || n.right > r.right) out.push(`숫자가 원 밖으로 (${Math.round(n.width)} > ${Math.round(r.width)})`);
      }
      // 동작 그림이 실처럼 줄어들지 않는다
      for (const motion of host.querySelectorAll('.focus-motion')) {
        const box = motion.getBoundingClientRect();
        if (box.height > 0 && box.height < 90) out.push(`동작 그림이 ${Math.round(box.height)}px`);
      }
      return out;
    });
    check(bad.length === 0, `${label} ${width}×${height}: ${bad.join(' / ')}`);
  }
  await page.setViewportSize({ width: 390, height: 844 });
}

const reps = async (page) => {
  const text = await page.locator('#focus-num').textContent().catch(() => '');
  return /^\d+$/.test(text) ? Number(text) : 0;
};

export default async function ({ page, url, shot }) {
  await page.clock.install({ time: new Date('2026-10-22T18:00:00+09:00') });
  await page.goto(url);
  await onboard(page);
  await choosePt(page);
  await begin(page);
  await runUntil(page, 'prep');
  await page.locator('#focus .focus-btn', { hasText: '지금 시작' }).click().catch(() => {});
  await page.clock.runFor(1000);
  await fits(page, '몸 풀기');
  await page.locator('#focus .focus-btn', { hasText: '몸 풀기 건너뛰기' }).click();
  if (await runUntil(page, ['warm', 'count']) === 'warm') {
    await fits(page, '워밍업 준비');
    await page.locator('#focus .focus-btn', { hasText: '워밍업 건너뛰기' }).click();
    await runUntil(page, 'count');
  }
  await fits(page, '1세트 준비');
  for (let i = 0; i < 120 && await reps(page) < 2; i += 1) await page.clock.runFor(500);
  await fits(page, '1세트 세는 중');
  await page.locator('#focus .focus-btn', { hasText: '여기까지' }).click();
  await runUntil(page, 'rest');
  await page.clock.runFor(500);
  await fits(page, '같은 종목 휴식');
  await page.setViewportSize({ width: 360, height: 640 });
  await shot('1-rest-360');
  await page.setViewportSize({ width: 390, height: 844 });

  // 종목이 바뀌는 휴식까지 — 남은 세트는 바로 시작해서 한 개씩
  for (let guard = 0; guard < 12; guard += 1) {
    if (await focusPhase(page) === 'rest' && (await page.locator('#focus .focus-pos').textContent()).includes('다음 종목')) break;
    const phase = await runUntil(page, ['rest', 'count', 'warm']);
    if (phase === 'rest') {
      if ((await page.locator('#focus .focus-pos').textContent()).includes('다음 종목')) break;
      await page.locator('#focus .focus-btn', { hasText: '바로 시작' }).click();
    } else if (phase === 'count') {
      for (let i = 0; i < 120 && await reps(page) < 1; i += 1) await page.clock.runFor(500);
      await page.locator('#focus .focus-btn', { hasText: '여기까지' }).click();
    } else {
      await page.locator('#focus .focus-btn', { hasText: '워밍업 건너뛰기' }).click();
    }
    await page.clock.runFor(500);
  }
  check((await page.locator('#focus .focus-pos').textContent()).includes('다음 종목'), '종목이 바뀌는 휴식까지 못 갔습니다');
  await fits(page, '종목이 바뀌는 휴식');
  check(await page.locator('#focus .focus-demo', { hasText: '크게 보기' }).count() === 1, '"크게 보기" 단추가 없습니다');
  await page.setViewportSize({ width: 360, height: 640 });
  await shot('2-switch-360');
}
