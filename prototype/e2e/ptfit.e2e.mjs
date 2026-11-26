// PT 화면이 작은 폰(360×640 · 375×667)부터 큰 폰(390×844)까지 스크롤 없이 들어간다 — 단계마다(몸 풀기 · 워밍업 준비 ·
//   워밍업 사이 · 세트 준비 · 세는 중 · 멈춤 · 같은 종목 휴식 · 종목이 바뀌는 휴식).
//   동작 그림이 주인공 — 화면 폭의 40% 넘게, 정사각형에 가깝게. 채운 버튼은 딱 하나(다음에 일어날 일).
import { begin, check, choosePt, focusPhase, focusText, onboard, ptDetail, ptGo, ptPause, runUntil, skipPrep, skipWarm } from './lib.mjs';

const SIZES = [[360, 640], [375, 667], [390, 844]];

async function fits(page, label, { shot = null } = {}) {
  for (const [width, height] of SIZES) {
    await page.setViewportSize({ width, height });
    await page.clock.runFor(100);
    const bad = await page.evaluate(() => {
      const host = document.getElementById('focus');
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const out = [];
      if (!host || host.hidden) return ['PT 화면이 없습니다'];
      const inside = (sel, need) => {
        const nodes = host.querySelectorAll(sel);
        if (need && nodes.length === 0) out.push(sel + ' 없음');
        for (const node of nodes) {
          const box = node.getBoundingClientRect();
          if (box.height === 0) continue;
          if (box.bottom > vh + 1 || box.top < -1) out.push(`${sel} ${Math.round(box.top)}~${Math.round(box.bottom)} (화면 ${vh})`);
        }
      };
      inside('.focus-top', true);
      inside('.focus-name', true);
      inside('.focus-what', false);
      inside('.focus-say', false);
      inside('.focus-dock', true);
      inside('#focus-num, #focus-rest-time, #focus-prep-left', true);
      if (host.scrollHeight > host.clientHeight + 2) out.push(`PT 화면 스크롤 ${host.scrollHeight}>${host.clientHeight}`);
      if (document.documentElement.scrollWidth > document.documentElement.clientWidth + 1) out.push('가로 스크롤');
      // 동작 그림 — 폭의 40% 넘게, 정사각형에 가깝게, 화면 안에. 숫자 배지는 그림 안에
      const hero = host.querySelector('.focus-hero');
      if (!hero) out.push('동작 그림이 없습니다');
      else {
        const box = hero.getBoundingClientRect();
        const ratio = box.width / box.height;
        if (box.width < vw * 0.4) out.push(`동작 그림 폭 ${Math.round(box.width)} < 화면 폭의 40%(${Math.round(vw * 0.4)})`);
        if (!(ratio >= 0.8 && ratio <= 1.25)) out.push(`동작 그림이 ${Math.round(box.width)}×${Math.round(box.height)} (비율 ${ratio.toFixed(2)})`);
        if (box.bottom > vh + 1 || box.top < -1) out.push(`동작 그림이 화면 밖 ${Math.round(box.top)}~${Math.round(box.bottom)}`);
        const badge = hero.querySelector('.focus-badge');
        const b = badge && badge.getBoundingClientRect();
        if (!b) out.push('숫자 배지가 그림 위에 없습니다');
        else if (b.left < box.left - 1 || b.right > box.right + 1 || b.bottom > box.bottom + 1 || b.top < box.top - 1) out.push('숫자 배지가 그림 밖으로');
      }
      // 채운 버튼은 하나 — 바탕이 강조색인 버튼을 센다
      const probe = document.createElement('div');
      probe.style.background = 'var(--accent)';
      host.appendChild(probe);
      const accent = getComputedStyle(probe).backgroundColor;
      probe.remove();
      const filled = [...host.querySelectorAll('button')].filter((node) => node.getBoundingClientRect().height > 0 && getComputedStyle(node).backgroundColor === accent);
      if (filled.length !== 1) out.push(`채운 버튼이 ${filled.length}개: ${filled.map((node) => node.textContent).join(' / ')}`);
      const go = host.querySelector('.focus-go');
      if (!go || go.getBoundingClientRect().height < 56) out.push('아래 버튼이 56px보다 작습니다');
      return out;
    });
    if (shot) await shot(`${label.replace(/\s+/g, '-')}-${width}x${height}`);
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
  if (await page.locator('#focus .focus-go', { hasText: '지금 시작' }).count()) await ptGo(page, '지금 시작');
  await page.clock.runFor(1000);
  await fits(page, '몸 풀기', { shot });
  await skipPrep(page);
  if (await runUntil(page, ['warm', 'count']) === 'warm') {
    await fits(page, '워밍업 준비', { shot });
    // 바로 시작 → 다 세면 워밍업 사이 휴식
    await ptGo(page, '바로 시작');
    for (let i = 0; i < 240 && await focusText(page, '#focus-cap') !== '휴식'; i += 1) await page.clock.runFor(500);
    check(await focusText(page, '#focus-cap') === '휴식', '워밍업 사이 휴식이 안 나왔습니다');
    await fits(page, '워밍업 사이', { shot });
    await skipWarm(page);
    await runUntil(page, 'count');
  }
  await fits(page, '1세트 준비', { shot });
  await ptPause(page);
  await fits(page, '1세트 준비 멈춤', { shot });
  await page.locator('#focus .pt-resume').click();
  for (let i = 0; i < 120 && await reps(page) < 2; i += 1) await page.clock.runFor(500);
  await fits(page, '1세트 세는 중', { shot });
  await ptGo(page, '세트 완료');
  await runUntil(page, 'rest');
  await page.clock.runFor(500);
  await fits(page, '같은 종목 휴식', { shot });
  // 자세히를 펼쳐도 아래 버튼은 화면 안 · PT 화면은 스크롤하지 않는다(자세히 칸만 안에서 내린다)
  await ptDetail(page);
  for (const [width, height] of SIZES) {
    await page.setViewportSize({ width, height });
    await page.clock.runFor(100);
    const bad = await page.evaluate(() => {
      const host = document.getElementById('focus');
      const dock = host.querySelector('.focus-dock').getBoundingClientRect();
      const out = [];
      if (dock.bottom > window.innerHeight + 1) out.push('자세히를 펼치니 아래 버튼이 화면 밖');
      if (host.scrollHeight > host.clientHeight + 2) out.push('자세히를 펼치니 PT 화면이 스크롤');
      return out;
    });
    check(bad.length === 0, `자세히 ${width}×${height}: ${bad.join(' / ')}`);
  }
  await page.setViewportSize({ width: 360, height: 640 });
  await shot('1-rest-detail-360');
  await page.locator('#focus .focus-detail-toggle').click();
  await page.setViewportSize({ width: 390, height: 844 });

  // 종목이 바뀌는 휴식까지 — 남은 세트는 바로 시작해서 한 개씩
  const switching = async () => await focusPhase(page) === 'rest' && (await focusText(page, '.focus-pos')).includes('다음 운동');
  for (let guard = 0; guard < 12 && !(await switching()); guard += 1) {
    const phase = await runUntil(page, ['rest', 'count', 'warm']);
    if (phase === 'rest') {
      if (await switching()) break;
      await ptGo(page, '다음 세트 시작');
    } else if (phase === 'count') {
      for (let i = 0; i < 120 && await reps(page) < 1; i += 1) await page.clock.runFor(500);
      await ptGo(page, '세트 완료');
    } else {
      await skipWarm(page);
    }
    await page.clock.runFor(500);
  }
  check(await switching(), '종목이 바뀌는 휴식까지 못 갔습니다');
  await fits(page, '종목이 바뀌는 휴식', { shot });
  check((await page.locator('#focus .focus-go').textContent()) === '다음 운동 시작', '종목이 바뀌는 휴식 버튼: ' + await page.locator('#focus .focus-go').textContent());
  check(await page.locator('#focus .focus-zoom').count() === 1, '그림에 "크게 보기"가 없습니다');
  await page.setViewportSize({ width: 360, height: 640 });
  await shot('2-switch-360');
}
