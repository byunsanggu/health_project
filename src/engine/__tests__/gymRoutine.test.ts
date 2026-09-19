import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  addGym,
  createGymBook,
  gymForWeekday,
  mostRecentGym,
  suggestGymByLocation,
  type GymBook,
  type GymDirectoryEntry,
} from '../gyms.ts';

/** 집·회사·출장지 세 곳을 다니는 사람 */
function threeGyms(): GymBook {
  let book = createGymBook({ id: 'home', name: '집앞 헬스장', equipmentIds: [], lastUsedAt: '2026-09-15' });
  book = addGym(book, { id: 'work', name: '회사 헬스장', equipmentIds: [], lastUsedAt: '2026-09-18' }, false);
  book = addGym(book, { id: 'trip', name: '출장지 호텔짐', equipmentIds: [], lastUsedAt: '2026-08-02' }, false);
  return book;
}

const WEEKDAY_ROUTINE = {
  byWeekday: { 0: 'home', 1: 'work', 2: 'work', 3: 'work', 4: 'work', 5: 'work', 6: 'home' },
};

describe('gymForWeekday', () => {
  it('평일은 회사, 주말은 집', () => {
    const book = threeGyms();
    assert.equal(gymForWeekday(book, 1, WEEKDAY_ROUTINE)!.id, 'work');
    assert.equal(gymForWeekday(book, 6, WEEKDAY_ROUTINE)!.id, 'home');
  });

  it('정해둔 게 없으면 지금 고른 곳을 쓴다', () => {
    const book = threeGyms();
    assert.equal(gymForWeekday(book, 3)!.id, book.activeId);
  });

  it('없어진 헬스장을 가리키면 그냥 지금 곳으로 떨어진다', () => {
    const book = threeGyms();
    const stale = { byWeekday: { 1: 'deleted-gym' } };
    assert.equal(gymForWeekday(book, 1, stale)!.id, book.activeId);
  });
});

describe('mostRecentGym', () => {
  it('마지막으로 운동한 곳', () => {
    assert.equal(mostRecentGym(threeGyms())!.id, 'work');
  });
});

describe('suggestGymByLocation', () => {
  const directory: GymDirectoryEntry[] = [
    { id: 'home', name: '집앞 헬스장', address: '', location: { lat: 37.6, lng: 127.1 }, equipmentIds: [], source: 'user' },
    { id: 'work', name: '회사 헬스장', address: '', location: { lat: 37.5, lng: 127.03 }, equipmentIds: [], source: 'user' },
  ];

  it('도착한 헬스장을 알아본다', () => {
    const book = threeGyms();
    const hit = suggestGymByLocation(book, { lat: 37.50009, lng: 127.03 }, directory);
    assert.equal(hit!.gym.id, 'work');
    assert.ok(hit!.distanceM < 30);
  });

  it('이미 그 헬스장이 선택돼 있으면 전환이 필요없다고 한다', () => {
    let book = threeGyms();
    book = { ...book, activeId: 'work' };
    const hit = suggestGymByLocation(book, { lat: 37.50009, lng: 127.03 }, directory);
    assert.equal(hit!.switchNeeded, false);
  });

  it('내가 다니는 곳이 아니면 제안하지 않는다', () => {
    const book = threeGyms();
    const far = suggestGymByLocation(book, { lat: 35.1, lng: 129.0 }, directory);
    assert.equal(far, undefined);
  });

  it('좌표를 모르는 헬스장은 건너뛴다', () => {
    const book = threeGyms();
    const noLoc: GymDirectoryEntry[] = [
      { id: 'work', name: '회사 헬스장', address: '', equipmentIds: [], source: 'user' },
    ];
    assert.equal(suggestGymByLocation(book, { lat: 37.5, lng: 127.03 }, noLoc), undefined);
  });
});
