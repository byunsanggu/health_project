/**
 * 아이폰 잠금 화면의 휴식 끝 — 푸시 알림으로.
 *
 * 아이폰은 화면을 잠근 채 웹앱이 소리를 내려면 `<audio>`로 틀어야 하고, 그러면 듣던 음악(애플 뮤직 ·
 * 스포티파이)이 멈춘다. 시스템 알림의 소리와 애플워치 진동은 음악을 멈추지 않는다. 그런데 웹앱은 알림을
 * 스스로 예약할 수 없어서, 휴식이 끝나는 순간에 서버(functions/rest-alarm)가 푸시를 쏜다.
 *
 * 나누는 원칙
 *   · 서버와 푸시에는 **시각과 아무 뜻 없는 알람 번호만** 간다. 종목 · 무게 · 세트는 안 간다.
 *   · "휴식 끝 · 2세트 시작" 같은 문장은 폰 안에서 만든다(restAlarmCopy). 앱이 화면이 꺼지기 직전에
 *     폰에 적어 두고, 푸시가 오면 서비스 워커가 읽어 띄운다.
 *
 * 여기에는 그 두 쪽이 쓰는 규칙만 있다 — 시각 · 문장 · 서버가 기다리는 방법.
 */

/** 이보다 먼 휴식은 알림으로 걸지 않는다. 서버도 같은 값으로 막는다. */
export const REST_ALARM_MAX_AHEAD_MS = 15 * 60 * 1000;

/** 푸시를 걸 만큼 남았는가 — 이보다 짧으면 알림이 오기 전에 휴식이 끝난다. */
export const REST_ALARM_MIN_AHEAD_MS = 2000;

/** 폰에 적어 둔 문장이 없을 때 서비스 워커가 띄우는 말. */
export const REST_ALARM_FALLBACK = { title: '휴식 끝', body: '다음 세트를 시작하세요' } as const;

export interface RestAlarmPlan {
  /** 휴식이 끝나는 시각(ms). 서버에 이것만 간다. */
  sendAt: number;
}

/**
 * 지금(now) 화면이 꺼지는데 휴식이 endsAt에 끝난다 — 알림을 걸 수 있으면 그 시각, 아니면 null.
 * 이미 끝났거나 곧 끝나는 휴식, 15분보다 먼 휴식(시계가 틀어진 기록)은 걸지 않는다.
 */
export function planRestAlarm(input: { now: number; endsAt: number }): RestAlarmPlan | null {
  const { now, endsAt } = input;
  if (!Number.isFinite(now) || !Number.isFinite(endsAt)) return null;
  const ahead = endsAt - now;
  if (ahead < REST_ALARM_MIN_AHEAD_MS || ahead > REST_ALARM_MAX_AHEAD_MS) return null;
  return { sendAt: Math.round(endsAt) };
}

export interface RestAlarmCopyInput {
  /** 쉬고 나서 할 것 — 휴식 막대의 "쉬고 → 3세트"와 같은 말("3세트" · "랫풀다운 2세트" · "스쿼트" · "마무리"). */
  next: string;
  /** 방금 한 종목. 다음이 같은 종목의 세트면 본문에 붙인다. */
  exerciseName?: string;
  /** PT가 화면에 보여 주는 다음 세트 한 줄(종목 · 무게 · 횟수). 있으면 본문으로 쓴다. */
  detail?: string;
  /** PT 모드 — 앱을 열면 PT가 이어서 센다고 덧붙인다. */
  pt?: boolean;
}

function clip(text: string, max: number): string {
  const chars = Array.from(text);
  return chars.length <= max ? text : chars.slice(0, max - 1).join('') + '…';
}

/**
 * 잠금 화면 · 손목에 뜨는 말. 시계 화면은 좁으니 제목에 다음에 할 것을 둔다 — "휴식 끝 · 2세트 시작".
 * 본문은 한 줄 더 — 어느 종목인지, PT면 열면 이어서 센다는 것.
 */
export function restAlarmCopy(input: RestAlarmCopyInput): { title: string; body: string } {
  const next = (input.next || '').trim();
  if (!next) return { ...REST_ALARM_FALLBACK };
  const name = (input.exerciseName || '').trim();
  const finishing = next === '마무리';
  const title = finishing ? '휴식 끝 · 마무리' : `휴식 끝 · ${next} 시작`;
  let body: string;
  if (input.detail && input.detail.trim()) body = input.detail.trim();
  else if (/^\d+세트$/.test(next)) body = name ? `${name} ${next}` : '다음 세트를 시작하세요';
  else if (/\d+세트$/.test(next)) body = '다음 세트를 시작하세요';
  else if (finishing) body = '오늘 운동을 마무리하세요';
  else body = '다음 종목으로 넘어가세요';
  if (input.pt) body += ' · 앱을 열면 PT가 이어서 셉니다';
  return { title: clip(title, 40), body: clip(body, 120) };
}

/* ── 서버가 기다리는 방법 ─────────────────────────────────────
 *
 * Edge Function은 한 번 불리면 오래 못 산다(무료 요금제는 약 150초). 휴식은 길면 5분이 넘는다. 그래서
 * 110초쯤 기다리다 남았으면 자기 자신을 다시 부르고(chain) 끝난다 — 이어 불린 쪽이 또 기다린다.
 * 기다리는 동안에도 몇 초마다 표를 확인해서, 앱이 취소했으면(화면으로 돌아왔다) 바로 그만둔다.
 *
 * functions/rest-alarm/index.ts에 이 함수가 글자 그대로 들어 있다(대시보드에 파일 하나로 붙여 넣으므로
 * 가져다 쓰지 못한다). 둘이 같은지는 테스트가 본다 — 고치면 둘 다 고친다.
 */
// <alarm-step>
export interface AlarmStepInput {
  now: number;
  sendAt: number;
  /** 이번 호출이 시작된 시각 */
  startedAt: number;
  /** 한 호출이 기다려도 되는 시간 */
  budgetMs: number;
  /** 이만큼마다 깨어 취소됐는지 본다 */
  pollMs: number;
  /** 푸시가 폰까지 가는 데 걸리는 만큼 일찍 쏜다 */
  leadMs: number;
}

export type AlarmStep =
  | { action: 'send' }
  | { action: 'sleep'; ms: number }
  | { action: 'chain' };

export function alarmStep(input: AlarmStepInput): AlarmStep {
  const fireAt = input.sendAt - input.leadMs;
  const left = fireAt - input.now;
  if (left <= 0) return { action: 'send' };
  const budgetLeft = input.budgetMs - (input.now - input.startedAt);
  if (budgetLeft <= 0) return { action: 'chain' };
  return { action: 'sleep', ms: Math.max(1, Math.min(left, input.pollMs, budgetLeft)) };
}
// </alarm-step>
