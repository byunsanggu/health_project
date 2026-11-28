// 동의 문구가 바뀐 뒤(2026-11-01 → 2026-11-28) 쓰던 사람이 앱을 열 때
//   · 처음 설정으로 돌려보내지 않는다 — 오늘 화면 위에 바뀐 것만 한 번
//   · 식단 기록에 동의한 적 없는 사람에게는 묻지 않는다(바뀐 것이 없다)
//   · 거부해도 식단 기록 · 운동 기록이 그대로이고, 목표는 체중으로, 다시 묻지 않는다
//   · 내 정보에서 다시 열어 동의하면 키 · 나이 · 활동량을 바로 적고 목표가 바뀐다
//   · 처음 물을 때 바로 동의하는 길도
import { check, finishWizard, tab } from './lib.mjs';

const KEY = 'volume-coach.proto.state';
const OLD = '2026-11-01';

// 새로고침이 앱의 서비스 워커 교체와 겹치면 브라우저가 net::ERR_ABORTED로 끊는다 — 한 번 더 연다(catalog와 같다).
async function reloadSafely(page) {
  try { await page.reload(); }
  catch (err) {
    if (!/ERR_ABORTED/.test(String(err && err.message))) throw err;
    await page.waitForLoadState('load').catch(() => {});
    await page.reload();
  }
  await page.waitForSelector('.tabbar [role="tab"]');
}

const saved = (page) => page.evaluate((key) => JSON.parse(localStorage.getItem(key)), KEY);

/** 저장소를 예전 판 동의로 되돌린다 — 그 판에는 키 · 나이 · 활동량이 없었다 */
async function makeOld(page) {
  await page.evaluate(({ key, old }) => {
    const store = JSON.parse(localStorage.getItem(key));
    store.settings.consentRecord = { given: store.settings.consent.slice(), version: old, at: '2026-11-05' };
    delete store.settings.bodyInfo;
    localStorage.setItem(key, JSON.stringify(store));
  }, { key: KEY, old: OLD });
}

async function setUp(page, url, { diet }) {
  await page.evaluate(() => localStorage.clear());
  await page.goto(url);
  await finishWizard(page, { goal: 'cut', weight: 70 });
  if (diet) {
    await tab(page, '식단');
    await page.locator('.food-log').getByRole('button', { name: '동의하고 적기 시작' }).click();
    await page.fill('#food-text', '김치찌개 1인분');
    await page.click('.food-calc');
    await page.locator('.food-commit').click();
    await tab(page, '오늘');
  }
  await makeOld(page);
  await reloadSafely(page);
}

export default async function ({ page, url, shot }) {
  await page.clock.install({ time: new Date('2026-11-28T09:10:00+09:00') });
  await page.goto(url);

  // ── 식단 기록에 동의한 적 없는 사람 — 바뀐 것이 없으니 묻지 않고, 동의 기록도 그대로
  await setUp(page, url, { diet: false });
  check(await page.locator('.onboarding-head').count() === 0, '예전 판 동의인데 처음 설정으로 돌아갔습니다');
  check(!(await page.locator('dialog[open] .reconsent-sheet').count()), '식단 기록 동의가 없는데 다시 물었습니다');
  check((await saved(page)).settings.consentRecord.version === OLD, '묻지도 않고 동의 기록을 새 판으로 바꿨습니다');

  // ── 식단 기록에 동의했던 사람 — 오늘 화면 위에 바뀐 것만
  await setUp(page, url, { diet: true });
  check(await page.locator('.onboarding-head').count() === 0, '예전 판 동의인데 처음 설정으로 돌아갔습니다');
  const sheet = page.locator('dialog[open] .reconsent-sheet');
  await sheet.waitFor();
  const title = await page.locator('dialog[open] #modal-title').textContent();
  check(title.includes('식단 기록 동의'), '다시 묻는 창 제목: ' + title);
  const news = await sheet.locator('.reconsent-new li').allTextContents();
  check(news.length === 2 && news[0].includes('키, 출생 연도, 평소 활동량') && news[1].includes('식단 목표 칼로리 계산'), '새로 생긴 것: ' + news.join(' / '));
  check((await sheet.locator('.reconsent-decline-note').textContent()).includes('식단 기록은 그대로'), '거부하면 무엇이 되는지 말하지 않습니다');
  for (const [w, h] of [[390, 844], [360, 640]]) {
    await page.setViewportSize({ width: w, height: h });
    const wide = await page.evaluate(() => document.documentElement.scrollWidth);
    check(wide <= w, `${w}px에서 다시 묻는 창 가로 ${wide}px`);
    await shot(`1-prompt-${w}`);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  // 바뀐 문구 전체도 펼쳐 볼 수 있다
  await sheet.locator('.reconsent-more').click();
  check((await sheet.locator('.reconsent-full .consent-body').textContent()).includes('출생 연도'), '전체 문구에 새 항목이 없습니다');

  // 거부 — 아무것도 잃지 않는다
  await sheet.locator('.reconsent-decline').click();
  check(!(await page.locator('dialog[open]').count()), '거부했는데 창이 남았습니다');
  let store = await saved(page);
  check(store.settings.consent.includes('dietLog'), '거부했더니 식단 기록 동의가 꺼졌습니다');
  check(store.settings.consentRecord.version === '2026-11-28', '물은 판이 안 남았습니다: ' + store.settings.consentRecord.version);
  check(store.settings.consentRecord.olderText && store.settings.consentRecord.olderText.dietLog === OLD, '예전 문구 표시: ' + JSON.stringify(store.settings.consentRecord));
  check((store.settings.foodLog || []).length === 1, '거부했더니 식단 기록이 사라졌습니다');
  check(!store.settings.bodyInfo, '거부했는데 키 · 나이 칸이 생겼습니다');

  // 한 번만 묻는다
  await reloadSafely(page);
  check(!(await page.locator('dialog[open] .reconsent-sheet').count()), '거부했는데 또 물었습니다');

  // 목표는 체중으로(1,800), 자세히에서 다시 동의하는 길이 있다
  await tab(page, '식단');
  check((await page.locator('.food-kcal-unit').textContent()).includes('1,800kcal'), '거부한 뒤 목표: ' + await page.locator('.food-kcal-unit').textContent());
  check(await page.locator('.food-day .food-entry').count() === 1, '식단 기록이 안 보입니다');
  await page.locator('.food-more-toggle').click();
  check((await page.locator('.food-method').textContent()).includes('체중만으로'), '정한 법: ' + await page.locator('.food-method').textContent());
  check((await page.locator('.food-body-open').textContent()).includes('키 · 나이 · 활동량으로 계산하기'), '다시 동의하는 길이 없습니다');
  await page.locator('.food-more-toggle').click();

  // 내 정보 — 예전 문구 그대로라고 보여 주고, 바뀐 내용 보고 동의하기
  await tab(page, '내 정보');
  check((await page.locator('.consent-older').textContent()).includes('판 문구 그대로'), '내 정보에 예전 문구 표시가 없습니다');
  const card = page.locator('.body-info-card');
  check(await card.locator('.body-input').count() === 0, '동의 전인데 키 · 나이 칸이 열렸습니다');
  await card.locator('.body-reconsent').click();
  await sheet.waitFor();
  check((await sheet.locator('.reconsent-decline').textContent()) === '그대로 두기', '다시 연 창의 닫기 단추: ' + await sheet.locator('.reconsent-decline').textContent());
  await sheet.locator('.reconsent-agree').click();
  // 동의하면 바로 키 · 나이 · 활동량 칸
  await page.locator('dialog[open] .reconsent-body-info').waitFor();
  await page.locator('#modal-body-height').fill('175');
  await page.locator('#modal-body-year').fill('1996');
  await page.locator('dialog .body-act[data-activity="light"]').click();
  check((await page.locator('dialog .body-preview').textContent()).includes('1,900kcal'), '미리 보기: ' + await page.locator('dialog .body-preview').textContent());
  await page.locator('dialog .body-save').click();
  store = await saved(page);
  check(!store.settings.consentRecord.olderText, '동의했는데 예전 문구 표시가 남았습니다');
  check(store.settings.bodyInfo && store.settings.bodyInfo.heightCm === 175 && store.settings.bodyInfo.activity === 'light', '저장된 키 · 나이: ' + JSON.stringify(store.settings.bodyInfo));
  check(await page.locator('.consent-older').count() === 0, '동의했는데 내 정보에 예전 문구 표시가 남았습니다');
  check(await page.locator('.body-info-card .body-input').count() === 2, '동의했는데 내 정보에 칸이 없습니다');
  await tab(page, '식단');
  check((await page.locator('.food-kcal-unit').textContent()).includes('1,900kcal'), '동의하고 적은 뒤 목표: ' + await page.locator('.food-kcal-unit').textContent());

  // ── 처음 물을 때 바로 동의 — 이어서 키 · 나이 칸, "나중에"도 된다 · × 로 닫으면 "지금은 안 함"
  await setUp(page, url, { diet: true });
  await sheet.waitFor();
  await sheet.locator('.reconsent-agree').click();
  await page.locator('dialog[open] .reconsent-body-info').waitFor();
  await shot('2-after-agree');
  await page.locator('dialog .body-later').click();
  store = await saved(page);
  check(store.settings.consentRecord.version === '2026-11-28' && !store.settings.consentRecord.olderText, '바로 동의한 기록: ' + JSON.stringify(store.settings.consentRecord));
  check(!store.settings.bodyInfo, '나중에를 눌렀는데 키 · 나이가 저장됐습니다');

  await setUp(page, url, { diet: true });
  await sheet.waitFor();
  await page.locator('dialog[open] .modal-close').click();
  // 닫힘 이벤트는 close() 뒤에 늦게 온다 — 기록이 바뀔 때까지 잠깐 기다린다
  await page.waitForFunction((key) => {
    const record = JSON.parse(localStorage.getItem(key)).settings.consentRecord;
    return record.version === '2026-11-28';
  }, KEY, { timeout: 3000 }).catch(() => {});
  store = await saved(page);
  check(store.settings.consentRecord.olderText && store.settings.consentRecord.olderText.dietLog === OLD, '× 로 닫은 뒤 기록: ' + JSON.stringify(store.settings.consentRecord));
  await reloadSafely(page);
  check(!(await page.locator('dialog[open] .reconsent-sheet').count()), '× 로 닫았는데 또 물었습니다');
}
