/**
 * 체중 추세.
 *
 * 다이어트 앱이 사람을 포기하게 만드는 자리는 거의 언제나 저울이다.
 * 어제 72.1, 오늘 73.4. 아무것도 잘못하지 않았는데 숫자가 올라가 있다.
 * 소금, 물, 배변, 생리주기, 전날 탄수화물 — 하루 체중은 이런 것들로
 * ±2kg씩 움직인다. **그 숫자를 그대로 보여주면 사람이 2주 만에 그만둔다.**
 *
 * 그래서 여기서는 하루치를 믿지 않는다. **7일 이동평균**만 추세로 본다.
 * 7일인 이유는 한 주가 한 바퀴이기 때문이다 — 주말에 더 먹고 평일에
 * 덜 먹는 사람도 7일로 묶으면 그 요철이 사라진다.
 *
 * 그리고 보여주는 것은 체중 자체가 아니라 **속도**다. "72.4kg"는 판단할
 * 수 없는 숫자지만 "주 0.6kg씩"은 판단할 수 있다. 빠른지 느린지,
 * 근육을 잃고 있는지 아닌지를 여기서 말한다.
 *
 * 칼로리도, 끼니도, 먹을 것 목록도 여기에 없다. 그건 영양사의 영역이고
 * 매 끼 적는 일은 아무도 3주를 못 간다. 저울은 하루 한 번 10초다.
 */

/** 하루치 체중. 같은 날 두 번 재면 나중 것으로 덮는다. */
export interface WeighIn {
  /** YYYY-MM-DD */
  date: string;
  kg: number;
}

/** 추세선을 만드는 창. 한 주가 한 바퀴다. */
export const WINDOW_DAYS = 7;

/**
 * 추세선을 긋기 시작하는 최소 횟수.
 *
 * 두 번으로 선을 그으면 그건 추세가 아니라 두 점이다. 하루 요동이
 * 그대로 기울기가 되어 "주 4kg 감량 중"같은 거짓말이 나온다.
 */
export const MIN_WEIGH_INS = 3;

/** 속도를 재는 구간. 2주보다 짧으면 요동을 속도로 착각한다. */
export const SPEED_DAYS = 14;

/** 그 2주 안에 최소 이만큼은 재야 속도를 말한다. */
export const MIN_SPEED_SAMPLES = 6;

/**
 * 저울이 말하는 방향. **목표와 무관한 물리적 사실이다.**
 *
 * 같은 "주 0.8% 감소"도 감량기에는 좋은 속도이고 증량기에는 실패다.
 * 그래서 판단(message)과 사실(pace)을 나눠 둔다.
 */
export type Pace = 'fastDown' | 'down' | 'slowDown' | 'flat' | 'slowUp' | 'up';

/** 주당 체중 변화(%)를 방향으로 자르는 지점. */
const PACE_BANDS: readonly { at: number; pace: Pace }[] = [
  { at: -1.0, pace: 'fastDown' },
  { at: -0.35, pace: 'down' },
  { at: -0.1, pace: 'slowDown' },
  { at: 0.1, pace: 'flat' },
  { at: 0.35, pace: 'slowUp' },
];

/** 체중을 어느 쪽으로 가져가려는가. 목표에서 정해진다. */
export type BodyGoal = 'cut' | 'hold' | 'grow';

export interface TrendPoint {
  date: string;
  /** 그날 잰 값 */
  kg: number;
  /** 그날까지 7일 이동평균 */
  avgKg: number;
  /** 그 평균에 들어간 날 수 */
  samples: number;
}

export interface BodyTrend {
  /** 날짜 오름차순. 잰 날만 들어간다 */
  points: TrendPoint[];
  /** 마지막으로 잰 날 */
  latest: TrendPoint | null;
  /** 지금 추세값 (7일 평균) */
  trendKg: number | null;
  /** 주당 변화(kg). 음수면 빠지는 중 */
  weeklyKg: number | null;
  /** 주당 변화(%) */
  weeklyPercent: number | null;
  pace: Pace | null;
  /** 몇 번 쟀는가 */
  samples: number;
  /** 며칠 동안 안 쟀는가. 한 번도 안 쟀으면 없음 */
  daysSince: number | null;
  /** 화면에 그대로 쓸 한 줄 */
  message: string;
  /** 위험하면 한 줄 더. 없으면 null */
  warning: string | null;
}

export interface TrendInput {
  weighIns: readonly WeighIn[];
  /** 오늘 (YYYY-MM-DD) */
  today: string;
  goal: BodyGoal;
}

function dayDiff(from: string, to: string): number {
  const a = Date.parse(from + 'T00:00:00Z');
  const b = Date.parse(to + 'T00:00:00Z');
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((b - a) / 86400000);
}

/** 소수 한 자리. 저울이 그 이상을 보여 줘도 의미가 없다. */
function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * 같은 날 여러 번 잰 것을 하루 하나로 줄이고 날짜순으로 세운다.
 *
 * 나중에 잰 것을 남긴다 — 다시 쟀다는 건 앞의 값이 이상했다는 뜻이다.
 */
export function tidyWeighIns(weighIns: readonly WeighIn[]): WeighIn[] {
  const byDate = new Map<string, number>();
  for (const entry of weighIns) {
    if (!entry || !entry.date) continue;
    if (!Number.isFinite(entry.kg) || entry.kg <= 0) continue;
    byDate.set(entry.date.slice(0, 10), entry.kg);
  }
  return [...byDate.entries()]
    .map(([date, kg]) => ({ date, kg }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/**
 * 7일 이동평균.
 *
 * 날짜로 센다. 기록 개수로 세면 띄엄띄엄 잰 사람의 "7개"가 두 달치가
 * 되어 버린다 — 그건 이동평균이 아니라 옛날 체중이다.
 */
export function trendPoints(weighIns: readonly WeighIn[]): TrendPoint[] {
  const tidy = tidyWeighIns(weighIns);
  return tidy.map((entry) => {
    const inWindow = tidy.filter(
      (other) => other.date <= entry.date && dayDiff(other.date, entry.date) < WINDOW_DAYS,
    );
    const sum = inWindow.reduce((total, other) => total + other.kg, 0);
    return {
      date: entry.date,
      kg: round1(entry.kg),
      avgKg: round1(sum / inWindow.length),
      samples: inWindow.length,
    };
  });
}

function paceOf(weeklyPercent: number): Pace {
  for (const band of PACE_BANDS) {
    if (weeklyPercent < band.at) return band.pace;
  }
  return 'up';
}

/**
 * 속도.
 *
 * 2주 전 추세값과 지금 추세값을 잇는다. 하루값끼리 빼면 요동이 그대로
 * 속도가 되므로 **반드시 평균끼리** 뺀다.
 */
function speedOf(points: readonly TrendPoint[], today: string) {
  const last = points[points.length - 1];
  if (!last) return null;

  // 기준점 — 지금으로부터 SPEED_DAYS 가장 가까운 과거 점.
  let base: TrendPoint | null = null;
  for (const point of points) {
    if (point === last) break;
    const gap = dayDiff(point.date, last.date);
    if (gap < WINDOW_DAYS) break;
    base = point;
    if (gap <= SPEED_DAYS) break;
  }
  if (!base) return null;

  const span = dayDiff(base.date, last.date);
  if (span <= 0) return null;

  const recent = points.filter((point) => dayDiff(point.date, today) <= SPEED_DAYS + WINDOW_DAYS);
  if (recent.length < MIN_SPEED_SAMPLES) return null;

  const weeklyKg = ((last.avgKg - base.avgKg) / span) * 7;
  const weeklyPercent = last.avgKg > 0 ? (weeklyKg / last.avgKg) * 100 : 0;
  return { weeklyKg: round1(weeklyKg), weeklyPercent: Math.round(weeklyPercent * 100) / 100 };
}

/** 주당 몇 kg을 사람이 읽는 말로. */
function speedWords(weeklyKg: number): string {
  const size = Math.abs(weeklyKg);
  if (size < 0.05) return '거의 그대로';
  return `주 ${round1(size)}kg씩 ${weeklyKg < 0 ? '빠지는' : '느는'} 중`;
}

export function buildBodyTrend(input: TrendInput): BodyTrend {
  const points = trendPoints(input.weighIns);
  const latest = points[points.length - 1] ?? null;
  const samples = points.length;
  const daysSince = latest ? Math.max(0, dayDiff(latest.date, input.today)) : null;

  const empty = {
    points,
    latest,
    trendKg: latest ? latest.avgKg : null,
    weeklyKg: null,
    weeklyPercent: null,
    pace: null,
    samples,
    daysSince,
  };

  if (samples === 0) {
    return { ...empty, message: '아침에 한 번만 재면 2주 뒤부터 추세가 보입니다.', warning: null };
  }
  if (samples < MIN_WEIGH_INS) {
    const left = MIN_WEIGH_INS - samples;
    return {
      ...empty,
      message: `${left}번만 더 재면 추세선이 그려집니다. 하루 체중은 2kg씩 출렁여서 한 번으로는 아무것도 모릅니다.`,
      warning: null,
    };
  }

  const speed = speedOf(points, input.today);
  if (!speed) {
    return {
      ...empty,
      message: `지금 ${latest?.avgKg}kg 언저리입니다. 2주쯤 더 재면 빠지는 속도를 말할 수 있습니다.`,
      warning: staleWarning(daysSince),
    };
  }

  const pace = paceOf(speed.weeklyPercent);
  const state = { ...empty, weeklyKg: speed.weeklyKg, weeklyPercent: speed.weeklyPercent, pace };
  return {
    ...state,
    message: messageOf(input.goal, pace, speed.weeklyKg, latest?.avgKg ?? 0),
    warning: warningOf(input.goal, pace, speed.weeklyPercent) ?? staleWarning(daysSince),
  };
}

function staleWarning(daysSince: number | null): string | null {
  if (daysSince === null || daysSince < 10) return null;
  return `${daysSince}일째 안 쟀습니다. 추세는 재야 보입니다 — 숫자가 마음에 안 드는 주일수록 더 그렇습니다.`;
}

/**
 * 뭐라고 말할 것인가.
 *
 * 같은 숫자라도 목표가 다르면 다른 말이 되어야 한다. 그리고 어느
 * 경우에도 혼내지 않는다 — 저울 앞에서 혼나려고 앱을 여는 사람은 없다.
 */
function messageOf(goal: BodyGoal, pace: Pace, weeklyKg: number, trendKg: number): string {
  const speed = speedWords(weeklyKg);
  const at = `${round1(trendKg)}kg`;

  if (goal === 'cut') {
    switch (pace) {
      case 'fastDown':
        return `${at}, ${speed}입니다. 너무 빠릅니다 — 이 속도면 근육이 같이 빠집니다.`;
      case 'down':
        return `${at}, ${speed}입니다. 좋은 속도입니다.`;
      case 'slowDown':
        return `${at}, ${speed}입니다. 느리지만 방향은 맞습니다. 느린 쪽이 근육을 지킵니다.`;
      case 'flat':
        return `${at}에서 2주째 거의 그대로입니다. 체중은 원래 몇 주씩 멈췄다 한 번에 갑니다.`;
      default:
        return `${at}, ${speed}입니다. 감량 중에 오르는 주도 있습니다 — 한 주로 판단하지 않습니다.`;
    }
  }

  if (goal === 'grow') {
    switch (pace) {
      case 'slowUp':
        return `${at}, ${speed}입니다. 근육으로 올리기 좋은 속도입니다.`;
      case 'up':
        return `${at}, ${speed}입니다. 빠릅니다 — 이 속도에서 느는 것의 절반은 지방입니다.`;
      case 'flat':
        return `${at}에서 멈춰 있습니다. 늘리려면 먹는 양이 모자랍니다.`;
      default:
        return `${at}, ${speed}입니다. 늘리려던 주에 빠지고 있습니다.`;
    }
  }

  if (pace === 'flat') return `${at}에서 잘 유지하고 있습니다.`;
  return `${at}, ${speed}입니다. 유지가 목표라면 먹는 양을 조금 되돌립니다.`;
}

/**
 * 경고.
 *
 * 하나만 쓴다. 두 줄이 되면 아무도 안 읽는다.
 */
function warningOf(goal: BodyGoal, pace: Pace, weeklyPercent: number): string | null {
  if (pace === 'fastDown') {
    const rate = Math.abs(Math.round(weeklyPercent * 10) / 10);
    return (
      `주 ${rate}%씩 빠지고 있습니다. 체중의 1%를 넘기면 근육과 힘이 먼저 빠집니다 — ` +
      '먹는 양을 조금 올리고 단백질을 채우세요.'
    );
  }
  if (goal === 'grow' && pace === 'up') {
    return '늘리는 속도가 빠릅니다. 주 0.25~0.5% 안쪽이 근육으로 가는 구간입니다.';
  }
  return null;
}

/**
 * 감량 중이면 처방 무게를 공격적으로 올리지 않는다.
 *
 * 적자에서는 회복이 느리다. 거기서 매주 올리면 못 들거나 다친다.
 * **감량기에는 들던 무게를 지키는 것이 성공이다** — 이 한 줄을 앱이
 * 말해 주지 않으면 사람은 자기가 퇴보한다고 느끼고 그만둔다.
 *
 * 식단 앱은 운동을 모르고 운동 앱은 체중 추세를 안 본다. 둘을 같이
 * 가진 쪽만 할 수 있는 말이다.
 */
export function holdLoadWhileCutting(trend: BodyTrend, goal: BodyGoal): string | null {
  if (goal !== 'cut') return null;
  if (trend.pace !== 'down' && trend.pace !== 'fastDown') return null;
  return '체중이 빠지는 중입니다. 이번 주는 무게를 올리기보다 지난주 무게를 지키는 쪽으로 봅니다.';
}
