import type { CheckIn, SessionLog, Syncable } from './types.ts';

/**
 * 오프라인 우선 저장소.
 *
 * 헬스장 지하에서 신호가 끊겨도 기록은 남아야 하고, 신호가 돌아오면 저절로
 * 올라가야 한다. 그래서 서버를 기다리지 않는다 — 로컬에 먼저 쓰고, 보낼
 * 것들을 아웃박스에 쌓아 두었다가 연결되면 흘려보낸다.
 *
 * 충돌은 마지막 수정 시각으로 해결한다(LWW). 시각이 같으면 기기 id로 순서를
 * 정해 어느 기기에서 보든 같은 결과가 나오게 한다.
 */
export interface StorageAdapter {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** 저장소가 없거나 막힌 환경(시크릿 창 등)에서도 앱이 돌아가게 하는 대체재. */
export function memoryAdapter(): StorageAdapter {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => { map.set(key, value); },
    removeItem: (key) => { map.delete(key); },
  };
}

export const SCHEMA_VERSION = 1;

export interface PersistedState {
  version: number;
  sessions: SessionLog[];
  checkIns: CheckIn[];
  /** 온보딩에서 고른 기구와 실측값 */
  gymSelection?: unknown;
  lifter?: unknown;
  program?: unknown;
  settings?: Record<string, unknown>;
}

export interface OutboxEntry {
  kind: 'session' | 'checkIn';
  id: string;
  updatedAt: string;
}

export interface StoreOptions {
  /** 저장 키 접두사 */
  namespace?: string;
  /** 이 기기의 식별자 */
  deviceId?: string;
  /** 테스트에서 시간을 고정하기 위한 훅 */
  now?: () => string;
  /** 식별자 생성기 */
  newId?: () => string;
}

export interface Store {
  readonly deviceId: string;
  load(): PersistedState;
  save(state: PersistedState): void;
  putSession(session: SessionLog): SessionLog;
  removeSession(id: string): void;
  putCheckIn(checkIn: CheckIn): CheckIn;
  patch(partial: Partial<Omit<PersistedState, 'version'>>): PersistedState;
  /** 아직 서버로 보내지 못한 기록 */
  outbox(): OutboxEntry[];
  markSynced(ids: readonly string[]): void;
  /** 서버에서 받은 기록을 로컬과 합친다 */
  mergeRemote(remote: { sessions?: SessionLog[]; checkIns?: CheckIn[] }): PersistedState;
  reset(): void;
}

const emptyState = (): PersistedState => ({
  version: SCHEMA_VERSION,
  sessions: [],
  checkIns: [],
});

export function createStore(adapter: StorageAdapter, options: StoreOptions = {}): Store {
  const namespace = options.namespace ?? 'volume-coach';
  const stateKey = `${namespace}.state`;
  const outboxKey = `${namespace}.outbox`;
  const deviceKey = `${namespace}.device`;
  const now = options.now ?? (() => new Date().toISOString());
  const newId = options.newId ?? defaultNewId;

  const deviceId = readRaw(deviceKey) ?? (() => {
    const id = options.deviceId ?? newId();
    writeRaw(deviceKey, id);
    return id;
  })();

  function readRaw(key: string): string | null {
    try {
      return adapter.getItem(key);
    } catch {
      // 시크릿 창이나 차단된 저장소에서는 읽기 자체가 던진다.
      return null;
    }
  }

  function writeRaw(key: string, value: string): void {
    try {
      adapter.setItem(key, value);
    } catch {
      // 저장에 실패해도 앱은 계속 돌아야 한다. 이번 세션은 메모리에만 남는다.
    }
  }

  function readState(): PersistedState {
    const raw = readRaw(stateKey);
    if (!raw) return emptyState();
    try {
      const parsed = JSON.parse(raw) as PersistedState;
      return migrate(parsed);
    } catch {
      return emptyState();
    }
  }

  function writeState(state: PersistedState): void {
    writeRaw(stateKey, JSON.stringify(state));
  }

  function readOutbox(): OutboxEntry[] {
    const raw = readRaw(outboxKey);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as OutboxEntry[]) : [];
    } catch {
      return [];
    }
  }

  function queue(entry: OutboxEntry): void {
    const pending = readOutbox().filter((item) => item.id !== entry.id);
    pending.push(entry);
    writeRaw(outboxKey, JSON.stringify(pending));
  }

  /** 기록에 신원과 수정 시각을 붙인다. 이미 있으면 시각만 갱신한다. */
  function stamp<T extends Syncable>(record: T): T & { id: string; updatedAt: string } {
    return {
      ...record,
      /*
       * 빈 문자열도 "없음"으로 본다. 화면에서 넘어온 값은 undefined가
       * 아니라 ''인 경우가 많고, ''를 그대로 두면 id 없는 기록이 생겨
       * 서버에 올릴 때 조용히 버려진다.
       */
      id: record.id || newId(),
      updatedAt: now(),
      deviceId,
    } as T & { id: string; updatedAt: string };
  }

  return {
    deviceId,

    load: readState,

    save(state) {
      writeState({ ...state, version: SCHEMA_VERSION });
    },

    putSession(session) {
      const state = readState();
      const stamped = stamp(session);
      state.sessions = upsert(state.sessions, stamped);
      writeState(state);
      queue({ kind: 'session', id: stamped.id, updatedAt: stamped.updatedAt });
      return stamped;
    },

    removeSession(id) {
      const state = readState();
      const existing = state.sessions.find((session) => session.id === id);
      if (!existing) return;
      // 실제로 지우지 않는다. 지우면 다른 기기가 자기 사본으로 되살린다.
      const stamped = stamp({ ...existing, deleted: true });
      state.sessions = upsert(state.sessions, stamped);
      writeState(state);
      queue({ kind: 'session', id, updatedAt: stamped.updatedAt });
    },

    putCheckIn(checkIn) {
      const state = readState();
      const stamped = stamp(checkIn);
      state.checkIns = upsert(state.checkIns, stamped);
      writeState(state);
      queue({ kind: 'checkIn', id: stamped.id, updatedAt: stamped.updatedAt });
      return stamped;
    },

    patch(partial) {
      const state = { ...readState(), ...partial, version: SCHEMA_VERSION };
      writeState(state);
      return state;
    },

    outbox: readOutbox,

    markSynced(ids) {
      const remaining = readOutbox().filter((entry) => !ids.includes(entry.id));
      writeRaw(outboxKey, JSON.stringify(remaining));
    },

    mergeRemote(remote) {
      const state = readState();
      for (const session of remote.sessions ?? []) {
        state.sessions = merge(state.sessions, session);
      }
      for (const checkIn of remote.checkIns ?? []) {
        state.checkIns = merge(state.checkIns, checkIn);
      }
      writeState(state);
      return state;
    },

    reset() {
      try {
        adapter.removeItem(stateKey);
        adapter.removeItem(outboxKey);
      } catch {
        // 지우지 못해도 다음 저장이 덮어쓴다.
      }
    },
  };
}

/** 삭제 표시된 기록을 걸러낸, 화면에 쓸 수 있는 목록. */
export function activeRecords<T extends Syncable>(records: readonly T[]): T[] {
  return records.filter((record) => !record.deleted);
}

function upsert<T extends Syncable>(records: readonly T[], record: T): T[] {
  const index = records.findIndex((item) => item.id === record.id);
  if (index < 0) return [...records, record];
  const next = [...records];
  next[index] = record;
  return next;
}

/** 마지막 수정 시각이 이기고, 같으면 기기 id로 결정한다(어디서 보든 같은 결과). */
function merge<T extends Syncable>(records: readonly T[], incoming: T): T[] {
  if (!incoming.id) return [...records];
  const existing = records.find((item) => item.id === incoming.id);
  if (!existing) return [...records, incoming];

  const mine = existing.updatedAt ?? '';
  const theirs = incoming.updatedAt ?? '';
  if (theirs > mine) return upsert(records, incoming);
  if (theirs < mine) return [...records];
  return (incoming.deviceId ?? '') > (existing.deviceId ?? '')
    ? upsert(records, incoming)
    : [...records];
}

function migrate(state: PersistedState): PersistedState {
  if (!state || typeof state !== 'object') return emptyState();
  return {
    ...emptyState(),
    ...state,
    version: SCHEMA_VERSION,
    sessions: Array.isArray(state.sessions) ? state.sessions : [],
    checkIns: Array.isArray(state.checkIns) ? state.checkIns : [],
  };
}

function defaultNewId(): string {
  const globalCrypto = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (globalCrypto?.randomUUID) return globalCrypto.randomUUID();
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
