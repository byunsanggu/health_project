import { JOINT_LABELS_KO } from './pain.ts';
import { PATTERN_LABELS_KO } from './demos.ts';
import { withParticle } from './korean.ts';
import type { CheckIn, Exercise, Joint, MovementPattern, SessionLog } from './types.ts';

/**
 * 통증 이력.
 *
 * "오늘 어깨가 아프다"는 한 번 듣고 종목을 바꾸면 끝나는 정보다. 그런데
 * 20년 한 트레이너가 실제로 쓰는 건 그게 아니라 **"왼쪽 어깨, 3주째,
 * 항상 오버헤드 다음 날"** 이다. 한 점이 아니라 선을 본다.
 *
 * 앱은 이미 체크인에서 매번 통증을 받고 있었다. 받아서 그날 종목만
 * 바꾸고 버리고 있었을 뿐이다. 이 모듈은 버리던 것을 이어 붙인다.
 *
 * **진단하지 않는다.** 여기서 나오는 건 "언제부터, 얼마나, 어떤 동작
 * 뒤에 보고됐는가"뿐이다. 같이 나왔다는 것과 원인이라는 것은 다른
 * 말이고, 그 선을 넘으면 앱이 의료기기가 된다. 대신 **길어지거나
 * 나빠지면 병원에 가라고 말한다** — 그건 트레이너가 하는 일이 맞다.
 */

export interface PainPoint {
  date: string;
  score: number;
}

export type PainTrend = 'better' | 'worse' | 'flat' | 'gone';

export interface PainTrigger {
  pattern: MovementPattern;
  label: string;
  /** 이 동작을 한 뒤 통증이 보고된 횟수 */
  count: number;
  /** 이 동작을 한 날 중 통증이 뒤따른 비율 0~1 */
  rate: number;
  /** 이 동작을 안 한 날의 비율 — 견주어 봐야 뜻이 있다 */
  baseRate: number;
}

export interface JointHistory {
  joint: Joint;
  label: string;
  /** 오래된 순 */
  points: PainPoint[];
  /** 마지막으로 보고된 점수 */
  latest: number;
  /** 제일 높았던 점수 */
  peak: number;
  /** 처음 보고된 날부터 마지막까지 며칠인가 */
  days: number;
  trend: PainTrend;
  triggers: PainTrigger[];
  /**
   * 후보들이 늘 같은 날에 같이 나왔는가.
   *
   * 오버헤드와 레터럴 레이즈를 늘 같은 날에 한다면, 둘 중 어느 쪽이
   * 어깨를 건드리는지는 이 기록으로 알 수 없다. 모르는 것은 모른다고
   * 말해야 한다 — 하나를 찍어서 말하면 멀쩡한 종목을 버리게 된다.
   */
  ambiguous: boolean;
  /** 화면에 그대로 쓸 한 줄 */
  summary: string;
  /** 전문의를 권해야 하는가 — 이유가 들어 있다 */
  referral?: string;
}

/** 이 점수부터 "통증"으로 센다. pain.ts가 종목을 조정하는 기준과 같다. */
export const PAIN_THRESHOLD = 3;

/**
 * 몇 주부터 "길어졌다"고 보는가.
 *
 * 2주까지는 흔한 일이다. 6주를 넘으면 그건 운동으로 어떻게 해 볼
 * 단계가 아니라 한 번 봐야 하는 단계다.
 */
export const CHRONIC_DAYS = 42;
const LINGERING_DAYS = 14;

/**
 * 어떤 동작 뒤에 아팠다고 말하려면 몇 번은 봐야 하는가.
 *
 * 세 번으로는 아무 말도 할 수 없다. 우연히 두 번 겹치는 일은 늘
 * 있고, 그걸 "패턴"이라고 부르면 사용자는 멀쩡한 종목을 버린다.
 */
const MIN_TRIGGER_COUNT = 3;
/** 안 한 날보다 이만큼은 높아야 말할 값어치가 있다. */
const MIN_RATE_GAP = 0.25;

/**
 * 동작을 하고 나서 며칠 안에 보고된 통증을 그 동작과 묶어 볼 것인가.
 *
 * **같은 날은 세지 않는다.** 체크인은 운동 "전"에 한다 — 그날 아침에
 * 적은 통증이 그날 저녁 운동 때문일 수는 없다. 같은 날을 세면 매일
 * 하는 동작이 늘 1등으로 나오고, 그 목록은 거짓말이 된다.
 */
/** 이 관절에 이만큼은 실려야 후보로 본다. */
const JOINT_LOAD_FLOOR = 0.5;

const LAG_FROM = 1;
const LAG_TO = 2;

export interface PainHistoryInput {
  checkIns: readonly CheckIn[];
  sessions: readonly SessionLog[];
  index: ReadonlyMap<string, Exercise>;
  /** 오늘 (YYYY-MM-DD) */
  today: string;
  /** 며칠까지 거슬러 볼 것인가 */
  lookbackDays?: number;
}

function daysBetween(from: string, to: string): number {
  const a = Date.parse(from + 'T00:00:00Z');
  const b = Date.parse(to + 'T00:00:00Z');
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((b - a) / 86400000);
}

/**
 * 추세.
 *
 * 마지막 한 점으로 정하면 안 된다. 아픈 정도는 날마다 출렁이고, 어제
 * 좋았다고 낫는 중인 게 아니다. 앞 절반과 뒤 절반의 평균을 견준다.
 */
function trendOf(points: readonly PainPoint[]): PainTrend {
  const last = points[points.length - 1];
  if (!last || last.score < PAIN_THRESHOLD) return 'gone';
  if (points.length < 3) return 'flat';

  const half = Math.floor(points.length / 2);
  const early = points.slice(0, half);
  const late = points.slice(points.length - half);
  const mean = (list: readonly PainPoint[]) =>
    list.reduce((sum, point) => sum + point.score, 0) / (list.length || 1);

  const delta = mean(late) - mean(early);
  if (delta <= -1) return 'better';
  if (delta >= 1) return 'worse';
  return 'flat';
}

/**
 * 어떤 동작 뒤에 아팠는가.
 *
 * 그 동작을 한 날의 "다음 이틀 안에 통증이 보고된 비율"과, 안 한 날의
 * 같은 비율을 견준다. 견주지 않으면 "매일 하는 동작"이 늘 1등이 된다 —
 * 그건 패턴이 아니라 그 사람이 그 동작을 많이 한다는 뜻일 뿐이다.
 */
function triggersFor(
  joint: Joint,
  painDates: ReadonlySet<string>,
  input: PainHistoryInput,
  allDates: readonly string[],
): PainTrigger[] {
  // 날짜마다 그날 한 동작 패턴
  const patternsByDate = new Map<string, Set<MovementPattern>>();
  for (const session of input.sessions) {
    const patterns = patternsByDate.get(session.date) ?? new Set<MovementPattern>();
    for (const set of session.sets) {
      if (set.warmup) continue;
      const exercise = input.index.get(set.exerciseId);
      if (!exercise) continue;
      /*
       * 그 관절에 크게 실리는 동작만 후보로 본다.
       *
       * 기준이 낮으면 스쿼트가 어깨 통증 후보로 올라온다 — 바를 메느라
       * 어깨를 쓰긴 하지만, 그걸 어깨 통증 후보라고 내놓으면 트레이너는
       * 그 목록 전체를 안 믿는다. 0.5면 "그 관절이 주로 일하는 동작"이다.
       */
      if ((exercise.jointStress[joint] ?? 0) < JOINT_LOAD_FLOOR) continue;
      patterns.add(exercise.pattern);
    }
    patternsByDate.set(session.date, patterns);
  }

  const painFollows = (date: string): boolean => {
    for (let lag = LAG_FROM; lag <= LAG_TO; lag += 1) {
      const time = Date.parse(date + 'T00:00:00Z');
      if (Number.isNaN(time)) continue;
      const next = new Date(time + lag * 86400000).toISOString().slice(0, 10);
      if (painDates.has(next)) return true;
    }
    return false;
  };

  const seen = new Set<MovementPattern>();
  for (const patterns of patternsByDate.values()) {
    for (const pattern of patterns) seen.add(pattern);
  }

  const out: PainTrigger[] = [];
  for (const pattern of seen) {
    let withDays = 0;
    let withPain = 0;
    let withoutDays = 0;
    let withoutPain = 0;

    for (const date of allDates) {
      const did = patternsByDate.get(date)?.has(pattern) ?? false;
      const followed = painFollows(date);
      if (did) {
        withDays += 1;
        if (followed) withPain += 1;
      } else {
        withoutDays += 1;
        if (followed) withoutPain += 1;
      }
    }

    if (withPain < MIN_TRIGGER_COUNT || withDays === 0) continue;
    const rate = withPain / withDays;
    const baseRate = withoutDays > 0 ? withoutPain / withoutDays : 0;
    if (rate - baseRate < MIN_RATE_GAP) continue;

    out.push({
      pattern,
      label: PATTERN_LABELS_KO[pattern],
      count: withPain,
      rate: Math.round(rate * 100) / 100,
      baseRate: Math.round(baseRate * 100) / 100,
    });
  }

  return out.sort((a, b) => (b.rate - b.baseRate) - (a.rate - a.baseRate)).slice(0, 2);
}

/** 후보들이 늘 붙어 다니면 가릴 수 없다. */
function isAmbiguous(triggers: readonly PainTrigger[]): boolean {
  if (triggers.length < 2) return false;
  const [first, second] = triggers;
  if (!first || !second) return false;
  return first.count === second.count && Math.abs(first.rate - second.rate) < 0.01;
}

function summarize(history: Omit<JointHistory, 'summary' | 'referral'>): string {
  const { label, days, latest, trend, triggers, points } = history;

  if (trend === 'gone') {
    return `${label} — ${points.length}번 보고됐고 지금은 없습니다.`;
  }

  const span = days >= 14
    ? `${Math.floor(days / 7)}주째`
    : days >= 1 ? `${days}일째` : '오늘';

  const direction = trend === 'better' ? '나아지는 중입니다'
    : trend === 'worse' ? '심해지고 있습니다'
    : '그대로입니다';

  const head = `${label} ${span} · ${latest}점 · ${direction}`;
  if (triggers.length === 0) return head;

  const first = triggers[0] as PainTrigger;
  if (history.ambiguous) {
    const names = triggers.map((trigger) => trigger.label).join('·');
    return `${head}. ${names}을 한 날 뒤에 ${first.count}번 나왔습니다 — 늘 같은 날에 해서 어느 쪽인지는 가릴 수 없습니다.`;
  }
  return `${head}. ${withParticle(first.label, '을/를')} 한 날 뒤에 ${first.count}번 나왔습니다.`;
}

/**
 * 병원에 가라고 말해야 하는가.
 *
 * 트레이너가 하는 일 중에 제일 중요한 것 하나가 "이건 내 영역이
 * 아니다"를 아는 것이다. 앱도 같아야 한다 — 진단은 안 하되, 보내야
 * 할 때는 보낸다.
 */
function referralFor(history: Omit<JointHistory, 'summary' | 'referral'>): string | undefined {
  const { label, days, latest, peak, trend } = history;
  if (latest < PAIN_THRESHOLD) return undefined;

  if (days >= CHRONIC_DAYS) {
    return `${withParticle(label, '이/가')} ${Math.floor(days / 7)}주째입니다. ` +
      '운동으로 조정할 단계를 넘었습니다 — 전문의 진료를 받아 보세요.';
  }
  if (trend === 'worse' && days >= LINGERING_DAYS) {
    return `${withParticle(label, '이/가')} ${Math.floor(days / 7)}주 넘게 이어지면서 심해지고 있습니다. ` +
      '한 번 진료를 받아 보시는 게 좋겠습니다.';
  }
  if (peak >= 7) {
    return `${label} 통증이 ${peak}점까지 올라간 적이 있습니다. ` +
      '밤에 아프거나 저리거나 힘이 빠지는 느낌이 있으면 바로 진료를 받으세요.';
  }
  return undefined;
}

/**
 * 관절마다 이력 한 줄씩.
 *
 * 지금 안 아픈 관절도 최근에 아팠으면 넣는다 — "지난주에 나았다"는
 * 것도 알아야 하는 정보다. 아예 기록이 없는 관절만 빠진다.
 */
export function painHistory(input: PainHistoryInput): JointHistory[] {
  const lookback = input.lookbackDays ?? 120;
  const since = new Date(
    Date.parse(input.today + 'T00:00:00Z') - lookback * 86400000,
  ).toISOString().slice(0, 10);

  const checkIns = input.checkIns
    .filter((checkIn) => checkIn.date >= since && checkIn.date <= input.today)
    .slice()
    .sort((a, b) => (a.date < b.date ? -1 : 1));

  const allDates = [...new Set(
    checkIns.map((checkIn) => checkIn.date)
      .concat(input.sessions
        .filter((session) => session.date >= since && session.date <= input.today)
        .map((session) => session.date)),
  )].sort();

  const byJoint = new Map<Joint, PainPoint[]>();
  for (const checkIn of checkIns) {
    for (const report of checkIn.pain ?? []) {
      if (report.score < PAIN_THRESHOLD) continue;
      const points = byJoint.get(report.joint) ?? [];
      points.push({ date: checkIn.date, score: report.score });
      byJoint.set(report.joint, points);
    }
  }

  const out: JointHistory[] = [];
  for (const [joint, points] of byJoint) {
    const first = points[0];
    const last = points[points.length - 1];
    if (!first || !last) continue;

    /*
     * "지금 몇 점인가"는 마지막 보고가 아니라 **마지막 체크인**을 봐야
     * 한다. 사흘 전에 5점이었고 그 뒤로 체크인에서 안 적었으면, 그건
     * 5점이 아니라 없어진 것이다.
     */
    const lastCheckIn = checkIns[checkIns.length - 1];
    const stillReported = lastCheckIn
      && (lastCheckIn.pain ?? []).some(
        (report) => report.joint === joint && report.score >= PAIN_THRESHOLD,
      );
    const latest = stillReported ? last.score : 0;

    /*
     * 이어지는 통증은 하루로 친다.
     *
     * 사흘 내리 아팠으면 사흘 다 세는 게 아니라 "처음 아픈 날" 하나가
     * 사건이다. 안 그러면 오래 아픈 사람일수록 모든 동작이 유발 후보가
     * 된다 — 며칠 아프면 그 앞에 뭘 했든 다 걸린다.
     */
    const reported = new Set(points.map((point) => point.date));
    const painDates = new Set(
      points
        .filter((point) => {
          const time = Date.parse(point.date + 'T00:00:00Z');
          if (Number.isNaN(time)) return true;
          const previous = new Date(time - 86400000).toISOString().slice(0, 10);
          return !reported.has(previous);
        })
        .map((point) => point.date),
    );
    const base = {
      joint,
      label: JOINT_LABELS_KO[joint],
      points,
      latest,
      peak: points.reduce((max, point) => Math.max(max, point.score), 0),
      days: daysBetween(first.date, last.date),
      trend: stillReported ? trendOf(points) : ('gone' as PainTrend),
      triggers: [] as PainTrigger[],
      ambiguous: false,
    };
    base.triggers = triggersFor(joint, painDates, input, allDates);
    base.ambiguous = isAmbiguous(base.triggers);

    out.push({ ...base, summary: summarize(base), referral: referralFor(base) });
  }

  // 지금 아픈 것부터, 그다음 오래된 것부터.
  return out.sort((a, b) => b.latest - a.latest || b.days - a.days);
}

/** 지금 신경 써야 하는 것만. 화면 맨 위에 한 줄 띄울 때 쓴다. */
export function activePain(history: readonly JointHistory[]): JointHistory[] {
  return history.filter((item) => item.latest >= PAIN_THRESHOLD);
}
