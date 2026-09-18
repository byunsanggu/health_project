import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { activeRecords, createStore, memoryAdapter, type StorageAdapter } from '../storage.ts';
import type { SessionLog } from '../types.ts';

let clock = 0;
function store(adapter: StorageAdapter = memoryAdapter(), deviceId = 'device-a') {
  let counter = 0;
  return createStore(adapter, {
    deviceId,
    now: () => new Date(Date.UTC(2026, 8, 14, 0, 0, clock++)).toISOString(),
    newId: () => `${deviceId}-${counter++}`,
  });
}

const session = (date: string): SessionLog => ({
  date,
  sets: [{ exerciseId: 'barbell-bench-press', weightKg: 80, reps: 8, rir: 2 }],
});

describe('오프라인 저장', () => {
  it('빈 저장소에서도 안전하게 시작한다', () => {
    const state = store().load();
    assert.deepEqual(state.sessions, []);
    assert.deepEqual(state.checkIns, []);
    assert.equal(state.version, 1);
  });

  it('기록에 신원과 수정 시각을 붙인다', () => {
    const saved = store().putSession(session('2026-09-14'));
    assert.ok(saved.id);
    assert.ok(saved.updatedAt);
    assert.equal(saved.deviceId, 'device-a');
  });

  it('저장한 기록이 다시 읽힌다', () => {
    const s = store();
    s.putSession(session('2026-09-14'));
    s.putSession(session('2026-09-16'));
    assert.equal(s.load().sessions.length, 2);
  });

  it('같은 id로 다시 쓰면 덮어쓴다', () => {
    const s = store();
    const saved = s.putSession(session('2026-09-14'));
    s.putSession({ ...saved, date: '2026-09-15' });

    const sessions = s.load().sessions;
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0]!.date, '2026-09-15');
  });

  it('삭제는 표시만 남긴다 — 실제로 지우면 다른 기기가 되살린다', () => {
    const s = store();
    const saved = s.putSession(session('2026-09-14'));
    s.removeSession(saved.id!);

    const sessions = s.load().sessions;
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0]!.deleted, true);
    assert.equal(activeRecords(sessions).length, 0, '화면에는 보이지 않는다');
  });

  it('보내지 못한 기록을 아웃박스에 쌓는다', () => {
    const s = store();
    const first = s.putSession(session('2026-09-14'));
    s.putSession(session('2026-09-16'));

    assert.equal(s.outbox().length, 2);
    s.markSynced([first.id!]);
    assert.equal(s.outbox().length, 1);
  });

  it('같은 기록을 여러 번 고쳐도 아웃박스에는 한 번만 남는다', () => {
    const s = store();
    const saved = s.putSession(session('2026-09-14'));
    s.putSession({ ...saved, date: '2026-09-15' });
    assert.equal(s.outbox().length, 1);
  });

  it('설정과 프로그램도 함께 저장한다', () => {
    const s = store();
    s.patch({ lifter: { bodyweightKg: 78 }, settings: { unit: 'kg' } });
    assert.deepEqual(s.load().lifter, { bodyweightKg: 78 });
    assert.deepEqual(s.load().settings, { unit: 'kg' });
  });

  it('저장소가 막혀 있어도 앱이 죽지 않는다', () => {
    const blocked: StorageAdapter = {
      getItem() { throw new Error('blocked'); },
      setItem() { throw new Error('blocked'); },
      removeItem() { throw new Error('blocked'); },
    };
    const s = store(blocked);
    assert.doesNotThrow(() => s.putSession(session('2026-09-14')));
    assert.deepEqual(s.load().sessions, [], '읽기도 조용히 빈 값으로 떨어진다');
  });

  it('깨진 데이터가 들어 있어도 빈 상태로 복구한다', () => {
    const adapter = memoryAdapter();
    adapter.setItem('volume-coach.state', '{not json');
    assert.deepEqual(store(adapter).load().sessions, []);
  });
});

describe('동기화 병합', () => {
  it('서버에만 있는 기록을 받아들인다', () => {
    const s = store();
    const merged = s.mergeRemote({
      sessions: [{ ...session('2026-09-10'), id: 'remote-1', updatedAt: '2026-09-10T00:00:00Z', deviceId: 'device-b' }],
    });
    assert.equal(merged.sessions.length, 1);
  });

  it('나중에 수정된 쪽이 이긴다', () => {
    const s = store();
    const mine = s.putSession(session('2026-09-14'));

    const newer = s.mergeRemote({
      sessions: [{ ...mine, date: '2026-09-20', updatedAt: '2030-01-01T00:00:00Z', deviceId: 'device-b' }],
    });
    assert.equal(newer.sessions[0]!.date, '2026-09-20');

    const older = s.mergeRemote({
      sessions: [{ ...mine, date: '2020-01-01', updatedAt: '2020-01-01T00:00:00Z', deviceId: 'device-b' }],
    });
    assert.equal(older.sessions[0]!.date, '2026-09-20', '오래된 사본은 무시한다');
  });

  it('수정 시각이 같으면 기기 id로 순서를 정한다 — 어느 기기에서 봐도 같은 결과', () => {
    const adapterA = memoryAdapter();
    const a = store(adapterA, 'device-a');
    const mine = a.putSession(session('2026-09-14'));
    const tie = { ...mine, date: '2026-09-99', deviceId: 'device-z' };

    assert.equal(a.mergeRemote({ sessions: [tie] }).sessions[0]!.date, '2026-09-99');

    const b = store(memoryAdapter(), 'device-b');
    b.mergeRemote({ sessions: [{ ...mine }] });
    assert.equal(b.mergeRemote({ sessions: [tie] }).sessions[0]!.date, '2026-09-99');
  });

  it('id가 없는 기록은 병합하지 않는다', () => {
    const s = store();
    assert.equal(s.mergeRemote({ sessions: [session('2026-09-10')] }).sessions.length, 0);
  });

  it('체크인도 같은 규칙으로 합친다', () => {
    const s = store();
    const mine = s.putCheckIn({ date: '2026-09-14', soreness: 3 });
    const merged = s.mergeRemote({
      checkIns: [{ ...mine, soreness: 8, updatedAt: '2030-01-01T00:00:00Z', deviceId: 'device-b' }],
    });
    assert.equal(merged.checkIns[0]!.soreness, 8);
  });
});
