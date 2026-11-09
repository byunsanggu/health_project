// PT 화면에서 뒤로가기 — 막 시작했으면 없던 일로, 한참 했으면 멈춰 두고 목록 맨 위로.
//   전에는 시작하자마자 뒤로가기를 누르면 목록이 중간쯤(운동 화면에서 내려 둔 자리)에서 뜨고,
//   버튼은 "시작하기"인데 시계는 계속 돌았다. 다시 누르면 0:17부터 몸 풀기 중간으로 들어갔다.
import { begin, check, choosePt, focusPhase, onboard, runUntil } from './lib.mjs';

const back = async (page) => {
  await page.goBack({ waitUntil: 'commit' }).catch(() => null);
  await page.waitForTimeout(300);
};
const view = (page) => page.evaluate(() => ({
  scroll: document.getElementById('screen').scrollTop,
  cta: document.querySelector('.start-cta')?.textContent || null,
  started: (JSON.parse(localStorage.getItem('volume-coach.proto.state') || '{}').settings || {}).sessionStartedAt || null,
  said: (window.__said || []).length,
}));

export default async function ({ page, url, shot }) {
  await page.clock.install({ time: new Date('2026-11-09T18:00:00+09:00') });
  await page.goto(url);
  await onboard(page);
  await choosePt(page);
  const home = page.url();

  // 1) 시작하자마자 뒤로가기 → 시작 취소: 목록 맨 위, "시작하기", 시계 없음, 코치 말 멈춤
  await begin(page);
  await runUntil(page, 'prep');
  await back(page);
  check(await focusPhase(page) === null, 'PT 화면이 안 닫혔습니다');
  const first = await view(page);
  check(first.scroll === 0, '목록이 맨 위가 아닙니다: ' + first.scroll);
  check(first.cta === '시작하기', '막 시작하고 나왔는데 버튼이: ' + first.cta);
  check(!first.started, '시작을 취소했는데 시계가 남았습니다');
  await page.clock.runFor(20000);
  check((await view(page)).said === first.said, '목록에 나왔는데 코치가 계속 말합니다');
  check(page.url() === home, '앱을 나갔습니다');
  await shot('1-cancelled');

  // 2) 몸 풀기를 한참 하다가 뒤로가기 → 멈춤: 목록 맨 위, "이어서 하기", 다시 누르면 그 자리에서
  await begin(page);
  await runUntil(page, 'prep');
  await page.clock.runFor(150000);
  check(await focusPhase(page) === 'prep', '몸 풀기 중이 아닙니다: ' + await focusPhase(page));
  await back(page);
  const second = await view(page);
  check(second.scroll === 0, '멈추고 나온 목록이 맨 위가 아닙니다: ' + second.scroll);
  check(second.cta === '이어서 하기', '멈추고 나왔는데 버튼이: ' + second.cta);
  check(await page.locator('#pt-toast').count() === 1, '"PT를 멈췄습니다" 안내가 없습니다');
  await shot('2-paused');
  await page.locator('.start-cta').click();
  check(await page.locator('dialog[open]').count() === 0, '이어서 하기에 시작 창이 다시 떴습니다');
  check(await focusPhase(page) === 'prep', '이어서 하기가 몸 풀기로 안 돌아갔습니다: ' + await focusPhase(page));
}
