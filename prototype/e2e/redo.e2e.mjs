// 헬스장 › 초기 설정 다시 하기 — 확인을 받고, 그만둘 수 있고, 다시 짜도 운동 기록이 남는다
// (전에는 확인 없이 저장소를 통째로 지웠다)
import { check, finishWizard, gymTab, onboard, startWorkout, tab } from './lib.mjs';

async function weekSets(page) {
  await tab(page, '기록');
  // 부위별 막대는 "자세히" 안에 있다
  if (await page.locator('.record-more[aria-expanded="false"]').count()) await page.locator('.record-more').click();
  return page.locator('.gauge-row').count();
}

export default async function ({ page, url, shot }) {
  await page.goto(url);
  await onboard(page);
  await startWorkout(page);
  await page.locator('.now-done').click();
  const before = await weekSets(page);
  check(before > 0, '세트를 했는데 볼륨이 비었습니다');

  // 운동 중에는 막는다 — 끝낸 뒤에
  await gymTab(page);
  await page.getByRole('button', { name: '초기 설정 다시 하기' }).click();
  check((await page.locator('dialog').textContent()).includes('운동 중에는'), '운동 중인데 다시 설정을 열었습니다');
  await page.locator('dialog .modal-close').click();
  await tab(page, '오늘');
  await page.locator('button', { hasText: '운동 끝내기' }).first().click();
  await page.locator('dialog').getByRole('button', { name: '오늘 마치기' }).click();

  // 그대로 두기 — 아무것도 안 바뀐다
  await gymTab(page);
  await page.getByRole('button', { name: '초기 설정 다시 하기' }).click();
  await shot('1-confirm');
  await page.locator('dialog').getByRole('button', { name: '그대로 두기' }).click();
  check(await page.locator('.session-head .steps').count() === 0, '그대로 두기를 눌렀는데 설문이 열렸습니다');

  // 다시 설정하기 → 동의 단계 없이 나에 대해부터, 그만두면 그대로
  await gymTab(page);
  await page.getByRole('button', { name: '초기 설정 다시 하기' }).click();
  await page.locator('dialog .redo-go').click();
  check(await page.locator('.session-head h2').textContent() === '나에 대해', '나에 대해부터가 아닙니다: ' + await page.locator('.session-head h2').textContent());
  await page.locator('.redo-cancel').click();
  check(await page.locator('.tabbar [role="tab"]').count() > 0, '그만뒀는데 앱으로 안 돌아왔습니다');
  check(await weekSets(page) === before, '그만뒀는데 기록이 바뀌었습니다');

  // 끝까지 다시 설정해도 기록은 남는다
  await gymTab(page);
  await page.getByRole('button', { name: '초기 설정 다시 하기' }).click();
  await page.locator('dialog .redo-go').click();
  // 지금 답이 이미 골라져 있으니 그대로 넘어간다
  check(await page.locator('.choice[aria-pressed="true"]', { hasText: /^(초보|중급|고급|전문가)/ }).count() === 1, '지금 단계가 골라져 있지 않습니다');
  await finishWizard(page);
  check(await weekSets(page) === before, '다시 설정했더니 이번 주 기록이 사라졌습니다');
  await page.reload();
  await page.waitForSelector('.tabbar [role="tab"]');
  check(await page.locator('.consent-card').count() === 0, '다시 켰더니 동의를 다시 받습니다');
  check(await weekSets(page) === before, '다시 켰더니 기록이 사라졌습니다');
}
