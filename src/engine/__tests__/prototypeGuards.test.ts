import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { CARDIO, EQUIPMENT_CATALOG } from '../index.ts';

/*
 * 프로토타입 코드에 대한 구조적 금지 사항.
 *
 * 기능 테스트로는 안 잡히고 실제 기기에서만 터지는 것들이 있다. 여기 적힌
 * 것들은 전부 한 번씩 실제로 터졌던 것이다.
 */
const app = readFileSync(new URL('../../../prototype/app.js', import.meta.url), 'utf8');
const artSource = readFileSync(
  new URL('../../../prototype/equipmentArt.js', import.meta.url), 'utf8');

/**
 * 그림 표에서 키만 뽑는다.
 *
 * 표를 통째로 실행하려면 DOM이 필요한데, 여기서 알고 싶은 건 "그 종목의
 * 그림이 표에 있나" 하나뿐이다. 표의 시작과 끝 사이에서 키만 읽는다.
 */
function artKeys(table: string): string[] {
  const start = artSource.indexOf('var ' + table + ' = {');
  const end = artSource.indexOf('\n  };', start);
  if (start < 0 || end < 0) throw new Error(table + ' 표를 못 찾았습니다');
  return [...artSource.slice(start, end).matchAll(/^    '?([a-z0-9-]+)'?:/gm)]
    .map((match) => match[1]!);
}

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

  it('유산소 종목마다 그림이 있다', () => {
    /*
     * 그림이 없으면 그 줄만 빈 네모가 된다. 목록에서 한 줄만 비어 있으면
     * 고장난 것처럼 보이는데, 종목을 새로 더할 때 그림을 같이 그리는 걸
     * 잊기가 쉽다 — 잊어도 화면이 조용해서 안 잡힌다. 여기서 잡는다.
     */
    const drawn = new Set(artKeys('CARDIO_ART'));
    const missing = CARDIO.filter((item) => !drawn.has(item.id)).map((item) => item.name);
    assert.deepEqual(missing, [], `그림 없는 유산소: ${missing.join(', ')}`);
  });

  it('기구 그림과 유산소 그림이 서로 섞이지 않는다', () => {
    /*
     * 두 표가 같은 키를 가지면, 부르는 쪽이 표를 잘못 고를 때 **빈칸이
     * 아니라 엉뚱한 그림**이 나온다. 빈칸은 눈에 띄지만 틀린 그림은 안
     * 띈다 — 겹치는 순간 여기서 막는다.
     */
    const equipment = new Set(artKeys('ART'));
    const overlap = artKeys('CARDIO_ART').filter((id) => equipment.has(id));
    assert.deepEqual(overlap, [], `두 표에 같이 있는 id: ${overlap.join(', ')}`);
  });

  it('기구 그림표의 키가 실제 기구 id다', () => {
    /*
     * 오타가 나면 조용히 빈칸이 된다. floor는 맨몸 종목의 자리라서
     * 기구 목록에는 없다 — 그것만 빼고 전부 실재해야 한다.
     */
    const known = new Set(EQUIPMENT_CATALOG.map((item) => item.id));
    const unknown = artKeys('ART').filter((id) => id !== 'floor' && !known.has(id));
    assert.deepEqual(unknown, [], `없는 기구의 그림: ${unknown.join(', ')}`);
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
