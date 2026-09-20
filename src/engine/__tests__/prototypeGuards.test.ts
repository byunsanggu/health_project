import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';

/*
 * 프로토타입 코드에 대한 구조적 금지 사항.
 *
 * 기능 테스트로는 안 잡히고 실제 기기에서만 터지는 것들이 있다. 여기 적힌
 * 것들은 전부 한 번씩 실제로 터졌던 것이다.
 */
const app = readFileSync(new URL('../../../prototype/app.js', import.meta.url), 'utf8');

describe('프로토타입 금지 사항', () => {
  it('브라우저 확인창을 쓰지 않는다', () => {
    /*
     * confirm/alert/prompt는 iframe 안에서(아티팩트, 웹뷰, 일부 인앱
     * 브라우저) 뜨지도 않고 조용히 취소로 처리된다. 그러면 버튼을 눌러도
     * 아무 일이 안 일어나고, 사용자는 앱이 고장났다고 본다.
     *
     * 실제로 "오늘 할 날 바꾸기"가 이것 때문에 먹통이었다. 물어볼 게
     * 있으면 앱 안 모달로 묻는다.
     */
    /*
     * 점 뒤는 세지 않는다 — installEvent.prompt()는 PWA 설치 프롬프트라
     * 전혀 다른 것이다. window.confirm처럼 전역으로 부르는 것만 잡는다.
     */
    const found = [
      ...app.matchAll(/(?<![.\w$])(confirm|alert|prompt)\s*\(/g),
      ...app.matchAll(/\bwindow\.(confirm|alert|prompt)\s*\(/g),
    ].map((match) => match[1]!);
    assert.deepEqual([...new Set(found)], [], `브라우저 확인창 사용: ${found.join(', ')}`);
  });

  it('조사 자리표시자가 화면에 나가지 않는다', () => {
    /*
     * "을(를)", "은(는)" 같은 표기는 한국어 앱에서 성의 없어 보인다.
     * 엔진의 withParticle / particle을 쓰면 받침을 보고 고른다.
     */
    const placeholders = [...app.matchAll(/(을\(를\)|은\(는\)|이\(가\)|\(으\)로|와\(과\))/g)]
      .map((match) => match[1]!);
    assert.deepEqual([...new Set(placeholders)], []);
  });
});
