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
  // 목록의 몸 풀기 줄 — "시작 전"이 아니라 몇 번째 동작에서 멈췄는지
  const status = (await page.locator('.warm-sheet .warm-status').textContent()).trim();
  check(/^\d+\/\d+ 하다 멈춤$/.test(status), '하다 멈춘 몸 풀기가 목록에서: ' + status);
  check(!status.startsWith('1/'), '몸 풀기를 2분 넘게 했는데 첫 동작으로 나옵니다: ' + status);
  await shot('2-paused');
  await page.locator('.start-cta').click();
  check(await page.locator('dialog[open]').count() === 0, '이어서 하기에 시작 창이 다시 떴습니다');
  check(await focusPhase(page) === 'prep', '이어서 하기가 몸 풀기로 안 돌아갔습니다: ' + await focusPhase(page));
  check((await page.locator('#focus').textContent()).includes('몸 풀기 ' + status.split(' ')[0].replace('/', ' / ')), '이어서 하기가 멈춘 동작이 아닙니다');

  // 3) 다시 켜도 몇 번째에서 멈췄는지 남고, 이어 하면 그 동작부터
  await page.reload();
  await page.waitForTimeout(1000);
  const saved = await page.evaluate(() => (JSON.parse(localStorage.getItem('volume-coach.proto.state') || '{}').settings || {}).ptPrep);
  check(saved && saved.index + 1 === Number(status.split('/')[0]) && !saved.done, '몸 풀기 자리가 저장되지 않았습니다: ' + JSON.stringify(saved));
  // 목록에 나와 보면 그대로 "N/M 하다 멈춤"
  if (await focusPhase(page) !== null) await back(page);
  const after = (await page.locator('.warm-sheet .warm-status').textContent()).trim();
  check(after === status, '다시 켠 뒤 몸 풀기 줄이: ' + after);
  await begin(page);
  await runUntil(page, 'prep');
  await page.clock.runFor(8000);
  check((await page.locator('#focus').textContent()).includes('몸 풀기 ' + status.split(' ')[0].replace('/', ' / ')), '다시 켠 뒤 멈춘 동작부터 잇지 않습니다: ' + (await page.locator('#focus .focus-switch-time, #focus .focus-of').first().textContent()));

  // 4) 몸 풀기를 끝내면(건너뛰어도) 목록에 "시작 전"이 아니다
  await page.locator('#focus .focus-btn', { hasText: '몸 풀기 건너뛰기' }).click();
  await runUntil(page, ['warm', 'count']);
  await back(page);
  const ended = (await page.locator('.warm-sheet .warm-status').textContent()).trim();
  check(ended === '건너뜀' || ended === '끝', '몸 풀기를 마쳤는데 목록에서: ' + ended);
}
