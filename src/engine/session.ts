import { prescribeLoad, roundToIncrement, type LoadRule, type RepRange } from './load.ts';
import { findSubstitutes, screenExercise, type PainRuling } from './pain.ts';
import { planWeekSets } from './weekSets.ts';
import { HEAVY_PULLS, HEAVY_PULL_MIN_RIR } from './exercises.ts';
import { addDays, sessionsInWeek } from './volume.ts';
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
import { describeGymWeight, weightHistoryFor } from './gymWeight.ts';
import { guessStep, learnStack, learnable, observedWeights } from './stackLearn.ts';
import { suggestStartingLoad, type LifterProfile, type StartingLoad } from './strength.ts';
import { withParticle } from './korean.ts';
import { NO_CALIBRATION, calibrateRir, type RirCalibration } from './rirCalibration.ts';
import type { WeeklyPlan } from './mesocycle.ts';
import type {
  Equipment,
  Exercise,
  LandmarksByMuscle,
  MuscleGroup,
  PainReport,
  SessionLog,
} from './types.ts';

export interface SessionSlot {
  exerciseId: string;
  /** 템플릿 기준 세트 수. 주간 처방에 따라 조정된다. */
  sets: number;
  repRange: RepRange;
  /** 프로그램에서 맡은 역할. 블록이 바뀔 때 보조 · 고립만 바꿔 끼우는 데 쓴다. */
  role?: 'primary' | 'accessory' | 'isolation';
  /** 뺀 종목 대신 들어온 자리면 원래 종목 — 주간 세트 배분은 원래 자리를 따른다 */
  replacedFrom?: string;
}

export interface SessionTemplate {
  /** 예: '상체 A' */
  name: string;
  slots: SessionSlot[];
  /** 프로그램을 짤 때 맞춘 세션 총 세트 상한(참고값). 주마다 늘어나는 폭은 planWeekSets가 정한다. */
  setCap?: number;
  /**
   * 사용자가 직접 짠 루틴의 날. 세트 수를 주간 처방으로 늘리거나 줄이지 않고
   * 정한 대로 한다 — 덜어내는 주에만 절반으로. 무게 · 횟수 진행은 똑같다.
   */
  fixed?: boolean;
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
  /** 이 헬스장에서 처음 쓰는 기계일 때의 안내 */
  gymWeightNote?: string;
  /** 중량/세트 처방 근거 한 줄 */
  note: string;
  /** 템플릿이 정한 세트 수 — 주간 처방으로 늘어난 폭을 잴 때 쓴다 */
  templateSets?: number;
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
  /**
   * 오늘 가는 헬스장의 id.
   * 머신·케이블 중량 이력을 이 헬스장 것으로만 거르는 데 쓴다.
   */
  gymId?: string;
  /**
   * 오늘 어느 기계로 하는가. { 종목id: 기계열쇠 }
   *
   * 같은 헬스장에 같은 종목 기계가 둘 이상일 때만 쓴다. 안 주면 전부
   * 첫 번째 기계로 보므로, 나눈 적 없는 사람에게는 아무것도 달라지지 않는다.
   */
  machines?: Readonly<Record<string, string>>;
  /** 첫 수행 종목의 중량을 추정하기 위한 신체 정보 */
  lifter?: LifterProfile;
  /** 미리 계산한 RIR 보정. 없으면 이력에서 직접 구한다 */
  rirCalibration?: RirCalibration;
  /**
   * 이번 주 전체 — 프로그램의 날 전부와 오늘이 몇 번째 날인가. 세트 수는 한 주를 통째로
   * 보고 나눠야 날마다 앞뒤가 맞는다(planWeekSets). 없으면 오늘 템플릿만 한 주로 본다.
   */
  week?: { templates: readonly SessionTemplate[]; day: number };
  /** 부위별 기준선 — 세트를 붙일 때 최소 미달을 먼저 채우고 한계를 넘기지 않는다 */
  landmarks?: LandmarksByMuscle;
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

  const setsFor = weekSetsFor(input);
  const gym = input.gym;
  const calibration =
    input.rirCalibration ??
    (input.history.length > 0 ? calibrateRir(input.history, { asOf: input.date }) : NO_CALIBRATION);
  const rirOffset = calibration.applied ? calibration.offset : 0;

  // 헬스장에 없는 기구는 후보에서 아예 빼고 시작한다.
  const pool = [...input.index.values()].filter((candidate) => !gym || isAvailableAt(candidate, gym));
  const availableEquipment = input.availableEquipment ?? (gym ? availableEquipmentOf(gym) : undefined);

  /*
   * 이미 고른 종목은 다시 고르지 않는다.
   *
   * 기구가 빠지면 여러 슬롯이 같은 대체 종목으로 몰린다 — 바벨이 없어지면
   * 데드리프트도 스티프 레그 데드리프트도 케이블 풀스루가 된다. 그걸 그대로
   * 두면 한 세션에 같은 종목이 두 번 나온다.
   */
  const taken = new Set<string>();
  const pickReplacement = (candidates: readonly Exercise[]) =>
    candidates.find((candidate) => !taken.has(candidate.id));

  for (const slot of input.template.slots) {
    const original = input.index.get(slot.exerciseId);
    if (!original) continue;

    let exercise = original;
    let substitutedFrom: Exercise | undefined;
    let swapReason: SwapReason | undefined;

    // 1) 그 헬스장에 기구가 있는가
    if (gym && !isAvailableAt(original, gym)) {
      const replacement = pickReplacement(
        findSubstitutes(original, [], { pool, availableEquipment, substituteLimit: pool.length }),
      );
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
      const replacement = pickReplacement(ruling.substitutes);
      if (!replacement) {
        warnings.push({ kind: 'pain', text: `${exercise.name} — ${ruling.message}`, medical: ruling.action === 'stop' });
        continue; // 대체가 없으면 오늘은 건너뛴다
      }
      substitutedFrom = substitutedFrom ?? exercise;
      exercise = replacement;
      swapReason = 'pain';
      warnings.push({ kind: 'pain', text: ruling.message, medical: ruling.action === 'stop' });
    }

    if (taken.has(exercise.id)) continue;
    taken.add(exercise.id);

    // 3) 세트 수 — 주간 처방을 한 주 통째로 나눈 몫. 내 루틴은 정한 대로(덜어내는 주만 절반)
    const setCount = input.template.fixed ? fixedSetCount(slot, input.plan) : setsFor(slot);

    /*
     * 4) 중량 — 마지막 수행 기록 기준, 그 헬스장이 만들 수 있는 값으로 맞춘다.
     *
     * 머신·케이블·스미스는 같은 헬스장 기록만 본다. A짐 레그프레스 100kg을
     * 들고 B짐에 가면 엉뚱한 무게가 된다 — 기계마다 표기가 다르다.
     */
    const weightHistory = weightHistoryFor(input.history, exercise, {
      gymId: input.gymId,
      machine: input.machines?.[exercise.id],
    });
    const lastSession = findLastSession(weightHistory, exercise.id);
    // 데드리프트는 블록 끝에서도 여유를 2개는 남긴다 — 무너지면 허리가 받는다
    const targetRir = HEAVY_PULLS.has(exercise.id) ? Math.max(HEAVY_PULL_MIN_RIR, input.plan.targetRir) : input.plan.targetRir;
    const rule: LoadRule = { repRange: slot.repRange, targetRir, rirOffset };
    const prescription = prescribeLoad(exercise, lastSession?.sets, rule);
    /*
     * 이 기계가 실제로 만드는 무게로 맞춘다.
     *
     * 헬스장 전체에 스택 명세 하나(최소 5 · 간격 5 · 최대 100)를 쓰면
     * 기계가 스무 대인 곳에서 스무 번 틀린다. 제일 크게 틀리는 것은
     * 천장이다 — 랫풀다운 120kg을 하는 사람에게 102.5를 처방한다.
     *
     * 적어 둔 무게가 곧 그 기계가 만들 수 있다는 증거이므로, 거기서 읽어
     * 명세를 고쳐 쓴다. 읽을 것이 없으면 기본값 그대로다.
     */
    const base = gym ? loadingFor(exercise, gym) : null;
    const loading = base && base.kind === 'stack' && learnable(exercise)
      ? learnStack(base, guessStep(
        observedWeights(input.history, exercise.id, input.gymId, input.machines?.[exercise.id])))
      : base;
    const gymWeight = describeGymWeight(input.history, exercise, input.gymId);

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
      gymWeightNote: gymWeight.note,
      note: buildNote(prescription.reason, multiplier, ruling, reference, startingLoad),
      templateSets: slot.sets,
      sets: Array.from({ length: setCount }, (_, i) => ({
        setNumber: i + 1,
        weightKg,
        targetReps: prescription.targetReps,
        targetRir,
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
 * 오늘 슬롯마다 세트 수. 한 주를 통째로 나눈 몫(planWeekSets)에서 오늘 날 것을 꺼낸다.
 *
 * 오늘 템플릿에는 오늘만 끼워 넣은 종목이 뒤에 붙거나, 뺀 종목 자리에 대체가 들어와
 * 있을 수 있다. 대체는 원래 자리의 몫을 받고, 끼워 넣은 종목은 고른 세트 그대로다.
 */
function weekSetsFor(input: BuildSessionInput): (slot: SessionSlot) => number {
  const week = input.week ?? { templates: [input.template], day: 0 };
  const day = week.templates[week.day];
  if (!day) return (slot) => Math.max(1, slot.sets);
  // 처방의 바탕이 된 주(이번 주 바로 앞 주) — 종목마다 거기서 한 만큼에서 출발한다
  const lastWeek = input.plan.weekStart ? sessionsInWeek(input.history, addDays(input.plan.weekStart, -1)) : [];
  const planned = planWeekSets({
    templates: week.templates, plan: input.plan, index: input.index, landmarks: input.landmarks, lastWeek,
  });
  return (slot) => {
    const at = day.slots.findIndex((item) => item.exerciseId === (slot.replacedFrom ?? slot.exerciseId));
    return at >= 0 ? planned[week.day]![at]! : Math.max(1, slot.sets);
  };
}

/**
 * 내 루틴의 세트 수. 사용자가 정한 그대로 — 덜어내는 주에는 절반(올림)으로 줄인다.
 * 회복 주를 건너뛰면 루틴이어도 피로가 쌓인다.
 */
function fixedSetCount(slot: SessionSlot, plan: WeeklyPlan): number {
  return plan.phase === 'deload' ? Math.max(1, Math.ceil(slot.sets / 2)) : Math.max(1, slot.sets);
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

/** 교체 전 종목의 마지막 본세트를 한 줄로 요약한다. */
function referenceLoad(
  history: readonly SessionLog[],
  original: Exercise,
): string | undefined {
  const lastSession = findLastSession(history, original.id);
  if (!lastSession) return undefined;
  const set = lastSession.sets.find((s) => s.exerciseId === original.id && !s.warmup);
  if (!set) return undefined;
  return `참고: ${original.name} ${set.weightKg}kg × ${set.reps}회 (여유 ${set.rir}개)`;
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
