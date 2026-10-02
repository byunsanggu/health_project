/**
 * 약속.
 *
 * "주 4회"는 지켜지지 않는다. **"화요일 저녁 7시"는 지켜진다.**
 *
 * 현장에서도 그렇다. "일주일에 네 번 나오세요"라고 하면 안 나오고,
 * "화·목·토 저녁 7시에 뵐게요"라고 하면 나온다. 사람은 횟수를 지키는 게
 * 아니라 **자리에 가는 것**이기 때문이다.
 *
 * 이 모듈이 바꾸는 것은 셋이다.
 *
 *   1. 막연한 횟수를 **요일 + 시각**으로 바꾼다.
 *   2. 알림이 짐작이 아니라 약속이 된다 — "늘 이쯤 가시던데요"가 아니라
 *      "오늘 7시에 가기로 하셨습니다".
 *   3. 화면이 다음 자리를 가리킨다. 끝난 이야기보다 다음 약속이 남는다.
 *
 * **개수는 프로그램을 따른다.** 주 4회짜리 프로그램에 약속을 셋만 잡게
 * 두면, 볼륨 계산은 넷으로 하면서 사람에게는 셋을 약속받는 꼴이 된다.
 * 덜 나오고 싶으면 프로그램을 바꾸는 것이 맞다.
 */
import { WEEKDAY_LABELS_KO, type Weekday } from './schedule.ts';

/** 자정부터 몇 분인가. 19:00이면 1140. */
export interface PromiseSlot {
  weekday: Weekday;
  minutes: number;
}

/**
 * 기본 시각.
 *
 * 평일 저녁 7시, 주말 오전 10시. 한국에서 퇴근 뒤와 주말 아침이 제일
 * 흔한 자리다. 빈칸으로 두고 고르라고 하면 아무도 안 고른다 — 바꾸기
 * 쉬운 기본값이 빈칸보다 낫다.
 */
export const DEFAULT_WEEKDAY_MINUTES = 19 * 60;
export const DEFAULT_WEEKEND_MINUTES = 10 * 60;

/** 약속보다 이만큼 전에 부른다. 지금 나서야 늦지 않는 시간이다. */
export const LEAD_MINUTES = 60;

/** 고를 수 있는 시각 — 30분 간격, 새벽 5시부터 밤 10시까지. */
export const EARLIEST_MINUTES = 5 * 60;
export const LATEST_MINUTES = 22 * 60;
export const STEP_MINUTES = 30;

export function minutesLabel(minutes: number): string {
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  return String(hour).padStart(2, '0') + ':' + String(minute).padStart(2, '0');
}

export function slotLabel(slot: PromiseSlot): string {
  return (WEEKDAY_LABELS_KO[slot.weekday] ?? '?') + ' ' + minutesLabel(slot.minutes);
}

export function isWeekend(weekday: Weekday): boolean {
  return weekday === 5 || weekday === 6;
}

/** 프로그램이 고른 요일에 기본 시각을 붙인다. */
export function defaultSlots(weekdays: readonly Weekday[]): PromiseSlot[] {
  return [...weekdays].sort((a, b) => a - b).map((weekday) => ({
    weekday,
    minutes: isWeekend(weekday) ? DEFAULT_WEEKEND_MINUTES : DEFAULT_WEEKDAY_MINUTES,
  }));
}

/** 고를 수 있는 시각 목록. */
export function timeChoices(): number[] {
  const out: number[] = [];
  for (let m = EARLIEST_MINUTES; m <= LATEST_MINUTES; m += STEP_MINUTES) out.push(m);
  return out;
}

export function clampMinutes(minutes: number): number {
  const stepped = Math.round(minutes / STEP_MINUTES) * STEP_MINUTES;
  return Math.min(LATEST_MINUTES, Math.max(EARLIEST_MINUTES, stepped));
}

export function sortSlots(slots: readonly PromiseSlot[]): PromiseSlot[] {
  return [...slots].sort((a, b) => a.weekday - b.weekday || a.minutes - b.minutes);
}

/** "화 19:00 · 목 19:00 · 토 10:00" */
export function promiseSummary(slots: readonly PromiseSlot[]): string {
  return sortSlots(slots).map(slotLabel).join(' · ');
}

export interface NextSlot {
  slot: PromiseSlot;
  /** 오늘부터 며칠 뒤인가. 오늘이면 0 */
  daysAhead: number;
  /** 지금부터 몇 분 뒤인가 */
  minutesAway: number;
}

/**
 * 다음 약속.
 *
 * **오늘 것이 이미 지났으면 다음 주 같은 요일이 아니라 다음 약속으로
 * 넘어간다.** 화요일 저녁 8시에 앱을 연 사람에게 "화요일 7시"를 가리키면
 * 이미 지난 시각을 약속이라고 하는 것이다.
 */
export function nextSlot(
  slots: readonly PromiseSlot[],
  todayWeekday: Weekday,
  nowMinutes: number,
): NextSlot | null {
  if (slots.length === 0) return null;

  let best: NextSlot | null = null;
  for (const slot of slots) {
    let daysAhead = (slot.weekday - todayWeekday + 7) % 7;
    // 오늘인데 이미 지났으면 일주일 뒤다.
    if (daysAhead === 0 && slot.minutes <= nowMinutes) daysAhead = 7;
    const minutesAway = daysAhead * 24 * 60 + (slot.minutes - nowMinutes);
    if (!best || minutesAway < best.minutesAway) best = { slot, daysAhead, minutesAway };
  }
  return best;
}

/**
 * 다음 약속을 한 줄로.
 *
 * 재촉하지 않는다. "안 가면 어떻게 된다"가 아니라 언제 어디인지만 말한다 —
 * 약속은 지키라고 있는 것이지 겁주라고 있는 것이 아니다.
 */
export function nextSlotLine(next: NextSlot | null): string {
  if (!next) return '';
  const time = minutesLabel(next.slot.minutes);
  if (next.daysAhead === 0) return `오늘 ${time}에 가기로 하셨습니다`;
  if (next.daysAhead === 1) return `내일 ${time}에 가기로 하셨습니다`;
  return `다음은 ${WEEKDAY_LABELS_KO[next.slot.weekday]}요일 ${time}입니다`;
}

/**
 * 다음 약속을 짧게. "목 19:00"
 *
 * nextSlotLine은 그 자체로 한 줄짜리 문장이라 다른 말에 붙이면 길어진다.
 * 예고 머리줄처럼 뒤에 날 이름이 더 붙는 자리에는 시각만 있으면 된다.
 */
export function nextSlotShort(next: NextSlot | null): string {
  if (!next) return '';
  const time = minutesLabel(next.slot.minutes);
  if (next.daysAhead === 0) return `오늘 ${time}`;
  if (next.daysAhead === 1) return `내일 ${time}`;
  return `${WEEKDAY_LABELS_KO[next.slot.weekday]} ${time}`;
}

/**
 * 알림이 울릴 시각 — 약속 한 시간 전.
 *
 * 약속이 있으면 알림은 짐작이 아니다. 늘 가던 시각의 중앙값으로 때를
 * 맞추던 것(nudge.ts)과 달리, 그 사람이 직접 정한 자리를 가리킨다.
 */
export function leadMinutesFor(slot: PromiseSlot): number {
  const at = slot.minutes - LEAD_MINUTES;
  // 새벽에 깨우지 않는다. 6시 전으로는 당기지 않는다.
  return Math.max(6 * 60, at);
}
