import { withParticle } from './korean.ts';
import { MUSCLE_LABELS_KO, zoneOf } from './muscles.ts';
import { oneRepMax } from './repmax.ts';
import { personalRecords } from './progress.ts';
import { aggregateVolume, sessionsInWeek, type VolumeOptions } from './volume.ts';
import { ZONE_LABELS_KO } from './muscles.ts';
import type { WeeklyPlan } from './mesocycle.ts';
import type { Exercise, LandmarksByMuscle, MuscleGroup, SessionLog, SetLog } from './types.ts';

/**
 * 세션 후 요약.
 *
 * 운동을 마치고 나면 "오늘 뭘 했지"가 남아야 한다. 세트 목록만 보여주면
 * 그날의 의미를 알 수 없다 — 오늘 한 것이 주간 계획의 어디쯤인지,
 * 무엇이 늘었는지, 다음 주가 어떻게 달라지는지가 요약의 내용이다.
 */
export interface MuscleSummary {
  muscle: MuscleGroup;
  label: string;
  /** 오늘 채운 유효 세트 */
  today: number;
  /** 이번 주 누적 */
  week: number;
  landmark: { mev: number; mav: number; mrv: number };
  zone: string;
}

export interface LiftHighlight {
  exerciseId: string;
  name: string;
  kind: 'record' | 'increase' | 'held';
  message: string;
}

export interface SessionSummary {
  date: string;
  name: string;
  setsCompleted: number;
  totalReps: number;
  /** 총 들어올린 무게 (kg·회 합계) */
  tonnageKg: number;
  durationMinutes?: number;
  byMuscle: MuscleSummary[];
  highlights: LiftHighlight[];
  /** 오늘 세운 개인 기록 */
  records: { exerciseId: string; name: string; weightKg: number; reps: number; estimated1RM: number }[];
  nextWeek?: string;
  notes: string[];
}

export interface SummaryInput {
  date: string;
  name: string;
  /** 오늘 완료한 본세트 */
  sets: readonly SetLog[];
  /** 오늘을 제외한 이력 */
  history: readonly SessionLog[];
  index: ReadonlyMap<string, Exercise>;
  landmarks: LandmarksByMuscle;
  plan?: WeeklyPlan;
  durationSeconds?: number;
  volumeOptions?: VolumeOptions;
}

export function summarizeSession(input: SummaryInput): SessionSummary {
  const working = input.sets.filter((set) => !set.warmup && set.reps > 0);
  const todaySession: SessionLog = { date: input.date, sets: [...working] };

  const todayVolume = aggregateVolume([todaySession], input.index, input.volumeOptions);
  const weekSessions = sessionsInWeek([...input.history, todaySession], input.date);
  const weekVolume = aggregateVolume(weekSessions, input.index, input.volumeOptions);

  const byMuscle: MuscleSummary[] = [];
  for (const muscle of Object.keys(todayVolume) as MuscleGroup[]) {
    const today = todayVolume[muscle].effectiveSets;
    if (today <= 0) continue;
    const week = weekVolume[muscle].effectiveSets;
    byMuscle.push({
      muscle,
      label: MUSCLE_LABELS_KO[muscle],
      today,
      week,
      landmark: input.landmarks[muscle],
      zone: ZONE_LABELS_KO[zoneOf(week, input.landmarks[muscle])],
    });
  }
  byMuscle.sort((a, b) => b.today - a.today);

  const totalReps = working.reduce((sum, set) => sum + set.reps, 0);
  const tonnageKg = Math.round(working.reduce((sum, set) => sum + set.weightKg * set.reps, 0));

  return {
    date: input.date,
    name: input.name,
    setsCompleted: working.length,
    totalReps,
    tonnageKg,
    durationMinutes: input.durationSeconds ? Math.round(input.durationSeconds / 60) : undefined,
    byMuscle,
    highlights: findHighlights(working, input),
    records: findRecords(working, todaySession, input),
    nextWeek: input.plan?.summary,
    notes: buildNotes(byMuscle, working.length),
  };
}

/** 오늘 무엇이 나아졌는가. 없으면 억지로 만들지 않는다. */
function findHighlights(working: readonly SetLog[], input: SummaryInput): LiftHighlight[] {
  const byExercise = new Map<string, SetLog[]>();
  for (const set of working) {
    const bucket = byExercise.get(set.exerciseId) ?? [];
    bucket.push(set);
    byExercise.set(set.exerciseId, bucket);
  }

  const highlights: LiftHighlight[] = [];

  for (const [exerciseId, sets] of byExercise) {
    const name = input.index.get(exerciseId)?.name ?? exerciseId;
    const todayTop = Math.max(...sets.map((set) => set.weightKg));

    let previousTop = 0;
    for (const session of input.history) {
      for (const set of session.sets) {
        if (set.exerciseId !== exerciseId || set.warmup) continue;
        previousTop = Math.max(previousTop, set.weightKg);
      }
    }

    if (previousTop > 0 && todayTop > previousTop) {
      highlights.push({
        exerciseId,
        name,
        kind: 'increase',
        message: `${previousTop}kg → ${todayTop}kg으로 올렸습니다`,
      });
    }
  }

  return highlights.slice(0, 4);
}

function findRecords(
  working: readonly SetLog[],
  todaySession: SessionLog,
  input: SummaryInput,
): SessionSummary['records'] {
  const before = personalRecords(input.history, input.index, input.volumeOptions);
  const after = personalRecords([...input.history, todaySession], input.index, input.volumeOptions);
  const beforeMap = new Map(before.map((record) => [record.exerciseId, record.estimated1RM]));

  return after
    .filter((record) => {
      if (record.date !== input.date) return false;
      const previous = beforeMap.get(record.exerciseId);
      return previous === undefined || record.estimated1RM > previous;
    })
    .map((record) => ({
      exerciseId: record.exerciseId,
      name: record.name,
      weightKg: record.weightKg,
      reps: record.reps,
      estimated1RM: record.estimated1RM,
    }))
    .slice(0, 5);
}

function buildNotes(byMuscle: readonly MuscleSummary[], setsCompleted: number): string[] {
  if (setsCompleted === 0) return ['완료한 세트가 없습니다.'];

  const notes: string[] = [];
  const reached = byMuscle.filter((item) => item.week >= item.landmark.mev);
  const over = byMuscle.filter((item) => item.week > item.landmark.mrv);

  if (reached.length > 0) {
    const names = reached.slice(0, 3).map((item) => item.label).join(', ');
    notes.push(`${withParticle(names, '은/는')} 이번 주 최소 자극선(MEV)을 넘겼습니다.`);
  }
  if (over.length > 0) {
    const names = over.map((item) => item.label).join(', ');
    notes.push(`${withParticle(names, '은/는')} 회복 범위를 넘었습니다. 다음 세션에서 줄입니다.`);
  }
  return notes;
}

/** 오늘 세션의 추정 1RM 최고치 — 요약 카드의 숫자로 쓴다. */
export function bestEffort(sets: readonly SetLog[], rirOffset = 0): { set: SetLog; value: number } | null {
  let best: { set: SetLog; value: number } | null = null;
  for (const set of sets) {
    if (set.warmup || set.reps <= 0 || set.weightKg <= 0) continue;
    const value = oneRepMax({ ...set, rir: Math.min(5, Math.max(0, set.rir + rirOffset)) });
    if (!best || value > best.value) best = { set, value: Math.round(value * 10) / 10 };
  }
  return best;
}
