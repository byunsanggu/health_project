import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { GYM_NAME_MAX, cleanGymName, createGymBook, addGym, renameGym } from '../gyms.ts';

const book = () => addGym(
  createGymBook({ id: 'a', name: '바우짐', equipmentIds: ['dumbbells'] }),
  { id: 'b', name: '회사 헬스장', equipmentIds: ['floor'] },
  false,
);

describe('헬스장 이름 바꾸기', () => {
  it('이름만 바뀌고 id와 기구는 그대로다 — 기록이 id에 묶여 있다', () => {
    const next = renameGym(book(), 'a', '바우짐 북수원점');
    const gym = next.gyms.find((one) => one.id === 'a')!;
    assert.equal(gym.name, '바우짐 북수원점');
    assert.deepEqual(gym.equipmentIds, ['dumbbells']);
    assert.equal(next.gyms.length, 2);
  });

  it('쓰고 있는 헬스장이 바뀌지 않는다', () => {
    assert.equal(renameGym(book(), 'b', '새 이름').activeId, 'a');
  });

  it('빈 이름이나 너무 긴 이름은 받지 않는다', () => {
    const before = book();
    assert.equal(renameGym(before, 'a', '   '), before);
    assert.equal(renameGym(before, 'a', '가'.repeat(GYM_NAME_MAX + 1)), before);
  });

  it('없는 헬스장이면 아무것도 안 한다', () => {
    const before = book();
    assert.equal(renameGym(before, 'zzz', '이름'), before);
  });

  it('공백을 정리한다', () => {
    assert.equal(cleanGymName('  바우짐   북수원점 '), '바우짐 북수원점');
  });
});
