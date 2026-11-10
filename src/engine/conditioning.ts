import { EXERCISES, HEAVY_PULLS, exerciseById, isUnloaded } from './exercises.ts';
import { withParticle } from './korean.ts';
import { availableExercises } from './equipment.ts';
import { MUSCLE_GROUPS, MUSCLE_LABELS_KO } from './muscles.ts';
import { screenExercise } from './pain.ts';
import type { ScheduledSession, Weekday } from './schedule.ts';
import type { Exercise, Joint, MuscleGroup, PainReport, TrainingLevel } from './types.ts';
import { CARDIO, cardioZoneOf, rankForToday, type CardioExercise, type CardioZone, type ZoneSpec } from './cardio.ts';
import { planGoals, type TrainingGoal } from './goals.ts';
import type { SessionTemplate } from './session.ts';

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

/** 형식 이름 — 하는 일을 한국어로 먼저, 업계 약어는 괄호에. 크로스핏 약어만 보고는 무엇을 고를지 모른다. */
export const FORMAT_LABELS_KO: Record<ConditioningFormat, string> = {
  amrap: '시간 안에 최대한 (AMRAP)',
  emom: '1분마다 (EMOM)',
  forTime: '빨리 끝내기 (For Time)',
  intervals: '하고 쉬기 반복 (인터벌)',
  circuit: '쉬지 않고 돌기 (서킷)',
};

export const FORMAT_DESCRIPTIONS_KO: Record<ConditioningFormat, string> = {
  amrap: '정해진 시간 안에 할 수 있는 만큼 여러 바퀴 돕니다',
  emom: '1분이 시작될 때마다 정해진 동작을 하고, 남는 시간에 쉽니다',
  forTime: '정해진 양을 될 수 있는 대로 빨리 끝냅니다',
  intervals: '운동과 휴식을 정해진 시간만큼 번갈아 합니다',
  circuit: '여러 동작을 쉬지 않고 이어서 한 바퀴를 돕니다',
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

/** 초보의 숨찬 운동에는 넣지 않는 동작 — 관절 부하는 낮아도 지친 상태에서 자세를 지키기 어렵다. */
const HARD_FOR_BEGINNER_WOD = new Set(['ab-wheel-rollout', 'hanging-leg-raise']);

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

/**
 * 컨디셔닝에 잘 맞는 동작 — 배우기 쉽고 반복해도 자세가 덜 무너진다.
 *
 * 집에서 할 수 있는 맨몸 · 밴드 동작이 빠져 있어서 매트뿐인 초보의 15분 서킷이 플랭크 하나로 끝났다.
 * 케틀벨 스윙은 와드의 기본인데 목록에 없어 한 번도 안 나왔다(초보는 관절 한도에서 걸러진다).
 * 워킹 런지는 붐비는 헬스장에서 길게 걸을 자리가 없다 — 제자리에서 하는 동작보다 뒤로.
 */
const PREFERRED = [
  'goblet-squat', 'kettlebell-swing', 'step-up', 'push-up', 'walking-lunge', 'bulgarian-split-squat',
  'dumbbell-bench-press', 'seated-dumbbell-press', 'landmine-press',
  'one-arm-dumbbell-row', 'lat-pulldown', 'seated-cable-row', 'face-pull',
  'hip-thrust', 'cable-pull-through', 'machine-hip-thrust', 'back-extension',
  'farmers-walk', 'plank', 'side-plank', 'hanging-leg-raise', 'ab-wheel-rollout',
  'dead-bug', 'cable-crunch', 'standing-calf-raise', 'leg-press',
  'bodyweight-squat', 'glute-bridge', 'bodyweight-reverse-lunge', 'incline-push-up', 'band-row',
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
  /**
   * 날마다 다른 구성을 위한 값(예: 날짜 문자열의 해시). 같은 부위 갈래(상체 · 하체 · 몸통) 후보 안에서
   * 시작 순서를 돌린다. 없으면 늘 같은 구성 — 매일 고블릿 스쿼트 / 워킹 런지 / 푸시업이었다.
   */
  seed?: number;
  /**
   * 동작 갈래를 좁힌다 — 'weights'는 덤벨 · 케틀벨 · 기구로 무게를 싣는 동작만, 'bodyweight'는 맨몸 동작만.
   * 몸통 운동(플랭크 · 데드버그)은 어느 쪽에나 낀다. 좁혀서 동작이 모자라면 좁히지 않은 것으로 돌아간다.
   */
  only?: readonly ('weights' | 'bodyweight')[];
  /**
   * 들고 옮길 수 있는 것(덤벨 · 케틀벨 · 밴드 · 맨몸)만 쓴다. 근력 운동 뒤 마무리로 돌 때 레그프레스 · 케이블 ·
   * 풀다운 세 대를 번갈아 차지하는 구성은 붐비는 헬스장에서 못 한다. 모자라면 기구 동작으로 돌아간다.
   */
  portableOnly?: boolean;
  /** 한 바퀴 맨 앞에 넣을 유산소 구간(로잉머신 1분). 동작 수에 들어간다 */
  cardioElement?: { id: string; name: string; seconds: number };
}

const PORTABLE: ReadonlySet<string> = new Set(['dumbbell', 'kettlebell', 'bodyweight', 'band']);

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
    /*
     * 바벨을 끄면 바벨을 쓰는 동작은 다 뺀다 — 랜드마인 프레스 · 힙 쓰러스트도 바 하나를 쓴다. 와드 바벨 목록(데드 · 스쿼트 ·
     * 오버헤드)만 막았더니 "바벨 끔"인데 랜드마인 · 힙 쓰러스트가 계속 나왔다.
     */
    .filter((exercise) => barbellOn || exercise.equipment !== 'barbell')
    .filter((exercise) => screenExercise(exercise, pain).action === 'allow')
    // 초보가 숨찬 채로 하기엔 어려운 몸통 운동 — 허리가 꺾이거나 매달려 흔들린다
    .filter((exercise) => input.level !== 'beginner' || !HARD_FOR_BEGINNER_WOD.has(exercise.id))
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

  const cardioFirst = input.cardioElement;
  const wanted = Math.max(1, movementCount(input.minutes) - (cardioFirst ? 1 : 0));
  const kinds = new Set(input.only ?? []);
  const inFocus = (exercise: Exercise): boolean =>
    kinds.size !== 1 || exercise.pattern === 'core' || (kinds.has('bodyweight') ? isUnloaded(exercise) : !isUnloaded(exercise));
  const focused = safe.filter((entry) => inFocus(entry.exercise));
  const widest = focused.length >= wanted ? focused : safe;
  const portable = widest.filter((entry) => PORTABLE.has(entry.exercise.equipment));
  const scoped = input.portableOnly && portable.length >= wanted + 1 ? portable : widest;

  // 근력 세션과 겹치는 부위는 먼저 빼고, 남는 동작이 모자랄 때만 되돌린다.
  const withoutAvoided = scoped.filter((entry) => {
    const primary = primaryOf(entry.exercise);
    return !primary || !avoid.has(primary);
  });
  const candidates = rotateWithinRegions(withoutAvoided.length >= wanted ? withoutAvoided : scoped, input.seed);

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
    // 바벨은 한 와드에 하나 — 바벨 하나를 두 동작이 번갈아 쓰면 무게를 갈아 끼우느라 라운드가 끊긴다.
    if (isWodBarbell(entry.exercise) && picked.some(isWodBarbell)) continue;

    const region = regionOf(entry.exercise);
    if ((usedRegions.get(region) ?? 0) >= Math.ceil(wanted / 2)) continue;

    picked.push(entry.exercise);
    if (primary) usedMuscles.add(primary);
    usedRegions.set(region, (usedRegions.get(region) ?? 0) + 1);
  }

  const movements = picked.map((exercise) => toMovement(exercise, input));
  if (cardioFirst) {
    const seconds = Math.max(20, Math.round(cardioFirst.seconds));
    movements.unshift({
      exerciseId: `cardio:${cardioFirst.id}`, name: cardioFirst.name,
      amount: seconds, unit: 'seconds', display: seconds % 60 === 0 ? `${seconds / 60}분` : `${seconds}초`,
      note: '숨이 찰 만큼만',
    });
  }
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

/** 바벨 하나를 쓰는 동작 — 와드 바벨 목록 말고도 랜드마인 프레스 · 힙 쓰러스트처럼 바벨을 쓰는 것까지 */
function isWodBarbell(exercise: Exercise): boolean {
  return WOD_BARBELL.indexOf(exercise.id) >= 0 || exercise.equipment === 'barbell';
}

/**
 * 같은 갈래(상체 · 하체 · 몸통) 후보끼리 순서를 seed만큼 돌린다. 갈래가 놓인 자리는 그대로라
 * 상체 · 하체가 섞이는 모양은 같고, 그 자리에 오는 동작만 날마다 바뀐다.
 */
function rotateWithinRegions<T extends { exercise: Exercise }>(entries: readonly T[], seed: number | undefined): T[] {
  if (seed === undefined || !Number.isFinite(seed)) return [...entries];
  const turn = Math.abs(Math.trunc(seed));
  const buckets = new Map<string, T[]>();
  for (const entry of entries) {
    const region = regionOf(entry.exercise);
    buckets.set(region, [...(buckets.get(region) ?? []), entry]);
  }
  const rotated = new Map<string, T[]>();
  for (const [region, list] of buckets) {
    const shift = turn % list.length;
    rotated.set(region, [...list.slice(shift), ...list.slice(0, shift)]);
  }
  const taken = new Map<string, number>();
  return entries.map((entry) => {
    const region = regionOf(entry.exercise);
    const at = taken.get(region) ?? 0;
    taken.set(region, at + 1);
    return rotated.get(region)![at]!;
  });
}

function toMovement(exercise: Exercise, input: ConditioningInput): ConditioningMovement {
  const isBodyweight = isUnloaded(exercise);
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
    '이건 근육 키우는 세트 수에는 안 들어가고 피로에만 셉니다.',
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
  /** 몸 풀기까지 합친 시간 */
  totalMinutes: number;
  /** 무엇을 조심해야 하는가. 비어 있으면 특별히 없다 */
  cautions: string[];
}

/**
 * 몸 풀기 길이.
 *
 * 와드가 짧을수록 몸 풀기 비중이 커진다 — 5분짜리 와드에 5분을 푸는 건
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
      `${raise}분 — 로잉 · 실내 자전거 · 줄넘기 · 빠르게 걷기 중 하나로 숨이 조금 찰 때까지 합니다. 땀이 살짝 날 정도까지.`,
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
 * 몸 풀기부터 와드까지 한 판.
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
      '평소 무게의 절반 이하로 잡으세요.',
    );

    /*
     * For Time과 AMRAP은 속도 제한이 없다. 허리가 실리는 동작을 넣으면
     * 마지막 라운드에서 자세가 무너진 채로 최대 반복을 하게 된다.
     * EMOM은 매 분 남는 시간이 강제 휴식이라 그 일이 덜 벌어진다.
     */
    if (input.format === 'forTime' || input.format === 'amrap') {
      cautions.push(
        '이 방식은 쉬는 시간이 따로 없습니다. 허리에 무게가 실리는 동작이 들어가면 ' +
        '1분마다(EMOM)처럼 매 분 쉬는 틈이 있는 방식이 더 안전합니다.',
      );
    }
  }

  if (input.standalone) {
    cautions.push(
      '오늘은 이것만 합니다. 와드는 근육 키우는 세트 수에 들어가지 않아 한 주 세트는 ' +
      '늘지 않고 피로만 쌓입니다 — 근력 운동을 대신하는 게 아니라 다른 운동입니다.',
    );
  }

  return {
    warmup,
    workout,
    totalMinutes: warmup.minutes + workout.durationMinutes,
    cautions,
  };
}

/* ── 한 주의 마무리 운동 계획 ──────────────────────────

   목표가 '체력 기르기(크로스핏식)'이면 근력 운동 뒤에 날마다 다른 마무리 운동을 붙이고,
   '체지방 감량'이면 숨이 덜 찬 유산소를 붙인다. 둘 다 "무엇을 · 몇 분 · 얼마나 세게"를
   요일마다 정해 주는 표다. 실제 동작은 buildFinisher가 그날의 기구 · 통증으로 고른다.

   크로스핏식 한 주는 세 갈래를 고르게 섞는다.
     · 무게 들기(덤벨 · 케틀벨 · 기구)   — 'weights'
     · 맨몸(푸시업 · 스쿼트 · 런지 · 몸통) — 'bodyweight'
     · 숨차기(로잉 · 자전거 같은 유산소)  — 'cardio'
   하루에 두 갈래씩 짝지어 돌리면 주 2회만 해도 세 갈래가 다 들어간다.

   초보에게 지키는 것:
     · 처음 두 주는 '1분마다' · '쉬지 않고 돌기'만 — 속도를 스스로 정하는 방식(시간 안에 최대한 · 빨리 끝내기)은
       자세가 잡힌 뒤에. 빨리 끝내기는 초보에게 끝까지 주지 않는다.
     · 바벨은 넣지 않는다(buildConditioning이 초보에게는 켜도 막는다). 뛰는 유산소도 넣지 않는다.
     · 8분에서 시작해 셋째 주부터 10분.
── */

/** 마무리 운동의 동작 갈래. */
export type WodModality = 'weights' | 'bodyweight' | 'cardio';

export const MODALITY_LABELS_KO: Record<WodModality, string> = {
  weights: '무게 들기',
  bodyweight: '맨몸 동작',
  cardio: '숨차는 유산소',
};

export interface FinisherSpec {
  /** 프로그램의 몇 번째 날인가(templates의 순서) */
  dayIndex: number;
  dayName: string;
  /** 'wod' — 여러 동작을 시간 재며 도는 마무리 운동. 'cardio' — 한 가지 유산소를 일정한 세기로 */
  kind: 'wod' | 'cardio';
  /** kind가 'wod'일 때의 방식 */
  format?: ConditioningFormat;
  minutes: number;
  /** 오늘 섞는 갈래 */
  modalities: WodModality[];
  /** kind가 'cardio'일 때의 세기 */
  zone?: CardioZone;
  /** 오늘 근력 운동에 하체 큰 운동이 있다 — 다리를 덜 쓰는 유산소를 고른다 */
  easyOnLegs: boolean;
  /** 마무리 운동에서 피할 부위 — 데드리프트를 한 날의 뒤허벅지 · 엉덩이 */
  avoidMuscles: MuscleGroup[];
  /** 화면에 그대로 쓸 제목과 이유 한 줄 */
  title: string;
  why: string;
}

export interface RestDayCardio {
  sessions: number;
  minutes: number;
  zone: CardioZone;
  text: string;
}

export interface WeeklyConditioningPlan {
  /** 무엇 때문에 붙는가. 'none'이면 붙는 것이 없다 */
  kind: 'conditioning' | 'fatLoss' | 'none';
  /** 운동하는 날마다 하나씩(templates와 같은 순서). 'none'이면 비어 있다 */
  days: FinisherSpec[];
  /** 쉬는 날 걷기 */
  restDay: RestDayCardio | null;
  /** 한 주에 숨차게 움직이는 시간(분) — 운동 뒤 + 쉬는 날 */
  weeklyMinutes: number;
  /** 이번 주에 들어간 갈래 — 고르게 섞였는지 화면에 보여 줄 때 */
  modalities: WodModality[];
  /** 한 줄 요약 */
  summary: string;
  notes: string[];
}

export interface WeeklyConditioningInput {
  goals: readonly TrainingGoal[];
  level: TrainingLevel;
  templates: readonly Pick<SessionTemplate, 'name' | 'slots'>[];
  /** 그 헬스장 · 집의 기구. 없으면 다 있다고 본다 */
  equipmentIds?: readonly string[];
  /** 과정의 몇째 주인가(1부터). 없으면 1 */
  weekInBlock?: number;
  /** 덜어내는 주인가 — 숨찬 운동도 쉬운 유산소로 바꾼다 */
  deload?: boolean;
}

const LOWER_PATTERNS = new Set(['squat', 'hinge', 'lunge']);
const UPPER_PATTERNS = new Set(['horizontalPush', 'verticalPush', 'horizontalPull', 'verticalPull']);

/** 요일마다 섞는 갈래. 앞의 둘만으로 세 갈래가 다 들어간다. */
const MODALITY_ROTATION: readonly (readonly WodModality[])[] = [
  ['weights', 'bodyweight'],
  ['cardio', 'bodyweight'],
  ['weights', 'cardio'],
  ['bodyweight'],
  ['cardio'],
  ['weights', 'bodyweight'],
  ['cardio', 'bodyweight'],
];

const FORMATS_FIRST_WEEKS: readonly ConditioningFormat[] = ['emom', 'circuit'];
const FORMATS_BEGINNER: readonly ConditioningFormat[] = ['emom', 'circuit', 'amrap', 'intervals'];
const FORMATS_TRAINED: readonly ConditioningFormat[] = ['emom', 'amrap', 'intervals', 'forTime'];

/** 마무리 운동 길이(분) — 단계와 주차로. */
export function finisherMinutes(level: TrainingLevel, weekInBlock = 1): number {
  const later = weekInBlock >= 3;
  if (level === 'beginner') return later ? 10 : 8;
  if (level === 'intermediate') return later ? 12 : 10;
  return later ? 15 : 12;
}

/** 마무리 운동 한 바퀴에 넣을 수 있는 유산소 — 그 자리에서 바로 타고 내릴 수 있는 것만. */
const WOD_CARDIO_ORDER = ['row', 'bike', 'elliptical', 'stair', 'jump-rope', 'treadmill-run'];

function wodCardioOptions(
  level: TrainingLevel,
  equipmentIds: readonly string[] | undefined,
  pain: readonly PainReport[] = [],
): CardioExercise[] {
  const owned = equipmentIds ? new Set(equipmentIds) : undefined;
  const sore = pain.some((report) => report.score >= 3 && (report.joint === 'knee' || report.joint === 'ankle'));
  return WOD_CARDIO_ORDER
    .map((id) => CARDIO.find((item) => item.id === id))
    .filter((item): item is CardioExercise => Boolean(item))
    // 기구가 있어야 하는 것만 — 줄넘기는 줄이 있는지 알 수 없어 기구 목록을 준 곳에서는 넣지 않는다
    .filter((item) => (owned ? Boolean(item.equipmentId && owned.has(item.equipmentId)) : true))
    // 초보 · 무릎이나 발목이 아픈 사람에게는 뛰는 것 · 계단을 주지 않는다
    .filter((item) => !((level === 'beginner' || sore) && item.impact !== 'low'));
}

function hasLoadedWodMoves(equipmentIds: readonly string[] | undefined): boolean {
  const pool = equipmentIds ? availableExercises(equipmentIds, EXERCISES) : EXERCISES;
  return pool.filter((exercise) => PREFERRED.includes(exercise.id) && !isUnloaded(exercise) &&
    exercise.equipment !== 'barbell' && exercise.pattern !== 'core').length >= 2;
}

function minutesRange(values: readonly number[]): string {
  const low = Math.min(...values);
  const high = Math.max(...values);
  return low === high ? `${low}` : `${low}~${high}`;
}

function unique<T>(list: readonly T[]): T[] {
  return list.filter((item, index) => list.indexOf(item) === index);
}

/**
 * 한 주의 마무리 운동 · 유산소 계획.
 *
 *   · 체력 기르기        — 날마다 다른 마무리 운동(8~15분). 쉬는 날 하루는 가볍게 걷기.
 *   · 체지방 감량        — 운동 뒤 대화되는 정도의 유산소 10~20분 + 쉬는 날 걷기 20~30분.
 *   · 근력 + 체지방 감량 — 유산소는 쉽게만, 15분 안쪽. 무거운 운동에 쓸 힘을 남긴다.
 *   · 둘 다(체력 + 감량) — 마무리 운동 + 쉬는 날 걷기.
 *   · 그 밖              — 붙는 것이 없다('none'). 컨디셔닝 · 유산소는 하고 싶을 때 직접 고른다.
 */
export function weeklyConditioningPlan(input: WeeklyConditioningInput): WeeklyConditioningPlan {
  const plan = planGoals(input.goals);
  const { level } = input;
  const week = Math.max(1, Math.round(input.weekInBlock ?? 1));
  const days = input.templates.length;
  const beginner = level === 'beginner';
  const strength = plan.goals.includes('strength');

  if (!plan.conditioning && !plan.cutting) {
    return { kind: 'none', days: [], restDay: null, weeklyMinutes: 0, modalities: [], summary: '', notes: [] };
  }

  const dayInfo = input.templates.map((template) => {
    const exercises = template.slots.map((slot) => ({ slot, exercise: exerciseById(slot.exerciseId) }));
    const lower = exercises.some(({ slot, exercise }) =>
      exercise !== undefined && LOWER_PATTERNS.has(exercise.pattern) && slot.role !== 'isolation' && !isUnloaded(exercise));
    const heavyPull = exercises.some(({ exercise }) => exercise !== undefined && HEAVY_PULLS.has(exercise.id));
    const upper = exercises.some(({ slot, exercise }) =>
      exercise !== undefined && slot.role !== 'isolation' && UPPER_PATTERNS.has(exercise.pattern));
    // 하체만 하는 날 — 마무리 운동에서 다리를 또 몰아 쓰지 않는다
    const avoid: MuscleGroup[] = lower && !upper ? ['quads', 'hamstrings', 'glutes']
      : heavyPull ? ['hamstrings', 'glutes'] : [];
    return { name: template.name, lower, heavyPull, avoid };
  });

  const easyCardio = (dayIndex: number, minutes: number, zone: CardioZone, why: string): FinisherSpec => {
    const info = dayInfo[dayIndex]!;
    return {
      dayIndex, dayName: info.name, kind: 'cardio', minutes, zone,
      modalities: ['cardio'], easyOnLegs: info.lower, avoidMuscles: [],
      title: `마무리 유산소 · ${cardioZoneOf(zone).label} ${minutes}분`,
      why,
    };
  };

  const specs: FinisherSpec[] = [];
  const notes: string[] = [];

  if (plan.conditioning) {
    const canLoad = hasLoadedWodMoves(input.equipmentIds);
    const canCardio = wodCardioOptions(level, input.equipmentIds).length > 0;
    const formats = beginner ? (week <= 2 ? FORMATS_FIRST_WEEKS : FORMATS_BEGINNER) : FORMATS_TRAINED;
    const minutes = finisherMinutes(level, week);
    let wodCount = 0;

    dayInfo.forEach((info, dayIndex) => {
      if (input.deload) {
        specs.push(easyCardio(dayIndex, 10, 'easy', '덜어내는 주라 숨찬 운동 대신 가볍게 몸만 풉니다.'));
        return;
      }
      const wanted = MODALITY_ROTATION[dayIndex % MODALITY_ROTATION.length]!;
      // 유산소만 하는 날 — 한 가지를 길게. 기구가 없어도 걷기 · 계단으로 된다
      if (wanted.length === 1 && wanted[0] === 'cardio') {
        // 초보와 하체를 한 날은 세게 하지 않는다 — 지친 다리로 전력을 내면 다음 하체 운동까지 깎인다
        const steady = beginner || info.lower;
        const zone: CardioZone = steady ? 'steady' : 'interval';
        const long = beginner ? 15 : steady ? 20 : 16;
        specs.push({
          ...easyCardio(dayIndex, long, zone, steady
            ? '오늘은 한 가지 유산소를 대화가 되는 세기로 길게 합니다. 숨차는 힘의 바탕을 만드는 날입니다.'
            : '오늘은 한 가지 유산소로 1분 세게, 1분 천천히를 번갈아 합니다.'),
          title: steady ? `마무리 유산소 · 대화되는 정도 ${long}분` : `마무리 유산소 · 1분 세게 1분 천천히 ${long}분`,
        });
        return;
      }
      const modalities = unique(wanted
        .map((kind): WodModality => (kind === 'weights' && !canLoad ? 'bodyweight' : kind))
        .filter((kind) => kind !== 'cardio' || canCardio));
      if (modalities.length === 0) modalities.push('bodyweight');
      // 무거운 데드리프트를 한 날은 매 분 쉬는 틈이 있는 방식으로 — 지친 허리로 속도를 내지 않게
      const format = info.heavyPull ? 'emom' : formats[wodCount % formats.length]!;
      wodCount += 1;
      specs.push({
        dayIndex, dayName: info.name, kind: 'wod', format, minutes, modalities,
        easyOnLegs: info.lower,
        avoidMuscles: info.avoid,
        title: `마무리 운동 · ${FORMAT_LABELS_KO[format]} ${minutes}분`,
        why: `오늘은 ${modalities.map((kind) => MODALITY_LABELS_KO[kind]).join(' + ')}${modalities.length > 1 ? '를 섞습니다' : ' 위주입니다'}. ` +
          FORMAT_DESCRIPTIONS_KO[format] + '.',
      });
    });

    notes.push('근력 운동을 먼저 끝내고 마무리 운동을 합니다. 순서를 바꾸면 드는 무게가 떨어집니다.');
    if (beginner) {
      notes.push(week <= 2
        ? '처음 두 주는 속도를 내지 않는 방식(1분마다 · 쉬지 않고 돌기)으로만 합니다. 횟수보다 자세가 먼저입니다.'
        : '빨리 끝내기 방식은 자세가 더 잡힌 뒤에 넣습니다. 바벨 동작은 시간에 쫓기며 하지 않습니다.');
    }
    if (!canLoad) notes.push('무게를 실을 기구가 없어 맨몸 동작으로 짭니다. 덤벨이나 케틀벨이 있으면 무게 드는 날이 생깁니다.');
    if (!canCardio) notes.push('로잉머신 · 자전거 같은 유산소 기구가 없어, 숨차는 유산소는 걷기 · 계단으로 따로 합니다.');
  } else {
    // 체지방 감량 — 숨이 덜 찬 유산소. 근력이 같이 있으면 쉽게, 짧게.
    dayInfo.forEach((info, dayIndex) => {
      if (input.deload) {
        specs.push(easyCardio(dayIndex, 10, 'easy', '덜어내는 주에도 가볍게 걷는 것은 그대로 합니다.'));
        return;
      }
      const early = week <= 2;
      let minutes = beginner ? (early ? 10 : 15) : (early ? 15 : 20);
      let zone: CardioZone = beginner && early ? 'easy' : 'steady';
      if (strength) {
        zone = 'easy';
        minutes = Math.min(minutes, info.lower ? 10 : 15);
      }
      specs.push(easyCardio(dayIndex, minutes, zone, strength
        ? '무거운 운동을 지키려고 숨이 거의 안 차는 세기로만 합니다.' +
          (info.lower ? ' 하체를 한 날이라 다리를 덜 쓰는 것으로 짧게 합니다.' : '')
        : '체지방은 식사에서 빠지고, 유산소는 거기에 조금 보탭니다. 대화가 되는 세기면 근력 운동을 방해하지 않습니다.' +
          (info.lower ? ' 하체를 한 날은 자전거 · 걷기처럼 다리를 덜 쓰는 것으로 합니다.' : '')));
    });
    notes.push('유산소는 근력 운동을 다 끝낸 뒤에 합니다. 먼저 하면 그날 드는 무게가 떨어집니다.');
    notes.push('체중이 한 주에 몸무게의 1%보다 빨리 빠지면 유산소를 늘리지 말고 식사를 조금 늘리세요. 그보다 빠르면 근육이 같이 빠집니다.');
  }

  // 쉬는 날 걷기 — 감량이면 여러 번, 체력만이면 회복용으로 한 번
  let restDay: RestDayCardio | null = null;
  const freeDays = Math.max(0, 7 - days);
  if (freeDays > 0 && !input.deload) {
    if (plan.cutting) {
      const sessions = Math.min(freeDays, strength || plan.conditioning ? 2 : 3, Math.max(1, 6 - days));
      const minutes = beginner ? 20 : 30;
      restDay = {
        sessions, minutes, zone: 'steady',
        text: `쉬는 날 중 ${sessions}번은 ${minutes}분쯤 빠르게 걷습니다. 대화가 되는 정도면 충분합니다. 하루 7천~1만 보를 채우는 것도 같은 효과입니다.`,
      };
    } else {
      restDay = {
        sessions: 1, minutes: 20, zone: 'easy',
        text: '쉬는 날 하루는 20분쯤 가볍게 걸으면 회복이 빨라집니다. 숨찬 운동은 쉬는 날에 더 하지 않습니다.',
      };
    }
  }

  const weeklyMinutes = specs.reduce((sum, spec) => sum + spec.minutes, 0) + (restDay ? restDay.sessions * restDay.minutes : 0);
  const modalities = unique(specs.flatMap((spec) => spec.modalities));
  const summary = plan.conditioning
    ? `근력 운동 뒤에 날마다 ${specs[0]?.minutes ?? 10}분 안팎의 마무리 운동을 붙입니다 — 한 주 ${specs.length}번.`
    : `근력 운동 뒤에 유산소를 ${minutesRange(specs.map((spec) => spec.minutes))}분 붙입니다.`;

  return {
    kind: plan.conditioning ? 'conditioning' : 'fatLoss',
    days: specs, restDay, weeklyMinutes, modalities, summary, notes,
  };
}

export interface FinisherInput {
  level: TrainingLevel;
  equipmentIds?: readonly string[];
  /** 집(홈짐)인가 — 없는 유산소 기구는 아예 고르지 않는다 */
  home?: boolean;
  pain?: readonly PainReport[];
  bodyweightKg?: number;
  /** 오늘 근력 운동이 쓴 부위 — 유산소가 겹치는지 볼 때 */
  todayMuscles?: readonly MuscleGroup[];
  /** 날마다 다른 구성을 위한 값(날짜 해시) */
  seed?: number;
  /** 마무리 운동에 바벨을 넣을지 — 초보는 켜도 안 들어간다 */
  allowBarbell?: boolean;
}

export interface CardioFinisher {
  exercise: CardioExercise;
  zone: ZoneSpec;
  minutes: number;
  /** 화면에 그대로 쓸 한 줄 */
  text: string;
}

export type Finisher =
  | { kind: 'wod'; spec: FinisherSpec; session: WodSession }
  | { kind: 'cardio'; spec: FinisherSpec; cardio: CardioFinisher };

/** 그날의 마무리 운동을 실제 동작으로 — 기구 · 통증 · 단계에 맞춰 고른다. */
export function buildFinisher(spec: FinisherSpec, input: FinisherInput): Finisher {
  if (spec.kind === 'cardio') {
    const zone = cardioZoneOf(spec.zone ?? 'steady');
    const owned = input.equipmentIds ? new Set(input.equipmentIds) : undefined;
    const sore = (input.pain ?? []).some((report) => report.score >= 3 && (report.joint === 'knee' || report.joint === 'ankle'));
    const gentle = input.level === 'beginner' || sore;
    const usable = rankForToday(input.todayMuscles ?? [], { equipmentIds: input.equipmentIds, home: input.home })
      .filter((item) => !item.poolOnly)
      .filter((item) => !owned || !item.equipmentId || owned.has(item.equipmentId));
    // 헬스장에 유산소 기구가 있으면 그것부터 — 운동을 마친 자리에서 "밖에 나가 걷기"를 권하지 않는다
    const machines = usable.filter((item) => owned !== undefined && item.equipmentId !== undefined);
    const ranked = [...machines, ...usable.filter((item) => !machines.includes(item))];
    const fits = (item: CardioExercise) =>
      (!gentle || item.impact === 'low') && (!spec.easyOnLegs || item.legLoad <= 0.4);
    const exercise = ranked.find(fits) ?? ranked.find((item) => item.impact === 'low') ?? ranked[0] ??
      CARDIO.find((item) => item.id === 'brisk-walk')!;
    const how = spec.zone === 'interval'
      ? '1분은 말이 안 나올 만큼 세게, 1분은 천천히를 번갈아 합니다'
      : zone.talk;
    return {
      kind: 'cardio', spec,
      cardio: {
        exercise, zone, minutes: spec.minutes,
        text: `${exercise.name} ${spec.minutes}분 — ${how}.`.replace(/\.\.$/, '.'),
      },
    };
  }

  const only = spec.modalities.filter((kind): kind is 'weights' | 'bodyweight' => kind !== 'cardio');
  const options = (spec.modalities.includes('cardio') ? wodCardioOptions(input.level, input.equipmentIds, input.pain) : [])
    // 하체를 한 날은 다리에 크게 실리는 것(계단 · 달리기)을 넣지 않는다
    .filter((item, _, all) => !spec.easyOnLegs || item.legLoad <= 0.5 || all.every((other) => other.legLoad > 0.5));
  const turn = Math.abs(Math.trunc(input.seed ?? 0));
  const machine = options.length > 0 ? options[turn % options.length] : undefined;
  const format = spec.format ?? 'circuit';
  const session = buildWodSession({
    format,
    minutes: spec.minutes,
    level: input.level,
    equipmentIds: input.equipmentIds,
    pain: input.pain,
    bodyweightKg: input.bodyweightKg,
    avoidMuscles: spec.avoidMuscles,
    allowBarbell: input.allowBarbell ?? false,
    seed: input.seed,
    only: only.length === 1 ? only : undefined,
    portableOnly: true,
    cardioElement: machine
      ? { id: machine.id, name: machine.name, seconds: format === 'emom' ? 40 : 60 }
      : undefined,
  });
  return { kind: 'wod', spec, session };
}
