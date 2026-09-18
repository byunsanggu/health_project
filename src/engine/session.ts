import { prescribeLoad, roundToIncrement, type LoadRule, type RepRange } from './load.ts';
import { findSubstitutes, screenExercise, type PainRuling } from './pain.ts';
import { aggregateVolume, sessionsInWeek } from './volume.ts';
import { MUSCLE_GROUPS } from './muscles.ts';
import {
  availableEquipmentOf,
  isAvailableAt,
  loadingFor,
  nearestLoadable,
  platePlan,
  type GymProfile,
  type LoadingSpec,
  type PlatePlan,
  type SnapDirection,
} from './gym.ts';
import { suggestStartingLoad, type LifterProfile, type StartingLoad } from './strength.ts';
import { withParticle } from './korean.ts';
import { NO_CALIBRATION, calibrateRir, type RirCalibration } from './rirCalibration.ts';
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

export type SwapReason = 'pain' | 'unavailable' | 'occupied';

export interface PlannedExercise {
  exercise: Exercise;
  sets: PlannedSet[];
  /** 교체된 경우 원래 종목 */
  substitutedFrom?: Exercise;
  /** 왜 교체됐는지 — 통증 때문인지, 헬스장에 기구가 없어서인지 */
  swapReason?: SwapReason;
  painRuling: PainRuling;
  /** 그 헬스장에서 이 종목을 싣는 방식 */
  loading?: LoadingSpec | null;
  /** 바에 끼울 플레이트. 스택식이면 null */
  plates?: PlatePlan | null;
  /** 첫 수행이라 중량을 추정한 경우의 근거 */
  startingLoad?: StartingLoad;
  /** 중량/세트 처방 근거 한 줄 */
  note: string;
}

/** 경고의 성격. UI가 라벨과 색을 고르는 데 쓴다. */
export type WarningKind = 'plan' | 'pain' | 'equipment';

export interface SessionWarning {
  kind: WarningKind;
  text: string;
  /** 의료 상담을 권해야 하는 수준인가 */
  medical?: boolean;
}

export interface PlannedSession {
  date: string;
  name: string;
  phase: WeeklyPlan['phase'];
  targetRir: number;
  exercises: PlannedExercise[];
  /** 사용자에게 먼저 보여줄 경고 (통증, 기구, 디로드) */
  warnings: SessionWarning[];
  /** 이 세션의 중량 처방에 적용된 RIR 신뢰도 보정 */
  rirCalibration: RirCalibration;
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
  /** 오늘 쓸 수 있는 기구 (기구 점유 등 일시적 제약) */
  availableEquipment?: readonly Equipment[];
  /** 다니는 헬스장. 중량 스냅과 기구 보유 여부가 여기서 나온다 */
  gym?: GymProfile;
  /** 첫 수행 종목의 중량을 추정하기 위한 신체 정보 */
  lifter?: LifterProfile;
  /** 미리 계산한 RIR 보정. 없으면 이력에서 직접 구한다 */
  rirCalibration?: RirCalibration;
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
  const warnings: SessionWarning[] = [];
  const exercises: PlannedExercise[] = [];

  if (input.plan.phase === 'deload') {
    warnings.push({ kind: 'plan', text: input.plan.summary });
  }
  if (pain.some((report) => report.score >= 7)) {
    warnings.push({
      kind: 'pain',
      medical: true,
      text: '통증이 7점 이상입니다. 오늘은 해당 부위를 쓰지 않고, 통증이 지속되면 전문의 진료를 받으세요.',
    });
  }

  const scaling = volumeScaling(input);
  const gym = input.gym;
  const calibration =
    input.rirCalibration ??
    (input.history.length > 0 ? calibrateRir(input.history, { asOf: input.date }) : NO_CALIBRATION);
  const rirOffset = calibration.applied ? calibration.offset : 0;

  // 헬스장에 없는 기구는 후보에서 아예 빼고 시작한다.
  const pool = [...input.index.values()].filter((candidate) => !gym || isAvailableAt(candidate, gym));
  const availableEquipment = input.availableEquipment ?? (gym ? availableEquipmentOf(gym) : undefined);

  for (const slot of input.template.slots) {
    const original = input.index.get(slot.exerciseId);
    if (!original) continue;

    let exercise = original;
    let substitutedFrom: Exercise | undefined;
    let swapReason: SwapReason | undefined;

    // 1) 그 헬스장에 기구가 있는가
    if (gym && !isAvailableAt(original, gym)) {
      const replacement = findSubstitutes(original, [], { pool, availableEquipment })[0];
      if (!replacement) {
        warnings.push({
          kind: 'equipment',
          text: `${original.name} — 이 헬스장에 없는 기구이고 대체할 종목도 없어 오늘은 건너뜁니다.`,
        });
        continue;
      }
      exercise = replacement;
      substitutedFrom = original;
      swapReason = 'unavailable';
      warnings.push({
        kind: 'equipment',
        text: `${original.name} 대신 ${withParticle(replacement.name, '을/를')} 넣었습니다. 이 헬스장에 없는 기구입니다.`,
      });
    }

    // 2) 통증 게이트
    const ruling = screenExercise(exercise, pain, { pool, availableEquipment });

    if (ruling.action === 'substitute' || ruling.action === 'stop') {
      const replacement = ruling.substitutes[0];
      if (!replacement) {
        warnings.push({ kind: 'pain', text: `${exercise.name} — ${ruling.message}`, medical: ruling.action === 'stop' });
        continue; // 대체가 없으면 오늘은 건너뛴다
      }
      substitutedFrom = substitutedFrom ?? exercise;
      exercise = replacement;
      swapReason = 'pain';
      warnings.push({ kind: 'pain', text: ruling.message, medical: ruling.action === 'stop' });
    }

    // 3) 세트 수 — 주간 볼륨 처방에 맞춰 조정
    const setCount = adjustSetCount(slot, exercise, scaling);

    // 4) 중량 — 마지막 수행 기록 기준, 그 헬스장이 만들 수 있는 값으로 맞춘다
    const lastSession = findLastSession(input.history, exercise.id);
    const rule: LoadRule = { repRange: slot.repRange, targetRir: input.plan.targetRir, rirOffset };
    const prescription = prescribeLoad(exercise, lastSession?.sets, rule);
    const loading = gym ? loadingFor(exercise, gym) : null;

    const multiplier = input.plan.intensityMultiplier * ruling.loadMultiplier;
    let weightKg: number | null;
    let startingLoad: StartingLoad | undefined;

    if (prescription.weightKg === null) {
      // 첫 수행. 관련 종목 기록이나 체중 기준선에서 출발점을 제안한다.
      startingLoad = suggestStartingLoad({
        exercise,
        repRange: slot.repRange,
        targetRir: input.plan.targetRir,
        profile: input.lifter,
        history: input.history,
        index: input.index,
        loading,
      });
      weightKg = startingLoad.weightKg;
    } else {
      weightKg = snapLoad(prescription.weightKg * multiplier, exercise, loading, multiplier, prescription.change);
    }

    // 대체 종목은 이력이 없다. 원래 종목의 마지막 기록을 참고로 붙인다.
    const reference =
      prescription.change === 'start' && substitutedFrom
        ? referenceLoad(input.history, substitutedFrom)
        : undefined;

    exercises.push({
      exercise,
      substitutedFrom,
      swapReason,
      painRuling: ruling,
      loading,
      plates: weightKg !== null && loading ? platePlan(weightKg, loading) : null,
      startingLoad,
      note: buildNote(prescription.reason, multiplier, ruling, reference, startingLoad),
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
    rirCalibration: calibration,
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

/**
 * 처방 중량을 기구가 만들 수 있는 값으로 맞춘다.
 * 증량 중이면 위로, 감량·통증·디로드 중이면 아래로 붙여 의도한 방향을 잃지 않게 한다.
 */
function snapLoad(
  targetKg: number,
  exercise: Exercise,
  loading: LoadingSpec | null,
  multiplier: number,
  change: string,
): number {
  if (!loading) return roundToIncrement(targetKg, exercise.increment);

  const direction: SnapDirection =
    multiplier < 1 || change === 'decrease' ? 'down' : change === 'increase' ? 'up' : 'nearest';
  return nearestLoadable(targetKg, loading, direction);
}

function buildNote(
  reason: string,
  multiplier: number,
  ruling: PainRuling,
  reference?: string,
  startingLoad?: StartingLoad,
): string {
  const parts = [startingLoad ? startingLoad.rationale : reason];
  if (reference) parts.push(reference);
  if (multiplier < 1) {
    parts.push(`적용 배율 ${Math.round(multiplier * 100)}%`);
  }
  if (ruling.action === 'reduceLoad') {
    parts.push(ruling.message);
  }
  return parts.join(' · ');
}
