import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { EQUIPMENT_CATALOG } from '../equipment.ts';

/*
 * 기구 그림은 프로토타입 쪽(브라우저 JS)에 있지만, 카탈로그와 짝이 맞는지는
 * 여기서 지킨다. 기구를 추가하고 그림을 잊으면 목록에 빈 칸이 생긴다 —
 * 그 순간은 화면을 열어봐야 알게 되므로, 테스트가 먼저 잡아야 한다.
 */
const source = readFileSync(new URL('../../../prototype/equipmentArt.js', import.meta.url), 'utf8');

interface ArtModule {
  has(id: string): boolean;
  coverage(): number;
}

function loadArt(): ArtModule {
  // 브라우저용 IIFE라 window에 붙는다. 샌드박스 하나 주고 받아온다.
  const sandbox: { window: Record<string, unknown> } = { window: {} };
  vm.runInNewContext(source, sandbox);
  return sandbox.window.FitEquipmentArt as ArtModule;
}

describe('기구 그림', () => {
  test('카탈로그의 모든 기구에 그림이 있다', () => {
    const art = loadArt();
    const missing = EQUIPMENT_CATALOG.filter((item) => !art.has(item.id)).map((item) => item.id);
    assert.deepEqual(missing, [], `그림 없는 기구: ${missing.join(', ')}`);
  });

  test('카탈로그에 없는 그림은 없다', () => {
    // 기구를 지웠는데 그림만 남으면 죽은 코드가 쌓인다.
    const art = loadArt();
    assert.equal(art.coverage(), EQUIPMENT_CATALOG.length);
  });

  test('그림은 currentColor로만 그려진다', () => {
    /*
     * 색을 박아 넣으면 다크 모드에서 안 보이거나, 고른 줄에서 강조색으로
     * 바뀌지 않는다. 그림 쪽에 색이 들어오지 못하게 막는다.
     */
    assert.equal(/fill="#|stroke="#|fill="rgb|stroke="rgb/.test(source), false);
    assert.match(source, /stroke', 'currentColor'/);
  });

  test('모든 좌표가 64×48 안에 있다', () => {
    /*
     * viewBox를 넘으면 잘린 그림이 나간다. 눈으로 한 번 보고 넘어가면
     * 나중에 하나 고칠 때 조용히 새 나간다.
     */
    const numbers = source.match(/'<[^']*'/g) ?? [];
    for (const chunk of numbers) {
      for (const value of chunk.match(/-?\d+(\.\d+)?/g) ?? []) {
        const n = Number(value);
        assert.ok(n >= -60 && n <= 64, `좌표가 범위를 벗어났습니다: ${n} (${chunk.slice(0, 40)})`);
      }
    }
  });
});
