import { prescribeLoad, roundToIncrement, type LoadRule, type RepRange } from './load.ts';
import { JOINT_LABELS_KO, findSubstitutes, screenExercise, type PainRuling } from './pain.ts';
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
  /** 주 1회 무거운 세트(withTopSet) */
  top?: boolean;
}

export type SwapReason = 'pain' | 'unavailable' | 'occupied' | 'ability';

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
  /*
   * 오늘 뒤에 나올 종목도 대체로 고르지 않는다. 벤치를 머신 체스트프레스로 바꿨는데 머신이
   * 뒤에 또 있으면, 그 자리에 가서 "이미 했다"고 빠져 가슴 세트가 통째로 사라졌다. 대체가
   * 그것뿐이면 새로 넣지 않고 그 종목에 세트를 얹는다.
   */
  const planned = new Set(input.template.slots.map((slot) => slot.exerciseId));
  const bonus = new Map<string, number>();
  const pickReplacement = (candidates: readonly Exercise[]) =>
    candidates.find((candidate) => !taken.has(candidate.id) && !planned.has(candidate.id));
  /** 대체가 오늘 목록에 이미 있다 — 그 종목에 세트를 얹는다(이미 짰으면 바로, 뒤면 그때). 얹었으면 그 종목 */
  const mergeInto = (candidates: readonly Exercise[], from: Exercise, extra: number): Exercise | undefined => {
    const into = candidates.find((candidate) => candidate.id !== from.id && planned.has(candidate.id));
    if (!into) return undefined;
    const done = exercises.find((item) => item.exercise.id === into.id);
    if (done) {
      const last = done.sets[done.sets.length - 1]!;
      const room = Math.max(0, MERGED_SET_CAP - done.sets.length);
      for (let i = 0; i < Math.min(extra, room); i += 1) done.sets.push({ ...last, setNumber: done.sets.length + 1 });
    } else {
      bonus.set(into.id, (bonus.get(into.id) ?? 0) + extra);
    }
    return into;
  };
  const slotSets = (slot: SessionSlot) => (input.template.fixed ? fixedSetCount(slot, input.plan) : setsFor(slot));

  for (const slot of input.template.slots) {
    const original = input.index.get(slot.exerciseId);
    if (!original) continue;

    let exercise = original;
    let substitutedFrom: Exercise | undefined;
    let swapReason: SwapReason | undefined;

    // 1) 그 헬스장에 기구가 있는가
    if (gym && !isAvailableAt(original, gym)) {
      const candidates = findSubstitutes(original, [], { pool, availableEquipment, substituteLimit: pool.length });
      const replacement = pickReplacement(candidates);
      if (!replacement) {
        const into = mergeInto(candidates, original, slotSets(slot));
        warnings.push({
          kind: 'equipment',
          text: into
            ? `${original.name} — 이 헬스장에 없는 기구입니다. 오늘 하는 ${into.name}에 세트를 더했습니다.`
            : `${original.name} — 이 헬스장에 없는 기구이고 대체할 종목도 없어 오늘은 건너뜁니다.`,
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

    /*
     * 1-2) 맨몸 풀업을 두 번 연속 목표 하단까지 못 했으면 무게를 맞출 수 있는 당기기로 바꾼다.
     * 0~1개짜리 세트를 6주 동안 반복하면 등은 안 자란다. 랫풀다운 · 어시스트가 없으면
     * 그대로 두고 처방이 보조 · 네거티브를 권한다.
     */
    if (BODYWEIGHT_PULLS.has(exercise.id) && failedTwice(input.history, exercise.id, slot.repRange.min)) {
      const easier = pool.find((candidate) => LOADABLE_PULLS.includes(candidate.id) && !taken.has(candidate.id) && !planned.has(candidate.id));
      if (easier) {
        warnings.push({
          kind: 'plan',
          text: `${exercise.name} 두 번 연속 ${slot.repRange.min}회에 못 미쳤습니다. 오늘은 ${withParticle(easier.name, '으로/로')} 등을 채웁니다 — ` +
            '풀업은 운동 끝에 위에서 천천히 내려오기(네거티브) 3개로 이어 가세요.',
        });
        substitutedFrom = substitutedFrom ?? exercise;
        exercise = easier;
        swapReason = swapReason ?? 'ability';
      }
    }

    // 2) 통증 게이트
    const ruling = screenExercise(exercise, pain, { pool, availableEquipment });

    if (ruling.action === 'substitute' || ruling.action === 'stop') {
      const replacement = pickReplacement(ruling.substitutes);
      const medical = ruling.action === 'stop';
      const joint = ruling.joint ? `${JOINT_LABELS_KO[ruling.joint]} 통증 ${ruling.painScore}점 — ` : '';
      if (!replacement) {
        const into = mergeInto(ruling.substitutes, exercise, slotSets(slot));
        /*
         * 7점 이상이면 맨 위에 "오늘은 그 부위를 쓰지 않는다 · 진료" 경고가 이미 한 번 있다.
         * 종목마다 같은 의료 문구를 되풀이하면 경고 다섯 줄이 같은 말이다 — 무엇을 뺐는지만 말한다.
         */
        const general = pain.some((report) => report.score >= 7);
        warnings.push({
          kind: 'pain',
          medical: medical && !general,
          text: into
            ? `${joint}${exercise.name} 대신 오늘 하는 ${into.name}에 세트를 더했습니다.`
            : medical && general
              ? `${joint}${withParticle(exercise.name, '은/는')} 오늘 뺍니다.`
              : `${exercise.name} — ${ruling.message}`,
        });
        continue; // 대체가 없으면 오늘은 건너뛴다
      }
      // 판정의 문구는 첫 후보를 말한다 — 실제로 고른 종목으로 말한다
      warnings.push({
        kind: 'pain',
        medical,
        text: medical ? ruling.message : `${joint}${exercise.name} 대신 ${withParticle(replacement.name, '을/를')} 합니다.`,
      });
      substitutedFrom = substitutedFrom ?? exercise;
      exercise = replacement;
      swapReason = 'pain';
    }

    if (taken.has(exercise.id)) continue;
    taken.add(exercise.id);

    // 3) 세트 수 — 주간 처방을 한 주 통째로 나눈 몫. 내 루틴은 정한 대로(덜어내는 주만 절반).
    //    앞에서 빠진 종목의 세트를 얹었으면 더한다(종목당 6세트까지)
    const ownSets = slotSets(slot);
    const setCount = Math.max(ownSets, Math.min(MERGED_SET_CAP, ownSets + (bonus.get(exercise.id) ?? 0)));
    /*
     * 대체 종목의 반복 범위. 백 스쿼트 4~6회 자리에 스텝업이 들어오면 스텝업 4~6회가 된다 —
     * 한 발 종목 · 고립 종목은 그 종목에 맞는 범위로 바꾼다.
     */
    const repRange = substitutedFrom ? substituteRange(slot.repRange, substitutedFrom, exercise) : slot.repRange;

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
    const rule: LoadRule = { repRange, targetRir, rirOffset };
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
    // 아픈 동안 올리지 않고 둔 날 — "N kg 올립니다"라고 쓰면 안 된다
    let painHold = false;
    let increaseNote: string | null = null;

    if (prescription.weightKg === null) {
      // 첫 수행. 관련 종목 기록이나 체중 기준선에서 출발점을 제안한다.
      startingLoad = suggestStartingLoad({
        exercise,
        repRange,
        targetRir: input.plan.targetRir,
        profile: input.lifter,
        history: input.history,
        index: input.index,
        loading,
      });
      weightKg = startingLoad.weightKg;
      // 처음 하는 종목이어도 아픈 날이면 낮춘다 — 안내는 "25% 낮춥니다"라고 하면서 그대로 내주던 것
      if (weightKg !== null && ruling.loadMultiplier < 1) {
        weightKg = snapLoad(weightKg * ruling.loadMultiplier, exercise, loading, ruling.loadMultiplier, 'decrease');
      }
    } else if (ruling.loadMultiplier < 1) {
      /*
       * 아픈 날 감량은 아프기 전 무게에서 한 번만. 지난번에 이미 낮춘 무게에 또 곱하면 같은 통증이
       * 이어지는 동안 세션마다 무게가 줄었다(레그프레스 130 → 97.5 → 82.5 → 60). 최근 6주 가장 무거운
       * 본세트를 기준으로 낮춘 값을 넘지 않게 하고, 그보다 가벼운 처방이면 처방대로 둔다.
       */
      const best = recentBest(weightHistory, exercise.id, input.date);
      const normal = prescription.weightKg * input.plan.intensityMultiplier;
      const lastCut = Boolean(lastSession?.sets.some((set) => set.exerciseId === exercise.id && set.painCut));
      // 지난번이 이미 낮춘 무게였으면 거기서 처방대로(더 곱하지 않는다), 아니면 지금 낮춘다
      // 같은 통증이 이어지는 동안은 무게를 올리지 않는다 — 반복만 늘린다
      const lastWeight = Math.max(0, ...(lastSession?.sets ?? [])
        .filter((set) => set.exerciseId === exercise.id && !set.warmup && !set.top).map((set) => set.weightKg));
      let capped = lastCut ? Math.min(normal, lastWeight) : prescription.weightKg * multiplier;
      if (best > 0) capped = Math.min(capped, best * multiplier);
      weightKg = snapLoad(capped, exercise, loading, multiplier, prescription.change);
      if (lastCut && prescription.change === 'increase') painHold = true;
    } else {
      const lastKg = lastSession ? Math.max(0, ...lastSession.sets
        .filter((set) => set.exerciseId === exercise.id && !set.warmup && !set.top).map((set) => set.weightKg)) : undefined;
      weightKg = snapLoad(prescription.weightKg * multiplier, exercise, loading, multiplier, prescription.change, lastKg);
      // 기구 칸 때문에 말한 폭과 실제 폭이 다르면 실제 폭으로 말한다("1kg 올립니다"인데 2 → 4kg)
      if (prescription.change === 'increase' && multiplier >= 1 && lastKg !== undefined && weightKg !== null) {
        const actual = Math.round((weightKg - lastKg) * 100) / 100;
        if (actual > 0 && Math.abs(actual - prescription.deltaKg) > 0.01) {
          increaseNote = prescription.reason.replace(/[\d.]+kg 올립니다\.?$/, `${actual}kg 올립니다 — 이 기구로 들 수 있는 다음 무게입니다.`);
        }
      }
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
      note: buildNote(painHold ? '아픈 동안은 무게를 올리지 않고 같은 무게로 반복을 채웁니다.' : increaseNote ?? prescription.reason, multiplier, ruling, reference, startingLoad),
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
    level: input.lifter?.level,
  });
  return (slot) => {
    const at = day.slots.findIndex((item) => item.exerciseId === (slot.replacedFrom ?? slot.exerciseId));
    return at >= 0 ? planned[week.day]![at]! : Math.max(1, slot.sets);
  };
}

/** 다른 자리 세트를 얹어도 한 종목은 이만큼까지 — 더 하면 뒤 세트는 버리는 세트다 */
const MERGED_SET_CAP = 6;

/** 맨몸 세로 당기기와, 못 할 때 대신할 무게를 맞출 수 있는 당기기(앞에 둘수록 먼저) */
const BODYWEIGHT_PULLS: ReadonlySet<string> = new Set(['pull-up', 'chin-up']);
const LOADABLE_PULLS: readonly string[] = ['assisted-pull-up', 'lat-pulldown', 'neutral-grip-pulldown'];

/** 그 종목을 한 마지막 두 세션 모두 맨몸으로 목표 하단에 못 미쳤는가 */
function failedTwice(history: readonly SessionLog[], exerciseId: string, minReps: number): boolean {
  const recent = history
    .filter((session) => session.sets.some((set) => set.exerciseId === exerciseId && !set.warmup))
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
    .slice(0, 2);
  if (recent.length < 2) return false;
  return recent.every((session) => {
    const best = Math.max(0, ...session.sets
      .filter((set) => set.exerciseId === exerciseId && !set.warmup && set.weightKg <= 0)
      .map((set) => set.reps));
    return best < minReps;
  });
}

/** 대체 종목에 맞는 반복 범위 — 고립은 10~15회, 한 발 종목은 무거운 범위(6회 이하)를 8~12회로. */
function substituteRange(range: RepRange, original: Exercise, replacement: Exercise): RepRange {
  const light = (exercise: Exercise) => exercise.pattern === 'isolation' || exercise.pattern === 'core';
  if (light(replacement) && !light(original) && range.max < 10) return { min: 10, max: 15 };
  if ((replacement.pattern === 'lunge' || replacement.unilateral) && range.max <= 6) return { min: 8, max: 12 };
  return range;
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

/** 최근 6주 이 종목의 가장 무거운 본세트(아파서 낮춘 세트는 빼고) — 아픈 날 감량의 기준(아프기 전 무게). */
const PAIN_BASELINE_DAYS = 42;
function recentBest(history: readonly SessionLog[], exerciseId: string, today: string): number {
  const since = addDays(today, -PAIN_BASELINE_DAYS);
  let best = 0;
  for (const session of history) {
    if (session.date < since || session.date >= today) continue;
    for (const set of session.sets) {
      if (set.exerciseId === exerciseId && !set.warmup && !set.top && !set.painCut && set.reps > 0) best = Math.max(best, set.weightKg);
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
  lastKg?: number,
): number {
  /*
   * 올릴 때는 지난 무게보다 무거운 값 중 가장 가벼운 것 — 위로만 맞추면 스택 17.5 + 5 = 22.5가 25가 되고
   * (말은 +5kg, 실제 +43%), 아래로 맞춰도 지난 무게를 넘으면 그쪽이 맞다.
   */
  if (change === 'increase' && multiplier >= 1 && lastKg !== undefined) {
    const inc = exercise.increment;
    const down = loading ? nearestLoadable(targetKg, loading, 'down')
      : inc > 0 ? Math.floor(targetKg / inc + 1e-9) * inc : targetKg;
    const up = loading ? nearestLoadable(targetKg, loading, 'up')
      : inc > 0 ? Math.ceil(targetKg / inc - 1e-9) * inc : targetKg;
    return Math.round((down > lastKg ? down : up) * 100) / 100;
  }
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
