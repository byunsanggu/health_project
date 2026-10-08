/**
 * PT 모드 — 옆에서 말해 주는 트레이너.
 *
 * 혼자 운동하는 사람이 PT를 받을 때와 가장 다른 점은 무게가 아니라
 * **말**이다. "지난번에 120 10개 하셨어요", "두 개 더", "무게 어땠어요?"
 * 이 세 마디가 없으면 사람은 세트를 대충 끝내고, 지난번 무게를 잊고,
 * 힘든지 가벼운지 아무도 묻지 않는다.
 *
 * 여기서는 그 말만 만든다. **무게와 횟수는 여기서 정하지 않는다.**
 * 처방은 엔진(session · autoregulation)이 이미 정했고, 트레이너는 그것을
 * 어떻게 말하느냐만 다르다. 빡센 트레이너라고 무게를 더 올리면 거기서
 * 사람이 다친다 — 말투가 처방을 바꾸는 순간 이 앱은 위험해진다.
 *
 * 세 말투 모두 **존댓말**이다. 빡세다는 건 반말이 아니라 각오다.
 * "더 할 수 있어요. 오늘이 마지막인 것처럼."
 */
import { weightHistoryFor, type HistoryScope } from './gymWeight.ts';
import { weightLabelIn } from './units.ts';
import type { Exercise, SessionLog } from './types.ts';

/* ── 말투 ──────────────────────────────────────── */

export type CoachStyle = 'calm' | 'fired' | 'data';

export interface CoachStyleInfo {
  id: CoachStyle;
  label: string;
  /** 누구에게 맞는가 — 고를 때 보이는 한 줄 */
  hint: string;
  /** 고를 때 한 번 들려줄 말 */
  sample: string;
}

export const COACH_STYLES: readonly CoachStyleInfo[] = [
  {
    id: 'calm',
    label: '차분하게',
    hint: '처음이거나 운동이 낯선 분께',
    sample: '천천히 해도 괜찮아요. 내릴 때 2초만 지켜 볼게요.',
  },
  {
    id: 'fired',
    label: '빡세게',
    hint: '끌어 줘야 나오는 분께 — 존댓말로 끝까지 밀어 드립니다',
    sample: '더 할 수 있어요. 오늘이 마지막인 것처럼 갑시다.',
  },
  {
    id: 'data',
    label: '숫자로',
    hint: '기록을 보며 하시는 분께',
    sample: '지난번 대비 2.5킬로 증가. 목표 남은 횟수 2.',
  },
];

export function coachStyleInfo(id: CoachStyle): CoachStyleInfo {
  return COACH_STYLES.find((item) => item.id === id) ?? (COACH_STYLES[0] as CoachStyleInfo);
}

/* ── 무게 체감 ─────────────────────────────────── */

/**
 * "몇 회 더 할 수 있었나요?"는 정확하지만 PT가 실제로 묻는 말이 아니다.
 * 트레이너는 **"무게 어땠어요?"**라고 묻는다. 초보는 남은 횟수를 모르지만
 * 가벼웠는지 무거웠는지는 안다.
 *
 * 답은 네 개다. "아픈 데 있어요"를 따로 둔다 — 무거운 것과 아픈 것은
 * 완전히 다른 일인데, 버튼이 셋뿐이면 아픈 사람이 "무거웠어요"를 누른다.
 */
export type Feel = 'light' | 'right' | 'heavy' | 'hurt';

export const FEELS: readonly { id: Feel; label: string }[] = [
  { id: 'light', label: '가벼웠어요' },
  { id: 'right', label: '딱 좋았어요' },
  { id: 'heavy', label: '무거웠어요' },
  { id: 'hurt', label: '아픈 데 있어요' },
];

/**
 * 체감을 남은 횟수(RIR)로 바꾼다.
 *
 * "딱 좋았어요"는 고정된 숫자가 아니라 **그 주의 목표**다. 블록 초반에는
 * 3개 남기는 게 딱 좋은 것이고 후반에는 1개다. 그걸 2로 박아 두면
 * 주차별 강도 설계가 체감 버튼 하나에 지워진다.
 *
 * 아픈 경우는 목표값으로 적는다. 아파서 멈춘 세트로 다음 무게를
 * 올리거나 내리면 안 된다 — 그 세트는 강도에 대해 아무것도 말하지 않는다.
 */
export function feelToRir(feel: Feel, targetRir: number): number {
  const target = Math.max(0, Math.min(4, Math.round(targetRir)));
  if (feel === 'light') return Math.min(4, target + 2);
  if (feel === 'heavy') return Math.max(0, target - 1);
  return target;
}

/* ── 지난번 ────────────────────────────────────── */

export interface LastTime {
  date: string;
  daysAgo: number;
  /** 그날 가장 무거웠던 본세트 */
  weightKg: number;
  reps: number;
  rir: number;
  /** 그날 그 종목 본세트 수 */
  sets: number;
}

function dayDiff(from: string, to: string): number {
  const a = Date.parse(from + 'T00:00:00Z');
  const b = Date.parse(to + 'T00:00:00Z');
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((b - a) / 86400000);
}

/**
 * 이 종목을 마지막으로 한 날의 제일 무거운 세트.
 *
 * 헬스장과 기계를 가려서 본다. 다른 헬스장 레그프레스 200kg을 "지난번"
 * 이라고 말하면 오늘 기계 앞에서 그 숫자는 거짓말이다.
 */
export function lastTimeFor(
  sessions: readonly SessionLog[],
  exercise: Exercise,
  today: string,
  scope: HistoryScope = {},
): LastTime | null {
  const scoped = weightHistoryFor(sessions, exercise, scope)
    .filter((session) => session.date < today)
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

  for (const session of scoped) {
    const working = session.sets.filter(
      (set) => set.exerciseId === exercise.id && !set.warmup && set.reps > 0,
    );
    if (working.length === 0) continue;
    const top = working.reduce((best, set) =>
      set.weightKg > best.weightKg || (set.weightKg === best.weightKg && set.reps > best.reps) ? set : best);
    return {
      date: session.date,
      daysAgo: Math.max(0, dayDiff(session.date, today)),
      weightKg: top.weightKg,
      reps: top.reps,
      rir: top.rir,
      sets: working.length,
    };
  }
  return null;
}

/* ── 늘었다 ────────────────────────────────────── */

export interface Growth {
  daysAgo: number;
  /** 그때 같은 무게로 한 횟수 */
  thenReps: number;
  /** 오늘 한 횟수 */
  nowReps: number;
}

/** 일주일보다 가까우면 성장이 아니라 그날 컨디션이다. */
export const GROWTH_MIN_DAYS = 7;
/** 두 달보다 멀면 기억에 없는 날이라 와닿지 않는다. */
export const GROWTH_MAX_DAYS = 56;

/**
 * 같은 무게로 전보다 더 많이 했는가.
 *
 * PT 받는 사람이 제일 좋아하는 말은 "3주 전엔 이 무게로 8개였는데
 * 오늘 10개예요"다. 무게만 보면 몇 주째 그대로인 것 같아 지치는데,
 * 횟수로 보면 늘고 있다 — 그걸 짚어 주는 게 트레이너다.
 *
 * 같은 무게만 비교한다. 1RM 환산으로 비교하면 숫자는 나오지만 사람은
 * 그 숫자를 몸으로 기억하지 못한다.
 */
export function growthAt(
  sessions: readonly SessionLog[],
  exercise: Exercise,
  today: string,
  weightKg: number,
  reps: number,
  scope: HistoryScope = {},
): Growth | null {
  if (!(weightKg > 0) || !(reps > 0)) return null;
  const scoped = weightHistoryFor(sessions, exercise, scope)
    .filter((session) => {
      const gap = dayDiff(session.date, today);
      return gap >= GROWTH_MIN_DAYS && gap <= GROWTH_MAX_DAYS;
    })
    .sort((a, b) => (a.date < b.date ? 1 : -1));

  // 가장 최근의 "같은 무게" 날과 비교한다 — 제일 못했던 날을 골라 오면 자랑이 아니라 조작이다.
  for (const session of scoped) {
    const same = session.sets.filter(
      (set) => set.exerciseId === exercise.id && !set.warmup && Math.abs(set.weightKg - weightKg) < 0.01,
    );
    if (same.length === 0) continue;
    const thenReps = Math.max(...same.map((set) => set.reps));
    if (thenReps >= reps) return null;
    return { daysAgo: dayDiff(session.date, today), thenReps, nowReps: reps };
  }
  return null;
}

function whenWords(daysAgo: number): string {
  if (daysAgo < 14) return '지난주엔';
  return `${Math.round(daysAgo / 7)}주 전엔`;
}

export function growthLine(style: CoachStyle, growth: Growth): string {
  const when = whenWords(growth.daysAgo);
  if (style === 'data') {
    return `${when} 같은 무게 ${growth.thenReps}개, 오늘 ${growth.nowReps}개. +${growth.nowReps - growth.thenReps}회.`;
  }
  if (style === 'fired') {
    return `${when} 이 무게로 ${growth.thenReps}개였습니다. 오늘 ${growth.nowReps}개! 이게 쌓인 겁니다.`;
  }
  return `${when} 이 무게로 ${growth.thenReps}개였는데, 오늘 ${growth.nowReps}개 하셨어요. 늘었어요.`;
}

/* ── 세트 전 ───────────────────────────────────── */

export interface BeforeSetInput {
  style: CoachStyle;
  exerciseName: string;
  /** 0부터 */
  setIndex: number;
  totalSets: number;
  weightKg: number;
  pounds?: boolean;
  repsMin: number;
  repsMax: number;
  targetRir: number;
  last?: LastTime | null;
  /** 동작 포인트. 세트마다 하나씩 돌려 쓴다 */
  cues?: readonly string[];
  /** 처음 하는 종목이면 사용법을 길게 말한다 */
  firstTime?: boolean;
  setup?: readonly string[];
  /** 지난번에 적어 둔 기계 세팅 ("시트 4 · 등받이 2") */
  machineSetting?: string | null;
  /** 오늘 몇 번째 종목인가. 각오 한마디를 돌려 쓰는 데 쓴다 */
  liftIndex?: number;
}

/**
 * 빡센 트레이너의 각오 한마디.
 *
 * 하나만 두면 한 세션에 여섯 번 "오늘이 마지막인 것처럼"을 듣는다.
 * 세 번째부터는 아무 느낌이 없다. 돌려 쓴다.
 */
export const FIRED_RESOLVE: readonly string[] = [
  '오늘이 마지막인 것처럼 갑시다.',
  '오늘 인생을 갈아 넣는다는 느낌으로!',
  '더 할 수 있어요. 끝까지 갑니다.',
  '여기서 버티는 사람이 바뀝니다.',
];

export function firedResolve(at: number): string {
  return FIRED_RESOLVE[Math.abs(at) % FIRED_RESOLVE.length] as string;
}

function load(weightKg: number, pounds?: boolean): string {
  return weightKg > 0 ? weightLabelIn(weightKg, Boolean(pounds)) : '맨몸';
}

function repsWords(min: number, max: number): string {
  return min === max ? `${max}개` : `${min}에서 ${max}개`;
}

function endWith(text: string, mark: '.' | '!'): string {
  const trimmed = text.trim();
  if (/[.!?]$/.test(trimmed)) return trimmed;
  return trimmed + mark;
}

/**
 * 세트 전에 하는 말.
 *
 * 첫 세트는 길다 — 사용법(처음일 때만), 지난번, 오늘 목표, 포인트 하나.
 * 둘째 세트부터는 한두 마디다. 매 세트 사용법을 들으면 다음 날 PT 모드를
 * 끈다. 그리고 포인트는 **하나만** 말한다. 세 개를 말하면 셋 다 잊는다.
 */
export function beforeSetLines(input: BeforeSetInput): string[] {
  const { style } = input;
  const today = load(input.weightKg, input.pounds);
  const reps = repsWords(input.repsMin, input.repsMax);
  const isLast = input.setIndex === input.totalSets - 1;
  const cues = input.cues ?? [];
  const cue = cues.length > 0 ? cues[input.setIndex % cues.length] : undefined;
  const lines: string[] = [];

  const turn = (input.liftIndex ?? 0) + input.setIndex;

  if (input.setIndex > 0) {
    const head = `${input.setIndex + 1}세트`;
    if (style === 'fired') {
      lines.push(`${head}! ${today} ${reps}.`);
      lines.push(isLast ? `마지막 세트입니다. ${firedResolve(turn + 1)}` : '더 할 수 있어요.');
    } else if (style === 'data') {
      lines.push(`${head}, ${today}, ${reps}.${isLast ? ' 마지막.' : ''}`);
    } else {
      lines.push(`${head}, ${today} ${reps}요.${isLast ? ' 마지막 세트예요.' : ''}`);
    }
    if (cue && style !== 'data') lines.push(endWith(cue, style === 'fired' ? '!' : '.'));
    return lines;
  }

  // 첫 세트
  const name = input.exerciseName;
  if (style === 'fired') lines.push(`${name}, 갑니다!`);
  else if (style === 'data') lines.push(`${name}.`);
  // "입니다"는 받침과 상관없이 붙는다 — 조사를 고를 필요가 없다.
  else lines.push(`${name}입니다.`);

  if (input.firstTime && input.setup && input.setup.length > 0) {
    lines.push(style === 'data' ? '첫 기록. 세팅부터.' : '처음 하시는 종목이라 세팅부터 볼게요.');
    for (const step of input.setup) lines.push(endWith(step, '.'));
  } else if (input.machineSetting) {
    lines.push(`지난번 세팅은 ${input.machineSetting}입니다.`);
  }

  /*
   * 지난번과 오늘을 한 덩어리로 말한다. 따로 말하면 "오늘은 5kg 올려 볼게요.
   * 오늘은 125kg…"처럼 "오늘"이 연달아 나온다 — 귀로 들으면 그게 제일 거슬린다.
   */
  const last = input.last;
  const diff = last ? Math.round((input.weightKg - last.weightKg) * 10) / 10 : 0;
  const then = last ? load(last.weightKg, input.pounds) : '';

  if (style === 'data') {
    if (last) {
      const sign = diff > 0 ? `+${diff}kg` : diff < 0 ? `${diff}kg` : '같은 무게';
      lines.push(`지난번 ${then}, ${last.reps}개, 남은 ${last.rir}개. 오늘 ${sign}.`);
    }
    lines.push(`목표 ${today}, ${reps}, 남은 횟수 ${input.targetRir}.`);
  } else if (style === 'fired') {
    if (last) {
      lines.push(`지난번 ${then} ${last.reps}개.`);
      /*
       * 무게 줄은 "오늘"로 시작하지 않는다. 각오 두 개("오늘이 마지막인
       * 것처럼", "오늘 인생을 갈아 넣는다는")가 이미 "오늘"로 시작한다.
       */
      lines.push(diff > 0
        ? `이번엔 ${today}, ${diff}kg 더! ${reps}.`
        : `${today} ${reps}, 지난번보다 깔끔하게.`);
    } else {
      lines.push(`${today} ${reps}.`);
    }
    // 바로 앞 줄이 "오늘"로 시작하면 "오늘"로 시작하지 않는 각오를 고른다.
    let resolve = firedResolve(turn);
    const before = lines[lines.length - 1] ?? '';
    for (let step = 1; /^오늘/.test(before) && /^오늘/.test(resolve) && step < FIRED_RESOLVE.length; step += 1) {
      resolve = firedResolve(turn + step);
    }
    lines.push(resolve);
  } else if (last) {
    lines.push(`지난번엔 ${then} ${last.reps}개 하셨어요.`);
    if (diff > 0) lines.push(`오늘은 ${diff}kg만 올려서 ${today}, ${reps} 해 볼게요.`);
    else if (diff < 0) lines.push(`오늘은 조금 내려서 ${today}, ${reps} 갈게요. 괜찮아요.`);
    else lines.push(`오늘도 같은 무게로 ${reps} 해 볼게요.`);
  } else {
    lines.push(`오늘은 ${today} ${reps} 해 볼게요.`);
  }

  if (cue && style !== 'data') lines.push(endWith(cue, style === 'fired' ? '!' : '.'));
  return lines;
}

/* ── 세트 중 ───────────────────────────────────── */

/**
 * 끝나기 두 개 전의 한마디.
 *
 * 숫자 사이에 끼워 넣는 말이라 **짧아야 한다.** 한 회가 3초쯤인데
 * 이 말이 길면 다음 숫자를 덮는다. 그래서 여기서만은 "오늘이 마지막인
 * 것처럼"을 못 쓴다 — 그건 세트 전에 한다.
 */
export function pushLine(style: CoachStyle): string {
  if (style === 'fired') return '더 할 수 있어요!';
  if (style === 'data') return '두 개 남음.';
  return '두 개만 더요.';
}

/** 세트가 끝나면 묻는 말. */
export function askFeelLine(style: CoachStyle): string {
  if (style === 'fired') return '무게 어땠어요? 솔직하게요.';
  if (style === 'data') return '무게 체감은요?';
  return '무게는 어땠어요?';
}

/* ── 세트 후 ───────────────────────────────────── */

export interface AfterSetInput {
  style: CoachStyle;
  feel: Feel;
  /** 다음 세트가 없으면(이 종목 끝) true */
  lastOfLift: boolean;
  /** 다음 세트 무게 (보정 뒤) */
  nextWeightKg?: number;
  /** 엔진이 다음 세트를 바꾼 양 */
  deltaKg?: number;
  pounds?: boolean;
  /** 엔진이 여기서 멈추라고 했으면 그 이유 */
  stopReason?: string | null;
  growth?: Growth | null;
  setsDone?: number;
}

/**
 * 세트 후에 하는 말.
 *
 * **체감이 아니라 엔진이 정한 다음 무게**를 기준으로 말한다. "가벼웠어요"를
 * 눌렀어도 엔진이 올리지 않았다면 "올리겠습니다"라고 하면 안 된다 —
 * 말과 화면 숫자가 어긋나면 사람은 둘 다 안 믿는다.
 *
 * 아프다고 하면 말투와 상관없이 차분해진다. 빡센 트레이너도 거기서는
 * 밀지 않는다.
 */
export function afterSetLines(input: AfterSetInput): string[] {
  const { style } = input;
  const lines: string[] = [];

  if (input.feel === 'hurt') {
    return [
      '알겠습니다. 이 종목은 여기서 멈출게요.',
      '어디가 불편했는지 체크인에 적어 두시면 다음부터 맞는 종목으로 바꿔 드립니다.',
    ];
  }

  if (input.growth) lines.push(growthLine(style, input.growth));

  if (input.lastOfLift) {
    if (style === 'fired') lines.push('끝까지 해냈습니다. 다음 종목 갑니다!');
    else if (style === 'data') lines.push(`종목 완료${input.setsDone ? `, ${input.setsDone}세트` : ''}.`);
    else lines.push('이 종목 끝났어요. 수고하셨어요.');
    return lines;
  }

  if (input.stopReason) {
    if (style === 'fired') lines.push('여기서 멈추는 것도 실력입니다.');
    else if (style === 'data') lines.push('여기서 종료 권장.');
    else lines.push('오늘은 여기까지가 좋겠어요.');
    lines.push(endWith(input.stopReason, '.'));
    return lines;
  }

  const next = load(input.nextWeightKg ?? 0, input.pounds);
  const delta = Math.round((input.deltaKg ?? 0) * 10) / 10;

  if (delta > 0) {
    if (style === 'fired') lines.push(`다음 세트 ${next}! 올립니다.`);
    else if (style === 'data') lines.push(`다음 세트 +${delta}kg, ${next}.`);
    else lines.push(`다음 세트는 ${next}로 조금 올려 볼게요.`);
  } else if (delta < 0) {
    if (style === 'fired') lines.push(`${next}로 내립니다. 대신 자세는 완벽하게.`);
    else if (style === 'data') lines.push(`다음 세트 ${delta}kg, ${next}.`);
    else lines.push(`무리하지 않을게요. 다음 세트는 ${next}예요.`);
  } else {
    if (style === 'fired') lines.push('좋습니다. 같은 무게, 이번엔 더 깔끔하게.');
    else if (style === 'data') lines.push(`다음 세트 유지, ${next}.`);
    else lines.push('좋아요. 같은 무게로 한 번 더 가요.');
  }
  return lines;
}

/* ── 쉬는 동안 ─────────────────────────────────── */

const REST_TIPS: Record<CoachStyle, readonly string[]> = {
  calm: ['물 한 모금 드세요. 숨은 천천히요.', '어깨 한 번 털어 주세요.', '잘하고 있어요. 숨 고르세요.'],
  fired: ['숨 고르세요. 다음 세트가 진짜입니다.', '물 한 모금. 다음 세트도 다 쏟아냅니다.', '쉬는 것도 훈련입니다. 제대로 쉬세요.'],
  data: ['회복 중.', '물 한 모금 권장.', '다음 세트까지 대기.'],
};

/**
 * 쉬는 중간의 한마디. 세트마다 돌려 쓴다 — 같은 말을 여섯 번 들으면
 * 잔소리가 된다.
 */
export function restTipLine(style: CoachStyle, setIndex: number): string {
  const tips = REST_TIPS[style];
  return tips[Math.abs(setIndex) % tips.length] as string;
}

/** 휴식이 10초 남았을 때. 다음 세트 숫자는 세트 전에 말하므로 여기서는 부르기만 한다. */
export function readySoonLine(style: CoachStyle): string {
  if (style === 'fired') return '10초! 자리로 갑니다.';
  if (style === 'data') return '10초 전.';
  return '10초 남았어요. 자리로 가 볼까요.';
}

/** 휴식이 이 정도는 돼야 중간 한마디를 넣는다. 짧은 휴식에 말까지 넣으면 쉬지를 못한다. */
export const TIP_MIN_REST_SECONDS = 60;

/* ── 끝 ────────────────────────────────────────── */

export interface WrapUpInput {
  style: CoachStyle;
  setsDone: number;
  liftsDone: number;
  /** 오늘 지난번보다 늘어난 종목 수 */
  grew?: number;
  /** 오늘 든 총량(kg) */
  volumeKg?: number;
}

export function wrapUpLines(input: WrapUpInput): string[] {
  const { style } = input;
  const lines: string[] = [];
  if (style === 'data') {
    const tons = input.volumeKg ? `, 총 ${Math.round(input.volumeKg / 100) / 10}톤` : '';
    lines.push(`오늘 ${input.liftsDone}종목 ${input.setsDone}세트${tons}.`);
    if (input.grew) lines.push(`지난번보다 늘어난 종목 ${input.grew}개.`);
    return lines;
  }
  if (style === 'fired') {
    lines.push(`${input.setsDone}세트, 오늘 다 쏟아냈습니다.`);
    if (input.grew) lines.push(`${input.grew}종목이 지난번보다 늘었습니다.`);
    lines.push('이게 쌓이면 몸이 바뀝니다. 수고하셨습니다!');
    return lines;
  }
  lines.push(`오늘 ${input.setsDone}세트 하셨어요.`);
  if (input.grew) lines.push(`지난번보다 늘어난 종목이 ${input.grew}개예요.`);
  lines.push('정말 잘하셨어요. 푹 쉬세요.');
  return lines;
}

/* ── 소리로 읽기 ───────────────────────────────── */

/**
 * 화면 글을 읽을 말로 바꾼다.
 *
 * TTS는 "62.5kg"을 "케이지"로, "90lb"를 "엘비"로 읽는다. 기구 앞에서
 * 그 소리를 들으면 무게를 못 알아듣는다.
 */
export function forSpeech(text: string): string {
  return text
    .replace(/(\d)\s*kg/g, '$1킬로')
    .replace(/(\d)\s*lb/g, '$1파운드')
    .replace(/(\d)\s*[–~]\s*(\d)/g, '$1에서 $2')
    .replace(/\s*×\s*/g, ', ')
    .replace(/\+(\d)/g, '플러스 $1');
}

/**
 * 읽는 데 몇 초 걸리는가.
 *
 * 세트 전 말이 끝나기 전에 "하나"가 나가면 박자가 처음부터 어긋난다.
 * 그래서 준비 시간을 이 길이에 맞춰 늘린다. 한국어 TTS는 보통 1초에
 * 6음절 남짓이고, 마침표마다 쉰다.
 */
export function speechSeconds(text: string): number {
  const spoken = forSpeech(text);
  const syllables = (spoken.match(/[가-힣0-9]/g) ?? []).length;
  const pauses = (spoken.match(/[.!?,]/g) ?? []).length;
  return Math.round((syllables / 6 + pauses * 0.3) * 10) / 10;
}
