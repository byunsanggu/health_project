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

/**
 * 와드에 흔히 쓰이는 바벨 동작.
 *
 * 크로스핏 표준 와드에 실제로 들어가는 것만 골랐다. 여기 없는 바벨 동작은
 * 바벨을 켜도 안 들어간다 — "바벨 허용"이 아무거나 넣어도 된다는 뜻은
 * 아니다.
 */
const WOD_BARBELL = [
  'conventional-deadlift', 'sumo-deadlift', 'front-squat', 'barbell-overhead-press',
];

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
  /**
   * 바벨 동작을 넣을 것인가.
   *
   * 기본은 끔이다. 시간에 쫓기면서 하는 바벨 동작은 자세가 먼저 무너지고,
   * 무너지는 곳이 하필 허리다.
   *
   * 다만 데드리프트를 넣은 와드는 크로스핏에서 표준이다(Diane, DT). 코치가
   * 붙어 있고 무게를 낮게 잡으면 성립한다. 그래서 막지는 않되 켜야만
   * 들어가고, 켜면 무게 상한과 주의가 같이 나간다.
   */
  allowBarbell?: boolean;
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

  /*
   * 바벨을 켜도 초보에게는 열지 않는다. 자세가 무너지는 걸 스스로
   * 알아차리지 못하는 단계에서 시간에 쫓기게 하면 안 된다.
   */
  const barbellOn = Boolean(input.allowBarbell) && input.level !== 'beginner';

  const safe = available
    .filter((exercise) => barbellOn || !UNSAFE_FOR_TIME.has(exercise.id))
    .filter((exercise) => screenExercise(exercise, pain).action === 'allow')
    .filter((exercise) => {
      // 초보에게는 기술 요구가 높은 동작을 빼고 관절 부하도 낮게 잡는다.
      const maxStress = Math.max(0, ...Object.values(exercise.jointStress));
      const ceiling = input.level === 'beginner' ? 0.5 : barbellOn ? 0.95 : 0.65;
      return maxStress <= ceiling;
    })
    .map((exercise) => {
      const preferred = PREFERRED.indexOf(exercise.id);
      if (preferred >= 0) return { exercise, score: 10 - preferred * 0.2 };
      /*
       * 바벨을 켰으면 와드에 흔히 쓰이는 바벨 동작만 후보로 올린다.
       * 점수를 낮게 줘서 맨몸·덤벨 동작이 먼저 차게 한다 — 바벨은
       * 한 와드에 하나면 충분하다.
       */
      if (barbellOn && WOD_BARBELL.indexOf(exercise.id) >= 0) return { exercise, score: 3 };
      return { exercise, score: 0 };
    })
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

  /*
   * 바벨을 켰으면 한 자리를 먼저 잡아 둔다.
   *
   * 점수만 믿으면 안 들어간다 — 맨몸·덤벨 동작이 점수가 높아 자리를 다
   * 채우기 때문이다. "바벨 허용"을 켠 사람은 바벨이 들어간 와드를 원한
   * 것이므로, 한 자리는 확보하고 나머지를 채운다. 한 와드에 바벨은
   * 하나면 충분하다.
   */
  if (barbellOn) {
    const barbellPick = candidates.find((entry) => WOD_BARBELL.indexOf(entry.exercise.id) >= 0);
    if (barbellPick) {
      picked.push(barbellPick.exercise);
      const primary = primaryOf(barbellPick.exercise);
      if (primary) usedMuscles.add(primary);
      usedRegions.set(regionOf(barbellPick.exercise), 1);
    }
  }

  for (const entry of candidates) {
    if (picked.indexOf(entry.exercise) >= 0) continue;
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

/* ── 와드 한 판 ────────────────────────────────────────

   컨디셔닝을 근력 세션 뒤에 붙이는 게 아니라, **그 자체로 오늘 운동**이
   되는 경우다. "단기간에 크로스핏처럼 효율적으로"가 목적이다.

   근력 세션과 다른 점이 하나 있다. 근력 세션의 워밍업은 종목마다 본세트
   중량에 맞춰 올라가는 램프지만, 와드는 **시작하자마자 최대 강도**로
   들어간다. 그래서 들어가기 전에 몸이 다 풀려 있어야 한다 — 와드 중간에
   풀 시간이 없다.
── */

export interface WodWarmup {
  minutes: number;
  /** 순서대로 보여줄 단계 */
  steps: string[];
}

export interface WodSession {
  warmup: WodWarmup;
  workout: ConditioningWorkout;
  /** 몸풀기까지 합친 시간 */
  totalMinutes: number;
  /** 무엇을 조심해야 하는가. 비어 있으면 특별히 없다 */
  cautions: string[];
}

/**
 * 몸풀기 길이.
 *
 * 와드가 짧을수록 몸풀기 비중이 커진다 — 5분짜리 와드에 5분을 푸는 건
 * 과해 보이지만, 5분 전력으로 들어가려면 그만큼 풀려 있어야 한다.
 */
function warmupMinutes(wodMinutes: number): number {
  if (wodMinutes <= 8) return 6;
  if (wodMinutes <= 15) return 8;
  return 10;
}

function buildWarmup(workout: ConditioningWorkout): WodWarmup {
  const minutes = warmupMinutes(workout.durationMinutes);
  const raise = Math.max(2, Math.round(minutes * 0.4));
  const mobility = Math.max(2, Math.round(minutes * 0.25));
  const rehearse = Math.max(2, minutes - raise - mobility);

  /*
   * 일반 → 구체 순서다. 심박을 올리고, 관절을 풀고, **그 날 할 동작을
   * 가볍게 한 바퀴** 돈다. 마지막이 제일 중요하다 — 처음 하는 동작을
   * 시계 켜고 하면 그때부터 자세가 없다.
   */
  const rehearsal = workout.movements
    .map((movement) => `${movement.name} ${Math.max(3, Math.round(movement.amount * 0.3))}${
      movement.unit === 'seconds' ? '초' : movement.unit === 'steps' ? '걸음' : '회'}`)
    .join(' · ');

  return {
    minutes,
    steps: [
      `${raise}분 — 로잉·자전거·줄넘기·빠르게 걷기 중 하나로 심박을 올립니다. 땀이 살짝 날 정도까지.`,
      `${mobility}분 — 어깨·고관절·발목을 돌립니다. 오늘 많이 쓸 관절부터.`,
      `${rehearse}분 — 오늘 할 동작을 맨몸이나 가벼운 무게로 한 바퀴: ${rehearsal}`,
    ],
  };
}

/** 시간에 쫓기면서 하면 위험한 동작이 들어갔는가. */
function riskyMovements(workout: ConditioningWorkout): string[] {
  return workout.movements
    .filter((movement) => UNSAFE_FOR_TIME.has(movement.exerciseId))
    .map((movement) => movement.name);
}

export interface WodSessionInput extends ConditioningInput {
  /** 오늘 근력 세션 없이 이것만 하는가 */
  standalone?: boolean;
}

/**
 * 몸풀기부터 와드까지 한 판.
 *
 * 경고는 실제로 위험한 조합에만 낸다 — 바벨을 켰다고 무조건 경고하면
 * 켠 사람에게 매번 같은 잔소리를 하는 꼴이고, 그러면 안 읽는다.
 */
export function buildWodSession(input: WodSessionInput): WodSession {
  const workout = buildConditioning(input);
  const warmup = buildWarmup(workout);
  const cautions: string[] = [];

  const risky = riskyMovements(workout);
  if (risky.length > 0) {
    cautions.push(
      `${withParticle(risky.join(', '), '은/는')} 시간에 쫓기면 자세가 먼저 무너집니다. ` +
      '평소 작업 중량의 절반 이하로 잡으세요.',
    );

    /*
     * For Time과 AMRAP은 속도 제한이 없다. 허리가 실리는 동작을 넣으면
     * 마지막 라운드에서 자세가 무너진 채로 최대 반복을 하게 된다.
     * EMOM은 매 분 남는 시간이 강제 휴식이라 그 일이 덜 벌어진다.
     */
    if (input.format === 'forTime' || input.format === 'amrap') {
      cautions.push(
        '이 형식은 속도 제한이 없습니다. 허리가 실리는 동작이 들어가면 ' +
        'EMOM처럼 매 분 쉬는 구간이 있는 형식이 더 안전합니다.',
      );
    }
  }

  if (input.standalone) {
    cautions.push(
      '오늘은 이것만 합니다. 와드는 유효 세트로 세지 않으므로 주간 볼륨은 ' +
      '늘지 않고 피로만 쌓입니다 — 근력 세션을 대체하는 게 아니라 다른 것입니다.',
    );
  }

  return {
    warmup,
    workout,
    totalMinutes: warmup.minutes + workout.durationMinutes,
    cautions,
  };
}
