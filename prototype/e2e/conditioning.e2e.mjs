// 목표 다섯 가지 — 체력 기르기(크로스핏식)를 고르면 근력 운동이 짧고 "마무리 · …" 카드가 붙는다
//   → 마지막 종목 뒤에 마무리 운동을 하고 기록하면 남는다 → 쉬는 날 걷기 안내가 보인다
//   → 체지방 감량은 마무리가 유산소다 · 근육 키우기는 붙는 것이 없다
import { check, pickMe, startWorkout, tab } from './lib.mjs';

async function onboardWith(page, persona) {
  await page.waitForSelector('.consent-card');
  const cards = page.locator('.consent-card');
  for (let i = 0; i < await cards.count(); i += 1) {
    const card = cards.nth(i);
    if (await card.locator('.consent-tag.req').count() > 0) {
      const toggle = card.locator('.consent-toggle');
      if (await toggle.getAttribute('aria-pressed') !== 'true') await toggle.click();
    }
  }
  let picked = false;
  for (let i = 0; i < 16; i += 1) {
    const step = (await page.locator('.session-head h2').textContent()).trim();
    if (step === '나에 대해') await pickMe(page);
    const choice = page.locator(`.goal-persona[data-persona="${persona}"]`);
    if (!picked && await choice.count()) {
      // 다섯 가지가 다 있고, 고르면 계획이 어떤 모양인지 한 줄이 붙어 있다
      check(await page.locator('.goal-persona').count() === 5, '자주 고르는 목표가 다섯 개가 아닙니다');
      for (const hint of await page.locator('.goal-persona .choice-hint').allTextContents()) check(/니다\.?$/.test(hint.trim()), '설명이 합니다체가 아닙니다: ' + hint);
      await choice.click();
      check(await page.locator(`.goal-persona[data-persona="${persona}"]`).getAttribute('aria-pressed') === 'true', '고른 표시가 없습니다');
      picked = true;
    }
    const next = page.locator('.wizard-nav .primary');
    const text = (await next.textContent()).trim();
    await next.click();
    if (text === '이 프로그램으로 시작') break;
  }
  check(picked, '처음 설정에 목표 고르기가 없습니다');
  await page.waitForSelector('.tabbar [role="tab"]');
}

export default async function ({ page, url, shot }) {
  await page.clock.install({ time: new Date('2026-10-22T18:00:00+09:00') });
  await page.goto(url);
  await onboardWith(page, 'crossfit');

  // 오늘 목록 — 큰 운동 몇 개 + 마무리 카드
  const rows = await page.locator('.plan-row').count();
  check(rows >= 2 && rows <= 5, '체력 기르기인데 근력 종목이 ' + rows + '개입니다');
  const preview = page.locator('.finisher-card');
  check(await preview.count() === 1, '오늘 목록에 마무리 카드가 없습니다');
  check(/^마무리 · /.test((await preview.locator('h3').textContent()).trim()), '카드 제목: ' + await preview.locator('h3').textContent());
  check((await preview.locator('.finisher-why').textContent()).length > 10, '왜 하는지 한 줄이 없습니다');
  await shot('1-today');

  // 운동 — 세트를 다 하면 마무리 카드가 먼저 온다
  await startWorkout(page);
  await page.waitForSelector('.progress-count');
  for (let i = 0; i < 120; i += 1) {
    if (await page.locator('.finisher-done').count()) break;
    const chip = page.locator('.now-done');
    if (await chip.count()) {
      await chip.first().click();
      const skip = page.locator('#rest-host .rest-skip');
      if (await skip.count() && await skip.first().isVisible()) await skip.first().click();
      continue;
    }
    const next = page.locator('.step-nav .primary');
    if (await next.count()) { await next.first().click(); continue; }
    break;
  }
  check(await page.locator('.finisher-done').count() === 1, '세트를 다 했는데 마무리 운동이 안 나옵니다');
  check(await page.locator('.finisher-skip', { hasText: '오늘은 건너뛰기' }).count() === 1, '건너뛰기가 없습니다');
  await page.locator('.finisher-start').click();
  check(/남은 시간|지난 시간/.test(await page.locator('#finisher-clock').textContent()), '시계가 안 돕니다');
  await shot('2-finisher');

  // 기록 — 와드면 점수 기록 창, 유산소면 바로 남는다
  await page.locator('.finisher-done').click();
  if (await page.locator('dialog[open]').count()) {
    await page.locator('dialog[open] .finish', { hasText: '기록하기' }).click();
    await page.locator('dialog[open] .finish', { hasText: '닫기' }).click();
  }
  await page.waitForSelector('.finisher-state');
  check((await page.locator('.finisher-state').textContent()).includes('마쳤습니다'), '마무리 운동을 했다고 안 남습니다');
  const log = await page.evaluate(() => Object.keys(localStorage).map((key) => localStorage.getItem(key)).join('\n'));
  check(/"finisher":\{[^}]*"status":"done"/.test(log), '마무리 운동 기록이 저장되지 않았습니다');

  // 하루를 닫으면 쉬는 날 걷기 안내
  await page.locator('.finish', { hasText: '오늘 운동 완료' }).click();
  await page.locator('dialog[open] .finish', { hasText: '오늘 마치기' }).click();
  await page.waitForSelector('.rest-day-text');
  check((await page.locator('.rest-day-text').first().textContent()).includes('쉬는 날'), '쉬는 날 안내가 없습니다');

  // 내 정보 › 프로그램 — 마무리 운동 요약 · 쉬는 날 · 주의할 점
  await tab(page, '내 정보');
  const program = page.locator('.sheet', { has: page.locator('h3', { hasText: /^프로그램$/ }) });
  check(await program.locator('.conditioning-summary').count() === 1, '운동 계획에 마무리 운동 요약이 없습니다');
  check(await program.locator('.rest-day-text').count() === 1, '운동 계획에 쉬는 날 안내가 없습니다');
  check(await program.locator('.conditioning-note').count() >= 1, '운동 계획에 주의할 점이 없습니다');

  // 목표를 체지방 감량으로 바꾸면 마무리는 유산소
  await program.getByRole('button', { name: '운동 횟수 · 목표 바꾸기' }).click();
  check(await page.locator('dialog .goal-persona').count() === 5, '목표 바꾸기에 자주 고르는 목표가 없습니다');
  await page.locator('dialog .goal-persona[data-persona="cut"]').click();
  await page.locator('dialog .plan-basics-save').click();
  await page.waitForFunction(() => !document.querySelector('dialog')?.open);
  check((await program.locator('.list-label', { hasText: '운동 뒤 유산소' }).count()) === 1, '감량인데 운동 뒤 유산소가 안 보입니다');
  await shot('3-cut');

  // 근육 키우기 — 붙는 것이 없다
  await program.getByRole('button', { name: '운동 횟수 · 목표 바꾸기' }).click();
  await page.locator('dialog .goal-persona[data-persona="bulk"]').click();
  await page.locator('dialog .plan-basics-save').click();
  await page.waitForFunction(() => !document.querySelector('dialog')?.open);
  check(await program.locator('.conditioning-summary').count() === 0, '근육 키우기인데 마무리 운동이 붙어 있습니다');
}
