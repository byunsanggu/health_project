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

    out.push({
      budgetMinutes: budget,
      actualMinutes: Math.max(1, Math.round(fit.afterSeconds / 60)),
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
