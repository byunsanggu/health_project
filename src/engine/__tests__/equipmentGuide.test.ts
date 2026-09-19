import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { EQUIPMENT_CATALOG, equipmentGuide, findEquipment } from '../equipment.ts';
import { availableExercises } from '../equipment.ts';
import { gymPreset, presetEquipment } from '../gymPresets.ts';

describe('EQUIPMENT_GUIDE', () => {
  it('모든 기구에 별명과 생김새가 있다', () => {
    for (const item of EQUIPMENT_CATALOG) {
      const guide = equipmentGuide(item.id);
      assert.ok(guide, `${item.name}: 설명이 없다`);
      assert.ok(guide!.aka.length > 0, `${item.name}: 별명이 없다`);
      assert.ok(guide!.look.length > 10, `${item.name}: 생김새 설명이 너무 짧다`);
    }
  });
});

describe('findEquipment', () => {
  it('정식 이름을 몰라도 찾아진다', () => {
    const cases: [string, string][] = [
      ['굽은 봉', 'ez-bar'],
      ['나비', 'pec-deck-machine'],
      ['철봉', 'pull-up-bar'],
      ['철장', 'power-rack'],
      ['아령', 'dumbbells'],
      ['레일', 'smith-machine'],
      ['원판', 'barbell-set'],
      ['다리 접는', 'leg-curl-machine'],
    ];
    for (const [query, expected] of cases) {
      const hits = findEquipment(query);
      assert.ok(
        hits.some((item) => item.id === expected),
        `"${query}" → ${hits.map((h) => h.name).join(', ') || '없음'} (${expected} 기대)`,
      );
    }
  });

  it('정식 이름으로도 당연히 찾아진다', () => {
    assert.ok(findEquipment('레그프레스').some((item) => item.id === 'leg-press-machine'));
  });

  it('빈 검색은 전부 돌려준다', () => {
    assert.equal(findEquipment('').length, EQUIPMENT_CATALOG.length);
    assert.equal(findEquipment('   ').length, EQUIPMENT_CATALOG.length);
  });

  it('없는 말은 빈 목록', () => {
    assert.deepEqual(findEquipment('수영장'), []);
  });
});

describe('잘 모르겠어요 프리셋', () => {
  it('기구를 몰라도 시작할 수 있다', () => {
    const preset = gymPreset('unknown');
    assert.ok(preset);
    const ids = presetEquipment('unknown');
    assert.ok(ids.length > 5 && ids.length < 15, `기구 ${ids.length}개 — 너무 많거나 적다`);
  });

  it('그것만으로도 프로그램을 짤 만큼 종목이 나온다', () => {
    const count = availableExercises(presetEquipment('unknown')).length;
    assert.ok(count >= 40, `가능 종목이 ${count}개뿐이다`);
  });

  it('흔치 않은 기구는 켜지 않는다 — 없는 걸 있다고 하면 안 된다', () => {
    const ids = presetEquipment('unknown');
    for (const rare of ['hack-squat-machine', 'hip-thrust-machine', 'landmine', 't-bar-row-machine']) {
      assert.ok(!ids.includes(rare), `${rare}가 기본으로 켜져 있다`);
    }
  });
});
