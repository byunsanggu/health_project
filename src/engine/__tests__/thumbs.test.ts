import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { EXERCISES } from '../exercises.ts';
import { EQUIPMENT_CATALOG } from '../equipment.ts';
import { stretchMotionIds } from '../motionsStretch.ts';

/*
 * 3D 썸네일(prototype/thumbs — tools/thumbs/render.mjs가 굽는다)이 카탈로그와 짝이 맞는지.
 * 운동 · 기구를 추가하고 그림을 굽지 않으면 그 칸만 선 그림으로 남는다 — 화면을 열어 봐야 알게 되므로 여기서 잡는다.
 * 다시 굽기: node tools/thumbs/render.mjs
 */
const dir = (kind: string): URL => new URL(`../../../prototype/thumbs/${kind}/`, import.meta.url);
const isWebp = (file: URL): boolean => {
  const head = readFileSync(file).subarray(0, 12);
  return head.subarray(0, 4).toString('latin1') === 'RIFF' && head.subarray(8, 12).toString('latin1') === 'WEBP';
};

describe('3D 썸네일', () => {
  for (const [kind, ids] of [['ex', EXERCISES.map((e) => e.id)], ['eq', EQUIPMENT_CATALOG.map((i) => i.id)]] as const) {
    test(`${kind}: 모든 id에 작은 그림과 큰 그림이 있다`, () => {
      const missing: string[] = [];
      for (const id of ids) {
        for (const name of [`${id}.webp`, `${id}@3x.webp`]) {
          const file = new URL(name, dir(kind));
          if (!existsSync(file) || !isWebp(file)) missing.push(name);
        }
      }
      assert.deepEqual(missing, [], `그림이 없습니다 — node tools/thumbs/render.mjs --only <id> 로 구워 주세요`);
    });

    test(`${kind}: 카탈로그에 없는 그림이 남아 있지 않다`, () => {
      const known = new Set(ids.flatMap((id) => [`${id}.webp`, `${id}@3x.webp`]));
      assert.deepEqual(readdirSync(dir(kind)).filter((name) => !known.has(name)), []);
    });
  }

  test('다 합쳐 3MB를 넘지 않는다 (폰 저장 공간 · 첫 화면 받는 양)', () => {
    let total = 0;
    for (const kind of ['ex', 'eq']) for (const name of readdirSync(dir(kind))) total += statSync(new URL(name, dir(kind))).size;
    assert.ok(total < 3 * 1024 * 1024, `썸네일이 ${total}바이트입니다`);
  });

  test('손질 표(overrides.mjs)가 있는 id만 가리킨다', async () => {
    const mod = await import(new URL('../../../tools/thumbs/overrides.mjs', import.meta.url).href) as {
      EX: Record<string, unknown>; EQ: Record<string, { ex?: string; st?: string }>;
    };
    const ex = new Set(EXERCISES.map((e) => e.id));
    const eq = new Set(EQUIPMENT_CATALOG.map((i) => i.id));
    const st = new Set(stretchMotionIds());
    assert.deepEqual(Object.keys(mod.EX).filter((id) => !ex.has(id)), []);
    assert.deepEqual(Object.keys(mod.EQ).filter((id) => !eq.has(id)), []);
    for (const [id, o] of Object.entries(mod.EQ)) {
      if (o.ex) assert.ok(ex.has(o.ex), `${id}: 운동 ${o.ex}가 없습니다`);
      if (o.st) assert.ok(st.has(o.st), `${id}: 동작 ${o.st}가 없습니다`);
    }
  });
});
