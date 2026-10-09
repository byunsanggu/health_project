import { estimate1RM } from './load.ts';
import { LEVEL_LABELS_KO, levelFromStrength, levelProfile } from './levels.ts';
import type { ProgramOptions, TrainingProgram } from './onboarding.ts';
import { exerciseById } from './exercises.ts';
import { addDays, weekStart } from './volume.ts';
import type { SessionLog, TrainingLevel } from './types.ts';

/**
 * 훈련 블록 — 축적 몇 주 + 디로드 한 주.
 *
 * 블록이 끝나면 트레이너가 하는 일을 그대로 한다. 출석과 기록을 보고 단계를
 * 올릴지 정하고, 메인 종목은 두고 보조 종목을 바꾼다. 단계는 **한 번에 올리지
 * 않는다.** 초보 볼륨에서 중급 볼륨으로 바로 뛰면 첫 2주는 버텨도 3주차에
 * 무너진다. 두 블록에 걸쳐 절반씩 옮기고, 바벨 종목도 한 블록에 하나씩 들인다.
 */
export interface TrainingBlock {
  /** 몇 번째 블록인지 (1부터) */
  number: number;
  /** 이 블록이 시작한 주의 월요일 */
  startedOn: string;
  /** 이 블록 볼륨 · 디로드 주기의 기준 단계 */
  level: TrainingLevel;
  /** 다음 단계로 옮겨 가는 중이면 그 단계와 몇 번째 걸음인지 */
  transition?: { to: TrainingLevel; step: number } | null;
  /**
   * 초보에서 출발한 사람이 지금까지 배운 바벨 기본 종목.
   * null이면 제한이 없다 — 처음부터 중급 이상이었거나 다 배웠다.
   */
  technicalIntroduced?: string[] | null;
  /** 피로 때문에 일찍 디로드에 들어갔다면 그 주의 월요일 */
  deloadOn?: string | null;
  /** 첫 블록이 시작한 날 — 앱에서 쌓은 경력을 셀 때 쓴다 */
  firstStartedOn: string;
  /** 시작할 때 신고한 경력(개월) */
  monthsAtStart: number;
}

/** 다음 단계로 옮기는 데 쓰는 블록 수. 첫 블록은 절반만, 두 번째 블록에서 다 옮긴다. */
export const TRANSITION_STEPS = 2;

/** 이만큼은 나와야 단계를 올린다. 안 나온 사람에게 볼륨을 더 주면 더 안 나온다. */
export const MIN_ATTENDANCE = 0.75;

/**
 * 초보에서 올라온 사람에게 들이는 순서.
 * 스쿼트 → 로우 → 프레스 → 데드. 허리 부담이 큰 것일수록 뒤다.
 * 이 넷을 배우고 나면 나머지 변형(프론트 스쿼트 · 스모 등)은 막지 않는다.
 */
export const TECHNICAL_ORDER: readonly string[] = [
  'back-squat', 'barbell-row', 'barbell-overhead-press', 'conventional-deadlift',
];

const NEXT_LEVEL: Record<TrainingLevel, TrainingLevel | null> = {
  beginner: 'intermediate',
  intermediate: 'advanced',
  advanced: 'expert',
  expert: null,
};

/** 그 단계로 올라가기 위한 최소 경력(개월) — 레벨 판정과 같은 경계다. */
const MONTHS_FOR: Record<TrainingLevel, number> = {
  beginner: 0,
  intermediate: 6,
  advanced: 24,
  expert: 60,
};

const ORDER: Record<TrainingLevel, number> = {
  beginner: 0, intermediate: 1, advanced: 2, expert: 3,
};

/** 처음 시작하는 블록. */
export function startTraining(input: {
  today: string;
  level: TrainingLevel;
  monthsTraining?: number;
}): TrainingBlock {
  const monday = weekStart(input.today);
  return {
    number: 1,
    startedOn: monday,
    level: input.level,
    transition: null,
    technicalIntroduced: input.level === 'beginner' ? [] : null,
    deloadOn: null,
    firstStartedOn: monday,
    monthsAtStart: Math.max(0, input.monthsTraining ?? 0),
  };
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

export type BlockStage = 'accumulation' | 'deload' | 'done';

export interface BlockStatus {
  stage: BlockStage;
  /** 블록 안에서 몇 번째 주인지 (1부터). 디로드 주는 축적 주 수 + 1. */
  weekInBlock: number;
  accumulationWeeks: number;
}

/**
 * 오늘이 블록의 어디쯤인지.
 *
 * 앱을 안 연 주가 있어도 날짜로 센다. 축적 주를 다 채우면 그다음 주가 디로드,
 * 그 주가 지나면 블록이 끝난다. 피로가 쌓여 일찍 디로드에 들어갔다면
 * (deloadOn) 그 주가 디로드이고 그다음 주에 끝난다.
 */
export function blockStatus(block: TrainingBlock, today: string): BlockStatus {
  const monday = weekStart(today);
  const weekInBlock = Math.floor(daysBetween(block.startedOn, monday) / 7) + 1;
  const accumulationWeeks = levelProfile(block.level).accumulationWeeks;

  if (block.deloadOn) {
    if (monday === block.deloadOn) return { stage: 'deload', weekInBlock, accumulationWeeks };
    if (monday > block.deloadOn) return { stage: 'done', weekInBlock, accumulationWeeks };
  }
  if (weekInBlock <= accumulationWeeks) return { stage: 'accumulation', weekInBlock, accumulationWeeks };
  if (weekInBlock === accumulationWeeks + 1) return { stage: 'deload', weekInBlock, accumulationWeeks };
  return { stage: 'done', weekInBlock, accumulationWeeks };
}

/** 이번 주를 디로드로 적어 둔다. 이미 적혀 있으면 그대로. */
export function markDeload(block: TrainingBlock, today: string): TrainingBlock {
  if (block.deloadOn) return block;
  return { ...block, deloadOn: weekStart(today) };
}

/** 앱 밖 경력까지 더한 훈련 개월 수. */
export function monthsTrained(block: TrainingBlock, today: string): number {
  return block.monthsAtStart + Math.max(0, daysBetween(block.firstStartedOn, today)) / 30.44;
}

export type BlockDecision = 'promote' | 'complete' | 'hold' | 'stay' | 'top';

export interface BlockReview {
  plannedSessions: number;
  doneSessions: number;
  /** 0~1 */
  attendance: number;
  /** 블록 안에서 두 번 이상 한 종목 중 기록이 오른 비율. 볼 것이 없으면 null */
  progressRate: number | null;
  decision: BlockDecision;
  /** 다음 블록의 기준 단계 */
  level: TrainingLevel;
  transition: { to: TrainingLevel; step: number } | null;
  /** 사용자에게 보여 줄 판정 이유 */
  reasons: string[];
}

/**
 * 블록 동안 기록이 올랐는가.
 *
 * 종목마다 블록 앞쪽 절반과 뒤쪽 절반의 최고 추정 1RM을 비교한다.
 * 같거나 오르면 오른 것으로 본다 — RIR을 조이면서 같은 무게를 유지한 것도
 * 진도다.
 */
function progressIn(sessions: readonly SessionLog[], from: string, to: string): number | null {
  const middle = addDays(from, Math.floor(daysBetween(from, to) / 2));
  const early = new Map<string, number>();
  const late = new Map<string, number>();
  for (const session of sessions) {
    if (session.date < from || session.date >= to) continue;
    const bucket = session.date < middle ? early : late;
    for (const set of session.sets) {
      if (set.warmup || set.reps <= 0 || set.weightKg <= 0) continue;
      const value = estimate1RM(set);
      if (value > (bucket.get(set.exerciseId) ?? 0)) bucket.set(set.exerciseId, value);
    }
  }
  let compared = 0;
  let improved = 0;
  for (const [id, before] of early) {
    const after = late.get(id);
    if (after === undefined) continue;
    compared += 1;
    if (after >= before) improved += 1;
  }
  return compared === 0 ? null : improved / compared;
}

/**
 * 끝난 블록을 본다.
 *
 * 단계를 올리는 조건은 셋이다 — 나왔는가(출석), 늘었는가(기록), 그만큼
 * 했는가(경력). 근력 기록이 있으면 그것도 본다. 하나라도 모자라면 같은
 * 단계에서 한 블록 더 한다. 올릴 때도 한 번에 올리지 않는다.
 */
export function reviewBlock(input: {
  block: TrainingBlock;
  history: readonly SessionLog[];
  today: string;
  daysPerWeek: number;
  bodyweightKg?: number;
}): BlockReview {
  const { block } = input;
  const accumulationWeeks = levelProfile(block.level).accumulationWeeks;
  const end = block.deloadOn && block.deloadOn < addDays(block.startedOn, accumulationWeeks * 7)
    ? block.deloadOn
    : addDays(block.startedOn, accumulationWeeks * 7);
  const weeks = Math.max(1, Math.round(daysBetween(block.startedOn, end) / 7));

  const trainedDates = new Set(
    input.history
      .filter((session) => session.date >= block.startedOn && session.date < end)
      .filter((session) => session.sets.some((set) => !set.warmup && set.reps > 0))
      .map((session) => session.date),
  );
  const plannedSessions = Math.max(1, Math.round(input.daysPerWeek) * weeks);
  const doneSessions = trainedDates.size;
  const attendance = Math.min(1, doneSessions / plannedSessions);
  const progressRate = progressIn(input.history, block.startedOn, end);

  const reasons: string[] = [
    `${weeks}주 동안 ${plannedSessions}번 중 ${doneSessions}번 나왔습니다 (${Math.round(attendance * 100)}%).`,
  ];
  if (progressRate !== null) {
    reasons.push(`두 번 이상 한 종목 중 ${Math.round(progressRate * 100)}%가 기록을 지키거나 올렸습니다.`);
  }

  const showedUp = attendance >= MIN_ATTENDANCE;
  const progressed = progressRate === null || progressRate >= 0.5;
  const base = { plannedSessions, doneSessions, attendance, progressRate, reasons };

  // 옮겨 가는 중이었다면 — 잘 해냈으면 마저 옮기고, 아니면 한 블록 더 그 자리.
  if (block.transition) {
    const { to } = block.transition;
    if (showedUp && progressed) {
      return {
        ...base,
        decision: 'complete',
        level: to,
        transition: null,
        reasons: [...reasons, `${LEVEL_LABELS_KO[to]} 볼륨으로 다 옮깁니다.`],
      };
    }
    return {
      ...base,
      decision: 'hold',
      level: block.level,
      transition: block.transition,
      reasons: [...reasons, `한 블록 더 지금 볼륨으로 다지고 ${LEVEL_LABELS_KO[to]}로 마저 옮깁니다.`],
    };
  }

  const next = NEXT_LEVEL[block.level];
  if (!next) {
    return { ...base, decision: 'top', level: block.level, transition: null, reasons };
  }

  const months = monthsTrained(block, input.today);
  const strength = input.bodyweightKg ? levelFromStrength(input.history, input.bodyweightKg) : null;
  const strongEnough = strength === null || ORDER[strength] >= ORDER[next];
  const longEnough = months >= MONTHS_FOR[next];

  if (showedUp && progressed && longEnough && strongEnough) {
    return {
      ...base,
      decision: 'promote',
      level: block.level,
      transition: { to: next, step: 1 },
      reasons: [
        ...reasons,
        `${LEVEL_LABELS_KO[next]}로 올라갑니다. 한 번에 올리지 않고 이번 블록은 볼륨을 절반만 옮깁니다.`,
      ],
    };
  }

  const why: string[] = [];
  if (!showedUp) why.push(`출석이 ${Math.round(MIN_ATTENDANCE * 100)}%는 넘어야 볼륨을 올립니다`);
  if (!progressed) why.push('기록이 아직 오르는 중이 아닙니다');
  if (!longEnough) why.push(`${LEVEL_LABELS_KO[next]}는 경력 ${MONTHS_FOR[next]}개월부터입니다 (지금 ${Math.floor(months)}개월)`);
  if (!strongEnough) why.push('근력 기록이 아직 그 단계에 못 미칩니다');
  return {
    ...base,
    decision: 'stay',
    level: block.level,
    transition: null,
    reasons: [...reasons, `${LEVEL_LABELS_KO[block.level]} 단계를 한 블록 더 합니다 — ${why.join(', ')}.`],
  };
}

/**
 * 다음 블록.
 *
 * 초보에서 올라오는 사람에게는 바벨 기본 종목을 한 블록에 하나씩 들인다.
 * 그 헬스장에 없는 종목은 건너뛴다.
 */
export function nextBlock(
  block: TrainingBlock,
  review: BlockReview,
  today: string,
  availableExerciseIds: Iterable<string>,
): TrainingBlock {
  const available = new Set(availableExerciseIds);
  let introduced = block.technicalIntroduced ?? null;

  const climbing = review.level !== 'beginner' || review.transition !== null;
  if (introduced && climbing) {
    const pending = TECHNICAL_ORDER.filter((id) => available.has(id) && !introduced!.includes(id));
    introduced = pending.length === 0 ? null : [...introduced, pending[0]!];
  }

  return {
    ...block,
    number: block.number + 1,
    startedOn: weekStart(today),
    level: review.level,
    transition: review.transition,
    technicalIntroduced: introduced,
    deloadOn: null,
  };
}

/** 블록으로 프로그램을 다시 짤 때 넘길 단계와 조건. */
export function programOptionsFor(
  block: TrainingBlock,
  previous?: TrainingProgram,
): { level: TrainingLevel; options: ProgramOptions } {
  return {
    level: block.level,
    options: {
      previous,
      blendToward: block.transition
        ? { level: block.transition.to, amount: block.transition.step / TRANSITION_STEPS }
        : undefined,
      technicalIntroduced: block.technicalIntroduced ?? undefined,
    },
  };
}

export interface ProgramChange {
  from: string;
  to: string;
}

/**
 * 두 프로그램 사이에 바뀐 종목. 같은 날 같은 자리끼리 비교한다.
 */
export function programChanges(before: TrainingProgram, after: TrainingProgram): ProgramChange[] {
  const changes: ProgramChange[] = [];
  const seen = new Set<string>();
  after.templates.forEach((template, dayIndex) => {
    const old = before.templates[dayIndex];
    if (!old) return;
    template.slots.forEach((slot, slotIndex) => {
      const was = old.slots[slotIndex];
      if (!was || was.exerciseId === slot.exerciseId) return;
      const key = `${was.exerciseId}>${slot.exerciseId}`;
      if (seen.has(key)) return;
      seen.add(key);
      changes.push({
        from: exerciseById(was.exerciseId)?.name ?? was.exerciseId,
        to: exerciseById(slot.exerciseId)?.name ?? slot.exerciseId,
      });
    });
  });
  return changes;
}

/** 이번 블록에 새로 들어온 바벨 기본 종목. */
export function newlyIntroduced(before: TrainingBlock, after: TrainingBlock): string | null {
  const was = before.technicalIntroduced ?? [];
  const now = after.technicalIntroduced ?? [];
  const added = now.find((id) => !was.includes(id));
  return added ? exerciseById(added)?.name ?? added : null;
}
