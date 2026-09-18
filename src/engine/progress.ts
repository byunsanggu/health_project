import { oneRepMax } from './repmax.ts';
import { MUSCLE_LABELS_KO } from './muscles.ts';
import { aggregateVolume, groupByWeek, type VolumeOptions } from './volume.ts';
import type { Exercise, MuscleGroup, SessionLog, SetLog } from './types.ts';

export interface ProgressPoint {
  date: string;
  value: number;
}

export type Trend = 'up' | 'flat' | 'down';

export interface LiftProgress {
  exerciseId: string;
  name: string;
  /** 세션별 최고 추정 1RM */
  points: ProgressPoint[];
  first: number;
  latest: number;
  best: number;
  changePercent: number;
  trend: Trend;
  sessionCount: number;
}

export interface ProgressOptions extends VolumeOptions {
  /** 이 날짜 이후만 본다 */
  from?: string;
  /** 세션 수가 이보다 적은 종목은 추이로 보지 않는다 */
  minSessions?: number;
}

/**
 * 종목별 추정 1RM 추이.
 *
 * 그날의 최고 세트만 쓴다. 뒤 세트는 피로가 섞여 있어서 능력의 변화가 아니라
 * 그날의 컨디션을 보여준다 — 추이 그래프에서는 잡음이 된다.
 */
export function liftProgress(
  history: readonly SessionLog[],
  index: ReadonlyMap<string, Exercise>,
  options: ProgressOptions = {},
): LiftProgress[] {
  const minSessions = options.minSessions ?? 2;
  const offset = options.rirOffset ?? 0;
  const byExercise = new Map<string, Map<string, number>>();

  for (const session of history) {
    if (options.from && session.date < options.from) continue;
    for (const set of session.sets) {
      if (set.warmup || set.reps <= 0 || set.weightKg <= 0) continue;
      const value = oneRepMax({ ...set, rir: clamp(set.rir + offset, 0, 5) });

      let byDate = byExercise.get(set.exerciseId);
      if (!byDate) {
        byDate = new Map();
        byExercise.set(set.exerciseId, byDate);
      }
      const previous = byDate.get(session.date);
      if (previous === undefined || value > previous) byDate.set(session.date, value);
    }
  }

  const out: LiftProgress[] = [];
  for (const [exerciseId, byDate] of byExercise) {
    const points = [...byDate]
      .map(([date, value]) => ({ date, value: round1(value) }))
      .sort((a, b) => (a.date < b.date ? -1 : 1));
    if (points.length < minSessions) continue;

    const first = points[0]!.value;
    const latest = points[points.length - 1]!.value;
    const best = Math.max(...points.map((point) => point.value));
    const changePercent = first > 0 ? round1(((latest - first) / first) * 100) : 0;

    out.push({
      exerciseId,
      name: index.get(exerciseId)?.name ?? exerciseId,
      points,
      first,
      latest,
      best,
      changePercent,
      trend: changePercent >= 2 ? 'up' : changePercent <= -2 ? 'down' : 'flat',
      sessionCount: points.length,
    });
  }

  return out.sort((a, b) => b.sessionCount - a.sessionCount || b.changePercent - a.changePercent);
}

export interface VolumePoint {
  weekStart: string;
  sets: number;
}

/** 부위별 주간 유효 세트 추이. 볼륨 게이지의 시간축 버전이다. */
export function volumeTrend(
  history: readonly SessionLog[],
  index: ReadonlyMap<string, Exercise>,
  muscle: MuscleGroup,
  options: ProgressOptions = {},
): VolumePoint[] {
  const weeks = groupByWeek(
    options.from ? history.filter((session) => session.date >= options.from!) : history,
  );
  return [...weeks].map(([weekStart, sessions]) => ({
    weekStart,
    sets: aggregateVolume(sessions, index, options)[muscle].effectiveSets,
  }));
}

/** 전체 주간 볼륨 추이 (부위 합계). 훈련량이 늘고 있는지 한눈에 본다. */
export function totalVolumeTrend(
  history: readonly SessionLog[],
  index: ReadonlyMap<string, Exercise>,
  options: ProgressOptions = {},
): VolumePoint[] {
  const weeks = groupByWeek(
    options.from ? history.filter((session) => session.date >= options.from!) : history,
  );
  return [...weeks].map(([weekStart, sessions]) => {
    let sets = 0;
    for (const session of sessions) {
      for (const set of session.sets) {
        if (!set.warmup && set.reps > 0) sets += 1;
      }
    }
    return { weekStart, sets };
  });
}

export interface PersonalRecord {
  exerciseId: string;
  name: string;
  date: string;
  weightKg: number;
  reps: number;
  rir: number;
  estimated1RM: number;
  /** 이번 주에 세운 기록인가 */
  isRecent: boolean;
}

/** 종목별 최고 기록. 추정 1RM 기준으로 고른다. */
export function personalRecords(
  history: readonly SessionLog[],
  index: ReadonlyMap<string, Exercise>,
  options: ProgressOptions = {},
): PersonalRecord[] {
  const offset = options.rirOffset ?? 0;
  const best = new Map<string, { set: SetLog; date: string; value: number }>();
  let latestDate = '';

  for (const session of history) {
    if (session.date > latestDate) latestDate = session.date;
    for (const set of session.sets) {
      if (set.warmup || set.reps <= 0 || set.weightKg <= 0) continue;
      const value = oneRepMax({ ...set, rir: clamp(set.rir + offset, 0, 5) });
      const current = best.get(set.exerciseId);
      if (!current || value > current.value) {
        best.set(set.exerciseId, { set, date: session.date, value });
      }
    }
  }

  return [...best]
    .map(([exerciseId, entry]) => ({
      exerciseId,
      name: index.get(exerciseId)?.name ?? exerciseId,
      date: entry.date,
      weightKg: entry.set.weightKg,
      reps: entry.set.reps,
      rir: entry.set.rir,
      estimated1RM: round1(entry.value),
      isRecent: entry.date === latestDate,
    }))
    .sort((a, b) => b.estimated1RM - a.estimated1RM);
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
