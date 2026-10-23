import { MUSCLE_LABELS_KO } from './muscles.ts';
import { withParticle } from './korean.ts';
import { volumeReport } from './volume.ts';
import type { RepRange } from './load.ts';
import type { TrainingProgram } from './onboarding.ts';
import type { SessionTemplate } from './session.ts';
import type {
  Exercise,
  LandmarksByMuscle,
  MuscleGroup,
  SessionLog,
  VolumeLandmark,
  VolumeZone,
} from './types.ts';

/**
 * 내 루틴 — 사용자가 직접 짠 주간 루틴.
 *
 * 앱이 짠 프로그램은 블록마다 보조 종목을 바꿔 끼우고, 주간 처방대로 세트를 늘렸다
 * 줄였다 한다. 이미 하던 루틴이 있는 사람에게 그건 "앱이 말을 안 듣는다"다. 내 루틴은
 * 종목 · 세트 · 반복 범위를 정한 대로 두고, 무게와 횟수만 기록을 보고 올린다(앱 프로그램과
 * 같은 규칙). 덜어내는 주에는 세트를 절반으로 — 회복은 루틴이어도 지킨다.
 *
 * 대신 모자라거나 넘치는 부위는 숨기지 않고 말한다(reviewRoutine). 고치는 건 사용자다.
 */

export interface RoutineSlot {
  exerciseId: string;
  sets: number;
  repRange: RepRange;
}

export interface RoutineDay {
  /** 예: '가슴 · 삼두' */
  name: string;
  slots: RoutineSlot[];
}

export interface CustomRoutine {
  /** 한 주에 도는 날. 날 수가 곧 주 몇 회다 */
  days: RoutineDay[];
  /** 마지막으로 고친 때 (ISO) */
  updatedAt?: string;
}

export const ROUTINE_NAME = '내 루틴';
export const ROUTINE_MAX_DAYS = 7;
/** 하루 종목 수 상한 — 그 이상은 입력 실수다 */
export const ROUTINE_MAX_LIFTS = 12;
export const ROUTINE_MAX_SETS = 10;
export const ROUTINE_DAY_NAME_MAX = 16;

/** 고를 수 있는 반복 범위 — 앱 프로그램이 쓰는 것과 같다 */
export const ROUTINE_REP_RANGES: readonly RepRange[] = [
  { min: 4, max: 6 },
  { min: 6, max: 10 },
  { min: 8, max: 12 },
  { min: 10, max: 15 },
  { min: 12, max: 20 },
];

/**
 * 하루 세트가 이보다 많으면 길다고 말한다. 세트당 쉬는 시간까지 3~4분이면 25세트가
 * 1시간 반 안팎이다 — 그 뒤로는 세트 질이 떨어진다.
 */
export const ROUTINE_LONG_DAY_SETS = 25;

/**
 * 랜드마크는 사람들 평균에서 온 기준선이다. 한두 세트 차이를 "모자란다"고 하면
 * 잔소리가 된다 — 최소보다 15% 넘게 모자라거나, 한계를 10% 넘게 넘을 때만 말한다.
 */
const UNDER_MARGIN = 0.85;
const OVER_MARGIN = 1.1;

function isIsolation(exercise: Exercise): boolean {
  return exercise.pattern === 'isolation' || exercise.pattern === 'core';
}

/** 종목에 맞는 기본 반복 범위 — 고립은 10~15, 나머지는 8~12. */
export function defaultRepRange(exercise: Exercise): RepRange {
  return isIsolation(exercise) ? { min: 10, max: 15 } : { min: 8, max: 12 };
}

/** 새로 넣는 종목 — 3세트, 종목에 맞는 반복 범위. */
export function routineSlotFor(exercise: Exercise): RoutineSlot {
  return { exerciseId: exercise.id, sets: 3, repRange: defaultRepRange(exercise) };
}

/** 지금 프로그램을 그대로 옮겨 적는다 — 처음부터 짜지 않고 고쳐 쓰게. */
export function routineFromProgram(program: TrainingProgram): CustomRoutine {
  return {
    days: program.templates.map((template) => ({
      name: template.name,
      slots: template.slots.map((slot) => ({
        exerciseId: slot.exerciseId,
        sets: slot.sets,
        repRange: { min: slot.repRange.min, max: slot.repRange.max },
      })),
    })),
  };
}

/**
 * 루틴을 앱이 도는 프로그램으로.
 *
 * 날마다 첫 복합 종목이 메인, 나머지 복합은 보조, 고립은 고립이다. 세트 수는
 * 고정(fixed) — 주간 처방이 늘리거나 줄이지 않는다.
 */
export function routineProgram(routine: CustomRoutine, index: ReadonlyMap<string, Exercise>): TrainingProgram {
  const templates = routine.days.map((day): SessionTemplate => {
    let primaryTaken = false;
    const slots = day.slots.flatMap((slot) => {
      const exercise = index.get(slot.exerciseId);
      if (!exercise) return [];
      const role = isIsolation(exercise) ? 'isolation' as const : primaryTaken ? 'accessory' as const : 'primary' as const;
      if (role === 'primary') primaryTaken = true;
      return [{ exerciseId: slot.exerciseId, sets: slot.sets, repRange: { ...slot.repRange }, role }];
    });
    return { name: day.name, slots, fixed: true };
  });
  return {
    name: ROUTINE_NAME,
    daysPerWeek: templates.length,
    custom: true,
    templates,
    weeklyTargets: {},
  };
}

/* ── 모양 검사 ─────────────────────────────────────────── */

type Plain = Record<string, unknown>;

function isPlain(value: unknown): value is Plain {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isWhole(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
}

/**
 * 저장 · 백업 · 다른 폰에서 받은 루틴의 뼈대가 맞는가 — 날 목록과 날마다 종목 목록.
 * 종목 하나하나는 보지 않는다. 그건 sanitizeRoutine이 하나씩 걸러 낸다(하나가 틀렸다고
 * 루틴을 통째로 버리지 않는다).
 */
export function isRoutineShape(value: unknown): boolean {
  if (!isPlain(value) || !Array.isArray(value.days)) return false;
  if (value.days.length === 0 || value.days.length > ROUTINE_MAX_DAYS) return false;
  return value.days.every((day) => isPlain(day) && Array.isArray(day.slots));
}

function readSlot(raw: unknown, index: ReadonlyMap<string, Exercise>): RoutineSlot | null {
  if (!isPlain(raw) || typeof raw.exerciseId !== 'string' || !isWhole(raw.sets, 1, 100)) return null;
  const range = raw.repRange;
  if (!isPlain(range) || !isWhole(range.min, 1, 100) || !isWhole(range.max, 1, 100)) return null;
  const exercise = index.get(raw.exerciseId);
  if (!exercise) return null;
  const min = Math.min(30, range.min, range.max);
  const max = Math.min(30, Math.max(range.min, range.max));
  return { exerciseId: exercise.id, sets: Math.min(ROUTINE_MAX_SETS, raw.sets), repRange: { min, max } };
}

/**
 * 받은 루틴을 쓸 수 있는 모양으로 고른다.
 *
 * 지금 앱에 없는 종목 · 모양이 틀린 종목은 빼고, 같은 날 같은 종목은 한 번만(세션이
 * 어차피 한 번만 한다), 세트 · 반복은 범위 안으로. 종목이 하나도 안 남은 날은 뺀다.
 * 남는 날이 없으면 null — 앱 프로그램으로 돌아간다.
 */
export function sanitizeRoutine(value: unknown, index: ReadonlyMap<string, Exercise>): CustomRoutine | null {
  if (!isRoutineShape(value)) return null;
  const raw = value as { days: Plain[]; updatedAt?: unknown };

  const days: RoutineDay[] = [];
  raw.days.forEach((day, dayIndex) => {
    const seen = new Set<string>();
    const slots: RoutineSlot[] = [];
    for (const item of day.slots as unknown[]) {
      const slot = readSlot(item, index);
      if (!slot || seen.has(slot.exerciseId) || slots.length >= ROUTINE_MAX_LIFTS) continue;
      seen.add(slot.exerciseId);
      slots.push(slot);
    }
    if (slots.length === 0) return;
    const name = (typeof day.name === 'string' ? day.name : '').trim().slice(0, ROUTINE_DAY_NAME_MAX);
    days.push({ name: name || `${dayIndex + 1}일차`, slots });
  });

  if (days.length === 0) return null;
  const routine: CustomRoutine = { days };
  if (typeof raw.updatedAt === 'string' && raw.updatedAt) routine.updatedAt = raw.updatedAt;
  return routine;
}

/* ── 점검 ──────────────────────────────────────────────── */

export interface RoutineMuscleLine {
  muscle: MuscleGroup;
  /** 한 주 유효 세트 — 볼륨 탭과 같은 셈(보조로 쓴 몫 포함, 하루 9세트 넘는 몫은 절반) */
  sets: number;
  landmark: VolumeLandmark;
  zone: VolumeZone;
  /** 하루에 가장 많이 몰린 세트 */
  maxInOneDay: number;
  /** 하루에 몰려서 덜 센 세트 */
  discounted: number;
}

export type RoutineNoteKind = 'over' | 'under' | 'crammed' | 'longDay' | 'pushPull' | 'noLegs';

export interface RoutineNote {
  kind: RoutineNoteKind;
  text: string;
  muscles?: MuscleGroup[];
  /** longDay — 몇 번째 날 */
  day?: number;
}

export interface RoutineDaySummary {
  name: string;
  sets: number;
}

export interface RoutineReview {
  muscles: RoutineMuscleLine[];
  days: RoutineDaySummary[];
  /** 고칠 만한 것 — 회복을 넘는 것부터 */
  notes: RoutineNote[];
}

/** 부족하다고 말하지 않는 부위 — 다른 종목에서 저절로 채워지거나 따로 안 해도 되는 곳 */
const QUIET_WHEN_LOW: ReadonlySet<MuscleGroup> = new Set<MuscleGroup>(['frontDelt', 'forearms', 'abs']);

const PUSH = new Set(['horizontalPush', 'verticalPush']);
const PULL = new Set(['horizontalPull', 'verticalPull']);

function setsText(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function names(muscles: readonly MuscleGroup[]): string {
  return muscles.map((muscle) => MUSCLE_LABELS_KO[muscle]).join(' · ');
}

/** 루틴의 날을 "다 해낸 하루" 기록처럼 — 볼륨 셈을 볼륨 탭과 똑같이 하려고. */
function asSessions(routine: CustomRoutine): SessionLog[] {
  return routine.days.map((day) => ({
    date: '',
    sets: day.slots.flatMap((slot) =>
      Array.from({ length: slot.sets }, () => ({
        exerciseId: slot.exerciseId,
        weightKg: 0,
        reps: Math.round((slot.repRange.min + slot.repRange.max) / 2),
        rir: 2,
      }))),
  }));
}

/**
 * 이 루틴을 한 주 다 하면 부위마다 몇 세트가 되는가, 그리고 고칠 만한 것.
 *
 * 앱 프로그램을 재는 자(볼륨 랜드마크)와 같은 자로 잰다. 한계를 넘는 부위는
 * 회복이 못 따라오고, 최소에 못 미치는 부위는 늘지 않는다. 말은 하되 바꾸지는
 * 않는다 — 루틴은 사용자 것이다.
 */
export function reviewRoutine(
  routine: CustomRoutine,
  index: ReadonlyMap<string, Exercise>,
  landmarks: LandmarksByMuscle,
): RoutineReview {
  const report = volumeReport(asSessions(routine), landmarks, index);
  const muscles: RoutineMuscleLine[] = report.map((item) => ({
    muscle: item.muscle,
    sets: item.effectiveSets,
    landmark: item.landmark,
    zone: item.zone,
    maxInOneDay: item.maxSetsInOneSession,
    discounted: item.discountedSets,
  }));
  const byMuscle = new Map(muscles.map((line) => [line.muscle, line]));

  const days: RoutineDaySummary[] = routine.days.map((day) => ({
    name: day.name,
    sets: day.slots.reduce((sum, slot) => sum + slot.sets, 0),
  }));

  const notes: RoutineNote[] = [];

  const over = muscles.filter((line) => line.sets > line.landmark.mrv * OVER_MARGIN);
  if (over.length > 0) {
    notes.push({
      kind: 'over',
      muscles: over.map((line) => line.muscle),
      text: over.map((line) => `${MUSCLE_LABELS_KO[line.muscle]} 주 ${setsText(line.sets)}세트(한계 ${line.landmark.mrv})`).join(', ') +
        ' — 보통 회복할 수 있는 양을 넘습니다. 피로만 쌓이고 더 늘지는 않는 구간이라 몇 세트 덜어내는 게 낫습니다.',
    });
  }

  const under = muscles.filter((line) =>
    line.sets < line.landmark.mev * UNDER_MARGIN && !QUIET_WHEN_LOW.has(line.muscle));
  if (under.length > 0) {
    const shown = under.slice(0, 4);
    notes.push({
      kind: 'under',
      muscles: under.map((line) => line.muscle),
      text: shown.map((line) => `${MUSCLE_LABELS_KO[line.muscle]} ${setsText(line.sets)}세트(최소 ${line.landmark.mev})`).join(', ') +
        (under.length > shown.length ? ` 외 ${under.length - shown.length}곳` : '') +
        ' — 주 최소 세트에 못 미쳐 늘기 어렵습니다. 일부러 뺀 부위가 아니면 한두 종목 넣어 보세요.',
    });
  }

  const crammed = muscles.filter((line) => line.discounted >= 1.5);
  if (crammed.length > 0) {
    notes.push({
      kind: 'crammed',
      muscles: crammed.map((line) => line.muscle),
      text: crammed.map((line) => `${MUSCLE_LABELS_KO[line.muscle]} 하루 ${setsText(line.maxInOneDay)}세트`).join(', ') +
        ' — 한 번에 몰면 뒤쪽 세트는 자극이 덜 붙어서, 앱은 하루 9세트를 넘는 몫을 절반만 셉니다. 이틀로 나누면 같은 세트로 효과가 더 큽니다.',
    });
  }

  days.forEach((day, i) => {
    if (day.sets <= ROUTINE_LONG_DAY_SETS) return;
    notes.push({
      kind: 'longDay',
      day: i,
      text: `${day.name} ${day.sets}세트 — 쉬는 시간까지 1시간 반이 넘습니다. 뒤로 갈수록 세트 질이 떨어지니 종목 몇 개를 다른 날로 나누는 게 좋습니다.`,
    });
  });

  let push = 0;
  let pull = 0;
  for (const day of routine.days) {
    for (const slot of day.slots) {
      const pattern = index.get(slot.exerciseId)?.pattern;
      if (pattern && PUSH.has(pattern)) push += slot.sets;
      if (pattern && PULL.has(pattern)) pull += slot.sets;
    }
  }
  if (push >= 6 && push > pull * 2) {
    notes.push({
      kind: 'pushPull',
      text: `미는 종목 ${push}세트 · 당기는 종목 ${pull}세트 — 미는 쪽이 두 배가 넘습니다. 어깨가 앞으로 말리기 쉬워 로우나 풀다운을 늘리는 게 좋습니다.`,
    });
  }

  const legs: MuscleGroup[] = ['quads', 'hamstrings', 'glutes'];
  if (legs.every((muscle) => (byMuscle.get(muscle)?.sets ?? 0) < 1)) {
    notes.push({
      kind: 'noLegs',
      muscles: legs,
      text: '하체 종목이 없습니다. 하체를 따로 하지 않는다면 한 날은 스쿼트나 레그프레스를 넣는 게 좋습니다.',
    });
  }

  return { muscles, days, notes };
}

/** 부위 이름 둘까지 — 더 있으면 "외 N곳"("가슴 · 등 등"은 등이 두 번 읽힌다). */
function firstTwo(muscles: readonly MuscleGroup[]): string {
  const rest = muscles.length - 2;
  return names(muscles.slice(0, 2)) + (rest > 0 ? ` 외 ${rest}곳` : '');
}

/** 점검 결과 한 줄 — 프로그램 카드에 쓴다. */
export function routineHeadline(review: RoutineReview): string {
  const over = review.notes.find((note) => note.kind === 'over');
  if (over?.muscles?.length) return `${withParticle(firstTwo(over.muscles), '이/가')} 회복 한계를 넘습니다`;
  const under = review.notes.find((note) => note.kind === 'under');
  if (under?.muscles?.length) return `${withParticle(firstTwo(under.muscles), '이/가')} 주 최소 세트에 못 미칩니다`;
  if (review.notes.length > 0) return `고칠 만한 것 ${review.notes.length}가지`;
  return '부위마다 주 최소 세트를 넘고 한계 안입니다';
}
