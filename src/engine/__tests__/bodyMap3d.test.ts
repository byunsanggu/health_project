import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { MUSCLE_GROUPS } from '../muscles.ts';
import { EXERCISES } from '../exercises.ts';

/*
 * 3D 근육 그림(prototype/bodyMap3d.js)은 브라우저 JS지만, 엔진과 짝이 맞는지는 여기서 지킨다.
 * 근육 칸 차례가 엔진과 어긋나면 가슴을 칠하라는데 등이 칠해진다 — 화면에서는 그럴듯해 보여서
 * 사람 눈으로는 못 잡는다.
 */
const source = readFileSync(new URL('../../../prototype/bodyMap3d.js', import.meta.url), 'utf8');

interface Body3D {
  available(): boolean;
  muscles(): string[];
  weights(contribution: Record<string, number>, pattern?: string): Float32Array;
  framing(contribution: Record<string, number>, pattern?: string): { side: 'front' | 'back'; part: 'upper' | 'lower' };
}

function load(withLayers = true): Body3D {
  const sandbox: { window: Record<string, unknown> } = { window: withLayers ? { __BODY3D__: { 'full-front': 'data:' } } : {} };
  vm.runInNewContext(source, sandbox);
  return sandbox.window.FitBody3D as Body3D;
}

const byId = (id: string) => EXERCISES.find((exercise) => exercise.id === id)!;

/** PNG 머리에서 가로 · 세로를 읽는다. */
function pngSize(path: URL): { w: number; h: number } {
  const png = readFileSync(path);
  return { w: png.readUInt32BE(16), h: png.readUInt32BE(20) };
}

describe('3D 근육 그림', () => {
  test('근육 칸 차례가 엔진 MUSCLE_GROUPS와 같다', () => {
    // vm 안에서 만든 배열이라 이쪽 배열로 옮겨 담아 비교한다
    assert.deepEqual([...load().muscles()], [...MUSCLE_GROUPS]);
  });

  test('기여도를 세기로 — 0.3짜리도 보이게 하한을 두고, 안 쓰는 근육은 0', () => {
    const w = load().weights({ chest: 1, triceps: 0.5 });
    const at = (muscle: string) => w[MUSCLE_GROUPS.indexOf(muscle as never)]!;
    assert.equal(at('chest'), 1);
    assert.ok(Math.abs(at('triceps') - 0.625) < 1e-6);
    assert.equal(at('quads'), 0);
    assert.equal(w[15], 0, '15번은 "근육 없음" 칸');
  });

  test('엉덩이를 접는 종목의 "등"은 허리에 칠한다 — 광배근이 아니다', () => {
    const map = load();
    const rdl = byId('romanian-deadlift');
    const hinge = map.weights(rdl.contribution, rdl.pattern);
    assert.equal(hinge[MUSCLE_GROUPS.indexOf('back')], 0);
    assert.ok(hinge[14]! > 0, '14번 허리 칸');
    const pull = map.weights(byId('lat-pulldown').contribution, byId('lat-pulldown').pattern);
    assert.equal(pull[MUSCLE_GROUPS.indexOf('back')], 1);
    assert.equal(pull[14], 0);
  });

  test('썸네일은 칠할 게 많은 쪽을 크게 — 앞/뒤, 위/아래', () => {
    const map = load();
    const pick = (id: string) => { const ex = byId(id); return { ...map.framing(ex.contribution, ex.pattern) }; };
    assert.deepEqual(pick('barbell-bench-press'), { side: 'front', part: 'upper' });
    assert.deepEqual(pick('pull-up'), { side: 'back', part: 'upper' });
    assert.deepEqual(pick('back-squat'), { side: 'front', part: 'lower' });
    assert.deepEqual(pick('romanian-deadlift'), { side: 'back', part: 'lower' });
  });

  test('모든 종목이 그릴 구도를 받는다 — 고른 구도의 장이 실제로 있다', () => {
    const map = load();
    for (const exercise of EXERCISES) {
      const f = map.framing(exercise.contribution, exercise.pattern);
      const file = new URL(`../../../prototype/body3d/${f.part}-${f.side}.png`, import.meta.url);
      assert.ok(pngSize(file).w > 0, `${exercise.name}: ${f.part}-${f.side}`);
    }
  });

  test('장은 위 절반 빛 · 아래 절반 근육 칸 — 세로가 가로의 두 배(썸네일) · 네 배(전신)', () => {
    for (const name of ['upper-front', 'upper-back', 'lower-front', 'lower-back']) {
      const { w, h } = pngSize(new URL(`../../../prototype/body3d/${name}.png`, import.meta.url));
      assert.equal(h, w * 2, name);
    }
    for (const name of ['full-front', 'full-back']) {
      const { w, h } = pngSize(new URL(`../../../prototype/body3d/${name}.png`, import.meta.url));
      assert.equal(h, w * 4, name);
    }
  });

  test('장이 안 실린 판은 쓰지 않는다고 말한다 — 부르는 쪽이 평면 그림을 쓴다', () => {
    assert.equal(load(false).available(), false);
    assert.equal(load(true).available(), true);
  });
});
