// 백업 — 내려받은 파일로 되찾는다. 전부 지운 뒤 처음 설정의 동의 화면에서 불러오면 설문 없이 이어 하고,
//   내 정보에서 불러오면 빠진 날만 채운다. 통증 · 식단은 지금 그 항목에 동의했을 때만 들어온다.
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { check, choosePt, onboard, startWorkout, tab } from './lib.mjs';

async function chooseFile(page, button, path) {
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), button.click()]);
  await chooser.setFiles(path);
}

async function historyRows(page) {
  await tab(page, '기록');
  return page.locator('.history-row').allTextContents();
}

export default async function ({ page, url, shot, out }) {
  // 수요일에 시작해서 두 세트 하고 마친다 · 코치는 PT 빡세게
  await page.clock.install({ time: new Date('2026-10-21T18:00:00+09:00') });
  await page.goto(url);
  await onboard(page);
  await choosePt(page);
  await tab(page, '내 정보');
  await page.locator('.coach-settings .coach-style', { hasText: '빡세게' }).click();
  await page.locator('.coach-settings .coach-mode', { hasText: '혼자' }).click();
  await tab(page, '오늘');
  await startWorkout(page);
  await page.locator('.now-done').click();
  await page.locator('#rest-host .rest-skip', { hasText: '건너뛰기' }).click();
  await page.locator('.now-done').click();
  await page.locator('button', { hasText: '운동 끝내기' }).first().click();
  await page.locator('dialog').getByRole('button', { name: '오늘 마치기' }).click();

  // 다음 날 내려받는다
  await page.clock.setSystemTime(new Date('2026-10-22T18:00:00+09:00'));
  await page.reload();
  await tab(page, '내 정보');
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: '내 데이터 내려받기' }).click(),
  ]);
  check(download.suggestedFilename() === 'volume-coach-backup-2026-10-22.json', '파일 이름: ' + download.suggestedFilename());
  const file = join(out, 'backup-mine.json');
  await download.saveAs(file);
  const saved = JSON.parse(await readFile(file, 'utf8'));
  check(saved['형식'] === 2 && saved['설정'] && saved['설정'].startedOn === '2026-10-21', '설정 칸: ' + JSON.stringify(saved['설정']).slice(0, 120));
  check(saved['운동기록'].some((day) => day.date === '2026-10-21' && day.sets.length === 2), '어제 운동이 파일에 없습니다');

  // 전부 지운다 → 처음 설정
  await page.getByRole('button', { name: '전부 삭제' }).click();
  await page.locator('dialog').getByRole('button', { name: '네, 전부 삭제합니다' }).click();
  await page.waitForSelector('.consent-card');

  // 남의 파일은 이유를 말하고 아무것도 안 바꾼다
  const junk = join(out, 'backup-junk.json');
  await writeFile(junk, '{"name": "다른 앱"}');
  await chooseFile(page, page.locator('.backup-pick'), junk);
  check((await page.locator('dialog .backup-error').textContent()).includes('백업 파일이 아닙니다'), '남의 파일인데 이유가 없습니다');
  await page.locator('dialog .modal-close').click();

  // 동의 화면에서 불러온다 — 필수만 동의하고 이어 한다
  await chooseFile(page, page.locator('.backup-pick'), file);
  const ready = await page.locator('.backup-ready').textContent();
  check(/운동 기록\s*1일 · 본세트 2개/.test(ready), '불러온 내용: ' + ready);
  check(ready.includes('설문 답 · 프로그램 들어 있음'), '프로그램이 없다고 합니다: ' + ready);
  await shot('1-ready');
  check(await page.locator('.wizard-nav .primary').isDisabled(), '동의 전에 이어 할 수 있습니다');
  const cards = page.locator('.consent-card');
  for (let i = 0; i < await cards.count(); i += 1) {
    const card = cards.nth(i);
    if (await card.locator('.consent-tag.req').count()) await card.locator('.consent-toggle').click();
  }
  check((await page.locator('.wizard-nav .primary').textContent()).trim() === '동의하고 이어 하기', '이어 하기 버튼이 아닙니다');
  await page.locator('.wizard-nav .primary').click();

  // 설문 없이 바로 앱 — 무엇을 들였는지 말한다
  await page.waitForSelector('.tabbar [role="tab"]');
  await page.locator('dialog .backup-report').first().waitFor();
  const report = await page.locator('dialog').textContent();
  check(report.includes('운동 기록 1일'), '알림: ' + report);
  await shot('2-report');
  await page.locator('dialog .modal-close').click();
  await tab(page, '내 정보');
  check(await page.locator('.coach-settings .coach-mode[aria-pressed="true"]', { hasText: '혼자' }).count() === 1, '운동 방식이 백업 때와 다릅니다');
  let rows = await historyRows(page);
  check(rows.length === 1 && rows[0].includes('10월 21일 (수)') && rows[0].includes('2세트'), '진행 탭: ' + rows.join(' / '));

  // 다시 켜도 남는다
  await page.reload();
  rows = await historyRows(page);
  check(rows.length === 1 && rows[0].includes('10월 21일'), '다시 켰더니: ' + rows.join(' / '));

  // 내 정보에서 다른 백업을 합친다 — 빠진 날만, 같은 날은 이 폰 것을 둔다, 동의 안 한 통증 · 식단은 뺀다
  const more = JSON.parse(JSON.stringify(saved));
  more['운동기록'].push({ id: 'old-1', date: '2026-10-15', sets: [{ exerciseId: 'leg-press', weightKg: 100, reps: 10, rir: 2 }] });
  more['운동기록'].push({ id: 'dup', date: '2026-10-21', sets: Array(5).fill({ exerciseId: 'leg-press', weightKg: 100, reps: 10, rir: 2 }) });
  more['체크인'].push({ id: 'old-c', date: '2026-10-15', bodyweightKg: 77.5, pain: [{ joint: 'knee', score: 4 }] });
  more['식단기록'] = [{ id: 'f1', date: '2026-10-15', meal: 'lunch', name: '제육볶음', grams: 300, amount: '1인분', kcal: 600, protein: 35, fat: 30, carbs: 40 }];
  const merged = join(out, 'backup-more.json');
  await writeFile(merged, JSON.stringify(more));
  await tab(page, '내 정보');
  await chooseFile(page, page.getByRole('button', { name: '백업 불러오기' }), merged);
  // 파일 안의 같은 날(10월 21일 두 번)은 세트가 많은 쪽 — 그래도 이 폰에 있는 날이라 합칠 때는 이 폰 것을 둔다
  const toMerge = await page.locator('dialog .backup-rows').textContent();
  check(toMerge.includes('2일 · 본세트 6개'), '합칠 내용: ' + toMerge);
  await page.locator('dialog .backup-merge').click();
  await page.locator('dialog .backup-report').first().waitFor();
  const said = await page.locator('dialog').textContent();
  check(said.includes('운동 기록 1일, 체크인 1일을 들였습니다'), '합친 알림: ' + said);
  check(said.includes('이 폰에 이미 있던 1일'), '같은 날 이야기가 없습니다: ' + said);
  check(said.includes('통증 기록 동의가 없어'), '통증 동의 이야기가 없습니다: ' + said);
  check(said.includes('식단 기록 동의가 없어'), '식단 동의 이야기가 없습니다: ' + said);
  await shot('3-merged');
  await page.locator('dialog .modal-close').click();
  rows = await historyRows(page);
  check(rows.length === 2, '합친 뒤 기록: ' + rows.join(' / '));
  check(rows[0].includes('10월 21일') && rows[0].includes('2세트'), '같은 날이 백업 것으로 덮였습니다: ' + rows[0]);
  check(rows[1].includes('10월 15일'), '빠진 날이 안 들어왔습니다: ' + rows.join(' / '));
}
