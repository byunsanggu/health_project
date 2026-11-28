import { CONDITIONING_ONLY, isTimed, isUnloaded } from './exercises.ts';
import { withParticle } from './korean.ts';
import { floorToIncrement, type RepRange } from './load.ts';
import { TECHNICAL_LIFTS } from './onboarding.ts';
import type { SessionTemplate } from './session.ts';
import type { Exercise, MuscleGroup, SessionLog, TrainingLevel } from './types.ts';

/**
 * 멈춘 종목 — 같은 무게 · 같은 횟수에서 몇 주째 늘지 않는 종목을 찾고, 트레이너가 할 법한 한 가지 처방을 낸다.
 *
 * 이중 진행(load.ts)은 "횟수를 채우면 무게를 올린다"까지다. 범위 안에서 8 · 8 · 8회로 맴도는 사람에게는
 * 매번 "같은 무게로 9회를 노립니다"만 나오고, 몇 주가 지나도 아무것도 바뀌지 않았다. 현장에서는 여기서 셋 중
 * 하나를 한다.
 *   · 무게를 10% 내려 다시 쌓기 — 가장 흔하고 가장 잘 듣는다. 가볍게 몇 번 하면 지난 기록을 넘는다.
 *   · 반복 범위 바꾸기 — 같은 종목을 다른 횟수로(6~10회 → 8~12회). 다른 자극이 다시 늘게 한다.
 *   · 비슷한 종목으로 바꾸기 — 보조 · 작은 운동만. 메인은 기록이 이어져야 해서 바꾸지 않는다.
 * 같은 종목에서 다시 멈추면 다음 처방으로 넘어간다(내리기 → 범위 → 내리기 …, 보조는 바꾸기 → 범위 → 내리기).
 *
 * "멈췄다"의 기준 — 마지막으로 늘어난 날(무게가 오르거나, 같은 무게에서 횟수가 는 날) 뒤로 비슷한 무게(95% 이상)로
 * 세 번 넘게 했는데 한 번도 늘지 않았고, 그게 2주 넘게 이어졌다. 가볍게 하는 주 · 아픈 날 · 별로인 날처럼 일부러
 * 가볍게 한 날(95% 밑)은 세지 않는다. 무게를 올린 뒤 횟수가 잠깐 줄어든 것은 늘어난 것으로 본다(이중 진행의 정상).
 * 맨몸 · 밴드 · 버티는 종목은 보지 않는다 — 더 어려운 동작으로 바꾸는 안내가 따로 있다(load.ts).
 */

export type PlateauFixKind = 'reset' | 'reps' | 'swap';

/** 처방을 적용했거나("그대로 두기" 포함) 언제 했는지 — 그날부터 다시 센다. */
export interface PlateauFixRecord {
  kind: PlateauFixKind | 'keep';
  /** 적용한 날 (YYYY-MM-DD) */
  date: string;
}

export interface PlateauFix {
  kind: PlateauFixKind;
  /** 버튼 글자 */
  action: string;
  /** 무엇을 왜 — 한두 문장 */
  text: string;
  /** reps — 바꿀 반복 범위 */
  repRange?: RepRange;
  /** swap — 바꿀 종목 */
  swapTo?: string;
  /** reset — 다음 번 무게 배율 */
  factor?: number;
}

export interface Plateau {
  exerciseId: string;
  name: string;
  role: 'primary' | 'accessory' | 'isolation';
  /** 마지막으로 늘어난 날의 무게 · 횟수 */
  weightKg: number;
  reps: number;
  /** 늘지 않은 번 수와 기간(주) */
  sessions: number;
  weeks: number;
  /** 마지막으로 한 날 */
  lastDate: string;
  /** 한 줄 — "벤치프레스 — 3주째 60kg × 8회에서 늘지 않았습니다." */
  headline: string;
  fix: PlateauFix;
}

export interface PlateauInput {
  history: readonly SessionLog[];
  /** 지금 프로그램의 날들 — 어느 종목이 메인인지, 반복 범위는 몇인지 */
  templates: readonly SessionTemplate[];
  index: ReadonlyMap<string, Exercise>;
  today: string;
  /** 종목마다 마지막으로 한 처방 */
  fixes?: Readonly<Record<string, PlateauFixRecord | undefined>>;
  /** 종목별로 직접 정한 반복 — 지금 범위로 본다 */
  repOverrides?: Readonly<Record<string, RepRange | undefined>>;
  /** 이 헬스장에서 할 수 있는 종목 — 바꾸기 후보. 없으면 바꾸기를 권하지 않는다 */
  available?: readonly Exercise[];
  level?: TrainingLevel;
  /**
   * 그 기구로 들 수 있는 무게로 내림 — 처방 문장의 "○kg"이 오늘 화면 무게와 같게. 없으면 종목의 증량 단위로 내린다.
   */
  snapDown?: (kg: number, exercise: Exercise) => number;
}

/** 이만큼 넘게 늘지 않아야 멈춘 것으로 본다. */
export const PLATEAU_SESSIONS = 3;
export const PLATEAU_MIN_DAYS = 14;
/** 일부러 가볍게 한 날로 보는 선 — 이보다 가벼우면 세지 않는다 */
const LIGHTER = 0.95;
/** 이 기간 안의 기록만 본다 */
const LOOKBACK_DAYS = 70;
/** 마지막으로 한 지 이만큼 지났으면(쉬었다) 묻지 않는다 */
const STALE_DAYS = 21;
/** 이전 처방을 기억하는 기간 — 이 안에서 다시 멈추면 다음 처방으로 */
const FIX_MEMORY_DAYS = 84;
export const RESET_FACTOR = 0.9;

interface Exposure {
  date: string;
  weightKg: number;
  reps: number;
  score: number;
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** 그날 그 종목의 가장 무거운 본세트(같은 무게면 가장 많이 한 세트). 주 1회 무거운 세트 · 워밍업은 뺀다. */
function exposures(history: readonly SessionLog[], exerciseId: string, today: string, from: string): Exposure[] {
  const byDate = new Map<string, Exposure>();
  for (const session of history) {
    if (session.date >= today || session.date < from) continue;
    for (const set of session.sets) {
      if (set.exerciseId !== exerciseId || set.warmup || set.top || set.reps <= 0 || set.weightKg <= 0) continue;
      const now = byDate.get(session.date);
      if (!now || set.weightKg > now.weightKg || (set.weightKg === now.weightKg && set.reps > now.reps)) {
        // 무게 × 횟수로만 — 남긴 개수(RIR)는 주차마다 목표가 줄어드니 섞으면 늘어도 준 것처럼 보인다
        byDate.set(session.date, { date: session.date, weightKg: set.weightKg, reps: set.reps, score: set.weightKg * (1 + set.reps / 30) });
      }
    }
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/** 마지막으로 늘어난 날과 그 뒤로 늘지 않은 날들. */
function stall(list: readonly Exposure[]): { best: Exposure; flat: Exposure[] } | null {
  if (list.length === 0) return null;
  let best = list[0]!;
  let flat: Exposure[] = [];
  let lighter: Exposure[] = [];
  for (const item of list.slice(1)) {
    if (item.weightKg < best.weightKg * LIGHTER - 1e-9) {
      lighter.push(item);
      // 세 번 넘게 가볍게 했으면 그 무게가 지금 무게다 — 거기서 다시 센다
      if (lighter.length >= 3) {
        best = lighter.reduce((top, one) => (one.score > top.score ? one : top), lighter[0]!);
        flat = lighter.filter((one) => one.date > best.date);
        lighter = [];
      }
      continue;
    }
    lighter = [];
    // 무게가 올랐거나 같은 무게 언저리에서 더 했으면 늘어난 것
    if (item.weightKg > best.weightKg + 1e-9 || item.score > best.score * 1.001) {
      best = item;
      flat = [];
      continue;
    }
    flat.push(item);
  }
  return { best, flat };
}

function mainMuscle(exercise: Exercise): MuscleGroup | undefined {
  return (Object.entries(exercise.contribution) as [MuscleGroup, number][]).sort((a, b) => b[1] - a[1])[0]?.[0];
}

function isSmall(exercise: Exercise): boolean {
  return exercise.pattern === 'isolation' || exercise.pattern === 'core';
}

/** 같은 부위를 같은 방식으로 쓰는 비슷한 종목 — 프로그램에 없는 것 중 그 부위를 가장 많이 쓰는 것. */
export function similarExercise(
  exercise: Exercise,
  available: readonly Exercise[],
  exclude: ReadonlySet<string>,
  level?: TrainingLevel,
): Exercise | undefined {
  const muscle = mainMuscle(exercise);
  if (!muscle) return undefined;
  const own = exercise.contribution[muscle] ?? 0;
  return available
    .filter((item) => item.id !== exercise.id && !exclude.has(item.id) && !CONDITIONING_ONLY.has(item.id) && !isTimed(item))
    .filter((item) => isSmall(item) === isSmall(exercise) && (isSmall(item) || item.pattern === exercise.pattern))
    // 무게를 싣던 것을 맨몸으로 바꾸지 않는다 — 늘지 않아서 바꾸는데 더 가벼운 것을 주면 거꾸로다
    .filter((item) => isUnloaded(exercise) || !isUnloaded(item))
    .filter((item) => (item.contribution[muscle] ?? 0) >= Math.max(0.75, own - 0.15))
    .filter((item) => level !== 'beginner' || !TECHNICAL_LIFTS.has(item.id))
    .sort((a, b) => (b.contribution[muscle] ?? 0) - (a.contribution[muscle] ?? 0) || a.name.localeCompare(b.name, 'ko'))[0];
}

/** 다른 횟수 — 무거운 칸은 조금 가볍게, 많이 하는 칸은 조금 무겁게, 가운데는 한 칸 많이. */
export function switchedRepRange(range: RepRange, small: boolean): RepRange {
  if (range.max <= 6) return { min: 6, max: 8 };
  if (range.min >= 12) return { min: 8, max: 12 };
  if (range.min >= 8) return small ? { min: 12, max: 15 } : { min: 6, max: 10 };
  return small ? { min: 10, max: 15 } : { min: 8, max: 12 };
}

function repText(range: RepRange): string {
  return `${range.min}~${range.max}회`;
}

/** 그다음 처방 — 이 종목에 마지막으로 한 처방(기억하는 기간 안)을 보고 고른다. */
function nextKind(role: Plateau['role'], previous: PlateauFixKind | undefined, canSwap: boolean): PlateauFixKind {
  if (role === 'primary') return previous === 'reset' ? 'reps' : 'reset';
  if (!previous) return canSwap ? 'swap' : 'reset';
  if (previous === 'swap') return 'reps';
  if (previous === 'reps') return 'reset';
  return canSwap ? 'swap' : 'reps';
}

/**
 * 지금 프로그램의 종목 중 멈춘 것. 오래 멈춘 순.
 */
export function findPlateaus(input: PlateauInput): Plateau[] {
  const from = new Date(Date.parse(`${input.today}T00:00:00Z`) - LOOKBACK_DAYS * 86_400_000).toISOString().slice(0, 10);
  const slots = new Map<string, { role: Plateau['role']; repRange: RepRange; fixed: boolean }>();
  const inProgram = new Set<string>();
  for (const template of input.templates) {
    for (const slot of template.slots) {
      inProgram.add(slot.exerciseId);
      const exercise = input.index.get(slot.exerciseId);
      const role = slot.role ?? (exercise && isSmall(exercise) ? 'isolation' : 'accessory');
      const known = slots.get(slot.exerciseId);
      // 한 주에 메인으로도 보조로도 나오면 메인으로 본다
      if (!known || (role === 'primary' && known.role !== 'primary')) {
        slots.set(slot.exerciseId, { role, repRange: slot.repRange, fixed: Boolean(template.fixed) });
      }
    }
  }

  const out: Plateau[] = [];
  for (const [exerciseId, slot] of slots) {
    const exercise = input.index.get(exerciseId);
    if (!exercise || isTimed(exercise)) continue;
    const record = input.fixes?.[exerciseId];
    // 처방을 했으면(그대로 두기 포함) 그날부터 다시 센다
    const start = record && record.date > from ? record.date : from;
    const list = exposures(input.history, exerciseId, input.today, start);
    if (list.length < PLATEAU_SESSIONS + 1) continue;
    const found = stall(list);
    if (!found || found.flat.length < PLATEAU_SESSIONS) continue;
    const last = found.flat[found.flat.length - 1]!;
    const span = daysBetween(found.best.date, last.date);
    if (span < PLATEAU_MIN_DAYS || daysBetween(last.date, input.today) > STALE_DAYS) continue;

    const range = input.repOverrides?.[exerciseId] ?? slot.repRange;
    const remembered = record && record.kind !== 'keep' && daysBetween(record.date, input.today) <= FIX_MEMORY_DAYS
      ? record.kind : undefined;
    const alternative = !slot.fixed && slot.role !== 'primary' && input.available
      ? similarExercise(exercise, input.available, inProgram, input.level) : undefined;
    const kind = nextKind(slot.role, remembered, Boolean(alternative));
    const weeks = Math.max(2, Math.round(span / 7));
    const best = found.best;
    const fix = fixFor(kind, exercise, best, range, alternative, input.snapDown);
    out.push({
      exerciseId,
      name: exercise.name,
      role: slot.role,
      weightKg: best.weightKg,
      reps: best.reps,
      sessions: found.flat.length,
      weeks,
      lastDate: last.date,
      headline: `${exercise.name} — ${weeks}주째 ${best.weightKg}kg × ${best.reps}회에서 늘지 않았습니다.`,
      fix,
    });
  }
  return out.sort((a, b) => b.weeks - a.weeks || b.sessions - a.sessions);
}

function fixFor(
  kind: PlateauFixKind,
  exercise: Exercise,
  best: Exposure,
  range: RepRange,
  alternative?: Exercise,
  snapDown?: (kg: number, exercise: Exercise) => number,
): PlateauFix {
  if (kind === 'swap' && alternative) {
    return {
      kind,
      swapTo: alternative.id,
      action: `${withParticle(alternative.name, '으로/로')} 바꾸기`,
      text: `비슷한 부위를 쓰는 ${withParticle(alternative.name, '으로/로')} 바꿉니다. 새 종목은 처음 몇 주 빠르게 늘고, 같은 부위는 그대로 씁니다.`,
    };
  }
  if (kind === 'reps') {
    const next = switchedRepRange(range, isSmall(exercise));
    return {
      kind,
      repRange: next,
      action: `${repText(next)}로 바꾸기`,
      text: `반복 범위를 ${repText(range)}에서 ${repText(next)}로 바꿉니다. 같은 종목도 횟수를 바꾸면 다시 늘기 시작합니다.`,
    };
  }
  const target = best.weightKg * RESET_FACTOR;
  const snapped = snapDown ? snapDown(target, exercise) : floorToIncrement(target, exercise.increment > 0 ? exercise.increment : 0.5);
  // 기구 칸이 커서 그대로이거나 더 무거워지면(가장 가벼운 칸) 숫자 없이 말한다
  const lighter = Number.isFinite(snapped) && snapped > 0 && snapped < best.weightKg ? snapped : null;
  return {
    kind: 'reset',
    factor: RESET_FACTOR,
    action: '10% 내려 다시 쌓기',
    text: `다음 번에 ${lighter !== null ? `10% 가벼운 ${lighter}kg에서` : '무게를 한 칸 낮춰'} 시작해 횟수와 무게를 다시 올립니다. ` +
      '가볍게 몇 번 하면 지난 기록을 넘는 경우가 많습니다.',
  };
}
