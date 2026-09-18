import { nearestLoadable, type LoadingSpec } from './gym.ts';
import { MUSCLE_GROUPS } from './muscles.ts';
import type { Exercise, MuscleGroup, TrainingLevel } from './types.ts';

/**
 * 워밍업 세트 처방.
 *
 * 워밍업은 본세트 중량에 맞춰 올라가는 램프여야 한다. 빈 바로 10회 하고
 * 바로 100kg으로 가는 건 워밍업이 아니라 도박이고, 반대로 본세트 전에
 * 다섯 세트씩 밟으면 정작 본세트에서 쓸 힘이 남지 않는다.
 *
 * 규칙 하나가 특히 중요하다 — **워밍업은 절대 실패까지 가지 않는다.**
 * 그래서 볼륨 집계에서도 빠진다(warmup 플래그).
 */
export interface WarmupSet {
  weightKg: number;
  reps: number;
  restSeconds: number;
  /** 본세트 중량 대비 비율 */
  percent: number;
  note?: string;
}

export interface WarmupPlan {
  exerciseId: string;
  sets: WarmupSet[];
  /** 워밍업에 걸리는 대략적인 시간 (초) */
  estimatedSeconds: number;
  note: string;
}

export interface WarmupInput {
  exercise: Exercise;
  /** 첫 본세트 중량 */
  workingWeightKg: number;
  /** 첫 본세트 목표 반복 */
  workingReps: number;
  level?: TrainingLevel;
  /** 이 세션에서 앞서 수행한 종목들이 이미 자극한 부위 */
  alreadyWarmedMuscles?: readonly MuscleGroup[];
  /** 그 헬스장에서 만들 수 있는 중량으로 맞춘다 */
  loading?: LoadingSpec | null;
  /** 빈 바 무게 — 바벨 종목의 첫 램프에 쓴다 */
  barKg?: number;
}

/** 램프 단계 — 무거워질수록 반복을 줄인다. */
const FULL_RAMP: readonly { percent: number; reps: number }[] = [
  { percent: 0.4, reps: 8 },
  { percent: 0.6, reps: 5 },
  { percent: 0.75, reps: 3 },
  { percent: 0.88, reps: 2 },
];

const SHORT_RAMP: readonly { percent: number; reps: number }[] = [
  { percent: 0.5, reps: 6 },
  { percent: 0.75, reps: 3 },
];

const MINIMAL_RAMP: readonly { percent: number; reps: number }[] = [
  { percent: 0.6, reps: 8 },
];

export function planWarmup(input: WarmupInput): WarmupPlan {
  const { exercise, workingWeightKg, workingReps } = input;
  const snap = (weight: number) =>
    input.loading ? nearestLoadable(weight, input.loading, 'nearest') : round(weight, 2.5);

  const isIsolation = exercise.pattern === 'isolation' || exercise.pattern === 'core';
  const alreadyWarm = isAlreadyWarm(exercise, input.alreadyWarmedMuscles ?? []);
  const heavy = workingReps <= 6;

  if (workingWeightKg <= 0) {
    return {
      exerciseId: exercise.id,
      sets: [],
      estimatedSeconds: 0,
      note: '맨몸 종목입니다. 가볍게 한 세트로 감각을 잡고 시작하세요.',
    };
  }

  let ramp: readonly { percent: number; reps: number }[];
  let note: string;

  if (alreadyWarm && isIsolation) {
    ramp = [];
    note = '앞 종목에서 이미 데워진 부위입니다. 첫 세트를 조금 여유 있게 시작하세요.';
  } else if (alreadyWarm) {
    ramp = SHORT_RAMP;
    note = '앞 종목에서 부위가 데워졌습니다. 중량 감각만 잡습니다.';
  } else if (isIsolation) {
    ramp = MINIMAL_RAMP;
    note = '고립 운동입니다. 한 세트로 충분합니다.';
  } else if (heavy) {
    ramp = FULL_RAMP;
    note = '고중량 복합 동작입니다. 램프를 다 밟아야 첫 세트가 제대로 나옵니다.';
  } else {
    ramp = FULL_RAMP.slice(1);
    note = '복합 동작입니다. 중간 단계부터 올라갑니다.';
  }

  const sets: WarmupSet[] = [];

  // 바벨 종목은 빈 바부터 시작한다. 램프 첫 단계가 빈 바보다 가벼우면 의미가 없다.
  if (!alreadyWarm && input.barKg && input.barKg > 0 && ramp.length > 0) {
    const firstRampWeight = snap(workingWeightKg * ramp[0]!.percent);
    if (firstRampWeight > input.barKg) {
      sets.push({
        weightKg: input.barKg,
        reps: 10,
        restSeconds: 30,
        percent: round(input.barKg / workingWeightKg, 0.01),
        note: '빈 바',
      });
    }
  }

  for (const step of ramp) {
    const weightKg = snap(workingWeightKg * step.percent);
    // 바로 앞 세트와 같은 중량이 나오면 건너뛴다 — 기구가 굵으면 흔하다.
    if (sets.some((existing) => existing.weightKg === weightKg)) continue;
    if (weightKg >= workingWeightKg) continue;

    sets.push({
      weightKg,
      reps: step.reps,
      restSeconds: step.percent >= 0.8 ? 60 : 40,
      percent: step.percent,
    });
  }

  if (sets.length === 0 && ramp.length > 0) {
    note = '본세트 중량이 낮아 램프가 필요 없습니다. 첫 세트를 여유 있게 시작하세요.';
  }

  return {
    exerciseId: exercise.id,
    sets,
    estimatedSeconds: sets.reduce((sum, set) => sum + set.reps * 2.5 + 20 + set.restSeconds, 0),
    note: `${note} 워밍업은 실패까지 가지 않습니다.`,
  };
}

/** 앞 종목이 이 부위를 이미 자극했는가. */
function isAlreadyWarm(exercise: Exercise, warmed: readonly MuscleGroup[]): boolean {
  if (warmed.length === 0) return false;
  for (const muscle of MUSCLE_GROUPS) {
    if ((exercise.contribution[muscle] ?? 0) >= 0.85 && warmed.includes(muscle)) return true;
  }
  return false;
}

/** 이 종목이 자극한 부위 — 다음 종목의 워밍업 판단에 넘긴다. */
export function warmedMusclesOf(exercise: Exercise): MuscleGroup[] {
  return MUSCLE_GROUPS.filter((muscle) => (exercise.contribution[muscle] ?? 0) >= 0.5);
}

function round(value: number, step: number): number {
  return Math.round(value / step) * step;
}
