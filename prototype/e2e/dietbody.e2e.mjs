// 식단 목표 — 키 · 출생 연도 · 활동량(식단 기록 동의 2026-11-28 판, 모두 선택)
//   · 처음 설정 체중 장: 안 적으면 링크 하나뿐이고 아무것도 남지 않는다 / 적으려면 식단 기록 동의가 먼저
//   · 적으면 목표가 키 · 나이 · 성별 · 활동량으로 바뀌고 자세히가 정한 법을 한 줄로 말한다
//   · 내 정보에서 고치면 바로 바뀌고, 칸을 비우면 지운다 · 동의 철회 · 전부 삭제에 같이 지워진다
import { check, finishWizard, tab, walkWizard } from './lib.mjs';

const KEY = 'volume-coach.proto.state';
const saved = (page) => page.evaluate((key) => {
  const raw = localStorage.getItem(key);
  return raw ? JSON.parse(raw) : null;
}, KEY);

export default async function ({ page, url, shot }) {
  await page.clock.install({ time: new Date('2026-11-25T12:30:00+09:00') });

  // ── 1. 안 적는 사람 — 체중 장에는 링크 하나, 칸도 동의도 없다
  await page.goto(url);
  await walkWizard(page, { goal: 'cut', until: 'weight' });
  check(await page.locator('.ob-body-open').count() === 1, '체중 장에 키 · 나이 링크가 없습니다');
  check(await page.locator('.body-input').count() === 0, '동의 전에 키 · 나이 칸이 열려 있습니다');
  await page.locator('#bw').fill('70');
  await finishWizard(page, { goal: 'cut' });
  let store = await saved(page);
  check(!store.settings.bodyInfo, '안 적었는데 키 · 나이가 저장됐습니다');
  check(!(store.settings.consent || []).includes('dietLog'), '안 적었는데 식단 기록 동의가 켜졌습니다');
  check(store.settings.consentRecord.version === '2026-11-28', '동의 판: ' + store.settings.consentRecord.version);

  // ── 2. 적는 사람 — 링크 → 식단 기록 동의 한 줄 → 칸 셋
  await page.evaluate(() => localStorage.clear());
  await page.goto(url);
  await walkWizard(page, { goal: 'cut', until: 'weight' });
  await page.locator('#bw').fill('70');
  await page.locator('.ob-body-open').click();
  check(await page.locator('.body-input').count() === 0, '동의하기 전에 칸이 열렸습니다');
  check(await page.locator('.ob-diet-consent').count() === 1, '식단 기록 동의 줄이 없습니다');
  await page.locator('.ob-diet-consent .consent-view').click();
  const terms = await page.locator('.ob-diet-consent .consent-body').textContent();
  check(terms.includes('출생 연도') && terms.includes('식단 목표 칼로리 계산'), '동의 내용: ' + terms);
  store = await saved(page);
  check(!store.settings.bodyInfo, '동의 전에 저장했습니다');
  await page.locator('.ob-body').scrollIntoViewIfNeeded();
  await shot('1-weight-step-consent');
  await page.locator('.ob-diet-agree').click();
  await page.locator('#ob-body-height').fill('175');
  await page.locator('#ob-body-year').fill('1996');
  await page.locator('.body-act[data-activity="light"]').click();
  check(await page.locator('.body-act[aria-pressed="true"]').count() === 1, '활동량이 안 골라졌습니다');
  for (const [w, h] of [[390, 844], [360, 640]]) {
    await page.setViewportSize({ width: w, height: h });
    const wide = await page.evaluate(() => document.documentElement.scrollWidth);
    check(wide <= w, `${w}px에서 체중 장 가로 ${wide}px`);
    await page.locator('.ob-body').scrollIntoViewIfNeeded();
    await shot(`1-weight-step-${w}`);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await finishWizard(page, { goal: 'cut' });
  store = await saved(page);
  check(store.settings.consent.includes('dietLog'), '식단 기록 동의가 안 남았습니다');
  check(JSON.stringify(store.settings.bodyInfo) === JSON.stringify({ heightCm: 175, birthYear: 1996, activity: 'light' }),
    '저장된 키 · 나이: ' + JSON.stringify(store.settings.bodyInfo));
  check(!JSON.stringify(store.answers || {}).includes('birthYear'), '설문 답(서버로 가는 묶음)에 출생 연도가 들어갔습니다');

  // 식단 — 남성 70kg · 175cm · 30세 · 조금 움직임 · 주 4회: 1,649 × 1.4 ≈ 2,300에서 400 덜 = 1,900kcal
  await tab(page, '식단');
  const unit = await page.locator('.food-kcal-unit').textContent();
  check(unit.includes('1,900kcal'), '키 · 나이로 계산한 목표: ' + unit);
  await page.locator('.food-more-toggle').click();
  const method = await page.locator('.food-method').textContent();
  check(method.includes('키 · 나이 · 성별 · 체중') && method.includes('조금 움직임') && method.includes('주 4회'), '정한 법: ' + method);
  check(await page.locator('.food-body-open').count() === 0, '계산식으로 정했는데 적기 단추가 있습니다');
  for (const [w, h] of [[390, 844], [360, 640]]) {
    await page.setViewportSize({ width: w, height: h });
    await page.locator('.food-method').scrollIntoViewIfNeeded();
    const wide = await page.evaluate(() => document.documentElement.scrollWidth);
    check(wide <= w, `${w}px에서 자세히 가로 ${wide}px`);
    await shot(`2-diet-detail-${w}`);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('.food-more-toggle').click();

  // ── 3. 내 정보에서 고치기 — 몸 쓰는 일로 바꾸면 1,649 × 1.7 ≈ 2,800에서 400 덜 = 2,400kcal
  await tab(page, '내 정보');
  const card = page.locator('.body-info-card');
  check(await card.count() === 1, '내 정보에 키 · 나이 · 활동량 칸이 없습니다');
  check(await card.locator('#me-body-height').inputValue() === '175', '내 정보 키 칸: ' + await card.locator('#me-body-height').inputValue());
  await card.locator('.body-act[data-activity="physical"]').click();
  const preview = await card.locator('.body-preview').textContent();
  check(preview.includes('2,400kcal') && preview.includes('키 · 나이 · 활동량으로 계산'), '바꾼 뒤 미리 보기: ' + preview);
  store = await saved(page);
  check(store.settings.bodyInfo.activity === 'physical', '활동량이 저장 안 됐습니다: ' + JSON.stringify(store.settings.bodyInfo));
  for (const [w, h] of [[390, 844], [360, 640]]) {
    await page.setViewportSize({ width: w, height: h });
    await card.scrollIntoViewIfNeeded();
    const wide = await page.evaluate(() => document.documentElement.scrollWidth);
    check(wide <= w, `${w}px에서 내 정보 가로 ${wide}px`);
    await shot(`3-me-edit-${w}`);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  // 틀린 키는 알리고 담지 않는다 · 비우면 지운다(체중으로 돌아간다)
  await card.locator('#me-body-height').fill('90');
  await card.locator('#me-body-height').blur();
  check((await card.locator('.body-warn').textContent()).includes('130~220cm'), '틀린 키 안내: ' + await card.locator('.body-warn').textContent());
  await card.locator('#me-body-height').fill('');
  await card.locator('#me-body-height').blur();
  check((await card.locator('.body-preview').textContent()).includes('체중으로 어림'), '키를 지웠는데: ' + await card.locator('.body-preview').textContent());
  store = await saved(page);
  check(store.settings.bodyInfo.heightCm === null && store.settings.bodyInfo.birthYear === 1996, '키 지운 뒤: ' + JSON.stringify(store.settings.bodyInfo));
  await tab(page, '식단');
  check((await page.locator('.food-kcal-unit').textContent()).includes('1,800kcal'), '키를 지웠는데 목표가 체중 어림(1,800)이 아닙니다');
  await page.locator('.food-more-toggle').click();
  check((await page.locator('.food-method').textContent()).includes('키를 적으면'), '무엇을 적으면 되는지: ' + await page.locator('.food-method').textContent());
  await page.locator('.food-more-toggle').click();

  // ── 4. 식단 기록 동의를 철회하면 같이 지운다
  await tab(page, '내 정보');
  await page.locator('.body-info-card #me-body-height').fill('180');
  await page.locator('.body-info-card #me-body-height').blur();
  check((await saved(page)).settings.bodyInfo.heightCm === 180, '키를 다시 적었는데 저장이 안 됐습니다');
  await page.locator('.status-row', { hasText: '식단 기록' }).getByRole('button', { name: '철회' }).click();
  store = await saved(page);
  check(!store.settings.bodyInfo, '식단 기록 동의를 철회했는데 키 · 나이가 남았습니다: ' + JSON.stringify(store.settings.bodyInfo));
  check(await page.locator('.body-info-card').count() === 0, '철회했는데 내 정보에 칸이 남았습니다');

  // ── 5. 다시 동의하고 적은 뒤 전부 삭제 — 남지 않는다
  await tab(page, '식단');
  await page.locator('.food-log').getByRole('button', { name: '동의하고 적기 시작' }).click();
  await page.locator('.food-more-toggle').click();
  await page.locator('.food-body-open').click();
  await page.locator('#modal-body-height').fill('175');
  await page.locator('#modal-body-year').fill('1996');
  await page.locator('dialog .body-save').click();
  check((await saved(page)).settings.bodyInfo.heightCm === 175, '자세히에서 적은 키가 저장 안 됐습니다');
  check((await page.locator('.food-kcal-unit').textContent()).includes('1,900kcal'), '자세히에서 적은 뒤 목표: ' + await page.locator('.food-kcal-unit').textContent());
  await tab(page, '내 정보');
  await page.getByRole('button', { name: '전부 삭제' }).click();
  await page.locator('dialog').getByRole('button', { name: '네, 전부 삭제합니다' }).click();
  await page.waitForSelector('.onboarding-head[data-step="goal"]');
  store = await saved(page);
  check(!store || !store.settings || !store.settings.bodyInfo, '전부 삭제했는데 키 · 나이가 남았습니다');
  const anyLeft = await page.evaluate(() => Object.keys(localStorage).some((key) => /birthYear|heightCm/.test(localStorage.getItem(key) || '')));
  check(!anyLeft, '전부 삭제했는데 저장소 어딘가에 키 · 출생 연도가 남았습니다');
}
