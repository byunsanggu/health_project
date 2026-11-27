/**
 * 시간이 없는 날.
 *
 * 습관 앱들이 사람을 붙잡아 두는 진짜 장치는 연속 기록이 아니다.
 * **"한 문제만 풀어도 인정"** 이다. 야근하고 온 사람에게 오늘 할 일을
 * 통째로 보여주면 앱을 끈다. 그 사람이 여는 것은 "3분이면 됩니다"다.
 *
 * 운동판으로 옮기면 "60분 4종목" 대신 **"15분, 제일 중요한 것만"** 이다.
 * 이건 눈속임이 아니라 실제로 맞는 코칭이기도 하다 — 아무것도 안 한 주보다
 * 15분짜리 세 번이 훨씬 낫다.
 *
 * 줄이는 일 자체는 timeBudget이 이미 한다(고립부터 덜고 메인은 지킨다).
 * 여기서 정하는 것은 **무엇을 권할 것인가**와 **그 약속이 참인가**다.
 */
import { fitToTimeBudget, type TimeFitOptions } from './timeBudget.ts';
import type { PlannedSession } from './session.ts';
import type { CoachStyle } from './coach.ts';

/**
 * 권하는 길이.
 *
 * 둘이면 충분하다. "15분도 없다"는 사람에게 5분을 권하면 그건 운동이
 * 아니라 달래기이고, 셋 넷으로 늘리면 고르는 일이 또 하나의 부담이 된다.
 *
 *   15분 — 퇴근길에 들러 메인만 치고 나오는 날
 *   25분 — 시간은 없지만 보조 하나는 붙일 수 있는 날
 */
export const SHORT_MINUTES: readonly number[] = [15, 25];

/**
 * 실제로 줄어드는 길이만 권한다.
 *
 * 오늘이 30분짜리인데 "25분만 하기"를 띄우면, 5분 아끼자고 버튼을 누르게
 * 하는 것이다. 사람은 그걸 한 번 겪으면 그 버튼을 다시 안 믿는다.
 */
export const MEANINGFUL_SAVING_MINUTES = 8;

export interface ShortOption {
  /** 누른 값 */
  budgetMinutes: number;
  /** 실제로 걸리는 시간 — 세트 단위로 잘리므로 예산보다 짧게 끝난다 */
  actualMinutes: number;
  /** 남는 것 — "벤치프레스 3세트 · 풀업 3세트" */
  kept: string;
  session: PlannedSession;
}

/**
 * 오늘 권할 수 있는 짧은 길들.
 *
 * 예산이 아니라 **결과**로 준다. 25분을 눌렀는데 19분이 나오는 일이
 * 생기는데(세트 단위로 잘리니까), 버튼에 "25분"만 적어 두면 화면이
 * 약속한 것과 실제가 다르다.
 *
 * 그리고 **같은 결과를 두 번 권하지 않는다.** 15분과 25분이 똑같은
 * 세션으로 끝나면 고르는 일만 하나 늘고 얻는 것이 없다.
 */
export function shortOptions(
  session: PlannedSession,
  fullMinutes: number,
  options: TimeFitOptions = {},
): ShortOption[] {
  const out: ShortOption[] = [];

  for (const budget of SHORT_MINUTES) {
    if (fullMinutes - budget < MEANINGFUL_SAVING_MINUTES) continue;

    const fit = fitToTimeBudget(session, budget, options);
    const kept = keptLine(fit.session);
    if (!kept) continue;
    if (out.some((prev) => prev.kept === kept)) continue;
    // 메인 둘을 2세트씩만 남겨도 넘치면(무거운 데드리프트 날의 15분) 그 칸은 내놓지 않는다
    const actualMinutes = Math.max(1, Math.round(fit.afterSeconds / 60));
    if (actualMinutes > budget) continue;

    out.push({
      budgetMinutes: budget,
      actualMinutes,
      kept,
      session: fit.session,
    });
  }

  return out;
}

/**
 * 이 세션이 "운동한 날"로 세어지는가.
 *
 * 화면은 "이것만 해도 이번 주 약속은 지켜집니다"라고 말한다. 그 말이
 * 참이려면 줄인 세션에 **본 세트가 하나라도** 남아 있어야 한다 —
 * 주간 기록이 날을 세는 기준이 그것이기 때문이다(streak.ts).
 *
 * 계획의 sets에는 워밍업이 안 들어간다. 워밍업은 종목마다 따로 계산해
 * 붙이는 것이라(warmup.ts), 여기 남아 있는 세트는 전부 본 세트다.
 *
 * 화면이 하는 약속을 코드가 지키는지 여기서 확인한다. 줄이는 규칙이
 * 언젠가 바뀌어 메인까지 밀어내면, 그날부터 저 문장은 거짓말이 된다.
 */
export function countsAsTrainingDay(session: PlannedSession): boolean {
  return session.exercises.some((item) => item.sets.length > 0);
}

/** 남은 것을 한 줄로 — "스쿼트 3세트 · 레그프레스 2세트" */
export function keptLine(session: PlannedSession): string {
  return session.exercises
    .filter((item) => item.sets.length > 0)
    .map((item) => `${item.exercise.name} ${item.sets.length}세트`)
    .join(' · ');
}

/* ── 5분만 해도 됩니다 ─────────────────────────────
 *
 * 약속한 시각이 지났는데 아직 시작을 안 했다. 그 사람에게 60분짜리 목록을
 * 또 보여 주면 "오늘은 글렀다"로 닫는다. 문턱을 5분까지 낮춘다 — 시작만 하면
 * 대개는 계속한다. 계속 안 해도 괜찮다. 5분 한 날은 0분 한 날과 다르다.
 *
 * 여기서 정하는 것은 셋이다. **언제 권하는가 · 언제 묻는가 · 무엇이 세어지는가.**
 */

/** 이만큼 움직이면 묻는다(멈춘 시간은 빼고). */
export const FIVE_MINUTE_SECONDS = 5 * 60;

/**
 * 한 번에 더하는 시간의 상한. 화면 밖에서는 페이지 시계가 몇 분씩 건너뛰는데,
 * 그 틈을 통째로 "움직인 시간"으로 치면 앱을 다녀온 사이에 5분이 차 버린다.
 */
export const ACTIVE_TICK_CAP_MS = 60 * 1000;

export interface FiveMinuteOfferInput {
  /** 오늘 약속한 시각(자정부터 분). 오늘이 약속한 요일이 아니거나 약속이 없으면 null */
  promisedMinutes: number | null;
  nowMinutes: number;
  /** 오늘 이미 시작했는가 — 시계가 돌았거나 세트가 있다 */
  started: boolean;
  /** 오늘을 이미 마쳤는가 */
  closed: boolean;
  /** 이번 주를 다 채운 쉬는 날인가 */
  restDay: boolean;
}

/**
 * "5분만 하기"를 보여 줄 것인가.
 *
 * 약속 시각이 지났고 아직 시작하지 않은 날에만. 약속 전에 띄우면 "5분만 해도
 * 된다"가 기본값이 되고, 그러면 원래 운동이 줄어든다. 약속이 없는 사람에게는
 * 지났는지를 알 길이 없으니 띄우지 않는다.
 */
export function offerFiveMinutes(input: FiveMinuteOfferInput): boolean {
  if (input.promisedMinutes == null) return false;
  if (input.started || input.closed || input.restDay) return false;
  return input.nowMinutes >= input.promisedMinutes;
}

/** 지금 어디인가 — 세는 중(set)에는 절대 끊지 않는다. */
export type FiveMinuteBoundary = 'set' | 'rest' | 'between';

export interface FiveMinuteAskInput {
  /** 멈춘 시간을 뺀, 움직인 초 */
  activeSeconds: number;
  /** 이미 물었는가 — 한 번만 묻는다 */
  asked: boolean;
  boundary: FiveMinuteBoundary;
}

/**
 * "5분 됐습니다. 계속할까요?"를 지금 물을 것인가.
 *
 * 5분이 찬 그 초에 묻지 않는다. 세트 한가운데에서 말을 걸면 바벨을 든 채로
 * 대답해야 한다. 쉬는 중이거나 세트와 세트 사이에서만.
 */
export function askToContinue(input: FiveMinuteAskInput): boolean {
  if (input.asked) return false;
  if (input.boundary === 'set') return false;
  return input.activeSeconds >= FIVE_MINUTE_SECONDS;
}

/** 움직인 시간을 더한다. 멈춰 있었으면 그대로, 화면 밖에서 건너뛴 큰 틈은 상한까지만. */
export function addActive(activeMs: number, gapMs: number, running: boolean): number {
  if (!running || !(gapMs > 0)) return activeMs;
  return activeMs + Math.min(gapMs, ACTIVE_TICK_CAP_MS);
}

/** 여기서 끝냈을 때 — 짧게 한 날(시즌 점수 절반)인가, 그냥 닫는가. */
export type FiveMinuteEnd = 'short' | 'none';

/**
 * 5분에서 끝냈을 때 무엇으로 세는가.
 *
 * 본 세트가 하나라도 있으면 짧게 한 날이다 — 이번 주 나온 날로 세고, 시즌 점수는
 * 짧은 날 몫(season.ts의 SHORT_SESSION_SHARE)만큼. 몸 풀기 · 워밍업만 하고 끝냈으면
 * 아무것도 세지 않는다. 깎지도 않는다 — 나왔다가 그냥 들어간 날은 벌받을 날이 아니다.
 */
export function fiveMinuteEnd(sets: readonly { warmup?: boolean; reps: number }[]): FiveMinuteEnd {
  return sets.some((set) => !set.warmup && set.reps > 0) ? 'short' : 'none';
}

/** 끝낸 화면 한 줄 — "실패"라고 하지 않는다. */
export function fiveMinuteDoneLine(end: FiveMinuteEnd, workSets: number): string {
  if (end === 'short') {
    return `오늘은 ${workSets}세트로 마쳤습니다. 짧게 한 날로 이번 주 기록에 들어갑니다.`;
  }
  return '오늘은 몸만 풀었습니다. 시작한 것만으로도 다음이 쉬워집니다.';
}

/** 5분이 됐을 때 코치가 묻는 말. */
export function fiveMinuteAskLine(style: CoachStyle): string {
  const lines: Record<CoachStyle, string> = {
    energetic: '5분 됐어요! 계속할까요?',
    gentle: '5분 됐습니다. 계속할까요?',
    tough: '5분 됐다. 계속할까?',
    fun: '5분 됐어요. 내친김에 계속할까요?',
  };
  return lines[style];
}
