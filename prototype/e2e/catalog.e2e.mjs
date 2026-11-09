// 종목 찾기 · 덤벨 무게 설정 · 말투 바꾸기 · 예전 홈짐 이름표.
//   종목 추가 검색은 헬스장에서 부르는 이름('사레레')과 띄어쓰기 다른 이름('덤벨 컬' · '클로즈그립')도 찾는다.
//   내 정보 › 헬스장 › 무게 설정에 덤벨 두 줄(가벼운 덤벨 간격 · 가장 무거운 덤벨)이 있고, 고른 것이 덤벨 목록을 바꾸고 다시 열어도 남는다.
//   내 정보 › 설정에서 코치 · 알림 칸이 프로그램 바로 아래다. 시작 전 한 장의 "말투 바꾸기"로 코치 말투를 고르고 돌아온다.
//   집 표시가 생기기 전에 만든 홈짐 이름표("우리 집")는 앱을 다시 열면 집으로 바뀌어 "등록하기" · 빨간 "등록 안 됨"이 사라진다.
import { check, gymTab, onboard, tab } from './lib.mjs';

const STORE = 'volume-coach.proto.state';

/** 저장된 헬스장 목록으로 엔진이 만드는 레터럴 레이즈 덤벨 목록. */
async function lateralLadder(page) {
  return page.evaluate((key) => {
    const saved = JSON.parse(localStorage.getItem(key) || '{}');
    const book = saved.settings && saved.settings.gymBook;
    const E = window.FitEngine;
    const spec = E.loadingFor(E.EXERCISES.find((e) => e.id === 'lateral-raise'), E.activeProfile(book));
    return spec && spec.kind === 'dumbbell' ? spec.availableKg : null;
  }, STORE);
}

export default async function ({ page, url, shot }) {
  await page.clock.install({ time: new Date('2026-10-22T18:00:00+09:00') });
  await page.goto(url);
  await onboard(page);

  // 내 헬스장은 아직 이름표 — 오늘 화면에 "등록하기"가 뜬다 (아래 홈짐 옮기기의 비교 기준)
  check(await page.locator('.gym-link-nudge').count() === 1, '이름표 헬스장인데 등록 안내가 없습니다');

  // 종목 추가 — 부르는 이름으로 찾는다
  await page.locator('.list-edit').click();
  await page.locator('.head-actions .demo-open', { hasText: '종목 추가' }).click();
  const search = page.locator('dialog input[type=search]');
  const rowsFor = async (query, want) => {
    await search.fill('');
    await search.click();
    await page.keyboard.type(query, { delay: 30 });
    const rows = (await page.locator('dialog .add-lift-row').allTextContents()).map((text) => text.replace(/\s+/g, ' ').trim());
    check(rows.length > 0, '"' + query + '"로 찾은 종목이 없습니다');
    check(rows.some((row) => want.test(row)), '"' + query + '" 결과에 ' + want + '가 없습니다: ' + rows.slice(0, 6).join(' / '));
    return rows;
  };
  await rowsFor('덤벨 컬', /컬/);
  await shot('1-search-curl');
  await rowsFor('사레레', /레터럴 레이즈/);
  await shot('2-search-lateral');
  await rowsFor('클로즈그립', /클로즈그립|뉴트럴|랫풀다운/);
  await shot('3-search-closegrip');
  // 없는 이름은 없다고 — 엉뚱한 종목이 뜨지 않는다
  await search.fill('');
  await search.click();
  await page.keyboard.type('무릎 푸시업', { delay: 30 });
  // 무릎 푸시업은 이제 있는 종목이다(매트뿐인 초보의 첫 푸시업) — 그것 하나만, 인클라인 푸시업이 섞이지 않는다
  const kneeRows = (await page.locator('dialog .add-lift-row').allTextContents()).map((text) => text.trim());
  check(kneeRows.length === 1 && kneeRows[0].startsWith('무릎 푸시업'), '"무릎 푸시업" 검색: ' + kneeRows.join(', '));
  await search.fill('');
  await search.click();
  await page.keyboard.type('물구나무 푸시업', { delay: 30 });
  check(await page.locator('dialog .add-lift-row').count() === 0, '"물구나무 푸시업"으로 다른 종목이 뜹니다');
  await page.locator('dialog .modal-close').click();
  await page.waitForFunction(() => !document.querySelector('dialog')?.open);
  if (await page.locator('.list-edit[aria-expanded="true"]').count()) await page.locator('.list-edit').click();

  // 내 정보 › 헬스장 › 무게 설정 — 덤벨 두 줄
  await gymTab(page);
  const weights = page.locator('.gym-weights');
  check(await weights.count() === 1, '무게 설정 칸이 없습니다');
  const lightRow = weights.locator('.list-label:has-text("가벼운 덤벨 간격") + .segmented');
  const heavyRow = weights.locator('.list-label:has-text("가장 무거운 덤벨") + .segmented');
  check(await lightRow.count() === 1 && await heavyRow.count() === 1, '덤벨 줄이 없습니다: ' + (await weights.textContent()).replace(/\s+/g, ' ').slice(0, 200));
  check(await lightRow.locator('button[aria-pressed="true"]').textContent() === '1kg씩', '가벼운 덤벨 간격 기본값이 1kg이 아닙니다');
  const before = await lateralLadder(page);
  check(before && before.slice(0, 4).join(',') === '1,2,3,4', '1kg 간격인데 덤벨 목록: ' + before);

  await lightRow.locator('button', { hasText: '2kg씩' }).click();
  check(await page.locator('.gym-weights .list-label:has-text("가벼운 덤벨 간격") + .segmented button[aria-pressed="true"]').textContent() === '2kg씩',
    '2kg씩을 눌렀는데 그대로입니다');
  const after = await lateralLadder(page);
  check(after && after.slice(0, 5).join(',') === '2,4,6,8,10' && after.indexOf(3) < 0, '2kg 간격인데 덤벨 목록: ' + after);

  await page.locator('.gym-weights .list-label:has-text("가장 무거운 덤벨") + .segmented button', { hasText: /^20kg$/ }).click();
  const capped = await lateralLadder(page);
  check(capped && Math.max.apply(null, capped) === 20, '가장 무거운 덤벨 20kg인데 덤벨 목록: ' + capped);
  await shot('4-dumbbell-rows');

  // 다시 열어도 남는다
  await page.reload();
  await gymTab(page);
  check(await page.locator('.gym-weights .list-label:has-text("가벼운 덤벨 간격") + .segmented button[aria-pressed="true"]').textContent() === '2kg씩',
    '다시 여니 가벼운 덤벨 간격이 돌아갔습니다');
  check(await page.locator('.gym-weights .list-label:has-text("가장 무거운 덤벨") + .segmented button[aria-pressed="true"]').textContent() === '20kg',
    '다시 여니 가장 무거운 덤벨이 돌아갔습니다');

  // 내 정보 › 설정 — 코치 · 알림 칸이 프로그램 바로 아래
  await tab(page, '내 정보');
  await page.locator('.me-sections button', { hasText: '설정' }).click();
  const order = await page.locator('#screen > .sheet').evaluateAll((sheets) => sheets.map((sheet) => ({
    title: (sheet.querySelector('.sheet-head h3') || {}).textContent || '',
    coach: sheet.classList.contains('coach-settings'),
  })));
  const programAt = order.findIndex((sheet) => /^프로그램$/.test(sheet.title.trim()));
  check(programAt >= 0 && order[programAt + 1] && order[programAt + 1].coach,
    '코치 칸이 프로그램 바로 아래가 아닙니다: ' + order.map((sheet) => sheet.title).join(' / '));

  // 시작 전 한 장 — PT를 고르면 "말투 바꾸기"가 있고, 거기서 고른 말투로 돌아온다
  await tab(page, '오늘');
  await page.locator('.start-cta').click();
  check(await page.locator('dialog .coach-style-link').count() === 0, '혼자인데 말투 바꾸기가 보입니다');
  await page.locator('dialog .segmented button', { hasText: 'PT 코치' }).click();
  await page.locator('dialog .coach-style-link').click();
  check((await page.locator('dialog .modal-head h3').textContent()).trim() === '말투 바꾸기', '말투 고르는 창이 안 열립니다');
  await page.locator('dialog .coach-style', { hasText: '빡세게' }).click();
  check(await page.locator('dialog .coach-style[aria-pressed="true"]').textContent().then((text) => text.includes('빡세게')), '빡세게가 안 골라집니다');
  await shot('5-style-picker');
  await page.locator('dialog .start-go', { hasText: '돌아가기' }).click();
  check((await page.locator('dialog .modal-head h3').textContent()).trim() === '오늘 운동 준비', '돌아가기 뒤 시작 전 한 장이 아닙니다');
  check((await page.locator('dialog').textContent()).includes('"빡세게"'), '고른 말투가 시작 전 한 장에 안 보입니다');
  await page.locator('dialog .segmented button', { hasText: '혼자' }).click();
  await page.locator('dialog .modal-close').click();

  // 예전 홈짐 이름표 — 집 표시 없이 "우리 집"으로 저장된 것을 다시 열면 집으로 본다
  // 앱은 닫힐 때 자기 상태를 저장한다 — 그 뒤, 다음에 열 때 앱보다 먼저 저장소를 예전 모양으로 고친다
  await page.addInitScript((key) => {
    if (sessionStorage.getItem('zz-old-home')) return;
    sessionStorage.setItem('zz-old-home', '1');
    const saved = JSON.parse(localStorage.getItem(key) || '{}');
    saved.settings.gymBook.gyms = saved.settings.gymBook.gyms.map((gym) => {
      if (gym.id !== 'my-gym') return gym;
      const old = Object.assign({}, gym, { name: '우리 집' });
      delete old.visibility;
      return old;
    });
    saved.settings.gymLinkHidden = false;
    localStorage.setItem(key, JSON.stringify(saved));
  }, STORE);
  await page.reload();
  await page.waitForSelector('.tabbar [role="tab"]');
  check(await page.locator('.gym-link-nudge').count() === 0, '예전 홈짐 이름표인데 등록 안내가 뜹니다');
  await gymTab(page);
  check(await page.locator('.gym-here-where.unset').count() === 0, '예전 홈짐 이름표인데 빨간 "등록 안 됨"이 있습니다');
  check((await page.locator('.gym-here').textContent()).includes('홈짐'), '예전 홈짐 이름표가 집으로 안 보입니다');
  await shot('6-old-home');
}
