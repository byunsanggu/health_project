import { exerciseById } from './exercises.ts';
import { HEAVY_PULLS } from './exercises.ts';
import { heavyPullRange, isStrengthLift } from './onboarding.ts';
import type { RepRange } from './load.ts';
import { workingWeight, oneRepMax } from './repmax.ts';
import type { PlannedExercise, SessionTemplate } from './session.ts';
import { styleProfile, type TrainingStyle } from './styles.ts';
import type { SessionLog, SetLog } from './types.ts';
import { weekStart } from './volume.ts';

/**
 * 반복 수를 사람에게 맞춘다 — 블록 유형 · 종목별로 정한 반복 · "바꿀까요?" ·
 * 주 1회 무거운 세트.
 */


/** 종목별로 직접 정한 반복 수. 키는 종목 id. */
export type RepOverrides = Readonly<Record<string, RepRange>>;

/** 고를 수 있는 반복 칸 — 종목별 반복 수와 "바꿀까요?"가 같은 칸을 쓴다. */
export const REP_PRESETS: readonly RepRange[] = [
  { min: 1, max: 3 },
  { min: 3, max: 5 },
  { min: 4, max: 6 },
  { min: 6, max: 10 },
  { min: 8, max: 12 },
  { min: 10, max: 15 },
  { min: 12, max: 20 },
];

export function repLabel(range: RepRange): string {
  return range.min === range.max ? `${range.max}회` : `${range.min}~${range.max}회`;
}

export function sameRange(a: RepRange | undefined, b: RepRange | undefined): boolean {
  return Boolean(a && b && a.min === b.min && a.max === b.max);
}

/** 직접 정한 반복 수로 쓸 수 있는 값인가 — 1~30회, 아래가 위보다 크지 않게. */
export function cleanRange(range: unknown): RepRange | null {
  if (!range || typeof range !== 'object') return null;
  const { min, max } = range as { min?: unknown; max?: unknown };
  if (typeof min !== 'number' || typeof max !== 'number') return null;
  const lo = Math.round(min);
  const hi = Math.round(max);
  if (!(lo >= 1 && hi <= 30 && lo <= hi)) return null;
  return { min: lo, max: hi };
}

/**
 * 오늘 템플릿의 반복 범위를 정한다. 앞에 있는 것이 이긴다.
 *
 *   1. 사람이 그 종목에 직접 정한 반복 — 바꿨으면 그 숫자대로 한다.
 *   2. 블록 유형(근력 · 고밀도 · 한계 돌파 · 컨디셔닝)의 반복. 예전에는 블록을
 *      바꾸면 "8-12회로 바꿨습니다"라고 적기만 하고 처방은 그대로였다.
 *      근비대 블록은 기본이라 프로그램의 반복(평소 스타일)을 그대로 둔다.
 *   3. 프로그램에 적힌 반복(평소 스타일 · 목표).
 *
 * 내 루틴(fixed)은 사용자가 정한 반복 그대로 둔다.
 */
export function applyRepRules(
  template: SessionTemplate,
  options: { style?: TrainingStyle; overrides?: RepOverrides } = {},
): SessionTemplate {
  if (template.fixed) return template;
  const overrides = options.overrides ?? {};
  const style = options.style ?? 'hypertrophy';
  const profile = style === 'hypertrophy' ? null : styleProfile(style);
  return {
    ...template,
    slots: template.slots.map((slot) => {
      const own = cleanRange(overrides[slot.exerciseId]);
      if (own) return { ...slot, repRange: own };
      if (!profile) return slot;
      const exercise = exerciseById(slot.exerciseId);
      if (!exercise) return slot;
      const role = slot.role ?? (exercise.pattern === 'isolation' || exercise.pattern === 'core' ? 'isolation' : 'primary');
      /*
       * 근력 · 한계 돌파 블록의 저반복은 바벨 메인에만. 덤벨 · 머신 주 종목을
       * 1~3회로 하면 무게보다 자세가 먼저 무너진다 — 보조 칸의 반복을 쓴다.
       */
      const lowRep = style === 'strength' || style === 'peak';
      const pick = role === 'primary' && lowRep && !isStrengthLift(exercise) ? 'accessory' : role;
      return { ...slot, repRange: heavyPullRange(exercise, profile.repRanges[pick]) };
    }),
  };
}

/* ── "바꿀까요?" ───────────────────────────────────── */

export interface RepSuggestion {
  exerciseId: string;
  /** 지금 처방 */
  current: RepRange;
  /** 바꾸자고 할 칸 */
  suggested: RepRange;
  /** 최근에 실제로 한 반복 — 가장 적게 · 가장 많이 */
  did: RepRange;
  sessions: number;
  /** 처방보다 많이 했나(more) 적게 했나(fewer) */
  direction: 'more' | 'fewer';
}

/** 이만큼 넘게 해야 "평소 더 많이 하신다"로 본다 — 한두 개 넘친 건 그냥 잘된 날이다. */
const OVER_BY = 2;
/** 최근 몇 번을 보나. 그 번수 모두 넘어야 묻는다. */
const LOOK_BACK = 2;

/**
 * 처방보다 늘 많이 하는 종목이면 그 사람의 반복 칸을 제안한다.
 *
 * 묻기만 한다. 답이 없으면 아무것도 바꾸지 않는다 — 처방은 처방대로 가고, 무게
 * 진행(다 채우면 무게를 올린다)이 알아서 범위 안으로 데려온다. 사람이 바꾸면
 * 그때부터 그 숫자대로 한다(applyRepRules의 1번).
 */
export function suggestRepRange(
  history: readonly SessionLog[],
  exerciseId: string,
  current: RepRange,
  beforeDate: string,
): RepSuggestion | null {
  const sessions = history
    .filter((session) => session.date < beforeDate)
    .map((session) => ({
      date: session.date,
      sets: session.sets.filter((set) => set.exerciseId === exerciseId && !set.warmup && !set.top && set.reps > 0),
    }))
    .filter((session) => session.sets.length > 0)
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .slice(0, LOOK_BACK);
  if (sessions.length < LOOK_BACK) return null;

  const medians = sessions.map((session) => median(session.sets.map((set) => set.reps)));
  const more = medians.every((value) => value >= current.max + OVER_BY);
  /*
   * 적게 한 쪽도 묻는다 — 일부러 무겁게 드는 사람이 있다. 다만 무거워서 못 채운
   * 날일 수도 있으니(그러면 다음번에 무게가 저절로 내려간다) 묻기만 한다.
   */
  const fewer = medians.every((value) => value <= current.min - OVER_BY);
  if (!more && !fewer) return null;

  const all = sessions.flatMap((session) => session.sets.map((set) => set.reps));
  const typical = median(all);
  // 1~3회는 무거운 세트 칸이다 — 그걸 평소 반복으로 권하지 않는다
  const usable = REP_PRESETS.filter((range) => range.min > 1 &&
    (more ? range.max > current.max : range.min < current.min));
  const suggested = usable
    .filter((range) => range.min <= typical && typical <= range.max)
    .sort((a, b) => Math.abs((a.min + a.max) / 2 - typical) - Math.abs((b.min + b.max) / 2 - typical))[0]
    // 칸 밖(20회 넘게 · 3회 아래)이면 그쪽 끝 칸
    ?? (more ? usable[usable.length - 1] : usable[0]);
  if (!suggested || sameRange(suggested, current)) return null;
  return {
    exerciseId,
    current,
    suggested,
    did: { min: Math.min(...all), max: Math.max(...all) },
    sessions: sessions.length,
    direction: more ? 'more' : 'fewer',
  };
}

export interface RepStyleSuggestion {
  /** 바꾸자고 할 평소 반복 스타일 */
  style: 'light' | 'heavy';
  /** 그렇게 한 종목들 */
  exerciseIds: string[];
}

/** 종목 하나가 아니라 여러 종목이 같은 쪽이면 "평소 반복 스타일"을 묻는다. */
const STYLE_MIN_EXERCISES = 3;

/**
 * 종목마다 따로 물으면 종목 수만큼 묻게 된다. 프로그램의 종목 셋 이상이 같은
 * 쪽(늘 많이 · 늘 적게)이면 그건 종목 탓이 아니라 그 사람의 방식이다 — 스타일
 * 하나를 바꾸자고 한 번 묻는다. 직접 반복을 정한 종목은 세지 않는다.
 */
export function suggestRepStyle(
  history: readonly SessionLog[],
  templates: readonly SessionTemplate[],
  overrides: RepOverrides,
  currentStyle: string | undefined,
  beforeDate: string,
): RepStyleSuggestion | null {
  const seen = new Set<string>();
  const more: string[] = [];
  const fewer: string[] = [];
  for (const template of templates) {
    if (template.fixed) continue;
    for (const slot of template.slots) {
      if (seen.has(slot.exerciseId) || overrides[slot.exerciseId]) continue;
      seen.add(slot.exerciseId);
      const tip = suggestRepRange(history, slot.exerciseId, slot.repRange, beforeDate);
      if (!tip) continue;
      (tip.direction === 'more' ? more : fewer).push(slot.exerciseId);
    }
  }
  if (more.length >= STYLE_MIN_EXERCISES && currentStyle !== 'light') return { style: 'light', exerciseIds: more };
  if (fewer.length >= STYLE_MIN_EXERCISES && currentStyle !== 'heavy') return { style: 'heavy', exerciseIds: fewer };
  return null;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/* ── 주 1회 무거운 세트 ──────────────────────────────── */

/** 무거운 세트의 반복과 남길 개수 — 최대 도전이 아니다. 두어 개는 남긴다. */
export const TOP_SET_REPS: RepRange = { min: 1, max: 3 };
export const TOP_SET_RIR = 2;

/**
 * 이번 주에 무겁게 할 종목과 그날.
 *
 * 한 주에 한 번, 한 종목. 프로그램의 바벨 메인 종목을 주마다 돌아가며 고른다
 * (이번 주 벤치, 다음 주 스쿼트, …). 같은 종목을 매주 최대 근처로 들면 관절이
 * 먼저 지치고, 돌아가면 종목마다 3~4주에 한 번이라 회복이 된다.
 *
 * 그날은 그 종목이 처음 나오는 날이다.
 */
export function topSetPick(
  templates: readonly SessionTemplate[],
  date: string,
): { exerciseId: string; templateIndex: number } | null {
  const candidates: string[] = [];
  templates.forEach((template) => {
    if (template.fixed) return;
    template.slots.forEach((slot) => {
      const exercise = exerciseById(slot.exerciseId);
      if (!exercise || slot.role !== 'primary' || !isStrengthLift(exercise)) return;
      if (!candidates.includes(exercise.id)) candidates.push(exercise.id);
    });
  });
  if (candidates.length === 0) return null;
  const weekNumber = Math.floor(Date.parse(weekStart(date) + 'T00:00:00Z') / (7 * 24 * 3600 * 1000));
  const exerciseId = candidates[((weekNumber % candidates.length) + candidates.length) % candidates.length]!;
  const templateIndex = templates.findIndex((template) => !template.fixed &&
    template.slots.some((slot) => slot.exerciseId === exerciseId));
  return { exerciseId, templateIndex };
}

export interface TopSetLoad {
  weightKg: number;
  /** 근거가 된 기록 */
  from: Pick<SetLog, 'weightKg' | 'reps' | 'rir'>;
}

/**
 * 무거운 세트의 무게 — 최근 기록에서 추정한 1RM으로 "2개 하고 2개 남는" 무게.
 *
 * 기록이 없으면 null이다. 처음 하는 종목을 1~3회로 무겁게 시작하지 않는다.
 * 무거운 세트 자체는 근거로 쓰지 않는다 — 그건 다른 날의 추정을 흔든다.
 */
export function topSetLoad(history: readonly SessionLog[], exerciseId: string, beforeDate: string): TopSetLoad | null {
  const recent = history
    .filter((session) => session.date < beforeDate)
    .sort((a, b) => (a.date < b.date ? 1 : -1));
  for (const session of recent) {
    const sets = session.sets.filter((set) => set.exerciseId === exerciseId && !set.warmup && !set.top && set.reps > 0 && set.weightKg > 0);
    if (sets.length === 0) continue;
    const best = sets.reduce((top, set) => (oneRepMax(set) > oneRepMax(top) ? set : top), sets[0]!);
    // 10회 넘는 세트로 추정한 1RM은 크게 빗나간다 — 그런 기록뿐이면 만들지 않는다
    if (best.reps + best.rir > 12) return null;
    return { weightKg: workingWeight(oneRepMax(best), 2, topSetRir(exerciseId)), from: best };
  }
  return null;
}

/**
 * 오늘 그 종목 앞에 무거운 세트 하나를 붙인다. 원래 세트는 그대로 뒤에 남는다
 * (무거운 세트 뒤의 백오프). 무게는 끼울 수 있는 값으로 아래로 맞춘다.
 */
export function withTopSet(
  item: PlannedExercise,
  load: TopSetLoad,
  roundDown: (weightKg: number) => number,
): PlannedExercise {
  const first = item.sets[0];
  if (!first) return item;
  const weightKg = roundDown(load.weightKg);
  // 백오프보다 가볍거나 같으면 무거운 세트가 아니다
  if (first.weightKg != null && weightKg <= first.weightKg) return item;
  const top = { setNumber: 1, weightKg, targetReps: { ...TOP_SET_REPS }, targetRir: topSetRir(item.exercise.id), top: true as const };
  return {
    ...item,
    sets: [top, ...item.sets.map((set) => ({ ...set, setNumber: set.setNumber + 1 }))],
    note: `이번 주 무거운 세트 — ${weightKg}kg로 1~3회, 두어 개 남기고 멈춥니다. 그다음은 원래 세트입니다.`,
  };
}

/** 데드리프트류는 무거운 세트에서도 한 개 더 남긴다. */
export function topSetRir(exerciseId: string): number {
  return HEAVY_PULLS.has(exerciseId) ? TOP_SET_RIR + 1 : TOP_SET_RIR;
}
