import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { EQUIPMENT_CATALOG } from '../equipment.ts';
import { availableExercises } from '../equipment.ts';
import { GYM_PRESETS, gymPreset, presetEquipment } from '../gymPresets.ts';
import { registerGym, searchGyms, toGymEntry, type GymDirectoryEntry } from '../gyms.ts';

const HERE = { lat: 37.5, lng: 127.03 };
const M10 = { lat: 37.50009, lng: 127.03 };

describe('GYM_PRESETS', () => {
  it('모든 프리셋의 기구가 카탈로그에 있다', () => {
    const known = new Set(EQUIPMENT_CATALOG.map((item) => item.id));
    for (const preset of GYM_PRESETS) {
      for (const id of preset.equipmentIds) {
        assert.ok(known.has(id), `${preset.label}: 카탈로그에 없는 기구 ${id}`);
      }
    }
  });

  it('어느 유형을 골라도 할 수 있는 운동이 있다', () => {
    for (const preset of GYM_PRESETS) {
      const count = availableExercises(presetEquipment(preset.id)).length;
      assert.ok(count > 0, `${preset.label}: 할 수 있는 종목이 없다`);
    }
  });

  it('대형일수록 할 수 있는 종목이 많다', () => {
    const franchise = availableExercises(presetEquipment('franchise')).length;
    const neighborhood = availableExercises(presetEquipment('neighborhood')).length;
    const home = availableExercises(presetEquipment('home')).length;
    assert.ok(franchise > neighborhood, `${franchise} > ${neighborhood}`);
    assert.ok(neighborhood > home, `${neighborhood} > ${home}`);
  });

  it('아파트·회사·홈짐은 검색에 올리지 않는다', () => {
    assert.equal(gymPreset('residence')!.visibility, 'private');
    assert.equal(gymPreset('home')!.visibility, 'private');
    assert.equal(gymPreset('franchise')!.visibility, 'public');
  });

  it('없는 유형은 빈 목록', () => {
    assert.deepEqual(presetEquipment('없는유형'), []);
  });
});

describe('아파트 헬스장 등록', () => {
  it('유형만 고르면 기구가 채워진다', () => {
    const result = registerGym({
      name: '예시아파트 커뮤니티 헬스장', location: HERE, address: '지하 1층',
      presetId: 'residence', directory: [], today: '2026-09-19',
    });
    assert.equal(result.outcome, 'created');
    assert.equal(result.entry!.visibility, 'private');
    assert.ok(result.entry!.equipmentIds.length > 5);
    assert.equal(result.entry!.floor, -1);
  });

  it('검색에 나오지 않는다', () => {
    const entry = registerGym({
      name: '예시아파트 커뮤니티 헬스장', location: HERE,
      presetId: 'residence', directory: [], today: '2026-09-19',
    }).entry!;
    assert.equal(searchGyms('예시아파트', { directory: [entry] }).length, 0);
    assert.equal(searchGyms('', { directory: [entry] }).length, 0);
  });

  it('상업 헬스장 후보로 내 아파트 헬스장이 뜨지 않는다', () => {
    const apartment = registerGym({
      name: '예시아파트 헬스장', location: HERE,
      presetId: 'residence', directory: [], today: '2026-09-19',
    }).entry!;

    const shop = registerGym({
      name: '예시아파트 헬스장', location: M10,
      presetId: 'neighborhood', directory: [apartment], today: '2026-09-19',
    });
    assert.equal(shop.outcome, 'created');
    assert.equal(shop.candidates.length, 0, '사생활 — 남의 아파트 헬스장을 보여주면 안 된다');
  });

  it('내가 같은 곳을 다시 등록하면 합쳐진다', () => {
    const first = registerGym({
      name: '예시아파트 커뮤니티 헬스장', location: HERE, address: '지하 1층',
      presetId: 'residence', directory: [], today: '2026-09-19',
    }).entry!;

    const again = registerGym({
      name: '예시아파트 커뮤니티헬스장', location: M10, address: '지하 1층',
      presetId: 'residence', directory: [first], today: '2026-09-19',
    });
    assert.equal(again.outcome, 'joined');
    assert.equal(again.entry!.id, first.id);
  });

  it('같은 건물 다른 층은 목록에서 구분된다', () => {
    const b1: GymDirectoryEntry = {
      id: 'a', name: '예시아파트 헬스장', address: '', floor: -1,
      equipmentIds: [], source: 'user', visibility: 'private',
    };
    const f3: GymDirectoryEntry = { ...b1, id: 'b', floor: 3 };
    assert.equal(toGymEntry(b1).note, '지하 1층');
    assert.equal(toGymEntry(f3).note, '3층');
  });
});
