// 시즌 · 내 선수 — 오늘 화면의 카드(무대 이름 · 걸음 · 대회까지 며칠), 누르면 사다리 한 장.
//   시즌 끝(대회 당일 다음 날)을 기록으로 꾸며 다시 열면 대회 당일 화면이 한 번 뜨고, "다음 시즌 시작"을 누르면
//   다음 무대 · 새 시즌. 이 기능은 아무것도 서버로 보내지 않는다(요청을 지켜본다).
import { check, onboard } from './lib.mjs';

const DAY = 24 * 3600 * 1000;
const KEY = 'volume-coach.proto.state';

/** 카드가 보이게 — 화면은 수시로 다시 그려져서 요소를 붙잡고 있지 않는다 */
const reveal = (page) => page.evaluate(() => document.querySelector('.season-card').scrollIntoView({ block: 'center' }));

export default async function ({ page, url, shot }) {
  await page.clock.install({ time: new Date('2026-11-09T09:00:00+09:00') }); // 월
  await page.goto(url);
  await onboard(page, { days: 3 });

  // 여기부터 나가는 요청을 본다 — 시즌은 이 폰 안에서만 계산한다
  const local = new URL(url).host;
  const sent = [];
  page.on('request', (req) => {
    const host = new URL(req.url()).host;
    if (host === local || /fonts\.(googleapis|gstatic)\.com$/.test(host)) return;
    if (req.url().startsWith('data:') || req.url().startsWith('blob:')) return;
    sent.push(req.method() + ' ' + req.url());
  });
  page.on('request', (req) => { if (req.method() !== 'GET') sent.push(req.method() + ' ' + req.url()); });

  // 1) 오늘 화면의 카드
  const card = page.locator('.season-card');
  await card.waitFor();
  const stage = (await card.locator('.season-stage').textContent()).trim();
  check(/ Ⅲ$/.test(stage), '첫 시즌은 Ⅲ에서 시작해야 합니다: ' + stage);
  check(/^대회까지 \d+일$/.test((await card.locator('.season-days').textContent()).trim()), '대회까지 며칠이 없습니다');
  check(/Ⅱ까지 \d+점/.test(await card.locator('.season-meta').textContent()), '다음 걸음까지가 없습니다');
  check(await card.locator('canvas').count() === 1, '카드에 선수 그림이 없습니다');
  await reveal(page);
  await shot('1-card-390');

  // 2) 사다리 한 장 — 여섯 칸, 지금 칸 하나, 점수 설명 세 줄, 꾸밈
  await card.click();
  await page.locator('dialog[open] .ladder').waitFor();
  check(await page.locator('dialog[open] .ladder-rung').count() === 6, '사다리가 여섯 칸이 아닙니다');
  check(await page.locator('dialog[open] .ladder-rung.is-now').count() === 1, '지금 칸이 하나가 아닙니다');
  check(await page.locator('dialog[open] .season-rules li').count() === 3, '점수 설명이 세 줄이 아닙니다');
  check(await page.locator('dialog[open] .unlock').count() === 5, '꾸밈 목록이 없습니다');
  const sheetText = await page.locator('dialog[open]').innerText();
  check(!/RIR|1RM|디로드|볼륨|\d{4}-\d{2}-\d{2}/.test(sheetText), '사다리 창에 현장 용어 · 날짜가 있습니다');
  await page.waitForTimeout(300);
  await shot('2-sheet-390');
  await page.setViewportSize({ width: 360, height: 640 });
  await page.waitForTimeout(300);
  await shot('2-sheet-360');
  await page.locator('dialog[open] .modal-close').click();
  await reveal(page);
  await shot('1-card-360');
  await page.setViewportSize({ width: 390, height: 844 });

  // 2-1) 운동 한 세트 → 요약 창에 한 줄 "+10점 · … Ⅱ까지 90점"
  await page.locator('.start-cta').click();
  if (await page.locator('dialog[open] .start-go').count()) await page.locator('dialog[open] .start-go').click();
  if (await page.locator('.warm-skip').count()) await page.locator('.warm-skip').click();
  await page.locator('.now-done').or(page.getByRole('button', { name: /^1세트 완료/ })).first().click();
  await page.goBack({ waitUntil: 'commit' }).catch(() => null);
  await page.waitForSelector('.start-cta');
  await page.locator('#screen button', { hasText: /세트 요약$/ }).click();
  const line = (await page.locator('dialog[open] .season-feedback').textContent()).trim();
  check(/^\+10점 · .+ Ⅱ까지 90점$/.test(line), '요약 창 시즌 한 줄: ' + line);
  await shot('2b-summary-line');
  await page.locator('dialog[open] button', { hasText: '오늘 마치기' }).click();
  for (let i = 0; i < 4 && await page.locator('dialog[open]').count(); i += 1) {
    await page.locator('dialog[open] .modal-close').first().click().catch(() => {});
    await page.waitForTimeout(150);
  }

  // 3) 시즌을 기록으로 채운다 — 매주 약속(주 3회)대로, 피킹 주는 2회. 벤치 무게는 조금씩 오른다
  const season = await page.evaluate((key) => {
    const saved = JSON.parse(localStorage.getItem(key));
    const current = saved.settings.season.current;
    const add = (date, n) => new Date(Date.parse(date + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
    const sessions = [];
    let week = 0;
    for (let monday = current.start; monday <= current.peak; monday = add(monday, 7), week += 1) {
      const count = monday === current.peak ? 2 : 3;
      for (let i = 0; i < count; i += 1) {
        const date = add(monday, i * 2);
        sessions.push({
          id: 'season-' + date, date, updatedAt: date + 'T10:00:00Z',
          sets: [{ exerciseId: 'barbell-bench-press', weightKg: 50 + week * 2.5, reps: 8, rir: 2 }],
        });
      }
    }
    saved.sessions = (saved.sessions || []).concat(sessions);
    localStorage.setItem(key, JSON.stringify(saved));
    return current;
  }, KEY);
  check(season.number === 1, '첫 시즌 번호가 1이 아닙니다: ' + JSON.stringify(season));
  const days = Math.round((Date.parse(season.end) - Date.parse('2026-11-09')) / DAY) + 1;
  check(days > 0, '시즌 끝: ' + JSON.stringify(season) + ' ' + days);
  // 대회 당일 다음 날 아침 — 타이머를 다 돌리지 않고 날짜만 옮긴다
  await page.clock.setSystemTime(new Date(Date.parse('2026-11-09T09:00:00+09:00') + days * DAY));
  await page.reload();

  // 4) 대회 당일 — 화면 가득, 포즈 도중 · 결과 카드
  const overlay = page.locator('.ceremony');
  await overlay.waitFor();
  check((await page.locator('.ceremony-kicker').textContent()).includes('대회 당일 · 시즌 1'), '대회 당일 머리줄이 없습니다');
  await page.waitForTimeout(3800);
  await shot('3-ceremony-pose-390');
  await page.locator('.ceremony-skip').click();
  await page.locator('.ceremony-results').waitFor();
  const outcome = (await page.locator('.ceremony-outcome').textContent()).trim();
  check(/진출!$/.test(outcome), '약속을 다 지켰는데 다음 무대가 아닙니다: ' + outcome);
  check((await page.locator('.ceremony-adherence').textContent()).trim() === '100%', '약속 지킨 비율: ' + await page.locator('.ceremony-adherence').textContent());
  check((await page.locator('.ceremony-strength').textContent()).includes('kg'), '힘 기록이 없습니다');
  check(await page.locator('.ceremony-numbers[aria-pressed="false"]').count() === 1, '공유 그림 숫자는 기본으로 꺼져 있어야 합니다');
  await page.waitForTimeout(600);
  await shot('4-ceremony-result-390');
  await page.setViewportSize({ width: 360, height: 640 });
  await page.waitForTimeout(300);
  await shot('4-ceremony-result-360');
  const nextBox = await page.locator('.ceremony-next').boundingBox();
  check(nextBox && nextBox.y >= 0, '다음 시즌 시작 버튼이 화면 밖입니다');

  // 그림 저장 — 이 폰에 파일로(내려받기). 서버로는 아무것도 가지 않는다
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('.ceremony-save').click()]);
  check(/^my-player-season-1\.png$/.test(download.suggestedFilename()), '저장 파일 이름: ' + download.suggestedFilename());

  await page.locator('.ceremony-next').click();
  await overlay.waitFor({ state: 'detached' });
  await page.setViewportSize({ width: 390, height: 844 });

  // 5) 한 번만 — 다시 열어도 안 뜨고, 카드는 다음 무대 · 새 시즌
  await page.reload();
  await page.locator('.season-card').waitFor();
  await page.waitForTimeout(500);
  check(await page.locator('.ceremony').count() === 0, '대회 당일이 또 뜹니다');
  const saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)).settings.season, KEY);
  check(saved.stage === 1 && saved.pending === null && saved.current && saved.current.number === 2, '다음 시즌 상태: ' + JSON.stringify({ stage: saved.stage, pending: saved.pending, current: saved.current }));
  const after = (await page.locator('.season-card .season-stage').textContent()).trim();
  check(after !== stage && / Ⅲ$/.test(after), '다음 무대로 안 바뀌었습니다: ' + stage + ' → ' + after);
  await reveal(page);
  await shot('5-card-next');

  check(sent.length === 0, '시즌 기능이 밖으로 요청을 보냈습니다: ' + sent.join(' | '));
}
