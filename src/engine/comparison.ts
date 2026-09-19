import { oneRepMax } from './repmax.ts';
import { withParticle } from './korean.ts';
import type { Exercise, SessionLog, SetLog } from './types.ts';

/**
 * 지난번과 비교.
 *
 * "오늘 몇 세트 했다"는 끝나고 나면 아무 감흥이 없다. 사람이 알고 싶은 건
 * **늘었는가**이고, 그건 어제의 나와 비교해야 나온다.
 *
 * 무게를 그냥 비교하면 안 된다. 지난주 60kg 10회와 오늘 80kg 5회 중 어느
 * 쪽이 나은지는 무게만 봐서는 모른다. 그래서 추정 1RM으로 환산해 비교한다 —
 * 반복이 달라도 같은 자로 잴 수 있다.
 *
 * 다만 추정 1RM은 추정이다. RIR 신고가 틀리면 같이 틀린다. 그래서 화면에는
 * 환산값만 내보내지 않고 실제로 든 세트("80kg × 5회")를 같이 붙인다.
 */

export interface EffortPoint {
  date: string;
  /** 추정 1RM */
  value: number;
  /** 그 값을 만든 실제 세트 */
  set: SetLog;
  /** 오늘로부터 며칠 전인가 */
  daysAgo: number;
}

export interface LiftComparison {
  exerciseId: string;
  name: string;
  today: EffortPoint;
  /** 오늘 이전에 이 종목을 마지막으로 한 날 */
  previous?: EffortPoint;
  /** 한 달쯤 전 (21~35일) 기록 중 가장 가까운 것 */
  monthAgo?: EffortPoint;
  /** 지난번 대비 kg. previous가 없으면 undefined */
  deltaPrevious?: number;
  /** 한 달 전 대비 kg */
  deltaMonth?: number;
  /**
   * 1RM 환산을 믿어도 되는가.
   *
   * 유효 반복(반복 + RIR)이 12를 넘으면 1RM 환산은 추정이 아니라 추측에
   * 가까워진다. 102.5kg 14회(RIR 0)와 15회(RIR 2)의 환산 차이가 13.7kg인데,
   * 실제로 달라진 건 "한 번 더 하고 두 번 더 할 여유가 있었다"뿐이다.
   * 이걸 "13.7kg 늘었다"고 말하면 트레이너는 앱을 안 믿는다.
   */
  reliable: boolean;
}

/** 이 반복 수를 넘으면 1RM 환산을 믿지 않는다. */
export const RELIABLE_REPS = 12;

/**
 * 한 달 비교의 창.
 *
 * 정확히 28일 전에 그 종목을 했을 확률은 낮다. 그래서 창을 두고 그 안에서
 * 가장 가까운 기록을 쓴다. 창 밖이면 "기록 없음"이라고 말한다 —
 * 두 달 전 기록을 한 달 전이라고 부르면 그건 거짓말이다.
 */
const MONTH_WINDOW = { min: 21, max: 35 };

function daysBetween(from: string, to: string): number {
  const a = Date.parse(from + 'T00:00:00Z');
  const b = Date.parse(to + 'T00:00:00Z');
  if (Number.isNaN(a) || Number.isNaN(b)) return Number.NaN;
  return Math.round((b - a) / 86400000);
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/** 그 세션에서 이 종목의 최고 수행. 뒤 세트는 피로가 섞여 능력이 아니다. */
function bestOf(
  session: SessionLog,
  exerciseId: string,
  rirOffset: number,
): { value: number; set: SetLog } | undefined {
  let best: { value: number; set: SetLog } | undefined;
  for (const set of session.sets) {
    if (set.exerciseId !== exerciseId) continue;
    if (set.warmup || set.reps <= 0 || set.weightKg <= 0) continue;
    const rir = Math.min(5, Math.max(0, set.rir + rirOffset));
    const value = oneRepMax({ ...set, rir });
    if (!best || value > best.value) best = { value: round1(value), set };
  }
  return best;
}

export interface CompareInput {
  /** 오늘 기록한 세트 */
  todaySets: readonly SetLog[];
  today: string;
  /** 오늘 이전의 세션들 */
  history: readonly SessionLog[];
  index: ReadonlyMap<string, Exercise>;
  /** RIR 신고 편향 보정 */
  rirOffset?: number;
}

/**
 * 오늘 한 종목마다 지난번·한 달 전과 비교한다.
 *
 * 오늘 안 한 종목은 나오지 않는다. 운동이 끝난 자리에서 오늘 안 한 종목의
 * 숫자를 보여줄 이유가 없다.
 */
export function compareToPast(input: CompareInput): LiftComparison[] {
  const offset = input.rirOffset ?? 0;
  const todaySession: SessionLog = { date: input.today, sets: [...input.todaySets] } as SessionLog;

  const past = input.history
    .filter((session) => session.date < input.today)
    .slice()
    .sort((a, b) => (a.date < b.date ? 1 : -1));  // 최근부터

  const doneToday = [...new Set(input.todaySets
    .filter((set) => !set.warmup && set.reps > 0 && set.weightKg > 0)
    .map((set) => set.exerciseId))];

  const out: LiftComparison[] = [];

  for (const exerciseId of doneToday) {
    const today = bestOf(todaySession, exerciseId, offset);
    if (!today) continue;

    let previous: EffortPoint | undefined;
    let monthAgo: EffortPoint | undefined;

    for (const session of past) {
      const best = bestOf(session, exerciseId, offset);
      if (!best) continue;
      const daysAgo = daysBetween(session.date, input.today);
      if (!Number.isFinite(daysAgo)) continue;

      // 최근부터 훑으므로 처음 만나는 것이 "지난번"이다
      if (!previous) previous = { date: session.date, value: best.value, set: best.set, daysAgo };

      if (!monthAgo && daysAgo >= MONTH_WINDOW.min && daysAgo <= MONTH_WINDOW.max) {
        monthAgo = { date: session.date, value: best.value, set: best.set, daysAgo };
      }

      // 창을 지나쳤으면 더 볼 것이 없다
      if (daysAgo > MONTH_WINDOW.max && previous) break;
    }

    const effective = (set: SetLog) => set.reps + Math.max(0, set.rir);
    const reliable = [today.set, previous?.set, monthAgo?.set]
      .filter((set): set is SetLog => Boolean(set))
      .every((set) => effective(set) <= RELIABLE_REPS);

    out.push({
      exerciseId,
      name: input.index.get(exerciseId)?.name ?? exerciseId,
      today: { date: input.today, value: today.value, set: today.set, daysAgo: 0 },
      previous,
      monthAgo,
      deltaPrevious: previous ? round1(today.value - previous.value) : undefined,
      deltaMonth: monthAgo ? round1(today.value - monthAgo.value) : undefined,
      reliable,
    });
  }

  // 많이 오른 것부터. 오늘 잘한 것을 먼저 보여준다.
  return out.sort((a, b) => (b.deltaPrevious ?? -Infinity) - (a.deltaPrevious ?? -Infinity));
}

/**
 * 변화가 의미 있다고 볼 최소 폭.
 *
 * 추정 1RM은 RIR 신고에 따라 1~2kg은 쉽게 흔들린다. 그 안의 변화를 "늘었다"고
 * 하면 매주 늘었다고 말하게 되고, 그러면 아무도 안 믿는다.
 */
export const MEANINGFUL_KG = 2.5;

export type ChangeDirection = 'up' | 'same' | 'down';

export function directionOf(deltaKg: number | undefined): ChangeDirection {
  if (deltaKg === undefined) return 'same';
  if (deltaKg >= MEANINGFUL_KG) return 'up';
  if (deltaKg <= -MEANINGFUL_KG) return 'down';
  return 'same';
}

/** 비교 한 줄. 기록이 없으면 없다고 말한다. */
export function describeComparison(row: LiftComparison, span: 'previous' | 'month'): string {
  const point = span === 'previous' ? row.previous : row.monthAgo;
  const delta = span === 'previous' ? row.deltaPrevious : row.deltaMonth;

  if (!point || delta === undefined) {
    return span === 'previous' ? '이 종목은 오늘이 처음입니다.' : '한 달 전 기록이 없습니다.';
  }

  const when = `${point.daysAgo}일 전`;
  const was = `${point.set.weightKg}kg × ${point.set.reps}회`;
  const now = row.today.set;

  /*
   * 무게가 같으면 환산을 꺼낼 이유가 없다. "1회 더 했다"가 사실 그대로이고
   * 훨씬 잘 읽힌다. 고반복에서 환산이 부풀어 보이는 문제도 여기서 사라진다.
   */
  if (now.weightKg === point.set.weightKg) {
    const repDelta = now.reps - point.set.reps;
    if (repDelta > 0) return `${when} ${was} → 같은 무게로 ${repDelta}회 더`;
    if (repDelta < 0) return `${when} ${was} → 같은 무게로 ${-repDelta}회 적게`;
    const rirDelta = Math.max(0, point.set.rir) - Math.max(0, now.rir);
    if (rirDelta > 0) return `${when} ${was} → 같은 무게·반복인데 더 힘들었습니다`;
    if (rirDelta < 0) return `${when} ${was} → 같은 무게·반복이 더 쉬워졌습니다`;
    return `${when} ${was} → 그대로입니다`;
  }

  // 무게가 다르면 환산이 필요하다. 믿기 어려운 구간이면 그렇다고 말한다.
  const tail = row.reliable ? '' : ' (고반복이라 환산이 정확하지 않습니다)';

  switch (directionOf(delta)) {
    case 'up':
      return `${when} ${was} → 오늘 환산 +${round1(delta)}kg${tail}`;
    case 'down':
      return `${when} ${was} → 오늘 환산 ${round1(delta)}kg${tail}`;
    default:
      return `${when} ${was} → 비슷합니다`;
  }
}

export interface ComparisonSummary {
  up: number;
  same: number;
  down: number;
  /** 처음 한 종목 */
  fresh: number;
  headline: string;
}

/**
 * 한 줄 요약.
 *
 * 종목별 숫자를 훑기 전에 "오늘 어땠나"를 먼저 알려준다. 내려간 종목을
 * 숨기지 않는다 — 내려간 날을 감추면 올라간 날도 못 믿게 된다.
 */
export function summarizeComparison(rows: readonly LiftComparison[]): ComparisonSummary {
  let up = 0;
  let same = 0;
  let down = 0;
  let fresh = 0;

  for (const row of rows) {
    if (row.deltaPrevious === undefined) { fresh += 1; continue; }
    const direction = directionOf(row.deltaPrevious);
    if (direction === 'up') up += 1;
    else if (direction === 'down') down += 1;
    else same += 1;
  }

  const parts: string[] = [];
  if (up > 0) parts.push(`${up}종목 올랐습니다`);
  if (same > 0) parts.push(`${same}종목 유지`);
  if (down > 0) parts.push(`${down}종목 내려갔습니다`);
  if (fresh > 0) parts.push(`${fresh}종목은 오늘이 처음`);

  const headline = parts.length > 0
    ? `지난번 대비 ${parts.join(' · ')}.`
    : '비교할 기록이 아직 없습니다.';

  return { up, same, down, fresh, headline };
}

/** 오늘 가장 많이 오른 종목. 없으면 undefined. */
export function biggestGain(rows: readonly LiftComparison[]): LiftComparison | undefined {
  const gains = rows.filter((row) => directionOf(row.deltaPrevious) === 'up');
  if (gains.length === 0) return undefined;
  return gains.reduce((best, row) => ((row.deltaPrevious ?? 0) > (best.deltaPrevious ?? 0) ? row : best));
}

/** 한 종목의 한 달 변화를 문장으로. 사용자에게 그대로 나간다. */
export function monthLine(row: LiftComparison): string {
  if (row.deltaMonth === undefined || !row.monthAgo) return '';
  // 환산을 못 믿는 구간에서 "몇 kg 늘었다"고 단정하지 않는다.
  if (!row.reliable) {
    const repDelta = row.today.set.reps - row.monthAgo.set.reps;
    if (row.today.set.weightKg === row.monthAgo.set.weightKg && repDelta !== 0) {
      return `${withParticle(row.name, '은/는')} 한 달 전과 같은 무게로 ${Math.abs(repDelta)}회 ` +
        (repDelta > 0 ? '더 합니다.' : '적게 했습니다.');
    }
    return '';
  }
  const direction = directionOf(row.deltaMonth);
  const amount = round1(Math.abs(row.deltaMonth));
  if (direction === 'up') {
    return `${withParticle(row.name, '은/는')} 한 달 전보다 ${amount}kg 늘었습니다.`;
  }
  if (direction === 'down') {
    return `${withParticle(row.name, '은/는')} 한 달 전보다 ${amount}kg 줄었습니다.`;
  }
  return `${withParticle(row.name, '은/는')} 한 달 전과 비슷합니다.`;
}
