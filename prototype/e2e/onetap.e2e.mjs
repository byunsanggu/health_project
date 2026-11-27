// 알림에서 한 번에 시작 — 알림(약속 · 다시 부르기)이나 앱 아이콘의 "바로 운동 시작"은 ?go=start로 연다.
//   목록을 건너뛰고 곧장 오늘 운동으로: PT면 코치가 시작하고, 소리가 잠긴 폰(아이폰 — 아직 아무도 안 눌렀다)이면
//   큰 "▶ 시작" 하나를 띄워 그 누름으로 소리를 연다. PT를 꺼 둔 사람은 혼자 운동 화면으로.
//   아픈 날 · 마친 날 · 쉬는 날은 오늘 화면을 그냥 연다. 주소에서 go=start는 지운다(새로 고쳐도 또 시작하지 않게).
import { adjustToday, check, choosePt, focusPhase, onboard, runUntil } from './lib.mjs';

/** 사람이 아직 안 누른 폰처럼 — 새 AudioContext는 누를 때(resume)까지 'suspended'. */
const LOCKED_AUDIO = () => {
  const Real = window.AudioContext || window.webkitAudioContext;
  if (!Real) return;
  class Locked extends Real {
    constructor(...args) { super(...args); this.__locked = true; }
    get state() { return this.__locked ? 'suspended' : super.state; }
    resume() { this.__locked = false; return super.resume(); }
  }
  window.AudioContext = Locked;
  window.webkitAudioContext = Locked;
};

const route = (page) => page.evaluate(() => window.__quickRoute);

async function fresh(page, url) {
  // 지운 뒤 떠나기 전에 PT 타이머가 다시 저장하지 않게 이 문서의 쓰기를 막는다
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); Storage.prototype.setItem = function () {}; });
  await page.goto(url);
  await onboard(page);
}

export default async function ({ page, url, shot }) {
  await page.clock.install({ time: new Date('2026-10-22T18:00:00+09:00') });
  await page.addInitScript(LOCKED_AUDIO);
  await page.goto(url);
  await onboard(page);

  // 1. PT를 꺼 둔 사람(기본) — 혼자 운동 화면으로 바로
  await page.goto(url + '?go=start');
  await page.waitForFunction(() => window.__quickRoute);
  check(await route(page) === 'solo', '혼자 모드인데 길이 ' + await route(page));
  await page.waitForSelector('#solo-stage, .warm-skip');
  check(!/go=start/.test(await page.evaluate(() => location.search)), '주소에 go=start가 남았습니다');
  check(await page.locator('#quick-gate').count() === 0, '혼자 모드에 시작 단추를 띄웠습니다');

  // 2. PT — 소리가 잠겨 있으면 큰 "▶ 시작" 하나. 누르면 코치가 시작한다
  await fresh(page, url);
  await choosePt(page);
  await page.goto(url + '?tab=today&go=start');
  await page.waitForFunction(() => window.__quickRoute);
  await page.waitForSelector('#quick-gate');
  check(await route(page) === 'pt', 'PT인데 길이 ' + await route(page));
  check((await page.locator('#quick-gate .quick-go').textContent()).trim() === '▶ 시작', '시작 단추 글자가 다릅니다');
  check(/첫 운동 · /.test(await page.locator('#quick-gate .quick-sub').textContent()), '첫 운동을 알려 주지 않습니다');
  check(await page.evaluate(() => location.search) === '?tab=today', '주소 정리: ' + await page.evaluate(() => location.search));
  await shot('1-gate');
  await page.locator('#quick-gate .quick-go').click();
  check(await page.locator('#quick-gate').count() === 0, '누른 뒤에도 시작 단추가 남았습니다');
  const phase = await runUntil(page, ['prep', 'warm', 'count']);
  check(Boolean(phase), 'PT가 시작하지 않았습니다');
  check(await page.evaluate(() => window.__said.length) > 0, '코치가 말을 꺼내지 않았습니다');
  await shot('2-started');
  // 안드로이드(화면을 꺼도 음악과 같이 나오는 폰)는 화면 켜 두기가 기본 꺼짐
  await page.locator('#focus .focus-menu').click();
  check(await page.locator('dialog .keep-awake-row').getAttribute('aria-pressed') === 'false', '아이폰이 아닌데 화면 켜 두기가 켜져 있습니다');
  await page.locator('dialog .modal-close').click();

  // 3. 이미 운동 중에 알림을 또 눌렀다 — 처음부터 다시 시작하지 않고 그 화면으로
  await page.goto(url + '?go=start');
  await page.waitForFunction(() => window.__quickRoute);
  check(await route(page) === 'resume', '운동 중인데 길이 ' + await route(page));
  check(await page.locator('#quick-gate').count() === 0, '운동 중인데 시작 단추를 또 띄웠습니다');
  check(await page.locator('#focus:not([hidden])').count() === 1, '운동 화면으로 돌아가지 않았습니다');

  // 4. 아픈 날 — 오늘 화면을 그냥 연다(무엇을 뺐는지 사람이 먼저 본다)
  await fresh(page, url);
  await choosePt(page);
  await adjustToday(page);
  await page.locator('dialog .segmented button', { hasText: '있어요' }).click();
  await page.locator('dialog').getByRole('button', { name: '통증 기록에 동의하기' }).click();
  await page.locator('dialog #pain-knee').fill('4');
  await page.locator('dialog #pain-knee').dispatchEvent('change');
  await page.locator('dialog .modal-close').click();
  await page.goto(url + '?go=start');
  await page.waitForFunction(() => window.__quickRoute);
  check(await route(page) === 'today', '아픈 날인데 길이 ' + await route(page));
  check(await page.locator('#quick-gate').count() === 0, '아픈 날에 시작 단추를 띄웠습니다');
  check(await focusPhase(page) === null, '아픈 날인데 운동을 시작했습니다');
  check(await page.locator('.start-cta').isVisible(), '오늘 화면이 아닙니다');
}
