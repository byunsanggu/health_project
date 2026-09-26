import type { CheckIn, SessionLog, Syncable } from './types.ts';

/**
 * 서버와 맞추기.
 *
 * 이 모듈은 서버가 무엇인지 모른다. Supabase든 직접 만든 서버든,
 * `SyncTransport` 두 함수만 있으면 돌아간다 — 나중에 서버를 갈아엎어도
 * 여기는 그대로다.
 *
 * 규칙은 storage.ts와 같다. **로컬이 먼저다.** 앱은 서버를 기다리지
 * 않고 로컬에 쓰고 아웃박스에 쌓아 둔다. 이 모듈은 그 아웃박스를
 * 흘려보내고, 서버에 새로 생긴 것을 받아 합친다.
 */

export type RecordKind = 'session' | 'checkIn';

/** 서버에 오가는 한 덩어리. 앱의 모양이 아니라 전송의 모양이다. */
export interface RemoteRecord {
  kind: RecordKind;
  id: string;
  /** 기기가 적은 수정 시각 — 충돌은 이 값으로 푼다 */
  updatedAt: string;
  deleted: boolean;
  body: unknown;
}

export interface PullResult {
  records: RemoteRecord[];
  /**
   * 다음에 "이 이후"를 물을 때 쓸 표시.
   *
   * 반드시 **서버가 적은 값**이어야 한다. 기기가 적은 updatedAt을 쓰면,
   * 시계가 5분 느린 폰이 올린 기록이 다음 동기화에서 걸러져 영영 안
   * 내려온다 — 기록을 잃는 버그이고, 잃고 나서야 알게 된다.
   */
  cursor: string | null;
}

/**
 * 설정 한 덩어리.
 *
 * 기록과 달리 합칠 일이 없다. 프로그램을 바꿨으면 바꾼 것이지, 두
 * 기기의 프로그램을 섞을 수는 없다. 그래서 통째로 나중 것이 이긴다.
 */
export interface RemoteSettings {
  updatedAt: string;
  body: unknown;
}

export interface SyncTransport {
  /** cursor 이후에 서버에서 바뀐 것 */
  pull(cursor: string | null): Promise<PullResult>;
  /** 올린다. 서버가 "더 새 것일 때만" 받아들인다 */
  push(records: readonly RemoteRecord[]): Promise<void>;
  /** 설정 받기. 없으면 null */
  pullSettings?(): Promise<RemoteSettings | null>;
  /** 설정 올리기 */
  pushSettings?(settings: RemoteSettings): Promise<void>;
}

/** 동기화가 읽고 쓰는 저장소 — storage.ts의 Store가 이 모양을 만족한다. */
export interface SyncStore {
  load(): { sessions: SessionLog[]; checkIns: CheckIn[] };
  outbox(): { kind: RecordKind; id: string; updatedAt: string }[];
  markSynced(ids: readonly string[]): void;
  mergeRemote(remote: { sessions?: SessionLog[]; checkIns?: CheckIn[] }): unknown;
}

export interface SyncOptions {
  /** 한 번에 몇 개씩 올릴 것인가 */
  batchSize?: number;
  /** 지난번 표시 */
  cursor?: string | null;
  /**
   * 이 기기의 설정과 그것이 마지막으로 바뀐 때.
   *
   * 없으면 설정은 건드리지 않는다 — 설정을 안 쓰는 화면에서도 기록
   * 동기화는 돌아야 한다.
   */
  settings?: { updatedAt: string; body: unknown } | null;
  /** 서버 설정이 더 새 것일 때 불린다 */
  onSettings?: (settings: RemoteSettings) => void;
}

export interface SyncResult {
  pushed: number;
  pulled: number;
  /** 설정이 어느 쪽으로 움직였는가 */
  settings?: 'pushed' | 'pulled' | 'same';
  /** 다음에 쓸 표시. 실패했으면 넣어 준 값 그대로다 */
  cursor: string | null;
  /** 왜 멈췄는가. 성공이면 없다 */
  error?: string;
  /** 사람에게 그대로 보여줄 한 줄 */
  message: string;
}

/**
 * 한 번에 몇 개씩 올릴 것인가.
 *
 * 한 달 치가 밀려 있으면 수백 개가 된다. 한 번에 다 보내면 지하철에서
 * 끊기는 순간 전부 실패하고 처음부터 다시 한다. 끊어 보내면 보낸
 * 만큼은 남는다.
 */
export const BATCH_SIZE = 50;

function isDeleted(record: Syncable): boolean {
  return record.deleted === true;
}

/**
 * 로컬 기록을 전송 모양으로.
 *
 * id와 updatedAt은 타입상 없을 수도 있다(저장소가 붙여 주기 전의 모양).
 * 없으면 못 보낸다 — 없는 id로 올리면 서버에 쓰레기 행이 생긴다.
 */
export function toRemote(kind: RecordKind, record: SessionLog | CheckIn): RemoteRecord | null {
  if (!record.id || !record.updatedAt) return null;
  return {
    kind,
    id: record.id,
    updatedAt: record.updatedAt,
    deleted: isDeleted(record),
    body: record,
  };
}

/** 받은 것을 앱 모양으로 되돌린다. 서버가 보낸 것은 못 믿으므로 모양을 확인한다. */
export function fromRemote(record: RemoteRecord): SessionLog | CheckIn | null {
  const body = record.body as Record<string, unknown> | null;
  if (!body || typeof body !== 'object') return null;
  if (typeof body.id !== 'string' || typeof body.updatedAt !== 'string') return null;

  /*
   * 껍데기(updatedAt·deleted)와 알맹이(body)가 어긋날 수 있다. 서버가
   * 보고 고른 것은 껍데기이므로 껍데기를 믿는다.
   */
  return {
    ...(body as unknown as SessionLog),
    updatedAt: record.updatedAt,
    deleted: record.deleted,
  } as SessionLog;
}

/**
 * 한 번 맞춘다.
 *
 * 올리고 나서 받는다. 순서가 중요하다 — 받고 올리면, 받은 것을 합치는
 * 사이에 생긴 로컬 수정이 이번 회차에서 빠진다.
 *
 * 어느 단계에서 실패해도 **이미 끝난 일은 되돌리지 않는다.** 올린 것은
 * 올린 것이고, 받다가 끊겼으면 다음에 같은 표시에서 다시 받으면 된다.
 */
export async function syncOnce(
  store: SyncStore,
  transport: SyncTransport,
  options: SyncOptions = {},
): Promise<SyncResult> {
  const batchSize = Math.max(1, options.batchSize ?? BATCH_SIZE);
  let cursor = options.cursor ?? null;
  let pushed = 0;
  let pulled = 0;

  // ── 올리기
  const pending = store.outbox();
  if (pending.length > 0) {
    const state = store.load();
    const byId = new Map<string, RemoteRecord>();
    for (const session of state.sessions) {
      const remote = toRemote('session', session);
      if (remote) byId.set('session:' + remote.id, remote);
    }
    for (const checkIn of state.checkIns) {
      const remote = toRemote('checkIn', checkIn);
      if (remote) byId.set('checkIn:' + remote.id, remote);
    }

    const queue: RemoteRecord[] = [];
    const orphans: string[] = [];
    for (const entry of pending) {
      const found = byId.get(entry.kind + ':' + entry.id);
      if (found) queue.push(found);
      /*
       * 아웃박스에는 있는데 로컬에 없다. 기록을 지우고 아웃박스만 남은
       * 경우다. 영원히 재시도하면 아웃박스가 안 비므로 그냥 지운다.
       */
      else orphans.push(entry.id);
    }
    if (orphans.length > 0) store.markSynced(orphans);

    for (let i = 0; i < queue.length; i += batchSize) {
      const chunk = queue.slice(i, i + batchSize);
      try {
        await transport.push(chunk);
      } catch (error) {
        return {
          pushed,
          pulled,
          cursor,
          error: messageOf(error),
          message: pushed > 0
            ? `${pushed}개를 올리고 끊겼습니다. 나머지는 다음에 올립니다.`
            : '서버에 올리지 못했습니다. 기록은 이 기기에 남아 있습니다.',
        };
      }
      // 보낸 만큼은 아웃박스에서 뺀다 — 다음에 끊겨도 여기까지는 남는다.
      store.markSynced(chunk.map((record) => record.id));
      pushed += chunk.length;
    }
  }

  // ── 받기
  try {
    const result = await transport.pull(cursor);
    const sessions: SessionLog[] = [];
    const checkIns: CheckIn[] = [];

    for (const record of result.records) {
      const restored = fromRemote(record);
      if (!restored) continue;  // 모양이 깨진 것은 버린다. 앱을 멈추는 것보다 낫다.
      if (record.kind === 'session') sessions.push(restored as SessionLog);
      else checkIns.push(restored as CheckIn);
    }

    if (sessions.length > 0 || checkIns.length > 0) {
      store.mergeRemote({ sessions, checkIns });
    }
    pulled = sessions.length + checkIns.length;
    // 표시는 하나라도 받았을 때만 옮긴다. 빈 응답에 null이 오면 처음부터 다시 받게 된다.
    if (result.cursor) cursor = result.cursor;
  } catch (error) {
    return {
      pushed,
      pulled,
      cursor,
      error: messageOf(error),
      message: pushed > 0
        ? `${pushed}개를 올렸습니다. 받는 중에 끊겼습니다.`
        : '서버에서 받지 못했습니다. 이 기기의 기록은 그대로입니다.',
    };
  }

  /*
   * 설정.
   *
   * 기록보다 뒤에 한다. 기록은 하나도 잃으면 안 되는 것이고 설정은
   * 다시 고르면 되는 것이라, 끊길 때 살아남아야 하는 쪽이 먼저다.
   */
  let settingsMoved: SyncResult['settings'];
  if (options.settings && transport.pullSettings && transport.pushSettings) {
    try {
      const mine = options.settings;
      const theirs = await transport.pullSettings();

      if (!theirs || theirs.updatedAt < mine.updatedAt) {
        await transport.pushSettings({ updatedAt: mine.updatedAt, body: mine.body });
        settingsMoved = 'pushed';
      } else if (theirs.updatedAt > mine.updatedAt) {
        if (options.onSettings) options.onSettings(theirs);
        settingsMoved = 'pulled';
      } else {
        settingsMoved = 'same';
      }
    } catch (error) {
      /*
       * 설정이 안 맞아도 기록은 이미 맞췄다. 그걸 실패로 돌리면
       * 다음에 기록을 처음부터 다시 올린다.
       */
      return {
        pushed,
        pulled,
        cursor,
        error: messageOf(error),
        message: describe(pushed, pulled) + ' 설정은 맞추지 못했습니다.',
      };
    }
  }

  return {
    pushed,
    pulled,
    cursor,
    settings: settingsMoved,
    message: describe(pushed, pulled, settingsMoved),
  };
}

function describe(pushed: number, pulled: number, settings?: SyncResult['settings']): string {
  const tail = settings === 'pulled' ? ' 설정도 가져왔습니다.' : '';
  if (pushed === 0 && pulled === 0) {
    return settings === 'pulled' ? '설정을 가져왔습니다.' : '이미 맞춰져 있습니다.';
  }
  if (pulled === 0) return `${pushed}개를 서버에 올렸습니다.` + tail;
  if (pushed === 0) return `서버에서 ${pulled}개를 받았습니다.` + tail;
  return `${pushed}개를 올리고 ${pulled}개를 받았습니다.` + tail;
}

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

/**
 * 마지막으로 맞춘 때를 사람 말로.
 *
 * "2026-09-26T04:11:00Z"를 보여주면 아무도 안 읽는다. 중요한 건 시각이
 * 아니라 **지금 안전한가**이므로 그렇게 쓴다.
 */
export function syncAgeLine(lastSyncedAt: string | null, nowMs: number, pending: number): string {
  if (pending > 0 && !lastSyncedAt) {
    return `아직 서버에 올리지 않았습니다 · ${pending}개 대기`;
  }
  if (!lastSyncedAt) return '아직 서버에 올리지 않았습니다';

  const ms = nowMs - Date.parse(lastSyncedAt);
  const suffix = pending > 0 ? ` · ${pending}개 대기` : '';

  if (Number.isNaN(ms) || ms < 0) return '방금 맞췄습니다' + suffix;
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) return '방금 맞췄습니다' + suffix;
  if (minutes < 60) return `${minutes}분 전에 맞췄습니다` + suffix;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}시간 전에 맞췄습니다` + suffix;

  const days = Math.floor(hours / 24);
  return `${days}일 전에 맞췄습니다` + suffix;
}
