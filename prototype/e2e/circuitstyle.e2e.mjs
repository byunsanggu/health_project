// 체력 기르기 · 서킷 위주 — 목표 카드 바로 아래에서 고르고(장을 늘리지 않는다), 서킷 날에는 오늘 화면이 서킷 한 장이다.
//   그 주의 첫 서킷은 이름 붙은 "기본 서킷 1"(4주마다 같은 구성). "오늘은 근력 운동으로 하기"로 바꾸고, 다시 서킷으로.
//   내 정보 › 프로그램에서 방식을 바꾸면 근력 + 짧은 서킷(마무리 운동이 붙는 원래 방식)으로 돌아간다.
import { check, onboard, tab, walkWizard } from './lib.mjs';

export default async function ({ page, url, shot }) {
  await page.clock.install({ time: new Date('2026-11-23T18:00:00+09:00') }); // 월
  await page.goto(url);
  await walkWizard(page, { until: 'goal' });
  await page.locator('.goal-persona[data-persona="crossfit"]').click();
  const choice = page.locator('.ob-circuit-style');
  await choice.waitFor();
  check((await choice.textContent()).includes('근력 + 짧은 서킷') && (await choice.textContent()).includes('서킷 위주'), '체력 방식 두 칸이 없습니다');
  check(await choice.locator('button[aria-pressed="true"]').textContent() === '근력 + 짧은 서킷', '기본이 근력 + 짧은 서킷이 아닙니다');
  await choice.locator('button', { hasText: '서킷 위주' }).click();
  check((await page.locator('.circuit-style-hint').textContent()).includes('1~2번'), '서킷 위주 설명이 없습니다');
  await page.evaluate(() => document.querySelector('.ob-circuit-style').scrollIntoView({ block: 'center' }));
  await shot('1-goal-style');
  await onboard(page, { days: 3 });

  // 서킷 날 — 오늘 화면이 서킷 한 장, 그 주의 첫 서킷은 기본 서킷 1
  await page.locator('.circuit-card').waitFor();
  check((await page.locator('.circuit-card h3').textContent()).trim() === '기본 서킷 1', '첫 서킷이 기본 서킷 1이 아닙니다');
  check((await page.locator('.circuit-bench-note').textContent()).includes('4주마다'), '4주마다 돌아온다는 말이 없습니다');
  check((await page.locator('.circuit-undo').textContent()).includes('오늘은 근력 운동으로 하기'), '근력으로 바꾸는 링크가 없습니다');
  await shot('2-plan-day');
  await page.locator('.circuit-undo').click();
  await page.locator('.circuit-swap-link').waitFor();
  check(await page.locator('.circuit-card').count() === 0, '근력으로 바꿨는데 서킷 카드가 남았습니다');
  // 서킷 위주의 근력 날에는 마무리 운동을 붙이지 않는다
  check(await page.locator('.finisher-line').count() === 0, '서킷 위주인데 마무리 운동이 붙었습니다');
  await page.locator('.circuit-swap-link').click();
  await page.locator('.circuit-card').waitFor();

  // 내 정보 › 프로그램 — 방식 바꾸기
  await tab(page, '내 정보');
  const meProgram = page.locator('.me-sections button', { hasText: '프로그램' });
  if (await meProgram.count()) await meProgram.click();
  const row = page.locator('.circuit-style-row');
  await row.waitFor();
  check(await row.locator('button[aria-pressed="true"]').textContent() === '서킷 위주', '내 정보에 고른 방식이 안 보입니다');
  await page.evaluate(() => document.querySelector('.circuit-style-row').scrollIntoView({ block: 'center' }));
  await shot('3-me-style');
  await row.locator('button', { hasText: '근력 + 짧은 서킷' }).click();
  await tab(page, '오늘');
  // 오늘 서킷으로 바꿔 둔 것은 그대로(그날 고른 것) — 되돌리면 근력 운동 + 마무리 운동
  if (await page.locator('.circuit-undo').count()) await page.locator('.circuit-undo').click();
  await page.locator('.circuit-swap-link').waitFor();
  check(await page.locator('.finisher-line').count() === 1, '근력 + 짧은 서킷인데 마무리 운동이 없습니다');
}
