// 아이폰에서 PT 중 음악이 끊기지 않게.
//   · 화면이 켜져 있는 동안 소리 성격(navigator.audioSession)은 늘 'transient' — 화면을 껐다 켜도, 잠금 소리 파일이 끝나도.
//     'auto'로 남아 있으면 그 상태로 나는 코치 목소리가 아이폰의 음악을 멈출 수 있다.
//   · <audio>(음악을 멈추는 길)는 화면이 꺼진 동안에만 튼다.
//   · 아이폰은 PT 내내 화면을 켜 둔다(wake lock) — 저절로 잠기지 않으니 음악과 코치가 같이 나온다.
//     ⋯ › "화면 켜 두기 (음악 안 끊김)"로 끄고 켤 수 있고(이 폰에 저장), 10분 넘게 멈춰 두면 놓는다.
import { begin, check, choosePt, onboard, ptGo, ptPause, restGuideOff, runUntil, setVisible, skipPrep, skipWarm } from './lib.mjs';

const IPHONE = () => {
  Object.defineProperty(navigator, 'userAgent', {
    get: () => 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
    configurable: true,
  });
  // 처음에는 'auto' — 앱이 'transient'로 바꾸는지 본다
  window.__session = { type: 'auto' };
  Object.defineProperty(navigator, 'audioSession', { value: window.__session, configurable: true });
  window.__lock = { held: 0, requests: 0 };
  Object.defineProperty(navigator, 'wakeLock', {
    configurable: true,
    value: {
      request(kind) {
        window.__lock.requests += 1;
        window.__lock.held += 1;
        const listeners = [];
        const sentinel = {
          type: kind, released: false,
          addEventListener(type, fn) { if (type === 'release') listeners.push(fn); },
          removeEventListener() {},
          release() {
            if (!sentinel.released) { sentinel.released = true; window.__lock.held -= 1; listeners.forEach((fn) => fn()); }
            return Promise.resolve();
          },
        };
        return Promise.resolve(sentinel);
      },
    },
  });
  window.__plays = [];
  HTMLMediaElement.prototype.play = function () {
    window.__plays.push({ muted: this.muted, visible: document.visibilityState === 'visible' });
    window.__lastAudio = this;
    return Promise.resolve();
  };
  HTMLMediaElement.prototype.pause = function () {};
};

const session = (page) => page.evaluate(() => navigator.audioSession.type);
const held = (page) => page.evaluate(() => window.__lock.held);
const loudVisible = (page) => page.evaluate(() => window.__plays.filter((p) => !p.muted && p.visible).length);

async function both(page, shot, name) {
  await shot(name + '-390');
  await page.setViewportSize({ width: 360, height: 640 });
  await page.waitForTimeout(50);
  await shot(name + '-360');
  await page.setViewportSize({ width: 390, height: 844 });
}

async function toCount(page) {
  if (await runUntil(page, ['warm', 'count']) === 'warm') {
    await skipWarm(page);
    await runUntil(page, 'count');
  }
}

export default async function ({ page, url, shot }) {
  await page.addInitScript(IPHONE);
  await page.clock.install({ time: new Date('2026-10-22T18:00:00+09:00') });
  await page.goto(url);
  check(await page.evaluate(() => window.RestSound.backgroundMixes()) === false, '아이폰으로 보지 않습니다');
  check(await session(page) === 'transient', '처음 소리 성격이 transient가 아닙니다: ' + await session(page));
  await onboard(page);
  await restGuideOff(page);
  await choosePt(page);
  await begin(page);
  await runUntil(page, 'prep');

  // PT 내내 화면을 켜 둔다 — 쉬는 시간만이 아니다
  check(await held(page) === 1, '아이폰 PT인데 화면을 켜 두지 않았습니다(몸 풀기)');
  await skipPrep(page);
  await toCount(page);
  check(await held(page) === 1, '세는 중에 화면을 놓았습니다');

  // 화면을 껐다 켜면 — 켜진 뒤에는 transient
  await setVisible(page, false);
  await setVisible(page, true);
  await page.clock.runFor(50);
  check(await session(page) === 'transient', '껐다 켠 뒤 소리 성격: ' + await session(page));
  check(await held(page) === 1, '돌아왔는데 화면을 다시 잡지 않았습니다');
  await toCount(page);

  // 쉬는 중에 화면을 끄면 아이폰은 <audio>로(그때만) — 그 소리가 끝나면 바로 transient로 되돌린다
  for (let i = 0; i < 120 && !/^\d+$/.test(await page.locator('#focus-num').textContent().catch(() => '')); i += 1) await page.clock.runFor(500);
  await ptGo(page, '세트 완료');
  await runUntil(page, 'rest');
  await setVisible(page, false);
  check(await session(page) === 'auto', '화면이 꺼진 뒤 <audio> 길로 가지 않았습니다: ' + await session(page));
  check(await page.evaluate(() => window.__plays.filter((p) => !p.muted && !p.visible).length) > 0, '화면이 꺼졌는데 소리를 틀지 않았습니다');
  await page.evaluate(() => window.__lastAudio.dispatchEvent(new Event('ended')));
  check(await session(page) === 'transient', '소리 파일이 끝났는데 소리 성격이 auto로 남았습니다');
  // 'auto'로 남은 채 돌아와도 — 켜지면 transient
  await page.evaluate(() => { navigator.audioSession.type = 'auto'; });
  await setVisible(page, true);
  await page.clock.runFor(50);
  check(await session(page) === 'transient', '돌아온 뒤 소리 성격: ' + await session(page));

  // 화면이 켜진 채 코치 소리를 내기 직전에도 되돌린다 · 화면이 켜진 동안 <audio>는 틀지 않는다
  await page.evaluate(() => { navigator.audioSession.type = 'auto'; window.RestSound.ambient(); });
  check(await session(page) === 'transient', '소리 내기 직전에 transient로 되돌리지 않았습니다');
  await page.evaluate(() => window.RestSound.start(30, '시험'));
  check(await loudVisible(page) === 0, '화면이 켜진 채 소리 나는 <audio>를 틀었습니다 — 아이폰이 음악을 멈춥니다');

  // ⋯ › 화면 켜 두기 — 아이폰은 기본 켜짐. 끄면 (쉬는 중이 아니면) 놓고, 켜면 다시 잡는다
  await toCount(page);
  await page.locator('#focus .focus-menu').click();
  const row = page.locator('dialog .keep-awake-row');
  check(await row.getAttribute('aria-pressed') === 'true', '아이폰인데 화면 켜 두기가 꺼져 있습니다');
  check((await row.textContent()).includes('화면 켜 두기 (음악 안 끊김)'), '메뉴 글자: ' + await row.textContent());
  await both(page, shot, '1-menu');
  await row.click();
  check(await page.locator('dialog .keep-awake-row').getAttribute('aria-pressed') === 'false', '끄기가 안 됩니다');
  check(await held(page) === 0, '화면 켜 두기를 껐는데 세는 중에 화면을 잡고 있습니다');
  await page.locator('dialog .keep-awake-row').click();
  check(await held(page) === 1, '다시 켰는데 화면을 잡지 않았습니다');
  check(await page.evaluate(() => localStorage.getItem('volume-coach.keepAwake')) === '1', '이 폰에 저장하지 않았습니다');
  await page.locator('dialog .modal-close').click();

  // 10분 넘게 멈춰 두면 화면을 놓는다 — 계속을 누르면 다시 잡는다
  await ptPause(page);
  await page.clock.runFor(9 * 60 * 1000);
  check(await held(page) === 1, '10분도 안 됐는데 화면을 놓았습니다');
  await page.clock.runFor(2 * 60 * 1000);
  check(await held(page) === 0, '10분 넘게 멈췄는데 화면을 잡고 있습니다');
  await ptGo(page, '계속');
  check(await held(page) === 1, '계속을 눌렀는데 화면을 다시 잡지 않았습니다');

  // 처음 한 번 뜨는 안내 — 옆 버튼 · 화면 켜 두기 · 주머니 모드
  check(await page.evaluate(() => localStorage.getItem('volume-coach.pocketOffered')) === '1', '아이폰 안내를 띄우지 않았습니다');
  check(await loudVisible(page) === 0, '화면이 켜진 채 소리 나는 <audio>를 틀었습니다');
}
