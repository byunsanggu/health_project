// PT 쉬는 화면 — 방금 적은 세트가 보이고 그 자리에서 고친다 · 쉬는 중에도 일시정지(멈춰 두면 다음 세트를 세지 않는다)
//   · 코치가 한 말이 화면에 자막으로 남는다 · 처음 세는 세트에서 "여기까지"를 알려 준다
//   · 엔진이 "여기서 멈추라"고 하면 정말로 그 종목을 마친다("여기까지" 뒤에 "3세트 가겠습니다"가 없다)
import { begin, check, choosePt, focusPhase, onboard, runUntil } from './lib.mjs';

const reps = async (page) => {
  const text = await page.locator('#focus-num').textContent().catch(() => '');
  return /^\d+$/.test(text) ? Number(text) : 0;
};

async function countTo(page, n) {
  for (let i = 0; i < 240 && await reps(page) < n; i += 1) await page.clock.runFor(500);
  check(await reps(page) >= n, `${n}개까지 세지 않았습니다`);
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
    // 처음 하는 종목 — 세팅 순서는 워밍업 앞에서(워밍업을 다 하고 나서가 아니라). 자막에도 남는다
    const said = await page.evaluate(() => window.__said.join(' '));
    check(/세팅부터/.test(said), '첫 워밍업 앞에서 세팅을 말하지 않았습니다: ' + said.slice(-300));
    check(/세팅부터/.test(await page.locator('#focus-say').textContent()), '자막에 코치 말이 없습니다');
    await page.locator('#focus .focus-btn', { hasText: '워밍업 건너뛰기' }).click();
    await runUntil(page, 'count');
  }
  // 처음 세는 세트 — 다 못 하면 "여기까지"를 누르라고 말하고 화면에도
  check((await page.locator('#focus .focus-hint').textContent()).includes('여기까지'), '"여기까지" 안내가 화면에 없습니다');
  check((await page.evaluate(() => window.__said.join(' '))).includes('여기까지'), '"여기까지" 안내를 말하지 않았습니다');
  const setupSaid = (await page.evaluate(() => window.__said.join(' '))).split('세팅부터').length - 1;
  check(setupSaid <= 1, '세팅 순서를 두 번 말했습니다');

  // 1세트는 끝까지(10개), 2세트는 네 개에서 "여기까지" — 반복이 무너졌으니 엔진은 여기서 멈추라고 한다
  await countTo(page, 1);
  await runUntil(page, 'rest', { maxMs: 120000, stepMs: 500 });
  await page.clock.runFor(500);

  // 방금 적은 세트가 쉬는 화면에 — 고치기로 그 자리에서 고친다
  const logged = page.locator('#focus .focus-logged');
  check(/방금 1세트 .* × \d+회 기록/.test(await logged.textContent()), '방금 적은 세트가 안 보입니다: ' + await logged.textContent());
  const before = Number((await logged.textContent()).match(/× (\d+)회/)[1]);
  await logged.locator('.focus-fix').click();
  await page.locator('#focus .focus-fix-row button', { hasText: '−' }).click();
  check((await page.locator('#focus input.focus-fix-reps').inputValue()) === String(before - 1), '고친 개수가 안 보입니다');
  const savedReps = await page.evaluate(() => (JSON.parse(localStorage.getItem('volume-coach.proto.state') || '{}').settings || {}).todaySets.map((set) => set.reps));
  check(savedReps.includes(before - 1), '고친 개수가 기록에 안 들어갔습니다: ' + JSON.stringify(savedReps));
  await page.locator('#focus .focus-fix', { hasText: '확인' }).click();
  await shot('1-rest-logged');

  // 쉬는 동안 코치가 방금 세트 이야기를 한다(보통) — 세트 뒤 말이 끝난 다음에
  await page.clock.runFor(20000);
  const restTalk = await page.evaluate(() => window.__said.join(' '));
  check(/목표 \d+개 중|다 채우셨습니다|목표 안에|마지막 두 개/.test(restTalk), '쉬는 동안 방금 세트 이야기를 안 했습니다: ' + restTalk.slice(-200));

  // 쉬는 중에도 일시정지 — 다른 화면으로 가지 않고 쉬는 화면 그대로, 남은 시간이 멈춘다. 다음 세트를 세지 않는다
  await page.locator('#focus .focus-btn', { hasText: '일시정지' }).click();
  check(await focusPhase(page) === 'paused', '쉬는 중에 멈추지 않았습니다');
  const frozen = await page.locator('#focus-rest-time').textContent();
  check(await page.locator('#focus .pt-weight-input').count() === 1, '멈췄더니 다음 세트 무게 칸이 사라졌습니다');
  check(await page.locator('#focus .focus-title-text b').textContent() !== '', '멈췄더니 종목 이름이 사라졌습니다');
  check(await page.locator('#focus .focus-cap.paused', { hasText: '멈춤' }).count() === 1, '멈춘 화면에 "멈춤"이 없습니다');
  check(await page.locator('#focus .pt-resume', { hasText: '▶ 계속' }).count() === 1, '일시정지 단추가 "▶ 계속"으로 안 바뀌었습니다');
  check(!(await page.locator('#focus').textContent()).includes('PT 일시정지'), '따로 된 일시정지 화면이 떴습니다');
  await shot('2b-rest-paused');
  await page.clock.runFor(300000);
  check(await focusPhase(page) === 'paused', '멈춰 뒀는데 ' + await focusPhase(page));
  check(await page.locator('#focus-rest-time').textContent() === frozen, '멈춰 둔 휴식 시간이 흘렀습니다: ' + frozen + ' → ' + await page.locator('#focus-rest-time').textContent());
  await page.locator('#focus .focus-btn', { hasText: '계속' }).click();
  check(await focusPhase(page) === 'rest', '계속 뒤에 쉬는 시간으로 안 돌아갔습니다: ' + await focusPhase(page));
  await runUntil(page, 'count', { maxMs: 300000 });
  check((await page.locator('#focus .focus-what').textContent()).startsWith('2세트'), '계속 뒤가 2세트가 아닙니다');

  // 2세트 — 네 개에서 "여기까지"
  await countTo(page, 4);
  const from = await page.evaluate(() => window.__said.length);
  await page.locator('#focus .focus-btn', { hasText: '여기까지' }).click();
  await page.clock.runFor(500);
  const after = (await page.evaluate((n) => window.__said.slice(n), from)).join(' ');
  check(/여기서 마치|여기까지/.test(after), '멈추라는 말이 없습니다: ' + after);
  check(!/3세트/.test(after), '"여기까지" 뒤에 3세트를 하자고 했습니다: ' + after);
  check(await focusPhase(page) === 'rest', '멈춘 뒤 ' + await focusPhase(page));
  const what = await page.locator('#focus .focus-what').textContent();
  check(!/→ 3세트/.test(what), '화면은 여전히 3세트를 합니다: ' + what);
  check((await page.locator('#focus .focus-pos').textContent()).includes('다음 종목'), '다음 종목으로 넘어가지 않았습니다');
  // 종목이 바뀌는 휴식도 남은 시간이 맨 위에
  const time = await page.locator('#focus-rest-time').boundingBox();
  check(time && time.y + time.height <= 844, '쉬는 시간이 화면 밖에 있습니다');
  await shot('2-stopped');

  // 다시 켜도 뺀 세트는 돌아오지 않는다 — 오늘 것에 적혀 있고, PT는 다음 종목부터
  const settings = () => page.evaluate(() => JSON.parse(localStorage.getItem('volume-coach.proto.state') || '{}').settings || {});
  const id = (await settings()).todaySets[0].exerciseId;
  check(((await settings()).todayExtras.sets || {})[id] < 0, '멈춘 세트가 오늘 것에 안 적혔습니다: ' + JSON.stringify((await settings()).todayExtras));
  await page.reload();
  await page.waitForTimeout(1000);
  await page.clock.runFor(500);
  if (await focusPhase(page) === null && await page.locator('.start-cta').count()) await begin(page);
  await runUntil(page, ['warm', 'count', 'rest'], { maxMs: 20000 });
  check((await page.locator('#focus .focus-pos').textContent()).includes('2 /'), '다시 켰더니 멈춘 종목으로 돌아갔습니다: ' + await page.locator('#focus .focus-title').textContent());
}
