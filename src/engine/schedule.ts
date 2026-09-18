import { levelProfile } from './levels.ts';
import { MUSCLE_GROUPS, MUSCLE_LABELS_KO } from './muscles.ts';
import type { SessionTemplate } from './session.ts';
import type { Exercise, MuscleGroup, TrainingLevel } from './types.ts';

/** 월요일이 0. */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export const WEEKDAY_LABELS_KO: readonly string[] = ['월', '화', '수', '목', '금', '토', '일'];

export interface ScheduledSession {
  weekday: Weekday;
  label: string;
  templateIndex: number;
  templateName: string;
  /** 직전 훈련일과 며칠 떨어져 있는가 */
  gapDays: number;
}

export interface WeekSchedule {
  daysPerWeek: number;
  sessions: ScheduledSession[];
  restDays: Weekday[];
  /** 부위별 주간 빈도 */
  muscleFrequency: { muscle: MuscleGroup; label: string; sessions: number }[];
  notes: string[];
  warnings: string[];
}

/**
 * 주당 일수별 기본 배치.
 * 훈련일을 붙여 놓지 않고 한 주에 고르게 펴는 것이 회복에 유리하다.
 */
const PATTERNS: Record<number, Weekday[]> = {
  1: [0],
  2: [0, 3],
  3: [0, 2, 4],
  4: [0, 1, 3, 4],
  5: [0, 1, 2, 4, 5],
  6: [0, 1, 2, 3, 4, 5],
};

export interface ScheduleInput {
  templates: readonly SessionTemplate[];
  daysPerWeek?: number;
  level?: TrainingLevel;
  /** 훈련이 가능한 요일. 주면 이 안에서 가장 고르게 펴진 조합을 고른다 */
  availableWeekdays?: readonly Weekday[];
  index: ReadonlyMap<string, Exercise>;
}

/**
 * 주간 스케줄을 설계한다.
 *
 * 요일 배치와 세션 순서를 따로 푸는 게 아니라 같이 푼다.
 * 같은 부위를 이틀 연속으로 때리면 회복이 안 되는데, 그건 요일만 봐서도
 * 세션 내용만 봐서도 알 수 없기 때문이다.
 */
export function buildSchedule(input: ScheduleInput): WeekSchedule {
  const templates = input.templates;
  const daysPerWeek = clamp(input.daysPerWeek ?? templates.length, 1, 6);
  const level = input.level ?? 'intermediate';
  const weekdays = pickWeekdays(daysPerWeek, input.availableWeekdays);

  const profiles = templates.map((template) => muscleProfile(template, input.index));
  const order = bestOrder(profiles, weekdays);

  const sessions: ScheduledSession[] = weekdays.map((weekday, i) => {
    const templateIndex = order[i % order.length]!;
    const previous = i === 0 ? weekdays[weekdays.length - 1]! - 7 : weekdays[i - 1]!;
    return {
      weekday,
      label: WEEKDAY_LABELS_KO[weekday]!,
      templateIndex,
      templateName: templates[templateIndex]?.name ?? `세션 ${templateIndex + 1}`,
      gapDays: weekday - previous,
    };
  });

  const restDays = ([0, 1, 2, 3, 4, 5, 6] as Weekday[]).filter(
    (day) => !weekdays.includes(day),
  );

  const warnings = collectWarnings(sessions, profiles, weekdays, level);
  const muscleFrequency = countFrequency(sessions, profiles);

  const notes = [
    `주 ${daysPerWeek}회 · ${sessions.map((s) => s.label).join(' · ')} 훈련, ` +
      `${restDays.map((day) => WEEKDAY_LABELS_KO[day]).join(' · ')} 휴식`,
  ];

  const twicePlus = muscleFrequency.filter((item) => item.sessions >= 2).length;
  if (twicePlus > 0) {
    notes.push(`주요 부위 ${twicePlus}개가 주 2회 이상 자극됩니다.`);
  }

  return { daysPerWeek, sessions, restDays, muscleFrequency, notes, warnings };
}

/** 부위별 직접 세트 수. 세션이 어디를 때리는지 요약한다. */
function muscleProfile(
  template: SessionTemplate,
  index: ReadonlyMap<string, Exercise>,
): Map<MuscleGroup, number> {
  const profile = new Map<MuscleGroup, number>();
  for (const slot of template.slots) {
    const exercise = index.get(slot.exerciseId);
    if (!exercise) continue;
    for (const muscle of MUSCLE_GROUPS) {
      const contribution = exercise.contribution[muscle] ?? 0;
      if (contribution < 0.85) continue;
      profile.set(muscle, (profile.get(muscle) ?? 0) + slot.sets);
    }
  }
  return profile;
}

/** 가능한 요일 중 가장 고르게 펴진 조합. */
function pickWeekdays(days: number, available?: readonly Weekday[]): Weekday[] {
  const pattern = PATTERNS[days] ?? PATTERNS[4]!;
  if (!available || available.length === 0) return pattern;
  if (available.length <= days) return [...available].sort((a, b) => a - b);

  let best: Weekday[] | null = null;
  let bestScore = -Infinity;

  for (const combo of combinations([...available].sort((a, b) => a - b), days)) {
    const score = spacingScore(combo);
    if (score > bestScore) {
      bestScore = score;
      best = combo;
    }
  }
  return best ?? pattern;
}

/** 훈련일 간격의 최솟값을 키우고, 연속 훈련일을 줄이는 쪽이 좋은 배치다. */
function spacingScore(days: readonly Weekday[]): number {
  if (days.length <= 1) return 10;
  const gaps: number[] = [];
  for (let i = 1; i < days.length; i += 1) gaps.push(days[i]! - days[i - 1]!);
  gaps.push(7 - days[days.length - 1]! + days[0]!);

  const min = Math.min(...gaps);
  const consecutive = gaps.filter((gap) => gap === 1).length;
  return min * 10 - consecutive;
}

/** 이웃한 훈련일이 같은 부위를 때리지 않도록 세션 순서를 고른다. */
function bestOrder(
  profiles: readonly Map<MuscleGroup, number>[],
  weekdays: readonly Weekday[],
): number[] {
  const n = profiles.length;
  if (n <= 1) return [0];

  let best: number[] | null = null;
  let bestCost = Infinity;

  for (const order of permutations([...Array(n).keys()])) {
    let cost = 0;
    for (let i = 0; i < weekdays.length; i += 1) {
      const current = profiles[order[i % n]!]!;
      const nextIndex = (i + 1) % weekdays.length;
      const next = profiles[order[nextIndex % n]!]!;
      const gap = nextIndex === 0
        ? 7 - weekdays[i]! + weekdays[0]!
        : weekdays[nextIndex]! - weekdays[i]!;

      // 간격이 좁을수록 겹침의 대가가 크다.
      if (gap >= 3) continue;
      cost += overlap(current, next) * (gap === 1 ? 3 : 1);
    }
    if (cost < bestCost) {
      bestCost = cost;
      best = order;
    }
    if (bestCost === 0) break;
  }
  return best ?? [...Array(n).keys()];
}

function overlap(a: Map<MuscleGroup, number>, b: Map<MuscleGroup, number>): number {
  let total = 0;
  for (const [muscle, sets] of a) total += Math.min(sets, b.get(muscle) ?? 0);
  return total;
}

function collectWarnings(
  sessions: readonly ScheduledSession[],
  profiles: readonly Map<MuscleGroup, number>[],
  weekdays: readonly Weekday[],
  level: TrainingLevel,
): string[] {
  const warnings: string[] = [];
  const maxStreak = level === 'beginner' ? 2 : 3;

  let streak = 1;
  let worst = 1;
  for (let i = 1; i < weekdays.length; i += 1) {
    streak = weekdays[i]! - weekdays[i - 1]! === 1 ? streak + 1 : 1;
    worst = Math.max(worst, streak);
  }
  if (worst > maxStreak) {
    warnings.push(
      `${worst}일 연속 훈련입니다. ${levelProfile(level).label} 단계에서는 ${maxStreak}일까지 권합니다.`,
    );
  }

  for (let i = 1; i < sessions.length; i += 1) {
    if (sessions[i]!.gapDays > 1) continue;
    const shared = overlap(profiles[sessions[i - 1]!.templateIndex]!, profiles[sessions[i]!.templateIndex]!);
    if (shared >= 4) {
      warnings.push(
        `${sessions[i - 1]!.label}·${sessions[i]!.label} 연속으로 같은 부위가 겹칩니다. 하루 띄우는 편이 낫습니다.`,
      );
    }
  }
  return warnings;
}

function countFrequency(
  sessions: readonly ScheduledSession[],
  profiles: readonly Map<MuscleGroup, number>[],
): { muscle: MuscleGroup; label: string; sessions: number }[] {
  const counts = new Map<MuscleGroup, number>();
  for (const session of sessions) {
    for (const [muscle] of profiles[session.templateIndex] ?? new Map()) {
      counts.set(muscle, (counts.get(muscle) ?? 0) + 1);
    }
  }
  return [...counts]
    .map(([muscle, count]) => ({ muscle, label: MUSCLE_LABELS_KO[muscle], sessions: count }))
    .sort((a, b) => b.sessions - a.sessions);
}

/* ── 조합 도우미 ───────────────────────────────────────── */

function* combinations<T>(items: readonly T[], size: number): Generator<T[]> {
  if (size === 0) {
    yield [];
    return;
  }
  for (let i = 0; i <= items.length - size; i += 1) {
    for (const rest of combinations(items.slice(i + 1), size - 1)) {
      yield [items[i]!, ...rest];
    }
  }
}

function* permutations<T>(items: readonly T[]): Generator<T[]> {
  if (items.length <= 1) {
    yield [...items];
    return;
  }
  for (let i = 0; i < items.length; i += 1) {
    const rest = [...items.slice(0, i), ...items.slice(i + 1)];
    for (const tail of permutations(rest)) yield [items[i]!, ...tail];
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
