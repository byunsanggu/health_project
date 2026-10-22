// 처음 설정 — 단계와 성별을 고르기 전에는 넘어가지 않는다 (전에는 중급 · 남성 78kg이 미리 골라져 있었다)
import { check, finishWizard } from './lib.mjs';

export default async function ({ page, url, shot }) {
  await page.goto(url);
  await page.waitForSelector('.consent-card');
  const cards = page.locator('.consent-card');
  for (let i = 0; i < await cards.count(); i += 1) {
    if (await cards.nth(i).locator('.consent-tag.req').count()) await cards.nth(i).locator('.consent-toggle').click();
  }
  await page.click('.wizard-nav .primary');

  // 경력 — 아무것도 안 골라져 있고, 다음이 막혀 있다
  check(await page.locator('.choice[aria-pressed="true"]').count() === 0, '단계가 미리 골라져 있습니다');
  check(await page.locator('.wizard-nav .primary').isDisabled(), '단계를 안 골랐는데 넘어갈 수 있습니다');
  await shot('1-level');
  await page.locator('.choice', { hasText: '초보' }).first().click();
  check(await page.inputValue('#months') === '3', '초보를 골랐는데 기간이 ' + await page.inputValue('#months'));
  await page.click('.wizard-nav .primary');

  // 내 정보 — 성별을 고르기 전에는 막혀 있고, 여성을 고르면 체중이 58에서 시작한다
  check(await page.locator('.wizard-nav .primary').isDisabled(), '성별을 안 골랐는데 넘어갈 수 있습니다');
  await page.locator('.segmented button', { hasText: '여성' }).click();
  check(await page.inputValue('#bw') === '58', '여성을 골랐는데 체중이 ' + await page.inputValue('#bw'));
  await finishWizard(page, { level: '초보', sex: '여성' });
  // 초보 프로그램 — 바벨 데드리프트 · 백 스쿼트로 시작하지 않는다
  const plan = await page.locator('#screen').textContent();
  check(!/컨벤셔널 데드리프트|백 스쿼트/.test(plan), '초보인데 바벨 스쿼트 · 데드리프트가 들었습니다');
}
