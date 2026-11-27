/**
 * 알림에서 한 번에 시작하기.
 *
 * 약속 시각에 알림이 왔다. 누르면 앱이 열리고 — 지금까지는 오늘 목록이 떴다.
 * 거기서 "운동 시작"을 또 눌러야 했고, 그 한 번 사이에 마음이 바뀐다.
 * 알림을 누른 것 자체가 "하겠다"는 뜻이니, 곧장 오늘 운동으로 들어간다.
 *
 * 단, **들어가면 안 되는 날**이 있다. 그날은 늘 열던 오늘 화면을 연다.
 *
 *   · 쉬는 날(이번 주를 다 채웠다) — 알림이 운동을 시키면 안 된다
 *   · 오늘을 이미 마쳤다 — 끝난 운동을 다시 시작하면 기록이 꼬인다
 *   · 아프다고 적었다(또는 지난번 통증을 아직 안 물어봤다) — 오늘 할 운동이
 *     바뀌는 날이다. 사람이 먼저 보고 정해야 한다
 */

/** 알림 · 앱 아이콘 바로 가기가 붙여 여는 주소 조각. sw.js · manifest가 같은 글자를 쓴다. */
export const QUICK_START_PARAM = 'go=start';

export type QuickStartRoute =
  /** 오늘 화면을 그냥 연다 */
  | 'today'
  /** 이미 운동 중이다 — 그 화면으로 돌아간다 */
  | 'resume'
  /** PT로 시작한다 */
  | 'pt'
  /** 혼자 운동 화면으로 시작한다(PT를 꺼 둔 사람) */
  | 'solo';

export interface QuickStartInput {
  /** 오늘 할 운동이 있는가 */
  hasPlan: boolean;
  restDay: boolean;
  closed: boolean;
  /** 오늘 아프다고 적었거나, 지난번 통증을 아직 물어보지 않았다 */
  pain: boolean;
  /** 이미 시작해서 운동 중이다 */
  started: boolean;
  /** PT 모드인가 */
  pt: boolean;
}

export function quickStartRoute(input: QuickStartInput): QuickStartRoute {
  if (!input.hasPlan || input.restDay || input.closed || input.pain) return 'today';
  if (input.started) return 'resume';
  return input.pt ? 'pt' : 'solo';
}

/**
 * 시작 단추를 한 번 눌러야 하는가.
 *
 * 아이폰은 사람이 화면을 누른 순간에만 소리를 연다. 알림으로 열린 앱은 아직 아무도
 * 누르지 않았으니 PT가 말을 해도 소리가 안 난다 — 코치가 소리 없이 세면 사람은
 * 고장 난 줄 안다. 그때만 큰 "▶ 시작" 하나를 띄우고, 그 누름을 소리를 여는 손길로 쓴다.
 */
export function needsTapToStart(route: QuickStartRoute, audioLocked: boolean): boolean {
  return route === 'pt' && audioLocked;
}

/** 주소에 바로 시작이 붙어 있는가 — "?go=start" · "?tab=today&go=start" */
export function wantsQuickStart(search: string): boolean {
  return /[?&]go=start(?:&|$)/.test(search);
}
