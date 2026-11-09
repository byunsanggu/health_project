// 버티기(플랭크) — 반복이 아니라 초로 센다.
//   혼자: 세트 칸 · 목표 · 목록이 "초"로 쓰이고, 세트 줄 아래 "버티기 시작"이 3초 준비 뒤 목표 초부터 화면에서 줄여 간다.
//   끝까지 가면 목표 초가, 중간에 "여기서 멈추기"를 누르면 버틴 초가 칸에 들어간다. 숫자는 손으로 고쳐도 된다.
//   PT: 개수 대신 남은 초를 크게 보여 주고, 시작 · 절반 · 5초 전 · 넷 셋 둘 하나 · 끝을 말한 뒤 버틴 초를 적고 쉰다.
import { begin, check, choosePt, onboard, runUntil, startWorkout } from './lib.mjs';

const saved = (page) => page.evaluate(() => (JSON.parse(localStorage.getItem('volume-coach.proto.state') || '{}').settings || {}));

/** 편집 › 종목 추가에서 플랭크를 넣고 맨 앞으로 옮긴다 */
async function plankFirst(page) {
  await page.locator('.list-edit').click();
  await page.locator('.head-actions .demo-open', { hasText: '종목 추가' }).click();
  await page.locator('dialog input[type=search]').fill('플랭크');
  await page.locator('dialog .add-lift-row', { hasText: /^플랭크/ }).first().click();
  if (await page.locator('dialog[open]').count()) await page.locator('dialog[open] .modal-close').first().click().catch(() => {});
  const row = page.locator('.plan-row', { has: page.locator('.name', { hasText: /^플랭크/ }) }).first();
  await row.locator('.row-menu').click();
  await page.locator('dialog .menu-row', { hasText: /맨 앞으로|이것부터 하기/ }).click();
  const first = (await page.locator('.plan-row .name').first().textContent()).trim();
  check(/^플랭크/.test(first), '플랭크가 맨 앞이 아닙니다: ' + first);
}

export default async function ({ page, url, shot }) {
  await page.clock.install({ time: new Date('2026-10-22T18:00:00+09:00') });
  await page.goto(url);
  await onboard(page, { level: '초보', sex: '여성' });
  await plankFirst(page);

  // 목록 줄 — "회"가 아니라 "초"
  const line = (await page.locator('.plan-row', { has: page.locator('.name', { hasText: /^플랭크/ }) }).first().textContent()).replace(/\s+/g, ' ');
  check(/\d+~\d+초|\d+초/.test(line) && !/\d+~\d+회/.test(line), '목록 줄: ' + line);

  // 혼자 — 세트 칸 · 목표가 초
  await startWorkout(page);
  const head = (await page.locator('.set-strip-head').first().textContent()).trim();
  const range = head.match(/목표 (\d+)~(\d+)초/);
  check(range, '목표가 초가 아닙니다: ' + head);
  const target = Number(range[2]);
  const units = await page.locator('.set-box.now .set-unit').allTextContents();
  check(units.includes('초') && !units.includes('회'), '지금 세트 단위: ' + units.join(','));
  check(await page.locator('.set-box.now .set-in-reps').getAttribute('aria-label') === '1세트 버틴 초', '횟수 칸 이름');
  const start = page.locator('.hold-start');
  check(await start.count() === 1, '버티기 시작 버튼이 없습니다');
  check((await start.textContent()).includes(target + '초'), '시작 버튼: ' + await start.textContent());
  await shot('1-solo-hold');

  // 끝까지 — 3초 준비 → 목표 초부터 줄어든다 → 다 버티면 목표 초가 칸에
  await start.click();
  await page.clock.runFor(3000 + 5000 + 200);
  const shown = (await page.locator('#count-now').textContent()).trim();
  check(shown === (target - 5) + '초', `5초 버틴 뒤 남은 초: ${shown} (목표 ${target})`);
  check((await page.locator('#count-say').textContent()).includes('남음'), '남은 초라고 쓰지 않습니다');
  await shot('2-solo-counting');
  await page.clock.runFor((target - 5) * 1000 + 1500);
  check(await page.locator('#count-now').count() === 0, '다 버텼는데 세기가 안 끝났습니다');
  check(Number(await page.locator('.set-box.now .set-in-reps').inputValue()) === target, '다 버틴 초가 칸에 안 들어갔습니다: ' + await page.locator('.set-box.now .set-in-reps').inputValue());
  await page.locator('.now-done').click();
  const after = await saved(page);
  const logged = (after.todaySets || []).filter((set) => set.exerciseId === 'plank');
  check(logged.length === 1 && logged[0].reps === target, '기록: ' + JSON.stringify(logged));
  if (await page.locator('#rest-host .rest-skip', { hasText: '건너뛰기' }).count()) await page.locator('#rest-host .rest-skip', { hasText: '건너뛰기' }).click();

  // 끝낸 줄 — "맨몸 × 30초 ✓"
  const doneText = (await page.locator('.set-box.done').first().textContent()).replace(/\s+/g, ' ');
  check(doneText.includes('초') && !/\d+회/.test(doneText), '끝낸 줄: ' + doneText);

  // 중간에 멈추기 — 버틴 초만
  await page.locator('.hold-start').click();
  await page.clock.runFor(3000 + 12000 + 200);
  await page.locator('.hold-stop').click();
  check(Number(await page.locator('.set-box.now .set-in-reps').inputValue()) === 12, '멈춘 자리: ' + await page.locator('.set-box.now .set-in-reps').inputValue());
  // 손으로 고치기
  await page.locator('.set-box.now .set-in-reps').fill('18');
  await page.locator('.set-box.now .set-in-reps').press('Enter');
  await page.locator('.set-box.now .set-in-reps').blur().catch(() => {});
  await page.clock.runFor(200);
  await page.locator('.now-done').click();
  const second = ((await saved(page)).todaySets || []).filter((set) => set.exerciseId === 'plank');
  check(second.length === 2 && second[1].reps === 18, '고친 초: ' + JSON.stringify(second));
  await shot('3-solo-done');

  // PT — 남은 초를 크게, 시작 · 절반 · 5초 전 · 넷 셋 둘 하나 · 끝을 말하고 버틴 초를 적는다
  if (await page.locator('#rest-host .rest-skip', { hasText: '건너뛰기' }).count()) await page.locator('#rest-host .rest-skip', { hasText: '건너뛰기' }).click();
  await choosePt(page);
  await page.evaluate(() => { window.__said.length = 0; });
  if (await page.locator('.start-cta').count()) await begin(page);
  await runUntil(page, 'count', { maxMs: 400000, stepMs: 1000 });
  // 시작 말이 나올 때까지 — 남은 초가 숫자로 뜬다
  for (let i = 0; i < 60 && !/^\d+$/.test(((await page.locator('#focus-num').textContent().catch(() => '')) || '').trim()); i += 1) await page.clock.runFor(1000);
  const of = (await page.locator('#focus .focus-of').first().textContent()).trim();
  check(of === '초 남음', 'PT 화면: ' + of);
  const left = Number((await page.locator('#focus-num').textContent()).trim());
  check(left > 0 && left <= target, 'PT 남은 초: ' + left);
  await shot('4-pt-hold');
  await runUntil(page, ['rest', 'ask', 'cool', 'other'], { maxMs: 120000, stepMs: 1000 });
  const said = await page.evaluate(() => window.__said.join(' / '));
  check(/초 버티겠습니다\. 시작하세요\./.test(said), '시작 말이 없습니다: ' + said.slice(-400));
  check(said.includes('절반 지났습니다'), '절반 말이 없습니다: ' + said.slice(-400));
  check(said.includes('5초 남았습니다') || said.includes('오 초 남았습니다'), '5초 전 말이 없습니다: ' + said.slice(-400));
  check(/넷 \/ 셋 \/ 둘 \/ 하나/.test(said), '마지막 넷 셋 둘 하나가 없습니다: ' + said.slice(-400));
  check(said.includes('끝입니다'), '"끝" 말이 없습니다: ' + said.slice(-400));
  check(!/개 하셨|같은 무게로/.test(said), '버티기에 개수 · 무게 말: ' + said.slice(-400));
  const pt = ((await saved(page)).todaySets || []).filter((set) => set.exerciseId === 'plank');
  check(pt.length === 3 && pt[2].reps > 0, 'PT가 버틴 초를 안 적었습니다: ' + JSON.stringify(pt));
  await shot('5-pt-after');
}
