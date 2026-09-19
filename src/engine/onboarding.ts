import { EXERCISES } from './exercises.ts';
import { availableExercises, coverageReport, gymFromCatalog, type GymSelection } from './equipment.ts';
import { assessLevel, levelProfile, type LevelAssessment } from './levels.ts';
import { MUSCLE_GROUPS, MUSCLE_LABELS_KO, landmarksFor } from './muscles.ts';
import { screenExercise } from './pain.ts';
import type { LifterProfile } from './strength.ts';
import type { SessionSlot, SessionTemplate } from './session.ts';
import type { Phase, WeeklyPlan } from './mesocycle.ts';
import type {
  Exercise,
  Joint,
  MovementPattern,
  MuscleGroup,
  PainReport,
  TrainingLevel,
} from './types.ts';
import { planGoals, repRangeForGoals, type TrainingGoal } from './goals.ts';


export interface OnboardingAnswers {
  /** 설문에서 사용자가 고른 단계 */
  selfReportedLevel: TrainingLevel;
  /** 꾸준히 훈련한 개월 수 — 자가 신고 검증에 쓴다 */
  monthsTraining?: number;
  /**
   * 체중. 이력이 하나도 없는 첫날 중량을 뽑는 유일한 근거이고,
   * 자가 신고한 경력을 실제 기록과 대조하는 데도 쓴다.
   */
  bodyweightKg: number;
  sex?: 'male' | 'female' | 'unspecified';
  /** 주당 운동 일수 (2~7) */
  daysPerWeek: number;
  /**
   * 목표. 여러 개를 고를 수 있다 — "근비대도 하고 근력도 늘리면서 살도 빼고
   * 싶다"가 현장에서 가장 흔한 대답이다. 조합에 따라 반복 범위와 볼륨 상한이
   * 달라진다.
   */
  goals: TrainingGoal[];
  gym: GymSelection;
  /** 기존 통증·부상 */
  pain?: readonly PainReport[];
}

export interface TrainingProgram {
  name: string;
  daysPerWeek: number;
  /**
   * 이 일정으로 기대할 수 있는 것의 한계.
   * 주 1~2회는 부위별 볼륨이 최소 자극선에 못 미치는 경우가 많다.
   * 되는 척하지 않고 무엇이 가능한지 말한다.
   */
  caution?: string;
  /** 주간 순환 템플릿 */
  templates: SessionTemplate[];
  /** 부위별 주간 목표 유효 세트 */
  weeklyTargets: Partial<Record<MuscleGroup, number>>;
}

export interface OnboardingResult {
  level: LevelAssessment;
  lifter: LifterProfile;
  gym: ReturnType<typeof gymFromCatalog>;
  program: TrainingProgram;
  /** 첫 주 처방 — 비교할 이력이 없는 주를 이걸로 채운다 */
  firstWeek: WeeklyPlan;
  /** 사용자에게 보여줄 안내 */
  notes: string[];
}

/* ── 분할 설계 ─────────────────────────────────────────────── */

type SlotRole = 'primary' | 'accessory' | 'isolation';

interface SlotSpec {
  muscle: MuscleGroup;
  role: SlotRole;
  patterns?: MovementPattern[];
}

interface DayBlueprint {
  name: string;
  slots: SlotSpec[];
}

const PUSH: DayBlueprint = {
  name: '푸시',
  slots: [
    { muscle: 'chest', role: 'primary', patterns: ['horizontalPush'] },
    { muscle: 'frontDelt', role: 'primary', patterns: ['verticalPush'] },
    { muscle: 'chest', role: 'accessory', patterns: ['horizontalPush', 'isolation'] },
    { muscle: 'sideDelt', role: 'isolation' },
    { muscle: 'triceps', role: 'isolation' },
    { muscle: 'triceps', role: 'isolation' },
  ],
};

const PULL: DayBlueprint = {
  name: '풀',
  slots: [
    { muscle: 'back', role: 'primary', patterns: ['verticalPull'] },
    { muscle: 'back', role: 'primary', patterns: ['horizontalPull'] },
    { muscle: 'rearDelt', role: 'isolation' },
    { muscle: 'biceps', role: 'isolation' },
    { muscle: 'biceps', role: 'isolation' },
    { muscle: 'abs', role: 'isolation' },
  ],
};

const LEGS: DayBlueprint = {
  name: '레그',
  slots: [
    { muscle: 'quads', role: 'primary', patterns: ['squat'] },
    { muscle: 'hamstrings', role: 'primary', patterns: ['hinge'] },
    { muscle: 'glutes', role: 'accessory', patterns: ['hinge', 'lunge'] },
    { muscle: 'quads', role: 'accessory', patterns: ['squat', 'isolation'] },
    { muscle: 'calves', role: 'isolation' },
  ],
};

const UPPER_A: DayBlueprint = {
  name: '상체 A',
  slots: [
    { muscle: 'chest', role: 'primary', patterns: ['horizontalPush'] },
    { muscle: 'back', role: 'primary', patterns: ['verticalPull'] },
    { muscle: 'chest', role: 'accessory', patterns: ['horizontalPush', 'isolation'] },
    { muscle: 'frontDelt', role: 'accessory', patterns: ['verticalPush'] },
    { muscle: 'biceps', role: 'isolation' },
    { muscle: 'triceps', role: 'isolation' },
  ],
};

const UPPER_B: DayBlueprint = {
  name: '상체 B',
  slots: [
    { muscle: 'back', role: 'primary', patterns: ['horizontalPull'] },
    { muscle: 'chest', role: 'primary', patterns: ['horizontalPush'] },
    { muscle: 'back', role: 'accessory', patterns: ['verticalPull', 'horizontalPull'] },
    { muscle: 'sideDelt', role: 'isolation' },
    { muscle: 'rearDelt', role: 'isolation' },
    { muscle: 'triceps', role: 'isolation' },
  ],
};

const LOWER_A: DayBlueprint = {
  name: '하체 A',
  slots: [
    { muscle: 'quads', role: 'primary', patterns: ['squat'] },
    { muscle: 'hamstrings', role: 'primary', patterns: ['hinge'] },
    { muscle: 'quads', role: 'accessory', patterns: ['squat', 'isolation'] },
    { muscle: 'calves', role: 'isolation' },
    { muscle: 'abs', role: 'isolation' },
  ],
};

const LOWER_B: DayBlueprint = {
  name: '하체 B',
  slots: [
    { muscle: 'glutes', role: 'primary', patterns: ['hinge'] },
    { muscle: 'quads', role: 'primary', patterns: ['squat', 'lunge'] },
    { muscle: 'hamstrings', role: 'accessory', patterns: ['hinge', 'isolation'] },
    { muscle: 'calves', role: 'isolation' },
  ],
};

const FULL_A: DayBlueprint = {
  name: '전신 A',
  slots: [
    { muscle: 'quads', role: 'primary', patterns: ['squat'] },
    { muscle: 'chest', role: 'primary', patterns: ['horizontalPush'] },
    { muscle: 'back', role: 'primary', patterns: ['verticalPull'] },
    { muscle: 'sideDelt', role: 'isolation' },
    { muscle: 'triceps', role: 'isolation' },
  ],
};

const FULL_B: DayBlueprint = {
  name: '전신 B',
  slots: [
    { muscle: 'hamstrings', role: 'primary', patterns: ['hinge'] },
    { muscle: 'frontDelt', role: 'primary', patterns: ['verticalPush'] },
    { muscle: 'back', role: 'primary', patterns: ['horizontalPull'] },
    { muscle: 'chest', role: 'accessory', patterns: ['horizontalPush', 'isolation'] },
    { muscle: 'biceps', role: 'isolation' },
  ],
};

const FULL_C: DayBlueprint = {
  name: '전신 C',
  slots: [
    { muscle: 'glutes', role: 'primary', patterns: ['hinge'] },
    { muscle: 'chest', role: 'primary', patterns: ['horizontalPush'] },
    { muscle: 'back', role: 'primary', patterns: ['verticalPull', 'horizontalPull'] },
    { muscle: 'quads', role: 'accessory', patterns: ['squat', 'lunge', 'isolation'] },
    { muscle: 'calves', role: 'isolation' },
  ],
};

/**
 * 주당 일수별 분할.
 *
 * 부위당 주 2회 이상이 되도록 짠다. "월=가슴, 화=등" 식으로 부위를 주 1회만
 * 도는 분할은 넣지 않았다 — 같은 볼륨이라도 자극이 덜하다는 게 빈도 모듈이
 * 말하는 바이고, 프로그램 생성기가 그 규칙을 어기면 앞뒤가 안 맞는다.
 * 그래서 주 3회도 PPL이 아니라 전신 3회다.
 */
/**
 * 주 7일을 고른 사람을 위한 날.
 *
 * 매일 고강도로 하면 회복이 안 된다. 그래서 7일째는 또 하나의 하드 세션이
 * 아니라 약한 부위를 채우고 관절 부담이 적은 것들로만 채운다 — 이런 날이
 * 있어야 나머지 6일을 제대로 할 수 있다.
 */
const ACCESSORY_DAY: DayBlueprint = {
  name: '보완 · 가벼운 날',
  slots: [
    { muscle: 'rearDelt', role: 'isolation' },
    { muscle: 'sideDelt', role: 'isolation' },
    { muscle: 'traps', role: 'isolation' },
    { muscle: 'forearms', role: 'isolation' },
    { muscle: 'abs', role: 'isolation' },
    { muscle: 'calves', role: 'isolation' },
  ],
};

const SPLITS: Record<number, DayBlueprint[]> = {
  // 주 1회는 늘리기 위한 일정이 아니라 지키기 위한 일정이다. 전신 한 번.
  1: [FULL_A],
  2: [FULL_A, FULL_B],
  3: [FULL_A, FULL_B, FULL_C],
  4: [UPPER_A, LOWER_A, UPPER_B, LOWER_B],
  5: [UPPER_A, LOWER_A, PUSH, PULL, LEGS],
  6: [PUSH, PULL, LEGS, PUSH, PULL, LEGS],
  7: [PUSH, PULL, LEGS, PUSH, PULL, LEGS, ACCESSORY_DAY],
};

const SPLIT_NAMES: Record<number, string> = {
  1: '주 1회 전신',
  2: '주 2회 전신',
  3: '주 3회 전신',
  4: '주 4회 상하체 분할',
  5: '주 5회 혼합 분할',
  6: '주 6회 푸시·풀·레그 2순환',
  7: '주 7회 푸시·풀·레그 2순환 + 보완일',
};

/* ── 종목 선택 ─────────────────────────────────────────────── */

const FREE_WEIGHT: readonly Exercise['equipment'][] = ['barbell', 'dumbbell'];

/** 한 관절에 이만큼 쌓이면 그 세션에서 더 싣지 않는다. */
const JOINT_LOAD_LIMIT = 1.2;

function scoreExercise(
  exercise: Exercise,
  slot: SlotSpec,
  level: TrainingLevel,
  sessionLoad: ReadonlyMap<Joint, number>,
): number {
  const contribution = exercise.contribution[slot.muscle] ?? 0;
  let score = contribution * 10;

  if (slot.patterns?.includes(exercise.pattern)) score += 4;
  if (slot.role === 'isolation' && exercise.pattern === 'isolation') score += 2;
  if (slot.role === 'primary' && exercise.pattern !== 'isolation') score += 2;

  // 메인 자리에는 프리웨이트 복합 동작을 우선한다.
  // 머신으로만 채운 프로그램은 안전해 보이지만 배우는 게 없다.
  if (slot.role === 'primary' && exercise.pattern !== 'isolation' && FREE_WEIGHT.includes(exercise.equipment)) {
    score += 3;
  }

  // 초보자에게는 같은 값이면 관절 부담이 적은 쪽을 고른다.
  // 기본 동작을 밀어낼 만큼 크게 주지는 않는다 — 초보일수록 기본을 배워야 한다.
  if (level === 'beginner') {
    const stress = Object.values(exercise.jointStress).reduce((sum, value) => sum + value, 0);
    score -= Math.min(2, stress * 0.4);
  }

  // 한 세션에서 같은 관절에 최대 부하를 거듭 싣지 않는다.
  // 스쿼트 · RDL 뒤에 데드리프트를 붙이는 구성이 이 규칙 없이 자주 나온다.
  for (const [joint, stress] of Object.entries(exercise.jointStress) as [Joint, number][]) {
    const already = sessionLoad.get(joint) ?? 0;
    if (already >= JOINT_LOAD_LIMIT && stress >= 0.6) score -= stress * 3;
  }

  return score;
}

/**
 * 역할별 한 종목 최대 세트 수.
 *
 * 주간 목표를 슬롯 수로 나누면 한 종목에 7세트가 배정되기도 한다.
 * 현장에서 한 종목 7세트는 뒤 세트가 버려지는 구성이다 — 3~4세트로 끊고,
 * 모자란 볼륨은 주간 처방이 몇 주에 걸쳐 올린다.
 */
const ROLE_SET_CAP: Record<SlotRole, number> = {
  primary: 4,
  accessory: 4,
  isolation: 4,
};

function pickExercise(
  slot: SlotSpec,
  pool: readonly Exercise[],
  used: ReadonlySet<string>,
  level: TrainingLevel,
  sessionLoad: ReadonlyMap<Joint, number>,
): Exercise | undefined {
  const minContribution = slot.role === 'accessory' ? 0.5 : 0.85;

  return pool
    .filter((exercise) => !used.has(exercise.id))
    .filter((exercise) => (exercise.contribution[slot.muscle] ?? 0) >= minContribution)
    .map((exercise) => ({ exercise, score: scoreExercise(exercise, slot, level, sessionLoad) }))
    .sort((a, b) => b.score - a.score)[0]?.exercise;
}

/** 고른 종목의 관절 부하를 세션 누계에 더한다. */
function addJointLoad(load: Map<Joint, number>, exercise: Exercise): void {
  for (const [joint, stress] of Object.entries(exercise.jointStress) as [Joint, number][]) {
    load.set(joint, (load.get(joint) ?? 0) + stress);
  }
}

/* ── 프로그램 생성 ─────────────────────────────────────────── */

export function buildProgram(answers: OnboardingAnswers, level: TrainingLevel): TrainingProgram {
  const profile = levelProfile(level);
  const days = Math.min(7, Math.max(1, Math.round(answers.daysPerWeek)));
  const blueprints = SPLITS[days] ?? SPLITS[4]!;
  const landmarks = landmarksFor(level);

  // 그 헬스장에서 가능하고, 기존 통증으로 막히지 않는 종목만 후보로 둔다.
  const pain = answers.pain ?? [];
  const pool = availableExercises(answers.gym.equipmentIds, EXERCISES).filter(
    (exercise) => screenExercise(exercise, pain).action !== 'stop',
  );

  // 부위별로 주에 몇 개의 슬롯이 배정되는지 먼저 센다 — 세트 수 계산의 분모다.
  const slotCount = new Map<MuscleGroup, number>();
  for (const day of blueprints) {
    for (const slot of day.slots) {
      slotCount.set(slot.muscle, (slotCount.get(slot.muscle) ?? 0) + 1);
    }
  }

  const weeklyTargets: Partial<Record<MuscleGroup, number>> = {};
  const templates: SessionTemplate[] = [];
  const usedThisWeek = new Set<string>();

  blueprints.forEach((day, dayIndex) => {
    const usedToday = new Set<string>();
    const sessionLoad = new Map<Joint, number>();
    const slots: SessionSlot[] = [];

    for (const slot of day.slots) {
      // 주 안에서 종목이 겹치지 않게 하되, 후보가 마르면 재사용을 허용한다.
      const exercise =
        pickExercise(slot, pool, new Set([...usedToday, ...usedThisWeek]), level, sessionLoad) ??
        pickExercise(slot, pool, usedToday, level, sessionLoad);
      if (!exercise) continue;

      usedToday.add(exercise.id);
      usedThisWeek.add(exercise.id);
      addJointLoad(sessionLoad, exercise);

      const target = landmarks[slot.muscle].mev;
      const divisor = Math.max(1, slotCount.get(slot.muscle) ?? 1);
      const cap = Math.min(ROLE_SET_CAP[slot.role], profile.perSessionCap);
      weeklyTargets[slot.muscle] = target;

      const floor = slot.role === 'primary' ? 3 : 2;
      slots.push({
        exerciseId: exercise.id,
        sets: clamp(Math.ceil(target / divisor), floor, cap),
        repRange: repRangeForGoals(slot.role, answers.goals),
      });
    }

    // 같은 이름의 날이 두 번 나오면 (주 6회) 번호를 붙인다.
    const duplicate = blueprints.findIndex((other) => other.name === day.name) !== dayIndex;
    templates.push({ name: duplicate ? `${day.name} 2` : day.name, slots });
  });

  return {
    name: SPLIT_NAMES[days] ?? `주 ${days}회 분할`,
    daysPerWeek: days,
    caution: cautionFor(days, weeklyTargets, landmarks),
    templates,
    weeklyTargets,
  };
}

/**
 * 이 일정의 한계를 그대로 말한다.
 *
 * 주 1~2회로는 대부분의 부위가 최소 자극선(MEV)에 닿지 않는다. 그걸 숨기고
 * "훌륭한 프로그램입니다"라고 하면 몇 달 뒤에 사용자가 앱을 탓하게 된다.
 * 무엇이 되고 무엇이 안 되는지 처음에 말해야 한다.
 */
function cautionFor(
  days: number,
  targets: Partial<Record<MuscleGroup, number>>,
  landmarks: ReturnType<typeof landmarksFor>,
): string | undefined {
  const below = MUSCLE_GROUPS.filter((muscle) => {
    const mev = landmarks[muscle].mev;
    return mev > 0 && (targets[muscle] ?? 0) < mev;
  });

  if (days === 1) {
    return '주 1회는 근육을 늘리기보다 지키는 일정입니다. 전신을 한 번에 돌려 ' +
      '빠지는 부위가 없게 짰지만, 부위별 볼륨은 최소 자극선에 못 미칩니다. ' +
      '늘리는 것이 목표라면 주 2회부터가 현실적입니다.';
  }

  if (below.length >= 6) {
    return `주 ${days}회로는 ${below.slice(0, 3).map((muscle) => MUSCLE_LABELS_KO[muscle]).join(', ')} 등 ` +
      `${below.length}개 부위가 최소 자극선에 닿지 않습니다. 하루를 더 낼 수 있으면 크게 달라집니다.`;
  }

  return undefined;
}

/* ── 온보딩 전체 ───────────────────────────────────────────── */

/**
 * 설문 답변 하나로 첫 프로그램까지 만든다.
 *
 * 순서가 중요하다. 단계를 먼저 확정하고(과대 신고 보정 포함), 그 단계의
 * 볼륨 랜드마크로 세트 수를 정하고, 마지막에 그 헬스장에 있는 종목으로만 채운다.
 */
export function runOnboarding(answers: OnboardingAnswers): OnboardingResult {
  const level = assessLevel({
    selfReported: answers.selfReportedLevel,
    monthsTraining: answers.monthsTraining,
    bodyweightKg: answers.bodyweightKg,
  });

  const profile = levelProfile(level.level);
  const gym = gymFromCatalog(answers.gym);
  const program = buildProgram(answers, level.level);
  const notes: string[] = [];

  if (level.adjusted) notes.push(level.note);

  notes.push(
    `${program.name} · ${profile.label} 볼륨으로 시작합니다. ` +
      `${profile.accumulationWeeks}주 축적 후 디로드가 들어갑니다.`,
  );

  const gaps = coverageReport(answers.gym.equipmentIds).filter((item) => !item.sufficient);
  if (gaps.length > 0) {
    const named = gaps.slice(0, 3).map((gap) => MUSCLE_LABELS_KO[gap.muscle]).join(', ');
    notes.push(`${named} 종목이 부족합니다. 헬스장에 있는 기구를 더 추가하면 프로그램이 채워집니다.`);
  }

  if ((answers.pain ?? []).some((report) => report.score >= 3)) {
    notes.push('보고한 통증 부위에 부담이 큰 종목은 프로그램에서 제외했습니다.');
  }

  return {
    level,
    lifter: {
      bodyweightKg: answers.bodyweightKg,
      level: level.level,
      sex: answers.sex,
    },
    gym,
    program,
    firstWeek: firstWeekPlan(program, profile.startingRir),
    notes,
  };
}

/** 비교할 이력이 없는 첫 주의 처방. */
export function firstWeekPlan(program: TrainingProgram, targetRir: number): WeeklyPlan {
  const phase: Phase = 'accumulation';
  return {
    weekStart: '',
    phase,
    weekInBlock: 1,
    targetRir,
    intensityMultiplier: 1,
    fatigue: { score: 0, threshold: 5, deloadRecommended: false, signals: [] },
    volume: [],
    neglected: [],
    frequency: [],
    summary: `${program.name} 1주차 — 기준선을 잡는 주입니다. 목표 RIR ${targetRir}로 여유 있게 수행하세요.`,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
