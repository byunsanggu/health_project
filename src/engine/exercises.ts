import type { Exercise, Joint, MovementPattern, MuscleGroup } from './types.ts';

/**
 * 시드 운동 데이터베이스.
 *
 * 운동 명칭은 일반 명칭이고, 기여도/관절 스트레스 값은 직접 작성한 코칭 판단이다.
 * 외부 앱의 데이터를 가져오지 않는다 — 항목을 늘릴 때도 같은 원칙을 지킬 것.
 *
 * jointStress 읽는 법:
 *   0.9 이상 = 그 관절이 아프면 사실상 금기
 *   0.6~0.8  = 통증 3점 이상이면 대체 권장
 *   0.3 이하 = 경미한 통증에서는 대체로 수행 가능
 */
export const EXERCISES: readonly Exercise[] = [
  // ── 수평 푸시 ───────────────────────────────────────────────
  {
    id: 'barbell-bench-press',
    name: '바벨 벤치프레스', nameEn: 'Barbell Bench Press',
    equipment: 'barbell', pattern: 'horizontalPush', increment: 2.5,
    contribution: { chest: 1, triceps: 0.5, frontDelt: 0.5 },
    jointStress: { shoulder: 0.8, elbow: 0.4, wrist: 0.4 },
  },
  {
    id: 'dumbbell-bench-press',
    name: '덤벨 벤치프레스', nameEn: 'Dumbbell Bench Press',
    equipment: 'dumbbell', pattern: 'horizontalPush', increment: 2,
    contribution: { chest: 1, triceps: 0.4, frontDelt: 0.5 },
    jointStress: { shoulder: 0.6, elbow: 0.3, wrist: 0.3 },
  },
  {
    id: 'machine-chest-press',
    name: '머신 체스트프레스', nameEn: 'Machine Chest Press',
    equipment: 'machine', pattern: 'horizontalPush', increment: 5,
    contribution: { chest: 1, triceps: 0.4, frontDelt: 0.4 },
    jointStress: { shoulder: 0.4, elbow: 0.25 },
  },
  {
    id: 'incline-dumbbell-press',
    name: '인클라인 덤벨프레스', nameEn: 'Incline Dumbbell Press',
    equipment: 'dumbbell', pattern: 'horizontalPush', increment: 2,
    contribution: { chest: 0.9, frontDelt: 0.7, triceps: 0.4 },
    jointStress: { shoulder: 0.65, elbow: 0.3, wrist: 0.3 },
  },
  {
    id: 'push-up',
    name: '푸시업', nameEn: 'Push-Up',
    equipment: 'bodyweight', pattern: 'horizontalPush', increment: 0,
    contribution: { chest: 0.8, triceps: 0.5, frontDelt: 0.4, abs: 0.25 },
    jointStress: { shoulder: 0.45, elbow: 0.3, wrist: 0.6 },
  },
  {
    id: 'cable-fly',
    name: '케이블 플라이', nameEn: 'Cable Fly',
    equipment: 'cable', pattern: 'isolation', increment: 2.5,
    contribution: { chest: 1, frontDelt: 0.25 },
    jointStress: { shoulder: 0.5, elbow: 0.15 },
  },
  {
    id: 'pec-deck',
    name: '펙덱 플라이', nameEn: 'Pec Deck',
    equipment: 'machine', pattern: 'isolation', increment: 5,
    contribution: { chest: 1 },
    jointStress: { shoulder: 0.4, elbow: 0.1 },
  },

  // ── 수직 푸시 ───────────────────────────────────────────────
  {
    id: 'barbell-overhead-press',
    name: '바벨 오버헤드프레스', nameEn: 'Barbell Overhead Press',
    equipment: 'barbell', pattern: 'verticalPush', increment: 2.5,
    contribution: { frontDelt: 1, sideDelt: 0.5, triceps: 0.5, abs: 0.25, traps: 0.25 },
    jointStress: { shoulder: 0.9, elbow: 0.4, wrist: 0.4, lowBack: 0.4 },
  },
  {
    id: 'landmine-press',
    name: '랜드마인 프레스', nameEn: 'Landmine Press',
    equipment: 'barbell', pattern: 'verticalPush', increment: 2.5,
    contribution: { frontDelt: 0.9, chest: 0.4, triceps: 0.4, abs: 0.3 },
    jointStress: { shoulder: 0.35, elbow: 0.25, lowBack: 0.25 },
  },
  {
    id: 'seated-dumbbell-press',
    name: '시티드 덤벨 숄더프레스', nameEn: 'Seated Dumbbell Shoulder Press',
    equipment: 'dumbbell', pattern: 'verticalPush', increment: 2,
    contribution: { frontDelt: 1, sideDelt: 0.5, triceps: 0.4 },
    jointStress: { shoulder: 0.65, elbow: 0.3, wrist: 0.3 },
  },
  {
    id: 'machine-shoulder-press',
    name: '머신 숄더프레스', nameEn: 'Machine Shoulder Press',
    equipment: 'machine', pattern: 'verticalPush', increment: 5,
    contribution: { frontDelt: 1, sideDelt: 0.4, triceps: 0.4 },
    jointStress: { shoulder: 0.45, elbow: 0.25 },
  },

  // ── 수직 풀 ────────────────────────────────────────────────
  {
    id: 'pull-up',
    name: '풀업', nameEn: 'Pull-Up',
    equipment: 'bodyweight', pattern: 'verticalPull', increment: 2.5,
    contribution: { back: 1, biceps: 0.5, rearDelt: 0.3, forearms: 0.4, abs: 0.25 },
    jointStress: { shoulder: 0.6, elbow: 0.4, wrist: 0.3 },
  },
  {
    id: 'lat-pulldown',
    name: '랫 풀다운', nameEn: 'Lat Pulldown',
    equipment: 'cable', pattern: 'verticalPull', increment: 5,
    contribution: { back: 1, biceps: 0.5, rearDelt: 0.25, forearms: 0.3 },
    jointStress: { shoulder: 0.4, elbow: 0.3 },
  },
  {
    id: 'neutral-grip-pulldown',
    name: '중립그립 풀다운', nameEn: 'Neutral-Grip Pulldown',
    equipment: 'cable', pattern: 'verticalPull', increment: 5,
    contribution: { back: 1, biceps: 0.5, forearms: 0.3 },
    jointStress: { shoulder: 0.25, elbow: 0.25 },
  },

  // ── 수평 풀 ────────────────────────────────────────────────
  {
    id: 'barbell-row',
    name: '바벨 로우', nameEn: 'Barbell Row',
    equipment: 'barbell', pattern: 'horizontalPull', increment: 2.5,
    contribution: { back: 1, rearDelt: 0.5, biceps: 0.4, traps: 0.4, hamstrings: 0.25 },
    jointStress: { lowBack: 0.8, shoulder: 0.4, elbow: 0.3 },
  },
  {
    id: 'chest-supported-row',
    name: '체스트 서포티드 로우', nameEn: 'Chest-Supported Row',
    equipment: 'machine', pattern: 'horizontalPull', increment: 5,
    contribution: { back: 1, rearDelt: 0.5, biceps: 0.4, traps: 0.4 },
    jointStress: { lowBack: 0.1, shoulder: 0.3, elbow: 0.3 },
  },
  {
    id: 'seated-cable-row',
    name: '시티드 케이블 로우', nameEn: 'Seated Cable Row',
    equipment: 'cable', pattern: 'horizontalPull', increment: 5,
    contribution: { back: 1, rearDelt: 0.4, biceps: 0.4, traps: 0.3 },
    jointStress: { lowBack: 0.3, shoulder: 0.3, elbow: 0.3 },
  },
  {
    id: 'face-pull',
    name: '페이스 풀', nameEn: 'Face Pull',
    equipment: 'cable', pattern: 'isolation', increment: 2.5,
    contribution: { rearDelt: 1, traps: 0.5, back: 0.25 },
    jointStress: { shoulder: 0.25, elbow: 0.2 },
  },
  {
    id: 'reverse-pec-deck',
    name: '리버스 펙덱', nameEn: 'Reverse Pec Deck',
    equipment: 'machine', pattern: 'isolation', increment: 5,
    contribution: { rearDelt: 1, traps: 0.3 },
    jointStress: { shoulder: 0.2 },
  },

  // ── 스쿼트 / 런지 ──────────────────────────────────────────
  {
    id: 'back-squat',
    name: '백 스쿼트', nameEn: 'Back Squat',
    equipment: 'barbell', pattern: 'squat', increment: 5,
    contribution: { quads: 1, glutes: 0.7, hamstrings: 0.3, abs: 0.4, calves: 0.25 },
    jointStress: { knee: 0.75, lowBack: 0.7, hip: 0.5, ankle: 0.5, shoulder: 0.3 },
  },
  {
    id: 'hack-squat',
    name: '핵 스쿼트', nameEn: 'Hack Squat',
    equipment: 'machine', pattern: 'squat', increment: 10,
    contribution: { quads: 1, glutes: 0.5, hamstrings: 0.25 },
    jointStress: { knee: 0.7, lowBack: 0.2, hip: 0.35, ankle: 0.4 },
  },
  {
    id: 'leg-press',
    name: '레그프레스', nameEn: 'Leg Press',
    equipment: 'machine', pattern: 'squat', increment: 10,
    contribution: { quads: 1, glutes: 0.6, hamstrings: 0.25 },
    jointStress: { knee: 0.5, lowBack: 0.15, hip: 0.3 },
  },
  {
    id: 'goblet-squat',
    name: '고블릿 스쿼트', nameEn: 'Goblet Squat',
    equipment: 'dumbbell', pattern: 'squat', increment: 2,
    contribution: { quads: 0.9, glutes: 0.5, abs: 0.4 },
    jointStress: { knee: 0.5, lowBack: 0.3, hip: 0.35, ankle: 0.4 },
  },
  {
    id: 'walking-lunge',
    name: '워킹 런지', nameEn: 'Walking Lunge',
    equipment: 'dumbbell', pattern: 'lunge', increment: 2, unilateral: true,
    contribution: { quads: 0.8, glutes: 0.9, hamstrings: 0.4, calves: 0.25 },
    jointStress: { knee: 0.6, hip: 0.4, lowBack: 0.25, ankle: 0.4 },
  },
  {
    id: 'leg-extension',
    name: '레그 익스텐션', nameEn: 'Leg Extension',
    equipment: 'machine', pattern: 'isolation', increment: 5,
    contribution: { quads: 1 },
    jointStress: { knee: 0.55 },
  },

  // ── 힌지 ───────────────────────────────────────────────────
  {
    id: 'conventional-deadlift',
    name: '컨벤셔널 데드리프트', nameEn: 'Conventional Deadlift',
    equipment: 'barbell', pattern: 'hinge', increment: 5,
    contribution: { hamstrings: 0.9, glutes: 1, back: 0.7, traps: 0.5, forearms: 0.5, quads: 0.3 },
    jointStress: { lowBack: 0.95, hip: 0.6, knee: 0.35, wrist: 0.3 },
  },
  {
    id: 'romanian-deadlift',
    name: '루마니안 데드리프트', nameEn: 'Romanian Deadlift',
    equipment: 'barbell', pattern: 'hinge', increment: 2.5,
    contribution: { hamstrings: 1, glutes: 0.8, back: 0.4, forearms: 0.4 },
    jointStress: { lowBack: 0.8, hip: 0.5, knee: 0.15 },
  },
  {
    id: 'hip-thrust',
    name: '힙 쓰러스트', nameEn: 'Hip Thrust',
    equipment: 'barbell', pattern: 'hinge', increment: 5,
    contribution: { glutes: 1, hamstrings: 0.5, quads: 0.25 },
    jointStress: { hip: 0.35, lowBack: 0.25, knee: 0.2 },
  },
  {
    id: 'lying-leg-curl',
    name: '라잉 레그컬', nameEn: 'Lying Leg Curl',
    equipment: 'machine', pattern: 'isolation', increment: 5,
    contribution: { hamstrings: 1, calves: 0.25 },
    jointStress: { knee: 0.35, lowBack: 0.15 },
  },
  {
    id: 'back-extension',
    name: '백 익스텐션', nameEn: 'Back Extension',
    equipment: 'bodyweight', pattern: 'hinge', increment: 2.5,
    contribution: { glutes: 0.7, hamstrings: 0.7, back: 0.5 },
    jointStress: { lowBack: 0.45, hip: 0.3 },
  },

  // ── 팔 / 어깨 고립 ────────────────────────────────────────
  {
    id: 'lateral-raise',
    name: '레터럴 레이즈', nameEn: 'Lateral Raise',
    equipment: 'dumbbell', pattern: 'isolation', increment: 1,
    contribution: { sideDelt: 1, traps: 0.25 },
    jointStress: { shoulder: 0.4, elbow: 0.15 },
  },
  {
    id: 'cable-lateral-raise',
    name: '케이블 레터럴 레이즈', nameEn: 'Cable Lateral Raise',
    equipment: 'cable', pattern: 'isolation', increment: 2.5, unilateral: true,
    contribution: { sideDelt: 1 },
    jointStress: { shoulder: 0.3 },
  },
  {
    id: 'barbell-curl',
    name: '바벨 컬', nameEn: 'Barbell Curl',
    equipment: 'barbell', pattern: 'isolation', increment: 2.5,
    contribution: { biceps: 1, forearms: 0.4 },
    jointStress: { elbow: 0.45, wrist: 0.45 },
  },
  {
    id: 'incline-dumbbell-curl',
    name: '인클라인 덤벨컬', nameEn: 'Incline Dumbbell Curl',
    equipment: 'dumbbell', pattern: 'isolation', increment: 1,
    contribution: { biceps: 1, forearms: 0.3 },
    jointStress: { elbow: 0.35, shoulder: 0.25, wrist: 0.2 },
  },
  {
    id: 'hammer-curl',
    name: '해머 컬', nameEn: 'Hammer Curl',
    equipment: 'dumbbell', pattern: 'isolation', increment: 1,
    contribution: { biceps: 0.8, forearms: 0.8 },
    jointStress: { elbow: 0.3, wrist: 0.15 },
  },
  {
    id: 'triceps-pushdown',
    name: '트라이셉스 푸시다운', nameEn: 'Triceps Pushdown',
    equipment: 'cable', pattern: 'isolation', increment: 2.5,
    contribution: { triceps: 1 },
    jointStress: { elbow: 0.35, wrist: 0.2 },
  },
  {
    id: 'overhead-cable-extension',
    name: '오버헤드 케이블 익스텐션', nameEn: 'Overhead Cable Extension',
    equipment: 'cable', pattern: 'isolation', increment: 2.5,
    contribution: { triceps: 1 },
    jointStress: { elbow: 0.45, shoulder: 0.35 },
  },

  // ── 코어 / 종아리 ─────────────────────────────────────────
  {
    id: 'standing-calf-raise',
    name: '스탠딩 카프레이즈', nameEn: 'Standing Calf Raise',
    equipment: 'machine', pattern: 'isolation', increment: 5,
    contribution: { calves: 1 },
    jointStress: { ankle: 0.4, knee: 0.15 },
  },
  {
    id: 'hanging-leg-raise',
    name: '행잉 레그레이즈', nameEn: 'Hanging Leg Raise',
    equipment: 'bodyweight', pattern: 'core', increment: 2.5,
    contribution: { abs: 1, forearms: 0.3 },
    jointStress: { shoulder: 0.3, lowBack: 0.25 },
  },
  {
    id: 'cable-crunch',
    name: '케이블 크런치', nameEn: 'Cable Crunch',
    equipment: 'cable', pattern: 'core', increment: 2.5,
    contribution: { abs: 1 },
    jointStress: { lowBack: 0.3 },
  },
  {
    id: 'plank',
    name: '플랭크', nameEn: 'Plank',
    equipment: 'bodyweight', pattern: 'core', increment: 0,
    contribution: { abs: 0.8, glutes: 0.25 },
    jointStress: { shoulder: 0.2, lowBack: 0.15 },
  },
];

const BY_ID = new Map(EXERCISES.map((exercise) => [exercise.id, exercise]));

export function exerciseById(id: string): Exercise | undefined {
  return BY_ID.get(id);
}

/** 사용자 정의 운동을 포함한 조회 맵을 만든다. */
export function buildExerciseIndex(extra: readonly Exercise[] = []): Map<string, Exercise> {
  const index = new Map(BY_ID);
  for (const exercise of extra) index.set(exercise.id, exercise);
  return index;
}

export interface ExerciseFilter {
  muscle?: MuscleGroup;
  /** 기본 0.5 — 주동근으로 쓰는 종목만 찾고 싶으면 1로 올린다. */
  minContribution?: number;
  pattern?: MovementPattern;
  /** 헬스장에 있는 기구만 남긴다. */
  availableEquipment?: readonly Exercise['equipment'][];
  /** 이 관절들에 스트레스가 임계 이상인 종목을 제외한다. */
  avoidJoints?: readonly { joint: Joint; maxStress: number }[];
}

export function findExercises(
  filter: ExerciseFilter,
  pool: readonly Exercise[] = EXERCISES,
): Exercise[] {
  const minContribution = filter.minContribution ?? 0.5;

  return pool.filter((exercise) => {
    if (filter.muscle && (exercise.contribution[filter.muscle] ?? 0) < minContribution) return false;
    if (filter.pattern && exercise.pattern !== filter.pattern) return false;
    if (filter.availableEquipment && !filter.availableEquipment.includes(exercise.equipment)) return false;
    if (filter.avoidJoints) {
      for (const rule of filter.avoidJoints) {
        if ((exercise.jointStress[rule.joint] ?? 0) > rule.maxStress) return false;
      }
    }
    return true;
  });
}
