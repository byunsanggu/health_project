import { MUSCLE_GROUPS, ZONE_LABELS_KO, zoneOf } from './muscles.ts';
import type {
  Exercise,
  LandmarksByMuscle,
  MuscleGroup,
  SessionLog,
  SetLog,
  VolumeByMuscle,
  VolumeLandmark,
  VolumeZone,
} from './types.ts';

export interface VolumeOptions {
  /** 근비대 유효 반복 범위. 밖으로 벗어나면 가중치가 깎인다. */
  hypertrophyReps?: { min: number; max: number };
  /** 이 값 미만의 기여도는 볼륨에 세지 않는다(노이즈 컷). */
  minContribution?: number;
}

const DEFAULTS: Required<VolumeOptions> = {
  hypertrophyReps: { min: 5, max: 30 },
  minContribution: 0.25,
};

/**
 * 세트 하나가 근비대 자극으로서 얼마나 "유효"한지 0~1로 환산한다.
 *
 * 앱이 kg×reps만 세는 것과 여기서 갈린다. 20회 남기고 끝낸 세트와
 * 실패 직전까지 간 세트를 같은 1세트로 세면 볼륨 관리가 전부 무의미해진다.
 */
export function setEffectiveness(set: SetLog, options: VolumeOptions = {}): number {
  if (set.warmup) return 0;
  if (set.reps <= 0) return 0;

  const { hypertrophyReps } = { ...DEFAULTS, ...options };

  // RIR 가중 — 실패에서 멀어질수록 자극이 급격히 떨어진다.
  let weight: number;
  if (set.rir <= 3) weight = 1;
  else if (set.rir <= 4) weight = 0.7;
  else weight = 0.3;

  // 반복 범위 가중 — 저반복은 근력, 초고반복은 국소 지구력 쪽 자극이 커진다.
  if (set.reps < hypertrophyReps.min) weight *= 0.8;
  else if (set.reps > hypertrophyReps.max) weight *= 0.6;

  return weight;
}

export interface MuscleVolumeDetail {
  /** 기여도까지 반영한 유효 세트 수 */
  effectiveSets: number;
  /** 주동근으로 수행한 세트 수 (기여도 ≥ 0.85) */
  directSets: number;
  /** 세트 수를 만든 운동 목록 (많이 기여한 순) */
  topExercises: { exerciseId: string; sets: number }[];
}

function emptyVolume(): Record<MuscleGroup, MuscleVolumeDetail> {
  const out = {} as Record<MuscleGroup, MuscleVolumeDetail>;
  for (const muscle of MUSCLE_GROUPS) {
    out[muscle] = { effectiveSets: 0, directSets: 0, topExercises: [] };
  }
  return out;
}

/** 세션 묶음을 근육군별 유효 세트로 집계한다. */
export function aggregateVolume(
  sessions: readonly SessionLog[],
  index: ReadonlyMap<string, Exercise>,
  options: VolumeOptions = {},
): Record<MuscleGroup, MuscleVolumeDetail> {
  const { minContribution } = { ...DEFAULTS, ...options };
  const totals = emptyVolume();
  const perExercise = new Map<MuscleGroup, Map<string, number>>();

  for (const session of sessions) {
    for (const set of session.sets) {
      const exercise = index.get(set.exerciseId);
      if (!exercise) continue;

      const effectiveness = setEffectiveness(set, options);
      if (effectiveness === 0) continue;

      for (const muscle of MUSCLE_GROUPS) {
        const contribution = exercise.contribution[muscle] ?? 0;
        if (contribution < minContribution) continue;

        const sets = effectiveness * contribution;
        const detail = totals[muscle];
        detail.effectiveSets += sets;
        if (contribution >= 0.85) detail.directSets += effectiveness;

        let byExercise = perExercise.get(muscle);
        if (!byExercise) {
          byExercise = new Map();
          perExercise.set(muscle, byExercise);
        }
        byExercise.set(exercise.id, (byExercise.get(exercise.id) ?? 0) + sets);
      }
    }
  }

  for (const muscle of MUSCLE_GROUPS) {
    const detail = totals[muscle];
    detail.effectiveSets = round1(detail.effectiveSets);
    detail.directSets = round1(detail.directSets);
    detail.topExercises = [...(perExercise.get(muscle) ?? new Map())]
      .map(([exerciseId, sets]) => ({ exerciseId, sets: round1(sets) }))
      .sort((a, b) => b.sets - a.sets);
  }

  return totals;
}

export interface MuscleVolumeStatus extends MuscleVolumeDetail {
  muscle: MuscleGroup;
  landmark: VolumeLandmark;
  zone: VolumeZone;
  zoneLabel: string;
  /** MRV 대비 비율 (게이지 렌더링용, 0~1+) */
  mrvRatio: number;
}

/** UI가 그대로 그릴 수 있는 부위별 볼륨 현황. */
export function volumeReport(
  sessions: readonly SessionLog[],
  landmarks: LandmarksByMuscle,
  index: ReadonlyMap<string, Exercise>,
  options: VolumeOptions = {},
): MuscleVolumeStatus[] {
  const totals = aggregateVolume(sessions, index, options);

  return MUSCLE_GROUPS.map((muscle) => {
    const detail = totals[muscle];
    const landmark = landmarks[muscle];
    const zone = zoneOf(detail.effectiveSets, landmark);
    return {
      muscle,
      ...detail,
      landmark,
      zone,
      zoneLabel: ZONE_LABELS_KO[zone],
      mrvRatio: round1(detail.effectiveSets / landmark.mrv * 10) / 10,
    };
  });
}

/** 집계용 숫자 도우미 — 소수 첫째 자리까지만 남긴다. */
function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/* ── 날짜 유틸 ─────────────────────────────────────────────── */

/** ISO 날짜를 주(월요일 시작)의 시작일로 정규화한다. */
export function weekStart(isoDate: string): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  const day = date.getUTCDay(); // 0(일) ~ 6(토)
  const offset = day === 0 ? 6 : day - 1;
  date.setUTCDate(date.getUTCDate() - offset);
  return date.toISOString().slice(0, 10);
}

export function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** 세션을 주 단위로 묶는다. 키는 그 주의 월요일. */
export function groupByWeek(sessions: readonly SessionLog[]): Map<string, SessionLog[]> {
  const weeks = new Map<string, SessionLog[]>();
  for (const session of sessions) {
    const key = weekStart(session.date);
    const bucket = weeks.get(key);
    if (bucket) bucket.push(session);
    else weeks.set(key, [session]);
  }
  return new Map([...weeks].sort(([a], [b]) => (a < b ? -1 : 1)));
}

/** 특정 날짜가 속한 주의 세션만 고른다. */
export function sessionsInWeek(sessions: readonly SessionLog[], isoDate: string): SessionLog[] {
  const start = weekStart(isoDate);
  const end = addDays(start, 6);
  return sessions.filter((session) => session.date >= start && session.date <= end);
}

/** 부위별 현황에서 유효 세트만 뽑아낸 가벼운 형태. */
export function toVolumeMap(report: readonly MuscleVolumeStatus[]): VolumeByMuscle {
  const out: VolumeByMuscle = {};
  for (const status of report) out[status.muscle] = status.effectiveSets;
  return out;
}

/** 집계 결과에서 유효 세트만 뽑아낸 가벼운 형태. */
export function detailsToVolumeMap(
  totals: Record<MuscleGroup, MuscleVolumeDetail>,
): VolumeByMuscle {
  const out: VolumeByMuscle = {};
  for (const muscle of MUSCLE_GROUPS) out[muscle] = totals[muscle].effectiveSets;
  return out;
}
