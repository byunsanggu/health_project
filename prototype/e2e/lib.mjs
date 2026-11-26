/**
 * 브라우저로 앱을 실제로 눌러 보는 테스트의 공통 부분.
 *
 * 엔진 테스트(npm test)는 계산이 맞는지 본다. 여기서는 사람이 누르는 길이
 * 끊기지 않는지 본다 — 버튼이 화면에 있는지, 누르면 다음 화면이 나오는지.
 *
 * 서버 없는 빌드(prototype/dist)를 띄워서 돈다. 서버 주소를 넣고 빌드한
 * dist는 로그인 화면이 먼저 나와서 이 테스트들이 맞지 않는다.
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// E2E_DIST로 다른 빌드를 띄울 수 있다 — 고치기 전 빌드에서 테스트가 실제로 실패하는지 볼 때
export const DIST = resolve(process.env.E2E_DIST || fileURLToPath(new URL('../dist/', import.meta.url)));
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

/** dist를 띄운다. 빈 포트를 알아서 잡는다. */
export async function serve() {
  const server = createServer(async (req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://local').pathname);
    const file = resolve(join(DIST, path.endsWith('/') ? path + 'index.html' : path));
    if (file !== DIST && !file.startsWith(DIST + sep)) {
      res.writeHead(403);
      res.end();
      return;
    }
    try {
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  return {
    url: `http://127.0.0.1:${server.address().port}/`,
    close: () => new Promise((done) => server.close(done)),
  };
}

/** 이 저장소는 playwright를 의존성으로 두지 않는다. 깔려 있는 것을 찾아 쓴다. */
export async function chromium() {
  const tries = [process.env.PLAYWRIGHT_MODULE, 'playwright', '/opt/node22/lib/node_modules/playwright/index.mjs'];
  for (const name of tries.filter(Boolean)) {
    try {
      return (await import(name)).chromium;
    } catch { /* 다음 후보 */ }
  }
  throw new Error('playwright를 찾지 못했습니다. PLAYWRIGHT_MODULE에 경로를 넣어 주세요.');
}

/**
 * 들은 말을 적는다 — window.__said. 코치 목소리(coachVoice.js)는 이 배열이 있으면 말할 때마다
 * 거기에 적는다. 기기 음성합성도 가짜로 바꿔 둔다(소리를 내지 않고 적기만).
 */
export const FAKE_SPEECH = () => {
  window.__said = [];
  const voices = [{ name: 'Test Korean', lang: 'ko-KR', localService: true, default: true, voiceURI: 'test-ko' }];
  const synth = {
    speaking: false, pending: false, paused: false, onvoiceschanged: null,
    getVoices: () => voices,
    speak(utterance) {
      window.__said.push(utterance.text);
      synth.speaking = true;
      setTimeout(() => {
        synth.speaking = false;
        if (typeof utterance.onend === 'function') utterance.onend({ type: 'end' });
      }, 30);
    },
    cancel() { synth.speaking = false; },
    pause() {}, resume() {},
    addEventListener() {}, removeEventListener() {},
  };
  Object.defineProperty(window, 'speechSynthesis', { value: synth, configurable: true });
  window.SpeechSynthesisUtterance = function (text) { this.text = text; this.lang = 'ko-KR'; };
};

/**
 * 처음 설정 첫 장(동의) — 필수 셋은 줄마다 따로 보이고, 주 버튼 "필수 항목에 동의하고 시작합니다"가 필수만 더한다.
 * consent: 'required'면 필수만, 'all'이면 "선택 항목 보기"를 펼쳐 선택(알림 포함)까지 켠다.
 * press: false면 주 버튼은 누르지 않는다(백업 불러오기처럼 그 화면에서 더 할 것이 있을 때).
 */
export async function agreeConsent(page, { consent = 'required', press = true } = {}) {
  await page.waitForSelector('.consent-line');
  if (consent === 'all') {
    if (await page.locator('.consent-more[aria-expanded="false"]').count()) await page.locator('.consent-more').click();
    const toggles = page.locator('.consent-card .consent-toggle');
    for (let i = 0; i < await toggles.count(); i += 1) {
      if (await toggles.nth(i).getAttribute('aria-pressed') !== 'true') await toggles.nth(i).click();
    }
  }
  if (press) await page.locator('.wizard-nav .primary').click();
}

/**
 * 처음 설정을 끝까지 넘긴다 — 동의 → 세 가지만 알려 주세요 → 준비됐습니다 › 나중에 하겠습니다(오늘 화면).
 *
 * 경력 · 성별은 직접 골라야 넘어가므로 level · sex로 고른다. days는 시험들이 4일(상체 · 하체 번갈아)을
 * 기준으로 짜여 있어 4가 기본이다 — 앱의 기본값(3일)은 onboard60 · onboard가 본다.
 */
export async function onboard(page, { consent = 'required', level = '중급', sex = '남성', days = 4 } = {}) {
  await agreeConsent(page, { consent });
  await finishWizard(page, { level, sex, days });
}

/** "세 가지만 알려 주세요"부터 — 고르고, 내 운동 만들기, 준비됐습니다에서 나중에 하겠습니다(start: true면 첫 운동 시작). */
export async function finishWizard(page, { level = '중급', sex = '남성', days = 4, start = false } = {}) {
  await page.waitForSelector('.ob-q');
  await pickMe(page, { level, sex, days });
  await page.locator('.wizard-nav .primary').click();
  // 백업으로 기록을 들였으면 준비됐습니다 없이 바로 오늘 화면이다
  await page.waitForSelector('.ready-nav, .tabbar [role="tab"]:visible');
  if (await page.locator('.ready-nav').count()) {
    const later = page.locator('.ready-later');
    if (!start && await later.count()) await later.click();
    else await page.locator('.ready-go').click();
  }
  await page.waitForSelector('.tabbar [role="tab"], #focus:not([hidden])');
}

const LEVEL_CHIP = { 초보: '처음입니다', 중급: '6개월~2년', 고급: '2년 이상', 전문가: '전문가' };

/** "세 가지만 알려 주세요" — 경력 · 성별을 아직 안 골랐으면 고르고, days를 주면 그 일수로. */
export async function pickMe(page, { level = '중급', sex = '남성', days } = {}) {
  const levelRow = page.locator('.ob-q').first();
  if (await levelRow.locator('.segmented button[aria-pressed="true"]').count() === 0) {
    if (level === '전문가' && await page.locator('.level-more[aria-expanded="false"]').count()) await page.locator('.level-more').click();
    await levelRow.locator('.segmented button', { hasText: LEVEL_CHIP[level] || level }).click();
  }
  const male = page.locator('.segmented button', { hasText: sex });
  if (await male.getAttribute('aria-pressed') !== 'true') await male.click();
  if (days) {
    const want = page.locator('.ob-days .segmented button', { hasText: new RegExp(`^${days}일$`) });
    if (!await want.count()) await page.locator('.days-more').click();
    if (await want.getAttribute('aria-pressed') !== 'true') await want.click();
  }
}

/** 아래 탭 하나를 누른다. */
export async function tab(page, label) {
  await page.locator('.tabbar [role="tab"]', { hasText: label }).click();
}

/** 내 정보 › 헬스장 */
export async function gymTab(page) {
  await tab(page, '내 정보');
  await page.locator('.me-sections button', { hasText: '헬스장' }).click();
}

/** 조건이 참이 될 때까지. 실패하면 무엇을 기다렸는지 말한다. */
export function check(ok, message) {
  if (!ok) throw new Error(message);
}

/** 화면을 끈 것처럼(다른 앱으로 간 것처럼) — PT는 여기서 멈춘다. */
export async function setVisible(page, visible) {
  await page.evaluate((on) => {
    Object.defineProperty(document, 'visibilityState', { value: on ? 'visible' : 'hidden', configurable: true });
    Object.defineProperty(document, 'hidden', { value: !on, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  }, visible);
}

/** 내 정보 › 코치에서 PT를 고르고 오늘 화면으로 돌아온다. */
export async function choosePt(page) {
  await tab(page, '내 정보');
  await page.locator('.coach-settings .coach-mode', { hasText: 'PT' }).click();
  await tab(page, '오늘');
}

/**
 * 오늘 › 자세히 보기 — 세트 · 무게 · 줄마다 ⋯ · 순서 바꾸기 · 편집 · 다른 날 바꾸기가 여기 있다.
 * 고른 쪽을 기억하므로 이미 펼쳐져 있으면 그대로 둔다.
 */
export async function todayDetail(page) {
  const toggle = page.locator('.today-more');
  if (await toggle.count() && await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
}

/**
 * 오늘 조정(몸 상태 · 아픈 데 · 시간 · 혼자/PT)을 연다 — "오늘은 평소와 다릅니다 ›",
 * 이미 바꾼 게 있으면 그 줄("오늘 … 바꾸기"). 맨 처음 운동이면 운동 시작이 이 창을 연다.
 */
export async function adjustToday(page) {
  const line = page.locator('.start-dock .today-diff, .start-dock .today-adjust');
  if (await line.count()) await line.first().click();
  else await page.locator('.start-cta').click();
  await page.waitForSelector('dialog[open] .start-go');
}

/**
 * 운동 시작 — 맨 처음 한 번은 "오늘 운동 준비" 한 장이 뜨고 거기서 시작을 누른다.
 * 그 뒤로는 한 번에 시작한다(지난번 그대로). 이어서 하기도 바로 시작한다.
 */
export async function begin(page) {
  await page.locator('.start-cta').click();
  const go = page.locator('dialog .start-go');
  if (await go.count() && await go.isVisible()) await go.click();
}

/**
 * PT 집중 화면이 지금 무엇을 보여 주는가 — 앱 안의 상태는 밖에서 못 보므로
 * 화면에 뜬 것으로 읽는다.
 */
export async function focusPhase(page) {
  return page.evaluate(() => {
    const host = document.getElementById('focus');
    if (!host || host.hidden) {
      // 마무리 스트레칭은 집중 화면이 아니라 보통 화면에 뜬다
      return document.querySelector('.session-head h2')?.textContent === '마무리 스트레칭' ? 'cool' : null;
    }
    if (host.querySelector('.focus-feels')) return 'ask';
    // 멈춰도 같은 화면이다 — 멈췄는지는 data-paused로 읽는다
    if (host.dataset.paused === '1') return 'paused';
    // 앱이 지금 단계를 data-phase로 적는다(prep · warm · count · rest). 없으면(예전 빌드) 화면에 뜬 것으로
    if (host.dataset.phase) return host.dataset.phase;
    if (host.querySelector('#focus-prep-left')) return 'prep';
    if (host.querySelector('#focus-rest-time')) return 'rest';
    if (/워밍업 \d/.test(host.querySelector('.focus-what')?.textContent || '')) return 'warm';
    if (host.querySelector('#focus-num')) return 'count';
    return 'other';
  });
}

/** 가짜 시계를 조금씩 돌리며 집중 화면이 그 단계가 될 때까지. */
export async function runUntil(page, phases, { stepMs = 1000, maxMs = 300000 } = {}) {
  const want = [].concat(phases);
  for (let spent = 0; spent <= maxMs; spent += stepMs) {
    const now = await focusPhase(page);
    if (want.includes(now)) return now;
    await page.clock.runFor(stepMs);
  }
  throw new Error(`${maxMs / 1000}초를 돌려도 ${want.join('/')} 단계가 안 나왔습니다 (지금 ${await focusPhase(page)})`);
}

/** 운동 시작 — 혼자 모드는 몸 풀기 카드가 먼저 뜬다. 종목을 보려는 시험은 "몸 풀기 건너뛰기"로 넘긴다. */
export async function startWorkout(page) {
  await begin(page);
  if (await page.locator('.warm-skip').count()) await page.locator('.warm-skip').click();
}

/** 쉬는 동안 운동 설명 · 세트 중 동작 그림 끄기 — 오래 돌리는 PT 테스트에서 가짜 시계가 동작 그림을 프레임마다 그리느라 느려진다. */
export async function restGuideOff(page) {
  await tab(page, '내 정보');
  // 소리 설정은 PT(또는 소리 켜기)일 때만 보인다 — 잠깐 PT로 바꿔 끄고, 원래 방식으로 돌린다
  const modes = page.locator('.coach-settings .coach-mode');
  const was = await modes.evaluateAll((buttons) => buttons.findIndex((b) => b.getAttribute('aria-pressed') === 'true'));
  await page.locator('.coach-settings .coach-mode', { hasText: 'PT' }).click();
  await page.locator('.list-label:has-text("쉬는 동안 운동 설명") ~ .segmented').first().locator('button', { hasText: '끄기' }).click();
  await page.locator('.list-label:has-text("세트 중 동작 그림") ~ .segmented').first().locator('button', { hasText: '끄기' }).click();
  if (was >= 0) await modes.nth(was).click();
  await tab(page, '오늘');
}

/** 혼자 운동 화면 — 쉬는 중이면 "바로 다음 세트"로 휴식을 끝낸다(다른 화면이면 아래 휴식 막대의 건너뛰기). 쉬는 중이 아니면 그대로. */
export async function skipRest(page) {
  const now = page.locator('#solo-stage .rest-now');
  if (await now.count()) { await now.click(); return true; }
  const bar = page.locator('#rest-host .rest-skip', { hasText: '건너뛰기' });
  if (await bar.count() && await bar.isVisible()) { await bar.click(); return true; }
  return false;
}

/** 혼자 운동 화면 — 지금 세트 완료. 쉬는 중이면 휴식부터 끝낸다. */
export async function doneSet(page) {
  await skipRest(page);
  await page.locator('.now-done').click();
}

/** 혼자 운동 화면의 "자세히 보기 ›"(세트 표 · 워밍업 · 세트 더하기) — 닫혀 있으면 연다. */
export async function openDetail(page) {
  const toggle = page.locator('#solo-stage .detail-toggle');
  if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
}

/** 혼자 운동 화면의 ⋯에서 하나 고른다(기구에 사람이 있어요 · 아픈 데가 있어요 · 운동 끝내기 …). */
export async function stageMenu(page, label) {
  await page.locator('#solo-stage .stage-more').click();
  await page.locator('dialog .menu-row', { hasText: label }).click();
}

/*
 * PT 집중 화면 — 혼자 운동 화면과 같은 틀: 아래에 채운 버튼 하나(.focus-go)와 일시정지 Ⅱ,
 * 나머지(PT 끄기 · 빠르기 · 주머니 모드 · 세트 고치기 · 워밍업 빼기 · 건너뛰기 · 아픈 데 · 운동 끝내기)는 ⋯에.
 */

/** PT 화면의 ⋯에서 하나 고른다. */
export async function ptMenu(page, label) {
  await page.locator('#focus .focus-menu').click();
  await page.locator('dialog .menu-row', { hasText: label }).click();
}

/** PT 화면 아래의 채운 버튼(바로 시작 · 세트 완료 · 다음 세트 시작 · 다음 워밍업 · ▶ 계속 …). text를 주면 그 글자가 든 버튼인지 본다. */
export async function ptGo(page, text) {
  const go = page.locator('#focus .focus-go');
  if (text) {
    const now = await go.textContent();
    check(now.includes(text), `PT 버튼이 "${text}"가 아니라 "${now}"입니다`);
  }
  await go.click();
}

/** 몸 풀기 · 워밍업 건너뛰기(⋯). */
export const skipPrep = (page) => ptMenu(page, '몸 풀기 건너뛰기');
export const skipWarm = (page) => ptMenu(page, '워밍업 건너뛰기');

/** PT 일시정지(버튼 옆 Ⅱ). */
export const ptPause = (page) => page.locator('#focus .focus-pause').click();

/** PT 화면의 "자세히 보기 ›"(다음 할 것 · 워밍업 목록 · 세 줄 · 방금 적은 세트 · 세트 칸) — 닫혀 있으면 연다. 고른 쪽을 기억한다. */
export async function ptDetail(page) {
  const toggle = page.locator('#focus .focus-detail-toggle');
  if (await toggle.count() && await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
}

/** PT 화면에서 글자 하나 — 없으면 ''(기다리지 않는다). 예: focusText(page, '.focus-pos') → "다음 운동" */
export function focusText(page, selector) {
  return page.evaluate((sel) => document.querySelector('#focus ' + sel)?.textContent || '', selector);
}
