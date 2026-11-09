// PT에서도 무게를 바꾼다 — 쉬는 동안 다음 세트 무게를 − / + 로(그 기구에서 만들 수 있는 무게로), 숫자를 누르면 직접.
//   바꾸면 다음 세트가 그 무게로 적히고, 목록에도 그 무게가 보이고, 코치가 바뀐 무게를 말한다. 세는 중에는 보기만.
import { begin, check, choosePt, onboard, runUntil } from './lib.mjs';

const reps = async (page) => {
  const text = await page.locator('#focus-num').textContent().catch(() => '');
  return /^\d+$/.test(text) ? Number(text) : 0;
};
const logged = (page) => page.evaluate(() => (JSON.parse(localStorage.getItem('volume-coach.proto.state') || '{}').settings || {}).todaySets || []);
const kg = (text) => Number(String(text).replace(/[^\d.]/g, ''));

export default async function ({ page, url, shot }) {
  await page.clock.install({ time: new Date('2026-10-22T18:00:00+09:00') });
  await page.goto(url);
  await onboard(page);
  await choosePt(page);
  await begin(page);
  await runUntil(page, 'prep');
  await page.locator('#focus .focus-btn', { hasText: '몸 풀기 건너뛰기' }).click();
  if (await runUntil(page, ['warm', 'count']) === 'warm') {
    await page.locator('#focus .focus-btn', { hasText: '워밍업 건너뛰기' }).click();
    await runUntil(page, 'count');
  }
  // 준비 중에는 바꿀 수 있다
  check(await page.locator('#focus .pt-weight-step').count() === 2, '준비 중에 무게 − / + 가 없습니다');
  for (let i = 0; i < 120 && await reps(page) < 1; i += 1) await page.clock.runFor(500);
  // 세는 중에는 보기만
  check(await page.locator('#focus .pt-weight-step').count() === 0, '세는 중에 무게를 바꿀 수 있습니다');
  check(/kg/.test(await page.locator('#focus .pt-weight-text').textContent()), '세는 중에 무게가 안 보입니다');
  await page.locator('#focus .focus-btn', { hasText: '여기까지' }).click();
  await runUntil(page, 'rest');
  await page.clock.runFor(500);

  // 쉬는 동안 + 한 번 — 다음 세트 무게가 한 칸 오른다
  const before = kg(await page.locator('#focus .pt-weight-now').textContent());
  await page.locator('#focus .pt-weight-step', { hasText: '+' }).click();
  const up = kg(await page.locator('#focus .pt-weight-now').textContent());
  check(up > before, `+를 눌렀는데 무게가 그대로입니다: ${before} → ${up}`);
  // 숫자를 누르면 직접 친다
  await page.locator('#focus .pt-weight-now').click();
  const input = page.locator('#focus .pt-weight-input');
  check(await input.count() === 1, '숫자를 눌렀는데 입력 칸이 안 열립니다');
  const want = before + 5;
  await input.fill(String(want));
  await input.press('Enter');
  await input.blur().catch(() => {});
  await page.clock.runFor(300);
  check(kg(await page.locator('#focus .pt-weight-now').textContent()) === want, '직접 친 무게가 안 들어갔습니다: ' + await page.locator('#focus .pt-weight-now').textContent());
  await page.clock.runFor(2000);
  await shot('1-rest-weight');

  // 목록에도 그 무게
  await page.locator('#focus .focus-more').click();
  const shown = await page.evaluate((w) => {
    const screen = document.getElementById('screen');
    return screen.textContent.includes(w + 'kg') || [...screen.querySelectorAll('input')].some((input) => Number(input.value) === w);
  }, want);
  check(shown, '목록에 바꾼 무게가 안 보입니다');
  await page.locator('.pt-focus-back').click();

  // 다음 세트를 그 무게로 하고 적는다 — 코치도 그 무게를 말한다
  const from = await page.evaluate(() => window.__said.length);
  await page.locator('#focus .focus-btn', { hasText: '바로 시작' }).click();
  await runUntil(page, 'count');
  for (let i = 0; i < 120 && await reps(page) < 1; i += 1) await page.clock.runFor(500);
  const said = (await page.evaluate((n) => window.__said.slice(n), from)).join(' ');
  check(said.includes(String(want).replace('.5', '점') ) || said.includes(want + '킬로'), '코치가 바꾼 무게를 말하지 않았습니다: ' + said.slice(0, 200));
  await page.locator('#focus .focus-btn', { hasText: '여기까지' }).click();
  await page.clock.runFor(500);
  const sets = await logged(page);
  check(sets.length === 2 && sets[1].weightKg === want, '다음 세트가 바꾼 무게로 안 적혔습니다: ' + JSON.stringify(sets));
}
