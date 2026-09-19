import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { MUSCLE_GROUPS } from '../muscles.ts';
import type { MuscleGroup } from '../types.ts';
import { EXERCISES } from '../exercises.ts';

/*
 * 근육 지도도 프로토타입 쪽(브라우저 JS)에 있지만, 엔진의 근육군과 짝이
 * 맞는지는 여기서 지킨다. 근육군을 추가하고 그림을 잊으면 그 근육은
 * 영원히 안 칠해지는데, 화면에서는 "안 쓰는 근육"과 구분이 안 된다.
 */
const source = readFileSync(new URL('../../../prototype/bodyMap.js', import.meta.url), 'utf8');

interface MapModule {
  has(muscle: string): boolean;
  sideOf(muscle: string): 'front' | 'back' | null;
  muscles(): string[];
}

function loadMap(): MapModule {
  const sandbox: { window: Record<string, unknown> } = { window: {} };
  vm.runInNewContext(source, sandbox);
  return sandbox.window.FitBodyMap as MapModule;
}

describe('근육 지도', () => {
  test('엔진의 근육군 14개가 모두 그려져 있다', () => {
    const map = loadMap();
    const missing = MUSCLE_GROUPS.filter((muscle: MuscleGroup) => !map.has(muscle));
    assert.deepEqual(missing, [], `그림 없는 근육: ${missing.join(', ')}`);
  });

  test('근육군에 없는 칸은 없다', () => {
    const map = loadMap();
    const extra = [...map.muscles()].filter((muscle) => !MUSCLE_GROUPS.includes(muscle as MuscleGroup));
    assert.deepEqual(extra, []);
  });

  test('한 근육은 정면이나 후면 한쪽에만 나온다', () => {
    /*
     * 양쪽에 칠하면 "두 군데가 켜졌다"로 읽힌다. 정면 7 · 후면 7로 갈라
     * 두었는지 확인한다 — 한쪽으로 쏠리면 그림 하나가 비어 보인다.
     */
    const map = loadMap();
    const front = MUSCLE_GROUPS.filter((muscle: MuscleGroup) => map.sideOf(muscle) === 'front');
    const back = MUSCLE_GROUPS.filter((muscle: MuscleGroup) => map.sideOf(muscle) === 'back');
    assert.equal(front.length + back.length, MUSCLE_GROUPS.length);
    assert.ok(Math.abs(front.length - back.length) <= 2, `정면 ${front.length} · 후면 ${back.length}`);
  });

  test('모든 종목의 기여 근육이 그림에 있다', () => {
    // 종목 83개 중 하나라도 못 그리는 근육을 쓰면 그 종목만 빈 몸이 나온다.
    const map = loadMap();
    for (const exercise of EXERCISES) {
      for (const muscle of Object.keys(exercise.contribution)) {
        assert.ok(map.has(muscle), `${exercise.name}의 ${muscle}에 그림이 없습니다`);
      }
    }
  });

  test('색을 박아 넣지 않았다', () => {
    // 하드코딩하면 다크 모드에서 안 보인다. 농도만 다르고 색은 CSS가 준다.
    assert.equal(/fill="#|stroke="#|fill="rgb|stroke="rgb/.test(source), false);
  });
});
