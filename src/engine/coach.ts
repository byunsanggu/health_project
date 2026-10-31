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
import type { Exercise, MovementPattern, SessionLog } from './types.ts';
import type { MistakeMoment } from './mistakes.ts';

/* ── 말투 ──────────────────────────────────────── */

/**
 * 코치 넷. 말투와 목소리가 같이 간다 — 활기찬 코치는 남 · 여 목소리를 고른다.
 *
 * 빡센 코치만 반말이다. 반말이라고 막말이 아니다 — 거칠게 밀어붙이되, 아프다고 하면
 * 누구보다 먼저 멈춘다. 나머지 셋은 존댓말이다.
 */
export type CoachStyle = 'energetic' | 'gentle' | 'tough' | 'fun';

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
    id: 'energetic',
    label: '활기차게',
    hint: '신나게 끌어올려 주는 코치 — 남 · 여 목소리',
    sample: '자, 오늘도 신나게 가 볼까요? 좋아요, 좋아! 두 개만 더!',
  },
  {
    id: 'gentle',
    label: '젠틀하게',
    hint: '매너 있게 차근차근 — 처음이거나 차분한 게 좋은 분께',
    sample: '좋습니다. 호흡 한 번 고르시고요. 천천히, 바르게 가 보시죠.',
  },
  {
    id: 'tough',
    label: '빡세게',
    hint: '반말로 거칠게 밀어붙이는 형님 코치',
    sample: '자, 올라잇! 하나 더 간다! 버텨, 버텨! 끝까지!',
  },
  {
    id: 'fun',
    label: '유머 있게',
    hint: '웃기면서 끝까지 하게 만드는 코치',
    sample: '이 무게, 어제 남긴 치킨이라고 생각하고 들어 봅시다!',
  },
];

/** 예전 말투(차분하게 · 빡세게 · 숫자로)를 새 코치로 옮긴다. 모르는 값은 젠틀. */
export function coachStyleOf(id: unknown): CoachStyle {
  if (id === 'energetic' || id === 'gentle' || id === 'tough' || id === 'fun') return id;
  if (id === 'fired') return 'tough';
  return 'gentle';
}

export function coachStyleInfo(id: CoachStyle): CoachStyleInfo {
  return COACH_STYLES.find((item) => item.id === id) ?? (COACH_STYLES[1] as CoachStyleInfo);
}

/** 말투별로 한 줄씩 — 네 코치가 같은 자리에서 하는 말. */
type ByStyle<T> = Readonly<Record<CoachStyle, T>>;

/** 끝까지 밀어붙이는 코치 — 끝까지 밀지 않는 날에는 말을 바꾼다 */
function pushes(style: CoachStyle): boolean {
  return style === 'tough' || style === 'energetic';
}

/**
 * 화면에만 보이고 소리로는 읽지 않는 부분 — 사람이 직접 적은 글(이름 · 기계 세팅 ·
 * 루틴 이름). 코치 목소리는 미리 만든 소리라 처음 보는 글자는 읽을 수 없다.
 * 앞뒤에 보이지 않는 표시(U+2068 · U+2069)를 붙여 두고, 읽을 때 통째로 뺀다.
 */
export function screenOnly(text: string): string {
  return text ? '⁨' + text + '⁩' : '';
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
  /*
   * "가벼웠어요"는 목표보다 둘 더 남았다는 뜻이다. 4로 묶어 두면 목표가 3 · 4인
   * 블록 초반(처음 무게를 일부러 가볍게 잡는 바로 그 주)에 "딱 좋았어요"와 같은
   * 값이 되어 무게가 안 오른다. 5(다섯 개 넘게 남음)까지 둔다.
   */
  if (feel === 'light') return Math.min(5, target + 2);
  if (feel === 'heavy') return Math.max(0, target - 1);
  return target;
}

/**
 * 남은 힘을 묻지 않고 횟수로 짐작한다.
 *
 * 세트마다 "몇 개 더 할 수 있었나요?"를 누르게 하면 운동이 설문이 된다.
 * 사람은 세트를 끝내고 숨을 고르지, 버튼을 고르지 않는다. 그래서 기본은
 * "완료" 하나이고, 남은 힘은 실제로 한 횟수에서 읽는다.
 *
 *   · 목표 범위 안 — 계획한 만큼 힘을 썼다고 본다(그 주의 목표 남은 횟수).
 *   · 범위 아래    — 계획한 횟수를 못 채웠다. 한계까지 갔다고 본다(0).
 *   · 범위 위      — 시킨 것보다 더 했다. 가벼웠다고 본다(목표 + 2, 최대 5).
 *
 * 짐작이라 정확하지 않다. 정확히 적고 싶은 사람은 설정에서 묻게 할 수 있다.
 */
export function rirFromReps(reps: number, target: { min: number; max: number }, targetRir: number): number {
  const planned = Math.max(0, Math.min(4, Math.round(targetRir)));
  if (!Number.isFinite(reps) || reps <= 0) return 0;
  if (reps < target.min) return 0;
  if (reps > target.max) return Math.min(5, planned + 2);
  return planned;
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

const GROWTH: ByStyle<readonly ((when: string, then: number, now: number) => string)[]> = {
  energetic: [
    (w, t, n) => `${w} 이 무게로 ${t}개. 오늘은 ${n}개! 늘었어요!`,
    (w, t, n) => `${w} ${t}개, 오늘은 ${n}개! 몸이 달라지고 있어요!`,
  ],
  gentle: [
    (w, t, n) => `${w} 이 무게로 ${t}개. 오늘은 ${n}개 하셨습니다. 확실히 느셨어요.`,
    (w, t, n) => `${w} ${t}개였던 무게를, 오늘은 ${n}개. 훌륭합니다.`,
  ],
  tough: [
    (w, t, n) => `${w} 이 무게로 ${t}개. 오늘 ${n}개! 이게 쌓인 거야.`,
    (w, t, n) => `${w} ${t}개, 오늘 ${n}개! 몸이 대답하는 거야.`,
  ],
  fun: [
    (w, t, n) => `${w} 이 무게로 ${t}개. 오늘은 ${n}개! 근육이 몰래 야근했나 봐요.`,
    (w, t, n) => `${w} ${t}개, 오늘은 ${n}개! 이 정도면 기구가 긴장하겠는데요?`,
  ],
};

export function growthLine(style: CoachStyle, growth: Growth, at = 0): string {
  return pick(GROWTH[style], at)(whenWords(growth.daysAgo), growth.thenReps, growth.nowReps);
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
  /** 오늘 종목 수 — "마지막 종목"을 말하는 데 쓴다 */
  totalLifts?: number;
  /** 이번 세트에 짚을 흔한 실수 (mistakeToWatch). 있으면 동작 포인트 대신 말한다 */
  watch?: { cue: string; short?: string; moment: MistakeMoment } | null;
  /**
   * 끝까지 밀지 않는 날 — 첫날 · 덜어내는 주 · 컨디션 낮은 날 · 아픈 데 있는 날.
   * 남길 횟수가 3개 이상인 주(블록 초반)도 그렇다. 밀어붙이는 코치(빡센 · 활기찬)도
   * 이날은 "끝까지 · 마지막인 것처럼"을 말하지 않는다 — 시작할 때 "무리하지 않는다"고
   * 해 놓고 세트 앞에서 끝까지 가자고 하면 둘 다 안 믿는다.
   */
  restrained?: boolean;
}

/** 끝까지 밀지 않는 날의 각오 — 기운은 그대로, "끝까지 · 마지막인 것처럼"은 뺀다. */
export const CONTROLLED_RESOLVE: ByStyle<readonly string[]> = {
  tough: ['자세로 이기는 거야. 목표 개수까지 정확하게!', '빠르게 말고 정확하게, 간다!', '깔끔한 반복만 센다. 집중!', '무게보다 자세. 제대로 간다!'],
  energetic: ['오늘은 자세로 이겨요! 목표 개수까지 정확하게!', '빠르게 말고 정확하게, 가 봐요!', '깔끔하게 한 개씩! 집중!', '무게보다 자세! 예쁘게 가요!'],
  gentle: ['목표 개수까지, 정확하게 가 보시죠.'],
  fun: ['오늘은 무리 금지! 자세 예쁘게만 가요.'],
};

/** 끝까지 밀지 않는 날의 중간 세트 한마디. */
export const CONTROLLED_MIDDLE: ByStyle<readonly string[]> = {
  tough: ['방금처럼 깔끔하게 가.', '자세 그대로, 집중.', '목표 개수만 정확하게.', '숨 고르고, 같은 모양으로 간다.'],
  energetic: ['방금처럼 깔끔하게 가요!', '자세 그대로, 집중!', '목표 개수만 정확하게요!', '숨 고르고, 같은 모양으로!'],
  gentle: ['방금처럼만 하시면 됩니다.'],
  fun: ['방금처럼만요. 복사, 붙여넣기!'],
};

/** 끝까지 밀지 않는 날인가 — 시켜서든, 남길 횟수가 많아서든. */
function holdsBack(input: BeforeSetInput): boolean {
  return Boolean(input.restrained) || input.targetRir >= 3;
}

const WATCH_HEAD: ByStyle<Record<MistakeMoment, string>> = {
  energetic: { flagged: '체크해 둔 거 기억하죠?', heavy: '무거울수록 자세가 먼저예요!', first: '제일 많이 틀리는 거 하나만요!', lastSet: '지칠 때 무너져요. 여기서 잡아요!' },
  gentle: { flagged: '체크해 두신 부분입니다.', heavy: '무거울수록 자세가 먼저입니다.', first: '가장 많이 하시는 실수 하나만 말씀드릴게요.', lastSet: '마지막 세트는 지칠 때라, 자세를 더 보겠습니다.' },
  tough: { flagged: '체크한 거 잊지 마.', heavy: '무거울 때 자세가 먼저 무너진다.', first: '제일 많이 틀리는 거 하나만.', lastSet: '지칠 때 무너진다. 잡아.' },
  fun: { flagged: '체크해 둔 거, 저는 안 잊었어요.', heavy: '무거울수록 자세가 생명이에요.', first: '다들 한 번씩 하는 실수 하나만요.', lastSet: '지치면 자세가 퇴근하려고 해요. 붙잡아요!' },
};

/** 동작 말 끝 — 짧은 말(무릎은 바깥으로)에 코치 말투를 붙인다. */
function cueEnd(style: CoachStyle, cue: string): string {
  const text = cue.trim().replace(/[.!?]+$/, '');
  if (style === 'tough') return text + '!';
  if (style === 'gentle') return text + '.';
  return text + '!';
}

/**
 * 흔한 실수를 짚는 말. 왜 지금 말하는지가 앞머리로 붙는다 —
 * "체크하신 거", "무거울 때", "처음이라", "지칠 때".
 */
export function watchLine(style: CoachStyle, cue: string, moment: MistakeMoment): string {
  return `${WATCH_HEAD[style][moment]} ${cueEnd(style, cue)}`;
}

/**
 * 밀어붙이는 코치의 각오 한마디. 하나만 두면 한 세션에 여섯 번 같은 말을 듣는다 — 돌려 쓴다.
 */
export const RESOLVE: ByStyle<readonly string[]> = {
  tough: ['오늘이 마지막인 것처럼 가자.', '올라잇! 인생 갈아 넣는다는 느낌으로!', '목표 개수, 마지막 두 개가 제일 깔끔하게.', '여기서 버티는 사람이 바뀐다.'],
  energetic: ['오늘 최고 기록 한번 만들어 봐요!', '할 수 있어요! 끝까지 가 봐요!', '에너지 다 쏟아 봐요!', '여기서 버티면 진짜 달라져요!'],
  gentle: ['천천히, 정확하게 가 보시죠.', '호흡 지키시고, 한 개씩 가겠습니다.'],
  fun: ['자, 근육한테 출근 도장 찍어 줍시다!', '이번 세트 끝나면 박수 쳐 드릴게요!'],
};

/** 돌려 쓰기. 같은 자리에서 같은 말이 연달아 나오지 않게 순번으로 고른다. */
function pick<T>(lines: readonly T[], at: number): T {
  return lines[Math.abs(Math.round(at)) % lines.length] as T;
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

/** 중간 세트 한마디 — 첫 세트의 각오보다 짧다. */
export const MIDDLE: ByStyle<readonly string[]> = {
  tough: ['더 할 수 있어.', '목표 개수, 마지막 두 개를 제일 깔끔하게.', '여기서부터가 진짜 운동이야.', '힘든 게 정상이야. 그게 자극이고.', '자세 무너지지 않게, 끝까지 버텨.', '쉬운 세트는 없어. 집중.'],
  energetic: ['좋아요, 이 리듬 그대로!', '목표 개수까지, 마지막 두 개가 제일 중요해요!', '여기서부터가 진짜예요!', '힘든 거 정상이에요! 그게 자극이에요!', '할 수 있어요, 집중!'],
  gentle: ['방금처럼만 하시면 됩니다.', '리듬 좋습니다. 그대로 가시죠.', '내리기 전에 숨을 마셔 배에 힘을 주고, 올라온 뒤 내쉬세요.', '천천히 내리셔도 괜찮습니다.', '잘하고 계십니다. 한 개씩만 생각하세요.'],
  fun: ['방금처럼만요. 복사, 붙여넣기!', '힘든 표정, 사진 찍고 싶을 만큼 멋있어요.', '이 세트 끝나면 물이 꿀맛일 거예요.', '근육이 지금 레벨업 중이에요. 띠링!', '숨은 올라온 뒤에 후— 내쉬어요. 얼굴 토마토 금지!'],
};

/** 종목을 시작할 때 오늘 어디쯤인지 — 마지막 종목이라는 말이 그날 남은 힘을 끌어낸다. */
function liftMarker(style: CoachStyle, liftIndex?: number, totalLifts?: number, calmDown = false): string | null {
  if (liftIndex === undefined || !totalLifts || totalLifts < 3) return null;
  if (liftIndex !== totalLifts - 1) return null;
  // "절반 왔어요"는 PT 세션이 시간으로 말한다(ptSession.timeCheck). 종목 수로 또 하면 두 번 듣는다.
  const lines: ByStyle<string> = {
    tough: calmDown ? '마지막 종목이다. 마무리까지 깔끔하게 간다!' : '마지막 종목이다. 남은 거 다 쏟고 간다!',
    energetic: calmDown ? '마지막 종목이에요! 깔끔하게 마무리해요!' : '마지막 종목이에요! 남은 힘 다 써 봐요!',
    gentle: '오늘 마지막 종목입니다. 거의 다 오셨어요.',
    fun: '마지막 종목이에요! 이것만 하면 자유의 몸!',
  };
  return lines[style];
}

const NAME_LINE: ByStyle<(name: string) => string> = {
  energetic: (name) => `${name}! 가 볼까요?`,
  gentle: (name) => `이번 종목은, ${name}.`,
  tough: (name) => `${name}, 간다!`,
  fun: (name) => `${name}, 출동합니다!`,
};

const SETUP_INTRO: ByStyle<string> = {
  energetic: '처음 하는 종목이니까, 세팅부터 같이 봐요!',
  gentle: '처음 하시는 종목이라, 세팅부터 차근차근 보겠습니다.',
  tough: '처음이지? 세팅 순서 읽어 줄게.',
  fun: '처음 만나는 기구네요. 인사부터 하고, 세팅 볼게요.',
};

const SETTING_SAVED: ByStyle<string> = {
  energetic: '지난번 세팅, 화면에 띄워 뒀어요!',
  gentle: '지난번 세팅은 화면에 적어 두었습니다.',
  tough: '지난번 세팅, 화면에 있어.',
  fun: '지난번 세팅은 화면에! 기억력은 제가 담당할게요.',
};

/**
 * 세트 전에 하는 말.
 *
 * 첫 세트는 길다 — 사용법(처음일 때만), 지난번, 오늘 목표, 포인트 하나.
 * 둘째 세트부터는 한두 마디다. 매 세트 사용법을 들으면 다음 날 PT 모드를
 * 끈다. 그리고 포인트는 **하나만** 말한다. 세 개를 말하면 셋 다 잊는다.
 *
 * 숫자 · 종목 이름 뒤에는 조사를 붙이지 않는다("62.5킬로로" 대신 "62.5킬로,").
 * 코치 목소리는 미리 만든 조각을 이어 붙이는데, 숫자에 조사가 붙으면 조각이 어색하게 끊긴다.
 */
export function beforeSetLines(input: BeforeSetInput): string[] {
  const { style } = input;
  const today = load(input.weightKg, input.pounds);
  const reps = repsWords(input.repsMin, input.repsMax);
  const isLast = input.setIndex === input.totalSets - 1;
  const cues = input.cues ?? [];
  const cue = cues.length > 0 ? cues[input.setIndex % cues.length] : undefined;
  const calmDown = holdsBack(input) && pushes(style);
  const lines: string[] = [];
  const turn = (input.liftIndex ?? 0) + input.setIndex;

  const resolve = (at: number): string => pick(calmDown ? CONTROLLED_RESOLVE[style] : RESOLVE[style], at);
  /*
   * 반말 코치는 짧은 말로만 짚는다 — 실수의 "무릎을 발끝 방향으로 밀어 주세요"나 시연의 "…내립니다"를
   * 반말 머리 뒤에 붙이면 말투가 한 문장 안에서 바뀐다. 짧은 말("무릎은 바깥으로")이 있으면 그것, 없으면 생략.
   */
  const tail = (): void => {
    if (input.watch) {
      const said = style === 'tough' ? input.watch.short : input.watch.cue;
      if (said) lines.push(watchLine(style, said, input.watch.moment));
    } else if (cue && style !== 'tough') lines.push(cueEnd(style, cue));
  };

  if (input.setIndex > 0) {
    const head = `${input.setIndex + 1}세트`;
    if (style === 'gentle') {
      lines.push(`${head}. ${today}, ${reps}.${isLast ? ' 마지막 세트입니다.' : ''}`);
      if (!isLast && !cue) lines.push(pick(MIDDLE.gentle, turn));
    } else {
      lines.push(`${head}! ${today}, ${reps}!`);
      const lastWords: ByStyle<string> = { tough: '마지막이야!', energetic: '마지막 세트예요!', gentle: '', fun: '마지막 세트! 끝나면 물 마실 수 있어요.' };
      lines.push(isLast
        ? `${lastWords[style]} ${style === 'fun' ? '' : resolve(turn + 1)}`.trim()
        : pick(calmDown ? CONTROLLED_MIDDLE[style] : MIDDLE[style], turn));
    }
    tail();
    return lines;
  }

  // 첫 세트
  const marker = liftMarker(style, input.liftIndex, input.totalLifts, calmDown);
  if (marker) lines.push(marker);
  lines.push(NAME_LINE[style](input.exerciseName));

  if (input.firstTime && input.setup && input.setup.length > 0) {
    lines.push(SETUP_INTRO[style]);
    for (const step of input.setup) lines.push(endWith(step, '.'));
  } else if (input.machineSetting) {
    lines.push(SETTING_SAVED[style] + screenOnly(` (${input.machineSetting})`));
  }

  /*
   * 지난번과 오늘을 한 덩어리로 말한다. 따로 말하면 "오늘은 5kg 올려 볼게요.
   * 오늘은 125kg…"처럼 "오늘"이 연달아 나온다 — 귀로 들으면 그게 제일 거슬린다.
   */
  const last = input.last;
  const diff = last ? Math.round((input.weightKg - last.weightKg) * 10) / 10 : 0;
  const then = last ? load(last.weightKg, input.pounds) : '';
  const delta = `${Math.abs(diff)}kg`;

  if (style === 'tough') {
    if (last) {
      lines.push(`지난번 ${then}, ${last.reps}개.`);
      lines.push(diff > 0 ? `이번엔 ${delta} 더! ${today}, ${reps}.` : `${today}, ${reps}. 지난번보다 깔끔하게.`);
    } else {
      lines.push(`${today}, ${reps}.`);
    }
    // 바로 앞 줄이 "오늘"로 시작하면 "오늘"로 시작하지 않는 각오를 고른다.
    const pool = calmDown ? CONTROLLED_RESOLVE.tough : RESOLVE.tough;
    let words = pick(pool, turn);
    const before = lines[lines.length - 1] ?? '';
    for (let step = 1; /^오늘/.test(before) && /^오늘/.test(words) && step < pool.length; step += 1) words = pick(pool, turn + step);
    lines.push(words);
  } else if (style === 'energetic') {
    if (last) lines.push(`지난번엔 ${then}, ${last.reps}개!`);
    if (last && diff > 0) lines.push(`이번엔 ${delta} 올려서, ${today}, ${reps}!`);
    else if (last && diff < 0) lines.push(`오늘은 살짝 내려서, ${today}, ${reps}. 괜찮아요!`);
    else if (last) lines.push(`같은 무게, ${today}, ${reps}! 이번엔 더 깔끔하게!`);
    else lines.push(`오늘은 ${today}, ${reps}! 가 봅시다!`);
    lines.push(resolve(turn));
  } else if (style === 'gentle') {
    if (last) lines.push(`지난번엔 ${then}, ${last.reps}개 하셨습니다.`);
    if (last && diff > 0) lines.push(`오늘은 ${delta}만 올려서, ${today}, ${reps} 해 보겠습니다.`);
    else if (last && diff < 0) lines.push(`오늘은 조금 내려서, ${today}, ${reps} 가겠습니다. 괜찮습니다.`);
    else if (last) lines.push(`오늘도 같은 무게로, ${reps} 해 보겠습니다.`);
    else lines.push(`오늘은 ${today}, ${reps} 해 보겠습니다.`);
  } else {
    if (last) lines.push(`지난번엔 ${then}, ${last.reps}개! 기억하시죠?`);
    if (last && diff > 0) lines.push(`오늘은 ${delta} 추가! ${today}, ${reps}. 기구한테 미리 사과해 두세요.`);
    else if (last && diff < 0) lines.push(`오늘은 살짝 내려서, ${today}, ${reps}. 무게도 쉬는 날이 있어야죠.`);
    else if (last) lines.push(`같은 무게, ${today}, ${reps}. 익숙한 친구랑 한 번 더!`);
    else lines.push(`오늘은 ${today}, ${reps}! 가 볼까요?`);
  }

  // 짚을 실수가 있으면 그걸 말하고 동작 포인트는 쉰다 — 한 세트에 한 가지.
  tail();
  return lines;
}

/* ── 세트 중 ───────────────────────────────────── */

/**
 * 끝나기 두 개 전의 한마디.
 *
 * 숫자 사이에 끼워 넣는 말이라 **짧아야 한다.** 한 회가 3초쯤인데
 * 이 말이 길면 다음 숫자를 덮는다.
 */
const PUSH: ByStyle<readonly string[]> = {
  tough: ['더 할 수 있어!', '밀어, 끝까지!', '여기서 간다!', '포기 안 해!', '올라잇! 두 개!'],
  energetic: ['좋아요, 두 개 더!', '거의 다 왔어요!', '할 수 있어요!', '밀어요, 끝까지요!'],
  gentle: ['두 개만 더입니다.', '거의 다 오셨습니다.', '좋습니다, 두 개요.', '천천히, 두 개요.'],
  fun: ['두 개! 진짜로요!', '거의 다 왔어요!', '두 개만! 치킨 두 조각!'],
};

/** 끝까지 밀지 않는 날(restrained)의 재촉 — "끝까지 · 포기 안 해"를 뺀다. */
const PUSH_CONTROLLED: ByStyle<readonly string[]> = {
  tough: ['자세 유지!', '깔끔하게, 두 개!', '그대로 가!', '호흡 지켜!'],
  energetic: ['자세 유지해요!', '깔끔하게, 두 개!', '그대로 가요!', '호흡 지켜요!'],
  gentle: PUSH.gentle,
  fun: PUSH.fun,
};

export function pushLine(style: CoachStyle, at = 0, restrained = false): string {
  return pick(restrained ? PUSH_CONTROLLED[style] : PUSH[style], at);
}

/**
 * 마지막 하나 전에 외치는 말. 숫자 바로 뒤에 붙는다 — "아홉, 하나 더! 마지막!!"
 * 현장에서 제일 많이 하는 말이 이거다.
 */
export function lastCallLine(style: CoachStyle): string {
  const lines: ByStyle<string> = { tough: '하나 더! 마지막!!', energetic: '하나 더! 마지막!', gentle: '하나만 더, 마지막입니다', fun: '마지막 하나! 웃으면서!' };
  return lines[style];
}

/**
 * 세트 중간의 자세 한마디 — 동작별로 짧게.
 *
 * 트레이너는 세트 중에 설명하지 않는다. 대신 무너지기 시작하는 지점에서
 * 두세 마디로 바로잡는다. 숫자 사이에 끼므로 숫자 하나 길이를 넘기지 않는다.
 */
const FORM_CUES: Partial<Record<MovementPattern, { push: readonly string[]; polite: readonly string[]; tough: readonly string[] }>> = {
  squat: {
    push: ['엉덩이 뒤로요!', '무릎은 발끝 방향!', '가슴 세워요!'],
    polite: ['엉덩이를 뒤로 보내 주세요.', '무릎은 발끝 방향으로요.', '가슴 세우시고요.'],
    tough: ['엉덩이 뒤로!', '무릎은 발끝 방향!', '가슴 세워!'],
  },
  lunge: {
    push: ['상체 세워요!', '앞발 뒤꿈치로 밀어요!'],
    polite: ['상체 세우시고요.', '앞발 뒤꿈치로 밀어 주세요.'],
    tough: ['상체 세워!', '앞발 뒤꿈치로 밀어!'],
  },
  hinge: {
    push: ['등 펴요!', '엉덩이로 밀어요!', '바는 몸에 붙여요!'],
    polite: ['등 펴시고요.', '엉덩이로 밀어 주세요.', '바는 몸 가까이요.'],
    tough: ['등 펴!', '엉덩이로 밀어!', '바 몸에 붙여!'],
  },
  horizontalPush: {
    push: ['가슴 열어요!', '어깨 내려요!', '천천히 내려요!'],
    polite: ['가슴 여시고요.', '어깨는 내리시고요.', '천천히 내려 주세요.'],
    tough: ['가슴 열어!', '어깨 내려!', '천천히 내려!'],
  },
  verticalPush: {
    push: ['배에 힘 줘요!', '허리 꺾지 마요!'],
    polite: ['배에 힘 주시고요.', '허리 꺾이지 않게요.'],
    tough: ['배에 힘 줘!', '허리 꺾지 마!'],
  },
  verticalPull: {
    push: ['팔꿈치로 당겨요!', '가슴 쪽으로!', '어깨 내려요!'],
    polite: ['팔꿈치로 당겨 주세요.', '가슴 쪽으로요.', '어깨는 내리시고요.'],
    tough: ['팔꿈치로 당겨!', '가슴 쪽으로!', '어깨 내려!'],
  },
  horizontalPull: {
    push: ['팔꿈치 뒤로!', '날개뼈 모아요!', '반동 없이!'],
    polite: ['팔꿈치를 뒤로요.', '날개뼈 모으시고요.', '반동 없이요.'],
    tough: ['팔꿈치 뒤로!', '날개뼈 모아!', '반동 없이!'],
  },
  isolation: {
    push: ['반동 없이!', '끝에서 꽉!', '천천히 내려요!'],
    polite: ['반동 없이요.', '끝에서 한 번 꽉 주세요.', '천천히 내려 주세요.'],
    tough: ['반동 없이!', '끝에서 꽉 쥐어!', '천천히 내려!'],
  },
  core: {
    push: ['숨 쉬어요!', '허리 띄우지 마요!'],
    polite: ['숨은 쉬면서요.', '허리가 뜨지 않게요.'],
    tough: ['숨 쉬어!', '허리 띄우지 마!'],
  },
};

export function formCueLine(
  style: CoachStyle,
  pattern: MovementPattern,
  at = 0,
  /** 그 종목의 흔한 실수에서 뽑은 짧은 말 — 있으면 이쪽을 먼저 쓴다 */
  shorts?: readonly string[],
): string | null {
  if (shorts && shorts.length > 0) return cueEnd(style, pick(shorts, at));
  const cues = FORM_CUES[pattern];
  if (!cues) return null;
  return pick(style === 'tough' ? cues.tough : style === 'gentle' ? cues.polite : cues.push, at);
}

const ASK_FEEL: ByStyle<readonly string[]> = {
  tough: ['무게 어땠어? 솔직하게.', '어땠어? 몇 개 남았는지 솔직하게.', '무게 괜찮았어? 정직하게 눌러.'],
  energetic: ['무게 어땠어요?', '방금 세트 어땠어요? 솔직하게요!', '어땠어요? 여유 몇 개였는지 솔직하게요!'],
  gentle: ['무게는 어떠셨어요?', '무게 괜찮으셨나요?', '방금 세트 어떠셨어요?'],
  fun: ['무게 어땠어요? 기구는 괜찮대요.', '방금 세트 어땠어요? 솔직하게, 저 안 삐져요.', '어땠어요? 무거웠으면 기구 탓 해도 돼요.'],
};

/** 세트가 끝나면 묻는 말. at을 안 주면 늘 같은 첫 문장이다(화면 글자용). */
export function askFeelLine(style: CoachStyle, at = 0): string {
  return pick(ASK_FEEL[style], at);
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
  /** 이 종목에서 지금까지 든 적 없는 무게를 오늘 처음 들었다 */
  weightPr?: boolean;
  /** 돌려 쓰기 순번 — 보통 종목 순서 + 세트 순서 */
  at?: number;
  /** 불러 줄 이름 ("민수") — 축하할 때 부른다. 화면에만 */
  name?: string | null;
}

/** "민수님, " — 이름이 없으면 빈 문자열. 사람이 적은 이름이라 화면에만 보인다. */
function call(name?: string | null): string {
  const clean = (name ?? '').trim();
  return clean ? screenOnly(`${clean}님, `) : '';
}

const FEEL_ACK: ByStyle<Partial<Record<Feel, readonly string[]>>> = {
  tough: {
    light: ['가벼웠다고? 그럼 자세를 더 깔끔하게.', '여유 있었다는 건, 더 갈 수 있다는 거야.'],
    heavy: ['무거운 게 정상이야. 그게 자극이고.', '무거웠는데 해냈어. 그게 실력이야.'],
  },
  energetic: {
    light: ['가벼웠어요? 좋아요, 다음엔 더 가 봐요!', '여유 있었네요! 컨디션 최고!'],
    heavy: ['무거웠죠? 그래도 해냈어요!', '힘들었는데 끝까지 했어요! 멋져요!'],
  },
  gentle: {
    light: ['가벼우셨다니 다행입니다.', '여유가 있으셨네요.'],
    heavy: ['무거우셨죠. 그래도 잘 버티셨습니다.', '힘드셨죠. 자세는 좋았습니다.'],
  },
  fun: {
    light: ['가벼웠어요? 기구가 서운하겠네요.', '여유 있었다니, 오늘 밥 잘 드셨나 봐요.'],
    heavy: ['무거웠죠? 기구가 오늘 좀 예민하네요.', '무거웠는데 해냈어요! 무게가 졌어요.'],
  },
};

const NEXT_UP: ByStyle<readonly ((w: string) => string)[]> = {
  tough: [(w) => `다음 세트, ${w}! 올린다.`, (w) => `${w}. 올린다. 할 수 있어.`, (w) => `다음은 ${w}. 한 단계 위로 간다!`],
  energetic: [(w) => `다음 세트는 ${w}! 올려 봐요!`, (w) => `${w}! 한 단계 올라가요!`],
  gentle: [(w) => `다음 세트는 조금 올려서, ${w}.`, (w) => `여유가 있으시니, ${w}. 살짝 올려 보겠습니다.`],
  fun: [(w) => `다음 세트, ${w}! 무게가 레벨업했어요.`, (w) => `${w}! 무게가 한 칸 올라갔어요, 축하 파티!`],
};
const NEXT_DOWN: ByStyle<readonly ((w: string) => string)[]> = {
  tough: [(w) => `${w}. 내린다. 대신 자세는 완벽하게.`, (w) => `${w}. 조정한다. 횟수는 끝까지 채운다.`],
  energetic: [(w) => `${w}. 살짝 내려서 가요! 자세 예쁘게!`, (w) => `${w}. 조금 내려서, 횟수 다 채워 봐요!`],
  gentle: [(w) => `무리하지 않겠습니다. 다음 세트는, ${w}.`, (w) => `조금 내려서, ${w}. 괜찮습니다.`],
  fun: [(w) => `${w}. 살짝 내려요. 작전상 후퇴예요.`, (w) => `${w}. 무게도 가끔은 쉬어야죠.`],
};
const NEXT_SAME: ByStyle<readonly string[]> = {
  tough: ['좋아. 같은 무게, 이번엔 더 깔끔하게.', '같은 무게 그대로. 목표 개수, 자세 그대로.', '무게 유지. 자세로 이긴다.'],
  energetic: ['좋아요! 같은 무게로 한 번 더!', '딱 좋아요! 이대로 한 세트 더!', '같은 무게, 방금처럼만 가요!'],
  gentle: ['좋습니다. 같은 무게로 한 번 더 가시죠.', '딱 좋습니다. 이대로 한 세트 더 하겠습니다.', '같은 무게로, 방금처럼만 하시면 됩니다.'],
  fun: ['같은 무게, 한 번 더! 익숙한 맛이 제일이죠.', '딱 좋아요. 이 무게랑 정들었네요.', '같은 무게로 앙코르 갑니다!'],
};
const LIFT_DONE: ByStyle<readonly string[]> = {
  tough: ['끝까지 해냈다. 다음 종목 간다!', '한 종목 끝. 숨 고르고 다음 간다!', '이 종목은 이겼다. 다음.'],
  energetic: ['이 종목 끝! 완전 잘했어요!', '하나 끝냈어요! 다음 거 가 봐요!', '깔끔하게 끝냈어요! 최고예요!'],
  gentle: ['이 종목은 마무리입니다. 수고하셨습니다.', '잘하셨습니다. 이 종목은 여기까지입니다.', '깔끔하게 끝내셨습니다. 잠깐 쉬고 다음 종목 가시죠.'],
  fun: ['이 종목 클리어! 다음 스테이지로!', '끝났어요! 이 기구랑은 이제 작별 인사해요.', '한 종목 끝! 박수, 짝짝짝!'],
};

const HURT: ByStyle<readonly string[]> = {
  tough: ['알았어. 이 종목은 여기까지.', '어디가 불편했는지 적어 둬. 다음부터 맞는 걸로 바꿔 줄게.'],
  energetic: ['알겠어요. 이 종목은 여기서 멈춰요.', '어디가 불편했는지 적어 두면, 다음부터 맞는 종목으로 바꿔 드릴게요.'],
  gentle: ['알겠습니다. 이 종목은 여기서 멈추겠습니다.', '어디가 불편하셨는지 적어 두시면, 다음부터 맞는 종목으로 바꿔 드리겠습니다.'],
  fun: ['알겠어요. 장난은 잠깐 멈출게요. 이 종목은 여기까지예요.', '어디가 불편했는지 적어 두시면, 다음부터 맞는 종목으로 바꿔 드릴게요.'],
};

const WEIGHT_PR: ByStyle<string> = {
  tough: '이 종목 최고 무게다! 오늘 기록 세웠어!',
  energetic: '이 종목 최고 무게예요! 신기록이에요!',
  gentle: '이 종목에서 처음 드신 무게입니다. 축하드립니다.',
  fun: '이 종목 최고 무게! 기구가 깜짝 놀랐어요!',
};

const STOP: ByStyle<string> = {
  tough: '여기서 멈추는 것도 실력이야.',
  energetic: '오늘은 여기까지가 좋겠어요!',
  gentle: '오늘은 여기까지가 좋겠습니다.',
  fun: '오늘은 여기까지! 아쉬울 때 멈추는 게 고수예요.',
};

/**
 * 세트 후에 하는 말.
 *
 * **체감이 아니라 엔진이 정한 다음 무게**를 기준으로 말한다. "가벼웠어요"를
 * 눌렀어도 엔진이 올리지 않았다면 "올리겠습니다"라고 하면 안 된다 —
 * 말과 화면 숫자가 어긋나면 사람은 둘 다 안 믿는다.
 *
 * 아프다고 하면 말투와 상관없이 밀지 않는다. 빡센 코치도 거기서는 멈춘다.
 */
export function afterSetLines(input: AfterSetInput): string[] {
  const { style } = input;
  if (input.feel === 'hurt') return [...HURT[style]];
  const lines: string[] = [];
  const at = input.at ?? input.setsDone ?? 0;

  // 처음 든 무게가 제일 먼저다. 그날 들을 말 중에 제일 기억에 남는다.
  if (input.weightPr) lines.push(call(input.name) + WEIGHT_PR[style]);
  else if (input.growth) lines.push(growthLine(style, input.growth, at));
  else {
    // 체감 대답에 대꾸한다 — 매번은 아니고, 대답이 "딱 좋았어요"가 아닐 때만.
    const acks = FEEL_ACK[style][input.feel];
    if (acks) lines.push(pick(acks, at));
  }

  if (input.lastOfLift) {
    lines.push(pick(LIFT_DONE[style], at));
    return lines;
  }
  if (input.stopReason) {
    lines.push(STOP[style]);
    // 엔진이 쓴 이유는 화면에만 — 합니다체라 반말 코치 목소리와 섞이면 어색하고, 말은 위 한 줄로 충분하다
    lines.push(screenOnly(endWith(input.stopReason, '.')));
    return lines;
  }
  const next = load(input.nextWeightKg ?? 0, input.pounds);
  const delta = Math.round((input.deltaKg ?? 0) * 10) / 10;
  if (delta > 0) lines.push(pick(NEXT_UP[style], at)(next));
  else if (delta < 0) lines.push(pick(NEXT_DOWN[style], at)(next));
  else lines.push(pick(NEXT_SAME[style], at));
  return lines;
}

/* ── 쉬는 동안 ─────────────────────────────────── */

/**
 * 쉬는 동안의 한마디 — 조언과 동기부여. 세트마다 돌려 쓴다. 같은 말을 여섯 번 들으면
 * 잔소리가 된다. 몸에 대한 말은 일반적인 운동 상식까지만 — 진단처럼 들리는 말은 넣지 않는다.
 */
export const REST_TIPS: ByStyle<readonly string[]> = {
  tough: [
    '숨 골라. 다음 세트가 진짜야.',
    '물 한 모금. 다음 세트도 자세부터.',
    '쉬는 것도 훈련이야. 제대로 쉬어.',
    '지금 쉬는 만큼 다음 세트에서 나온다.',
    '방금 그 느낌 기억해. 다음도 그대로.',
    '폰 보지 마. 다음 세트만 생각해.',
    '코로 마시고 입으로 길게 내쉬어.',
    '어깨 한 번 털어. 힘 빼고.',
    '근육은 오늘 밤에 자란다. 잠 꼭 자.',
    '단백질 챙겨. 운동만 하고 안 먹으면 반쪽이야.',
    '남이랑 비교하지 마. 어제의 너랑만 싸우는 거야.',
    '올라잇. 여기까지 온 거면 반은 이긴 거야.',
  ],
  energetic: [
    '물 한 모금 마셔요! 다음 세트도 신나게!',
    '숨 고르고요! 지금 너무 잘하고 있어요!',
    '어깨 한 번 털어 줘요! 가볍게!',
    '방금 세트 진짜 좋았어요! 그 느낌 그대로!',
    '쉬는 것도 운동이에요! 제대로 쉬어요!',
    '코로 들이쉬고, 입으로 길게 내쉬어요!',
    '오늘 나온 것 자체가 대단한 거예요!',
    '근육은 쉬는 동안 자라요! 오늘 밤 꿀잠 자요!',
    '단백질 꼭 챙겨 먹어요! 근육 밥이에요!',
    '조금씩이라도 매주 늘고 있어요! 진짜예요!',
  ],
  gentle: [
    '물 한 모금 드세요. 숨은 천천히 고르시고요.',
    '어깨 한 번 털어 주세요.',
    '잘하고 계십니다. 숨 고르세요.',
    '코로 들이쉬고, 입으로 길게 내쉬어 보세요.',
    '방금 세트 좋았습니다. 다음도 그대로만 하시면 됩니다.',
    '목이랑 어깨 힘은 빼고 쉬시죠.',
    '폰은 잠깐 내려 두시고, 숨만 고르세요.',
    '근육은 쉬는 동안 자랍니다. 오늘 밤 잠도 운동만큼 중요합니다.',
    '운동 끝나고 단백질 챙겨 드시면, 회복이 빨라집니다.',
    '무게보다 꾸준함입니다. 오늘도 잘 나오셨습니다.',
  ],
  fun: [
    '물 한 모금! 물은 공짜예요, 마음껏 드세요.',
    '숨 고르세요. 숨은 무료 리필이에요.',
    '어깨 한 번 털어요. 스트레스도 같이 털어요.',
    '방금 세트, 거울 보셨어요? 멋있던데요.',
    '쉬는 동안 폰 보면, 근육이 질투해요.',
    '근육은 자는 동안 자라요. 오늘 밤 꿀잠이 숙제예요.',
    '단백질 챙기세요. 치킨도 단백질이긴 해요. 튀김은 빼고요.',
    '숨은 코로 마시고, 입으로 후— 길게요.',
    '어제의 나보다 조금만 더. 그게 오늘의 승리예요.',
    '힘들죠? 원래 힘들어요. 그래서 다들 안 하는 거예요.',
  ],
};

/**
 * 쉬는 중간의 한마디. 세트마다 돌려 쓴다 — 같은 말을 여섯 번 들으면
 * 잔소리가 된다.
 */
export function restTipLine(style: CoachStyle, setIndex: number): string {
  return pick(REST_TIPS[style], setIndex);
}

/** 휴식이 10초 남았을 때. 다음 세트 숫자는 세트 전에 말하므로 여기서는 부르기만 한다. */
const READY_SOON: ByStyle<readonly string[]> = {
  tough: ['10초! 자리로 가.', '10초 남았다. 그립 잡아.', '10초! 다음 세트 준비.'],
  energetic: ['10초 남았어요! 자리로 가요!', '이제 10초! 준비해요!', '10초 뒤에 시작해요!'],
  gentle: ['10초 남았습니다. 자리로 가 보시죠.', '이제 10초입니다. 천천히 준비하세요.', '10초 뒤에 시작하겠습니다.'],
  fun: ['10초! 다시 기구랑 데이트할 시간이에요.', '10초 남았어요. 마음의 준비, 되셨죠?', '10초 뒤 시작! 도망은 안 돼요.'],
};

export function readySoonLine(style: CoachStyle, at = 0): string {
  return pick(READY_SOON[style], at);
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
  /** 처음 운동한 날 */
  firstEver?: boolean;
  /** 이번 주 몇 번째 운동인지 / 목표 몇 번인지 */
  weekDone?: number;
  weekTarget?: number;
  /** 돌려 쓰기 순번 — 보통 날짜에서 뽑는다 */
  at?: number;
  name?: string | null;
  /** 제일 앞에 고른 목표 — 오늘 한 운동이 그 목표에 무슨 뜻인지 한 줄 */
  goal?: 'hypertrophy' | 'strength' | 'fatLoss' | 'general' | null;
}

type Goal = 'hypertrophy' | 'strength' | 'fatLoss' | 'general';

const GOAL_LINE: ByStyle<Record<Goal, string>> = {
  tough: {
    hypertrophy: '근육은 오늘 운동이 아니라 오늘 밤에 자란다. 잠 꼭 챙겨.',
    strength: '오늘 든 무게가 다음 기록의 발판이야.',
    fatLoss: '근육 지키면서 빼는 거야. 오늘 운동이 그걸 해 준다.',
    general: '오늘 나온 것 자체가 이긴 거야.',
  },
  energetic: {
    hypertrophy: '근육은 오늘 밤에 자라요! 꿀잠이 운동만큼 중요해요!',
    strength: '오늘 든 무게가 다음 기록의 발판이에요!',
    fatLoss: '근육 지키면서 빼는 중이에요! 오늘 운동이 그걸 해 줘요!',
    general: '오늘 나온 것 자체가 최고예요!',
  },
  gentle: {
    hypertrophy: '근육은 쉬는 동안 자랍니다. 오늘 밤 잠이 운동만큼 중요합니다.',
    strength: '오늘 드신 무게가, 다음에 더 드실 수 있는 바탕이 됩니다.',
    fatLoss: '근력 운동이, 빠지는 동안 근육을 지켜 줍니다. 잘하셨습니다.',
    general: '꾸준히 나오시는 게 가장 중요합니다.',
  },
  fun: {
    hypertrophy: '근육은 자는 동안 자라요. 오늘 밤은 침대랑 약속 있으세요.',
    strength: '오늘 든 무게는, 다음 기록의 계단이에요. 한 칸 올라왔어요.',
    fatLoss: '근육 지키면서 빼는 중이에요. 오늘 운동이 그 경호원이에요.',
    general: '오늘 나온 거, 이미 이긴 거예요. 소파를 이겼어요.',
  },
};

const WRAP_CLOSE: ByStyle<readonly string[]> = {
  tough: ['이게 쌓이면 몸이 바뀐다. 수고했어!', '오늘 한 만큼 반드시 돌아온다. 수고했어!', '오늘도 이겼다. 단백질 꼭 챙겨!'],
  energetic: ['오늘 진짜 최고였어요! 수고했어요!', '오늘도 해냈어요! 물 많이 마셔요!', '너무 잘했어요! 단백질 꼭 챙겨요!'],
  gentle: ['정말 잘하셨습니다. 푹 쉬세요.', '오늘도 수고 많으셨습니다. 물 많이 드세요.', '잘하셨습니다. 단백질 챙겨 드세요.'],
  fun: ['오늘 운동 끝! 이제 소파가 기다리고 있어요.', '수고했어요! 오늘 계단 오를 때 다리가 인사할 거예요.', '끝! 단백질 챙기시고요, 치킨은 반 마리만요.'],
};

const FIRST_EVER: ByStyle<[string, string]> = {
  tough: ['첫 운동 끝냈다. 시작한 사람만 바뀐다!', '오늘 무게가 기준이야. 다음부터 여기서 올라간다.'],
  energetic: ['첫 운동 끝냈어요! 시작이 제일 어려운 거예요!', '오늘 든 무게를 기준으로, 다음부터 조금씩 올려 줄게요!'],
  gentle: ['첫 운동 끝내셨습니다. 시작이 제일 어려운 겁니다.', '오늘 드신 무게를 기준으로, 다음부터 조금씩 올려 드리겠습니다.'],
  fun: ['첫 운동 끝! 헬스장이랑 첫 데이트 성공이에요.', '오늘 든 무게가 기준이에요. 다음부터 슬금슬금 올려 볼게요.'],
};

export function wrapUpLines(input: WrapUpInput): string[] {
  const { style } = input;
  const at = input.at ?? input.setsDone;
  const lines: string[] = [];
  let week: string | null = null;
  if (input.weekDone && input.weekTarget) {
    const done = input.weekDone >= input.weekTarget;
    const left = input.weekTarget - input.weekDone;
    const words: ByStyle<string> = done
      ? { tough: `이번 주 ${input.weekTarget}번, 다 나왔다. 약속 지켰어!`, energetic: `이번 주 ${input.weekTarget}번, 다 채웠어요! 약속 지켰어요!`, gentle: `이번 주 ${input.weekTarget}번, 다 채우셨습니다. 약속 지키셨어요.`, fun: `이번 주 ${input.weekTarget}번, 다 채웠어요! 개근상 드릴게요.` }
      : { tough: `이번 주 ${left}번 남았다.`, energetic: `이번 주 ${left}번 남았어요!`, gentle: `이번 주 ${left}번 남았습니다.`, fun: `이번 주 ${left}번 남았어요. 헬스장이 기다린대요.` };
    week = words[style];
  }

  if (input.firstEver) {
    lines.push(...FIRST_EVER[style]);
  } else {
    const sets: ByStyle<string> = {
      tough: `${input.setsDone}세트. 오늘도 해냈다.`,
      energetic: `오늘 ${input.setsDone}세트! 완전 잘했어요!`,
      gentle: `오늘 ${input.setsDone}세트 하셨습니다.`,
      fun: `오늘 ${input.setsDone}세트! 근육이 감사 편지 쓸 거예요.`,
    };
    lines.push(sets[style]);
    if (input.grew) {
      const grew: ByStyle<string> = {
        tough: `${input.grew}종목, 지난번보다 늘었다.`,
        energetic: `${input.grew}종목이나 지난번보다 늘었어요!`,
        gentle: `지난번보다 늘어난 종목이, ${input.grew}종목입니다.`,
        fun: `${input.grew}종목, 지난번보다 늘었어요. 몰래 강해지는 중!`,
      };
      lines.push(grew[style]);
    }
  }
  if (week) lines.push(week);
  if (input.goal && !input.firstEver) lines.push(GOAL_LINE[style][input.goal]);
  lines.push(call(input.name) + pick(WRAP_CLOSE[style], at));
  return lines;
}

/* ── 시작 ──────────────────────────────────────── */

export interface SessionStartInput {
  style: CoachStyle;
  sessionName: string;
  lifts: number;
  minutes?: number;
  /** 'accumulation' | 'deload' */
  phase?: 'accumulation' | 'deload';
  weekInBlock?: number;
  accumulationWeeks?: number;
  /** 처음 하는 운동 */
  firstEver?: boolean;
  /** 연속으로 지킨 주 */
  streakWeeks?: number;
  /** 이어서 하는 중이면 */
  resuming?: boolean;
  name?: string | null;
  /** 컨디션 0~100. 낮으면 무게보다 자세를 보자고 먼저 말한다 */
  condition?: number;
}

/** 이 아래면 시작할 때 컨디션 이야기를 한다. 화면의 컨디션 %와 같은 값이다. */
export const LOW_CONDITION = 70;

const RESUME: ByStyle<string> = { tough: '이어서 간다!', energetic: '이어서 가 봐요!', gentle: '이어서 하겠습니다.', fun: '돌아오셨군요! 이어서 갑니다.' };

/** 운동을 이어서 할 때 · 멈췄다 다시 할 때 하는 말. */
export function resumeLine(style: CoachStyle): string {
  return RESUME[style];
}

/** 세트 중간에 멈췄다 다시 셀 때 — "이어서 갈게요. 다섯부터." (word는 세는 말: 하나 · 둘 …) */
export function resumeFromLine(style: CoachStyle, word: string): string {
  return `${RESUME[style]} ${word}부터.`;
}

/** PT를 켜는 순간의 한마디. */
export function ptStartLine(style: CoachStyle): string {
  const lines: ByStyle<string> = { tough: '자, 올라잇. 지금부터 같이 간다.', energetic: '지금부터 같이 해요! 신나게!', gentle: '지금부터 함께하겠습니다.', fun: '지금부터 같이 해요. 도망가기 없기!' };
  return lines[style];
}

/**
 * 시작을 누르면 하는 말.
 *
 * 오늘 무엇을 얼마나 하는지, 그리고 이번 주가 블록의 어디인지 한 줄.
 * 트레이너는 회원이 들어오면 "오늘 하체, 40분이요. 이번 주가 제일 힘든
 * 주예요"라고 먼저 말한다 — 각오가 거기서 생긴다. 오늘 운동 이름은 사람이 붙인
 * 이름일 수 있어 화면에만 둔다.
 */
export function sessionStartLines(input: SessionStartInput): string[] {
  const { style } = input;
  if (input.resuming) return [RESUME[style]];
  const lines: string[] = [];
  const who = call(input.name);
  const what = screenOnly(`${input.sessionName} · `);
  const time = input.minutes ? `${input.minutes}분` : '';
  const opening: ByStyle<string> = {
    tough: `${what}오늘 ${input.lifts}종목.${time ? ` 약 ${time}. 집중해!` : ' 집중해!'}`,
    energetic: `${what}오늘은 ${input.lifts}종목!${time ? ` 약 ${time}. 신나게 가 봐요!` : ' 신나게 가 봐요!'}`,
    gentle: `${what}오늘은 ${input.lifts}종목입니다.${time ? ` 약 ${time} 걸립니다.` : ''}`,
    fun: `${what}오늘은 ${input.lifts}종목!${time ? ` 약 ${time}. 영화 한 편보다 짧아요.` : ''}`,
  };
  lines.push(who + opening[style]);

  // 컨디션이 낮은 날은 그 말이 제일 먼저다 — 블록 이야기보다 오늘 몸이 우선이다.
  if (input.condition !== undefined && input.condition < LOW_CONDITION && !input.firstEver) {
    const low: ByStyle<string> = {
      tough: '컨디션 좀 떨어져 있지? 오늘은 무게 욕심보다 자세로 이기는 날이야.',
      energetic: '컨디션이 조금 낮네요. 오늘은 무게보다 자세에 집중해요! 힘들면 세트 줄여도 괜찮아요.',
      gentle: '컨디션이 조금 낮으시네요. 무게보다 자세에 집중하시죠. 힘드시면 세트를 줄여도 괜찮습니다.',
      fun: '컨디션이 좀 낮네요. 오늘은 살살 가요. 무리하면 내일의 내가 화내요.',
    };
    lines.push(low[style]);
    return lines;
  }

  if (input.firstEver) {
    const first: ByStyle<string> = {
      tough: '첫날이다. 오늘은 무게를 찾는 날이야. 무리 안 한다.',
      energetic: '첫날이에요! 오늘은 맞는 무게를 찾는 날이라, 가볍게 시작해요!',
      gentle: '첫날입니다. 오늘은 맞는 무게를 찾는 날이라, 가볍게 시작하겠습니다.',
      fun: '첫날이에요! 오늘은 무게랑 통성명하는 날이에요. 가볍게 가요.',
    };
    lines.push(first[style]);
  } else if (input.phase === 'deload') {
    const deload: ByStyle<string> = {
      tough: '이번 주는 덜어내는 주다. 참는 것도 훈련이야.',
      energetic: '이번 주는 덜어내는 주예요! 무게보다 자세를 봐요!',
      gentle: '이번 주는 덜어내는 주입니다. 무게보다 자세를 보시죠.',
      fun: '이번 주는 덜어내는 주예요. 근육도 휴가가 필요해요.',
    };
    lines.push(deload[style]);
  } else if (input.weekInBlock && input.accumulationWeeks) {
    if (input.weekInBlock === input.accumulationWeeks) {
      const hard: ByStyle<string> = {
        tough: '블록 마지막 주다. 제일 힘든 주야. 다음 주에 쉰다!',
        energetic: '이번 주가 블록에서 제일 힘든 주예요! 다음 주엔 덜어내요!',
        gentle: '이번 주가 블록에서 가장 힘든 주입니다. 다음 주엔 덜어내겠습니다.',
        fun: '이번 주가 블록의 보스전이에요! 다음 주엔 쉬어요.',
      };
      lines.push(hard[style]);
    } else if (input.weekInBlock === 1) {
      const start: ByStyle<string> = {
        tough: '블록 첫 주다. 기준을 제대로 세운다.',
        energetic: '블록 첫 주예요! 여유 있게 시작해요!',
        gentle: '블록 첫 주라, 여유 있게 가겠습니다.',
        fun: '블록 첫 주예요. 워밍업 같은 한 주예요.',
      };
      lines.push(start[style]);
    }
  }
  if (input.streakWeeks && input.streakWeeks >= 2) {
    const streak: ByStyle<string> = {
      tough: `${input.streakWeeks}주 연속이다. 안 끊는다!`,
      energetic: `${input.streakWeeks}주 연속이에요! 대단해요!`,
      gentle: `${input.streakWeeks}주째, 꾸준히 오셨습니다.`,
      fun: `${input.streakWeeks}주 연속! 이쯤 되면 헬스장 주민이에요.`,
    };
    lines.push(streak[style]);
  }
  return lines;
}

/* ── 기록 ──────────────────────────────────────── */

/** 오늘 전까지 이 종목에서 든 가장 무거운 본세트. 없으면 null. */
export function bestWeightBefore(
  sessions: readonly SessionLog[],
  exercise: Exercise,
  today: string,
  scope: HistoryScope = {},
): number | null {
  let best: number | null = null;
  for (const session of weightHistoryFor(sessions, exercise, scope)) {
    if (session.date >= today) continue;
    for (const set of session.sets) {
      if (set.exerciseId !== exercise.id || set.warmup || set.reps <= 0) continue;
      if (best === null || set.weightKg > best) best = set.weightKg;
    }
  }
  return best;
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
    // 화면에만 보이는 부분(사람이 적은 글)은 읽지 않는다
    .replace(/\u2068[^\u2069]*\u2069/g, '')
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
