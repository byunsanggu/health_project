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

const DIST = resolve(fileURLToPath(new URL('../dist/', import.meta.url)));
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
 * 말하기를 가짜로 바꾼다. 소리를 내는 대신 window.__said에 적고, 잠깐 뒤
 * 끝났다고 알린다 — 앱이 "말 끝나면 다음"을 기다리는 곳이 있다.
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
 * 나머지 단계는 기본값 그대로 "다음"을 누른다.
 */
export async function onboard(page, { consent = 'required' } = {}) {
  await page.waitForSelector('.consent-card');
  const cards = page.locator('.consent-card');
  for (let i = 0; i < await cards.count(); i += 1) {
    const card = cards.nth(i);
    const required = await card.locator('.consent-tag.req').count() > 0;
    if (consent === 'all' || required) {
      const toggle = card.locator('.consent-toggle');
      if (await toggle.getAttribute('aria-pressed') !== 'true') await toggle.click();
    }
  }
  for (let i = 0; i < 12; i += 1) {
    const next = page.locator('.wizard-nav .primary');
    const text = (await next.textContent()).trim();
    await next.click();
    if (text === '이 프로그램으로 시작') break;
  }
  await page.waitForSelector('.tabbar [role="tab"]');
}

/** 아래 탭 하나를 누른다. */
export async function tab(page, label) {
  await page.locator('.tabbar [role="tab"]', { hasText: label }).click();
}

/** 조건이 참이 될 때까지. 실패하면 무엇을 기다렸는지 말한다. */
export function check(ok, message) {
  if (!ok) throw new Error(message);
}
