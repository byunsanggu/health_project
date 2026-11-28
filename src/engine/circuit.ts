import { EXERCISES, HEAVY_PULLS, JUMP_MOVES, exerciseById } from './exercises.ts';
import { availableExercises } from './equipment.ts';
import { screenExercise } from './pain.ts';
import { MUSCLE_GROUPS } from './muscles.ts';
import { cooldownFor, mobilityFor, type CooldownStep, type MobilityStep } from './ptSession.ts';
import type { CoachStyle } from './coach.ts';
import type { Exercise, MuscleGroup, PainReport, TrainingLevel } from './types.ts';

/**
 * 서킷 운동 — 헬스장 세트가 지루한 사람을 위한, 시계를 보며 도는 하루 운동.
 *
 * 근력 운동 뒤에 붙는 마무리 운동(conditioning.ts의 buildFinisher)과 다른 점은 이것이 **그날 운동 전부**라는
 * 것이다. 몸 풀기 → 시간 재는 본 운동(8~25분) → (시간이 남으면) 짧은 몸통 운동 → 마무리 스트레칭.
 *
 * 지키는 것:
 *   · 근육 키우는 세트 수에는 세지 않는다. 피로에만 더한다(conditioning.ts와 같은 원칙).
 *   · 시간에 쫓기며 하는 운동이라 배우기 쉬운 동작만 — 바벨 · 스미스 · 무거운 당기기 · 기술 동작(올림픽 리프트,
 *     반동 턱걸이, 머슬업)은 아예 후보에 없다. 관절 부하 상한도 단계마다 둔다.
 *   · 초보 · 아픈 날에는 뛰는 동작이 없다. 초보의 처음 두 주는 시계가 속도를 정하는 방식(1분마다 · 하고 쉬기)만.
 *   · 동작마다 쉽게 · 기본 · 어렵게 — 운동 중에 한 번 눌러 바꾼다.
 *   · 이름 붙은 기본 서킷 1 · 2 · 3은 4주마다 같은 구성으로 돌아온다 — 지난번과 견줄 수 있게.
 *   · 이름은 우리가 지은 것이다. 다른 곳의 이름 붙은 운동을 옮겨 오지 않는다.
 */

/* ── 고르는 것 ─────────────────────────────────── */

/** 체력 기르기의 방식 — 지금처럼 근력 운동 뒤 짧은 서킷('mixed') · 대부분의 날을 서킷으로('circuit'). */
export type CircuitStyle = 'mixed' | 'circuit';
export const CIRCUIT_STYLES: readonly CircuitStyle[] = ['mixed', 'circuit'];

export const CIRCUIT_STYLE_LABELS_KO: Readonly<Record<CircuitStyle, string>> = {
  mixed: '근력 + 짧은 서킷',
  circuit: '서킷 위주',
};

export const CIRCUIT_STYLE_HINTS_KO: Readonly<Record<CircuitStyle, string>> = {
  mixed: '근력 운동을 짧게 하고, 끝에 8~15분 서킷을 붙입니다',
  circuit: '대부분의 날은 서킷만 하고, 한 주에 1~2번 짧은 근력 운동으로 힘을 지킵니다',
};

/** 저장된 값이 무엇이든 둘 중 하나로 — 모르는 값은 지금 방식. */
export function circuitStyleOf(value: unknown): CircuitStyle {
  return value === 'circuit' ? 'circuit' : 'mixed';
}

export type CircuitFormat = 'amrap' | 'emom' | 'forTime' | 'intervals';
/** 바퀴를 도는 보통 모양 · 바퀴마다 횟수가 느는 사다리 · 긴 목록을 한 번에(중급부터) */
export type CircuitShape = 'rounds' | 'ladder' | 'chipper';
export type CircuitScale = 'easy' | 'base' | 'hard';
export type CircuitFocus = 'full' | 'lower' | 'upper';

export const CIRCUIT_SCALES: readonly CircuitScale[] = ['easy', 'base', 'hard'];

export const SCALE_LABELS_KO: Readonly<Record<CircuitScale, string>> = {
  easy: '쉽게',
  base: '기본',
  hard: '어렵게',
};

/** 화면에 쓰는 방식 이름 — 하는 일로 부른다. 영어 줄임말은 쓰지 않는다. */
export const CIRCUIT_FORMAT_NAMES_KO: Readonly<Record<CircuitFormat, string>> = {
  amrap: '시간 안에 최대한',
  emom: '1분마다',
  forTime: '빨리 끝내기',
  intervals: '하고 쉬기',
};

export const CIRCUIT_SHAPE_NAMES_KO: Readonly<Record<CircuitShape, string>> = {
  rounds: '',
  ladder: '한 바퀴마다 늘리기',
  chipper: '긴 목록 한 번에',
};

export const CIRCUIT_FOCUS_LABELS_KO: Readonly<Record<CircuitFocus, string>> = {
  full: '온몸',
  lower: '하체 위주',
  upper: '상체 위주',
};

/* ── 동작 후보 ─────────────────────────────────── */

/** 한 바퀴 안의 자리 — 무릎 굽히기 · 한 발씩 · 엉덩이 접기 · 밀기 · 위로 밀기 · 당기기 · 몸통 · 숨차기 */
export type CircuitSlot = 'squat' | 'lunge' | 'hinge' | 'push' | 'press' | 'pull' | 'core' | 'engine';

/**
 * 자리마다 쓸 수 있는 동작 — 앞에 있을수록 먼저. 들고 옮길 수 있는 것(덤벨 · 맨몸 · 밴드)을 앞에 둔다.
 * 기계 · 케이블은 한 바퀴에 하나까지만 쓴다(붐비는 헬스장에서 세 대를 번갈아 차지할 수 없다).
 */
const SLOT_MOVES: Readonly<Record<CircuitSlot, readonly string[]>> = {
  squat: ['goblet-squat', 'dumbbell-sumo-squat', 'bodyweight-squat', 'leg-press'],
  lunge: ['dumbbell-reverse-lunge', 'step-up', 'bodyweight-reverse-lunge', 'walking-lunge', 'bulgarian-split-squat'],
  hinge: ['kettlebell-swing', 'dumbbell-hip-thrust', 'glute-bridge', 'cable-pull-through', 'back-extension', 'machine-hip-thrust'],
  push: ['push-up', 'knee-push-up', 'dumbbell-floor-press', 'incline-push-up', 'trx-chest-press', 'machine-chest-press'],
  press: ['seated-dumbbell-press', 'standing-dumbbell-press', 'machine-shoulder-press'],
  pull: ['one-arm-dumbbell-row', 'trx-row', 'band-row', 'inverted-row', 'seated-cable-row', 'lat-pulldown', 'machine-high-row'],
  core: ['dead-bug', 'plank', 'mountain-climber', 'bird-dog', 'reverse-crunch', 'side-plank', 'crunch', 'hanging-leg-raise', 'ab-wheel-rollout'],
  engine: ['step-back-burpee', 'mountain-climber', 'bear-crawl', 'jumping-jack', 'squat-jump'],
};

/** 쉽게 — 같은 일을 하는 더 쉬운 동작(앞에서부터, 쓸 수 있는 것). 없으면 같은 동작을 덜 한다. */
const EASIER: Readonly<Record<string, readonly string[]>> = {
  'push-up': ['knee-push-up', 'incline-push-up'],
  'knee-push-up': ['incline-push-up'],
  'dumbbell-floor-press': ['knee-push-up', 'incline-push-up'],
  'trx-chest-press': ['incline-push-up'],
  'goblet-squat': ['bodyweight-squat'],
  'dumbbell-sumo-squat': ['bodyweight-squat'],
  'leg-press': ['bodyweight-squat'],
  'dumbbell-reverse-lunge': ['bodyweight-reverse-lunge'],
  'step-up': ['bodyweight-reverse-lunge'],
  'walking-lunge': ['dumbbell-reverse-lunge', 'bodyweight-reverse-lunge'],
  'bulgarian-split-squat': ['dumbbell-reverse-lunge', 'bodyweight-reverse-lunge'],
  'kettlebell-swing': ['dumbbell-hip-thrust', 'glute-bridge'],
  'dumbbell-hip-thrust': ['glute-bridge'],
  'back-extension': ['glute-bridge'],
  'inverted-row': ['trx-row', 'band-row'],
  'trx-row': ['band-row'],
  'seated-dumbbell-press': ['band-lateral-raise'],
  'standing-dumbbell-press': ['seated-dumbbell-press'],
  'step-back-burpee': ['bodyweight-squat'],
  'mountain-climber': ['plank'],
  'bear-crawl': ['plank'],
  'squat-jump': ['bodyweight-squat'],
  'jumping-jack': ['bodyweight-squat'],
  'hanging-leg-raise': ['captains-chair-knee-raise', 'reverse-crunch'],
  'ab-wheel-rollout': ['plank'],
  'side-plank': ['plank'],
  'reverse-crunch': ['dead-bug'],
  'crunch': ['dead-bug'],
};

/** 어렵게 — 같은 일을 하는 더 힘든 동작. 없으면 같은 동작을 더 한다. 단계 상한 · 뛰기 규칙은 그대로 지킨다. */
const HARDER: Readonly<Record<string, readonly string[]>> = {
  'knee-push-up': ['push-up'],
  'incline-push-up': ['push-up', 'knee-push-up'],
  'bodyweight-squat': ['goblet-squat', 'squat-jump'],
  'dumbbell-sumo-squat': ['goblet-squat'],
  'bodyweight-reverse-lunge': ['dumbbell-reverse-lunge'],
  'dumbbell-reverse-lunge': ['walking-lunge', 'bulgarian-split-squat'],
  'glute-bridge': ['dumbbell-hip-thrust'],
  'dumbbell-hip-thrust': ['kettlebell-swing'],
  'band-row': ['trx-row', 'one-arm-dumbbell-row'],
  'trx-row': ['inverted-row'],
  'bird-dog': ['dead-bug'],
  'dead-bug': ['mountain-climber'],
  'plank': ['mountain-climber'],
  'reverse-crunch': ['hanging-leg-raise'],
  'crunch': ['reverse-crunch'],
  'step-back-burpee': [],
};

/** 반복이 아니라 버티는 · 움직이는 시간으로 세는 동작 */
const TIMED = new Set(['plank', 'side-plank', 'bear-crawl']);

/** 초보에게 숨찬 채로는 어려운 몸통 동작 — 허리가 꺾이거나 매달려 흔들린다 */
const HARD_FOR_BEGINNER = new Set(['hanging-leg-raise', 'ab-wheel-rollout', 'walking-lunge', 'bulgarian-split-squat']);

/** 기본 횟수(중급 기준) — 자리 기본값, 동작마다 다르면 여기서 */
const SLOT_REPS: Readonly<Record<CircuitSlot, number>> = {
  squat: 12, lunge: 10, hinge: 12, push: 10, press: 10, pull: 10, core: 12, engine: 8,
};
const MOVE_REPS: Readonly<Record<string, number>> = {
  'push-up': 8, 'kettlebell-swing': 12, 'glute-bridge': 15, 'mountain-climber': 20, 'jumping-jack': 20,
  'squat-jump': 10, 'step-back-burpee': 8, 'dead-bug': 12, 'bird-dog': 12, 'plank': 30, 'side-plank': 20,
  'bear-crawl': 20, 'leg-press': 15, 'back-extension': 12, 'band-row': 15, 'crunch': 15, 'reverse-crunch': 12,
  'captains-chair-knee-raise': 10, 'band-lateral-raise': 12,
};

const LEVEL_FACTOR: Readonly<Record<TrainingLevel, number>> = { beginner: 0.8, intermediate: 1, advanced: 1.2, expert: 1.3 };

/** 관절 부하 상한 — 피로한 채로 하는 동작이라 근력 세션보다 낮게 */
const JOINT_CEILING: Readonly<Record<TrainingLevel, number>> = { beginner: 0.5, intermediate: 0.65, advanced: 0.7, expert: 0.7 };

/** 본 운동 길이(분) — 단계마다 */
export const MAIN_MINUTES: Readonly<Record<TrainingLevel, readonly [number, number]>> = {
  beginner: [8, 15], intermediate: [10, 20], advanced: [12, 25], expert: [12, 25],
};

/** 시간을 따로 정하지 않았을 때 하루 서킷 전체 길이(분) */
export const DEFAULT_CIRCUIT_MINUTES: Readonly<Record<TrainingLevel, number>> = {
  beginner: 25, intermediate: 35, advanced: 40, expert: 40,
};

/* ── 하루 서킷 ─────────────────────────────────── */

export interface CircuitMove {
  exerciseId: string;
  name: string;
  amount: number;
  unit: 'reps' | 'seconds';
  /** 화면에 그대로 쓰는 분량 — "12회" · "30초" · "30초 동안" */
  display: string;
  /** "한쪽씩" · "천천히" 같은 덧붙임 */
  note?: string;
}

export interface CircuitMovement {
  slot: CircuitSlot;
  scales: Record<CircuitScale, CircuitMove>;
}

export interface CircuitMain {
  format: CircuitFormat;
  shape: CircuitShape;
  /** 시간 안에 최대한 · 1분마다 · 하고 쉬기는 길이, 빨리 끝내기는 제한 시간 */
  minutes: number;
  /** 빨리 끝내기 — 몇 바퀴 */
  rounds?: number;
  /** 하고 쉬기 — 운동 · 쉬기 초 */
  workSeconds?: number;
  restSeconds?: number;
  /** 사다리 — 바퀴마다 늘리는 횟수 */
  ladderStep?: number;
  movements: CircuitMovement[];
  /** "시간 안에 최대한 12분" */
  title: string;
  /** 처음 보는 사람에게 한 줄 — 무엇을 어떻게 하는지 */
  how: string;
}

export interface CircuitExtra {
  title: string;
  minutes: number;
  rounds: number;
  workSeconds: number;
  restSeconds: number;
  moves: CircuitMove[];
}

export interface CircuitSession {
  /** "오늘의 서킷" · "기본 서킷 1" */
  name: string;
  /** 이름 붙은 기본 서킷이면 그 번호 */
  benchmark: 1 | 2 | 3 | null;
  date: string;
  focus: CircuitFocus;
  warmup: MobilityStep[];
  warmupMinutes: number;
  main: CircuitMain;
  extra: CircuitExtra | null;
  cooldown: CooldownStep[];
  cooldownMinutes: number;
  totalMinutes: number;
  targetMuscles: MuscleGroup[];
  /** 근육 키우는 세트로는 세지 않고 피로에만 더할 값(세트분) */
  fatigueLoad: number;
  notes: string[];
  /** 같은 구성인지 가리는 열쇠 — 기본 서킷끼리 견줄 때 */
  signature: string;
}

export interface CircuitInput {
  level: TrainingLevel;
  /** YYYY-MM-DD */
  date: string;
  /** 이 헬스장 · 집의 기구. 없으면 흔한 헬스장으로 본다 */
  equipmentIds?: readonly string[];
  pain?: readonly PainReport[];
  /** 쓸 수 있는 시간 — 몸 풀기 · 스트레칭까지 다 합친 분 */
  minutes?: number;
  /** 어디를 쓸지 — 오늘 근력 운동 대신 하면 그날 쓰려던 부위(focusMuscles)가 먼저다 */
  focus?: CircuitFocus;
  focusMuscles?: readonly MuscleGroup[];
  format?: CircuitFormat;
  shape?: CircuitShape;
  /** 이름 붙은 기본 서킷 — 정하면 방식 · 길이 · 동작이 그 서킷 것으로 고정된다 */
  benchmark?: 1 | 2 | 3 | null;
  /** 날마다 다른 동작(날짜 해시) */
  seed?: number;
  /** 시작한 주부터 몇째 주인가(0부터) — 초보의 처음 두 주 */
  weekIndex?: number;
}

function round5(value: number): number {
  return Math.max(10, Math.round(value / 5) * 5);
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

function primaryOf(exercise: Exercise): MuscleGroup | undefined {
  let best: MuscleGroup | undefined;
  let value = 0;
  for (const muscle of MUSCLE_GROUPS) {
    const share = exercise.contribution[muscle] ?? 0;
    if (share > value) { best = muscle; value = share; }
  }
  return best;
}

/** 오늘 뛰는 동작을 넣어도 되는가 — 초보와 어디든 아프다고 한 날은 넣지 않는다. */
export function jumpsAllowed(level: TrainingLevel, pain: readonly PainReport[] = []): boolean {
  return level !== 'beginner' && !pain.some((report) => report.score >= 1);
}

interface Pool {
  ok: (id: string) => boolean;
  get: (id: string) => Exercise | undefined;
}

function poolFor(input: CircuitInput): Pool {
  const pain = input.pain ?? [];
  const jumps = jumpsAllowed(input.level, pain);
  const ceiling = JOINT_CEILING[input.level];
  const reachable = new Set((input.equipmentIds ? availableExercises(input.equipmentIds, EXERCISES) : EXERCISES).map((item) => item.id));
  const cache = new Map<string, boolean>();
  const ok = (id: string): boolean => {
    const known = cache.get(id);
    if (known !== undefined) return known;
    const exercise = exerciseById(id);
    const pass = Boolean(exercise) && reachable.has(id) &&
      exercise!.equipment !== 'barbell' && exercise!.equipment !== 'smith' && !HEAVY_PULLS.has(id) &&
      (jumps || !JUMP_MOVES.has(id)) &&
      !(input.level === 'beginner' && HARD_FOR_BEGINNER.has(id)) &&
      Math.max(0, ...Object.values(exercise!.jointStress)) <= ceiling &&
      screenExercise(exercise!, pain).action === 'allow';
    cache.set(id, pass);
    return pass;
  };
  return { ok, get: exerciseById };
}

/** 부위마다 어느 자리가 그 부위를 쓰는가 — 오늘 근력 운동 대신 할 때 같은 부위를 쓰게 */
const MUSCLE_SLOTS: Readonly<Partial<Record<MuscleGroup, readonly [CircuitSlot, number][]>>> = {
  quads: [['squat', 1], ['lunge', 0.7]],
  glutes: [['hinge', 1], ['lunge', 0.5]],
  hamstrings: [['hinge', 1]],
  calves: [['lunge', 0.3]],
  chest: [['push', 1]],
  triceps: [['push', 0.5], ['press', 0.4]],
  frontDelt: [['press', 0.8], ['push', 0.3]],
  sideDelt: [['press', 0.8]],
  back: [['pull', 1]],
  biceps: [['pull', 0.5]],
  rearDelt: [['pull', 0.5]],
  traps: [['pull', 0.3]],
  abs: [['core', 1]],
};

const FOCUS_SLOTS: Readonly<Record<CircuitFocus, readonly CircuitSlot[]>> = {
  full: ['squat', 'push', 'hinge', 'pull', 'engine', 'core'],
  lower: ['squat', 'hinge', 'lunge', 'core', 'engine'],
  upper: ['push', 'pull', 'press', 'core', 'engine'],
};

/** 자리 순서 — 부위를 주면 그 부위를 많이 쓰는 자리부터, 마지막 자리는 숨차기 · 몸통. */
function slotOrder(input: CircuitInput, count: number): CircuitSlot[] {
  const muscles = input.focusMuscles ?? [];
  if (muscles.length === 0) {
    const base = FOCUS_SLOTS[input.focus ?? 'full'];
    if (count <= 2) return [...base];
    const tail: CircuitSlot = base.includes('engine') && count >= 4 ? 'engine' : 'core';
    const order: CircuitSlot[] = [...base.slice(0, Math.max(1, count - 1)), tail, ...base];
    return order.filter((slot, at, all) => all.indexOf(slot) === at);
  }
  const weight = new Map<CircuitSlot, number>();
  muscles.forEach((muscle, at) => {
    // 앞에 있는 부위(그날 주로 쓰는 부위)일수록 무겁게
    const lead = 1 / (1 + at * 0.25);
    for (const [slot, share] of MUSCLE_SLOTS[muscle] ?? []) weight.set(slot, (weight.get(slot) ?? 0) + share * lead);
  });
  const ranked = [...weight.entries()]
    .filter(([slot]) => slot !== 'core')
    .sort((a, b) => b[1] - a[1])
    .map(([slot]) => slot);
  const lead = ranked.slice(0, Math.max(1, count - 1));
  const tail: CircuitSlot = count >= 4 ? (lead.includes('squat') || lead.includes('lunge') ? 'core' : 'engine') : 'core';
  const order: CircuitSlot[] = [...lead, tail, ...ranked.slice(lead.length), 'core', 'engine', 'squat', 'push', 'pull', 'hinge'];
  return order.filter((slot, at, all) => all.indexOf(slot) === at);
}

function moveCount(main: { format: CircuitFormat; shape: CircuitShape; minutes: number }): number {
  if (main.shape === 'chipper') return 5;
  if (main.shape === 'ladder') return main.minutes >= 14 ? 3 : 2;
  if (main.format === 'intervals') return 4;
  if (main.format === 'emom') return main.minutes % 4 === 0 ? 4 : 3;
  if (main.minutes <= 10) return 3;
  if (main.minutes <= 16) return 4;
  return 5;
}

function baseReps(id: string, slot: CircuitSlot, level: TrainingLevel): number {
  const raw = (MOVE_REPS[id] ?? SLOT_REPS[slot]) * LEVEL_FACTOR[level];
  return TIMED.has(id) ? round5(raw) : Math.max(4, Math.round(raw));
}

function makeMove(exercise: Exercise, amount: number, note?: string): CircuitMove {
  const timed = TIMED.has(exercise.id);
  const side = exercise.unilateral || exercise.id === 'side-plank' ? '한쪽씩' : undefined;
  return {
    exerciseId: exercise.id,
    name: exercise.name,
    amount,
    unit: timed ? 'seconds' : 'reps',
    display: timed ? `${amount}초` : `${amount}회`,
    note: [side, note].filter(Boolean).join(' · ') || undefined,
  };
}

/** 한 동작의 쉽게 · 기본 · 어렵게. */
function scalesFor(exercise: Exercise, slot: CircuitSlot, level: TrainingLevel, pool: Pool, factor: number): Record<CircuitScale, CircuitMove> {
  const amount = (id: string) => {
    const reps = baseReps(id, slot, level);
    return TIMED.has(id) ? round5(reps * factor) : Math.max(3, Math.round(reps * factor));
  };
  const base = makeMove(exercise, amount(exercise.id));
  const alt = (list: readonly string[] | undefined) => (list ?? []).find((id) => id !== exercise.id && pool.ok(id));
  const easyId = alt(EASIER[exercise.id]);
  const hardId = alt(HARDER[exercise.id]);
  // 쉬운 동작이 같은 단위로 더 많이(플랭크 25초 > 베어 크롤 15초) 나오지 않게, 어려운 동작은 더 적게 나오지 않게
  const sameUnit = (id: string) => TIMED.has(id) === TIMED.has(exercise.id);
  const easy = easyId
    ? makeMove(pool.get(easyId)!, sameUnit(easyId) ? Math.min(amount(easyId), base.amount) : amount(easyId))
    : makeMove(exercise, TIMED.has(exercise.id) ? round5(base.amount * 0.7) : Math.max(3, Math.round(base.amount * 0.7)));
  const hard = hardId
    ? makeMove(pool.get(hardId)!, sameUnit(hardId) ? Math.max(amount(hardId), base.amount) : amount(hardId))
    : makeMove(exercise, TIMED.has(exercise.id) ? round5(base.amount * 1.3) : Math.max(base.amount + 2, Math.round(base.amount * 1.3)));
  return { easy, base, hard };
}

/** 하고 쉬기 — 분량이 아니라 시간이다. 쉽게 · 어렵게는 동작을 바꾸고, 바꿀 것이 없으면 빠르기를 말한다. */
function timedScales(scales: Record<CircuitScale, CircuitMove>, seconds: number): Record<CircuitScale, CircuitMove> {
  const timed = (move: CircuitMove, note?: string): CircuitMove => ({
    ...move, amount: seconds, unit: 'seconds', display: `${seconds}초 동안`,
    note: [move.note, note].filter(Boolean).join(' · ') || undefined,
  });
  const same = (a: CircuitMove, b: CircuitMove) => a.exerciseId === b.exerciseId;
  return {
    easy: timed(scales.easy, same(scales.easy, scales.base) ? '천천히' : undefined),
    base: timed(scales.base),
    hard: timed(scales.hard, same(scales.hard, scales.base) ? '빠르게' : undefined),
  };
}

/** 기계 · 케이블은 한 바퀴에 하나까지 */
function stationary(exercise: Exercise): boolean {
  return exercise.equipment === 'machine' || exercise.equipment === 'cable';
}

function pickMovements(input: CircuitInput, pool: Pool, count: number): { slot: CircuitSlot; exercise: Exercise }[] {
  const seed = input.benchmark ? 0 : Math.abs(Math.trunc(input.seed ?? 0));
  const picked: { slot: CircuitSlot; exercise: Exercise }[] = [];
  const used = new Set<string>();
  const usedPrimary = new Map<MuscleGroup, number>();
  for (const [at, slot] of slotOrder(input, count).entries()) {
    if (picked.length >= count) break;
    const options = SLOT_MOVES[slot].filter((id) => pool.ok(id) && !used.has(id));
    if (options.length === 0) continue;
    const turn = (seed + at * 7) % options.length;
    const ordered = [...options.slice(turn), ...options.slice(0, turn)];
    const machineTaken = picked.some((item) => stationary(item.exercise));
    const choice = ordered
      .map((id) => pool.get(id)!)
      .find((exercise) => {
        if (machineTaken && stationary(exercise)) return false;
        const primary = primaryOf(exercise);
        // 같은 부위가 셋째로 오지 않게 — 한 바퀴가 한 근육만 태우면 바퀴가 안 돈다
        return !primary || (usedPrimary.get(primary) ?? 0) < 2;
      });
    if (!choice) continue;
    picked.push({ slot, exercise: choice });
    used.add(choice.id);
    const primary = primaryOf(choice);
    if (primary) usedPrimary.set(primary, (usedPrimary.get(primary) ?? 0) + 1);
  }
  return picked;
}

/** 하고 쉬기의 운동 · 쉬기 초 — 20초/10초는 고급 이상만, 초보는 30초/30초에서 시작한다. */
export function intervalTiming(level: TrainingLevel, weekIndex = 0): { workSeconds: number; restSeconds: number } {
  if (level === 'advanced' || level === 'expert') return { workSeconds: 20, restSeconds: 10 };
  if (level === 'beginner' && weekIndex < 2) return { workSeconds: 30, restSeconds: 30 };
  return { workSeconds: 40, restSeconds: 20 };
}

/** 이 단계 · 이 주에 할 수 있는 방식으로 고친다. */
export function allowedFormat(level: TrainingLevel, weekIndex: number, format: CircuitFormat, shape: CircuitShape = 'rounds'): { format: CircuitFormat; shape: CircuitShape } {
  if (level === 'beginner') {
    // 초보에게 빨리 끝내기 · 사다리 · 긴 목록은 주지 않는다 — 속도를 스스로 정하면 자세가 먼저 무너진다
    const early = weekIndex < 2;
    if (format === 'forTime') return { format: early ? 'emom' : 'amrap', shape: 'rounds' };
    if (format === 'amrap' && early) return { format: 'emom', shape: 'rounds' };
    return { format, shape: 'rounds' };
  }
  if (shape === 'ladder' && format !== 'amrap') return { format: 'amrap', shape };
  if (shape === 'chipper' && format !== 'forTime') return { format: 'forTime', shape };
  if ((format === 'emom' || format === 'intervals') && shape !== 'rounds') return { format, shape: 'rounds' };
  return { format, shape };
}

/** 이 단계 · 이 주에 돌리는 방식 목록 — 한 주 안에서 돌고, 주마다 시작 자리가 바뀐다. */
export function circuitFormatsFor(level: TrainingLevel, weekIndex = 0): { format: CircuitFormat; shape: CircuitShape }[] {
  if (level === 'beginner') {
    return weekIndex < 2
      ? [{ format: 'emom', shape: 'rounds' }, { format: 'intervals', shape: 'rounds' }]
      : [{ format: 'emom', shape: 'rounds' }, { format: 'amrap', shape: 'rounds' }, { format: 'intervals', shape: 'rounds' }];
  }
  return [
    { format: 'amrap', shape: 'rounds' },
    { format: 'emom', shape: 'rounds' },
    { format: 'forTime', shape: 'rounds' },
    { format: 'intervals', shape: 'rounds' },
    { format: 'amrap', shape: 'ladder' },
    { format: 'forTime', shape: 'chipper' },
  ];
}

/* ── 이름 붙은 기본 서킷 ───────────────────────────── */

interface BenchmarkSpec { format: CircuitFormat; shape: CircuitShape; minutes: number; rounds?: number }

const BENCHMARKS: Readonly<Record<'beginner' | 'intermediate' | 'advanced', Readonly<Record<1 | 2 | 3, BenchmarkSpec>>>> = {
  beginner: {
    1: { format: 'emom', shape: 'rounds', minutes: 9 },
    2: { format: 'intervals', shape: 'rounds', minutes: 10 },
    3: { format: 'amrap', shape: 'rounds', minutes: 10 },
  },
  intermediate: {
    1: { format: 'amrap', shape: 'rounds', minutes: 12 },
    2: { format: 'emom', shape: 'rounds', minutes: 12 },
    3: { format: 'forTime', shape: 'rounds', minutes: 15, rounds: 3 },
  },
  advanced: {
    1: { format: 'amrap', shape: 'rounds', minutes: 15 },
    2: { format: 'emom', shape: 'rounds', minutes: 16 },
    3: { format: 'forTime', shape: 'rounds', minutes: 18, rounds: 4 },
  },
};

function benchmarkSpec(level: TrainingLevel, number: 1 | 2 | 3): BenchmarkSpec {
  const tier = level === 'beginner' ? 'beginner' : level === 'intermediate' ? 'intermediate' : 'advanced';
  return BENCHMARKS[tier][number];
}

export function benchmarkName(number: number): string {
  return `기본 서킷 ${number}`;
}

/** 이번 주의 기본 서킷 — 4주마다 1 · 2 · 3이 돌아오고, 넷째 주는 쉰다. */
export function benchmarkForWeek(weekIndex: number): 1 | 2 | 3 | null {
  const at = ((Math.trunc(weekIndex) % 4) + 4) % 4;
  return at === 3 ? null : ((at + 1) as 1 | 2 | 3);
}

/* ── 만들기 ─────────────────────────────────────── */

function formatTitle(main: { format: CircuitFormat; shape: CircuitShape; minutes: number; rounds?: number }): string {
  if (main.shape === 'ladder') return `${CIRCUIT_SHAPE_NAMES_KO.ladder} ${main.minutes}분`;
  if (main.shape === 'chipper') return `${CIRCUIT_SHAPE_NAMES_KO.chipper} · 제한 ${main.minutes}분`;
  if (main.format === 'forTime') return `${CIRCUIT_FORMAT_NAMES_KO.forTime} ${main.rounds ?? 3}바퀴 · 제한 ${main.minutes}분`;
  return `${CIRCUIT_FORMAT_NAMES_KO[main.format]} ${main.minutes}분`;
}

function formatHow(main: CircuitMain): string {
  switch (main.format) {
    case 'amrap':
      return main.shape === 'ladder'
        ? `한 바퀴마다 횟수가 ${main.ladderStep ?? 2}회씩 늘어납니다. ${main.minutes}분 동안 어디까지 가는지 봅니다.`
        : `${main.minutes}분 동안 아래 동작을 차례로 돕니다. 한 바퀴를 마칠 때마다 "+1 바퀴"를 누르세요.`;
    case 'emom':
      return '1분마다 새 동작을 시작합니다. 정해진 횟수를 하고 남는 시간에 쉽니다. 화면이 알아서 넘어갑니다.';
    case 'forTime':
      return main.shape === 'chipper'
        ? `긴 목록을 위에서부터 한 번에 끝냅니다. 중간에 쉬어도 되고, ${main.minutes}분이 지나면 멈춥니다.`
        : `아래 동작을 ${main.rounds ?? 3}바퀴, 될 수 있는 대로 빨리 끝냅니다. ${main.minutes}분이 지나면 멈춥니다.`;
    case 'intervals':
      return `${main.workSeconds}초 운동 · ${main.restSeconds}초 쉬기를 번갈아 합니다. 화면이 알아서 넘어갑니다.`;
  }
}

/** 한 바퀴에 걸리는 초 — 빨리 끝내기 바퀴 수를 제한 시간 안에 맞출 때 */
function roundSeconds(movements: readonly CircuitMovement[]): number {
  return movements.reduce((sum, item) => {
    const move = item.scales.base;
    const per = move.unit === 'seconds' ? 1 : item.slot === 'engine' ? 4 : 3;
    const sides = move.note?.includes('한쪽씩') ? 2 : 1;
    return sum + move.amount * per * sides + 10;
  }, 0);
}

function signatureOf(session: Pick<CircuitSession, 'benchmark'> & { main: CircuitMain }): string {
  const main = session.main;
  const moves = main.movements.map((item) => `${item.scales.base.exerciseId}:${item.scales.base.amount}`).join('|');
  return [session.benchmark ? `b${session.benchmark}` : 'd', main.format, main.shape, main.minutes, main.rounds ?? '', main.workSeconds ?? '', moves].join('/');
}

/** 몸통 마무리 — 시간이 4분 넘게 남으면(8분이면 6분). 바닥에서 하는 몸통 동작 둘을 번갈아. */
function coreExtra(input: CircuitInput, pool: Pool, avoid: ReadonlySet<string>, minutes: number): CircuitExtra | null {
  const ids = ['plank', 'dead-bug', 'side-plank', 'bird-dog', 'reverse-crunch', 'crunch']
    .filter((id) => pool.ok(id) && !avoid.has(id))
    .slice(0, 2);
  if (ids.length < 2) return null;
  const timing = input.level === 'beginner' ? { workSeconds: 30, restSeconds: 30 } : { workSeconds: 40, restSeconds: 20 };
  const cycle = timing.workSeconds + timing.restSeconds;
  return {
    title: '몸통 마무리',
    minutes,
    rounds: Math.max(1, Math.round((minutes * 60) / (cycle * ids.length))),
    ...timing,
    moves: ids.map((id) => {
      const exercise = pool.get(id)!;
      return { ...makeMove(exercise, timing.workSeconds), amount: timing.workSeconds, unit: 'seconds' as const, display: `${timing.workSeconds}초 동안` };
    }),
  };
}

/**
 * 하루 서킷을 만든다.
 *
 * 시간: 몸 풀기(2~5분) + 본 운동(단계마다 8~25분) + 몸통 마무리(남으면 4분) + 스트레칭(2~3분)이 쓸 수 있는 시간을
 * 넘지 않게 본 운동 길이를 정한다. 쓸 수 있는 시간이 너무 짧으면 본 운동을 단계의 최소 길이로 두고 그렇다고 알린다.
 */
export function buildCircuit(input: CircuitInput): CircuitSession {
  const level = input.level;
  const week = Math.max(0, Math.trunc(input.weekIndex ?? 0));
  const pool = poolFor(input);
  const budget = Math.max(10, Math.round(input.minutes ?? DEFAULT_CIRCUIT_MINUTES[level]));
  const [mainMin, mainMax] = MAIN_MINUTES[level];
  const benchmark = input.benchmark ?? null;
  const spec = benchmark ? benchmarkSpec(level, benchmark) : null;

  const warmBudget = budget >= 30 ? 300 : budget >= 20 ? 180 : 120;
  const coolBudget = budget >= 25 ? 180 : 120;

  const wanted = spec ?? allowedFormat(level, week, input.format ?? circuitFormatsFor(level, week)[0]!.format, input.shape ?? 'rounds');
  const fixed = allowedFormat(level, week, wanted.format, wanted.shape);
  const format = fixed.format;
  const shape = fixed.shape;
  const timing = format === 'intervals' ? intervalTiming(level, week) : null;

  // 본 운동 길이 — 기본 서킷은 늘 같은 길이(견줄 수 있게)
  const warmMinutesPlan = Math.ceil(warmBudget / 60);
  const coolMinutesPlan = Math.ceil(coolBudget / 60);
  let minutes = spec ? spec.minutes : clamp(budget - warmMinutesPlan - coolMinutesPlan, mainMin, mainMax);
  if (!spec && format === 'emom') {
    // 1분마다는 동작 수의 배수로 — 동작마다 같은 바퀴 수
    const n = minutes >= 12 && minutes % 4 === 0 ? 4 : 3;
    minutes = Math.max(mainMin, minutes - (minutes % n));
    if (minutes > mainMax) minutes -= n;
  }

  const count = moveCount({ format, shape, minutes });
  const picks = pickMovements({ ...input, focus: input.focus ?? 'full', focusMuscles: benchmark ? [] : input.focusMuscles }, pool, count);
  const factor = shape === 'chipper' ? 2.5 : format === 'emom' ? 0.9 : 1;
  let movements: CircuitMovement[] = picks.map(({ slot, exercise }) => {
    const scales = scalesFor(exercise, slot, level, pool, factor);
    if (shape === 'chipper') {
      for (const scale of CIRCUIT_SCALES) {
        const move = scales[scale];
        if (move.unit === 'reps') {
          const amount = Math.max(5, Math.round(move.amount / 5) * 5);
          scales[scale] = { ...move, amount, display: `${amount}회` };
        }
      }
    }
    return { slot, scales };
  });
  if (format === 'intervals' && timing) {
    movements = movements.map((item) => ({ ...item, scales: timedScales(item.scales, timing.workSeconds) }));
  }

  let ladderStep: number | undefined;
  if (shape === 'ladder') {
    ladderStep = 2;
    movements = movements.map((item) => {
      const scales = { ...item.scales };
      for (const scale of CIRCUIT_SCALES) {
        const move = scales[scale];
        if (move.unit !== 'reps') continue;
        const step = scale === 'easy' ? 1 : scale === 'hard' ? 3 : 2;
        scales[scale] = { ...move, amount: step, display: `${step}회부터 바퀴마다 +${step}` };
      }
      return { ...item, scales };
    });
  }

  const draft: CircuitMain = {
    format, shape, minutes, movements, ladderStep, title: '', how: '',
    ...(timing ?? {}),
  };
  if (format === 'forTime') {
    if (shape === 'chipper') draft.rounds = 1;
    else {
      const each = roundSeconds(movements);
      draft.rounds = spec?.rounds ?? clamp(Math.floor((minutes * 60 * 0.8) / Math.max(60, each)), 2, 6);
    }
  }
  draft.title = formatTitle(draft);
  draft.how = formatHow(draft);

  // 몸 풀기 · 스트레칭 — 오늘 쓰는 부위로
  const exercises = picks.map((item) => item.exercise);
  const targetMuscles = MUSCLE_GROUPS.filter((muscle) => exercises.some((exercise) => (exercise.contribution[muscle] ?? 0) >= 0.5));
  const trained = [...targetMuscles].sort((a, b) =>
    exercises.reduce((sum, item) => sum + (item.contribution[b] ?? 0), 0) - exercises.reduce((sum, item) => sum + (item.contribution[a] ?? 0), 0));
  const warmup = mobilityFor(trained, { equipment: input.equipmentIds ? [...input.equipmentIds] : undefined, budgetSeconds: warmBudget });
  const cooldown = cooldownFor(trained, coolBudget);
  const warmupMinutes = Math.max(1, Math.round(warmup.reduce((sum, step) => sum + step.seconds, 0) / 60));
  const cooldownMinutes = Math.max(1, Math.round(cooldown.reduce((sum, step) => sum + step.seconds, 0) / 60));

  const left = budget - warmupMinutes - cooldownMinutes - minutes;
  const extra = left >= 4 && !(level === 'beginner' && week < 2)
    ? coreExtra(input, pool, new Set(exercises.map((item) => item.id)), left >= 8 ? 6 : 4)
    : null;
  const totalMinutes = warmupMinutes + minutes + (extra?.minutes ?? 0) + cooldownMinutes;

  const notes: string[] = ['근육 키우는 세트 수에는 들어가지 않고 피로에만 더합니다. 한 주 약속에는 운동한 날로 셉니다.'];
  if (movements.length < 3) {
    notes.push(movements.length === 0
      ? '조건에 맞는 동작을 찾지 못했습니다. 기구를 더 등록하거나 아픈 곳 설정을 확인해 주세요.'
      : `쓸 수 있는 동작이 ${movements.length}개뿐입니다. 기구를 더 등록하면 구성이 다양해집니다.`);
  }
  if (level === 'beginner') notes.push('처음에는 횟수보다 자세가 먼저입니다. 힘들면 동작을 "쉽게"로 바꾸세요.');
  if ((input.pain ?? []).some((report) => report.score >= 1)) notes.push('아프다고 하신 곳에 부담이 큰 동작과 뛰는 동작은 뺐습니다.');
  if (format === 'forTime') notes.push('자세가 무너지면 잠깐 쉬었다 하세요. 빨리보다 끝까지가 먼저입니다.');
  if (totalMinutes > budget) notes.push(`시간이 짧아 본 운동을 가장 짧은 ${minutes}분으로 잡았습니다.`);

  const session: CircuitSession = {
    name: benchmark ? benchmarkName(benchmark) : '오늘의 서킷',
    benchmark,
    date: input.date,
    focus: input.focus ?? 'full',
    warmup,
    warmupMinutes,
    main: draft,
    extra,
    cooldown,
    cooldownMinutes,
    totalMinutes,
    targetMuscles,
    fatigueLoad: Math.round((minutes * 0.4 + (extra ? extra.minutes * 0.2 : 0)) * 10) / 10,
    notes,
    signature: '',
  };
  session.signature = signatureOf(session);
  return session;
}

/** 오늘 근력 운동 대신 — 같은 부위를 쓰는 비슷한 길이의 서킷. 방식은 날마다 돌고, 고르면 그것으로. */
export function swapCircuit(input: Omit<CircuitInput, 'benchmark'> & { turn?: number }): CircuitSession {
  const list = circuitFormatsFor(input.level, input.weekIndex ?? 0);
  const pick = list[(Math.abs(Math.trunc(input.seed ?? 0)) + Math.abs(Math.trunc(input.turn ?? 0))) % list.length]!;
  return buildCircuit({ ...input, benchmark: null, format: input.format ?? pick.format, shape: input.format ? input.shape : pick.shape });
}

/* ── 한 주 ─────────────────────────────────────── */

export interface CircuitWeekDay {
  kind: 'circuit' | 'strength';
  format?: CircuitFormat;
  shape?: CircuitShape;
  focus?: CircuitFocus;
  benchmark?: 1 | 2 | 3 | null;
}

export interface CircuitWeekPlan {
  days: CircuitWeekDay[];
  strengthDays: number;
  circuitDays: number;
  summary: string;
}

/** 서킷 위주일 때 한 주의 근력 날 수 — 1~2번. 하루만 하면 그날은 서킷이다. */
export function strengthDaysFor(daysPerWeek: number): number {
  if (daysPerWeek <= 1) return 0;
  return daysPerWeek >= 5 ? 2 : 1;
}

/** 근력 날을 둘 자리 — 서킷 사이에 끼워 같은 날 두 번 몰리지 않게 */
const STRENGTH_AT: Readonly<Record<number, readonly number[]>> = {
  1: [], 2: [1], 3: [1], 4: [1], 5: [1, 3], 6: [1, 4], 7: [1, 4],
};

const FOCUS_TURN: readonly CircuitFocus[] = ['full', 'lower', 'upper'];

/**
 * 한 주 — 몇 번째 운동이 서킷이고 몇 번째가 근력인지, 서킷마다 방식 · 쓰는 곳.
 * 'mixed'(지금 방식)는 모두 근력 날이다(서킷은 근력 운동 뒤 마무리로 붙는다).
 * 서킷 날마다 방식과 쓰는 곳을 돌리고, 주마다 시작 자리를 바꾼다. 그 주 첫 서킷은 기본 서킷(4주에 세 번).
 */
export function circuitWeekPlan(input: { daysPerWeek: number; level: TrainingLevel; weekIndex: number; style: CircuitStyle }): CircuitWeekPlan {
  const days = clamp(Math.round(input.daysPerWeek), 1, 7);
  if (input.style !== 'circuit') {
    return {
      days: Array.from({ length: days }, () => ({ kind: 'strength' as const })),
      strengthDays: days, circuitDays: 0,
      summary: '근력 운동을 짧게 하고 끝에 서킷을 붙입니다.',
    };
  }
  const week = Math.max(0, Math.trunc(input.weekIndex));
  const strengthAt = new Set(STRENGTH_AT[days] ?? [1]);
  const formats = circuitFormatsFor(input.level, week);
  const benchmark = benchmarkForWeek(week);
  let circuitNo = 0;
  const plan: CircuitWeekDay[] = [];
  for (let at = 0; at < days; at += 1) {
    if (strengthAt.has(at)) { plan.push({ kind: 'strength' }); continue; }
    if (circuitNo === 0 && benchmark) {
      plan.push({ kind: 'circuit', benchmark, focus: 'full' });
    } else {
      const pick = formats[(week + circuitNo) % formats.length]!;
      plan.push({ kind: 'circuit', format: pick.format, shape: pick.shape, focus: FOCUS_TURN[(week + circuitNo) % FOCUS_TURN.length], benchmark: null });
    }
    circuitNo += 1;
  }
  const strengthDays = plan.filter((day) => day.kind === 'strength').length;
  return {
    days: plan,
    strengthDays,
    circuitDays: plan.length - strengthDays,
    summary: strengthDays > 0
      ? `한 주 ${days}번 중 ${plan.length - strengthDays}번은 서킷, ${strengthDays}번은 짧은 근력 운동입니다.`
      : `한 주 ${days}번 모두 서킷입니다.`,
  };
}

/* ── 시계 ─────────────────────────────────────── */

/** 본 운동 전체 초 — 하고 쉬기는 마지막 쉬기를 뺀다. */
export function circuitSeconds(main: Pick<CircuitMain, 'format' | 'minutes' | 'workSeconds' | 'restSeconds'>): number {
  if (main.format === 'intervals') {
    const cycle = (main.workSeconds ?? 30) + (main.restSeconds ?? 30);
    const rounds = Math.max(1, Math.floor((main.minutes * 60) / cycle));
    return rounds * cycle - (main.restSeconds ?? 30);
  }
  return Math.max(60, Math.round(main.minutes * 60));
}

/** 하고 쉬기의 운동 구간 수 */
export function intervalCount(main: Pick<CircuitMain, 'minutes' | 'workSeconds' | 'restSeconds'>): number {
  const cycle = (main.workSeconds ?? 30) + (main.restSeconds ?? 30);
  return Math.max(1, Math.floor((main.minutes * 60) / cycle));
}

export interface CircuitClock {
  elapsed: number;
  total: number;
  /** 남은 초(빨리 끝내기는 제한까지) */
  left: number;
  over: boolean;
  /** 1분마다 · 하고 쉬기 — 지금 몇 번째 구간인가(0부터) */
  segment: number;
  /** 하고 쉬기 — 지금 운동 중인가(쉬는 중이면 false) */
  working: boolean;
  /** 이 구간이 끝나기까지 초 */
  segmentLeft: number;
  /** 지금(쉬는 중이면 다음) 할 동작 — 1분마다 · 하고 쉬기 */
  movementIndex: number;
}

/** 시작한 뒤 지난 초로 지금 자리를 계산한다. 시계가 들고 있는 것은 시작한 시각뿐이다 — 화면이 꺼졌다 켜져도 맞다. */
export function circuitClock(main: CircuitMain, elapsedSeconds: number): CircuitClock {
  const total = circuitSeconds(main);
  const elapsed = Math.max(0, elapsedSeconds);
  const over = elapsed >= total;
  const at = Math.min(elapsed, total);
  const count = Math.max(1, main.movements.length);
  const out: CircuitClock = {
    elapsed, total, left: Math.max(0, total - elapsed), over,
    segment: 0, working: true, segmentLeft: Math.max(0, total - at), movementIndex: 0,
  };
  if (main.format === 'emom') {
    const segment = Math.min(Math.floor(at / 60), Math.max(0, main.minutes - 1));
    out.segment = segment;
    out.segmentLeft = over ? 0 : 60 - (at - segment * 60);
    out.movementIndex = segment % count;
  } else if (main.format === 'intervals') {
    const work = main.workSeconds ?? 30;
    const cycle = work + (main.restSeconds ?? 30);
    const segment = Math.min(Math.floor(at / cycle), intervalCount(main) - 1);
    const within = at - segment * cycle;
    out.segment = segment;
    out.working = over || within < work;
    out.segmentLeft = over ? 0 : out.working ? work - within : cycle - within;
    out.movementIndex = (out.working ? segment : segment + 1) % count;
  }
  return out;
}

export type CircuitCueKind = 'start' | 'beep' | 'go' | 'next' | 'rest' | 'half' | 'oneMinute' | 'thirtySec' | 'last' | 'last10' | 'done';

export interface CircuitCue {
  /** 본 운동을 시작한 때부터 초 */
  at: number;
  kind: CircuitCueKind;
  /** next · rest · go — 그때 할 동작 */
  movementIndex?: number;
}

/**
 * 언제 무엇을 알릴지 — 화면이 켜져 있을 때 말하는 것과, 화면이 꺼질 때 미리 만드는 소리 파일이 같은 표를 쓴다.
 *   · 시작 · 끝(끝 3 · 2 · 1초 전 삑)
 *   · 1분마다: 바뀌기 3 · 2 · 1초 전 삑, 바뀌는 순간 다음 동작 이름, 마지막 1분에 "마지막"
 *   · 하고 쉬기: 쉬기 시작에 다음 동작 이름, 운동 3 · 2 · 1초 전 삑, 운동 시작, 마지막 구간에 "마지막"
 *   · 시간 안에 최대한 · 빨리 끝내기: 절반 · 1분 남음 · 30초 남음 · 10초
 * 짧은 운동에서는 겹치는 말을 뺀다.
 */
export function circuitCues(main: CircuitMain): CircuitCue[] {
  const total = circuitSeconds(main);
  const out: CircuitCue[] = [{ at: 0, kind: 'start', movementIndex: 0 }];
  const count = Math.max(1, main.movements.length);
  const beeps = (at: number) => { for (const back of [3, 2, 1]) if (at - back > 0) out.push({ at: at - back, kind: 'beep' }); };
  if (main.format === 'emom') {
    for (let minute = 1; minute < main.minutes; minute += 1) {
      beeps(minute * 60);
      out.push({ at: minute * 60, kind: 'next', movementIndex: minute % count });
      if (minute === main.minutes - 1 && main.minutes >= 3) out.push({ at: minute * 60 + 4, kind: 'last' });
    }
    if (total >= 120) out.push({ at: total - 30, kind: 'thirtySec' });
  } else if (main.format === 'intervals') {
    const work = main.workSeconds ?? 30;
    const cycle = work + (main.restSeconds ?? 30);
    const rounds = intervalCount(main);
    for (let segment = 0; segment < rounds; segment += 1) {
      const start = segment * cycle;
      if (segment > 0) {
        beeps(start);
        out.push({ at: start, kind: 'go', movementIndex: segment % count });
      }
      if (segment === rounds - 1 && rounds >= 3) out.push({ at: start + 1, kind: 'last' });
      if (segment < rounds - 1) out.push({ at: start + work, kind: 'rest', movementIndex: (segment + 1) % count });
    }
  } else {
    if (total >= 120) out.push({ at: Math.round(total / 2), kind: 'half' });
    if (total >= 180) out.push({ at: total - 60, kind: 'oneMinute' });
    if (total >= 90) out.push({ at: total - 30, kind: 'thirtySec' });
    if (total >= 30) out.push({ at: total - 10, kind: 'last10' });
  }
  beeps(total);
  out.push({ at: total, kind: 'done' });
  return out.sort((a, b) => a.at - b.at);
}

/** 사다리 — 이 바퀴(0부터)에 할 분량. 시간으로 세는 동작은 그대로. */
export function moveForRound(main: Pick<CircuitMain, 'shape'>, move: CircuitMove, round: number): CircuitMove {
  if (main.shape !== 'ladder' || move.unit !== 'reps') return move;
  const amount = move.amount * (Math.max(0, Math.trunc(round)) + 1);
  return { ...move, amount, display: `${amount}회` };
}

/* ── 기록 ─────────────────────────────────────── */

export interface CircuitResult {
  id: string;
  /** YYYY-MM-DD */
  date: string;
  name: string;
  benchmark: number | null;
  signature: string;
  format: CircuitFormat;
  shape: CircuitShape;
  minutes: number;
  /** 시간 안에 최대한 · 빨리 끝내기 — 마친 바퀴, 남은 반복 */
  rounds?: number;
  extraReps?: number;
  /** 빨리 끝내기 — 끝낸 초. 제한 시간에 닿았으면 capped */
  seconds?: number;
  capped?: boolean;
  /** 1분마다 · 하고 쉬기 — 끝까지 했는가, 아니면 몇 초에서 멈췄는가 */
  completed?: boolean;
  stoppedAtSecond?: number;
  /** 동작마다 고른 강도(기본 동작 id → 쉽게 · 기본 · 어렵게) */
  scales: Record<string, CircuitScale>;
  /** 실제로 한 동작 한 줄씩 — "고블릿 스쿼트 12회" */
  moves: string[];
  fatigueLoad: number;
}

export interface CircuitScore {
  rounds?: number;
  extraReps?: number;
  seconds?: number;
  capped?: boolean;
  completed?: boolean;
  stoppedAtSecond?: number;
}

/** 강도를 고른 결과를 기록으로 남긴다. 방식에 맞지 않는 칸은 담지 않는다. */
export function recordCircuit(session: CircuitSession, score: CircuitScore, scales: Readonly<Record<string, CircuitScale>> = {}, id?: string): CircuitResult {
  const main = session.main;
  const picked: Record<string, CircuitScale> = {};
  const moves = main.movements.map((item) => {
    const key = item.scales.base.exerciseId;
    const scale = scales[key] ?? 'base';
    picked[key] = scale;
    const move = item.scales[scale];
    return `${move.name} ${move.display}`;
  });
  const base: CircuitResult = {
    id: id ?? `circuit-${session.date}-${Date.now().toString(36)}`,
    date: session.date,
    name: session.name,
    benchmark: session.benchmark,
    signature: session.signature,
    format: main.format,
    shape: main.shape,
    minutes: main.minutes,
    scales: picked,
    moves,
    fatigueLoad: session.fatigueLoad,
  };
  const whole = (value: number | undefined, max: number) =>
    value === undefined || !Number.isFinite(value) ? undefined : Math.max(0, Math.min(max, Math.round(value)));
  const total = circuitSeconds(main);
  // 중간에 그만둔 때(초) — 어느 방식이든 그만둔 자리까지가 기록이다
  const stopped = whole(score.stoppedAtSecond, total);
  const rounds = { rounds: whole(score.rounds, 999) ?? 0, extraReps: whole(score.extraReps, 999) ?? 0 };
  if (main.format === 'amrap') {
    return { ...base, ...rounds, ...(stopped !== undefined ? { stoppedAtSecond: stopped } : {}) };
  }
  if (main.format === 'forTime') {
    const cap = main.minutes * 60;
    if (stopped !== undefined) return { ...base, seconds: stopped, capped: true, stoppedAtSecond: stopped, ...rounds };
    const seconds = whole(score.seconds, cap) ?? cap;
    const capped = Boolean(score.capped) || seconds >= cap;
    return { ...base, seconds, capped, ...(capped ? rounds : {}) };
  }
  const completed = score.completed !== false && stopped === undefined;
  return { ...base, completed, ...(completed ? {} : { stoppedAtSecond: stopped ?? 0 }) };
}

function clockText(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** 기록 한 줄 — "7바퀴 + 12회" · "12:34" · "12분 끝까지" */
export function circuitResultText(result: Pick<CircuitResult, 'format' | 'rounds' | 'extraReps' | 'seconds' | 'capped' | 'completed' | 'stoppedAtSecond' | 'minutes'>): string {
  const rounds = (r: number | undefined, extra: number | undefined) => `${r ?? 0}바퀴${extra ? ` + ${extra}회` : ''}`;
  const stoppedAt = result.stoppedAtSecond === undefined ? '' : `${Math.max(1, Math.floor(result.stoppedAtSecond / 60))}분에서 멈춤`;
  if (result.format === 'amrap') return rounds(result.rounds, result.extraReps) + (stoppedAt ? ` · ${stoppedAt}` : '');
  if (result.format === 'forTime') {
    if (stoppedAt) return `${rounds(result.rounds, result.extraReps)} · ${stoppedAt}`;
    if (result.capped) return `제한 ${clockText(result.minutes * 60)} · ${rounds(result.rounds, result.extraReps)}`;
    return clockText(result.seconds ?? 0);
  }
  if (result.completed === false) return stoppedAt || '1분에서 멈춤';
  return `${result.minutes}분 끝까지`;
}

/** 견줄 수 있는 숫자 하나 — 빨리 끝내기는 작을수록(제한에 닿으면 크게), 나머지는 클수록 좋다. */
function scoreOf(result: CircuitResult): number {
  if (result.format === 'amrap') return (result.rounds ?? 0) + (result.extraReps ?? 0) / 1000;
  if (result.format === 'forTime') return result.capped ? 100000 - (result.rounds ?? 0) * 100 - (result.extraReps ?? 0) / 10 : (result.seconds ?? 0);
  return result.completed === false ? (result.stoppedAtSecond ?? 0) : 100000;
}

export interface CircuitComparison {
  previous?: CircuitResult;
  trend?: 'better' | 'same' | 'worse';
  /** 지난번과 강도(쉽게 · 어렵게)가 다르다 */
  scaleChanged?: boolean;
  text: string;
}

/**
 * 같은 구성(기본 서킷 · 같은 동작 · 같은 길이)의 지난 기록과 견준다. 구성이 다르면 견주지 않는다 — 동작이 다르면
 * 바퀴 수를 견줘도 거짓말이 된다. 강도를 바꿨으면 숫자는 보여 주되 그렇다고 말한다.
 */
export function compareCircuit(current: CircuitResult, history: readonly CircuitResult[]): CircuitComparison {
  const same = history
    .filter((item) => item.signature === current.signature && item.id !== current.id && item.date <= current.date)
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  const previous = same[0];
  if (!previous) {
    return { text: current.benchmark ? `${current.name}는 4주 뒤에 다시 합니다. 그때 오늘과 견줘 드립니다.` : '' };
  }
  const now = scoreOf(current);
  const then = scoreOf(previous);
  const lower = current.format === 'forTime';
  const trend: CircuitComparison['trend'] = now === then ? 'same' : (lower ? now < then : now > then) ? 'better' : 'worse';
  const scaleChanged = Object.keys(current.scales).some((key) => (previous.scales[key] ?? 'base') !== current.scales[key]);
  const verdict = trend === 'better' ? '나아졌습니다' : trend === 'worse' ? '지난번보다 조금 못했습니다' : '같습니다';
  return {
    previous, trend, scaleChanged,
    text: `지난번 ${circuitResultText(previous)} → 오늘 ${circuitResultText(current)} — ${verdict}` +
      (scaleChanged ? ' (강도가 지난번과 다릅니다)' : ''),
  };
}

/** 기본 서킷 하나의 지난 기록 — 최근 것부터. */
export function benchmarkHistory(history: readonly CircuitResult[], number: number): CircuitResult[] {
  return history
    .filter((item) => item.benchmark === number)
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

/** 저장소에서 읽은 기록이 모양이 맞는가 — 백업 · 동기화로 들어온 것을 믿지 않는다. */
export function isCircuitResult(value: unknown): value is CircuitResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return typeof item.id === 'string' && typeof item.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(item.date) &&
    typeof item.name === 'string' && typeof item.signature === 'string' &&
    ['amrap', 'emom', 'forTime', 'intervals'].includes(item.format as string) &&
    typeof item.minutes === 'number' && item.minutes > 0 && item.minutes <= 120;
}

/* ── 코치 말 ─────────────────────────────────────── */

/*
 * 서킷에서 새로 하는 말은 여섯 가지뿐이다. 시작 · 절반 · 1분 남음 · 10초는 마무리 운동 말(ptSession의
 * finisherCueLine)을, 몸 풀기 · 스트레칭은 PT 말을, 동작 이름 · 숫자는 있는 조각을 그대로 쓴다.
 */
type ByStyle<T> = Readonly<Record<CoachStyle, T>>;

/** 방식을 말로 — 마무리 운동 소개(finisherIntroLine)와 같은 말이라 조각이 이미 있다 */
const FORMAT_SAID: Readonly<Record<CircuitFormat, string>> = {
  amrap: '시간 안에 최대한 많이',
  emom: '매 분 정해진 만큼',
  forTime: '빨리 끝내기',
  intervals: '하고 쉬기 반복',
};

const INTRO_HEAD: ByStyle<string> = {
  tough: '본 운동이다.',
  energetic: '이제 본 운동이에요!',
  gentle: '이제 본 운동입니다.',
  fun: '이제 본 게임이에요!',
};

const NEXT_HEAD: ByStyle<string> = {
  tough: '다음 동작.',
  energetic: '다음 동작이에요!',
  gentle: '다음 동작입니다.',
  fun: '다음 타자 나와요!',
};

export type CircuitMoment = 'thirtySec' | 'last' | 'done' | 'round';

const CIRCUIT_CUES: Readonly<Record<CircuitMoment, ByStyle<string>>> = {
  thirtySec: {
    tough: '30초 남았다. 끝까지 밀어.',
    energetic: '30초 남았어요! 힘내요!',
    gentle: '30초 남았습니다. 자세를 지키며 가세요.',
    fun: '30초 남았어요. 노래 한 소절이면 끝나요.',
  },
  last: {
    tough: '마지막이다. 다 쏟아.',
    energetic: '마지막이에요! 끝까지 가요!',
    gentle: '마지막입니다. 끝까지 차분하게 가세요.',
    fun: '마지막 판이에요! 박수 받을 준비 하세요.',
  },
  done: {
    tough: '끝! 잘 버텼다. 숨 골라.',
    energetic: '끝! 정말 잘했어요! 숨 고르세요.',
    gentle: '끝났습니다. 천천히 걸으며 숨을 고르세요.',
    fun: '끝! 살아남으셨어요. 숨 고르고 물 한 모금 해요.',
  },
  round: {
    tough: '좋아, 한 바퀴 더.',
    energetic: '한 바퀴 끝! 좋아요!',
    gentle: '한 바퀴 하셨습니다. 좋습니다.',
    fun: '한 바퀴 클리어! 다음 판 가요.',
  },
};

/** 본 운동 소개 — "이제 본 운동입니다. 시간 안에 최대한 많이, 12분." */
export function circuitIntroLine(style: CoachStyle, format: CircuitFormat, minutes: number): string {
  return `${INTRO_HEAD[style]} ${FORMAT_SAID[format]}, ${Math.max(1, Math.round(minutes))}분.`;
}

/** 다음 동작 — "다음 동작입니다. 고블릿 스쿼트 12회." 분량은 회 · 초만 말한다("한쪽씩"은 화면에). */
export function circuitNextLine(style: CoachStyle, move: Pick<CircuitMove, 'name' | 'amount' | 'unit'>): string {
  return `${NEXT_HEAD[style]} ${move.name} ${Math.max(1, Math.round(move.amount))}${move.unit === 'seconds' ? '초' : '회'}.`;
}

export function circuitCueLine(style: CoachStyle, moment: CircuitMoment): string {
  return CIRCUIT_CUES[moment][style];
}

/** 새로 생긴 말 전부 — 목소리 조각 목록(speechCorpus)과 보고에 쓴다 */
export function circuitSpeechSamples(style: CoachStyle): string[] {
  const out: string[] = [];
  for (const format of Object.keys(FORMAT_SAID) as CircuitFormat[]) {
    for (const minutes of [8, 9, 10, 12, 14, 15, 16, 18, 20, 24, 25]) out.push(circuitIntroLine(style, format, minutes));
  }
  for (const moment of Object.keys(CIRCUIT_CUES) as CircuitMoment[]) out.push(circuitCueLine(style, moment));
  return out;
}

/** 서킷에 나올 수 있는 동작 전부 — 다음 동작 말에 이름이 들어간다 */
export const CIRCUIT_MOVE_IDS: readonly string[] = [
  ...new Set([...Object.values(SLOT_MOVES).flat(), ...Object.values(EASIER).flat(), ...Object.values(HARDER).flat(),
    'plank', 'dead-bug', 'side-plank', 'bird-dog', 'reverse-crunch', 'crunch']),
];
