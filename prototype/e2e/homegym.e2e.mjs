// 홈짐 — 집에서 하는 사람을 "아직 연결 안 된 헬스장 회원"으로 대하지 않는다.
//   처음 설정: 홈짐을 고르면 그림 칸이 바로 열리고, 집에 흔한 맨몸 · 소도구(밴드 · 케틀벨 · 스텝박스 · 폼롤러)가
//   "더 보기" 없이 맨 위에 있다. 켜도 열리는 종목이 없는 기구는 칸에 그렇다고 적는다.
//   오늘: 헬스장 등록 안내가 없고, ⋯ 메뉴에 "사람 있어요" · "맨 뒤로 미루기"가 없다.
//   내 정보 › 헬스장: 빨간 "등록 안 됨"도, 찾아서 등록하기도 없다. 바벨 · 머신이 없으니 무게 설정은 덤벨 두 줄뿐이다.
//   내 정보 › 설정: "운동 횟수 · 목표 바꾸기"로 주 몇 번을 바로 바꾼다. 개발자 말(PWA · 서버 · Wear OS)이 없다.
import { check, gymTab, pickMe, tab } from './lib.mjs';

const tileNamed = (page, name) => page.locator('.equip-tile', { has: page.locator('.name', { hasText: name }) });

export default async function ({ page, url, shot }) {
  await page.clock.install({ time: new Date('2026-10-22T18:00:00+09:00') });
  await page.goto(url);
  await page.waitForSelector('.consent-card');
  const cards = page.locator('.consent-card');
  for (let i = 0; i < await cards.count(); i += 1) {
    if (await cards.nth(i).locator('.consent-tag.req').count()) await cards.nth(i).locator('.consent-toggle').click();
  }
  await page.click('.wizard-nav .primary');

  // 나에 대해 — 검증 · 대조 · 분할 같은 말이 없다
  await pickMe(page, { level: '초보', sex: '여성' });
  const me = (await page.locator('#screen').innerText()).replace(/\s+/g, ' ');
  for (const word of ['검증', '대조', '분할이', '환산', '볼륨', '알아두세요']) {
    check(!me.includes(word), '나에 대해에 "' + word + '": ' + (me.match(new RegExp('.{0,20}' + word + '.{0,20}')) || [''])[0]);
  }
  await page.click('.wizard-nav .primary');

  // 헬스장 — 홈짐을 고르면 그림 칸이 바로 열린다
  await page.locator('.chip-row .pick', { hasText: '홈짐' }).click();
  check(await page.locator('.equip-toggle[aria-expanded="true"]').count() === 1, '홈짐인데 그림 칸이 접혀 있습니다');
  const hint = await page.locator('.sheet', { hasText: '어떤 곳인가요?' }).textContent();
  check(hint.includes('집에 있는 기구') && !hint.includes('없는 것만 끄세요'), '홈짐 안내: ' + hint);
  check(await page.locator('button', { hasText: '헬스장 가서 할게요' }).count() === 0, '집인데 "헬스장 가서 할게요"가 있습니다');
  // 맨 위 묶음이 집에 흔한 것 — 밴드 · 케틀벨 · 스텝박스 · 폼롤러가 "더 보기" 없이
  const firstGroup = (await page.locator('.equip-group-head .list-label').first().textContent()).trim();
  check(firstGroup.includes('맨몸') && firstGroup.includes('소도구'), '첫 묶음: ' + firstGroup);
  for (const name of ['밴드', '케틀벨', '스텝 박스', '폼롤러']) {
    check(await tileNamed(page, name).count() >= 1, name + ' 칸이 바로 안 보입니다');
  }
  // 밴드 — 켜기 전에 밴드로 하는 종목(밴드 로우 · 풀 어파트 · 레터럴 레이즈)이 열린다고 칸에 적혀 있다
  const band = tileNamed(page, '밴드').first();
  const bandNote = await band.textContent();
  check(/\+[3-9]종목/.test(bandNote) && !bandNote.includes('아직 이 기구로 하는 종목이 없습니다'), '밴드 칸: ' + bandNote);
  await band.click();
  check(await tileNamed(page, '밴드').first().getAttribute('aria-pressed') === 'true', '밴드가 안 켜집니다');
  check((await page.locator('.equip-toggle').textContent()).includes('있음'), '개수를 "켜짐"으로 셉니다');
  await shot('1-gymstep');

  // 프로그램 → 시작
  for (let i = 0; i < 4; i += 1) {
    const next = page.locator('.wizard-nav .primary');
    const text = (await next.textContent()).trim();
    await next.click();
    if (text === '이 프로그램으로 시작') break;
  }
  await page.waitForSelector('.tabbar [role="tab"]');

  // 오늘 — 헬스장 등록 안내가 없다
  check(await page.locator('.gym-link-nudge').count() === 0, '홈짐인데 헬스장 등록 안내가 뜹니다');
  // ⋯ 메뉴 — 사람 있어요 · 맨 뒤로 미루기가 없다
  await page.locator('.plan-row .row-menu').first().click();
  const menu = await page.locator('dialog').textContent();
  check(!menu.includes('사람 있어요') && !menu.includes('맨 뒤로 미루기'), '집인데 메뉴에: ' + menu.replace(/\s+/g, ' ').slice(0, 200));
  check(menu.includes('이 종목 빼기'), '메뉴가 비었습니다');
  await page.locator('dialog .modal-close').click();
  await shot('2-today');

  // 내 정보 › 헬스장
  await gymTab(page);
  const here = await page.locator('.gym-here').textContent();
  check(here.includes('우리 집') && here.includes('홈짐') && !here.includes('등록 안 됨'), '헬스장 칸: ' + here);
  check(await page.locator('.gym-here-where.unset').count() === 0, '집인데 빨간 주소 줄이 있습니다');
  check(await page.locator('.gym-link').count() === 0, '집인데 "찾아서 등록하기"가 있습니다');
  // 덤벨만 있으면 무게 설정은 덤벨 두 줄뿐 — 빈 바 · 머신 한 칸은 묻지 않는다
  const weights = page.locator('.gym-weights');
  check(await weights.count() === 1, '덤벨이 있는데 덤벨 무게 설정이 없습니다');
  const weightText = await weights.textContent();
  check(weightText.includes('가벼운 덤벨 간격') && weightText.includes('가장 무거운 덤벨'), '덤벨 설정: ' + weightText.replace(/\s+/g, ' ').slice(0, 200));
  check(!weightText.includes('빈 바') && !weightText.includes('머신 무게 한 칸'), '바벨 · 머신이 없는데 빈 바 · 머신 설정이 있습니다: ' + weightText.replace(/\s+/g, ' ').slice(0, 200));
  const gymText = await page.locator('#screen').textContent();
  check(!gymText.includes('스택') && !gymText.includes('백 스쿼트 제안'), '헬스장 탭에 스택 · 백 스쿼트: ' + gymText.replace(/\s+/g, ' ').slice(0, 300));
  check(await page.locator('.sheet h3', { hasText: '몸무게' }).count() === 1, '몸무게 칸 이름이 다릅니다');
  await shot('3-gymtab');

  // 내 정보 › 설정
  await tab(page, '내 정보');
  await page.locator('.me-sections button', { hasText: '설정' }).click();
  const settings = (await page.locator('#screen').innerText()).replace(/\s+/g, ' ');
  for (const word of ['PWA', '서비스 워커', '오프라인 캐시', '서버에 연결된 버전', 'Wear OS', '블록', '내 정보에서 바꿉니다']) {
    check(!settings.includes(word), '내 정보에 "' + word + '": ' + (settings.match(new RegExp('.{0,30}' + word + '.{0,30}')) || [''])[0]);
  }
  check(settings.includes('기록은 이 폰에만 저장됩니다'), '저장 안내가 없습니다');
  check(await page.locator('.sheet h3', { hasText: '내 데이터 · 동의' }).count() === 1, '내 데이터 칸 이름이 다릅니다');
  check(await page.locator('details.app-more[open]').count() === 0, '시계 · 화면 꺼짐 이야기가 펼쳐져 있습니다');
  // 쓸 수 없는 "운동 빠진 주에 불러 주기" 스위치는 없다
  check(await page.locator('.nudge-row', { hasText: '불러 주기' }).count() === 0, '쓸 수 없는 알림 스위치가 보입니다');

  // 운동 횟수 · 목표 바꾸기 — 주 2회로
  const program = page.locator('.sheet', { has: page.locator('h3', { hasText: /^프로그램$/ }) });
  const before = await program.locator('.hint-line').first().textContent();
  check(/과정 중 1주차/.test(before), '프로그램 줄: ' + before);
  await program.getByRole('button', { name: '운동 횟수 · 목표 바꾸기' }).click();
  check(await page.locator('dialog .plan-basics-save').isDisabled(), '안 바꿨는데 다시 짜기가 눌립니다');
  await page.locator('dialog .segmented button', { hasText: /^2일$/ }).click();
  check((await page.locator('dialog .plan-basics-preview').textContent()).includes('주 2회'), '미리보기가 안 바뀝니다');
  await shot('4-basics');
  await page.locator('dialog .plan-basics-save').click();
  await page.waitForFunction(() => !document.querySelector('dialog')?.open);
  const after = await program.locator('.hint-line').first().textContent();
  check(after.includes('주 2회'), '다시 짰는데 프로그램이 그대로입니다: ' + after);
  await tab(page, '오늘');
  await page.locator('.day-switch').click();
  check(await page.locator('dialog .day-row').count() === 2, '주 2회인데 날이 ' + await page.locator('dialog .day-row').count() + '개입니다');
}
