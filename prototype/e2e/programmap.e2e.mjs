// 내 프로그램 — 기록 › 자세히 맨 위에 지금 과정(이름 · 하는 일 · 주마다 칸 · 이번 주 · 다음), 내 정보 › 프로그램에 짧게.
//   몇 주째 늘지 않는 메인 종목이 있으면 오늘 › 자세히에 처방 하나 — "10% 내려 다시 쌓기"를 누르면 그 종목이 가벼워진다.
import { check, onboard, tab, todayDetail } from './lib.mjs';

const KEY = 'volume-coach.proto.state';

async function openRecordMore(page) {
  await tab(page, '기록');
  const toggle = page.locator('.record-more');
  if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
}

export default async function ({ page, url, shot }) {
  await page.clock.install({ time: new Date('2026-10-22T18:00:00+09:00') });
  await page.goto(url);
  await onboard(page, { level: '중급', days: 4 });

  // 기록 › 자세히 — 첫 과정, 5주 쌓고 한 주 가볍게, 지금 1주차
  await openRecordMore(page);
  const card = page.locator('.sheet.roadmap');
  check(await card.count() === 1, '내 프로그램 카드가 없습니다');
  const title = await card.locator('.roadmap-title').textContent();
  check(/^첫 과정 · /.test(title), '과정 이름: ' + title);
  check(await card.locator('.roadmap-week').count() === 6, '중급은 5주 + 가볍게 하는 주 1 = 6칸이어야 합니다');
  check(await card.locator('.roadmap-week.current').count() === 1, '이번 주 칸이 하나가 아닙니다');
  check((await card.locator('.roadmap-week.current b').textContent()).trim() === '1', '이번 주가 1주차가 아닙니다');
  check((await card.locator('.roadmap-week.deload i').textContent()).includes('가볍게'), '마지막 칸이 가볍게 하는 주가 아닙니다');
  check((await card.locator('.roadmap-week.check i').textContent()).includes('기록 확인'), '기록 확인 주 칸이 없습니다');
  const now = await card.locator('.roadmap-now').textContent();
  check(/^1주차 — /.test(now), '이번 주 줄: ' + now);
  const next = await card.locator('.roadmap-next').textContent();
  check(/2번째 과정/.test(next) && /메인 종목은 그대로/.test(next), '다음 줄: ' + next);
  check(!/블록|디로드|볼륨|RIR|메조/.test(await card.textContent()), '어려운 말이 남았습니다');
  await card.scrollIntoViewIfNeeded();
  await shot('1-record-390');
  await page.setViewportSize({ width: 360, height: 640 });
  await card.scrollIntoViewIfNeeded();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  check(!overflow, '360px에서 가로로 넘칩니다');
  await shot('1-record-360');
  await page.setViewportSize({ width: 390, height: 844 });

  // 내 정보 › 프로그램 — 짧게(이름 · 칸 · 이번 주)
  await tab(page, '내 정보');
  const compact = page.locator('.roadmap.compact');
  check(await compact.count() === 1, '내 정보 프로그램 칸에 지금 과정이 없습니다');
  check(await compact.locator('.roadmap-next').count() === 0, '내 정보에는 다음 줄까지 넣지 않습니다');
  await compact.scrollIntoViewIfNeeded();
  await shot('2-me-390');

  // 메인 종목마다 3주 넘게 같은 무게 · 같은 횟수(60kg × 8회)를 한 기록을 넣는다
  await page.evaluate((key) => {
    const saved = JSON.parse(localStorage.getItem(key));
    const E = window.FitEngine;
    const mains = [];
    saved.program.templates.forEach((template) => template.slots.forEach((slot) => {
      const exercise = E.EXERCISES.find((item) => item.id === slot.exerciseId);
      if (slot.role === 'primary' && exercise && !E.isUnloaded(exercise) && !E.isTimed(exercise) && mains.indexOf(slot.exerciseId) < 0) mains.push(slot.exerciseId);
    }));
    const dates = ['2026-09-28', '2026-10-01', '2026-10-05', '2026-10-08', '2026-10-12', '2026-10-15', '2026-10-19'];
    saved.sessions = (saved.sessions || []).concat(dates.map((date, i) => ({
      id: 'stall-' + i, date, updatedAt: date + 'T10:00:00Z',
      sets: mains.flatMap((id) => [8, 8, 8].map((reps) => ({ exerciseId: id, weightKg: 60, reps, rir: 2 }))),
    })));
    localStorage.setItem(key, JSON.stringify(saved));
  }, KEY);
  await page.reload();
  await page.waitForSelector('.tabbar [role="tab"]');

  // 오늘 › 자세히 — 오늘 하는 메인 하나에 처방
  await tab(page, '오늘');
  await todayDetail(page);
  const tip = page.locator('.plateau-card');
  check(await tip.count() === 1, '늘지 않는 종목 카드가 없습니다');
  const tipText = await tip.textContent();
  check(/주째 60kg × 8회에서 늘지 않았습니다/.test(tipText), '카드: ' + tipText);
  check((await tip.locator('.plateau-yes').textContent()).trim() === '10% 내려 다시 쌓기', '메인 종목 처방이 내려 다시 쌓기가 아닙니다');
  const stalledId = await tip.getAttribute('data-exercise');
  const name = await page.evaluate((id) => window.FitEngine.EXERCISES.find((item) => item.id === id).name, stalledId);
  await tip.scrollIntoViewIfNeeded();
  await shot('3-plateau-390');
  await page.setViewportSize({ width: 360, height: 640 });
  await tip.scrollIntoViewIfNeeded();
  await shot('3-plateau-360');
  await page.setViewportSize({ width: 390, height: 844 });

  const row = page.locator('.plan-row', { has: page.locator('.name', { hasText: name }) }).first();
  const before = await row.textContent();
  await tip.locator('.plateau-yes').click();
  const after = await row.textContent();
  const kg = (text) => Number(((text || '').match(/([\d.]+)\s*kg/) || [0, NaN])[1]);
  check(kg(after) < kg(before) || (Number.isNaN(kg(before)) && kg(after) <= 54), `${name} 무게가 그대로입니다: ${before} → ${after}`);
  check(await page.locator(`.plateau-card[data-exercise="${stalledId}"]`).count() === 0, '처방한 종목 카드가 그대로 있습니다');
  await shot('4-applied');

  // 기록 › 자세히에도 같은 종목은 다시 묻지 않는다 — 저장도 됐다
  await openRecordMore(page);
  check(await page.locator(`.plateau-card[data-exercise="${stalledId}"]`).count() === 0, '기록 탭에 처방한 종목이 또 나옵니다');
  const saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)).settings.plateauFixes, KEY);
  check(saved && saved[stalledId] && saved[stalledId].kind === 'reset', '처방이 저장되지 않았습니다: ' + JSON.stringify(saved));
}
