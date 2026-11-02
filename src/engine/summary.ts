import { withParticle } from './korean.ts';
import { MUSCLE_LABELS_KO, zoneLabelKo, zoneOf } from './muscles.ts';
import { oneRepMax } from './repmax.ts';
import { personalRecords } from './progress.ts';
import { aggregateVolume, sessionsInWeek, weekStart, type VolumeOptions } from './volume.ts';
import type { WeeklyPlan } from './mesocycle.ts';
import type { Exercise, LandmarksByMuscle, MuscleGroup, SessionLog, SetLog, VolumeZone } from './types.ts';

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
  /**
   * 오늘 이 부위를 주로 쓴 세트 수(기여 0.5 이상) — 사람에게 보여 주는 숫자.
   * 유효 세트는 보조 근육과 여유를 많이 남긴 세트를 덜 세서, 고블릿 스쿼트
   * 3세트가 대퇴사두 1.9세트로 나온다. 판단은 유효 세트로, 말은 이 숫자로 한다.
   */
  todaySets: number;
  /** 이번 주 누적 */
  week: number;
  landmark: { mev: number; mav: number; mrv: number };
  /** 화면에 쓰는 구간 이름 — 주가 진행 중이면 최소 아래도 '부족'이 아니라 '진행 중' */
  zone: string;
  /** 구간 그대로(underMev · mevToMav …) — 색 · 아이콘을 고를 때 */
  zoneId: VolumeZone;
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
  /**
   * 다음 주 계획. 이번 주 계획(weekStart가 오늘이 든 주)을 넘기면 다음 주 이야기가 아니므로
   * nextWeek에 그 요약을 쓰지 않는다 — "다음 주 처방 — 1주차 · 볼륨 유지"가 이번 주 이야기였다.
   */
  plan?: WeeklyPlan;
  durationSeconds?: number;
  volumeOptions?: VolumeOptions;
  /**
   * 이번 주 계획한 운동이 아직 남았는가(weekInProgress로 구한다). 그러면 최소 아래 부위를
   * '부족'이 아니라 '진행 중'으로 쓴다.
   */
  weekInProgress?: boolean;
}

/** 이번 주 계획만 있을 때 '다음 주' 칸에 쓰는 말 — 다음 주는 이번 주 기록을 보고 정한다. */
export const NEXT_WEEK_PENDING_KO = '이번 주 기록을 보고 부위별 세트를 정합니다.';

export function summarizeSession(input: SummaryInput): SessionSummary {
  const working = input.sets.filter((set) => !set.warmup && set.reps > 0);
  const todaySession: SessionLog = { date: input.date, sets: [...working] };

  const todayVolume = aggregateVolume([todaySession], input.index, input.volumeOptions);
  const weekSessions = sessionsInWeek([...input.history, todaySession], input.date);
  const weekVolume = aggregateVolume(weekSessions, input.index, input.volumeOptions);

  const directSets: Partial<Record<MuscleGroup, number>> = {};
  for (const set of working) {
    const exercise = input.index.get(set.exerciseId);
    if (!exercise) continue;
    for (const [muscle, share] of Object.entries(exercise.contribution) as [MuscleGroup, number][]) {
      if (share >= 0.5) directSets[muscle] = (directSets[muscle] ?? 0) + 1;
    }
  }

  const byMuscle: MuscleSummary[] = [];
  for (const muscle of Object.keys(todayVolume) as MuscleGroup[]) {
    const today = todayVolume[muscle].effectiveSets;
    if (today <= 0) continue;
    const week = weekVolume[muscle].effectiveSets;
    const zoneId = zoneOf(week, input.landmarks[muscle]);
    byMuscle.push({
      muscle,
      label: MUSCLE_LABELS_KO[muscle],
      today,
      todaySets: directSets[muscle] ?? 0,
      week,
      landmark: input.landmarks[muscle],
      zone: zoneLabelKo(zoneId, { weekInProgress: input.weekInProgress }),
      zoneId,
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
    nextWeek: !input.plan ? undefined
      : input.plan.weekStart > weekStart(input.date) ? input.plan.summary : NEXT_WEEK_PENDING_KO,
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
  /*
   * 최소가 0인 부위(앞어깨 · 복근)는 칭찬에서 뺀다 — 0을 넘긴 건 한 일이 아니다. 미는 운동을 한 날이면
   * 복근 0.2세트로 "최소를 넘겼습니다"가 늘 나왔다.
   */
  const reached = byMuscle.filter((item) => item.landmark.mev > 0 && item.week >= item.landmark.mev);
  const over = byMuscle.filter((item) => item.week > item.landmark.mrv);

  if (reached.length > 0) {
    const names = reached.slice(0, 3).map((item) => item.label).join(', ');
    notes.push(`${withParticle(names, '은/는')} 이번 주 최소 세트를 채웠습니다.`);
  }
  if (over.length > 0) {
    const names = over.map((item) => item.label).join(', ');
    notes.push(`${withParticle(names, '은/는')} 이번 주 최대 세트를 넘었습니다. 다음 운동에서 줄입니다.`);
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
