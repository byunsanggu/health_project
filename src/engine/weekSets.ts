import { MUSCLE_GROUPS } from './muscles.ts';
import { aggregateVolume } from './volume.ts';
import type { WeeklyPlan } from './mesocycle.ts';
import type { SessionTemplate } from './session.ts';
import { HEAVY_PULLS } from './exercises.ts';
import type { Exercise, LandmarksByMuscle, MuscleGroup, SessionLog, TrainingLevel } from './types.ts';

/**
 * 이번 주 날마다 · 종목마다 세트 수.
 *
 * 주간 처방(planNextWeek)은 부위마다 "이번 주 몇 세트"를 준다. 그걸 종목 세트로 옮기는 곳이
 * 여기다. 전에는 종목마다 "처방 ÷ 지난주" 배율을 템플릿 세트에 곱해 반올림했는데,
 *
 * - 3세트에 1.1배는 언제나 3이라 최소 바로 밑 부위(가슴 9 / 최소 10)는 영영 안 늘었고,
 * - 늘린 주 다음 주에는 분모(지난주)가 커져 배율이 작아지니 다시 템플릿으로 돌아가
 *   3 · 4 · 3 · 4로 흔들렸고,
 * - 디로드 다음 주에는 반쪽 볼륨이 분모라 블록에서 제일 무거운 주가 됐고,
 * - 여유를 많이 남긴 종목은 디로드 주에 오히려 세트가 늘었다.
 *
 * 이제 기준은 언제나 템플릿이고, 한 주를 통째로 본다.
 * - 블록 1주차(디로드 다음 주 포함): 템플릿 그대로
 * - 덜어내는 주: 템플릿의 절반(올림) — 템플릿보다 많아질 일이 없다
 * - 그 밖의 주: 지난주에 그 종목을 실제로 한 세트(템플릿 ~ 템플릿 +2)에서 시작해, 처방에 못
 *   미치는 부위에 한 세트씩 붙인다. 최소에 못 미치는 부위가 먼저, 그다음 많이 모자란 부위.
 *   그 부위를 가장 많이 쓰는 종목에 붙이되 종목은 템플릿 +2세트, 하루는 블록 주차마다
 *   +2세트(최대 +6)까지. 다른 부위를 한계 위로 밀어 올리는 자리에는 붙이지 않는다. 한계를
 *   넘긴 부위(처방이 '줄이기')는 거꾸로 덜어낸다.
 *
 * 지난주에 한 만큼에서 출발하므로 처방대로 한 사람의 종목 세트는 블록 안에서 줄지 않고
 * 한두 세트씩 쌓여 올라간다(지난주 늘린 랫풀다운이 이번 주에 도로 3세트가 되지 않는다).
 */

/** 하루 세션이 블록 주차마다 늘 수 있는 폭. */
export const SESSION_GROWTH_PER_WEEK = 2;
export const SESSION_GROWTH_MAX = 6;
/**
 * 감량 중이거나 초보면 절반 폭으로. 적자에서는 회복이 느리고, 초보는 적은 볼륨으로도
 * 충분히 자란다 — 3개월 차가 4주차에 템플릿보다 40% 긴 세션(한 시간 가까이)을 하게 된다.
 */
export const SESSION_GROWTH_PER_WEEK_GENTLE = 1;
export const SESSION_GROWTH_MAX_GENTLE = 3;
/** 한 종목이 템플릿보다 늘거나 줄 수 있는 폭. */
export const SLOT_SWING = 2;

/** 그 종목이 이 부위를 "쓴다"고 볼 기여도 — 다른 부위를 한계 위로 미는지 볼 때 쓴다. */
const MEANINGFUL = 0.5;
/**
 * 부위를 늘리려고 세트를 붙일 종목은 그 부위가 주동근(0.85 이상)인 종목뿐이다. 0.5로 두니
 * 데드리프트(등 0.7 · 승모 · 전완 0.5)가 등 · 승모 · 전완 목표를 채우느라 4 → 5 → 6세트로
 * 늘었다 — 등은 로우 · 풀다운으로 늘린다.
 */
const PRIMARY_MOVER = 0.85;

export interface WeekSetsInput {
  /** 한 주에 도는 날 전부(프로그램의 templates) */
  templates: readonly SessionTemplate[];
  plan: WeeklyPlan;
  index: ReadonlyMap<string, Exercise>;
  /** 부위별 기준선. 있으면 최소 미달을 먼저 채우고, 다른 부위를 한계 위로 밀지 않는다 */
  landmarks?: LandmarksByMuscle;
  /** 지난주(처방의 바탕이 된 주)에 실제로 한 기록 — 종목마다 그만큼에서 출발한다 */
  lastWeek?: readonly SessionLog[];
  /** 단계 — 초보면 늘리는 폭이 절반 */
  level?: TrainingLevel;
}

function isLight(exercise: Exercise): boolean {
  return exercise.pattern === 'isolation' || exercise.pattern === 'core';
}

type WeekDay = Pick<SessionTemplate, 'slots'>;

/**
 * 이 세트대로 한 주를 다 했을 때의 기록 — 볼륨을 처방 · 볼륨 탭과 똑같은 셈으로 재려고.
 * 세트를 안 주면 템플릿 세트 그대로. 세트마다 반복 범위 가운데 · 여유 2개로 친다.
 */
export function templateWeekLogs(
  templates: readonly WeekDay[],
  sets: readonly (readonly number[])[] = templates.map((template) => template.slots.map((slot) => slot.sets)),
): SessionLog[] {
  return templates.map((template, d) => ({
    date: '',
    sets: template.slots.flatMap((slot, i) =>
      Array.from({ length: sets[d]![i]! }, () => ({
        exerciseId: slot.exerciseId,
        weightKg: 0,
        reps: Math.round((slot.repRange.min + slot.repRange.max) / 2),
        rir: 2,
      }))),
  }));
}

export function planWeekSets(input: WeekSetsInput): number[][] {
  const { templates, plan, index, landmarks } = input;
  const base = templates.map((template) => template.slots.map((slot) => Math.max(1, slot.sets)));

  if (plan.phase === 'deload') return base.map((day) => day.map((sets) => Math.max(1, Math.ceil(sets / 2))));

  const week = Math.max(1, plan.weekInBlock);
  if (week <= 1 || plan.volume.length === 0) return base.map((day) => day.slice());

  const sets = startingSets(templates, base, input.lastWeek ?? []);
  const gentle = plan.volumeCeiling === 'mav' || input.level === 'beginner';
  const growth = gentle
    ? Math.min(SESSION_GROWTH_MAX_GENTLE, SESSION_GROWTH_PER_WEEK_GENTLE * (week - 1))
    : Math.min(SESSION_GROWTH_MAX, SESSION_GROWTH_PER_WEEK * (week - 1));
  const dayCap = base.map((day) => day.reduce((sum, value) => sum + value, 0) + growth);
  const daySum = (d: number) => sets[d]!.reduce((sum, value) => sum + value, 0);
  const exerciseAt = (d: number, i: number) => index.get(templates[d]!.slots[i]!.exerciseId);
  const volumeOf = () => aggregateVolume(templateWeekLogs(templates, sets), index);

  /*
   * 부위마다 이번 주 목표. 처방대로 늘리되 템플릿 밑으로는 안 내린다 — 지난주에 하루
   * 빠졌다고 이번 주 볼륨을 깎으면 빠진 사람이 더 뒤처진다. 내리는 건 한계를 넘긴
   * 부위('reduce')뿐이다. 4주 동안 안 한 부위('skip')나 지난주에 0이었던 부위는
   * 비교할 게 없으니 템플릿 그대로.
   */
  const start = aggregateVolume(templateWeekLogs(templates, base), index);
  const targets = new Map<MuscleGroup, { target: number; reduce: boolean }>();
  for (const item of plan.volume) {
    if (item.action === 'skip' || item.action === 'deload' || item.currentSets <= 0) continue;
    const template = start[item.muscle].effectiveSets;
    const reduce = item.action === 'reduce';
    targets.set(item.muscle, { target: reduce ? item.prescribedSets : Math.max(template, item.prescribedSets), reduce });
  }
  if (targets.size === 0) return sets;

  /** 이 자리에 한 세트를 붙일 수 있는가 — 종목 · 하루 상한, 다른 부위의 한계 */
  const canAdd = (d: number, i: number, muscle: MuscleGroup, now: ReturnType<typeof volumeOf>): boolean => {
    const exercise = exerciseAt(d, i);
    // 그 부위가 주동근인 종목에만. 데드리프트는 무겁게 정한 세트 그대로 둔다
    if (!exercise || (exercise.contribution[muscle] ?? 0) < PRIMARY_MOVER || HEAVY_PULLS.has(exercise.id)) return false;
    if (sets[d]![i]! >= base[d]![i]! + SLOT_SWING || daySum(d) >= dayCap[d]!) return false;
    return MUSCLE_GROUPS.every((other) => {
      if (other === muscle) return true;
      const value = exercise.contribution[other] ?? 0;
      if (value < MEANINGFUL) return true;
      // 줄여야 하는 부위에는 더 얹지 않는다
      if (targets.get(other)?.reduce) return false;
      return !landmarks || now[other].effectiveSets + value <= landmarks[other].mrv;
    });
  };

  /** 그 부위를 가장 많이 쓰는 자리 — 같으면 덜 늘린 곳, 가벼운 종목, 앞 순서 */
  const bestSlot = (muscle: MuscleGroup, now: ReturnType<typeof volumeOf>): [number, number] | null => {
    let best: [number, number] | null = null;
    let bestScore: number[] = [];
    for (let d = 0; d < templates.length; d += 1) {
      for (let i = 0; i < templates[d]!.slots.length; i += 1) {
        if (!canAdd(d, i, muscle, now)) continue;
        const exercise = exerciseAt(d, i)!;
        const score = [exercise.contribution[muscle] ?? 0, -(sets[d]![i]! - base[d]![i]!), isLight(exercise) ? 1 : 0];
        if (!best || better(score, bestScore)) {
          best = [d, i];
          bestScore = score;
        }
      }
    }
    return best;
  };

  /** 줄일 부위를 가장 많이 쓰는 자리 — 템플릿 −2세트 · 1세트 밑으로는 안 내린다 */
  const trimSlot = (muscle: MuscleGroup): [number, number] | null => {
    let at: [number, number] | null = null;
    let atValue = 0;
    for (let d = 0; d < templates.length; d += 1) {
      for (let i = 0; i < templates[d]!.slots.length; i += 1) {
        const value = exerciseAt(d, i)?.contribution[muscle] ?? 0;
        if (value < MEANINGFUL || sets[d]![i]! <= Math.max(1, base[d]![i]! - SLOT_SWING)) continue;
        if (!at || value > atValue) {
          at = [d, i];
          atValue = value;
        }
      }
    }
    return at;
  };

  for (let guard = 0; guard < 400; guard += 1) {
    const now = volumeOf();

    // 1) 모자란 부위에 한 세트 — 최소에 못 미치는 부위가 먼저, 그다음 많이 모자란 순
    const wants = [...targets]
      .map(([muscle, { target }]) => ({
        muscle,
        gap: target - now[muscle].effectiveSets,
        underMev: landmarks ? now[muscle].effectiveSets < landmarks[muscle].mev : false,
      }))
      .filter((want) => want.gap >= 0.5)
      .sort((a, b) => Number(b.underMev) - Number(a.underMev) || b.gap - a.gap);
    const pick = wants.map((want) => bestSlot(want.muscle, now)).find((slot) => slot !== null);
    if (pick) {
      sets[pick[0]]![pick[1]]! += 1;
      continue;
    }

    // 2) 한계를 넘긴 부위에서 한 세트 — 그 부위를 가장 많이 쓰는 자리부터
    const cut = [...targets]
      .filter(([muscle, { target, reduce }]) => reduce && now[muscle].effectiveSets - target >= 0.5)
      .map(([muscle]) => trimSlot(muscle))
      .find((slot) => slot !== null);
    if (!cut) break;
    sets[cut[0]]![cut[1]]! -= 1;
  }

  return sets;
}

/**
 * 출발 세트 — 지난주에 그 종목을 실제로 한 세트. 템플릿보다 적게 했으면(빠진 날 · 덜 한
 * 날) 템플릿에서, 많이 했으면 템플릿 +2까지. 같은 종목이 여러 날에 있으면 템플릿 세트
 * 비율로 나눈다.
 */
function startingSets(
  templates: readonly SessionTemplate[],
  base: readonly (readonly number[])[],
  lastWeek: readonly SessionLog[],
): number[][] {
  const done = new Map<string, number>();
  for (const session of lastWeek) {
    for (const set of session.sets) {
      // 주 1회 무거운 세트는 덤으로 붙은 한 세트다 — 다음 주 세트 수의 출발점에 넣지 않는다
      if (set.warmup || set.top || set.reps <= 0) continue;
      done.set(set.exerciseId, (done.get(set.exerciseId) ?? 0) + 1);
    }
  }
  const planned = new Map<string, number>();
  templates.forEach((template, d) => template.slots.forEach((slot, i) => {
    planned.set(slot.exerciseId, (planned.get(slot.exerciseId) ?? 0) + base[d]![i]!);
  }));
  return templates.map((template, d) => template.slots.map((slot, i) => {
    const own = base[d]![i]!;
    const share = Math.round((done.get(slot.exerciseId) ?? 0) * own / (planned.get(slot.exerciseId) ?? own));
    return Math.min(own + SLOT_SWING, Math.max(own, share));
  }));
}

/** 앞에서부터 비교해 a가 더 나은가 */
function better(a: readonly number[], b: readonly number[]): boolean {
  for (let k = 0; k < a.length; k += 1) {
    if (a[k] !== b[k]) return a[k]! > b[k]!;
  }
  return false;
}
