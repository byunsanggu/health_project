/**
 * 시즌 — 약속을 지킨 만큼 오르는 무대.
 *
 * 연속 기록(streak.ts)과 등급(tier.ts)은 "얼마나 꾸준했나"를 숫자 하나로 보여 준다. 여기서는 그
 * 꾸준함을 이야기로 바꾼다. 한 블록(축적 몇 주 + 덜어내는 주)이 한 시즌이고, 덜어내는 주가 대회를
 * 앞둔 "피킹 주", 그 주의 마지막 날이 "대회 당일"이다. 대회 당일에 이번 시즌 약속을 얼마나 지켰는지를
 * 보고 다음 무대로 올라가거나 같은 무대에 다시 선다.
 *
 * 원칙 넷.
 *
 *   1. **운동 횟수가 아니라 약속을 센다.** 주 3회와 주 5회는 약속을 지키면 같은 빠르기로 오른다.
 *      한 주 점수를 약속한 횟수로 나눠 매기기 때문이다(주 3회면 한 번에 10점).
 *   2. **약속보다 더 해도 점수는 그대로다.** 더 나오라고 부추기면 회복할 날이 없어진다.
 *   3. **깎지 않는다.** 아픈 주 · 쉼표 주 · 덜어내는 주는 점수를 깎지 않고 연속도 끊지 않는다.
 *      무대도 내려가지 않는다 — 혼나려고 앱을 여는 사람은 없다.
 *   4. **전부 이 폰 안에서.** 운동 기록 · 통증은 민감정보다. 이 모듈은 받은 기록으로 계산만 하고,
 *      결과는 앱이 이 기기에만 둔다(서버 · 친구 표에 싣지 않는다).
 *
 * 이름은 전부 지어낸 일반 이름이다. 실제 대회 · 단체 이름이나 게임 등급 이름은 쓰지 않는다.
 */
import { buildStreak, hasWorkout, type WeekResult } from './streak.ts';
import { levelProfile } from './levels.ts';
import { planGoals, type TrainingGoal } from './goals.ts';
import { planComeback } from './comeback.ts';
import { liftProgress } from './progress.ts';
import { EXERCISES } from './exercises.ts';
import { addDays, weekStart } from './volume.ts';
import type { CoachStyle } from './coach.ts';
import type { Exercise, MovementPattern, SessionLog, TrainingLevel } from './types.ts';

/* ── 무대 ─────────────────────────────────────── */

/**
 * 목표마다 다른 무대.
 *   physique — 근육 키우기: 몸을 보여 주는 무대
 *   platform — 근력: 무게를 드는 플랫폼
 *   open     — 체지방 감량 · 체력 기르기 · 건강 유지: 누구나 나오는 오픈전
 */
export type CareerTrack = 'physique' | 'platform' | 'open';

export const CAREER_TRACKS: readonly CareerTrack[] = ['physique', 'platform', 'open'];

export const TRACK_LABELS_KO: Record<CareerTrack, string> = {
  physique: '보디 무대',
  platform: '파워 플랫폼',
  open: '오픈 경기',
};

/** 무대 여섯 칸 — 지어낸 일반 이름. 아래에서 위로. */
export const CAREER_LADDERS: Record<CareerTrack, readonly string[]> = {
  physique: ['동네 헬스장 데뷔', '시 대회', '전국 대회', '국가대표 선발전', '프로 무대', '정상 무대'],
  platform: ['첫 플랫폼', '지역 플랫폼', '전국 플랫폼', '대표 선발 플랫폼', '마스터 플랫폼', '그랜드 플랫폼'],
  open: ['첫 기록 측정', '동네 오픈전', '지역 오픈전', '전국 오픈전', '초청 경기', '챔피언스 데이'],
};

export const STAGE_COUNT = 6;

/** 한 무대 안의 세 걸음 — 시즌 점수로 오른다. Ⅲ에서 시작해 Ⅰ이 그 무대의 맨 위다. */
export const SUB_STEP_LABELS: readonly string[] = ['Ⅲ', 'Ⅱ', 'Ⅰ'];

/**
 * 목표 → 무대.
 *
 * 목표를 여럿 골랐으면 반복 범위를 정하는 첫 목표(planGoals의 primary)를 따른다 — 근력이 들어 있으면
 * 플랫폼, 근육 키우기면 보디 무대, 나머지(감량 · 체력 · 건강)는 오픈 경기.
 */
export function trackForGoals(goals: readonly TrainingGoal[]): CareerTrack {
  const primary = planGoals(goals).primary;
  if (primary === 'strength') return 'platform';
  if (primary === 'hypertrophy') return 'physique';
  return 'open';
}

export function stageName(track: CareerTrack, stage: number): string {
  const ladder = CAREER_LADDERS[track];
  return ladder[clampStage(stage)]!;
}

/** "시 대회 Ⅱ" */
export function stageLabel(track: CareerTrack, stage: number, subStep: number): string {
  return `${stageName(track, stage)} ${SUB_STEP_LABELS[Math.max(0, Math.min(2, subStep))]}`;
}

function clampStage(stage: number): number {
  return Math.max(0, Math.min(STAGE_COUNT - 1, Math.floor(Number.isFinite(stage) ? stage : 0)));
}

/* ── 시즌 기간 ─────────────────────────────────── */

/** 블록에서 시즌을 읽는 데 필요한 것만 (blocks.ts의 TrainingBlock과 맞다). */
export interface SeasonBlock {
  startedOn: string;
  level: TrainingLevel;
  deloadOn?: string | null;
}

export interface SeasonWindow {
  /** 시즌 첫 주 월요일 */
  start: string;
  /** 피킹 주(덜어내는 주) 월요일 */
  peak: string;
  /** 대회 당일 — 피킹 주 일요일 */
  end: string;
  /** 시즌의 주 월요일들 (피킹 주 포함) */
  weeks: string[];
}

/**
 * 한 시즌 = 한 블록.
 *
 * 축적 주를 다 채운 다음 주가 피킹 주다. 피로가 먼저 쌓여 일찍 덜어냈으면(deloadOn) 그 주가 피킹 주 —
 * 시즌이 짧아질 뿐 점수 기준(주마다 같은 만점)은 그대로다.
 */
export function seasonWindow(block: SeasonBlock): SeasonWindow {
  const start = weekStart(block.startedOn);
  const accumulation = levelProfile(block.level).accumulationWeeks;
  const scheduled = addDays(start, accumulation * 7);
  const peak = block.deloadOn && block.deloadOn >= start && block.deloadOn <= scheduled ? weekStart(block.deloadOn) : scheduled;
  const weeks: string[] = [];
  for (let at = start; at <= peak; at = addDays(at, 7)) weeks.push(at);
  return { start, peak, end: addDays(peak, 6), weeks };
}

/** 오늘부터 대회 당일까지 며칠. 당일이면 0, 지났으면 음수. */
export function daysUntil(today: string, end: string): number {
  return Math.round((Date.parse(end + 'T00:00:00Z') - Date.parse(today + 'T00:00:00Z')) / 86_400_000);
}

/* ── 점수 ─────────────────────────────────────── */

/** 약속을 다 지킨 한 주의 운동 점수. 주 3회면 한 번에 10점 — 몇 회 약속이든 한 주 합은 같다. */
export const WEEK_WORKOUT_POINTS = 30;
/** 약속한 운동 한 번 — 주 3회 기준 점수 (화면 설명용) */
export const WORKOUT_POINTS = 10;
/** 15분 · 25분으로 줄인 날 — 한 번에 절반 */
export const SHORT_SESSION_SHARE = 0.5;
/** 약속을 다 지킨 주의 보너스 */
export const KEPT_WEEK_BONUS = 20;
/** 연달아 지킨 주마다 늘어나는 배율, 그 상한 */
export const STREAK_STEP = 0.1;
export const MAX_MULTIPLIER = 1.5;
/** 대회 당일에 이만큼 지켰으면 다음 무대로 */
export const PROMOTE_AT = 0.8;
/** 무대 안 세 걸음의 문턱 — 시즌 만점(주마다 50점)의 비율 */
export const SUB_STEP_SHARES: readonly number[] = [0, 1 / 3, 2 / 3];

export interface SeasonWeekScore {
  weekStart: string;
  /** 그 주 약속 횟수 (피킹 주 · 시작한 주는 줄어 있다) */
  target: number;
  /** 운동한 날 (약속을 넘은 날까지) */
  days: number;
  /** 점수에 넣은 날 — 약속 횟수까지 */
  credited: number;
  /** 그중 줄인 날 */
  short: number;
  kept: boolean;
  /** 깎지 않고 넘어간 주 — 아픈 주 · 쉼표 주 */
  excused: boolean;
  /** 피킹 주 */
  peak: boolean;
  open: boolean;
  /** 아직 오지 않은 주 */
  future: boolean;
  multiplier: number;
  points: number;
}

export interface SeasonScoreInput {
  sessions: readonly SessionLog[];
  window: SeasonWindow;
  /** 주 몇 회 하기로 했는가 */
  target: number;
  today: string;
  /** 15분 · 25분으로 줄여서 한 날 */
  shortDates?: readonly string[];
  /** 통증을 적은 날(5점 이상) — 그 주는 못 지켜도 깎지 않는다 */
  painDates?: readonly string[];
  /** 앱을 시작한 날 — 그 주는 남은 날만큼만 약속한다 */
  startDate?: string;
  /** 지난 시즌들의 피킹 주 — 연속을 셀 때 그 주는 덜어내는 주로 본다 */
  pastPeaks?: readonly string[];
}

export interface SeasonProgress {
  window: SeasonWindow;
  weeks: SeasonWeekScore[];
  score: number;
  /** 시즌 만점 (배율 없이 주마다 50점) */
  fullScore: number;
  /** 무대 안 세 걸음의 문턱 [Ⅲ, Ⅱ, Ⅰ] */
  thresholds: number[];
  /** 0 = Ⅲ, 1 = Ⅱ, 2 = Ⅰ */
  subStep: number;
  /** 다음 걸음까지 남은 점수 (Ⅰ이면 null) */
  toNext: number | null;
  /** 다음 걸음까지 채운 비율 0..1 (Ⅰ이면 시즌 만점까지) */
  stepProgress: number;
  /** 지금까지 지킨 비율 — 끝난 주만 센다. 셀 주가 없으면 null */
  adherence: number | null;
  /** 지킨 주 수 */
  keptWeeks: number;
  /** 대회 당일까지 며칠 */
  daysLeft: number;
}

/** 운동한 날 — 서킷만 한 날도 센다(약속 계산과 같은 기준) */
function isWorkingSession(session: SessionLog): boolean {
  return hasWorkout(session);
}

function streakFor(input: {
  sessions: readonly SessionLog[];
  thisMonday: string;
  target: number;
  today: string;
  startDate?: string;
  deloadWeeks: readonly string[];
}): WeekResult[] {
  const streak = buildStreak({
    sessions: input.sessions,
    thisMonday: input.thisMonday,
    target: Math.max(1, input.target),
    deloadWeeks: input.deloadWeeks,
    today: input.today,
    startDate: input.startDate,
    lookbackWeeks: 26,
  });
  // 오래된 주부터
  return streak.weeks.slice().reverse();
}

/**
 * 이번 시즌 점수.
 *
 * 한 주 점수 = 운동 점수(약속 횟수까지, 한 주 최대 30점) + 다 지켰으면 20점, 그 합에 연속 배율.
 * 배율은 앞선 주들이 몇 주 연달아 지켜졌는지로 정한다(×1.0부터 주마다 0.1씩, ×1.5까지) — 지난 시즌에서
 * 이어 온 연속도 센다. 못 지킨 주는 연속을 끊지만 이미 쌓인 점수는 그대로다. 아픈 주 · 쉼표 주는 끊지 않는다.
 */
export function seasonProgress(input: SeasonScoreInput): SeasonProgress {
  const { window } = input;
  const target = Math.max(1, Math.round(input.target));
  const lastMonday = weekStart(input.today) < window.peak ? weekStart(input.today) : window.peak;
  const thisMonday = lastMonday < window.start ? window.start : lastMonday;
  const todayForStreak = input.today > window.end ? addDays(window.end, 1) : input.today;
  const weeks = streakFor({
    sessions: input.sessions,
    thisMonday,
    target,
    today: todayForStreak,
    startDate: input.startDate,
    deloadWeeks: [...(input.pastPeaks ?? []), window.peak],
  });
  const shortSet = new Set(input.shortDates ?? []);
  const painWeeks = new Set((input.painDates ?? []).map((date) => weekStart(date)));
  const scored = new Map<string, SeasonWeekScore>();

  let run = 0;
  for (const week of weeks) {
    const excused = !week.kept && !week.open && (week.forgiven || painWeeks.has(week.weekStart));
    const multiplier = Math.min(MAX_MULTIPLIER, round2(1 + STREAK_STEP * run));
    if (week.kept) run += 1;
    else if (!week.open && !excused) run = 0;
    if (week.weekStart < window.start || week.weekStart > window.peak) continue;

    const end = addDays(week.weekStart, 6);
    const dates = new Set(
      input.sessions
        .filter((session) => session.date >= week.weekStart && session.date <= end && isWorkingSession(session))
        .map((session) => session.date),
    );
    let shortDays = 0;
    for (const date of dates) if (shortSet.has(date)) shortDays += 1;
    const fullDays = dates.size - shortDays;
    const fullCredited = Math.min(fullDays, week.target);
    const shortCredited = Math.min(shortDays, week.target - fullCredited);
    const units = fullCredited + SHORT_SESSION_SHARE * shortCredited;
    const base = (WEEK_WORKOUT_POINTS * units) / Math.max(1, week.target);
    const points = Math.round((base + (week.kept ? KEPT_WEEK_BONUS : 0)) * multiplier);
    scored.set(week.weekStart, {
      weekStart: week.weekStart,
      target: week.target,
      days: week.days,
      credited: fullCredited + shortCredited,
      short: shortCredited,
      kept: week.kept,
      excused,
      peak: week.weekStart === window.peak,
      open: week.open,
      future: false,
      multiplier,
      points,
    });
  }

  const out: SeasonWeekScore[] = window.weeks.map((monday) => scored.get(monday) ?? {
    weekStart: monday, target, days: 0, credited: 0, short: 0, kept: false, excused: false,
    peak: monday === window.peak, open: false, future: true, multiplier: 1, points: 0,
  });

  const score = out.reduce((sum, week) => sum + week.points, 0);
  const fullScore = window.weeks.length * (WEEK_WORKOUT_POINTS + KEPT_WEEK_BONUS);
  const thresholds = SUB_STEP_SHARES.map((share) => Math.round((fullScore * share) / 10) * 10);
  let subStep = 0;
  for (let i = 0; i < thresholds.length; i += 1) if (score >= thresholds[i]!) subStep = i;
  const next = thresholds[subStep + 1];
  const floor = thresholds[subStep]!;
  const ceiling = next ?? fullScore;
  const stepProgress = ceiling > floor ? Math.max(0, Math.min(1, (score - floor) / (ceiling - floor))) : 1;

  let promised = 0;
  let kept = 0;
  for (const week of out) {
    if (week.future || week.open || week.excused) continue;
    promised += week.target;
    kept += Math.min(week.credited, week.target);
  }

  return {
    window,
    weeks: out,
    score,
    fullScore,
    thresholds,
    subStep,
    toNext: next === undefined ? null : Math.max(0, next - score),
    stepProgress,
    adherence: promised > 0 ? kept / promised : null,
    keptWeeks: out.filter((week) => week.kept).length,
    daysLeft: daysUntil(input.today, window.end),
  };
}

/* ── 힘 기록 ───────────────────────────────────── */

const MAIN_PATTERNS: ReadonlySet<MovementPattern> = new Set<MovementPattern>([
  'squat', 'hinge', 'horizontalPush', 'verticalPush', 'horizontalPull', 'verticalPull', 'lunge',
]);

let catalog: Map<string, Exercise> | null = null;
function exerciseIndex(): Map<string, Exercise> {
  if (!catalog) catalog = new Map(EXERCISES.map((exercise) => [exercise.id, exercise]));
  return catalog;
}

export interface StrengthHighlight {
  exerciseId: string;
  name: string;
  /** 시즌 첫 기록의 추정 1회 최대 (kg) */
  fromKg: number;
  /** 시즌 최고 (kg) */
  toKg: number;
  changeKg: number;
  changePercent: number;
}

/**
 * 이번 시즌에 가장 많이 오른 주 종목 — 추정 1회 최대(progress.ts의 liftProgress)로.
 * 고립 · 코어 종목은 빼고, 두 번 넘게 한 종목만. 오른 게 없으면 null — 내려간 숫자는 들이밀지 않는다.
 */
export function seasonStrengthHighlight(sessions: readonly SessionLog[], window: SeasonWindow): StrengthHighlight | null {
  const inSeason = sessions.filter((session) => session.date >= window.start && session.date <= window.end);
  const index = exerciseIndex();
  let best: StrengthHighlight | null = null;
  for (const lift of liftProgress(inSeason, index, { minSessions: 2 })) {
    const exercise = index.get(lift.exerciseId);
    if (!exercise || !MAIN_PATTERNS.has(exercise.pattern)) continue;
    const changeKg = round1(lift.best - lift.first);
    if (changeKg <= 0) continue;
    if (!best || changeKg > best.changeKg) {
      best = {
        exerciseId: lift.exerciseId,
        name: exercise.name,
        fromKg: lift.first,
        toKg: lift.best,
        changeKg,
        changePercent: lift.first > 0 ? round1((changeKg / lift.first) * 100) : 0,
      };
    }
  }
  return best;
}

/* ── 몸 ───────────────────────────────────────── */

/** 그림 속 선수의 자란 정도 — 전부 0..1. 0이면 지금 시연 그림 그대로다. */
export interface AvatarGrowth {
  shoulders: number;
  arms: number;
  chest: number;
  back: number;
  legs: number;
  /** 허리가 잘록한 정도 */
  waist: number;
  /** 가슴을 펴고 선 자세 */
  posture: number;
}

export const GROWTH_PARTS: readonly (keyof AvatarGrowth)[] = ['shoulders', 'arms', 'chest', 'back', 'legs', 'waist', 'posture'];

/**
 * 무대마다 어디가 먼저 자라는가 (지킨 한 주가 그 부위에 얼마나 들어가는지).
 * 감량 · 체력은 허리가 먼저 조이고 몸이 가늘게, 근력은 다리 · 등이 굵게, 근육 키우기는 고르게 넓게.
 */
export const GROWTH_WEIGHTS: Record<CareerTrack, AvatarGrowth> = {
  physique: { shoulders: 1, arms: 1, chest: 1, back: 0.9, legs: 0.75, waist: 0.6, posture: 0.8 },
  platform: { shoulders: 0.7, arms: 0.6, chest: 0.7, back: 1, legs: 1, waist: 0.15, posture: 0.9 },
  open: { shoulders: 0.55, arms: 0.45, chest: 0.45, back: 0.6, legs: 0.7, waist: 1, posture: 0.9 },
};

/**
 * 이만큼 지킨 주(가중)에서 부위가 63%쯤 자란다. 한 주에는 2.5%쯤으로 거의 안 보이고, 석 달(12주)이면
 * 4분의 1, 반 년이면 절반, 일 년이면 4분의 3 — 몇 달이 지나야 확실히 보인다.
 */
export const GROWTH_WEEKS = 40;

/**
 * 지킨 주로 자란 정도.
 *
 * 무대별로 쌓은 주를 따로 받는다 — 목표를 바꿔도 이미 자란 것은 그대로 두고, 그 뒤로 자라는 모양만
 * 바뀐다. 쉬면 멈출 뿐 줄지 않는다(쌓은 주는 줄지 않으므로). 1을 넘지 않는다.
 */
export function avatarGrowth(banked: Partial<Record<CareerTrack, number>>): AvatarGrowth {
  const out = {} as AvatarGrowth;
  for (const part of GROWTH_PARTS) {
    let weighted = 0;
    for (const track of CAREER_TRACKS) weighted += Math.max(0, banked[track] ?? 0) * GROWTH_WEIGHTS[track][part];
    out[part] = round3(1 - Math.exp(-weighted / GROWTH_WEEKS));
  }
  return out;
}

/* ── 꾸밈 ─────────────────────────────────────── */

export type UnlockId = 'wristbands' | 'trunks' | 'belt' | 'plates' | 'trim';

export interface StageUnlock {
  id: UnlockId;
  label: string;
  /** 이 무대에 오르면 열린다 */
  stage: number;
}

/** 무대에 오를 때마다 하나씩. 은은한 색만 쓴다. */
export const STAGE_UNLOCKS: readonly StageUnlock[] = [
  { id: 'wristbands', label: '손목 밴드', stage: 1 },
  { id: 'trunks', label: '무대 반바지 색', stage: 2 },
  { id: 'belt', label: '리프팅 벨트', stage: 3 },
  { id: 'plates', label: '색 원판', stage: 4 },
  { id: 'trim', label: '금색 장식', stage: 5 },
];

export interface Cosmetics {
  wristbands: boolean;
  belt: boolean;
  /** 바의 원판에 색을 넣는가 */
  platesColored: boolean;
  /** 반바지 색 단계 — 0이면 기본, 1부터 무대 색 */
  outfit: number;
  /** 벨트 고리 · 밴드에 금색 */
  trim: boolean;
}

export function cosmeticsFor(stage: number): Cosmetics {
  const at = clampStage(stage);
  return {
    wristbands: at >= 1,
    belt: at >= 3,
    platesColored: at >= 4,
    outfit: at >= 2 ? at - 1 : 0,
    trim: at >= 5,
  };
}

/* ── 커리어 ─────────────────────────────────────── */

export type SeasonOutcome = 'promoted' | 'again' | 'top';

export interface SeasonResult {
  season: number;
  start: string;
  end: string;
  track: CareerTrack;
  stageBefore: number;
  stageAfter: number;
  outcome: SeasonOutcome;
  /** 0..1, 셀 주가 없었으면 null */
  adherence: number | null;
  score: number;
  keptWeeks: number;
  weeks: number;
  strength: StrengthHighlight | null;
}

export interface SeasonRecord {
  season: number;
  start: string;
  end: string;
  track: CareerTrack;
  stageBefore: number;
  stageAfter: number;
  /** paused — 긴 공백으로 대회 당일을 못 맞은 시즌. 결과 없이 넘어간다 */
  outcome: SeasonOutcome | 'paused';
  adherence: number | null;
}

export interface CurrentSeason {
  number: number;
  start: string;
  peak: string;
  end: string;
}

export interface CareerState {
  version: 1;
  /** 무대 칸 (0..5). 무대 종류가 바뀌어도 칸은 그대로 */
  stage: number;
  track: CareerTrack;
  seasonCount: number;
  current: CurrentSeason | null;
  /** 마지막으로 끝난(또는 멈춘) 시즌의 마지막 날 */
  lastEnded: string | null;
  /** 무대별로 쌓은 지킨 주 — 몸이 자란 정도 */
  banked: Record<CareerTrack, number>;
  /** 여기까지(이 월요일까지)의 주는 이미 쌓았다 */
  bankedThrough: string | null;
  history: SeasonRecord[];
  /** 아직 보여 주지 않은 대회 당일 */
  pending: SeasonResult | null;
  /** 줄여서 한 날 */
  shortDates: string[];
  /** 공유 그림에 기록 숫자를 넣는가 — 기본은 넣지 않는다 */
  shareNumbers: boolean;
}

export const HISTORY_KEEP = 24;
export const SHORT_DATES_KEEP = 200;

export function emptyCareer(track: CareerTrack = 'physique'): CareerState {
  return {
    version: 1, stage: 0, track, seasonCount: 0, current: null, lastEnded: null,
    banked: { physique: 0, platform: 0, open: 0 }, bankedThrough: null, history: [], pending: null,
    shortDates: [], shareNumbers: false,
  };
}

const isDate = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
const isTrack = (value: unknown): value is CareerTrack => CAREER_TRACKS.includes(value as CareerTrack);

/**
 * 저장된 값을 지금 모양으로 — 없는 칸은 기본값, 이상한 값은 버린다. 예전 저장소(이 칸이 없던 때)는
 * 빈 커리어로 시작한다.
 */
export function normalizeCareer(raw: unknown, track?: CareerTrack): CareerState {
  const base = emptyCareer(track);
  if (!raw || typeof raw !== 'object') return base;
  const r = raw as Record<string, unknown>;
  const banked = (r.banked && typeof r.banked === 'object' ? r.banked : {}) as Record<string, unknown>;
  const current = r.current as Record<string, unknown> | null | undefined;
  return {
    version: 1,
    stage: clampStage(Number(r.stage ?? 0)),
    track: track ?? (isTrack(r.track) ? r.track : base.track),
    seasonCount: Math.max(0, Math.floor(Number(r.seasonCount) || 0)),
    current: current && isDate(current.start) && isDate(current.peak) && isDate(current.end)
      ? { number: Math.max(1, Math.floor(Number(current.number) || 1)), start: current.start, peak: current.peak, end: current.end }
      : null,
    lastEnded: isDate(r.lastEnded) ? r.lastEnded : null,
    banked: {
      physique: Math.max(0, Number(banked.physique) || 0),
      platform: Math.max(0, Number(banked.platform) || 0),
      open: Math.max(0, Number(banked.open) || 0),
    },
    bankedThrough: isDate(r.bankedThrough) ? r.bankedThrough : null,
    history: Array.isArray(r.history) ? (r.history as SeasonRecord[]).filter((item) => item && isDate(item.end)).slice(-HISTORY_KEEP) : [],
    pending: r.pending && typeof r.pending === 'object' && isDate((r.pending as SeasonResult).end) ? r.pending as SeasonResult : null,
    shortDates: Array.isArray(r.shortDates) ? (r.shortDates as unknown[]).filter(isDate).slice(-SHORT_DATES_KEEP) : [],
    shareNumbers: r.shareNumbers === true,
  };
}

/** 줄여서 한 날을 적거나 지운다. */
export function markShortDate(career: CareerState, date: string, short: boolean): CareerState {
  const has = career.shortDates.includes(date);
  if (has === short) return career;
  const shortDates = short
    ? [...career.shortDates, date].sort().slice(-SHORT_DATES_KEEP)
    : career.shortDates.filter((item) => item !== date);
  return { ...career, shortDates };
}

/** 대회 당일의 판정. 내려가는 일은 없다. */
export function outcomeFor(stage: number, adherence: number | null): { outcome: SeasonOutcome; stageAfter: number } {
  const at = clampStage(stage);
  if (adherence !== null && adherence >= PROMOTE_AT) {
    return at >= STAGE_COUNT - 1 ? { outcome: 'top', stageAfter: at } : { outcome: 'promoted', stageAfter: at + 1 };
  }
  return { outcome: 'again', stageAfter: at };
}

/** "전국 대회 진출!" · "같은 무대에 다시 도전합니다" */
export function outcomeLine(result: Pick<SeasonResult, 'outcome' | 'track' | 'stageAfter'>): string {
  if (result.outcome === 'promoted') return `${stageName(result.track, result.stageAfter)} 진출!`;
  if (result.outcome === 'top') return `${stageName(result.track, result.stageAfter)}을 지켰습니다`;
  return '같은 무대에 다시 도전합니다';
}

export interface CareerInput {
  /** 지금 블록. 없으면 시즌을 열지 않는다 */
  block: SeasonBlock | null;
  today: string;
  /** 지금까지의 운동 기록 (오늘 한 것 포함) */
  sessions: readonly SessionLog[];
  target: number;
  goals: readonly TrainingGoal[];
  painDates?: readonly string[];
  startDate?: string;
  /** 오늘 운동을 마쳤는가 — 대회 당일에 운동을 마치면 그 자리에서 끝낸다 */
  dayDone?: boolean;
}

export interface CareerStep {
  career: CareerState;
  /** 방금 끝난 시즌 (대회 당일을 보여 줄 것) */
  concluded: SeasonResult | null;
  /** 긴 공백 뒤라 결과 없이 새 시즌으로 넘어갔는가 */
  paused: boolean;
}

/** 이번 시즌 점수에 넘길 입력 */
export function scoreInput(career: CareerState, input: CareerInput, window: SeasonWindow): SeasonScoreInput {
  return {
    sessions: input.sessions,
    window,
    target: input.target,
    today: input.today,
    shortDates: career.shortDates,
    painDates: input.painDates,
    startDate: input.startDate,
    pastPeaks: career.history.map((item) => addDays(item.end, -6)),
  };
}

export function windowOf(current: CurrentSeason): SeasonWindow {
  const weeks: string[] = [];
  for (let at = current.start; at <= current.peak; at = addDays(at, 7)) weeks.push(at);
  return { start: current.start, peak: current.peak, end: current.end, weeks };
}

/** 그 날 전에 마지막으로 운동한 날 */
function lastTrainedOnOrBefore(sessions: readonly SessionLog[], date: string): string | undefined {
  let last: string | undefined;
  for (const session of sessions) {
    if (session.date > date || !isWorkingSession(session)) continue;
    if (!last || session.date > last) last = session.date;
  }
  return last;
}

/** 이만큼 쉬다 대회 당일을 맞았으면 결과 없이 새 시즌으로 (blocks.ts의 BLOCK_RESTART_GAP_DAYS와 같은 2주) */
export const SEASON_PAUSE_GAP_DAYS = 14;

/**
 * 하루 한 번(앱을 열 때 · 운동을 마칠 때) 커리어를 앞으로.
 *
 *   1. 대회 당일이 지났으면(당일에 운동을 마쳤으면 그때) 시즌을 끝낸다. 다만 마지막 2주를 통째로
 *      쉬다 맞은 대회 당일은 판정하지 않는다 — 복귀(comeback.ts)한 사람에게 "다시 도전"부터 들이밀지 않는다.
 *   2. 블록이 쉬어서 다시 시작됐으면(blocks.ts의 restartIfInterrupted) 그 시즌은 조용히 접는다.
 *   3. 지킨 주를 지금 무대 몫으로 쌓는다(몸이 자란다).
 *   4. 열린 시즌이 없으면 지금 블록으로 새 시즌을 연다.
 */
export function advanceCareer(career: CareerState, input: CareerInput): CareerStep {
  const track = trackForGoals(input.goals);
  let c: CareerState = { ...normalizeCareer(career), track };
  let concluded: SeasonResult | null = null;
  let paused = false;
  const window = input.block ? seasonWindow(input.block) : null;

  // 피로가 먼저 쌓여 일찍 덜어냈으면 피킹 주 · 대회 당일이 당겨진다
  if (c.current && window && window.start === c.current.start && window.peak !== c.current.peak) {
    c = { ...c, current: { ...c.current, peak: window.peak, end: window.end } };
  }

  if (c.current) {
    const current = c.current;
    const ended = input.today > current.end || (input.today === current.end && Boolean(input.dayDone));
    if (ended) {
      const last = lastTrainedOnOrBefore(input.sessions, current.end);
      const gap = planComeback({ lastTrainedISO: last && last >= current.start ? last : undefined, today: current.end });
      const away = !last || last < current.start || gap.gapDays >= SEASON_PAUSE_GAP_DAYS;
      if (away) {
        paused = true;
        c = closeSeason(c, { season: current.number, start: current.start, end: current.end, track, stageBefore: c.stage, stageAfter: c.stage, outcome: 'paused', adherence: null });
      } else {
        concluded = concludeSeason(c, input, current);
        c = closeSeason({ ...c, stage: concluded.stageAfter, pending: concluded }, {
          season: concluded.season, start: concluded.start, end: concluded.end, track: concluded.track,
          stageBefore: concluded.stageBefore, stageAfter: concluded.stageAfter, outcome: concluded.outcome, adherence: concluded.adherence,
        });
      }
    } else if (window && window.start > current.start) {
      // 쉬어서 블록을 다시 셌다 — 대회 당일 전에 접힌 시즌. 무대는 그대로
      paused = true;
      c = closeSeason(c, { season: current.number, start: current.start, end: addDays(window.start, -1), track, stageBefore: c.stage, stageAfter: c.stage, outcome: 'paused', adherence: null });
    }
  }

  c = bankKeptWeeks(c, input, track);

  if (!c.current && window && (!c.lastEnded || window.start > c.lastEnded) && input.today <= window.end) {
    const number = c.seasonCount + 1;
    c = { ...c, seasonCount: number, current: { number, start: window.start, peak: window.peak, end: window.end } };
  }

  return { career: c, concluded, paused };
}

function closeSeason(c: CareerState, record: SeasonRecord): CareerState {
  return { ...c, current: null, lastEnded: record.end, history: [...c.history, record].slice(-HISTORY_KEEP) };
}

/** 시즌을 끝내고 결과를 낸다 — 피킹 주까지 다 끝난 것으로 셈한다. */
export function concludeSeason(c: CareerState, input: CareerInput, current: CurrentSeason): SeasonResult {
  const window = windowOf(current);
  const progress = seasonProgress({ ...scoreInput(c, input, window), today: addDays(window.end, 1) });
  const { outcome, stageAfter } = outcomeFor(c.stage, progress.adherence);
  return {
    season: current.number,
    start: window.start,
    end: window.end,
    track: c.track,
    stageBefore: c.stage,
    stageAfter,
    outcome,
    adherence: progress.adherence === null ? null : round3(progress.adherence),
    score: progress.score,
    keptWeeks: progress.keptWeeks,
    weeks: window.weeks.length,
    strength: seasonStrengthHighlight(input.sessions, window),
  };
}

/** 끝난 주 중 지킨 주를 지금 무대 몫으로 쌓는다. 한 번 쌓은 주는 다시 세지 않는다. */
function bankKeptWeeks(c: CareerState, input: CareerInput, track: CareerTrack): CareerState {
  const thisMonday = weekStart(input.today);
  const weeks = streakFor({
    sessions: input.sessions,
    thisMonday,
    target: input.target,
    today: input.today,
    startDate: input.startDate,
    deloadWeeks: [...c.history.map((item) => addDays(item.end, -6)), ...(c.current ? [c.current.peak] : [])],
  });
  let add = 0;
  let through = c.bankedThrough;
  for (const week of weeks) {
    if (week.open || week.weekStart >= thisMonday) continue;
    if (c.bankedThrough && week.weekStart <= c.bankedThrough) continue;
    if (week.kept) add += 1;
    if (!through || week.weekStart > through) through = week.weekStart;
  }
  if (add === 0 && through === c.bankedThrough) return c;
  return { ...c, banked: { ...c.banked, [track]: c.banked[track] + add }, bankedThrough: through };
}

/** 지금 자란 정도 — 쌓은 주에 이번 주(지켰으면)를 더한다. */
export function currentGrowth(c: CareerState, thisWeekKept: boolean): AvatarGrowth {
  return avatarGrowth(thisWeekKept ? { ...c.banked, [c.track]: c.banked[c.track] + 1 } : c.banked);
}

/* ── 운동 뒤 한 줄 ───────────────────────────────── */

/**
 * 오늘 운동으로 오른 점수와 다음 걸음까지 — "+20점 · 시 대회 Ⅱ까지 30점".
 * before는 오늘 기록을 뺀 점수, after는 넣은 점수.
 */
export function seasonFeedbackLine(track: CareerTrack, stage: number, before: SeasonProgress, after: SeasonProgress): string {
  const gained = Math.max(0, after.score - before.score);
  const head = gained > 0 ? `+${gained}점` : '이번 주 약속은 이미 채웠습니다';
  if (after.toNext !== null) {
    return `${head} · ${stageLabel(track, stage, after.subStep + 1)}까지 ${after.toNext}점`;
  }
  return after.daysLeft > 0 ? `${head} · 대회까지 ${after.daysLeft}일` : `${head} · 오늘이 대회 당일입니다`;
}

/* ── 코치 한마디 ─────────────────────────────────── */

/** 대회 당일 화면이 열릴 때 코치가 하는 말. 오른 시즌 · 다시 서는 시즌 두 가지. */
export function seasonDayLine(style: CoachStyle, outcome: SeasonOutcome): string {
  const up = outcome !== 'again';
  const lines: Record<CoachStyle, [string, string]> = {
    energetic: ['대회 당일이에요! 약속을 지켜 낸 덕분에 다음 무대로 올라갑니다!', '대회 당일이에요! 이번 시즌도 수고했어요. 같은 무대에서 한 번 더 가 봐요!'],
    gentle: ['대회 당일입니다. 꾸준히 지켜 오신 덕분에 다음 무대로 올라갑니다.', '대회 당일입니다. 이번 시즌도 수고 많으셨습니다. 같은 무대에서 다시 해 보겠습니다.'],
    tough: ['대회 날이다. 약속 지킨 만큼 올라간다.', '대회 날이다. 내려가는 건 없다. 같은 무대에서 다시 간다.'],
    fun: ['대회 당일! 다음 무대 입장권 획득입니다.', '대회 당일! 이번엔 리허설이었던 걸로 하고, 같은 무대 앙코르 갑니다.'],
  };
  return lines[style][up ? 0 : 1];
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}
