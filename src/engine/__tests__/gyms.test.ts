import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  SAMPLE_DIRECTORY,
  activeGym,
  activeProfile,
  addGym,
  blankGym,
  compareGyms,
  createGymBook,
  describeGym,
  removeGym,
  searchGyms,
  switchGym,
  toGymEntry,
  type GymEntry,
} from '../gyms.ts';
import { COMMON_EQUIPMENT_IDS } from '../equipment.ts';
import { buildProgram, type OnboardingAnswers } from '../onboarding.ts';
import { loadingFor } from '../gym.ts';
import { exerciseById } from '../exercises.ts';
import type { Exercise } from '../types.ts';

const home: GymEntry = { id: 'home', name: '집 근처', equipmentIds: [...COMMON_EQUIPMENT_IDS] };
const hotel: GymEntry = { id: 'hotel', name: '출장 호텔', equipmentIds: ['floor', 'dumbbells', 'bench-flat'] };

const answers: OnboardingAnswers = {
  selfReportedLevel: 'intermediate',
  monthsTraining: 18,
  bodyweightKg: 78,
  daysPerWeek: 4,
  goals: ['hypertrophy'],
  gym: { equipmentIds: COMMON_EQUIPMENT_IDS },
};

describe('여러 헬스장 관리', () => {
  it('한 곳으로 시작해 다른 곳을 더한다', () => {
    let book = createGymBook(home);
    assert.equal(book.gyms.length, 1);
    assert.equal(activeGym(book)?.id, 'home');

    book = addGym(book, hotel);
    assert.equal(book.gyms.length, 2);
    assert.equal(book.activeId, 'hotel', '새로 더한 곳이 선택된다');
  });

  it('같은 id를 다시 더하면 덮어쓴다', () => {
    let book = createGymBook(home);
    book = addGym(book, { ...home, name: '집 근처 (이전)' });
    assert.equal(book.gyms.length, 1);
    assert.equal(book.gyms[0]!.name, '집 근처 (이전)');
  });

  it('선택한 곳을 바꾸고 마지막 사용일을 남긴다', () => {
    let book = addGym(createGymBook(home), hotel, false);
    assert.equal(book.activeId, 'home');

    book = switchGym(book, 'hotel', '2026-09-20');
    assert.equal(book.activeId, 'hotel');
    assert.equal(activeGym(book)?.lastUsedAt, '2026-09-20');
  });

  it('없는 헬스장으로는 바꾸지 않는다', () => {
    const book = switchGym(createGymBook(home), 'nowhere');
    assert.equal(book.activeId, 'home');
  });

  it('마지막 한 곳은 지우지 않는다', () => {
    let book = addGym(createGymBook(home), hotel);
    book = removeGym(book, 'hotel');
    assert.equal(book.gyms.length, 1);

    book = removeGym(book, 'home');
    assert.equal(book.gyms.length, 1, '전부 지워지면 쓸 수 있는 설정이 없어진다');
  });

  it('지운 곳이 선택 중이었으면 남은 곳으로 옮긴다', () => {
    let book = addGym(createGymBook(home), hotel);
    book = removeGym(book, 'hotel');
    assert.equal(book.activeId, 'home');
  });

  it('선택된 헬스장을 엔진 프로필로 바꾼다', () => {
    const profile = activeProfile(addGym(createGymBook(home), hotel))!;
    assert.equal(loadingFor(exerciseById('barbell-bench-press') as Exercise, profile), null,
      '호텔에는 바벨이 없다');
  });
});

describe('헬스장 찾기', () => {
  it('이름과 주소로 찾는다', () => {
    assert.ok(searchGyms('호텔').length >= 1);
    assert.equal(searchGyms('없는이름').length, 0);
    assert.equal(searchGyms('').length, SAMPLE_DIRECTORY.length, '빈 검색어는 전부 보여준다');
  });

  it('위치를 주면 가까운 순으로 정렬한다', () => {
    const results = searchGyms('', { near: { lat: 37.5, lng: 127.03 } });
    for (let i = 1; i < results.length; i += 1) {
      assert.ok(results[i - 1]!.distanceKm! <= results[i]!.distanceKm!);
    }
    assert.equal(results[0]!.distanceKm, 0);
  });

  it('내 프로그램을 얼마나 할 수 있는지 계산한다', () => {
    const program = buildProgram(answers, 'intermediate');
    const results = searchGyms('', { program });

    const big = results.find((r) => r.entry.id === 'sample-full')!;
    const small = results.find((r) => r.entry.id === 'sample-hotel')!;

    assert.equal(big.programFit, 1, '대형 헬스장에서는 전부 가능하다');
    assert.ok(small.programFit! < 0.6);
    assert.ok(small.missing.length > 0, '못 하는 종목을 알려준다');
  });

  it('종목이 부족한 부위를 짚어준다', () => {
    const hotelResult = describeGym(SAMPLE_DIRECTORY[2]!);
    assert.ok(hotelResult.weakMuscles.length > 0);
  });

  it('찾은 곳을 내 목록에 담을 형태로 바꾼다', () => {
    const entry = toGymEntry(SAMPLE_DIRECTORY[1]!, '회사 근처');
    assert.equal(entry.note, '회사 근처');
    assert.deepEqual(entry.equipmentIds, SAMPLE_DIRECTORY[1]!.equipmentIds);
  });

  it('기구 목록을 모르는 곳은 기본 구성으로 시작한다', () => {
    const entry = blankGym('처음 가는 곳');
    assert.ok(entry.id.length > 0);
    assert.deepEqual(entry.equipmentIds, [...COMMON_EQUIPMENT_IDS]);
  });
});

describe('헬스장 전환 비교', () => {
  it('무엇을 못 하게 되고 무엇이 새로 되는지 알려준다', () => {
    const big = SAMPLE_DIRECTORY[0]!;
    const small = SAMPLE_DIRECTORY[2]!;

    const down = compareGyms(big, small);
    assert.ok(down.lost.length > 10);
    assert.equal(down.gained.length, 0);
    assert.ok(down.removedEquipment.includes('올림픽 바벨 + 플레이트'));

    const up = compareGyms(small, big);
    assert.ok(up.gained.length > 10);
    assert.equal(up.lost.length, 0);
  });

  it('같은 구성끼리는 차이가 없다', () => {
    const diff = compareGyms(SAMPLE_DIRECTORY[0]!, SAMPLE_DIRECTORY[0]!);
    assert.equal(diff.lost.length, 0);
    assert.equal(diff.gained.length, 0);
  });
});
