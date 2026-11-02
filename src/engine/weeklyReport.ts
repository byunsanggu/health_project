import { MUSCLE_LABELS_KO } from './muscles.ts';
import { withParticle } from './korean.ts';
import { volumeReport } from './volume.ts';
import type { MuscleVolumeStatus, VolumeOptions } from './volume.ts';
import { weeklyLoad } from './cardio.ts';
import type { CardioLog } from './cardio.ts';
import type { Exercise, LandmarksByMuscle, SessionLog } from './types.ts';

/**
 * 한 주를 한 장으로.
 *
 * 회원이 앱을 계속 쓰게 만드는 건 기능이 아니라 **한 주가 끝났을 때 손에
 * 남는 것**이다. 카톡으로 보낼 수 있는 한 장이 있으면 그 주가 기억에
 * 남고, 다음 주에 앱을 다시 연다.
 *
 * 다만 잘한 주만 예쁘게 뽑으면 안 된다. 볼륨이 모자란 주는 모자랐다고
 * 써야 그 다음 장을 믿는다 — 늘 칭찬만 하는 리포트는 아무도 안 본다.
 */

export interface ReportMuscle {
  muscle: string;
  label: string;
  sets: number;
  zone: MuscleVolumeStatus['zone'];
  /** 게이지를 0~1로 — MRV를 1로 둔다 */
  fill: number;
}

export interface ReportGain {
  name: string;
  /** "+5kg" 또는 "같은 무게 2회 더" */
  detail: string;
  up: boolean;
}

export interface WeeklyReport {
  /** "9월 3주차" */
  weekLabel: string;
  from: string;
  to: string;
  sessionCount: number;
  /** 워밍업을 뺀 실제 세트 수 */
  setCount: number;
  /** RIR로 가중한 유효 세트 */
  effectiveSets: number;
  /** 들어 올린 총 무게 (kg) */
  tonnage: number;
  /*
   * 그 주의 유산소.
   *
   * 근력과 따로 세지만 한 장에는 같이 나와야 한다. 유산소를 했는데
   * 주간 요약에 없으면 "이 앱은 유산소를 안 친다"로 읽힌다.
   */
  cardio: { count: number; minutes: number; text: string };
  muscles: ReportMuscle[];
  gains: ReportGain[];
  /** 한 줄 제목 — 이 주를 한마디로 */
  headline: string;
  /** 다음 주에 뭘 할지 한 줄 */
  advice: string;
  /** 운동한 날 (YYYY-MM-DD) */
  days: string[];
  /**
   * 이번 주 계획한 날이 아직 남았고 목표 횟수도 다 안 채웠는가. 그러면 제목 · 조언을 "진행 중"으로 말하고
   * (3번 중 1번 했습니다 · 수 · 금 남음), 부위별 최소 아래도 '부족'이 아니라 '진행 중'이다.
   */
  inProgress: boolean;
}

export interface WeeklyReportInput {
  /** 이번 주 세션 */
  sessions: readonly SessionLog[];
  /** 지지난 주까지 포함한 이력 — 중량 비교에 쓴다 */
  history: readonly SessionLog[];
  landmarks: LandmarksByMuscle;
  index: ReadonlyMap<string, Exercise>;
  /** 주의 시작·끝 (YYYY-MM-DD) */
  from: string;
  to: string;
  /** 주 몇 회 하기로 했는가 */
  targetSessions?: number;
  /**
   * 이번 주 계획한 운동일 중 아직 안 온 날(YYYY-MM-DD) — plannedDaysLeft로 구한다.
   * 비어 있지 않으면 주가 아직 진행 중이라 지난 일처럼 말하지 않는다("계획은 3번이었습니다" ×).
   * 지난주 리포트처럼 끝난 주는 넘기지 않는다.
   */
  remainingDays?: readonly string[];
  options?: VolumeOptions;
}

const WEEKDAY_KO = ['일', '월', '화', '수', '목', '금', '토'];

/** "2026-09-23" → "수" */
export function weekdayKo(date: string): string {
  const [year, month, day] = date.split('-').map((part) => Number(part));
  if (!year || !month || !day) return '';
  return WEEKDAY_KO[new Date(Date.UTC(year, month - 1, day)).getUTCDay()] ?? '';
}

/**
 * 이번 주 계획한 운동일 중 아직 남은 날.
 *
 * 오늘이 계획한 날이고 아직 안 했으면 남은 날로 친다. 오늘 이미 했거나 지난 날은 뺀다 — 지난 날을
 * 놓쳤다고 "남았다"고 하면 거짓말이 된다. 결과가 비어 있으면 그 주는 끝난 것으로 보고 과거형으로 말한다.
 */
export function plannedDaysLeft(input: {
  /** 이번 주 계획한 운동일 (YYYY-MM-DD) */
  planned: readonly string[];
  /** 이번 주 운동한 날 (YYYY-MM-DD) */
  done: readonly string[];
  today: string;
}): string[] {
  const done = new Set(input.done);
  return [...new Set(input.planned)]
    .filter((date) => date > input.today || (date === input.today && !done.has(date)))
    .sort();
}

/**
 * 이번 주가 아직 진행 중인가 — 계획한 날이 남았고 목표 횟수도 다 안 채웠으면 그렇다.
 * 요약 · 근성장 체크 · 부위별 세트가 '부족' 대신 '진행 중'이라고 쓸지 정할 때 쓴다(zoneLabelKo).
 */
export function weekInProgress(input: {
  planned: readonly string[];
  done: readonly string[];
  today: string;
  /** 주 몇 회 하기로 했는가. 없으면 계획한 날 수 */
  targetSessions?: number;
}): boolean {
  const doneCount = new Set(input.done).size;
  const target = input.targetSessions ?? new Set(input.planned).size;
  return doneCount < target && plannedDaysLeft(input).length > 0;
}

/** "2026-09-25" → "9월 4주차" */
export function weekLabelOf(date: string): string {
  const [, month, day] = date.split('-').map((part) => Number(part));
  if (!month || !day) return date;
  return `${month}월 ${Math.min(5, Math.ceil(day / 7))}주차`;
}

function workingSets(session: SessionLog) {
  return session.sets.filter((set) => !set.warmup && set.reps > 0);
}

/**
 * 이번 주에 오른 종목.
 *
 * 같은 종목을 이번 주와 지난주에 모두 했을 때만 비교한다. 지난주에 안 한
 * 종목을 "새 기록"이라고 부르면 그건 기록이 아니라 처음 한 것이다.
 */
function findGains(input: WeeklyReportInput): ReportGain[] {
  const best = new Map<string, { weightKg: number; reps: number }>();
  for (const session of input.sessions) {
    for (const set of workingSets(session)) {
      const prev = best.get(set.exerciseId);
      if (!prev || set.weightKg > prev.weightKg
        || (set.weightKg === prev.weightKg && set.reps > prev.reps)) {
        best.set(set.exerciseId, { weightKg: set.weightKg, reps: set.reps });
      }
    }
  }

  const before = new Map<string, { weightKg: number; reps: number }>();
  for (const session of input.history) {
    if (session.date >= input.from) continue;
    for (const set of workingSets(session)) {
      const prev = before.get(set.exerciseId);
      if (!prev || set.weightKg > prev.weightKg
        || (set.weightKg === prev.weightKg && set.reps > prev.reps)) {
        before.set(set.exerciseId, { weightKg: set.weightKg, reps: set.reps });
      }
    }
  }

  const gains: ReportGain[] = [];
  for (const [exerciseId, now] of best) {
    const then = before.get(exerciseId);
    if (!then) continue;
    const exercise = input.index.get(exerciseId);
    if (!exercise) continue;

    if (now.weightKg > then.weightKg) {
      gains.push({
        name: exercise.name,
        detail: `+${round(now.weightKg - then.weightKg)}kg`,
        up: true,
      });
    } else if (now.weightKg === then.weightKg && now.reps > then.reps) {
      /*
       * 무게가 같으면 1RM 환산으로 부풀리지 않는다. 늘어난 건 반복이고,
       * 반복이 늘어난 것도 충분히 오른 것이다.
       */
      gains.push({
        name: exercise.name,
        detail: `같은 무게 ${now.reps - then.reps}회 더`,
        up: true,
      });
    }
  }

  // 큰 것부터. kg이 붙은 쪽을 앞에 둔다.
  return gains
    .sort((a, b) => Number(b.detail.startsWith('+')) - Number(a.detail.startsWith('+')))
    .slice(0, 3);
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

function fillOf(row: MuscleVolumeStatus): number {
  const mrv = row.landmark.mrv || 1;
  return Math.max(0, Math.min(1.15, row.effectiveSets / mrv));
}

/**
 * 이 주를 한마디로.
 *
 * 숫자를 다시 읽어 주는 제목은 쓸모가 없다("12세트 했습니다"). 이 주가
 * 어떤 주였는지를 말해야 한다.
 */
function headlineOf(
  sessionCount: number,
  target: number,
  muscles: ReportMuscle[],
  gains: ReportGain[],
  remaining: readonly string[],
): string {
  /*
   * 계획한 날이 남은 주는 진행 중으로 말한다. 월요일 첫 운동 직후에 "1번 했습니다 · 계획은 3번이었습니다"는
   * 이미 놓친 것처럼 읽혔다. 과거형은 그 주의 마지막 계획일이 지난 뒤에만.
   */
  if (sessionCount < target && remaining.length > 0) {
    return `${target}번 중 ${sessionCount}번 했습니다 · ${remaining.map(weekdayKo).join(' · ')} 남음`;
  }
  if (sessionCount === 0) return '이번 주는 쉬었습니다';
  if (sessionCount < target) return `${sessionCount}번 했습니다 · 계획은 ${target}번이었습니다`;
  if (gains.length > 0 && gains[0]) {
    return `${withParticle(gains[0].name, '이/가')} ${gains[0].detail} 올랐습니다`;
  }
  const over = muscles.filter((row) => row.zone === 'overMrv');
  if (over.length > 0 && over[0]) return `${over[0].label} 세트가 한 주 최대를 넘었습니다`;
  return `${sessionCount}번 다 했습니다`;
}

/** 다음 주에 뭘 할지. 칭찬이 아니라 지시여야 한다. */
function adviceOf(
  sessionCount: number,
  target: number,
  muscles: ReportMuscle[],
  remaining: readonly string[],
): string {
  if (sessionCount < target && remaining.length > 0) {
    const left = Math.min(target - sessionCount, remaining.length);
    return `남은 ${left}번을 마저 하면 이번 주 계획을 채웁니다.`;
  }
  if (sessionCount === 0) return '다음 주에 한 번만 나가면 다시 굴러갑니다.';
  if (sessionCount < target) {
    return `다음 주는 ${target}번을 먼저 채워 보세요. 무게는 그다음입니다.`;
  }

  const over = muscles.filter((row) => row.zone === 'overMrv');
  if (over.length > 0 && over[0]) {
    return `${withParticle(over[0].label, '은/는')} 다음 주에 세트를 줄이세요. 더 해도 안 자랍니다.`;
  }

  const under = muscles
    .filter((row) => row.zone === 'underMev' && row.sets > 0)
    .sort((a, b) => a.fill - b.fill);
  if (under.length > 0 && under[0]) {
    return `${withParticle(under[0].label, '은/는')} 아직 한 주 최소 세트보다 적습니다. 다음 주에 두 세트만 더 하세요.`;
  }

  return '부위별 세트가 알맞습니다. 다음 주는 무게를 올릴 차례입니다.';
}

export function buildWeeklyReport(input: WeeklyReportInput): WeeklyReport {
  const sessions = input.sessions.filter(
    (session) => session.date >= input.from && session.date <= input.to,
  );

  const sets = sessions.flatMap(workingSets);
  const tonnage = sets.reduce((sum, set) => sum + set.weightKg * set.reps, 0);

  /*
   * 유산소는 세션 안에 들어 있다. 따로 받지 않는다 — 인자가 하나 더
   * 늘면 부르는 쪽에서 빠뜨리고, 빠뜨리면 조용히 0이 된다.
   */
  const cardioLogs = sessions.flatMap(
    (session) => (session.cardio ?? []) as unknown as CardioLog[],
  );
  const cardioLoad = weeklyLoad(cardioLogs);

  const report = volumeReport(sessions, input.landmarks, input.index, input.options);
  const muscles: ReportMuscle[] = report
    .filter((row) => row.effectiveSets > 0)
    .map((row) => ({
      muscle: row.muscle,
      label: MUSCLE_LABELS_KO[row.muscle],
      sets: round(row.effectiveSets),
      zone: row.zone,
      fill: fillOf(row),
    }))
    .sort((a, b) => b.sets - a.sets);

  const gains = findGains({ ...input, sessions });
  const target = input.targetSessions ?? 4;
  const days = [...new Set(sessions.map((session) => session.date))].sort();
  const remaining = (input.remainingDays ?? []).filter((date) => date >= input.from && date <= input.to);
  const inProgress = days.length < target && remaining.length > 0;

  return {
    weekLabel: weekLabelOf(input.to),
    from: input.from,
    to: input.to,
    sessionCount: days.length,
    setCount: sets.length,
    effectiveSets: round(muscles.reduce((sum, row) => sum + row.sets, 0)),
    tonnage: Math.round(tonnage),
    cardio: {
      count: cardioLogs.length,
      minutes: cardioLoad.minutes,
      text: cardioLoad.text,
    },
    muscles,
    gains,
    headline: headlineOf(days.length, target, muscles, gains, remaining),
    advice: adviceOf(days.length, target, muscles, remaining),
    days,
    inProgress,
  };
}

/** 카톡에 붙여 넣을 수 있는 글. 이미지를 못 만드는 기기도 있다. */
export function reportText(report: WeeklyReport): string {
  const lines = [
    `[볼륨 코치] ${report.weekLabel}`,
    report.headline,
    '',
    `운동 ${report.sessionCount}회 · ${report.setCount}세트 · ${report.tonnage.toLocaleString('ko-KR')}kg`,
  ];

  if (report.muscles.length > 0) {
    lines.push('');
    for (const row of report.muscles.slice(0, 6)) {
      lines.push(`· ${row.label} ${row.sets}세트 ${zoneWord(row.zone, report.inProgress)}`);
    }
  }

  if (report.cardio.count > 0) {
    lines.push('', `유산소 ${report.cardio.count}회 · ${report.cardio.minutes}분`);
  }

  if (report.gains.length > 0) {
    lines.push('');
    for (const gain of report.gains) lines.push(`· ${gain.name} ${gain.detail}`);
  }

  lines.push('', report.advice);
  return lines.join('\n');
}

export function zoneWord(zone: MuscleVolumeStatus['zone'], inProgress = false): string {
  if (zone === 'underMev') return inProgress ? '진행 중' : '부족';
  if (zone === 'mevToMav') return '적정';
  if (zone === 'mavToMrv') return '높음';
  return '한계 초과';
}
