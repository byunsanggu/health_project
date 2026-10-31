// 시작 전 한 장 · 운동 화면을 단순하게 — 몸은 좋아요가 기본, 시간은 90분까지(넉넉하면 세트를 더한다),
//   혼자 할 때는 박자 세어주기 · 속도 칸이 없다(세어 주는 건 PT), 휴식 시간은 내 정보에서 고른다.
import { check, onboard, startWorkout, tab } from './lib.mjs';

const sets = async (page) => (await page.locator('.plan-row .plan-sets').allTextContents())
  .reduce((sum, line) => sum + Number((line.match(/(\d+)세트/) || [0, 0])[1]), 0);

export default async function ({ page, url, shot }) {
  await page.clock.install({ time: new Date('2026-10-22T18:00:00+09:00') });
  await page.goto(url);
  await onboard(page);

  // 90분 — 평소보다 넉넉하면 큰 복합 운동부터 세트를 더한다
  const before = await sets(page);
  await page.locator('.start-cta').click();
  check(await page.locator('dialog .segmented button[aria-pressed="true"]', { hasText: '좋아요' }).count() === 1, '몸 기본이 좋아요가 아닙니다');
  await page.locator('dialog .segmented button', { hasText: '90분' }).click();
  const said = await page.locator('dialog').textContent();
  check(/세트를 더했습니다/.test(said), '90분인데 더한 게 없습니다: ' + said);
  await shot('1-90');
  await page.locator('dialog .modal-close').click();
  const after = await sets(page);
  check(after > before, `90분인데 세트가 그대로입니다: ${before} → ${after}`);
  check((await page.locator('.today-adjust').textContent()).includes('90분'), '오늘 시간이 안 보입니다');

  // 혼자 하는 운동 화면 — 세어주기 · 속도 칸이 없다
  await startWorkout(page);
  check(await page.locator('.count-panel, .count-start, .count-settings').count() === 0, '혼자인데 세어주기 칸이 있습니다');
  check(!(await page.locator('#screen').textContent()).includes('박자'), '박자 말이 남았습니다');
  check(await page.locator('.lift-more').count() === 1, '종목 ⋯ 메뉴가 없습니다');
  await shot('2-lift');

  // 운동 중에 세트 · 워밍업 더하기 — 세트 칸 끝의 "+ 세트", 워밍업 칸의 "+ 워밍업 한 세트 더"
  const boxes = async () => page.locator('.set-strip .set-box:not(.add)').count();
  const setsBefore = await boxes();
  await page.locator('.set-box.add').click();
  check(await boxes() === setsBefore + 1, '세트를 더했는데 칸이 그대로입니다');
  const warmBefore = await page.locator('.warmup-set').count();
  await page.locator('.warmup-add').click();
  check(await page.locator('.warmup-set').count() === warmBefore + 1, '워밍업을 더했는데 그대로입니다');
  await page.reload();
  await page.waitForSelector('.set-strip');
  check(await boxes() === setsBefore + 1, '다시 켜니 더한 세트가 사라졌습니다');
  check(await page.locator('.warmup-set').count() === warmBefore + 1, '다시 켜니 더한 워밍업이 사라졌습니다');

  // 휴식 시간 — 내 정보에서 고른다
  await tab(page, '내 정보');
  const card = page.locator('.rest-settings');
  check(await card.locator('button[aria-pressed="true"]', { hasText: '보통' }).count() === 1, '휴식 기본이 보통이 아닙니다');
  await card.locator('button', { hasText: '짧게' }).click();
  check((await page.locator('.rest-settings .meta').textContent()).includes('0:45'), '짧게를 골랐는데 범위가 그대로입니다: ' + await page.locator('.rest-settings .meta').textContent());
  await page.reload();
  await tab(page, '내 정보');
  check(await page.locator('.rest-settings button[aria-pressed="true"]', { hasText: '짧게' }).count() === 1, '다시 켜니 휴식 설정이 사라졌습니다');
  await shot('3-rest');
}
