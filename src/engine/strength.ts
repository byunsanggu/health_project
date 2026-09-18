import { estimate1RM } from './load.ts';
import { nearestLoadable, type LoadingSpec } from './gym.ts';
import { LEVEL_LABELS_KO } from './levels.ts';
import type { Exercise, SessionLog, TrainingLevel } from './types.ts';

export interface LifterProfile {
  bodyweightKg: number;
  level: TrainingLevel;
  sex?: 'male' | 'female' | 'unspecified';
}

/** 환산의 기준이 되는 다섯 종목. 나머지는 전부 여기에 묶인다. */
export type Anchor = 'bench' | 'squat' | 'deadlift' | 'overheadPress' | 'row';

export interface AnchorFactor {
  anchor: Anchor;
  /** 이 종목의 추정 1RM ÷ 앵커 1RM */
  factor: number;
  /** 한쪽 무게로 기록하는 종목(덤벨·편측 케이블) */
  perHand?: boolean;
}

/**
 * 종목 간 환산 계수.
 *
 * 개인차와 기구 편차가 커서 정밀한 값이 아니다 — 첫 중량을 "완전히 모름"에서
 * "대충 이 근처"로 옮기는 용도이고, 탐색 세트 한 번이면 바로 실측으로 대체된다.
 * 그래서 어느 경로로 나온 값이든 needsCalibration 을 붙여 내보낸다.
 */
export const ANCHOR_FACTORS: Record<string, AnchorFactor> = {
  // 가슴
  'barbell-bench-press': { anchor: 'bench', factor: 1 },
  'dumbbell-bench-press': { anchor: 'bench', factor: 0.36, perHand: true },
  'incline-dumbbell-press': { anchor: 'bench', factor: 0.32, perHand: true },
  'machine-chest-press': { anchor: 'bench', factor: 0.8 },
  'pec-deck': { anchor: 'bench', factor: 0.45 },
  'cable-fly': { anchor: 'bench', factor: 0.22, perHand: true },
  // 어깨
  'barbell-overhead-press': { anchor: 'overheadPress', factor: 1 },
  'seated-dumbbell-press': { anchor: 'overheadPress', factor: 0.4, perHand: true },
  'machine-shoulder-press': { anchor: 'overheadPress', factor: 0.85 },
  'landmine-press': { anchor: 'overheadPress', factor: 0.75 },
  'lateral-raise': { anchor: 'overheadPress', factor: 0.13, perHand: true },
  'cable-lateral-raise': { anchor: 'overheadPress', factor: 0.12, perHand: true },
  // 등
  'barbell-row': { anchor: 'row', factor: 1 },
  'chest-supported-row': { anchor: 'row', factor: 0.9 },
  'seated-cable-row': { anchor: 'row', factor: 0.95 },
  'lat-pulldown': { anchor: 'row', factor: 0.9 },
  'neutral-grip-pulldown': { anchor: 'row', factor: 0.9 },
  'face-pull': { anchor: 'row', factor: 0.25 },
  'reverse-pec-deck': { anchor: 'row', factor: 0.3 },
  // 하체
  'back-squat': { anchor: 'squat', factor: 1 },
  'hack-squat': { anchor: 'squat', factor: 1.1 },
  'leg-press': { anchor: 'squat', factor: 1.9 },
  'goblet-squat': { anchor: 'squat', factor: 0.25 },
  'walking-lunge': { anchor: 'squat', factor: 0.22, perHand: true },
  'leg-extension': { anchor: 'squat', factor: 0.45 },
  'standing-calf-raise': { anchor: 'squat', factor: 0.7 },
  // 힌지
  'conventional-deadlift': { anchor: 'deadlift', factor: 1 },
  'romanian-deadlift': { anchor: 'deadlift', factor: 0.7 },
  'hip-thrust': { anchor: 'deadlift', factor: 0.9 },
  'lying-leg-curl': { anchor: 'deadlift', factor: 0.3 },
  // 팔·코어
  'barbell-curl': { anchor: 'bench', factor: 0.35 },
  'incline-dumbbell-curl': { anchor: 'bench', factor: 0.13, perHand: true },
  'hammer-curl': { anchor: 'bench', factor: 0.16, perHand: true },
  'triceps-pushdown': { anchor: 'bench', factor: 0.42 },
  'overhead-cable-extension': { anchor: 'bench', factor: 0.3 },
  'cable-crunch': { anchor: 'bench', factor: 0.45 },
};

/**
 * 경력·체중 대비 1RM 기준선 (남성 기준, 체중 배수).
 * 널리 통용되는 근력 기준표의 보수적인 쪽 값을 썼다.
 */
const BODYWEIGHT_RATIO: Record<Anchor, Record<TrainingLevel, number>> = {
  bench: { beginner: 0.75, intermediate: 1.0, advanced: 1.35, expert: 1.6 },
  squat: { beginner: 1.0, intermediate: 1.4, advanced: 1.85, expert: 2.25 },
  deadlift: { beginner: 1.25, intermediate: 1.75, advanced: 2.2, expert: 2.75 },
  overheadPress: { beginner: 0.45, intermediate: 0.6, advanced: 0.8, expert: 1.0 },
  row: { beginner: 0.65, intermediate: 0.9, advanced: 1.15, expert: 1.4 },
};

/** 여성은 상체에서 격차가 더 크고 하체는 상대적으로 가깝다. */
const SEX_SCALE: Record<Anchor, number> = {
  bench: 0.6,
  overheadPress: 0.6,
  row: 0.65,
  squat: 0.72,
  deadlift: 0.72,
};

export type StartingMethod = 'related-lift' | 'bodyweight-ratio' | 'unknown';

export interface StartingLoad {
  exerciseId: string;
  /** 첫 세트에 올릴 중량. 추정할 근거가 전혀 없으면 null */
  weightKg: number | null;
  method: StartingMethod;
  confidence: 'medium' | 'low';
  /** 사용자에게 그대로 보여줄 한 줄 */
  rationale: string;
  /** 탐색 세트로 확인해야 하는가 — 추정으로 나온 값은 항상 true */
  needsCalibration: boolean;
}

export interface StartingLoadInput {
  exercise: Exercise;
  repRange: { min: number; max: number };
  targetRir: number;
  profile?: LifterProfile;
  /** 다른 종목 기록에서 앵커를 역산하기 위한 이력 */
  history?: readonly SessionLog[];
  index?: ReadonlyMap<string, Exercise>;
  /** 그 헬스장에서 만들 수 있는 중량으로 맞춘다 */
  loading?: LoadingSpec | null;
}

/** 첫 수행 종목의 중량을 제안한다. */
export function suggestStartingLoad(input: StartingLoadInput): StartingLoad {
  const mapping = ANCHOR_FACTORS[input.exercise.id];
  const base = {
    exerciseId: input.exercise.id,
    needsCalibration: true,
  };

  if (!mapping) {
    return {
      ...base,
      weightKg: null,
      method: 'unknown',
      confidence: 'low',
      rationale: '환산 기준이 없는 종목입니다. 가볍게 시작해 첫 세트에서 맞춰 나가세요.',
    };
  }

  const fromHistory = anchorFromHistory(mapping.anchor, input.history ?? [], input.index);
  const anchor1RM = fromHistory?.value ?? anchorFromProfile(mapping.anchor, input.profile);

  if (anchor1RM === null) {
    return {
      ...base,
      weightKg: null,
      method: 'unknown',
      confidence: 'low',
      rationale: '기준으로 삼을 기록도 체중 정보도 없습니다. 탐색 세트부터 시작하세요.',
    };
  }

  const target1RM = anchor1RM * mapping.factor;
  const working = workingWeightFor(target1RM, input.repRange.max, input.targetRir);

  // 첫 수행은 보수적으로. 가벼우면 세트 중에 올리면 되지만 무거우면 다칠 수 있다.
  const conservative = working * 0.9;
  const weightKg = input.loading
    ? nearestLoadable(conservative, input.loading, 'down')
    : round(conservative, 0.5);

  const rationale = fromHistory
    ? `${fromHistory.label} 기록에서 환산한 값입니다. ${input.repRange.max}회 × RIR ${input.targetRir} 기준으로 보수적으로 잡았습니다.`
    : `체중 ${input.profile?.bodyweightKg}kg · ${levelLabel(input.profile?.level)} 기준선에서 환산했습니다. 첫 세트에서 반드시 확인하세요.`;

  return {
    ...base,
    weightKg,
    method: fromHistory ? 'related-lift' : 'bodyweight-ratio',
    confidence: fromHistory ? 'medium' : 'low',
    rationale,
  };
}

/** 이력에 있는 종목들로 앵커 1RM을 역산한다. 앵커에 가까운 종목일수록 신뢰한다. */
function anchorFromHistory(
  anchor: Anchor,
  history: readonly SessionLog[],
  index?: ReadonlyMap<string, Exercise>,
): { value: number; label: string } | null {
  let best: { value: number; factor: number; exerciseId: string } | null = null;

  for (const session of history) {
    for (const set of session.sets) {
      if (set.warmup || set.reps <= 0) continue;
      const mapping = ANCHOR_FACTORS[set.exerciseId];
      if (!mapping || mapping.anchor !== anchor) continue;

      // 덤벨 종목의 계수는 이미 '한쪽 무게' 기준이라 따로 보정하지 않는다.
      const estimated = estimate1RM(set) / mapping.factor;
      if (!best || mapping.factor > best.factor) {
        best = { value: estimated, factor: mapping.factor, exerciseId: set.exerciseId };
      }
    }
  }

  if (!best) return null;
  return {
    value: best.value,
    label: index?.get(best.exerciseId)?.name ?? best.exerciseId,
  };
}

function anchorFromProfile(anchor: Anchor, profile?: LifterProfile): number | null {
  if (!profile || !profile.bodyweightKg) return null;
  const ratio = BODYWEIGHT_RATIO[anchor][profile.level];
  const scale = profile.sex === 'female' ? SEX_SCALE[anchor] : 1;
  return profile.bodyweightKg * ratio * scale;
}

/** 1RM에서 목표 반복·RIR에 맞는 작업 중량을 역산한다 (Epley 역식). */
export function workingWeightFor(oneRepMax: number, reps: number, rir: number): number {
  const totalReps = reps + Math.max(0, rir);
  return oneRepMax / (1 + totalReps / 30);
}

export interface CalibrationResult {
  weightKg: number;
  estimated1RM: number;
  rationale: string;
}

/**
 * 탐색 세트 한 번으로 작업 중량을 확정한다.
 *
 * 추정표보다 이게 항상 정확하다. 가볍다고 느끼는 무게로 한 세트 하고
 * RIR만 알려주면, 그 사람의 실제 능력에서 역산한 값이 나온다.
 */
export function calibrateFromSet(
  probe: { weightKg: number; reps: number; rir: number },
  target: { repRange: { min: number; max: number }; targetRir: number },
  loading?: LoadingSpec | null,
): CalibrationResult {
  const estimated = estimate1RM(probe);
  const working = workingWeightFor(estimated, target.repRange.max, target.targetRir);
  const weightKg = loading ? nearestLoadable(working, loading, 'down') : round(working, 0.5);

  return {
    weightKg,
    estimated1RM: round(estimated, 0.5),
    rationale: `${probe.weightKg}kg × ${probe.reps}회 (RIR ${probe.rir}) → 추정 1RM ${round(estimated, 0.5)}kg. ` +
      `${target.repRange.max}회 × RIR ${target.targetRir} 작업 중량은 ${weightKg}kg입니다.`,
  };
}

function round(value: number, step: number): number {
  return Math.round(value / step) * step;
}

function levelLabel(level?: TrainingLevel): string {
  return LEVEL_LABELS_KO[level ?? 'beginner'];
}
