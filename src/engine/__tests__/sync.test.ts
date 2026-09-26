import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { BATCH_SIZE, fromRemote, syncAgeLine, syncOnce, toRemote } from '../sync.ts';
import { createStore, memoryAdapter } from '../storage.ts';
import type { PullResult, RemoteRecord, SyncTransport } from '../sync.ts';
import type { SessionLog } from '../types.ts';

const session = (id: string, date: string, updatedAt: string): SessionLog =>
  ({
    id,
    date,
    updatedAt,
    sets: [{ exerciseId: 'barbell-bench-press', weightKg: 100, reps: 8, rir: 2, warmup: false }],
  }) as SessionLog;

/** 네트워크 없이 서버를 흉내 낸다. 무엇이 오갔는지 다 들고 있는다. */
function fakeServer(seed: RemoteRecord[] = []) {
  const rows = new Map<string, RemoteRecord>(seed.map((row) => [row.kind + ':' + row.id, row]));
  const pushes: RemoteRecord[][] = [];
  let failPush: string | null = null;
  let failPull: string | null = null;

  const transport: SyncTransport = {
    async push(records) {
      if (failPush) throw new Error(failPush);
      pushes.push([...records]);
      for (const record of records) {
        const key = record.kind + ':' + record.id;
        const existing = rows.get(key);
        // 서버 규칙: 더 새 것일 때만 받는다.
        if (!existing || record.updatedAt > existing.updatedAt) rows.set(key, record);
      }
    },
    async pull(cursor): Promise<PullResult> {
      if (failPull) throw new Error(failPull);
      const all = [...rows.values()];
      const fresh = cursor ? all.filter((row) => row.updatedAt > cursor) : all;
      return { records: fresh, cursor: fresh.length > 0 ? 'server-cursor-1' : cursor };
    },
  };

  return {
    transport,
    pushes,
    rows,
    breakPush: (message: string) => { failPush = message; },
    breakPull: (message: string) => { failPull = message; },
    heal: () => { failPush = null; failPull = null; },
  };
}

const newStore = () => createStore(memoryAdapter(), { namespace: 'test', deviceId: 'device-a' });

describe('전송 모양으로 바꾸기', () => {
  it('id나 수정 시각이 없으면 보내지 않는다', () => {
    // 없는 id로 올리면 서버에 쓰레기 행이 생긴다.
    assert.equal(toRemote('session', {} as SessionLog), null);
    assert.equal(toRemote('session', { id: 'a' } as SessionLog), null);
  });

  it('받은 것의 껍데기를 믿는다', () => {
    /*
     * 껍데기(updatedAt·deleted)와 알맹이가 어긋날 수 있다. 서버가 보고
     * 고른 것은 껍데기이므로 껍데기를 믿는다.
     */
    const restored = fromRemote({
      kind: 'session',
      id: 's1',
      updatedAt: '2026-09-26T10:00:00.000Z',
      deleted: true,
      body: { id: 's1', updatedAt: '2026-09-01T00:00:00.000Z', deleted: false, date: '2026-09-26', sets: [] },
    });
    assert.equal(restored?.updatedAt, '2026-09-26T10:00:00.000Z');
    assert.equal(restored?.deleted, true);
  });

  it('모양이 깨진 것은 버린다', () => {
    // 앱을 멈추는 것보다 한 덩어리를 버리는 편이 낫다.
    assert.equal(fromRemote({ kind: 'session', id: 'x', updatedAt: 'n', deleted: false, body: null }), null);
    assert.equal(fromRemote({ kind: 'session', id: 'x', updatedAt: 'n', deleted: false, body: { id: 1 } }), null);
  });
});

describe('한 번 맞추기', () => {
  it('아웃박스를 올리고 아웃박스를 비운다', async () => {
    const store = newStore();
    store.putSession(session('', '2026-09-26', ''));
    assert.equal(store.outbox().length, 1);

    const server = fakeServer();
    const result = await syncOnce(store, server.transport);

    assert.equal(result.pushed, 1);
    assert.equal(store.outbox().length, 0);
    assert.equal(server.rows.size, 1);
  });

  it('서버에만 있던 기록을 받아 합친다', async () => {
    const store = newStore();
    const server = fakeServer([
      {
        kind: 'session',
        id: 'from-phone-b',
        updatedAt: '2026-09-25T10:00:00.000Z',
        deleted: false,
        body: session('from-phone-b', '2026-09-25', '2026-09-25T10:00:00.000Z'),
      },
    ]);

    const result = await syncOnce(store, server.transport);
    assert.equal(result.pulled, 1);
    assert.equal(store.load().sessions.length, 1);
  });

  it('올린 다음에 받는다', async () => {
    /*
     * 받고 올리면, 받은 것을 합치는 사이에 생긴 로컬 수정이 이번
     * 회차에서 빠진다.
     */
    const store = newStore();
    store.putSession(session('', '2026-09-26', ''));
    const order: string[] = [];
    const transport: SyncTransport = {
      async push() { order.push('push'); },
      async pull() { order.push('pull'); return { records: [], cursor: null }; },
    };
    await syncOnce(store, transport);
    assert.deepEqual(order, ['push', 'pull']);
  });

  it('올릴 것이 없으면 올리지 않는다', async () => {
    const store = newStore();
    const server = fakeServer();
    const result = await syncOnce(store, server.transport);
    assert.equal(server.pushes.length, 0);
    assert.equal(result.message, '이미 맞춰져 있습니다.');
  });

  it('끊어서 올린다', async () => {
    /*
     * 한 달 치가 밀려 있으면 수백 개가 된다. 한 번에 다 보내면 지하철에서
     * 끊기는 순간 전부 실패하고 처음부터 다시 한다.
     */
    const store = newStore();
    for (let i = 0; i < 7; i += 1) store.putSession(session('', '2026-09-2' + (i % 10), ''));

    const server = fakeServer();
    await syncOnce(store, server.transport, { batchSize: 3 });
    assert.deepEqual(server.pushes.map((chunk) => chunk.length), [3, 3, 1]);
  });

  it('기본 묶음 크기가 정해져 있다', () => {
    assert.equal(BATCH_SIZE, 50);
  });
});

describe('끊겼을 때', () => {
  it('올리다 끊겨도 보낸 만큼은 남는다', async () => {
    const store = newStore();
    for (let i = 0; i < 5; i += 1) store.putSession(session('', '2026-09-2' + i, ''));

    const server = fakeServer();
    let calls = 0;
    const flaky: SyncTransport = {
      async push(records) {
        calls += 1;
        if (calls > 1) throw new Error('offline');
        await server.transport.push(records);
      },
      pull: server.transport.pull,
    };

    const result = await syncOnce(store, flaky, { batchSize: 2 });
    assert.equal(result.pushed, 2);
    assert.match(result.message, /나머지는 다음에/);
    // 보낸 둘은 아웃박스에서 빠지고 셋만 남는다.
    assert.equal(store.outbox().length, 3);
  });

  it('하나도 못 올렸으면 기록이 남아 있다고 말한다', async () => {
    const store = newStore();
    store.putSession(session('', '2026-09-26', ''));
    const server = fakeServer();
    server.breakPush('offline');

    const result = await syncOnce(store, server.transport);
    assert.equal(result.pushed, 0);
    assert.equal(store.outbox().length, 1);
    assert.match(result.message, /이 기기에 남아/);
  });

  it('받다 끊겨도 표시를 앞으로 옮기지 않는다', async () => {
    // 옮겨 버리면 못 받은 것들을 영영 못 받는다.
    const store = newStore();
    const server = fakeServer();
    server.breakPull('offline');

    const result = await syncOnce(store, server.transport, { cursor: 'c-0' });
    assert.equal(result.cursor, 'c-0');
    assert.ok(result.error);
  });

  it('빈 응답에는 표시를 그대로 둔다', async () => {
    const store = newStore();
    const transport: SyncTransport = {
      async push() {},
      async pull() { return { records: [], cursor: null }; },
    };
    const result = await syncOnce(store, transport, { cursor: 'c-9' });
    assert.equal(result.cursor, 'c-9');
  });
});

describe('아웃박스 정리', () => {
  it('로컬에 없는 항목은 재시도하지 않고 버린다', async () => {
    /*
     * 기록은 지웠는데 아웃박스만 남은 경우다. 영원히 재시도하면
     * 아웃박스가 안 비고, 그러면 "대기 중 1개"가 영영 사라지지 않는다.
     */
    const store = newStore();
    const saved = store.putSession(session('', '2026-09-26', ''));
    const adapter = { ...store };
    void adapter;

    // 로컬 기록만 지우고 아웃박스는 남긴다
    store.patch({ sessions: [] });
    assert.ok(store.outbox().some((entry) => entry.id === saved.id));

    const server = fakeServer();
    const result = await syncOnce(store, server.transport);
    assert.equal(result.pushed, 0);
    assert.equal(store.outbox().length, 0);
  });
});

describe('두 기기', () => {
  it('나중에 고친 쪽이 이긴다', async () => {
    const phoneA = createStore(memoryAdapter(), { namespace: 'a', deviceId: 'A' });
    const phoneB = createStore(memoryAdapter(), { namespace: 'b', deviceId: 'B' });
    const server = fakeServer();

    const old = session('s1', '2026-09-26', '2026-09-26T09:00:00.000Z');
    const fresh = session('s1', '2026-09-26', '2026-09-26T11:00:00.000Z');
    fresh.sets[0]!.weightKg = 105;

    phoneA.patch({ sessions: [old] });
    phoneB.patch({ sessions: [fresh] });

    await server.transport.push([toRemote('session', old)!]);
    await server.transport.push([toRemote('session', fresh)!]);

    await syncOnce(phoneA, server.transport);
    assert.equal(phoneA.load().sessions[0]?.sets[0]?.weightKg, 105);
  });

  it('오래된 기록이 새 기록을 덮지 않는다', async () => {
    // 비행기 모드였던 폰이 사흘 뒤에 연결됐다고 그 사흘치가 사라지면 안 된다.
    const server = fakeServer();
    const fresh = session('s1', '2026-09-26', '2026-09-26T11:00:00.000Z');
    const stale = session('s1', '2026-09-26', '2026-09-23T08:00:00.000Z');
    stale.sets[0]!.weightKg = 60;

    await server.transport.push([toRemote('session', fresh)!]);
    await server.transport.push([toRemote('session', stale)!]);

    const row = server.rows.get('session:s1');
    assert.equal((row?.body as SessionLog).sets[0]?.weightKg, 100);
  });
});

describe('마지막으로 맞춘 때', () => {
  const now = Date.parse('2026-09-26T12:00:00.000Z');

  it('시각이 아니라 지금 안전한지를 말한다', () => {
    assert.equal(syncAgeLine('2026-09-26T11:58:00.000Z', now, 0), '2분 전에 맞췄습니다');
    assert.equal(syncAgeLine('2026-09-26T09:00:00.000Z', now, 0), '3시간 전에 맞췄습니다');
    assert.equal(syncAgeLine('2026-09-24T12:00:00.000Z', now, 0), '2일 전에 맞췄습니다');
  });

  it('대기 중인 개수를 함께 말한다', () => {
    assert.match(syncAgeLine('2026-09-26T11:58:00.000Z', now, 3), /3개 대기/);
  });

  it('한 번도 안 올렸으면 그렇게 말한다', () => {
    assert.match(syncAgeLine(null, now, 0), /아직 서버에 올리지 않았습니다/);
    assert.match(syncAgeLine(null, now, 2), /2개 대기/);
  });

  it('기기 시계가 앞서 있어도 깨지지 않는다', () => {
    // 폰 시계가 서버보다 빠르면 음수가 나온다. 거기서 "-5분 전"이라고 쓰면 안 된다.
    assert.equal(syncAgeLine('2026-09-26T12:05:00.000Z', now, 0), '방금 맞췄습니다');
  });
});
