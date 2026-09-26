import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  findDuplicates,
  gymKey,
  matchGym,
  nameSimilarity,
  normalizeGymName,
  parseFloor,
} from '../gymIdentity.ts';
import { mergeGymRecords, registerGym, type GymDirectoryEntry } from '../gyms.ts';

const HERE = { lat: 37.5, lng: 127.03 };
const M10 = { lat: 37.50009, lng: 127.03 };
const M300 = { lat: 37.5027, lng: 127.03 };
const SUWON = { lat: 37.28, lng: 127.01 };

describe('normalizeGymName', () => {
  it('띄어쓰기와 기호를 털어낸다', () => {
    assert.equal(normalizeGymName('상구 헬스장').normalized, '상구헬스장');
    assert.equal(normalizeGymName('상구-헬스장').normalized, '상구헬스장');
  });

  it('띄어쓰기가 없어도 브랜드와 지점을 가른다', () => {
    const parsed = normalizeGymName('상구헬스장수원점');
    assert.equal(parsed.brand, '상구');
    assert.equal(parsed.branch, '수원');
    assert.equal(parsed.facility, '헬스장');
    assert.equal(parsed.hasBranchMarker, true);
  });

  it('긴 접미사를 짧은 것보다 먼저 본다', () => {
    // '헬스클럽'을 '헬스'로 자르면 브랜드에 '클럽'이 남는다
    assert.equal(normalizeGymName('상구헬스클럽').facility, '헬스클럽');
    assert.equal(normalizeGymName('상구헬스클럽').brand, '상구');
  });

  it('법인 표기는 브랜드에 섞이지 않는다', () => {
    assert.equal(normalizeGymName('(주)상구헬스클럽 본점').brand, '상구');
  });

  it('지점 표시가 없으면 지점도 없다', () => {
    const parsed = normalizeGymName('상구헬스장');
    assert.equal(parsed.hasBranchMarker, false);
    assert.equal(parsed.branch, undefined);
  });
});

describe('parseFloor', () => {
  it('층을 읽는다', () => {
    assert.equal(parseFloor('예시로 1, 3층'), 3);
    assert.equal(parseFloor('5F'), 5);
    assert.equal(parseFloor('지하 1층'), -1);
    assert.equal(parseFloor('B2'), -2);
    assert.equal(parseFloor('예시로 1'), undefined);
    assert.equal(parseFloor(undefined), undefined);
  });
});

describe('nameSimilarity', () => {
  it('같으면 1, 아예 다르면 0에 가깝다', () => {
    assert.equal(nameSimilarity('상구헬스장', '상구헬스장'), 1);
    assert.ok(nameSimilarity('상구헬스장', '바디짐') < 0.2);
  });
});

describe('matchGym', () => {
  it('띄어쓰기만 다르면 같은 곳이다', () => {
    const match = matchGym({ name: '상구헬스장', location: HERE }, { name: '상구 헬스장', location: M10 });
    assert.equal(match.verdict, 'same');
  });

  it('간판이 바뀌어도 브랜드가 같고 자리가 같으면 같은 곳이다', () => {
    // 이름을 통째로 비교하면 0.2가 나와 놓친다. 브랜드로 봐야 한다.
    const match = matchGym({ name: '상구헬스장', location: HERE }, { name: '상구피트니스', location: M10 });
    assert.equal(match.verdict, 'same');
    assert.ok(match.nameScore > 0.9);
  });

  it('지점이 다르면 브랜드가 같아도 다른 곳이다', () => {
    const match = matchGym(
      { name: '상구헬스장수원점', location: HERE },
      { name: '상구헬스장이천점', location: SUWON },
    );
    assert.equal(match.verdict, 'different');
    assert.match(match.reason, /지점이 다릅니다/);
  });

  it('지점이 다르면 바로 옆에 있어도 다른 곳이다', () => {
    const match = matchGym(
      { name: '상구헬스장수원점', location: HERE },
      { name: '상구헬스장이천점', location: M10 },
    );
    assert.equal(match.verdict, 'different');
  });

  it('시설 접미사가 없는 프랜차이즈도 지점으로 가른다', () => {
    const match = matchGym(
      { name: '스포애니강남점', location: HERE },
      { name: '스포애니역삼점', location: M10 },
    );
    assert.equal(match.verdict, 'different');
  });

  it('층이 다르면 좌표가 같아도 다른 곳이다', () => {
    const match = matchGym(
      { name: '상구헬스장', address: '3층', location: HERE },
      { name: '상구헬스장', address: '5층', location: HERE },
    );
    assert.equal(match.verdict, 'different');
    assert.match(match.reason, /층이 다릅니다/);
  });

  it('한쪽만 층을 밝혔으면 합치지 않고 묻는다', () => {
    const match = matchGym(
      { name: '상구헬스장', address: '3층', location: HERE },
      { name: '상구헬스장', location: M10 },
    );
    assert.equal(match.verdict, 'candidate');
  });

  it('한쪽만 지점을 밝혔으면 합치지 않고 묻는다', () => {
    const match = matchGym(
      { name: '상구헬스장', location: HERE },
      { name: '상구헬스장수원점', location: M10 },
    );
    assert.equal(match.verdict, 'candidate');
    assert.match(match.reason, /지점/);
  });

  it('이름이 글자까지 같으면 멀어도 후보로 띄운다 — 실내 GPS는 튄다', () => {
    const match = matchGym(
      { name: '상구헬스장수원점', location: HERE },
      { name: '상구헬스장수원점', location: M300 },
    );
    assert.equal(match.verdict, 'candidate');
  });

  it('위치를 모르면 이름만으로 합치지 않는다', () => {
    const match = matchGym({ name: '상구헬스장수원점' }, { name: '상구헬스장수원점' });
    assert.equal(match.verdict, 'candidate');
  });

  it('같은 자리에 이름이 다르면 같은 건물의 다른 곳일 수 있다고 본다', () => {
    const match = matchGym({ name: '상구헬스장', location: HERE }, { name: '바디짐', location: M10 });
    assert.equal(match.verdict, 'candidate');
    assert.match(match.reason, /같은 건물/);
  });
});

describe('gymKey', () => {
  it('각자 등록해도 같은 곳이면 같은 id가 나온다', () => {
    assert.equal(
      gymKey({ name: '상구헬스장', location: HERE, address: '3층' }),
      gymKey({ name: '상구 헬스장', location: M10, address: '3층' }),
    );
  });

  it('층이 다르면 id도 다르다', () => {
    assert.notEqual(
      gymKey({ name: '상구헬스장', location: HERE, address: '3층' }),
      gymKey({ name: '상구헬스장', location: HERE, address: '5층' }),
    );
  });

  it('지점이 다르면 id도 다르다', () => {
    assert.notEqual(
      gymKey({ name: '상구헬스장수원점', location: SUWON }),
      gymKey({ name: '상구헬스장이천점', location: SUWON }),
    );
  });
});

describe('registerGym', () => {
  const existing: GymDirectoryEntry = {
    id: gymKey({ name: '상구헬스장', location: HERE, address: '예시로 1, 3층' }),
    name: '상구헬스장',
    address: '예시로 1, 3층',
    location: HERE,
    floor: 3,
    equipmentIds: ['floor', 'barbell-set'],
    source: 'user',
    verifiedAt: '2026-03-01',
  };

  it('같은 곳을 다시 등록하면 기존 것을 준다', () => {
    const result = registerGym({
      name: '상구 헬스장', location: M10, address: '3층', directory: [existing],
    });
    assert.equal(result.outcome, 'joined');
    assert.equal(result.entry!.id, existing.id);
  });

  it('애매하면 만들지 않고 사용자에게 묻는다', () => {
    const result = registerGym({ name: '상구헬스장', location: M10, directory: [existing] });
    assert.equal(result.outcome, 'confirm');
    assert.equal(result.entry, undefined, '확인 전에 항목을 만들면 안 된다');
    assert.ok(result.candidates.length > 0);
  });

  it('사용자가 아니라고 하면 그때 만든다', () => {
    const result = registerGym({
      name: '상구헬스장', location: M10, directory: [existing], force: true,
    });
    assert.equal(result.outcome, 'created');
    assert.ok(result.entry);
  });

  it('같은 건물 다른 층은 그냥 새로 만든다', () => {
    const result = registerGym({
      name: '탑짐', location: HERE, address: '5층', directory: [existing],
    });
    assert.equal(result.outcome, 'created');
  });

  it('겹치는 게 없으면 새로 만든다', () => {
    const result = registerGym({ name: '상구헬스장이천점', location: SUWON, directory: [existing] });
    assert.equal(result.outcome, 'created');
    assert.notEqual(result.entry!.id, existing.id);
  });
});

describe('mergeGymRecords', () => {
  const older: GymDirectoryEntry = {
    id: 'g1', name: '상구헬스장', address: '', source: 'user',
    equipmentIds: ['floor', 'barbell-set', 'leg-press-machine'],
    verifiedAt: '2026-03-01',
  };
  const newer: GymDirectoryEntry = {
    id: 'g1', name: '상구 헬스장', address: '예시로 1, 3층', source: 'user',
    equipmentIds: ['floor', 'barbell-set', 'smith-machine'],
    absentEquipmentIds: ['leg-press-machine'],
    verifiedAt: '2026-09-18',
  };

  it('최근에 없다고 확인된 기구는 빠진다', () => {
    const merged = mergeGymRecords(older, newer);
    assert.ok(!merged.equipmentIds.includes('leg-press-machine'), '합집합으로 합치면 안 된다');
    assert.ok(merged.absentEquipmentIds!.includes('leg-press-machine'));
  });

  it('양쪽에서 확인된 기구는 남는다', () => {
    const merged = mergeGymRecords(older, newer);
    assert.ok(merged.equipmentIds.includes('barbell-set'));
    assert.ok(merged.equipmentIds.includes('smith-machine'));
  });

  it('순서를 바꿔도 결과가 같다', () => {
    const a = mergeGymRecords(older, newer);
    const b = mergeGymRecords(newer, older);
    assert.deepEqual(a.equipmentIds, b.equipmentIds);
    assert.deepEqual(a.absentEquipmentIds, b.absentEquipmentIds);
  });

  it('더 최근에 손본 쪽의 주소를 믿는다', () => {
    const merged = mergeGymRecords(older, newer);
    assert.equal(merged.address, '예시로 1, 3층');
    assert.equal(merged.verifiedAt, '2026-09-18');
  });
});

describe('findDuplicates', () => {
  it('확실한 것부터, 그다음 이름이 비슷한 것부터 준다', () => {
    const directory: GymDirectoryEntry[] = [
      { id: 'a', name: '바디짐', address: '', location: M10, equipmentIds: [], source: 'user' },
      { id: 'b', name: '상구헬스장', address: '', location: M10, equipmentIds: [], source: 'user' },
    ];
    const hits = findDuplicates({ name: '상구헬스장', location: HERE }, directory);
    assert.equal(hits[0]!.entry.id, 'b');
  });
});

describe('주소와 층을 붙이면 안 된다', () => {
  it('주소 끝 번지와 층이 붙어 한 숫자로 읽힌다', () => {
    /*
     * 실제로 났던 일이다. 검색이 준 "정자일로 9"에 사용자가 적은 "3층"을
     * 한 줄로 붙였더니 "정자일로 9 3층"이 됐고, 거기서 층을 읽으니 93층이
     * 나왔다. 화면에 "93층"이 뜨는 건 웃기고 끝이지만, 층은 id에 들어가는
     * 값이라 같은 헬스장이 사람마다 다른 곳이 된다.
     */
    assert.equal(parseFloor('경기 성남시 분당구 정자일로 9 3층'), 93);
    assert.equal(parseFloor('3층'), 3);
  });

  it('층을 따로 넘기면 주소에 숫자가 있어도 안 틀린다', () => {
    const result = registerGym({
      name: '정자헬스클럽',
      address: '경기 성남시 분당구 정자일로 9',
      floor: parseFloor('3층'),
      location: HERE,
      directory: [],
      today: '2026-09-26',
    });
    assert.equal(result.outcome, 'created');
    assert.equal(result.entry?.floor, 3);
  });
});
