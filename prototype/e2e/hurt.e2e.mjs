// 혼자 모드 "아픈 데 있어요" — 무엇을 뺐는지 말하고, 어디가 아픈지 바로 묻는다
// (전에는 말없이 종목이 사라지고 아무것도 묻지 않았다)
import { check, onboard } from './lib.mjs';

export default async function ({ page, url, shot }) {
  await page.goto(url);
  await onboard(page);
  await page.click('.start-cta');
  const first = (await page.locator('.progress-head').textContent()).trim();
  await page.click('.input-mode');   // "무게 어땠어요?"로 묻기
  await page.locator('.feel-row button', { hasText: '아픈 데 있어요' }).click();

  const dialog = page.locator('dialog');
  await dialog.waitFor();
  check((await dialog.locator('.pain-note').textContent()).includes('남은 세트를 뺐습니다'), '무엇을 뺐는지 말하지 않습니다');
  await shot('1-ask');
  // 동의가 없으면 동의부터 — 받은 뒤에도 같은 설명이 남는다
  await dialog.getByRole('button', { name: '통증 기록에 동의하기' }).click();
  check(await dialog.locator('.pain-note').count() === 1, '동의한 뒤 설명이 사라졌습니다');
  await dialog.locator('#pain-shoulder').fill('5');
  await dialog.locator('#pain-shoulder').dispatchEvent('change');
  await dialog.locator('.modal-close').click();
  check((await page.locator('.progress-head').textContent()).trim() !== first, '아픈 종목에 그대로 있습니다');
  await shot('2-after');
}
