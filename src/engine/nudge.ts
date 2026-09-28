/**
 * 다시 부르기.
 *
 * 습관 앱의 알림은 대개 죄책감으로 굴러간다 — "연속 기록이 사라집니다".
 * 공부 앱에서는 그게 통하지만, 여기서 통하면 **아픈 사람이 헬스장에 간다.**
 * 트레이너가 20년 동안 말려 온 그 행동을 알림이 시키는 꼴이다.
 *
 * 그래서 여기는 "무엇을 보낼까"를 정하는 곳이 아니라 **"언제 입을 다물까"**
 * 를 정하는 곳이다. 보내지 않을 이유를 먼저 본다.
 */
import { withParticle } from './korean.ts';

/** 한 주에 몇 번까지 부를 것인가. */
export const MAX_PER_WEEK = 2;

/** 마지막으로 부른 뒤 적어도 이만큼은 둔다. */
export const MIN_GAP_HOURS = 40;

/**
 * 이 점수 이상이면 부르지 않는다. 체크인과 같은 0~10점이다.
 *
 * 숫자를 새로 정하지 않고 **앱이 이미 쓰는 선**을 가져온다(pain.ts).
 *
 *   7점 이상 → 그 관절에 부하가 실리는 동작을 중단하고 전문의를 권한다
 *   3~6점    → 종목을 대체하거나 중량을 낮춘다
 *
 * 3~6점은 부른다. 앱이 세션을 알아서 바꿔 주므로 나와도 되는 상태다.
 * 7점부터는 앱 스스로 "하지 마세요"라고 말하는 상태이고, 그 사람을
 * 헬스장으로 부르는 것은 다치라는 말이다.
 *
 * 두 곳이 갈리면 앱이 한 입으로 두말하게 된다 — 화면에서는 오늘 쉬라고
 * 하면서 알림으로는 나오라고 한다.
 */
export const PAIN_QUIET_SCORE = 7;

/** 주가 끝나기 이만큼 전부터는 "한 번만 더"가 거짓말이 된다. */
export const LAST_CALL_HOURS = 30;

export interface NudgeInput {
  /** 이번 주에 나온 날 수 */
  daysThisWeek: number;
  /** 이번 주에 하기로 한 횟수 */
  target: number;
  /** 이번 주 남은 날 (오늘 포함) */
  daysLeftInWeek: number;
  /** 지금 아픈 곳 중 제일 높은 점수 (0~5) */
  worstPain: number;
  /** 연속으로 지킨 주 */
  streakWeeks: number;
  /** 이번 주에 이미 몇 번 불렀나 */
  sentThisWeek: number;
  /** 마지막으로 부른 뒤 지난 시간 (시간 단위). 한 번도 안 불렀으면 undefined */
  hoursSinceLast?: number;
  /** 오늘 이미 운동했는가 */
  trainedToday: boolean;
}

export type NudgeSkip =
  | 'done'
  | 'trainedToday'
  | 'pain'
  | 'quota'
  | 'tooSoon'
  | 'weekOver';

export interface NudgeDecision {
  send: boolean;
  /** 안 보내는 이유 — 기록해 두면 "왜 안 왔지"를 나중에 설명할 수 있다 */
  skip?: NudgeSkip;
  title?: string;
  body?: string;
}

/**
 * 부를 것인가.
 *
 * 순서가 뜻을 담고 있다. **아프면 다른 어떤 이유보다 먼저 입을 다문다** —
 * 횟수가 남았든, 연속이 걸렸든 상관없다.
 */
export function decideNudge(input: NudgeInput): NudgeDecision {
  if (input.worstPain >= PAIN_QUIET_SCORE) return { send: false, skip: 'pain' };
  if (input.daysThisWeek >= input.target) return { send: false, skip: 'done' };
  if (input.trainedToday) return { send: false, skip: 'trainedToday' };
  if (input.daysLeftInWeek <= 0) return { send: false, skip: 'weekOver' };
  if (input.sentThisWeek >= MAX_PER_WEEK) return { send: false, skip: 'quota' };
  if (input.hoursSinceLast !== undefined && input.hoursSinceLast < MIN_GAP_HOURS) {
    return { send: false, skip: 'tooSoon' };
  }

  const left = input.target - input.daysThisWeek;

  /*
   * 할 수 있는 말만 한다.
   *
   * 남은 날보다 남은 횟수가 많으면 "이번 주도 지킬 수 있습니다"는 거짓말이다.
   * 그때는 약속을 들먹이지 않고 그냥 한 번 나오라고 한다 — 못 지킬 약속을
   * 흔들면 그 주를 통째로 포기한다.
   */
  const reachable = left <= input.daysLeftInWeek;

  if (!reachable) {
    return {
      send: true,
      title: '오늘 한 번 어떠세요',
      body: '이번 주가 빡빡하더라도 한 번 나온 주와 아예 안 나온 주는 다릅니다. ' +
        '15분짜리도 됩니다.',
    };
  }

  if (left === 1) {
    return {
      send: true,
      title: '한 번만 더',
      body: input.streakWeeks > 0
        ? `오늘 나오시면 ${input.streakWeeks + 1}주 연속입니다.`
        : '오늘 나오시면 이번 주 약속을 지킵니다.',
    };
  }

  return {
    send: true,
    title: `이번 주 ${withParticle(String(left) + '번', '이/가')} 남았습니다`,
    body: `${input.daysLeftInWeek}일 안에 ${left}번입니다. 오늘 한 번 빼 두면 주말이 편합니다.`,
  };
}

/**
 * 언제 보낼 것인가 — 그 사람이 여는 시간에.
 *
 * 일괄로 아침 8시에 쏘면 그 시간에 헬스장 가는 사람은 없다. 지금까지
 * **운동을 시작한 시각의 중앙값** 한 시간 전이 그 사람의 시간이다.
 *
 * 기록이 적으면 짐작하지 않고 저녁 6시를 쓴다. 평일 퇴근 뒤가 제일 흔하다.
 */
export const DEFAULT_HOUR = 18;
export const MIN_SAMPLES = 3;
export const LEAD_HOURS = 1;

export function nudgeHour(startHours: readonly number[]): number {
  if (startHours.length < MIN_SAMPLES) return DEFAULT_HOUR;
  const sorted = [...startHours].sort((a, b) => a - b);
  const middle = sorted[Math.floor(sorted.length / 2)]!;
  const hour = middle - LEAD_HOURS;
  /*
   * 밤중에 깨우지 않는다. 새벽 운동을 하는 사람이라도 다섯 시 전에 울리는
   * 알림은 도움이 아니라 사고다.
   */
  return Math.min(21, Math.max(6, hour));
}
