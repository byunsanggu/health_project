/**
 * 친구.
 *
 * 헬스장 앱에 사람을 붙일 때 제일 흔한 실수는 **소셜 앱을 하나 더 만드는
 * 것**이다. 피드, 좋아요, 쪽지, 누가 지금 어디 있는지. 그렇게 만들면
 * 운동 앱이 아니라 관리할 것이 하나 더 늘어난 앱이 된다.
 *
 * 여기서 친구가 하는 일은 하나다 — **서로 나왔는지 아는 것.**
 *
 * 세 가지를 지킨다.
 *
 *   1. **보이는 것은 "나왔다/안 나왔다"뿐이다.** 무게도 종목도 체중도
 *      통증도 안 보인다. 건강 정보는 민감정보라 친구에게 보이려면 완전히
 *      다른 동의가 필요하고, 그걸 받는다 해도 남의 스쿼트 무게는 동기부여가
 *      아니라 비교질이 된다.
 *
 *   2. **자유롭게 쓴 말을 주고받지 않는다.** 정해진 문구만 보낸다. 쪽지가
 *      열리는 순간 괴롭힘·스팸·유출 경로가 같이 열린다. 응원에 필요한
 *      말은 네댓 개면 충분하다.
 *
 *   3. **더 하라고 밀지 않는다.** 챌린지 목표는 두 사람이 **각자 하기로 한
 *      횟수를 합친 값**이다. 공부 앱은 "더 해라"로 밀어도 되지만 운동은
 *      아니다 — 그렇게 밀면 다친다.
 */
import { withParticle } from './korean.ts';

/* ── 친구 코드 ─────────────────────────────────── */

/**
 * 이름으로 찾지 않는다.
 *
 * 이름·전화번호로 검색되게 만들면 모르는 사람이 붙는다. 헬스장은 실제
 * 장소라, "이 사람은 화·목 저녁에 여기 온다"가 새는 순간 위험해진다.
 * 코드를 직접 주고받은 사이만 친구가 된다.
 *
 * 헷갈리는 글자는 뺀다 — 0/O, 1/I/L. 카톡으로 받아 적다 틀리면 그 사람은
 * 다시 시도하지 않는다.
 */
export const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export const CODE_LENGTH = 6;

/** 사람이 적어 온 것을 코드로 고친다. 소문자·공백·붙임표를 받아 준다. */
export function normalizeFriendCode(raw: string): string | null {
  const cleaned = (raw ?? '').toUpperCase().replace(/[\s-]/g, '');
  if (cleaned.length !== CODE_LENGTH) return null;
  for (const letter of cleaned) {
    if (!CODE_ALPHABET.includes(letter)) return null;
  }
  return cleaned;
}

/** 화면에 보일 때는 가운데를 띄운다 — 읽어 주기 쉽다. */
export function formatFriendCode(code: string): string {
  const normalized = normalizeFriendCode(code);
  if (!normalized) return code;
  return normalized.slice(0, 3) + '-' + normalized.slice(3);
}

/*
 * 별명(닉네임) 규칙은 nickname.ts에 있다.
 *
 * 여기에도 두면 두 벌이 되고, 두 벌은 반드시 갈라진다 — 한쪽만 고친
 * 날 앱은 통과시키고 DB는 거절한다.
 */

/* ── 응원 ──────────────────────────────────────── */

export type CheerKind = 'go' | 'nice' | 'done' | 'together';

/**
 * 보낼 수 있는 말 전부.
 *
 * 다섯 개가 안 되게 한다. 고르는 일이 부담이 되면 아무도 안 보낸다.
 * 그리고 **어느 하나도 재촉이 아니다** — "왜 안 나와"는 친구가 할 말이지
 * 앱이 만들어 줄 말이 아니다.
 */
export const CHEERS: readonly { kind: CheerKind; label: string; text: string }[] = [
  { kind: 'go', label: '오늘 갑시다', text: '오늘 갑시다 👊' },
  { kind: 'nice', label: '좋아요', text: '좋아요 👍' },
  { kind: 'done', label: '고생했어요', text: '고생했어요' },
  { kind: 'together', label: '같이 채웁시다', text: '이번 주 같이 채웁시다' },
];

export function cheerText(kind: CheerKind): string {
  return CHEERS.find((item) => item.kind === kind)?.text ?? '';
}

/**
 * 하루에 친구당 한 번.
 *
 * 막지 않으면 알림 폭탄이 된다. 응원은 한 번이면 응원이고 열 번이면
 * 괴롭힘이다.
 */
export function canCheer(lastCheerISO: string | undefined, todayISO: string): boolean {
  if (!lastCheerISO) return true;
  return lastCheerISO.slice(0, 10) < todayISO;
}

/* ── 친구 한 줄 ────────────────────────────────── */

export interface FriendWeek {
  userId: string;
  name: string;
  /** 이번 주에 나온 날 */
  days: number;
  /** 이번 주에 하기로 한 횟수 */
  target: number;
  /** 연속으로 지킨 주 */
  streakWeeks: number;
  /** 마지막으로 응원 보낸 때 (ISO). 안 보냈으면 없음 */
  lastCheerAt?: string;
}

export interface FriendRow extends FriendWeek {
  kept: boolean;
  /** 화면에 그대로 쓸 한 줄 */
  text: string;
  canCheer: boolean;
}

export function friendRow(friend: FriendWeek, todayISO: string): FriendRow {
  const kept = friend.days >= friend.target;
  const left = Math.max(0, friend.target - friend.days);

  /*
   * 안 나온 사람에게 잔소리를 만들지 않는다. "0/4"는 그대로 보이지만,
   * 문장으로 "아직 한 번도 안 나왔습니다"라고 쓰면 그건 앱이 대신 하는
   * 타박이다. 숫자는 숫자로 두고 말은 아낀다.
   */
  const text = kept
    ? `이번 주 ${friend.target}번 다 채웠습니다`
    : `${friend.days} / ${friend.target}` + (left === 1 ? ' · 한 번 남았습니다' : '');

  return {
    ...friend,
    kept,
    text,
    canCheer: canCheer(friend.lastCheerAt, todayISO),
  };
}

/* ── 같이 하는 챌린지 ──────────────────────────── */

export interface QuestInput {
  /** 나 */
  mine: { days: number; target: number };
  /** 친구 */
  theirs: { days: number; target: number };
  friendName: string;
}

export interface Quest {
  done: number;
  target: number;
  kept: boolean;
  /** 남은 횟수 */
  left: number;
  text: string;
}

/**
 * 둘이 합쳐 이번 주 몇 번.
 *
 * 목표는 **각자 하기로 한 횟수의 합**이다. 이게 이 기능의 전부다.
 *
 * 듀오링고식으로 "이번 주 10번!" 같은 숫자를 앱이 정해 주면, 주 3회 하기로
 * 한 사람이 친구 때문에 5번 나오게 된다. 그건 챌린지가 아니라 부상이다.
 * 각자 자기 약속만 지키면 챌린지도 저절로 채워진다 — 그래야 친구가
 * 부담이 아니라 힘이 된다.
 *
 * 그리고 **경쟁이 아니라 합산이다.** 누가 더 했는지 줄 세우면 무리하는
 * 사람이 나온다. 같이 채우는 것이라 서로 응원할 이유만 생긴다.
 */
export function buildQuest(input: QuestInput): Quest {
  const target = Math.max(1, input.mine.target + input.theirs.target);
  const done = Math.max(0, input.mine.days) + Math.max(0, input.theirs.days);
  const left = Math.max(0, target - done);
  const kept = done >= target;

  const text = kept
    ? `${withParticle(input.friendName, '과/와')} 이번 주 ${target}번을 다 채웠습니다`
    : left === 1
      ? '한 번만 더 하면 둘이 다 채웁니다'
      : `둘이 합쳐 ${target}번 중 ${done}번`;

  return { done, target, kept, left, text };
}

/**
 * 친구가 여럿일 때.
 *
 * 친구마다 챌린지를 하나씩 띄우면 화면이 금세 목록이 된다. 사람 수만큼
 * 목표를 세우는 것도 이상하다 — 나는 한 번 나가는데 그 한 번이 세 군데에
 * 동시에 세어진다.
 *
 * 다 합쳐 하나로 둔다. 나와 친구들이 각자 하기로 한 횟수의 총합이 목표다.
 */
export function groupQuest(
  mine: { days: number; target: number },
  friends: readonly FriendWeek[],
): Quest | null {
  if (friends.length === 0) return null;

  const theirs = friends.reduce(
    (sum, friend) => ({
      days: sum.days + Math.max(0, friend.days),
      target: sum.target + Math.max(0, friend.target),
    }),
    { days: 0, target: 0 },
  );

  return buildQuest({
    mine,
    theirs,
    friendName: friends.length === 1 ? friends[0]!.name : `친구 ${friends.length}명`,
  });
}
