import { EXERCISES } from './exercises.ts';
import { withParticle } from './korean.ts';
import { availableExercises } from './equipment.ts';
import { MUSCLE_GROUPS, MUSCLE_LABELS_KO } from './muscles.ts';
import { screenExercise } from './pain.ts';
import type { ScheduledSession, Weekday } from './schedule.ts';
import type { Exercise, Joint, MuscleGroup, PainReport, TrainingLevel } from './types.ts';

/**
 * 컨디셔닝 (크로스핏 스타일) 세션.
 *
 * 근비대 볼륨 회계와는 다른 물건이다. AMRAP 12분에서 나온 스쿼트 60회를
 * 유효 세트로 세면 볼륨 처방이 전부 망가진다. 그래서 유효 세트로는 세지 않고
 * 피로에만 더한다.
 *
 * 안전 규칙 하나가 특히 중요하다 — 시간에 쫓기는 상태에서는 기술 요구가 높거나
 * 척추에 최대 부하가 실리는 동작을 넣지 않는다. 피로한 상태의 데드리프트는
 * 컨디셔닝이 아니라 부상 대기다.
 */
export type ConditioningFormat = 'amrap' | 'emom' | 'forTime' | 'intervals' | 'circuit';

export const FORMAT_LABELS_KO: Record<ConditioningFormat, string> = {
  amrap: 'AMRAP',
  emom: 'EMOM',
  forTime: 'For Time',
  intervals: '인터벌',
  circuit: '서킷',
};

export const FORMAT_DESCRIPTIONS_KO: Record<ConditioningFormat, string> = {
  amrap: '정해진 시간 안에 가능한 많은 라운드를 돕니다',
  emom: '매 분 시작 시 정해진 동작을 수행하고 남는 시간에 쉽니다',
  forTime: '정해진 분량을 가능한 빨리 끝냅니다',
  intervals: '작업과 휴식을 정해진 비율로 반복합니다',
  circuit: '여러 동작을 쉬지 않고 이어 한 라운드를 만듭니다',
};

/** 버티는 동작은 반복이 아니라 시간으로, 캐리는 걸음으로 센다. */
export type MovementUnit = 'reps' | 'seconds' | 'steps';

export interface ConditioningMovement {
  exerciseId: string;
  name: string;
  amount: number;
  unit: MovementUnit;
  /** 화면에 그대로 쓸 수 있는 표기 */
  display: string;
  weightKg?: number;
  note?: string;
}

export interface ConditioningWorkout {
  format: ConditioningFormat;
  label: string;
  description: string;
  durationMinutes: number;
  rounds?: number;
  movements: ConditioningMovement[];
  /** 무엇으로 기록을 남기는가 */
  scoring: string;
  /** 주로 쓰이는 부위 — 간섭 판정에 쓴다 */
  targetMuscles: MuscleGroup[];
  /** 근력 세션 볼륨과 합산하지 않고 피로에만 더할 값 */
  fatigueLoad: number;
  notes: string[];
}

/** 시간에 쫓기면서 하면 안 되는 동작. 기술 요구가 높거나 척추 부하가 크다. */
const UNSAFE_FOR_TIME = new Set([
  'conventional-deadlift', 'sumo-deadlift', 'stiff-leg-deadlift', 'good-morning',
  'barbell-overhead-press', 'back-squat', 'front-squat', 'pendlay-row', 'barbell-row',
  'skull-crusher', 'incline-barbell-press', 'decline-barbell-press', 'barbell-bench-press',
]);

/** 반복이 아니라 버티는 시간으로 세는 동작. */
const ISOMETRIC = new Set(['plank', 'side-plank']);

/** 컨디셔닝에 잘 맞는 동작 — 배우기 쉽고 반복해도 자세가 덜 무너진다. */
const PREFERRED = [
  'goblet-squat', 'walking-lunge', 'step-up', 'bulgarian-split-squat',
  'push-up', 'dumbbell-bench-press', 'seated-dumbbell-press', 'landmine-press',
  'one-arm-dumbbell-row', 'lat-pulldown', 'seated-cable-row', 'face-pull',
  'hip-thrust', 'cable-pull-through', 'machine-hip-thrust', 'back-extension',
  'farmers-walk', 'plank', 'side-plank', 'hanging-leg-raise', 'ab-wheel-rollout',
  'dead-bug', 'cable-crunch', 'standing-calf-raise', 'leg-press',
];

export interface ConditioningInput {
  format: ConditioningFormat;
  minutes: number;
  level: TrainingLevel;
  /** 이 헬스장에서 가능한 종목만 쓴다 */
  equipmentIds?: readonly string[];
  pain?: readonly PainReport[];
  /** 오늘·내일 근력 세션이 쓰는 부위 — 여기는 피한다 */
  avoidMuscles?: readonly MuscleGroup[];
  bodyweightKg?: number;
  pool?: readonly Exercise[];
}

/** 동작 수 — 시간이 길수록 늘리되 다섯을 넘기지 않는다. 외우지 못하면 못 한다. */
function movementCount(minutes: number): number {
  if (minutes <= 8) return 3;
  if (minutes <= 15) return 4;
  return 5;
}

export function buildConditioning(input: ConditioningInput): ConditioningWorkout {
  const pool = input.pool ?? EXERCISES;
  const available = input.equipmentIds
    ? availableExercises(input.equipmentIds, pool)
    : [...pool];
  const pain = input.pain ?? [];
  const avoid = new Set(input.avoidMuscles ?? []);

  const safe = available
    .filter((exercise) => !UNSAFE_FOR_TIME.has(exercise.id))
    .filter((exercise) => screenExercise(exercise, pain).action === 'allow')
    .filter((exercise) => {
      // 초보에게는 기술 요구가 높은 동작을 빼고 관절 부하도 낮게 잡는다.
      const maxStress = Math.max(0, ...Object.values(exercise.jointStress));
      return input.level === 'beginner' ? maxStress <= 0.5 : maxStress <= 0.65;
    })
    .map((exercise) => ({
      exercise,
      score: PREFERRED.indexOf(exercise.id) >= 0 ? 10 - PREFERRED.indexOf(exercise.id) * 0.2 : 0,
    }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);

  const wanted = movementCount(input.minutes);

  // 근력 세션과 겹치는 부위는 먼저 빼고, 남는 동작이 모자랄 때만 되돌린다.
  const withoutAvoided = safe.filter((entry) => {
    const primary = primaryOf(entry.exercise);
    return !primary || !avoid.has(primary);
  });
  const candidates = withoutAvoided.length >= wanted ? withoutAvoided : safe;

  // 부위가 겹치지 않게 고른다. 같은 부위 두 종목이면 라운드가 안 돈다.
  const picked: Exercise[] = [];
  const usedMuscles = new Set<MuscleGroup>();
  const usedRegions = new Map<string, number>();

  for (const entry of candidates) {
    if (picked.length >= wanted) break;
    const primary = primaryOf(entry.exercise);
    if (primary && usedMuscles.has(primary)) continue;

    const region = regionOf(entry.exercise);
    if ((usedRegions.get(region) ?? 0) >= Math.ceil(wanted / 2)) continue;

    picked.push(entry.exercise);
    if (primary) usedMuscles.add(primary);
    usedRegions.set(region, (usedRegions.get(region) ?? 0) + 1);
  }

  const movements = picked.map((exercise) => toMovement(exercise, input));
  const targetMuscles = MUSCLE_GROUPS.filter((muscle) =>
    picked.some((exercise) => (exercise.contribution[muscle] ?? 0) >= 0.5),
  );

  return {
    format: input.format,
    label: FORMAT_LABELS_KO[input.format],
    description: FORMAT_DESCRIPTIONS_KO[input.format],
    durationMinutes: input.minutes,
    rounds: input.format === 'emom' ? input.minutes : undefined,
    movements,
    scoring: scoringFor(input.format, input.minutes),
    targetMuscles,
    // 유효 세트로는 세지 않는다. 다만 피로는 분당 대략 0.4세트꼴로 쌓인다.
    fatigueLoad: Math.round(input.minutes * 0.4 * 10) / 10,
    notes: buildNotes(input, movements),
  };
}

function toMovement(exercise: Exercise, input: ConditioningInput): ConditioningMovement {
  const isBodyweight = exercise.equipment === 'bodyweight';
  const base = input.level === 'beginner' ? 8 : input.level === 'intermediate' ? 10 : 12;

  if (ISOMETRIC.has(exercise.id)) {
    const seconds = base * 3;
    return {
      exerciseId: exercise.id, name: exercise.name,
      amount: seconds, unit: 'seconds', display: `${seconds}초`,
    };
  }
  if (exercise.pattern === 'carry') {
    const steps = base * 4;
    return {
      exerciseId: exercise.id, name: exercise.name,
      amount: steps, unit: 'steps', display: `${steps}걸음`,
    };
  }

  const reps = exercise.pattern === 'core' ? base * 1.5 : isBodyweight ? base + 2 : base;
  const rounded = Math.round(reps);
  return {
    exerciseId: exercise.id, name: exercise.name,
    amount: rounded, unit: 'reps', display: `${rounded}회`,
    note: exercise.unilateral ? '한쪽씩' : undefined,
  };
}

function scoringFor(format: ConditioningFormat, minutes: number): string {
  switch (format) {
    case 'amrap': return `${minutes}분 동안 완료한 라운드 수와 추가 반복`;
    case 'emom': return `${minutes}분 동안 매 분 완수 여부`;
    case 'forTime': return '전체 완료까지 걸린 시간';
    case 'intervals': return '라운드별 반복 수 (떨어지는 폭을 봅니다)';
    case 'circuit': return '완료한 라운드 수';
  }
}

function buildNotes(input: ConditioningInput, movements: readonly ConditioningMovement[]): string[] {
  const notes: string[] = [
    '이 세션은 근비대 유효 세트로 세지 않습니다. 볼륨 게이지가 아니라 피로에만 반영됩니다.',
  ];

  // 동작이 셋 미만이면 라운드가 성립하지 않는다. 억지로 굴리지 말고 이유를 알린다.
  if (movements.length < 3) {
    notes.push(
      movements.length === 0
        ? '조건에 맞는 동작을 찾지 못했습니다. 기구를 더 등록하거나 통증 설정을 확인하세요.'
        : `쓸 수 있는 동작이 ${movements.length}개뿐이라 라운드가 단조로워집니다. 기구를 더 등록하면 구성이 다양해집니다.`,
    );
    return notes;
  }
  if (input.level === 'beginner') {
    notes.push('처음에는 시간을 줄이고 자세를 지키세요. 라운드 수보다 자세가 먼저입니다.');
  }
  if (input.format === 'forTime') {
    notes.push('시간에 쫓겨 자세가 무너지면 중단하고 반복 수를 줄이세요.');
  }
  if ((input.avoidMuscles ?? []).length > 0) {
    const labels = (input.avoidMuscles ?? []).map((muscle) => MUSCLE_LABELS_KO[muscle]).join(', ');
    notes.push(`${withParticle(labels, '은/는')} 근력 세션과 겹치지 않도록 피했습니다.`);
  }
  return notes;
}

/* ── 간섭 관리 ─────────────────────────────────────────── */

export interface InterferenceWarning {
  weekday: Weekday;
  severity: 'info' | 'warning';
  message: string;
}

export interface InterferenceInput {
  /** 근력 세션 일정 */
  strengthSessions: readonly ScheduledSession[];
  /** 컨디셔닝을 넣으려는 요일과 주 사용 부위 */
  conditioningDays: readonly { weekday: Weekday; targetMuscles: readonly MuscleGroup[] }[];
  /** 세션별 주 사용 부위 */
  sessionMuscles: (session: ScheduledSession) => readonly MuscleGroup[];
}

/**
 * 근력 세션과 컨디셔닝의 간섭을 본다.
 *
 * 하체 컨디셔닝 다음 날 하체 근력 세션을 하면 양쪽 다 손해다.
 * 같은 날이면 근력을 먼저 하는 것이 순서다.
 */
export function checkInterference(input: InterferenceInput): InterferenceWarning[] {
  const warnings: InterferenceWarning[] = [];

  for (const conditioning of input.conditioningDays) {
    for (const session of input.strengthSessions) {
      const gap = dayGap(conditioning.weekday, session.weekday);
      if (gap > 1) continue;

      const shared = input.sessionMuscles(session).filter((muscle) =>
        conditioning.targetMuscles.includes(muscle),
      );
      if (shared.length < 2) continue;

      const labels = shared.slice(0, 3).map((muscle) => MUSCLE_LABELS_KO[muscle]).join(', ');
      warnings.push({
        weekday: conditioning.weekday,
        severity: gap === 0 ? 'info' : 'warning',
        message: gap === 0
          ? `${session.label}요일 ${withParticle(session.templateName, '과/와')} 같은 날입니다 (${labels}). 근력 세션을 먼저 하세요.`
          : `${session.label}요일 ${withParticle(session.templateName, '과/와')} 붙어 있습니다 (${labels}). 하루 띄우거나 겹치지 않는 부위로 바꾸세요.`,
      });
    }
  }

  const total = input.conditioningDays.length + input.strengthSessions.length;
  if (total >= 7) {
    warnings.push({
      weekday: 0,
      severity: 'warning',
      message: `주 ${total}회 훈련입니다. 컨디셔닝을 줄이거나 근력 세션을 하루 빼는 편이 회복에 낫습니다.`,
    });
  }

  return warnings;
}

function dayGap(a: Weekday, b: Weekday): number {
  const direct = Math.abs(a - b);
  return Math.min(direct, 7 - direct);
}

function primaryOf(exercise: Exercise): MuscleGroup | undefined {
  let best: MuscleGroup | undefined;
  let bestValue = 0;
  for (const muscle of MUSCLE_GROUPS) {
    const value = exercise.contribution[muscle] ?? 0;
    if (value > bestValue) { best = muscle; bestValue = value; }
  }
  return best;
}

const UPPER = new Set<MuscleGroup>(['chest', 'back', 'frontDelt', 'sideDelt', 'rearDelt', 'traps', 'biceps', 'triceps', 'forearms']);
const LOWER = new Set<MuscleGroup>(['quads', 'hamstrings', 'glutes', 'calves']);

function regionOf(exercise: Exercise): string {
  const primary = primaryOf(exercise);
  if (!primary) return 'other';
  if (UPPER.has(primary)) return 'upper';
  if (LOWER.has(primary)) return 'lower';
  return 'core';
}
