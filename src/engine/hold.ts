import { isTimed } from './exercises.ts';
import type { CoachStyle } from './coach.ts';
import type { LoadPrescription, LoadRule, RepRange } from './load.ts';
import type { Cue } from './tempo.ts';
import type { Exercise, SetLog, TrainingLevel } from './types.ts';

/**
 * 버티는 종목(플랭크 · 사이드 플랭크) — 몇 회가 아니라 몇 초.
 *
 * 예전에는 세트 기록이 횟수뿐이라 플랭크를 "15회"로 적어야 했고, 그래서 프로그램이 플랭크를 거의 넣지
 * 않았다. 매트 하나뿐인 초보의 상체 날이 두 종목으로 끝난 이유 중 하나다. 이제 종목에 measure: 'seconds'를
 * 달면 처방 범위(repRange)와 기록(SetLog.reps)이 둘 다 초다 — 기록 모양은 그대로라 동기화 · 백업이 안 바뀐다.
 *
 * 진행은 반복 종목과 같은 이중 진행이다. 모든 세트가 범위 위 끝을 채우면 5초(넉넉히 넘겼으면 10초) 늘린다.
 * 기록에 그날의 목표가 남지 않으니, 지난번 목표 위 끝은 "가장 오래 버틴 세트를 5초 단위로 올린 값"으로 읽는다
 * — 앱이 목표 초에서 타이머를 멈추므로 다 버틴 날은 그 값이 곧 목표다.
 */

/** 처음 처방 — 초보 20~30초, 중급 30~45초, 상급 40~60초 */
export const HOLD_RANGES: Readonly<Record<TrainingLevel, RepRange>> = {
  beginner: { min: 20, max: 30 },
  intermediate: { min: 30, max: 45 },
  advanced: { min: 40, max: 60 },
  expert: { min: 40, max: 60 },
};

/** 한 번에 늘리는 초 · 이보다 길게는 늘리지 않고 더 어렵게 한다 */
export const HOLD_STEP = 5;
export const HOLD_CAP_SECONDS = 90;

export function holdRange(level: TrainingLevel = 'intermediate'): RepRange {
  return { ...(HOLD_RANGES[level] ?? HOLD_RANGES.intermediate) };
}

/** 반복 범위로 적힌 자리를 버티는 범위로 — 대체 · 내 루틴에서 "10~15회"가 플랭크로 오면 */
export function holdRangeFrom(range: RepRange | undefined, level?: TrainingLevel): RepRange {
  if (range && range.min >= 10 && range.max >= 15 && range.max <= HOLD_CAP_SECONDS) return range;
  return holdRange(level);
}

/** 더 오래 버티기보다 더 어렵게 — 90초를 넘기는 플랭크는 시간만 잡아먹는다 */
const HARDER: Record<string, string> = {
  plank: '한 다리를 바닥에서 살짝 든 채 버티는 플랭크로',
  'side-plank': '위쪽 다리를 들고 버티는 사이드 플랭크로',
};
/** 목표 아래로 끝났을 때 쉽게 하는 법 — 뒤에 "해 보세요"가 붙는다 */
const EASIER: Record<string, string> = {
  plank: '무릎을 바닥에 대고',
  'side-plank': '아래쪽 무릎을 바닥에 대고',
};

const up5 = (value: number) => Math.ceil(value / HOLD_STEP - 1e-9) * HOLD_STEP;
const down5 = (value: number) => Math.floor(value / HOLD_STEP + 1e-9) * HOLD_STEP;

/** 버틴 세트(초가 0보다 큰 본세트) — 무거운 세트 · 워밍업은 버티는 종목에 없지만 걸러 둔다 */
function heldSets(exercise: Exercise, sets: readonly SetLog[] | undefined): SetLog[] {
  return (sets ?? []).filter((set) => set.exerciseId === exercise.id && !set.warmup && !set.top && set.reps > 0);
}

/**
 * 버티는 종목의 다음 처방. weightKg는 늘 0(맨몸)이고 targetReps가 초다.
 *   · 처음 — 프로그램 범위(초보 20~30초)
 *   · 모든 세트가 위 끝을 채움 — 5초(위 끝보다 5초 넘게 버텼으면 10초) 늘린다. 90초에 닿으면 더 어렵게.
 *   · 가장 잘된 세트도 아래 끝에 못 미침 — 되는 만큼 + 쉽게 하는 법
 *   · 그 사이 — 같은 위 끝을 다시
 */
export function prescribeHold(exercise: Exercise, lastSession: readonly SetLog[] | undefined, rule: LoadRule): LoadPrescription {
  const range = rule.repRange;
  const base = { exerciseId: exercise.id, targetRir: rule.targetRir, weightKg: 0, deltaKg: 0 };
  const width = Math.max(HOLD_STEP, range.max - range.min);
  const held = heldSets(exercise, lastSession);
  if (held.length === 0) {
    return {
      ...base,
      targetReps: range,
      change: 'start',
      reason: `처음 버티는 종목입니다. ${range.min}~${range.max}초를 바른 자세로 버티세요 — 자세가 무너지면 그 자리에서 멈추고 버틴 초를 적습니다.`,
    };
  }
  const best = Math.max(...held.map((set) => set.reps));
  const fewest = Math.min(...held.map((set) => set.reps));
  const top = Math.min(HOLD_CAP_SECONDS, Math.max(range.max, up5(best)));
  const sets = held.length > 1 ? `${held.length}세트 모두 ` : '';

  if (fewest >= top) {
    if (top >= HOLD_CAP_SECONDS) {
      const harder = HARDER[exercise.id];
      return {
        ...base,
        targetReps: { min: HOLD_CAP_SECONDS - width, max: HOLD_CAP_SECONDS },
        change: 'hold',
        reason: `${sets}${top}초를 버텼습니다. 더 길게 버티기보다 더 어렵게 하세요` + (harder ? ` — ${harder}.` : '.'),
      };
    }
    const jump = fewest >= top + HOLD_STEP ? HOLD_STEP * 2 : HOLD_STEP;
    const next = Math.min(HOLD_CAP_SECONDS, top + jump);
    return {
      ...base,
      targetReps: { min: next - width, max: next },
      change: 'hold',
      reason: `${sets}${top}초를 다 버텼습니다. 다음에는 ${next - top}초 늘려 ${next}초까지 버팁니다.`,
    };
  }

  if (best < range.min) {
    const easier = EASIER[exercise.id];
    return {
      ...base,
      targetReps: { min: Math.max(HOLD_STEP, down5(best)), max: range.max },
      change: 'hold',
      reason: `${best}초 — 목표 아래 끝(${range.min}초)에 못 미쳤습니다. 되는 만큼 버티고` +
        (easier ? `, 힘들면 ${easier} 해 보세요.` : ', 조금씩 늘려 가세요.'),
    };
  }

  return {
    ...base,
    targetReps: { min: Math.max(range.min, top - width), max: top },
    change: 'hold',
    reason: `같은 자세로 ${top}초까지 버텨 봅니다.`,
  };
}

/* ── PT가 세는 버티기 ───────────────────────────── */

type ByStyle<T> = Record<CoachStyle, T>;

/** 버티기를 시작할 때 — "시작" 대신 */
const START: ByStyle<(seconds: number) => string> = {
  energetic: (s) => `${s}초 버티기, 시작!`,
  gentle: (s) => `${s}초 버티겠습니다. 시작하세요.`,
  tough: (s) => `${s}초. 버텨. 시작!`,
  fun: (s) => `${s}초 버티기 시작! 지금부터 바닥이랑 눈싸움이에요.`,
};
/** 절반 */
const HALF: ByStyle<string> = {
  energetic: '절반 왔어요! 그대로!',
  gentle: '절반 지났습니다. 숨 쉬면서 그대로 버티세요.',
  tough: '반 왔다. 몸 일자로.',
  fun: '반 왔어요! 남은 반은 덤이에요.',
};
/** 끝나기 5초 전 — 뒤로 넷 · 셋 · 둘 · 하나를 센다 */
const LAST_FIVE: ByStyle<string> = {
  energetic: '5초 남았어요! 끝까지!',
  gentle: '5초 남았습니다.',
  tough: '5초 남았다. 버텨!',
  fun: '5초만 더! 금방이에요.',
};
/** 다 버텼을 때 */
const END: ByStyle<string> = {
  energetic: '끝! 잘 버텼어요!',
  gentle: '끝입니다. 천천히 내려오세요.',
  tough: '끝. 잘 버텼어.',
  fun: '끝! 이제 바닥이랑 화해해도 돼요.',
};
/** 마지막 4초를 뒤로 센다 */
const COUNTDOWN = ['하나', '둘', '셋', '넷'];

export function holdStartLine(style: CoachStyle, seconds: number): string {
  return (START[style] ?? START.gentle)(Math.max(1, Math.round(seconds)));
}
export function holdHalfLine(style: CoachStyle): string {
  return HALF[style] ?? HALF.gentle;
}
export function holdLastFiveLine(style: CoachStyle): string {
  return LAST_FIVE[style] ?? LAST_FIVE.gentle;
}
export function holdEndLine(style: CoachStyle): string {
  return END[style] ?? END.gentle;
}
/** 끝나기 n초 전(1~4)에 세는 말 */
export function holdCountdownWord(secondsLeft: number): string {
  return COUNTDOWN[Math.max(1, Math.min(4, Math.round(secondsLeft))) - 1]!;
}

export interface HoldCueInput {
  /** 버틸 초 — 처방 위 끝 */
  seconds: number;
  /** 시작 전 준비 시간 — 이 시점에 시작 말(holdStartLine)을 한다 */
  leadInSeconds?: number;
  style: CoachStyle;
}

/**
 * 버티기 하나를 세는 대본 — buildCues와 같은 모양(rep = 그때까지 버틴 초).
 *
 * 말이 많으면 안 된다. 시작(앱이 준비가 끝나는 자리에서 holdStartLine을 말한다), 절반, 5초 전과
 * 넷 · 셋 · 둘 · 하나, 그리고 "끝". 그 사이 화면 숫자는 앱이 초마다 줄인다.
 */
export function buildHoldCues(input: HoldCueInput): Cue[] {
  const seconds = Math.max(1, Math.round(input.seconds));
  const lead = Math.max(0, input.leadInSeconds ?? 3);
  const at = (elapsed: number) => Math.round((lead + elapsed) * 1000);
  const cues: Cue[] = [{ atMs: 0, say: holdStartLine(input.style, seconds), rep: 0 }];
  const half = Math.round(seconds / 2);
  // 짧은 버티기(15초 아래)는 절반을 말하지 않는다 — 5초 전 말과 붙어 버린다
  if (seconds >= 16) cues.push({ atMs: at(half), say: holdHalfLine(input.style), rep: half });
  if (seconds >= 10) {
    cues.push({ atMs: at(seconds - 5), say: holdLastFiveLine(input.style), rep: seconds - 5 });
    for (let left = 4; left >= 1; left -= 1) cues.push({ atMs: at(seconds - left), say: holdCountdownWord(left), rep: seconds - left });
  }
  cues.push({ atMs: at(seconds), say: holdEndLine(input.style), rep: seconds });
  return cues;
}

/** 버티기 하나에 걸리는 시간(준비 포함) — 시간 예산용 */
export function holdSetSeconds(seconds: number, leadInSeconds = 3): number {
  return Math.max(0, leadInSeconds) + Math.max(1, Math.round(seconds));
}

/* ── 세트 앞뒤 말 ──────────────────────────────── */

/** 버티는 세트 앞의 각오 — "목표 개수"가 아니라 자세 · 숨. 끝까지 밀지 않는 날에도 그대로 쓸 수 있는 말만 */
export const HOLD_RESOLVE: ByStyle<readonly string[]> = {
  tough: ['몸 일자로. 그대로 버텨.', '흔들리지 마. 버티는 거야.'],
  energetic: ['몸 일자로, 그대로 버텨 봐요!', '숨 쉬면서, 버텨 봐요!'],
  gentle: ['숨은 편하게 쉬면서 버티세요.', '몸을 일자로 두고 천천히 버텨 보시죠.'],
  fun: ['지금부터 인간 다리미판이에요. 판판하게!', '숨은 쉬어도 돼요. 버티기만 하면 돼요!'],
};
/** 버티는 종목의 중간 세트 한마디 */
export const HOLD_MIDDLE: ByStyle<readonly string[]> = {
  tough: ['방금처럼. 허리 처지지 마.', '숨 참지 말고 버텨.'],
  energetic: ['방금처럼 그대로 가요!', '숨 쉬면서 버텨요!'],
  gentle: ['방금처럼만 버티시면 됩니다.', '숨은 계속 쉬세요.'],
  fun: ['방금처럼요. 복사, 붙여넣기!', '숨 참으면 얼굴 토마토 돼요. 쉬면서!'],
};

/** 버티기 세트 뒤 — 다음 세트로 갈 때. "같은 무게로"가 아니다 */
export const HOLD_NEXT: ByStyle<readonly string[]> = {
  tough: ['한 세트 더 버틴다. 몸 일자로.', '좋아. 한 번 더 버텨.'],
  energetic: ['좋아요! 한 세트 더 버텨 봐요!', '방금처럼 한 번 더 버텨요!'],
  gentle: ['좋습니다. 한 세트 더 버텨 보시죠.', '방금처럼 한 번 더 버티시면 됩니다.'],
  fun: ['한 세트 더! 바닥이랑 2라운드예요.', '방금처럼 한 번 더! 판판하게요.'],
};

/** "20에서 30초" · "30초" — 세트 앞에 말하는 목표 */
export function holdWords(min: number, max: number): string {
  return min === max ? `${max}초` : `${min}에서 ${max}초`;
}

const FEEDBACK_TOP: ByStyle<(seconds: number) => string> = {
  tough: (s) => `${s}초, 다 버텼다. 좋아.`,
  energetic: (s) => `${s}초 다 버텼어요! 최고예요!`,
  gentle: (s) => `${s}초 다 버티셨습니다. 아주 좋았습니다.`,
  fun: (s) => `${s}초 완주! 바닥이 졌어요.`,
};
const FEEDBACK_IN: ByStyle<(seconds: number) => string> = {
  tough: (s) => `${s}초. 목표 안이다. 잘 버텼어.`,
  energetic: (s) => `${s}초! 목표 안에 들어왔어요!`,
  gentle: (s) => `${s}초, 목표 안에 잘 들어왔습니다.`,
  fun: (s) => `${s}초, 목표 안이에요. 합격!`,
};
const FEEDBACK_SHORT: ByStyle<(seconds: number) => string> = {
  tough: (s) => `${s}초. 다음엔 자세 지키면서 조금만 더.`,
  energetic: (s) => `${s}초! 다음 세트는 자세 지키면서 조금만 더 가 봐요!`,
  gentle: (s) => `${s}초 버티셨습니다. 다음 세트는 자세를 지키면서 되는 만큼만 하세요.`,
  fun: (s) => `${s}초. 오늘 바닥이 좀 셌네요. 다음엔 자세만 챙겨요.`,
};

/** 쉬는 동안 방금 버티기 이야기 */
export function holdFeedbackLine(style: CoachStyle, input: { seconds: number; min: number; max: number }): string {
  const s = Math.max(0, Math.round(input.seconds));
  if (s >= input.max) return (FEEDBACK_TOP[style] ?? FEEDBACK_TOP.gentle)(s);
  if (s >= input.min) return (FEEDBACK_IN[style] ?? FEEDBACK_IN.gentle)(s);
  return (FEEDBACK_SHORT[style] ?? FEEDBACK_SHORT.gentle)(s);
}

