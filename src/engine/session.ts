import { prescribeLoad, roundToIncrement, type LoadRule, type RepRange } from './load.ts';
import { screenExercise, type PainRuling } from './pain.ts';
import { aggregateVolume, sessionsInWeek } from './volume.ts';
import { MUSCLE_GROUPS } from './muscles.ts';
import type { WeeklyPlan } from './mesocycle.ts';
import type {
  Equipment,
  Exercise,
  MuscleGroup,
  PainReport,
  SessionLog,
} from './types.ts';

export interface SessionSlot {
  exerciseId: string;
  /** 템플릿 기준 세트 수. 주간 처방에 따라 조정된다. */
  sets: number;
  repRange: RepRange;
}

export interface SessionTemplate {
  /** 예: '상체 A' */
  name: string;
  slots: SessionSlot[];
}

export interface PlannedSet {
  setNumber: number;
  /** null이면 사용자가 첫 중량을 정해야 한다. */
  weightKg: number | null;
  targetReps: RepRange;
  targetRir: number;
}

export interface PlannedExercise {
  exercise: Exercise;
  sets: PlannedSet[];
  /** 통증 게이트로 교체된 경우 원래 종목 */
  substitutedFrom?: Exercise;
  painRuling: PainRuling;
  /** 중량/세트 처방 근거 한 줄 */
  note: string;
}

export interface PlannedSession {
  date: string;
  name: string;
  phase: WeeklyPlan['phase'];
  targetRir: number;
  exercises: PlannedExercise[];
  /** 사용자에게 먼저 보여줄 경고 (통증, 디로드 등) */
  warnings: string[];
}

export interface BuildSessionInput {
  template: SessionTemplate;
  /** 이 세션을 수행할 날짜 */
  date: string;
  plan: WeeklyPlan;
  /** 전체 훈련 이력 */
  history: readonly SessionLog[];
  index: ReadonlyMap<string, Exercise>;
  /** 오늘 체크인에서 보고된 통증 */
  pain?: readonly PainReport[];
  /** 오늘 쓸 수 있는 기구 (기구 점유/부재 대응) */
  availableEquipment?: readonly Equipment[];
}

/**
 * 오늘 세션을 만든다 — 엔진의 출구.
 *
 * 순서가 곧 우선순위다.
 *   1. 통증으로 못 할 동작을 먼저 걷어낸다 (안전)
 *   2. 주간 볼륨 처방에 맞춰 세트 수를 조정한다 (주기화)
 *   3. 마지막 수행 기록으로 중량을 정한다 (진행)
 * 부하를 먼저 정하고 통증을 나중에 보면, 아픈 관절에 어제보다 무거운 걸 얹게 된다.
 */
export function buildSession(input: BuildSessionInput): PlannedSession {
  const pain = input.pain ?? [];
  const warnings: string[] = [];
  const exercises: PlannedExercise[] = [];

  if (input.plan.phase === 'deload') {
    warnings.push(input.plan.summary);
  }
  if (pain.some((report) => report.score >= 7)) {
    warnings.push('통증이 7점 이상입니다. 오늘은 해당 부위를 쓰지 않고, 통증이 지속되면 전문의 진료를 받으세요.');
  }

  const scaling = volumeScaling(input);

  for (const slot of input.template.slots) {
    const original = input.index.get(slot.exerciseId);
    if (!original) continue;

    // 1) 통증 게이트
    const ruling = screenExercise(original, pain, {
      pool: [...input.index.values()],
      availableEquipment: input.availableEquipment,
    });

    let exercise = original;
    let substitutedFrom: Exercise | undefined;

    if (ruling.action === 'substitute' || ruling.action === 'stop') {
      const replacement = ruling.substitutes[0];
      if (!replacement) {
        warnings.push(`${original.name}: ${ruling.message}`);
        continue; // 대체가 없으면 오늘은 건너뛴다
      }
      exercise = replacement;
      substitutedFrom = original;
      warnings.push(ruling.message);
    }

    // 2) 세트 수 — 주간 볼륨 처방에 맞춰 조정
    const setCount = adjustSetCount(slot, exercise, scaling);

    // 3) 중량 — 마지막 수행 기록 기준
    const lastSession = findLastSession(input.history, exercise.id);
    const rule: LoadRule = { repRange: slot.repRange, targetRir: input.plan.targetRir };
    const prescription = prescribeLoad(exercise, lastSession?.sets, rule);

    const multiplier = input.plan.intensityMultiplier * ruling.loadMultiplier;
    const weightKg =
      prescription.weightKg === null
        ? null
        : roundToIncrement(prescription.weightKg * multiplier, exercise.increment);

    // 대체 종목은 이력이 없어 중량을 못 정한다. 원래 종목의 마지막 기록을
    // 참고로 붙여 사용자가 어림잡을 수 있게 한다 — 임의로 환산하면 오히려 위험하다.
    const reference =
      prescription.change === 'start' && substitutedFrom
        ? referenceLoad(input.history, substitutedFrom)
        : undefined;

    exercises.push({
      exercise,
      substitutedFrom,
      painRuling: ruling,
      note: buildNote(prescription.reason, multiplier, ruling, reference),
      sets: Array.from({ length: setCount }, (_, i) => ({
        setNumber: i + 1,
        weightKg,
        targetReps: prescription.targetReps,
        targetRir: input.plan.targetRir,
      })),
    });
  }

  return {
    date: input.date,
    name: input.template.name,
    phase: input.plan.phase,
    targetRir: input.plan.targetRir,
    exercises,
    warnings,
  };
}

/**
 * 근육군별 "처방 세트 ÷ 지난주 세트" 배율.
 * 이 배율로 템플릿 세트 수를 늘리거나 줄인다.
 */
function volumeScaling(input: BuildSessionInput): Map<MuscleGroup, number> {
  const lastWeek = sessionsInWeek(input.history, lastTrainedDate(input.history) ?? input.date);
  const current = aggregateVolume(lastWeek, input.index);
  const scaling = new Map<MuscleGroup, number>();

  for (const item of input.plan.volume) {
    const currentSets = current[item.muscle]?.effectiveSets ?? 0;
    // 지난주 기록이 없으면 템플릿을 그대로 신뢰한다.
    scaling.set(item.muscle, currentSets <= 0 ? 1 : item.prescribedSets / currentSets);
  }
  for (const muscle of MUSCLE_GROUPS) {
    if (!scaling.has(muscle)) scaling.set(muscle, 1);
  }
  return scaling;
}

/** 슬롯의 주동근 배율을 적용하되, 한 번에 ±2세트 넘게 흔들지 않는다. */
function adjustSetCount(
  slot: SessionSlot,
  exercise: Exercise,
  scaling: ReadonlyMap<MuscleGroup, number>,
): number {
  const primary = primaryMuscle(exercise);
  const factor = primary ? scaling.get(primary) ?? 1 : 1;
  const scaled = Math.round(slot.sets * factor);
  const bounded = Math.min(slot.sets + 2, Math.max(slot.sets - 2, scaled));
  return Math.max(1, bounded);
}

export function primaryMuscle(exercise: Exercise): MuscleGroup | undefined {
  let best: MuscleGroup | undefined;
  let bestValue = 0;
  for (const muscle of MUSCLE_GROUPS) {
    const value = exercise.contribution[muscle] ?? 0;
    if (value > bestValue) {
      best = muscle;
      bestValue = value;
    }
  }
  return best;
}

function findLastSession(
  history: readonly SessionLog[],
  exerciseId: string,
): SessionLog | undefined {
  let latest: SessionLog | undefined;
  for (const session of history) {
    const performed = session.sets.some((set) => set.exerciseId === exerciseId && !set.warmup);
    if (!performed) continue;
    if (!latest || session.date > latest.date) latest = session;
  }
  return latest;
}

function lastTrainedDate(history: readonly SessionLog[]): string | undefined {
  let latest: string | undefined;
  for (const session of history) {
    if (!latest || session.date > latest) latest = session.date;
  }
  return latest;
}

/** 교체 전 종목의 마지막 본세트를 한 줄로 요약한다. */
function referenceLoad(
  history: readonly SessionLog[],
  original: Exercise,
): string | undefined {
  const lastSession = findLastSession(history, original.id);
  if (!lastSession) return undefined;
  const set = lastSession.sets.find((s) => s.exerciseId === original.id && !s.warmup);
  if (!set) return undefined;
  return `참고: ${original.name} ${set.weightKg}kg × ${set.reps}회 (RIR ${set.rir})`;
}

function buildNote(
  reason: string,
  multiplier: number,
  ruling: PainRuling,
  reference?: string,
): string {
  const parts = [reason];
  if (reference) parts.push(reference);
  if (multiplier < 1) {
    parts.push(`적용 배율 ${Math.round(multiplier * 100)}%`);
  }
  if (ruling.action === 'reduceLoad') {
    parts.push(ruling.message);
  }
  return parts.join(' · ');
}
