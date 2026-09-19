import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { pendingMerges, registerGym, resolvePending, type GymDirectoryEntry } from '../gyms.ts';

const HERE = { lat: 37.5, lng: 127.03 };
const M10 = { lat: 37.50009, lng: 127.03 };

function seeded(): { dir: GymDirectoryEntry[]; first: string; second: string } {
  const a = registerGym({
    name: '상구헬스장', location: HERE, address: '3층',
    presetId: 'unknown', directory: [], today: '2026-03-01',
  }).entry!;

  // 같은 자리인데 이름이 달라 확인이 필요한 상황 — "나중에"를 고른다
  const b = registerGym({
    name: '바디짐', location: M10, address: '3층',
    presetId: 'unknown', directory: [a], today: '2026-09-19', defer: true,
  }).entry!;

  return { dir: [a, b], first: a.id, second: b.id };
}

describe('나중에 확인하기', () => {
  it('defer를 주면 막지 않고 등록한다', () => {
    const result = registerGym({
      name: '바디짐', location: M10, address: '3층',
      presetId: 'unknown', directory: [seeded().dir[0]!], today: '2026-09-19', defer: true,
    });
    assert.equal(result.outcome, 'created');
    assert.ok(result.entry);
  });

  it('후보를 버리지 않고 적어둔다 — 그냥 버리면 영영 못 합친다', () => {
    const { dir, first, second } = seeded();
    const entry = dir.find((item) => item.id === second)!;
    assert.deepEqual(entry.pendingMergeWith, [first]);
  });

  it('defer 없이는 여전히 막는다', () => {
    const { dir } = seeded();
    const blocked = registerGym({ name: '탑짐', location: M10, address: '3층', directory: dir });
    assert.equal(blocked.outcome, 'confirm');
    assert.equal(blocked.entry, undefined);
  });

  it('확인 대기 목록으로 꺼내 볼 수 있다', () => {
    const { dir, first, second } = seeded();
    const pending = pendingMerges(dir);
    assert.equal(pending.length, 1);
    assert.equal(pending[0]!.entry.id, second);
    assert.equal(pending[0]!.others[0]!.id, first);
  });

  it('"같은 곳"으로 합치면 고른 쪽이 남는다', () => {
    const { dir, first, second } = seeded();
    const after = resolvePending(dir, second, first);

    assert.equal(after.length, 1);
    assert.equal(after[0]!.id, first);
    // 목록에서 고른 쪽 이름으로 남아야 한다 — 방금 사용자가 지목한 것이다
    assert.equal(after[0]!.name, '상구헬스장');
    assert.equal(pendingMerges(after).length, 0);
  });

  it('"다른 곳"이면 둘 다 남고 다시 묻지 않는다', () => {
    const { dir, second } = seeded();
    const after = resolvePending(dir, second);

    assert.equal(after.length, 2);
    assert.equal(pendingMerges(after).length, 0, '같은 짝을 또 물으면 안 된다');
  });

  it('없어진 후보를 가리키는 대기는 목록에 올리지 않는다', () => {
    const { dir, second } = seeded();
    const orphan = dir
      .filter((entry) => entry.id === second)
      .map((entry) => ({ ...entry, pendingMergeWith: ['사라진-id'] }));
    assert.equal(pendingMerges(orphan).length, 0);
  });
});
