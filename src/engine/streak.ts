import type { SessionLog } from './types.ts';

/**
 * 약속을 지킨 주.
 *
 * 습관 앱들은 "며칠 연속"을 센다. 운동에 그걸 그대로 붙이면 사람이
 * 다친다 — 불을 끄지 않으려고 쉬는 날 나오고, 회복이 안 되면 안 자라고,
 * 결국 다치거나 그만둔다. 트레이너가 20년 동안 말려 온 그 행동을 앱이
 * 부추기는 꼴이다.
 *
 * 그래서 세는 단위가 다르다. **날이 아니라 주**이고, 기준은 "매일 했나"가
 * 아니라 **"이번 주에 하기로 한 횟수를 지켰나"**다. 쉬는 날은 약속에 이미
 * 들어 있으므로 쉬어도 불이 안 꺼진다. 죄책감 없이 쉴 수 있어야 다음 주에
 * 앱을 다시 연다.
 *
 * 그리고 "7주 연속"은 "37일 연속"보다 말하기 좋다.
 */

export interface WeekResult {
  /** 그 주의 월요일 (YYYY-MM-DD) */
  weekStart: string;
  /** 그 주에 운동한 날 수 */
  days: number;
  /** 그 주에 하기로 한 횟수 */
  target: number;
  /** 덜어내는 주였는가 */
  deload: boolean;
  /** 약속을 지켰는가 */
  kept: boolean;
  /** 쉼표로 살린 주인가 */
  forgiven: boolean;
  /** 아직 안 끝난 주인가 */
  open: boolean;
}

export interface StreakState {
  /** 연속으로 지킨 주 */
  current: number;
  /** 지금까지 제일 길었던 연속 */
  best: number;
  /** 최근 주부터 */
  weeks: WeekResult[];
  /** 이번 주 (진행 중일 수 있다) */
  thisWeek: WeekResult;
  /** 이번 연속 구간에서 쉼표를 이미 썼는가 */
  freezeUsed: boolean;
  /** 지금 쉼표가 남아 있는가 */
  freezeAvailable: boolean;
  /** 화면에 그대로 쓸 한 줄 */
  message: string;
}

/**
 * 쉼표를 주기 시작하는 지점.
 *
 * 처음부터 주면 약속이 약속이 아니게 된다. 넉 주를 지킨 사람한테만
 * 한 번 준다 — 그 정도 쌓은 사람이 한 주 놓쳤다고 0으로 돌아가면
 * 앱을 지우지, 다음 주에 나오지 않는다.
 */
export const FREEZE_AFTER = 4;

/** 덜어내는 주에 지켜야 하는 최소 횟수. */
export function deloadTarget(target: number): number {
  /*
   * 디로드는 쉬는 주가 아니라 덜어내는 주다. 아예 안 나오면 습관이
   * 끊기므로 절반은 나오게 하되, 두 번 아래로는 내리지 않는다.
   */
  return Math.max(2, Math.ceil(target / 2));
}

export interface StreakInput {
  sessions: readonly SessionLog[];
  /** 이번 주의 월요일 (YYYY-MM-DD) */
  thisMonday: string;
  /** 주 몇 회 하기로 했는가 */
  target: number;
  /** 덜어내는 주였던 월요일들 */
  deloadWeeks?: readonly string[];
  /** 몇 주까지 거슬러 볼 것인가 */
  lookbackWeeks?: number;
  /** 오늘 (YYYY-MM-DD) — 이번 주가 끝났는지 판단한다 */
  today?: string;
}

function shiftDays(date: string, days: number): string {
  const time = Date.parse(date + 'T00:00:00Z');
  if (Number.isNaN(time)) return date;
  return new Date(time + days * 86400000).toISOString().slice(0, 10);
}

function weekOf(input: StreakInput, weekStart: string): WeekResult {
  const weekEnd = shiftDays(weekStart, 6);
  const days = new Set(
    input.sessions
      .filter((session) => session.date >= weekStart && session.date <= weekEnd)
      .filter((session) => session.sets.some((set) => !set.warmup && set.reps > 0))
      .map((session) => session.date),
  ).size;

  const deload = (input.deloadWeeks ?? []).includes(weekStart);
  const target = deload ? deloadTarget(input.target) : input.target;
  const today = input.today ?? input.thisMonday;

  return {
    weekStart,
    days,
    target,
    deload,
    kept: days >= target,
    forgiven: false,
    open: weekStart === input.thisMonday && today <= weekEnd,
  };
}

/**
 * 지금 연속 몇 주인가.
 *
 * 이번 주는 아직 안 끝났으므로 연속을 끊지 않는다. 지켰으면 더하고,
 * 못 지켰어도 시간이 남아 있으면 그대로 둔다.
 */
export function buildStreak(input: StreakInput): StreakState {
  const lookback = Math.max(1, input.lookbackWeeks ?? 26);
  const weeks: WeekResult[] = [];
  for (let i = 0; i < lookback; i += 1) {
    weeks.push(weekOf(input, shiftDays(input.thisMonday, -7 * i)));
  }

  /*
   * 기록이 시작되기 전의 주는 "안 한 주"가 아니라 "없는 주"다. 앱을
   * 깔기 전 주에 쉼표를 써 버리면, 정작 필요할 때 쉼표가 없다.
   */
  const firstDay = input.sessions
    .filter((session) => session.sets.some((set) => !set.warmup && set.reps > 0))
    .map((session) => session.date)
    .sort()[0];

  /*
   * 뒤(최근)에서 앞으로 걸어간다. 빠진 주를 만나면 일단 건너뛰고, 그
   * 앞쪽에 넉 주 넘게 쌓여 있을 때만 쉼표로 인정한다 — 쉼표는 쌓은
   * 사람한테 주는 것이지 아무에게나 주는 것이 아니다.
   */
  let current = 0;
  let beforeGap = 0;
  let gapIndex = -1;
  let freezeUsed = false;

  for (let i = 0; i < weeks.length; i += 1) {
    const week = weeks[i];
    if (!week) break;
    // 기록이 시작되기 전까지 왔으면 거기서 끝이다.
    if (firstDay && shiftDays(week.weekStart, 6) < firstDay) break;

    if (week.kept) {
      current += 1;
      continue;
    }

    // 진행 중인 주는 아직 못 지킨 게 아니다.
    if (week.open) continue;

    if (gapIndex < 0) {
      gapIndex = i;
      beforeGap = current;
      continue;
    }
    break;
  }

  if (gapIndex >= 0) {
    const older = current - beforeGap;
    const gapWeek = weeks[gapIndex];
    if (older >= FREEZE_AFTER && gapWeek) {
      // 살린 주는 연속에 더하지 않는다 — 안 한 주를 한 주로 세면 거짓말이다.
      freezeUsed = true;
      gapWeek.forgiven = true;
    } else {
      current = beforeGap;
    }
  }

  // 최고 기록은 쉼표 없이 순수하게 센다.
  let best = 0;
  let run = 0;
  for (let i = weeks.length - 1; i >= 0; i -= 1) {
    const week = weeks[i];
    if (!week) continue;
    if (week.kept) {
      run += 1;
      if (run > best) best = run;
    } else if (!week.open) {
      run = 0;
    }
  }

  const thisWeek = weeks[0] as WeekResult;

  return {
    current,
    best: Math.max(best, current),
    weeks,
    thisWeek,
    freezeUsed,
    freezeAvailable: !freezeUsed && current >= FREEZE_AFTER,
    message: messageOf(current, thisWeek, freezeUsed),
  };
}

/**
 * 뭐라고 말할 것인가.
 *
 * 숫자를 다시 읽어 주면 안 된다. 지금 어디에 서 있고 무엇이 남았는지를
 * 말해야 한다. 못 지킨 주에 혼내는 말은 넣지 않는다 — 혼나려고 앱을
 * 여는 사람은 없다.
 */
function messageOf(current: number, thisWeek: WeekResult, freezeUsed: boolean): string {
  const left = Math.max(0, thisWeek.target - thisWeek.days);

  if (thisWeek.kept) {
    if (thisWeek.deload) return '덜어내는 주의 약속을 지켰습니다. 이번 주는 이만하면 됩니다.';
    return current >= 2
      ? `${current}주 연속 약속을 지켰습니다.`
      : '이번 주 약속을 지켰습니다.';
  }

  if (thisWeek.open) {
    if (thisWeek.days === 0) {
      if (freezeUsed) {
        return `한 주 쉬었습니다. ${current}주 연속은 그대로 둡니다 — 이번 주에 나오면 이어집니다.`;
      }
      return current > 0
        ? `${current}주 연속입니다. 이번 주 ${thisWeek.target}번 중 아직 0번입니다.`
        : `이번 주 ${thisWeek.target}번이 목표입니다.`;
    }
    if (freezeUsed) {
      return left === 1
        ? '한 주 쉬어서 쉼표를 썼습니다. 한 번만 더 나오면 이어집니다.'
        : `한 주 쉬어서 쉼표를 썼습니다. ${left}번 더 나오면 이어집니다.`;
    }
    return left === 1
      ? '한 번만 더 나오면 이번 주도 지킵니다.'
      : `${left}번 더 나오면 이번 주도 지킵니다.`;
  }

  if (freezeUsed) {
    return '한 주 쉬었습니다. 연속은 그대로 둡니다 — 이번 주에 나오면 이어집니다.';
  }
  return '다시 시작하면 됩니다. 이번 주에 한 번만 나가면 다시 굴러갑니다.';
}

/** 카드에 찍을 점 — 지킨 날은 채우고 남은 횟수는 비운다. */
export function weekDots(week: WeekResult): { done: number; left: number } {
  const done = Math.min(week.days, week.target);
  return { done, left: Math.max(0, week.target - done) };
}
