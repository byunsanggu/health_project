// 내 루틴 — 내 정보 › 프로그램에서 하던 루틴을 넣는다. 빈 칸에서 날 이름을 치고, 부위별 목록에서
//   종목을 넣고, 세트 · 반복을 바꾸고, 빈 날을 빼고 저장하면 오늘 목록이 그 루틴 그대로(세트도 그대로)
//   나온다. 껐다 켜도 남고, 앱 프로그램으로 돌아가도 루틴은 넣어 둬서 다시 불러올 수 있다.
import { check, onboard, tab } from './lib.mjs';

async function openMe(page) {
  await page.locator('#me-btn').click();
  await page.waitForSelector('.routine-start, .routine-edit');
}

async function addLifts(page, dayIndex, region, names) {
  await page.locator('dialog .routine-day').nth(dayIndex).locator('.routine-add').click();
  await page.locator('dialog .add-lift-regions .chip', { hasText: region }).click();
  for (const name of names) {
    await page.locator('dialog .add-lift-row', { has: page.locator('.name', { hasText: new RegExp(`^${name}$`) }) }).first().click();
  }
  const added = await page.locator('dialog .routine-added').textContent();
  check(names.every((name) => added.includes(name)), '넣은 것 줄: ' + added);
  await page.locator('dialog .routine-picked').click();
}

export default async function ({ page, url, shot }) {
  await page.clock.install({ time: new Date('2026-10-22T18:00:00+09:00') });
  await page.goto(url);
  await onboard(page);

  await openMe(page);
  await page.locator('.routine-start').click();
  await page.locator('dialog .routine-from', { hasText: '빈 칸에서 짜기' }).click();
  const days = await page.locator('dialog .routine-day').count();
  check(days === 4, '주 4회로 시작했는데 빈 날이 ' + days + '개입니다');

  // 날 이름 — 치는 동안 칸이 바뀌지 않는다(한글이 끊기지 않는다)
  const name = page.locator('dialog .routine-day-name').first();
  await name.fill('');
  await name.click();
  await page.keyboard.type('가슴 삼두', { delay: 30 });
  check(await name.inputValue() === '가슴 삼두', '날 이름이 끊깁니다: ' + await name.inputValue());

  await addLifts(page, 0, '가슴', ['바벨 벤치프레스', '케이블 플라이']);
  await addLifts(page, 0, '팔', ['트라이셉스 푸시다운']);
  await addLifts(page, 1, '등', ['랫 풀다운', '바벨 로우']);
  await shot('1-editor');

  // 벤치 4세트 → 5세트, 플라이 반복 12~20회
  const bench = page.locator('dialog .routine-day').first().locator('.routine-slot').first();
  await bench.locator('button[aria-label="세트 늘리기"]').click();
  await bench.locator('button[aria-label="세트 늘리기"]').click();
  check((await bench.locator('.routine-stepper .num').textContent()).trim() === '5세트', '세트가 안 늘었습니다');
  await page.locator('dialog .routine-day').first().locator('.routine-slot').nth(1).locator('select').selectOption({ label: '12~20회' });

  // 순서 — 푸시다운을 맨 위로 올렸다가 다시 내린다
  const lastUp = page.locator('dialog .routine-day').first().locator('.routine-slot').nth(2).locator('button[aria-label="위로"]');
  await lastUp.click();
  const order = await page.locator('dialog .routine-day').first().locator('.routine-slot .name').allTextContents();
  check(order[1] === '트라이셉스 푸시다운', '위로가 안 됩니다: ' + order.join(', '));
  await page.locator('dialog .routine-day').first().locator('.routine-slot').nth(1).locator('button[aria-label="아래로"]').click();

  // 점검 — 하체가 없다고 말한다
  const notes = await page.locator('dialog .routine-note').allTextContents();
  check(notes.some((text) => text.includes('하체 종목이 없습니다')), '점검: ' + notes.join(' / '));
  await page.locator('dialog .routine-review').scrollIntoViewIfNeeded();
  await shot('1b-review');

  // 빈 날 둘을 뺀다(빈 날은 한 번에 빠진다)
  await page.locator('dialog .routine-day').nth(3).locator('.routine-day-head .pick').click();
  await page.locator('dialog .routine-day').nth(2).locator('.routine-day-head .pick').click();
  check(await page.locator('dialog .routine-day').count() === 2, '빈 날이 안 빠집니다');
  // 종목이 있는 날은 한 번 더 묻는다
  await page.locator('dialog .routine-day').nth(1).locator('.routine-day-head .pick').click();
  check((await page.locator('dialog .routine-day').nth(1).locator('.routine-day-head .pick').textContent()).trim() === '정말 빼기', '종목 있는 날을 바로 뺍니다');
  check(await page.locator('dialog .routine-day').count() === 2, '묻지 않고 뺐습니다');

  await page.locator('dialog .routine-save').click();
  await page.waitForFunction(() => !document.querySelector('dialog')?.open);

  // 내 정보 › 프로그램
  const card = await page.locator('.sheet', { hasText: '프로그램' }).first().textContent();
  check(card.includes('내 루틴') && card.includes('가슴 삼두'), '프로그램 카드: ' + card);
  await shot('2-card');

  // 오늘 — 루틴 그대로, 세트도 그대로
  await tab(page, '오늘');
  const lifts = page.locator('.plan-row', { has: page.locator('.row-menu') });
  await lifts.first().waitFor();
  const today = await lifts.locator('.name').allTextContents();
  check(today.map((text) => text.trim()).join(',') === '바벨 벤치프레스,케이블 플라이,트라이셉스 푸시다운', '오늘 목록: ' + today.join(', '));
  const sets = await lifts.locator('.plan-sets').allTextContents();
  check(/^5세트/.test(sets[0]) && /^3세트/.test(sets[1]) && /12–20회/.test(sets[1]), '세트 · 반복: ' + sets.join(' / '));
  await shot('3-today');

  // 주간 — 처방 대신 루틴 점검
  await tab(page, '주간');
  check(await page.locator('.routine-week').count() === 1, '주간 탭에 루틴 점검이 없습니다');
  check((await page.locator('.session-head .meta').first().textContent()).includes('내 루틴 그대로'), '주간 머리줄이 처방 문구입니다');
  await page.locator('.routine-week').scrollIntoViewIfNeeded();
  await shot('3b-week');

  // 껐다 켜도 남는다
  await page.reload();
  await page.waitForSelector('.tabbar [role="tab"]');
  await openMe(page);
  check(await page.locator('.routine-edit').count() > 0, '다시 켜니 루틴이 사라졌습니다');

  // 고치다 창을 닫아도, 다시 열면 이어서 한다
  await page.locator('.sheet .routine-edit').first().click();
  const second = page.locator('dialog .routine-day').nth(1);
  await second.locator('button[aria-label="세트 늘리기"]').first().click();
  await page.locator('dialog .modal-close').click();
  await page.locator('.sheet .routine-edit').first().click();
  check((await page.locator('dialog').textContent()).includes('이어서 고칩니다'), '닫았던 편집이 사라졌습니다');
  await page.locator('dialog .finish.quiet', { hasText: '그만두기' }).click();

  // 앱 프로그램으로 — 루틴은 넣어 둔다
  await page.locator('.routine-off').click();
  await page.locator('dialog .routine-off-go').click();
  await page.waitForSelector('.routine-start');
  await page.locator('.routine-start').click();
  const from = await page.locator('dialog .routine-from').allTextContents();
  check(from[0].includes('지난번 내 루틴 불러오기') && from[0].includes('가슴 삼두'), '넣어 둔 루틴: ' + from.join(' / '));
  await shot('4-again');
}
