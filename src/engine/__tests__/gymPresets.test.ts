import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { EQUIPMENT_CATALOG } from '../equipment.ts';
import { availableExercises } from '../equipment.ts';
import { GYM_PRESETS, gymPreset, presetEquipment } from '../gymPresets.ts';
import { accessLabel, registerGym, searchGyms, toGymEntry, type GymDirectoryEntry } from '../gyms.ts';

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

  it('선은 "상업이냐"가 아니라 "남의 집이냐"다', () => {
    /*
     * 아파트·회사 헬스장은 나눈다. 밖에서는 뭐가 있는지 알 길이 없어서,
     * 같은 단지 주민이 채워 준 목록이 제일 값어치가 크다. 대신 아무나 갈
     * 수 있는 곳이 아니므로 그렇게 표시하고 뒤로 민다.
     *
     * 홈짐만 안 나눈다. 그건 남의 집 주소다.
     */
    assert.equal(gymPreset('residence')!.visibility, 'restricted');
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
    assert.equal(result.entry!.visibility, 'restricted');
    assert.ok(result.entry!.equipmentIds.length > 5);
    assert.equal(result.entry!.floor, -1);
  });

  it('검색에 나오되 갈 수 있는 곳이 먼저다', () => {
    /*
     * 아파트 헬스장에 뭐가 있는지는 밖에서 알 길이 없다. 그래서 같은 단지
     * 주민이 채워 준 목록이 제일 값어치가 크고, 그러려면 서로 찾을 수
     * 있어야 한다.
     *
     * 다만 아무나 갈 수 있는 곳이 아니다. "예시"를 친 사람에게 못 들어가는
     * 단지 헬스장이 먼저 뜨면 그건 검색이 아니다.
     */
    const apartment = registerGym({
      name: '예시아파트 커뮤니티 헬스장', location: HERE,
      presetId: 'residence', directory: [], today: '2026-09-19',
    }).entry!;
    const shop = registerGym({
      name: '예시 헬스클럽', location: M10,
      presetId: 'neighborhood', directory: [], today: '2026-09-19',
    }).entry!;

    const found = searchGyms('예시', { directory: [apartment, shop] });
    assert.equal(found.length, 2);
    assert.equal(found[0]?.entry.id, shop.id, '갈 수 있는 곳이 먼저');
    assert.equal(found[1]?.entry.id, apartment.id);
  });

  it('갈 수 없는 곳에는 그렇다고 딱지를 붙인다', () => {
    // 가 봐야 못 들어가는 곳을 아무 표시 없이 목록에 두면 그건 속이는 것이다.
    const apartment = registerGym({
      name: '예시아파트 커뮤니티 헬스장', location: HERE,
      presetId: 'residence', directory: [], today: '2026-09-19',
    }).entry!;
    const shop = registerGym({
      name: '예시 헬스클럽', location: M10,
      presetId: 'neighborhood', directory: [], today: '2026-09-19',
    }).entry!;

    assert.match(accessLabel(apartment) ?? '', /전용/);
    assert.equal(accessLabel(shop), undefined);
  });

  it('홈짐은 검색에 안 나온다', () => {
    /*
     * 여기가 진짜 선이다. 아파트 헬스장은 단지 시설이지만 홈짐은 **남의 집
     * 주소**다. 옆 동 사람의 홈짐이 검색에 뜨는 건 사생활 문제다.
     */
    const home = registerGym({
      name: '우리집', location: HERE,
      presetId: 'home', directory: [], today: '2026-09-19',
    }).entry!;
    assert.equal(home.visibility, 'private');
    assert.equal(searchGyms('우리집', { directory: [home] }).length, 0);
    assert.equal(searchGyms('', { directory: [home] }).length, 0);
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
      equipmentIds: [], source: 'user', visibility: 'restricted',
    };
    const f3: GymDirectoryEntry = { ...b1, id: 'b', floor: 3 };
    assert.equal(toGymEntry(b1).note, '지하 1층');
    assert.equal(toGymEntry(f3).note, '3층');
  });
});
