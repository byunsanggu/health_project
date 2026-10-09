import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { EQUIPMENT_CATALOG, parseEquipmentList } from '../equipment.ts';
import { KNOWN_GYMS, knownGymFor } from '../knownGyms.ts';

const BAUZIM = { name: '바우짐 북수원점', address: '경기도 수원시 장안구 경수대로 910 101호' };

describe('확인된 헬스장', () => {
  it('바우짐 북수원점을 알아본다', () => {
    assert.equal(knownGymFor(BAUZIM)?.name, '바우짐 북수원점');
  });

  it('이름이 같아도 주소가 다르면 아니다', () => {
    assert.equal(knownGymFor({ name: '바우짐 북수원점', address: '경기도 수원시 장안구 송원로 81' }), null);
  });

  it('주소가 같아도 다른 헬스장이면 아니다 — 여성전용 바우짐', () => {
    assert.equal(knownGymFor({ name: '여성전용 바우짐', address: BAUZIM.address }), null);
  });

  it('지점이 다르면 아니다', () => {
    assert.equal(knownGymFor({ name: '바우짐 영통점', address: BAUZIM.address }), null);
  });

  it('주소의 띄어쓰기가 달라도 알아본다', () => {
    assert.ok(knownGymFor({ name: '바우짐 북수원점', address: '경기 수원시 장안구 경수대로910' }));
  });

  it('목록의 기구는 전부 카탈로그에 있다', () => {
    const ids = new Set(EQUIPMENT_CATALOG.map((item) => item.id));
    for (const gym of KNOWN_GYMS) {
      for (const id of gym.equipmentIds) assert.ok(ids.has(id), `${gym.name}: ${id}`);
    }
  });

  it('트레이너가 보낸 목록을 그대로 읽은 것과 같다', () => {
    const sent =
      '덤벨  ,바벨, 이지바, 스쿼트랙, 인클라인 벤치 프리처 컬 벤치 , 파워랙, 크로스오버 케이븍, 로우 케이블 ,' +
      '스미스 머신, 플레이트 로드 T바 머신, 플레이트 로드 벤트 오버 레터럴 레이즈 머신, 플레이트 로드 하이 로우 머신 ,' +
      '레그 프레스, 플레이트 로드 핵 스쿼트 머신, 브이 스쿼트 머신, 어시스트 머신 ,시티드 로우 머신, 플라이 머신, ' +
      '체스트프레스 머신, 인크라인 체스트 프레스 머신, 숄더프레스 머신, 라잉 레크컬 머신, 레그 익스텐션 머신, ' +
      '카프레이즈 머신, 트라이셉 딥스 머신 ,프리쳐 컬 머신, 시트드 레그 컬 머신, 폼롤러';
    const parsed = parseEquipmentList(sent).ids;
    const gym = knownGymFor(BAUZIM)!;
    assert.deepEqual([...gym.equipmentIds].sort(), [...parsed].sort());
  });
});
