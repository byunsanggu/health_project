// 혼자 운동 화면(간단히) — 360×740 한 화면에 스크롤 없이, 채운 버튼은 하나. 큰 무게 숫자를 치면 기구 무게로 맞추고,
//   세트를 마치면 같은 화면이 쉬는 시간으로 바뀐다(아래 막대 없이). "바로 다음 세트" · "방금 기록 되돌리기"(5초) ·
//   "자세히 보기 ›"(세트 표, 고른 쪽을 기억) · 종목을 다 하면 "다음 운동: …"
import { check, doneSet, onboard, openDetail, skipRest, startWorkout } from './lib.mjs';

const saved = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('volume-coach.proto.state') || '{}').settings?.todaySets || []);

export default async function ({ page, url, shot }) {
  await page.setViewportSize({ width: 360, height: 740 });
  await page.clock.install({ time: new Date('2026-10-22T18:00:00+09:00') });
  await page.goto(url);
  await onboard(page, { level: '초보', sex: '여성' });
  await startWorkout(page);
  await page.locator('#solo-stage .now-done').waitFor();

  // 한 화면 — 스크롤 없음, 채운 버튼 하나(아래에 붙은 "1세트 완료"), 글자는 13px 이상
  const look = await page.evaluate(() => {
    const screen = document.getElementById('screen');
    const accent = getComputedStyle(document.querySelector('#solo-stage .now-done')).backgroundColor;
    const shown = (node) => { const r = node.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const filled = [...screen.querySelectorAll('button')].filter((b) => shown(b) && getComputedStyle(b).backgroundColor === accent).map((b) => b.textContent.trim());
    const sizes = new Set();
    const walk = document.createTreeWalker(document.getElementById('solo-stage'), NodeFilter.SHOW_TEXT);
    while (walk.nextNode()) { const p = walk.currentNode.parentElement; if (walk.currentNode.textContent.trim() && p && shown(p)) sizes.add(parseFloat(getComputedStyle(p).fontSize)); }
    const go = document.querySelector('#solo-stage .now-done').getBoundingClientRect();
    return { scroll: screen.scrollHeight - screen.clientHeight, filled, sizes: [...sizes], goH: go.height, goBottom: go.bottom, screenBottom: screen.getBoundingClientRect().bottom };
  });
  check(look.scroll <= 1, '간단히 화면이 스크롤됩니다: ' + look.scroll + 'px');
  check(look.filled.length === 1 && look.filled[0] === '1세트 완료', '채운 버튼: ' + JSON.stringify(look.filled));
  check(look.goH >= 56 && look.screenBottom - look.goBottom < 40, '완료 버튼이 아래에 붙은 56px 버튼이 아닙니다: ' + JSON.stringify(look));
  check(look.sizes.every((s) => s >= 13), '13px보다 작은 글자: ' + look.sizes.join(','));
  check(await page.locator('#solo-stage .set-strip').count() === 0, '간단히에 세트 표가 보입니다');
  await shot('1-simple');

  // 무게 숫자를 눌러 친다 — 기구로 만들 수 없는 무게는 맞추고 한 줄로 알린다
  const weight = page.locator('#stage-in-weight');
  await weight.click();
  await weight.fill('5.3');
  await weight.press('Enter');
  const note = (await page.locator('.stage-note').textContent()).trim();
  const snapped = await page.locator('#stage-in-weight').inputValue();
  check(/5\.3kg → .+로 맞췄습니다\./.test(note) && snapped !== '5.3', `맞춘 무게: ${snapped} · ${note}`);
  // − / + 한 칸
  const reps = Number(await page.locator('#stage-in-count').inputValue());
  await page.locator('.stage-tile .pt-num-step[aria-label$="한 칸 올리기"]').last().click();
  check(Number(await page.locator('#stage-in-count').inputValue()) === reps + 1, '횟수 + 한 칸이 안 됩니다');
  await shot('2-snapped');

  // 1세트 완료 → 같은 화면이 쉬는 시간으로
  await page.locator('.now-done').click();
  check(await page.locator('#rest-host').isHidden(), '아래 휴식 막대가 따로 떴습니다');
  check(/^\d+:\d\d$/.test((await page.locator('#solo-stage #rest-remaining').textContent()).trim()), '큰 숫자가 남은 시간이 아닙니다');
  check((await page.locator('#solo-stage .stage-line').textContent()).trim() === '쉬는 중입니다. 다음은 2세트입니다.', '쉬는 중 안내: ' + await page.locator('#solo-stage .stage-line').textContent());
  check(await page.locator('#solo-stage .stage-adjust', { hasText: '+30초' }).count() === 1, '+30초가 없습니다');
  const restGo = page.locator('#solo-stage .rest-now');
  check((await restGo.textContent()).trim() === '바로 다음 세트', '쉬는 중 버튼: ' + await restGo.textContent());
  check(await page.locator('#solo-stage .now-done').count() === 0, '쉬는 중에 완료 버튼이 남았습니다');
  check(await restGo.evaluate((b) => getComputedStyle(b).backgroundColor !== getComputedStyle(document.documentElement).getPropertyValue('--accent')), '쉬는 중 버튼이 채운 버튼입니다');
  check(await page.locator('#solo-stage .undo-link').count() === 1, '방금 기록 되돌리기가 없습니다');
  await shot('3-rest');
  await page.clock.runFor(5500);
  check(await page.locator('#solo-stage .undo-link').count() === 0, '5초가 지났는데 되돌리기가 남았습니다');

  // 바로 다음 세트
  await restGo.click();
  check((await page.locator('.now-done').textContent()).includes('2세트 완료'), '바로 다음 세트 뒤 버튼: ' + await page.locator('.now-done').textContent());
  check((await saved(page)).length === 1, '1세트 기록이 없습니다');

  // 되돌리기 — 방금 2세트를 지우고 2세트 화면으로
  await page.locator('.now-done').click();
  check((await saved(page)).length === 2, '2세트 기록이 없습니다');
  await page.locator('#solo-stage .undo-link').click();
  check((await saved(page)).length === 1, '되돌렸는데 기록이 남았습니다');
  check((await page.locator('.now-done').textContent()).includes('2세트 완료'), '되돌린 뒤 2세트가 아닙니다');

  // 자세히 — 세트 표에서 끝낸 1세트를 고치고, 다시 켜도 자세히가 열려 있다
  await openDetail(page);
  check(await page.locator('#solo-stage .set-strip .set-box').count() >= 3, '자세히에 세트 표가 없습니다');
  check(await page.locator('#solo-stage .set-add', { hasText: '+ 세트' }).count() === 1, '자세히에 + 세트가 없습니다');
  const fixed = page.locator('.set-box.done').first().locator('.set-in-reps');
  await fixed.fill('6');
  await fixed.press('Enter');
  check((await saved(page))[0].reps === 6, '자세히에서 고친 횟수가 기록에 없습니다');
  await shot('4-detail');
  await page.reload();
  await page.locator('#solo-stage').waitFor();
  check(await page.locator('#solo-stage .detail-toggle').getAttribute('aria-expanded') === 'true', '자세히를 기억하지 않습니다');
  await page.locator('#solo-stage .detail-toggle').click();
  check(await page.locator('#solo-stage .set-strip').count() === 0, '간단히로 안 돌아갑니다');

  // 이 종목을 다 하면 다음 종목으로 넘어간다 — 돌아와 보면 "다음 운동: …"
  for (let i = 0; i < 10 && (await page.locator('.progress-count b').textContent()) === '1'; i += 1) await doneSet(page);
  check((await page.locator('.progress-count b').textContent()) === '2', '종목을 다 했는데 넘어가지 않았습니다');
  const second = (await page.locator('.stage-name').textContent()).trim();
  await skipRest(page);
  await openDetail(page);
  await page.locator('#solo-stage .step-nav button', { hasText: '이전 운동' }).click();
  check((await page.locator('#solo-stage .now-next').textContent()).trim() === '다음 운동: ' + second, '다 한 종목의 버튼: ' + await page.locator('#solo-stage .stage-go').first().textContent());
  await shot('5-next');
}
