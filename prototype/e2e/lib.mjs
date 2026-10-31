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
 * 처음 설정을 끝까지 넘긴다.
 *
 * consent: 'required'면 필수만, 'all'이면 선택까지 전부 동의한다.
 * 단계 · 성별은 직접 골라야 넘어가므로 level · sex로 고른다. 나머지는 기본값 그대로.
 */
export async function onboard(page, { consent = 'required', level = '중급', sex = '남성' } = {}) {
  await page.waitForSelector('.consent-card');
  // 선택 항목은 접혀 있다 — 전부 동의하려면 펼친다
  if (consent === 'all' && await page.locator('.consent-more[aria-expanded="false"]').count()) await page.locator('.consent-more').click();
  const cards = page.locator('.consent-card');
  for (let i = 0; i < await cards.count(); i += 1) {
    const card = cards.nth(i);
    const required = await card.locator('.consent-tag.req').count() > 0;
    if (consent === 'all' || required) {
      const toggle = card.locator('.consent-toggle');
      if (await toggle.getAttribute('aria-pressed') !== 'true') await toggle.click();
    }
  }
  await finishWizard(page, { level, sex });
}

/** 설문 나머지를 "다음"으로 넘긴다. 고르라고 막혀 있으면 고른다. */
export async function finishWizard(page, { level = '중급', sex = '남성' } = {}) {
  for (let i = 0; i < 14; i += 1) {
    const step = (await page.locator('.session-head h2').textContent()).trim();
    if (step === '나에 대해') await pickMe(page, { level, sex });
    const next = page.locator('.wizard-nav .primary');
    const text = (await next.textContent()).trim();
    await next.click();
    if (text === '이 프로그램으로 시작') break;
  }
  await page.waitForSelector('.tabbar [role="tab"]');
}

/** 처음 설정 "나에 대해" — 경력 단계와 성별을 아직 안 골랐으면 고른다. */
export async function pickMe(page, { level = '중급', sex = '남성' } = {}) {
  if (await page.locator('.choice[aria-pressed="true"]', { hasText: /초보|중급|고급|전문가/ }).count() === 0) {
    await page.locator('.choice', { hasText: level }).first().click();
  }
  const male = page.locator('.segmented button', { hasText: sex });
  if (await male.getAttribute('aria-pressed') !== 'true') await male.click();
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
 * 시작하기 — 처음이면 "오늘 운동 준비" 한 장이 뜨고 거기서 시작을 누른다.
 * 이어서 하기(세트를 한 뒤 · PT 멈춘 뒤)는 바로 시작한다.
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
    if (/PT 일시정지/.test(host.textContent)) return 'paused';
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

/** 시작하기 — 혼자 모드는 몸 풀기 단계가 먼저 뜬다. 종목을 보려는 시험은 건너뛴다. */
export async function startWorkout(page) {
  await begin(page);
  if (await page.locator('.warm-skip').count()) await page.locator('.warm-skip').click();
}

/** 쉬는 동안 운동 설명 · 운동 중 동작 보기 끄기 — 오래 돌리는 PT 테스트에서 가짜 시계가 동작 그림을 프레임마다 그리느라 느려진다. */
export async function restGuideOff(page) {
  await tab(page, '내 정보');
  // 소리 설정은 PT(또는 소리 켜기)일 때만 보인다 — 잠깐 PT로 바꿔 끄고, 원래 방식으로 돌린다
  const modes = page.locator('.coach-settings .coach-mode');
  const was = await modes.evaluateAll((buttons) => buttons.findIndex((b) => b.getAttribute('aria-pressed') === 'true'));
  await page.locator('.coach-settings .coach-mode', { hasText: 'PT' }).click();
  await page.locator('.list-label:has-text("쉬는 동안 운동 설명") ~ .segmented').first().locator('button', { hasText: '끄기' }).click();
  await page.locator('.list-label:has-text("운동 중 동작 보기") ~ .segmented').first().locator('button', { hasText: '끄기' }).click();
  if (was >= 0) await modes.nth(was).click();
  await tab(page, '오늘');
}
