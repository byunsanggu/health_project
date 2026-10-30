import { withParticle } from './korean.ts';
import { restFor } from './rest.ts';
import type { RestBand } from './rest.ts';
import { planWarmup, warmedMusclesOf } from './warmup.ts';
import type { PlannedExercise, PlannedSession } from './session.ts';
import type { LoadingSpec } from './gym.ts';
import type { Exercise, MuscleGroup } from './types.ts';

/**
 * 시간 예산에 맞춰 세션을 줄인다.
 *
 * "오늘 45분밖에 없다"가 현실에서 가장 흔한 제약인데, 대부분의 앱은 그걸
 * 받아주지 않는다. 그래서 사용자가 알아서 뒤쪽 종목을 건너뛰고, 그러면
 * 주간 볼륨 계산이 틀어진다.
 *
 * 자르는 순서가 중요하다. 고립 운동부터 줄이고, 메인 복합 동작은 마지막까지
 * 지킨다 — 주간 처방의 뼈대가 거기 있기 때문이다.
 */
export type ExerciseRole = 'primary' | 'accessory' | 'isolation';

export interface TimeOptions {
  /** 반복 하나에 걸리는 시간 (템포) */
  secondsPerRep?: number;
  /** 세트 준비에 드는 시간 */
  setupSeconds?: number;
  /** 종목을 옮기는 데 드는 시간 */
  transitionSeconds?: number;
  /** 블록 유형의 휴식 배율 */
  restMultiplier?: number;
  /*
   * 사용자가 정한 휴식 띠. 시간 계산에도 같이 넣어야 한다 — 휴식을 2분으로
   * 늘렸는데 "50분이면 6종목" 이라고 하면 그 계산은 거짓말이 된다.
   */
  restBand?: RestBand;
  /** 종목별로 직접 정한 휴식(초). 키는 종목 id. */
  restOverrides?: Readonly<Record<string, number>>;
  /** 워밍업 시간을 포함할지 */
  includeWarmup?: boolean;
  /** 종목별 기구 명세 — 워밍업 중량 계산에 쓴다 */
  loadingFor?: (exercise: Exercise) => LoadingSpec | null;
  /** 시작에 하는 몸 풀기(초). 주면 종목 워밍업은 필요한 종목만 짧게 계산한다. */
  generalWarmupSeconds?: number;
}

const DEFAULTS = {
  secondsPerRep: 3,
  setupSeconds: 20,
  transitionSeconds: 75,
  restMultiplier: 1,
  includeWarmup: true,
};

export interface ExerciseTimeEstimate {
  exerciseId: string;
  name: string;
  role: ExerciseRole;
  sets: number;
  warmupSeconds: number;
  workSeconds: number;
  restSeconds: number;
  totalSeconds: number;
}

export interface SessionTimeEstimate {
  totalSeconds: number;
  totalMinutes: number;
  exercises: ExerciseTimeEstimate[];
  breakdown: { warmup: number; work: number; rest: number; transition: number };
}

/** 종목의 역할 — 자를 순서를 정하는 기준이다. */
/** 하체 · 밀기 · 당기기 — 복합 동작의 큰 갈래. */
function familyOf(pattern: PlannedExercise['exercise']['pattern']): string {
  if (pattern === 'squat' || pattern === 'lunge' || pattern === 'hinge') return 'lower';
  if (pattern === 'horizontalPush' || pattern === 'verticalPush') return 'push';
  if (pattern === 'horizontalPull' || pattern === 'verticalPull') return 'pull';
  return pattern;
}

/**
 * 메인 · 보조 · 고립.
 *
 * 메인은 갈래(하체 · 밀기 · 당기기)마다 첫 복합 동작이다. 전에는 "앞의 복합 동작
 * 둘"이었는데, 전신 날(스쿼트 · 벤치 · 로우)에 시간을 줄이면 셋째인 당기기가
 * 통째로 빠지고 밀기만 남았다. 한 갈래뿐인 날(하체 날의 스쿼트 · 루마니안,
 * 밀기 날의 벤치 · 오버헤드)은 전처럼 앞의 둘까지 메인이다.
 */
export function classifyRoles(exercises: readonly PlannedExercise[]): ExerciseRole[] {
  const seen = new Set<string>();
  let primaries = 0;
  return exercises.map((item) => {
    const isIsolation = item.exercise.pattern === 'isolation' || item.exercise.pattern === 'core';
    if (isIsolation) return 'isolation';
    const family = familyOf(item.exercise.pattern);
    if (!seen.has(family) || primaries < 2) {
      seen.add(family);
      primaries += 1;
      return 'primary';
    }
    return 'accessory';
  });
}

export function estimateSessionTime(
  session: PlannedSession,
  options: TimeOptions = {},
): SessionTimeEstimate {
  const config = { ...DEFAULTS, ...options };
  const roles = classifyRoles(session.exercises);
  const warmed: MuscleGroup[] = [];

  let warmupTotal = 0;
  let workTotal = 0;
  let restTotal = 0;

  const exercises = session.exercises.map((item, i) => {
    const sets = item.sets.length;
    const reps = item.sets[0]?.targetReps.max ?? 10;

    const rest = Math.round(
      restFor({
        exercise: item.exercise,
        reps,
        targetRir: session.targetRir,
        band: config.restBand,
        overrideSeconds: config.restOverrides?.[item.exercise.id],
      }).seconds * config.restMultiplier,
    );

    const work = sets * (reps * config.secondsPerRep + config.setupSeconds);
    // 마지막 세트 뒤에는 종목 간 전환 시간이 대신 들어간다.
    const restSeconds = Math.max(0, sets - 1) * rest;

    let warmupSeconds = 0;
    if (config.includeWarmup) {
      const weight = item.sets[0]?.weightKg ?? 0;
      const plan = planWarmup({
        exercise: item.exercise,
        workingWeightKg: weight ?? 0,
        workingReps: reps,
        alreadyWarmedMuscles: [...warmed],
        loading: options.loadingFor ? options.loadingFor(item.exercise) : item.loading ?? null,
        generalWarmupDone: (config.generalWarmupSeconds ?? 0) > 0,
      });
      warmupSeconds = Math.round(plan.estimatedSeconds);
    }
    for (const muscle of warmedMusclesOf(item.exercise)) {
      if (!warmed.includes(muscle)) warmed.push(muscle);
    }

    warmupTotal += warmupSeconds;
    workTotal += work;
    restTotal += restSeconds;

    return {
      exerciseId: item.exercise.id,
      name: item.exercise.name,
      role: roles[i]!,
      sets,
      warmupSeconds,
      workSeconds: Math.round(work),
      restSeconds,
      totalSeconds: Math.round(warmupSeconds + work + restSeconds),
    };
  });

  if (config.includeWarmup) warmupTotal += Math.max(0, config.generalWarmupSeconds ?? 0);
  const transition = Math.max(0, exercises.length - 1) * config.transitionSeconds;
  const totalSeconds = Math.round(warmupTotal + workTotal + restTotal + transition);

  return {
    totalSeconds,
    totalMinutes: Math.round(totalSeconds / 60),
    exercises,
    breakdown: {
      warmup: Math.round(warmupTotal),
      work: Math.round(workTotal),
      rest: Math.round(restTotal),
      transition,
    },
  };
}

export type TimeAction = 'trimSets' | 'drop' | 'shortenRest' | 'addSets';

export interface TimeAdjustment {
  exerciseId: string;
  name: string;
  action: TimeAction;
  from: number;
  to: number;
  reason: string;
}

export interface TimeFitResult {
  budgetSeconds: number;
  beforeSeconds: number;
  afterSeconds: number;
  fits: boolean;
  /** 조정된 세션 — 세트 수가 줄거나 종목이 빠진다 */
  session: PlannedSession;
  adjustments: TimeAdjustment[];
  notes: string[];
}

export interface TimeFitOptions extends TimeOptions {
  /** 메인 복합 동작에 남길 최소 세트 */
  minPrimarySets?: number;
  /** 보조·고립에 남길 최소 세트 */
  minOtherSets?: number;
  /** 휴식을 줄여서라도 맞출지 (고밀도 블록에서만 권한다) */
  allowShortRest?: boolean;
}

/**
 * 예산에 맞을 때까지 순서대로 줄인다.
 *
 *   1. 고립 운동 세트  →  2. 고립 운동 제거  →  3. 보조 운동 세트
 *   4. 보조 운동 제거  →  5. 메인 세트 (최소 보장)
 *
 * 메인 복합 동작은 통째로 빼지 않는다. 그게 빠지면 오늘 세션을 한 의미가 없다.
 */
export function fitToTimeBudget(
  session: PlannedSession,
  budgetMinutes: number,
  options: TimeFitOptions = {},
): TimeFitResult {
  const budgetSeconds = Math.round(budgetMinutes * 60);
  const minPrimary = options.minPrimarySets ?? 2;
  const minOther = options.minOtherSets ?? 2;

  const before = estimateSessionTime(session, options);
  let working: PlannedSession = { ...session, exercises: session.exercises.map((item) => ({ ...item })) };
  const adjustments: TimeAdjustment[] = [];
  const notes: string[] = [];

  const estimate = () => estimateSessionTime(working, options);
  let current = before.totalSeconds;

  const trim = (targetRole: ExerciseRole, floor: number) => {
    let progressed = true;
    while (current > budgetSeconds && progressed) {
      progressed = false;
      const roles = classifyRoles(working.exercises);

      // 뒤쪽 종목부터 줄인다 — 앞쪽이 그날의 우선순위다.
      for (let i = working.exercises.length - 1; i >= 0; i -= 1) {
        if (roles[i] !== targetRole) continue;
        const item = working.exercises[i]!;
        if (item.sets.length <= floor) continue;

        const from = item.sets.length;
        working.exercises[i] = { ...item, sets: item.sets.slice(0, from - 1) };
        adjustments.push({
          exerciseId: item.exercise.id,
          name: item.exercise.name,
          action: 'trimSets',
          from,
          to: from - 1,
          reason: `${roleLabel(targetRole)} 세트를 줄였습니다`,
        });
        current = estimate().totalSeconds;
        progressed = true;
        if (current <= budgetSeconds) return;
      }
    }
  };

  const drop = (targetRole: ExerciseRole) => {
    while (current > budgetSeconds) {
      const roles = classifyRoles(working.exercises);
      let index = -1;
      for (let i = working.exercises.length - 1; i >= 0; i -= 1) {
        if (roles[i] === targetRole) { index = i; break; }
      }
      if (index < 0) return;

      const item = working.exercises[index]!;
      working = { ...working, exercises: working.exercises.filter((_, i) => i !== index) };
      adjustments.push({
        exerciseId: item.exercise.id,
        name: item.exercise.name,
        action: 'drop',
        from: item.sets.length,
        to: 0,
        reason: `시간이 모자라 ${withParticle(roleLabel(targetRole), '을/를')} 뺐습니다`,
      });
      current = estimate().totalSeconds;
    }
  };

  if (options.allowShortRest && current > budgetSeconds) {
    // 고밀도 블록에서는 휴식을 줄이는 게 종목을 빼는 것보다 낫다.
    const shortened = { ...options, restMultiplier: (options.restMultiplier ?? 1) * 0.75 };
    const shorter = estimateSessionTime(working, shortened).totalSeconds;
    if (shorter <= budgetSeconds) {
      notes.push('휴식을 25% 줄여 예산에 맞췄습니다. 강도가 떨어질 수 있으니 중량을 유지하도록 신경 쓰세요.');
      return {
        budgetSeconds,
        beforeSeconds: before.totalSeconds,
        afterSeconds: shorter,
        fits: true,
        session: working,
        adjustments: [{
          exerciseId: '', name: '전체', action: 'shortenRest',
          from: Math.round((options.restMultiplier ?? 1) * 100),
          to: Math.round((options.restMultiplier ?? 1) * 75),
          reason: '휴식 단축',
        }],
        notes,
      };
    }
  }

  trim('isolation', minOther);
  drop('isolation');
  trim('accessory', minOther);
  drop('accessory');
  trim('primary', minPrimary);

  const after = estimate();
  const fits = after.totalSeconds <= budgetSeconds;

  /*
   * 세트를 줄였다가 결국 뺀 종목은 "뺐다"만 남기고, 한 종목을 여러 번 줄였으면
   * 한 줄로 합친다. 그러지 않으면 남은 종목은 하나도 안 줄었는데 "세트 축소 2건"이 뜬다.
   */
  const droppedIds = new Set(adjustments.filter((item) => item.action === 'drop').map((item) => item.exerciseId));
  const merged: TimeAdjustment[] = [];
  for (const item of adjustments) {
    if (item.action === 'trimSets') {
      if (droppedIds.has(item.exerciseId)) continue;
      const prev = merged.find((one) => one.action === 'trimSets' && one.exerciseId === item.exerciseId);
      if (prev) { prev.to = item.to; continue; }
    }
    merged.push({ ...item });
  }
  adjustments.length = 0;
  adjustments.push(...merged);

  if (!fits) {
    notes.push(
      `메인 복합 동작을 ${minPrimary}세트까지 줄여도 ${Math.round(after.totalSeconds / 60)}분이 필요합니다. ` +
        '메인은 빼지 않습니다 — 여기가 빠지면 오늘 세션을 한 의미가 없습니다.',
    );
  } else if (adjustments.length === 0) {
    notes.push('예산 안에 들어옵니다. 계획대로 수행하세요.');
  } else {
    const dropped = adjustments.filter((item) => item.action === 'drop').length;
    notes.push(
      `${Math.round(before.totalSeconds / 60)}분 → ${after.totalMinutes}분으로 맞췄습니다` +
        (dropped > 0 ? ` (종목 ${dropped}개 제외)` : '') + '.',
    );
    notes.push('빠진 볼륨은 주간 처방이 다음 세션에서 메웁니다.');
  }

  return {
    budgetSeconds,
    beforeSeconds: before.totalSeconds,
    afterSeconds: after.totalSeconds,
    fits,
    session: working,
    adjustments,
    notes,
  };
}

function roleLabel(role: ExerciseRole): string {
  return role === 'primary' ? '메인 복합 동작' : role === 'accessory' ? '보조 운동' : '고립 운동';
}

export interface TimeExtendOptions extends TimeOptions {
  /**
   * 부위마다 이번 주에 더 넣어도 되는 유효 세트 — 회복 한계(MRV)에서 이번 주 계획을 뺀 값.
   * 세트를 붙이면 그 종목의 기여도만큼 깎는다. 0 밑으로 가는 세트는 붙이지 않는다.
   */
  headroom: Partial<Record<MuscleGroup, number>>;
  /** 한 종목에 더 붙일 수 있는 세트 (기본 2) */
  maxExtraPerExercise?: number;
  /** 한 부위가 이 세션 하루에 받을 세트 상한 (기본 9 — 볼륨 셈의 하루 상한과 같다. 넘는 세트는 반만 센다) */
  sessionCap?: number;
}

/** 붙인 세트가 깎는 부위 — 보조 정도(0.25) 밑은 세지 않는다. 볼륨 셈과 같은 문턱. */
const EXTEND_MIN_CONTRIBUTION = 0.25;

/**
 * 시간이 평소보다 넉넉한 날 — 남는 시간에 세트를 붙인다.
 *
 * "오늘 90분 있어요"를 골랐는데 47분짜리를 그대로 주면 고른 뜻이 없다. 그렇다고 종목을
 * 마구 늘리면 이번 주 회복 한계를 넘는다. 그래서:
 *
 *   - 메인 복합 동작부터 한 세트씩, 다음 보조, 다음 고립 — 한 바퀴에 종목마다 하나씩.
 *   - 종목마다 최대 +2세트.
 *   - 그 세트가 이번 주 회복 한계를 넘기는 부위가 있으면 붙이지 않는다(headroom).
 *   - 한 부위가 하루에 9세트를 넘게 되면 붙이지 않는다 — 그 위는 반만 쳐 주는 세트다.
 *   - 예산을 넘기면 멈춘다.
 *
 * 무거운 세트(top)는 늘리지 않는다 — 붙이는 세트는 그 종목의 마지막 작업 세트와 같다.
 */
export function extendToTimeBudget(
  session: PlannedSession,
  budgetMinutes: number,
  options: TimeExtendOptions,
): TimeFitResult {
  const budgetSeconds = Math.round(budgetMinutes * 60);
  const maxExtra = options.maxExtraPerExercise ?? 2;
  const before = estimateSessionTime(session, options);
  let working: PlannedSession = { ...session, exercises: session.exercises.map((item) => ({ ...item, sets: item.sets.slice() })) };
  const room: Partial<Record<MuscleGroup, number>> = { ...options.headroom };
  const cap = options.sessionCap ?? 9;
  const today: Partial<Record<MuscleGroup, number>> = {};
  const count = (item: PlannedExercise, sets: number) => {
    for (const [muscle, value] of Object.entries(item.exercise.contribution)) {
      if ((value ?? 0) >= EXTEND_MIN_CONTRIBUTION) today[muscle as MuscleGroup] = (today[muscle as MuscleGroup] ?? 0) + (value ?? 0) * sets;
    }
  };
  for (const item of session.exercises) count(item, item.sets.filter((set) => !set.top).length);
  const added = new Map<string, number>();
  let current = before.totalSeconds;
  let blockedByVolume = false;

  const roles = classifyRoles(working.exercises);
  const order = (['primary', 'accessory', 'isolation'] as const)
    .flatMap((role) => working.exercises.map((_, i) => i).filter((i) => roles[i] === role));

  const fitsVolume = (item: PlannedExercise) => Object.entries(item.exercise.contribution)
    .every(([muscle, value]) => (value ?? 0) < EXTEND_MIN_CONTRIBUTION ||
      ((room[muscle as MuscleGroup] ?? 0) >= (value ?? 0) && (today[muscle as MuscleGroup] ?? 0) + (value ?? 0) <= cap));

  for (let round = 0; round < maxExtra; round += 1) {
    let progressed = false;
    for (const i of order) {
      const item = working.exercises[i]!;
      const work = item.sets.filter((set) => !set.top);
      const last = work[work.length - 1];
      if (!last || (added.get(item.exercise.id) ?? 0) > round) continue;
      if (!fitsVolume(item)) { blockedByVolume = true; continue; }
      const extra = { ...last, setNumber: item.sets.length + 1 };
      const next = { ...working, exercises: working.exercises.map((one, j) => (j === i ? { ...one, sets: one.sets.concat([extra]) } : one)) };
      const seconds = estimateSessionTime(next, options).totalSeconds;
      if (seconds > budgetSeconds) continue;
      working = next;
      current = seconds;
      added.set(item.exercise.id, (added.get(item.exercise.id) ?? 0) + 1);
      for (const [muscle, value] of Object.entries(item.exercise.contribution)) {
        if ((value ?? 0) >= EXTEND_MIN_CONTRIBUTION) room[muscle as MuscleGroup] = (room[muscle as MuscleGroup] ?? 0) - (value ?? 0);
      }
      count(item, 1);
      progressed = true;
    }
    if (!progressed) break;
  }

  const adjustments: TimeAdjustment[] = [];
  for (const item of working.exercises) {
    const count = added.get(item.exercise.id);
    if (!count) continue;
    adjustments.push({
      exerciseId: item.exercise.id, name: item.exercise.name, action: 'addSets',
      from: item.sets.length - count, to: item.sets.length, reason: '시간이 넉넉해 세트를 더했습니다',
    });
  }
  const notes: string[] = [];
  if (adjustments.length > 0) {
    notes.push(`${Math.round(before.totalSeconds / 60)}분 → ${Math.round(current / 60)}분 — 큰 복합 운동부터 ${adjustments.reduce((sum, item) => sum + item.to - item.from, 0)}세트를 더했습니다.`);
    if (blockedByVolume) notes.push('하루 · 이번 주 한계에 닿는 부위는 더하지 않았습니다. 남는 시간은 넉넉히 쉬세요.');
  } else if (blockedByVolume) {
    notes.push('오늘 · 이번 주 운동량이 이미 한계에 가까워 더하지 않았습니다. 남는 시간은 넉넉히 쉬세요.');
  } else {
    notes.push('예산 안에 들어옵니다. 계획대로 수행하세요.');
  }
  return {
    budgetSeconds, beforeSeconds: before.totalSeconds, afterSeconds: current, fits: true,
    session: working, adjustments, notes,
  };
}
