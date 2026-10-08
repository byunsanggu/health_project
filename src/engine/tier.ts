/**
 * 티어 — 브론즈에서 다이아몬드까지.
 *
 * 등급을 **무게로 나누지 않는다.** 세 가지 이유가 있다.
 *
 *   1. 무게를 등급에 쓰려면 그 수치가 서버로 올라가야 한다. 건강
 *      정보는 민감정보라 친구 스키마는 records를 아예 쳐다보지 않게
 *      만들어 두었다. 등급 하나 때문에 그 벽을 허물 수 없다.
 *   2. 무게는 손으로 치는 숫자다. 200kg이라고 적으면 다이아몬드다.
 *      거짓말이 공짜인 순간 등급은 죽는다.
 *   3. 100kg을 치던 사람은 영원히 다이아몬드이고 오늘 시작한 사람은
 *      영원히 브론즈다. 올라갈 길이 안 보이면 아무도 안 한다.
 *
 * 그래서 **약속을 지킨 주**로 나눈다. 주 3회를 여덟 주 지킨 초보가
 * 주 1회 나오는 경력 10년보다 위다 — 트레이너가 손님에게 하고 싶은
 * 말이 바로 이것이고, 무게 등급으로는 절대 할 수 없는 말이다.
 *
 * 그리고 등수를 매기지 않는다. 티어는 "나 대 기준"이고 등수는
 * "나 대 남"이다. 등수를 붙이는 순간 1등 한 명 빼고 전부 진다.
 */
import { withParticle } from './korean.ts';
import type { WeekResult } from './streak.ts';

export type TierId = 'bronze' | 'silver' | 'gold' | 'platinum' | 'diamond';

export interface Tier {
  id: TierId;
  name: string;
  /** 이 티어가 되는 데 필요한 점수(지킨 주) */
  weeks: number;
}

/**
 * 1 · 4 · 12 · 26 · 52.
 *
 * 일 년을 꾸준히 하면 다이아몬드다. 도달할 수 있는 숫자여야 허세가
 * 안 되고, 한 달 만에 닿는 숫자면 아무 의미가 없다.
 */
export const TIERS: readonly Tier[] = [
  { id: 'bronze', name: '브론즈', weeks: 1 },
  { id: 'silver', name: '실버', weeks: 4 },
  { id: 'gold', name: '골드', weeks: 12 },
  { id: 'platinum', name: '플래티넘', weeks: 26 },
  { id: 'diamond', name: '다이아몬드', weeks: 52 },
];

/**
 * 한 단계 내려가기까지 빠져야 하는 주.
 *
 * 한 주 놓쳤다고 내리면 아무도 안 한다. 현실에서 안 빠지는 사람은
 * 없다 — 출장, 감기, 명절. 두 주 연속으로 비면 그때는 습관이 끊긴
 * 것이 맞으므로 한 단계만 내린다.
 */
export const DEMOTE_AFTER = 2;

/**
 * 그때 돌려놓는 주.
 *
 * 처음에는 "한 단계 아래의 바닥으로"로 잡았는데, 그러면 플래티넘(26주)이
 * 두 주 비었다고 골드(12주)가 된다 — 반 년치가 한 번에 날아간다. 그렇게
 * 만들면 두 주 빠진 사람은 돌아오지 않는다. 돌아와도 닿지 않을 거리면
 * 애초에 안 돌아온다.
 *
 * 그래서 등급이 아니라 **주를 깎는다.** 비운 두 주 + 몸이 돌아오는 데
 * 걸리는 두 주, 합쳐서 네 주다. 등급은 그 결과로 따라 내려간다. 플래티넘이
 * 골드가 되더라도 **네 주면 돌아온다** — 이 말을 할 수 있어야 한다.
 */
export const DEMOTE_WEEKS = 4;

export function tierFor(score: number): Tier | null {
  let found: Tier | null = null;
  for (const tier of TIERS) {
    if (score >= tier.weeks) found = tier;
  }
  return found;
}

export function nextTier(score: number): Tier | null {
  return TIERS.find((tier) => tier.weeks > score) ?? null;
}

function demotedScore(score: number): number {
  return Math.max(0, score - DEMOTE_WEEKS);
}

/** 지금 티어로 되돌아가려면 몇 주인가. 안 내려갔으면 0. */
export function weeksBackTo(score: number, tier: Tier | null): number {
  if (!tier) return 0;
  return Math.max(0, tier.weeks - score);
}

export interface TierInput {
  /** buildStreak이 준 주 목록. 최근 주가 앞이다 */
  weeks: readonly WeekResult[];
  /**
   * 봐주는 주의 월요일들.
   *
   * 통증을 적었거나 덜어내는 주처럼 **빠진 것이 옳았던 주**다. 이런
   * 주에 등급을 깎으면 앱이 아픈 날 나오라고 미는 셈이 된다 — 그건
   * 부상을 만드는 앱이지 트레이너가 만들 앱이 아니다.
   */
  excused?: readonly string[];
  /** 같은 티어에 몇 명 있는가. 모르면 없음 */
  peers?: number;
}

export interface TierState {
  /** 지킨 주 점수 */
  score: number;
  tier: Tier | null;
  next: Tier | null;
  /** 다음 티어까지 몇 주 */
  weeksToNext: number | null;
  /** 지금 몇 주 연속 빠졌나 */
  missRun: number;
  /** 한 주 더 빠지면 내려가는가 */
  atRisk: boolean;
  /** 마지막으로 끝난 주에 등급이 움직였는가 */
  change: 'up' | 'down' | null;
  /** 화면에 그대로 쓸 한 줄 */
  message: string;
}

/**
 * 점수는 끝난 주에만 움직인다.
 *
 * 진행 중인 주를 세면 월요일 아침에 올라갔던 등급이 금요일에 내려간다.
 * 숫자가 하루 종일 움직이면 그건 동기부여가 아니라 강박이다.
 */
export function buildTier(input: TierInput): TierState {
  const excused = new Set(input.excused ?? []);
  // buildStreak은 최근 주를 앞에 둔다. 점수는 과거에서 현재로 쌓인다.
  const ordered = [...input.weeks].reverse();

  let score = 0;
  let missRun = 0;
  /** 마지막 강등에서 잃은 티어. "거기로 돌아가는 데 몇 주"를 말하려면 필요하다 */
  let lost: Tier | null = null;
  let change: 'up' | 'down' | null = null;

  for (const week of ordered) {
    if (!week || week.open) continue;
    if (excused.has(week.weekStart)) continue;

    const before = tierFor(score)?.id ?? null;

    if (week.kept || week.forgiven) {
      // 쉼표로 살린 주는 점수를 주지 않는다 — 안 한 주를 한 주로 세면 거짓말이다.
      if (week.kept) score += 1;
      missRun = 0;
    } else {
      missRun += 1;
      if (missRun >= DEMOTE_AFTER) {
        score = demotedScore(score);
        missRun = 0;
      }
    }

    const after = tierFor(score)?.id ?? null;
    change = rankOf(after) > rankOf(before) ? 'up' : rankOf(after) < rankOf(before) ? 'down' : null;
    if (change === 'down') lost = TIERS[rankOf(before)] ?? null;
  }

  const tier = tierFor(score);
  const next = nextTier(score);

  return {
    score,
    tier,
    next,
    weeksToNext: next ? next.weeks - score : null,
    missRun,
    atRisk: missRun > 0 && tier !== null,
    change,
    message: messageOf({ score, tier, next, missRun, change, lost, peers: input.peers }),
  };
}

function rankOf(id: TierId | null): number {
  if (!id) return -1;
  return TIERS.findIndex((tier) => tier.id === id);
}

function messageOf(input: {
  score: number;
  tier: Tier | null;
  next: Tier | null;
  missRun: number;
  change: 'up' | 'down' | null;
  lost: Tier | null;
  peers?: number;
}): string {
  const { score, tier, next, missRun, change, lost, peers } = input;

  if (!tier) {
    if (change === 'down') return '두 주 비어서 브론즈가 풀렸습니다. 이번 주 한 번만 지키면 돌아옵니다.';
    return score === 0
      ? '이번 주 약속을 지키면 브론즈입니다.'
      : '이번 주 약속을 지키면 브론즈로 돌아옵니다.';
  }

  if (change === 'up') {
    const crowd = peers && peers > 1
      ? ` 지금 ${peers.toLocaleString('ko-KR')}명이 같은 자리에 있습니다.`
      : '';
    return `${tier.name}입니다. 지킨 주 ${score}주로 올라섰습니다.${crowd}`;
  }

  if (change === 'down') {
    const to = withParticle(tier.name, '으로/로');
    const back = lost ? weeksBackTo(score, lost) : 0;
    return back > 0
      ? `두 주 비어서 ${to} 내려왔습니다. ${back}주 지키면 ${withParticle(lost!.name, '으로/로')} 돌아옵니다.`
      : `두 주 비어서 ${to} 내려왔습니다.`;
  }

  if (missRun > 0) {
    return `${tier.name} · 지킨 주 ${score}주. 이번 주도 비면 ${DEMOTE_WEEKS}주가 깎입니다 — 한 번만 나가면 됩니다.`;
  }

  if (next) {
    const left = next.weeks - score;
    return left === 1
      ? `${tier.name} · 한 주만 더 지키면 ${next.name}입니다.`
      : `${tier.name} · ${next.name}까지 ${left}주 남았습니다.`;
  }

  return `${tier.name} · 지킨 주 ${score}주. 더 올라갈 자리가 없습니다.`;
}

/**
 * 친구 목록에 붙일 짧은 꼬리표.
 *
 * 친구 줄에는 이미 "이번 주 2/3"이 있다. 거기에 긴 말을 더하면 줄이
 * 두 줄이 되고, 두 줄이 되면 열 명이 한 화면에 안 들어간다.
 */
export function tierBadge(score: number): string {
  return tierFor(score)?.name ?? '';
}
