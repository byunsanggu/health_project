// PT 화면에서도 세트를 고친다 — 쉬는 동안 "세트 고치기"를 열면
//   · + 세트 / − 세트 (세는 세트는 안 빠지고, 쉬는 중에는 다음 세트도 뺄 수 있다 → "이번 종목은 여기까지")
//   · 앞에 적은 세트를 골라 무게 · 개수 고치기
//   · 남은 세트의 목표 개수 − / +
//   목록(혼자 화면)과 같은 함수를 쓰므로 목록에도 그대로 보이고, 다시 켜도 남는다. 작은 폰에도 들어간다.
import { begin, check, choosePt, focusPhase, onboard, runUntil } from './lib.mjs';

const reps = async (page) => {
  const text = await page.locator('#focus-num').textContent().catch(() => '');
  return /^\d+$/.test(text) ? Number(text) : 0;
};
const saved = (page) => page.evaluate(() => (JSON.parse(localStorage.getItem('volume-coach.proto.state') || '{}').settings || {}));
const said = (page, from) => page.evaluate((n) => window.__said.slice(n).join(' '), from);
const kg = (text) => Number(String(text).replace(/[^\d.]/g, ''));
const chips = (page) => page.locator('#focus .pt-sets .pt-set-chip');

/** 숫자 칸을 눌러 친다 — 지금 값이 골라져 있어야 하고, Enter로 넣는다. */
async function typeInto(page, field, text) {
  await field.click();
  await page.clock.runFor(50);
  const whole = await field.evaluate((node) => node.selectionStart === 0 && node.selectionEnd === node.value.length);
  check(whole, '칸을 눌렀는데 지금 값이 골라지지 않았습니다');
  await page.keyboard.type(text);
  await page.keyboard.press('Enter');
  await page.clock.runFor(400);
}

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
  // 준비 중에도 "세트 고치기"가 있다(접혀 있다)
  check(await page.locator('#focus .focus-edits .pt-sets-open').count() === 1, '준비 중에 "세트 고치기"가 없습니다');
  // 준비 중에 열어서 + 세트 · − 세트 — 준비 숫자는 그대로 보인다
  await page.locator('#focus .pt-sets-open').click();
  check(await chips(page).count() === 3, '준비 중 세트 고치기에 세트가 3개가 아닙니다');
  check(await page.locator('#focus #focus-num').count() === 1, '세트 고치기를 열었더니 준비 숫자가 사라졌습니다');
  await page.locator('#focus .pt-sets-btn.plus').click();
  check(await chips(page).count() === 4, '준비 중 + 세트가 안 됩니다');
  await page.locator('#focus .pt-sets-btn.minus').click();
  check(await chips(page).count() === 3, '준비 중 − 세트가 안 됩니다');
  await page.locator('#focus .focus-fix', { hasText: '확인' }).click();
  check(await page.locator('#focus .pt-sets').count() === 0, '준비 중 확인을 눌렀는데 안 닫힙니다');
  for (let i = 0; i < 120 && await reps(page) < 1; i += 1) await page.clock.runFor(500);
  // 세는 중에는 없다
  check(await page.locator('#focus .pt-sets-open').count() === 0, '세는 중에 "세트 고치기"가 보입니다');
  // 세는 중에 일시정지 — 같은 화면(종목 · 몇 세트 · 무게), 센 개수에서 멈추고 "▶ 계속"
  await page.locator('#focus .focus-btn', { hasText: '일시정지' }).click();
  check(await focusPhase(page) === 'paused', '세는 중에 멈추지 않았습니다');
  const counted = await page.locator('#focus #focus-num').textContent();
  check(/^\d+$/.test(counted), '멈췄더니 센 개수가 안 보입니다: ' + counted);
  check((await page.locator('#focus .focus-what').textContent()).startsWith('1세트'), '멈췄더니 세트 줄이 사라졌습니다');
  check(/kg/.test(await page.locator('#focus .pt-weight-text').textContent()), '멈췄더니 무게가 사라졌습니다');
  check(await page.locator('#focus .pt-resume', { hasText: '▶ 계속' }).count() === 1, '"▶ 계속"이 없습니다');
  check(await page.locator('#focus .focus-cap.paused', { hasText: '멈춤' }).count() === 1, '원 안에 "멈춤"이 없습니다');
  await page.clock.runFor(20000);
  check(await page.locator('#focus #focus-num').textContent() === counted, '멈췄는데 개수가 올라갔습니다');
  await shot('0-count-paused');
  await page.locator('#focus .pt-resume').click();
  check(await focusPhase(page) === 'count', '계속 뒤에 세기로 안 돌아갔습니다: ' + await focusPhase(page));
  await page.clock.runFor(6000);
  await page.locator('#focus .focus-btn', { hasText: '여기까지' }).click();
  await runUntil(page, 'rest');
  await page.clock.runFor(500);
  const startSets = await chipsAfterOpen(page);
  check(startSets === 3, '처음 세트 수가 3이 아닙니다: ' + startSets);
  const id = (await saved(page)).todaySets[0].exerciseId;
  const extraSets = async () => ((await saved(page)).todayExtras.sets || {})[id] || 0;
  const from = await page.evaluate(() => window.__said.length);

  // + 세트 → 4세트, − 세트 두 번 → 2세트(맨 뒤 안 한 세트부터)
  await page.locator('#focus .pt-sets-btn.plus').click();
  check(await chips(page).count() === 4, '+ 세트 뒤 세트가 4개가 아닙니다');
  check(await extraSets() === 1, '+ 세트가 오늘 것에 안 적혔습니다: ' + await extraSets());
  await page.locator('#focus .pt-sets-btn.minus').click();
  await page.locator('#focus .pt-sets-btn.minus').click();
  check(await chips(page).count() === 2, '− 세트 두 번 뒤 세트가 2개가 아닙니다: ' + await chips(page).count());
  check(await extraSets() === -1, '− 세트가 오늘 것에 안 적혔습니다: ' + await extraSets());
  check((await page.locator('#focus .focus-rest-side .focus-what').textContent()).includes('2세트'), '쉬고 나서 할 세트가 2세트가 아닙니다');

  // 쉬는 중에는 다음 세트도 뺀다 — 이 종목은 여기까지, 쉬고 나서는 다음 종목
  await page.locator('#focus .pt-sets-btn.minus').click();
  check(await chips(page).count() === 1, '쉬는 중에 다음 세트를 못 뺐습니다');
  check(await page.locator('#focus .pt-sets-btn.minus').isDisabled(), '끝낸 세트만 남았는데 − 세트를 누를 수 있습니다');
  await page.clock.runFor(1500);
  check(/여기까지|마감/.test(await said(page, from)), '"이번 종목은 여기까지"를 말하지 않았습니다: ' + await said(page, from));
  check((await page.locator('#focus .focus-pos').textContent()).includes('다음 종목'), '세트를 다 뺐는데 다음 종목으로 안 갑니다');

  // 마음이 바뀌었다 — + 세트를 누르면 다음 종목 대신 이 종목 한 세트 더
  const from2 = await page.evaluate(() => window.__said.length);
  await page.locator('#focus .pt-sets-btn.plus').click();
  await page.clock.runFor(1500);
  check(!(await page.locator('#focus .focus-pos').textContent()).includes('다음 종목'), '+ 세트를 눌렀는데 다음 종목으로 갑니다');
  check(/세트 (하나 )?더|추가/.test(await said(page, from2)), '한 세트 더 한다고 말하지 않았습니다: ' + await said(page, from2));
  check(await chips(page).count() === 2, '+ 세트 뒤 세트가 2개가 아닙니다');

  // 1세트(끝낸 세트)를 골라 무게 + · 개수 + — 기록이 바뀐다
  await chips(page).nth(0).click();
  const before = (await saved(page)).todaySets[0];
  await page.locator('#focus .pt-sets .pt-fix-step', { hasText: '+' }).click();
  await page.locator('#focus .pt-sets .focus-fix-row button', { hasText: '+' }).click();
  const after = (await saved(page)).todaySets[0];
  check(after.weightKg > before.weightKg, `1세트 무게가 안 바뀌었습니다: ${before.weightKg} → ${after.weightKg}`);
  check(after.reps === before.reps + 1, `1세트 개수가 안 바뀌었습니다: ${before.reps} → ${after.reps}`);

  // 2세트(남은 세트)를 골라 목표 개수 + — PT가 세는 끝 숫자와 목록 칸이 같이 오른다
  await chips(page).nth(1).click();
  const repsField = page.locator('#focus .pt-sets input.focus-fix-reps');
  const top = Number(await repsField.inputValue());
  check(await repsField.getAttribute('inputmode') === 'numeric', '횟수 칸이 숫자 자판이 아닙니다');
  await page.locator('#focus .pt-sets .focus-fix-row button', { hasText: '+' }).click();
  check(Number(await repsField.inputValue()) === top + 1, '목표 개수가 안 올랐습니다');
  const edits = (await saved(page)).todayExtras.edits;
  check(edits.some((edit) => edit.key === 'targetReps' && edit.value.max === top + 1) && edits.some((edit) => edit.key === 'reps' && edit.value === top + 1),
    '목표 개수가 오늘 것에 안 적혔습니다: ' + JSON.stringify(edits));
  // 숫자로 친다 — 목표 12회, 무게 62.5kg
  await typeInto(page, repsField, '12');
  check(Number(await repsField.inputValue()) === 12, '친 횟수가 안 들어갔습니다: ' + await repsField.inputValue());
  check((await saved(page)).todayExtras.edits.some((edit) => edit.key === 'targetReps' && edit.value.max === 12), '친 횟수가 오늘 것에 안 적혔습니다');
  const kgField = page.locator('#focus .pt-sets .pt-fix-input');
  check(await kgField.getAttribute('inputmode') === 'decimal', '무게 칸이 숫자 자판이 아닙니다');
  await typeInto(page, kgField, '62.5');
  const nextKg = Number(await kgField.inputValue());
  check(nextKg === 62.5, '친 무게가 안 들어갔습니다: ' + nextKg);
  check(/2세트/.test(await page.locator('#focus .pt-set-chip.picked').textContent()) && /62\.5kg × 12회/.test(await page.locator('#focus .pt-set-chip.picked').textContent()),
    '고른 세트 칸에 무게 · 횟수가 안 보입니다: ' + await page.locator('#focus .pt-set-chip.picked').textContent());
  // 숫자 칸을 누른 채(자판이 열린 채)로도 칸이 화면 안에
  await page.setViewportSize({ width: 360, height: 640 });
  await kgField.click();
  await page.clock.runFor(400);
  const fieldBox = await kgField.boundingBox();
  check(fieldBox && fieldBox.y >= 0 && fieldBox.y + fieldBox.height <= 640, '누른 무게 칸이 화면 밖입니다');
  check(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), '가로 스크롤이 생겼습니다');
  await page.keyboard.press('Escape');
  await kgField.blur();
  await page.clock.runFor(400);

  // 작은 폰에서도 고치는 칸과 아래 단추가 화면 안에
  for (const [width, height] of [[360, 640], [375, 667]]) {
    await page.setViewportSize({ width, height });
    await page.clock.runFor(100);
    const bad = await page.evaluate(() => {
      const vh = window.innerHeight;
      const out = [];
      for (const sel of ['.pt-sets', '.focus-actions', '#focus-rest-time']) {
        const node = document.querySelector('#focus ' + sel);
        const box = node && node.getBoundingClientRect();
        if (!box || box.height === 0) out.push(sel + ' 없음');
        else if (box.bottom > vh + 1 || box.top < -1) out.push(`${sel} ${Math.round(box.top)}~${Math.round(box.bottom)} (화면 ${vh})`);
      }
      if (document.documentElement.scrollWidth > document.documentElement.clientWidth + 1) out.push('가로 스크롤');
      return out;
    });
    check(bad.length === 0, `${width}×${height}: ${bad.join(' / ')}`);
  }
  await shot('1-sets-360');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('#focus .focus-fix', { hasText: '확인' }).click();
  check(await page.locator('#focus .pt-sets').count() === 0, '확인을 눌렀는데 고치는 칸이 안 닫힙니다');

  // 목록에도 그대로 — 2세트, 1세트 기록, 2세트 개수
  await page.locator('#focus .focus-more').click();
  const list = async () => page.evaluate(() => [...document.querySelectorAll('#screen .set-strip .set-box')].map((box) => box.textContent));
  const rows = await list();
  check(rows.length === 2, '목록의 세트가 2개가 아닙니다: ' + JSON.stringify(rows));
  check(await page.evaluate(() => [...document.querySelectorAll('#screen .set-strip input')].some((input) => Number(input.value) === 62.5) ||
    document.querySelector('#screen .set-strip').textContent.includes('62.5')), '목록에 친 무게 62.5kg이 안 보입니다');
  await shot('2-list');

  // 다시 켜도 남는다
  await page.reload();
  await page.waitForTimeout(1500);
  await page.clock.runFor(500);
  await shot('3-reloaded');
  const back = await saved(page);
  check((back.todayExtras.sets || {})[id] === -1, '다시 켠 뒤 세트 수가 달라졌습니다: ' + JSON.stringify(back.todayExtras.sets));
  check(back.todaySets[0].weightKg === after.weightKg && back.todaySets[0].reps === after.reps, '다시 켠 뒤 1세트 기록이 달라졌습니다');
  // PT가 이어서 2세트로 — 2세트 중 2세트, 고친 목표 개수
  const what = await page.locator('#focus .focus-what').textContent();
  check(what.startsWith('2세트 / 2') && what.includes('~12회'), '다시 켠 뒤 2세트 계획이 달라졌습니다: ' + what);
  check(Number(await page.locator('#focus .pt-weight-input').inputValue()) === nextKg, '다시 켠 뒤 2세트 무게가 달라졌습니다');
  await page.locator('#focus .focus-more').click();
  check((await list()).length === 2, '다시 켠 뒤 목록의 세트가 2개가 아닙니다: ' + JSON.stringify(await list()));
}

/** 쉬는 화면의 "세트 고치기"를 열고 세트 번호 개수를 센다. */
async function chipsAfterOpen(page) {
  await page.locator('#focus .focus-logged .focus-fix', { hasText: '세트 고치기' }).click();
  check(await page.locator('#focus .pt-sets').count() === 1, '"세트 고치기"를 눌렀는데 고치는 칸이 안 열립니다');
  return page.locator('#focus .pt-sets .pt-set-chip').count();
}
