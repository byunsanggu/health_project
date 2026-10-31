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

  // 운동 중에 세트 · 워밍업 더하기 — 세트 목록 끝의 "+ 세트", 1세트 위의 "+ 워밍업"
  const boxes = async () => page.locator('.set-strip .set-box').count();
  const setsBefore = await boxes();
  await page.locator('.set-add', { hasText: '+ 세트' }).click();
  check(await boxes() === setsBefore + 1, '세트를 더했는데 칸이 그대로입니다');
  const warmBefore = await page.locator('.warmup-set').count();
  await page.locator('.warmup-add').click();
  check(await page.locator('.warmup-set').count() === warmBefore + 1, '워밍업을 더했는데 그대로입니다');
  await page.reload();
  await page.waitForSelector('.set-strip');
  check(await boxes() === setsBefore + 1, '다시 켜니 더한 세트가 사라졌습니다');

  // 지금 세트(1세트) 무게를 그 줄에서 내리면 아래 세트도 같이 — 아래 큰 칸은 없다
  check(await page.locator('.big-input').count() === 0, '아래 큰 무게 · 횟수 칸이 남았습니다');
  const nowWeight = page.locator('.set-box.now .set-in-weight');
  const want = String(Number(await nowWeight.inputValue()) - 5);
  await nowWeight.fill(want);
  await nowWeight.press('Enter');
  await nowWeight.blur();
  const weights = await page.locator('.set-strip .set-box .set-in-weight').evaluateAll((all) => all.map((one) => one.value));
  check(weights.every((value) => value === want), '1세트를 바꿨는데 아래 세트가 그대로입니다: ' + weights.join(' / '));
  check((await page.locator('.warmup-set').count()) > 0, '1세트 위에 워밍업 줄이 없습니다');

  // 혼자 할 때는 워밍업 줄을 눌러 ✓
  await page.locator('.warmup-set').first().click();
  check(await page.locator('.warmup-set[aria-pressed="true"]').count() === 1, '워밍업 줄을 눌렀는데 ✓가 없습니다');

  // 3세트를 바꾸면 3세트와 그 아래만 — 위의 2세트는 그대로(창 없이)
  const third = page.locator('.set-strip .set-box').nth(2).locator('.set-in-weight');
  await third.fill('50');
  await third.press('Enter');
  await third.blur();
  check(await page.locator('dialog[open]').count() === 0, '남은 세트를 고치는데 창이 떴습니다');
  check((await page.locator('.set-strip .set-box').nth(2).locator('.set-in-weight').inputValue()) === '50', '3세트 무게가 안 바뀌었습니다');
  check((await page.locator('.set-strip .set-box').nth(1).locator('.set-in-weight').inputValue()) !== '50', '고치지 않은 2세트까지 바뀌었습니다');
  check((await page.locator('.set-strip .set-box').nth(3).locator('.set-in-weight').inputValue()) === '50', '3세트 아래 4세트가 안 따라왔습니다');

  // 세트 빼기 — 남은 세트 줄의 ✕, 맨 아래 "− 세트". 다시 켜도 빠진 채로
  const beforeRemove = await boxes();
  await page.locator('.set-strip .set-box .set-remove').last().click();
  await page.locator('.set-add.minus').click();
  check(await boxes() === beforeRemove - 2, '세트를 뺐는데 그대로입니다');
  await page.reload();
  await page.waitForSelector('.set-strip');
  check(await boxes() === beforeRemove - 2, '다시 켜니 뺀 세트가 돌아왔습니다');
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
