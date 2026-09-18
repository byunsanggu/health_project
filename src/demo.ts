/**
 * 6주 블록 시뮬레이션.
 *
 * 가상의 중급자를 주 4회 훈련시키면서 엔진이 실제로 한 바퀴 도는지 확인한다.
 *   기록 → 볼륨 집계 → 피로 판정 → 다음 주 처방 → 세션 생성
 *
 * 실행: node src/demo.ts
 */
import {
  DEFAULT_GYM,
  addDays,
  buildExerciseIndex,
  buildSession,
  landmarksFor,
  planNextWeek,
  volumeReport,
  weekStart,
  type CheckIn,
  type LifterProfile,
  type PainReport,
  type PlannedSession,
  type SessionLog,
  type SessionTemplate,
  type SetLog,
  type WeeklyPlan,
  describePlates,
} from './engine/index.ts';

const index = buildExerciseIndex();
const landmarks = landmarksFor('intermediate');
const gym = DEFAULT_GYM;
const lifter: LifterProfile = { bodyweightKg: 78, level: 'intermediate', sex: 'male' };

const TEMPLATES: SessionTemplate[] = [
  {
    name: '상체 A',
    slots: [
      { exerciseId: 'barbell-bench-press', sets: 4, repRange: { min: 6, max: 10 } },
      { exerciseId: 'lat-pulldown', sets: 4, repRange: { min: 8, max: 12 } },
      { exerciseId: 'seated-dumbbell-press', sets: 3, repRange: { min: 8, max: 12 } },
      { exerciseId: 'barbell-curl', sets: 3, repRange: { min: 8, max: 12 } },
    ],
  },
  {
    name: '하체 A',
    slots: [
      { exerciseId: 'back-squat', sets: 4, repRange: { min: 5, max: 8 } },
      { exerciseId: 'romanian-deadlift', sets: 3, repRange: { min: 8, max: 12 } },
      { exerciseId: 'leg-press', sets: 3, repRange: { min: 10, max: 15 } },
      { exerciseId: 'standing-calf-raise', sets: 3, repRange: { min: 10, max: 15 } },
    ],
  },
  {
    name: '상체 B',
    slots: [
      { exerciseId: 'chest-supported-row', sets: 4, repRange: { min: 8, max: 12 } },
      { exerciseId: 'incline-dumbbell-press', sets: 3, repRange: { min: 8, max: 12 } },
      { exerciseId: 'lateral-raise', sets: 4, repRange: { min: 12, max: 20 } },
      { exerciseId: 'triceps-pushdown', sets: 3, repRange: { min: 10, max: 15 } },
    ],
  },
  {
    name: '하체 B',
    slots: [
      { exerciseId: 'hip-thrust', sets: 4, repRange: { min: 8, max: 12 } },
      { exerciseId: 'lying-leg-curl', sets: 3, repRange: { min: 10, max: 15 } },
      { exerciseId: 'walking-lunge', sets: 3, repRange: { min: 10, max: 15 } },
      { exerciseId: 'cable-crunch', sets: 3, repRange: { min: 12, max: 20 } },
    ],
  },
];

/** 종목별 시작 중량 (첫 수행 시 사용자가 입력했다고 가정). */
const STARTING_WEIGHT: Record<string, number> = {
  'barbell-bench-press': 80, 'lat-pulldown': 65, 'seated-dumbbell-press': 22,
  'barbell-curl': 35, 'back-squat': 110, 'romanian-deadlift': 90,
  'leg-press': 160, 'standing-calf-raise': 80, 'chest-supported-row': 70,
  'incline-dumbbell-press': 26, 'lateral-raise': 10, 'triceps-pushdown': 35,
  'hip-thrust': 100, 'lying-leg-curl': 45, 'walking-lunge': 20, 'cable-crunch': 40,
};

/**
 * 세션 수행을 시뮬레이션한다.
 * 피로가 쌓일수록 목표 반복을 덜 채우고 RIR도 떨어진다 — 실제로 관찰되는 패턴이다.
 */
function performSession(planned: PlannedSession, fatigue: number): SessionLog {
  const sets: SetLog[] = [];

  for (const item of planned.exercises) {
    const fallback = STARTING_WEIGHT[item.exercise.id] ?? 40;

    item.sets.forEach((set, order) => {
      const weightKg = set.weightKg ?? fallback;
      // 세트가 진행될수록, 피로가 쌓일수록 수행이 떨어진다.
      const decay = fatigue * 0.9 + order * 0.4;
      const reps = clamp(Math.round(set.targetReps.max - decay), 3, set.targetReps.max);
      const rir = clamp(Math.round(set.targetRir - fatigue * 0.7), 0, 5);
      sets.push({ exerciseId: item.exercise.id, weightKg, reps, rir });
    });
  }

  return { date: planned.date, sets };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function run(): void {
  const history: SessionLog[] = [];
  const checkIns: CheckIn[] = [];
  let weekInBlock = 1;
  let fatigue = 0;
  let lastWeekPhase: WeeklyPlan['phase'] = 'accumulation';
  let mondayOf = weekStart('2026-09-14');

  for (let week = 1; week <= 6; week += 1) {
    // 3주차부터 어깨 통증이 생기는 시나리오
    const pain: PainReport[] = week >= 3 && week <= 4 ? [{ joint: 'shoulder', score: 4 }] : [];

    const plan: WeeklyPlan =
      week === 1
        ? coldStartPlan(mondayOf)
        : planNextWeek({
            sessions: history,
            checkIns,
            index,
            landmarks,
            asOf: addDays(mondayOf, -1),
            weekInBlock,
            lastWeekPhase,
          });

    weekInBlock = plan.phase === 'deload' ? 0 : plan.weekInBlock;
    lastWeekPhase = plan.phase;
    if (plan.phase === 'deload') fatigue = 0;

    printWeekHeader(week, mondayOf, plan);

    // 주 4회: 월/화/목/금
    const trainingDays = [0, 1, 3, 4];
    trainingDays.forEach((offset, i) => {
      const date = addDays(mondayOf, offset);
      const template = TEMPLATES[i % TEMPLATES.length]!;
      const planned = buildSession({ template, date, plan, history, index, pain, gym, lifter });
      history.push(performSession(planned, fatigue));

      if (i === 0) printSessionSample(planned);

      checkIns.push({
        date,
        sleepHours: 7 - fatigue * 0.4,
        soreness: Math.min(10, 3 + fatigue * 1.5),
        motivation: Math.max(1, 8 - fatigue),
        pain,
      });
    });

    printVolume(history, mondayOf);

    if (plan.phase !== 'deload') fatigue += 0.7;
    mondayOf = addDays(mondayOf, 7);
  }
}

/** 첫 주에는 비교할 이력이 없다. 실제 앱에서는 온보딩 설문으로 대체한다. */
function coldStartPlan(monday: string): WeeklyPlan {
  return {
    weekStart: monday,
    phase: 'accumulation',
    weekInBlock: 1,
    targetRir: 3,
    intensityMultiplier: 1,
    fatigue: { score: 0, threshold: 5, deloadRecommended: false, signals: [] },
    volume: [],
    neglected: [],
    frequency: [],
    summary: '첫 주: 템플릿 그대로 수행하며 기준선을 잡습니다',
  };
}

function printWeekHeader(week: number, monday: string, plan: WeeklyPlan): void {
  const phase = plan.phase === 'deload' ? '디로드' : `축적 ${plan.weekInBlock}주차`;
  console.log(`\n${'━'.repeat(72)}`);
  console.log(`${week}주차 (${monday} ~)  ·  ${phase}  ·  목표 RIR ${plan.targetRir}  ·  피로 점수 ${plan.fatigue.score}`);
  console.log('━'.repeat(72));
  console.log(`처방: ${plan.summary}`);
  for (const signal of plan.fatigue.signals) {
    console.log(`  ⚠ ${signal.label} (+${signal.weight})`);
  }
  for (const item of plan.frequency) {
    console.log(`  ↹ ${item.label}: ${item.advice}`);
  }
}

function printSessionSample(planned: PlannedSession): void {
  console.log(`\n  [${planned.name}] ${planned.date}`);
  for (const warning of planned.warnings) console.log(`  ⚠ [${warning.kind}] ${warning.text}`);
  for (const item of planned.exercises) {
    const weight = item.sets[0]?.weightKg;
    const label = item.substitutedFrom ? `${item.exercise.name} (← ${item.substitutedFrom.name})` : item.exercise.name;
    const load = weight === null || weight === undefined ? '중량 미정' : `${weight}kg`;
    const reps = item.sets[0]!.targetReps;
    const repText = reps.min === reps.max ? `${reps.max}회` : `${reps.min}~${reps.max}회`;
    const plates = item.plates ? `  (${describePlates(item.plates)})` : '';
    console.log(`    ${label.padEnd(30)} ${item.sets.length}세트 × ${repText}  ${load}${plates}`);
    if (item.note.includes('참고:')) console.log(`      ${item.note.split(' · ').find((p) => p.startsWith('참고:'))}`);
  }
}

function printVolume(history: readonly SessionLog[], monday: string): void {
  const thisWeek = history.filter((s) => s.date >= monday && s.date <= addDays(monday, 6));
  const report = volumeReport(thisWeek, landmarks, index)
    .filter((item) => item.effectiveSets > 0)
    .sort((a, b) => b.effectiveSets - a.effectiveSets)
    .slice(0, 6);

  console.log('\n  주간 볼륨 (유효 세트)');
  for (const item of report) {
    const bar = gauge(item.effectiveSets, item.landmark.mrv);
    const marks = `MEV ${item.landmark.mev} / MAV ${item.landmark.mav} / MRV ${item.landmark.mrv}`;
    console.log(
      `    ${labelOf(item.muscle).padEnd(12)} ${String(item.effectiveSets).padStart(5)} ${bar} ${item.zoneLabel.padEnd(4)} (${marks})`,
    );
  }
}

function labelOf(muscle: string): string {
  return MUSCLE_LABELS[muscle] ?? muscle;
}

const MUSCLE_LABELS: Record<string, string> = {
  chest: '가슴', back: '등', frontDelt: '전면삼각근', sideDelt: '측면삼각근',
  rearDelt: '후면삼각근', traps: '승모근', biceps: '이두', triceps: '삼두',
  forearms: '전완', quads: '대퇴사두', hamstrings: '햄스트링', glutes: '둔근',
  calves: '종아리', abs: '복근',
};

function gauge(value: number, max: number, width = 20): string {
  const filled = clamp(Math.round((value / max) * width), 0, width);
  return `[${'█'.repeat(filled)}${'·'.repeat(width - filled)}]`;
}

run();
