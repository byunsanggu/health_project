import { FORMAT_LABELS_KO, type ConditioningFormat, type ConditioningWorkout } from './conditioning.ts';
import { formatDuration } from './rest.ts';

/**
 * 와드 기록.
 *
 * "15분 For Time을 했다"는 기록이 아니다. 기록은 **몇 분 걸렸는가**이고,
 * 다음에 같은 걸 했을 때 빨라졌는지가 이 운동을 계속할 이유다.
 *
 * 그런데 와드는 매번 다르게 생성된다. 지난주 12분 AMRAP과 이번 주 12분
 * AMRAP은 동작 구성이 다르므로 **라운드 수를 비교하면 아무 의미가 없다.**
 * 12라운드가 8라운드보다 나은 게 아니라 동작이 쉬웠던 것일 수 있다.
 *
 * 크로스핏이 이 문제를 푼 방식이 벤치마크 와드다 — Fran, Diane처럼 구성이
 * 고정된 와드를 정해 두고 그것만 비교한다. 여기서도 같게 한다:
 * **구성이 같은 와드끼리만 비교하고, 다르면 비교하지 않는다.**
 */

export type WodScoreKind = 'time' | 'rounds' | 'completion';

/** 형식마다 무엇으로 기록을 남기는가. */
export function scoreKindOf(format: ConditioningFormat): WodScoreKind {
  switch (format) {
    case 'forTime': return 'time';
    case 'amrap': return 'rounds';
    case 'circuit': return 'rounds';
    default: return 'completion';  // EMOM · 인터벌은 끝까지 했는가가 기록이다
  }
}

export interface WodResult {
  /** 같은 구성인지 가리는 열쇠 */
  signature: string;
  format: ConditioningFormat;
  /** YYYY-MM-DD */
  date: string;
  minutes: number;
  /** 화면에 그대로 쓸 구성 요약 */
  label: string;

  /** For Time — 걸린 초 */
  seconds?: number;
  /** AMRAP · 서킷 — 완료한 라운드 */
  rounds?: number;
  /** 라운드를 채우고 남은 추가 반복 */
  extraReps?: number;
  /** EMOM · 인터벌 — 끝까지 했는가 */
  completed?: boolean;
  /** 중간에 멈췄으면 몇 분에서 */
  stoppedAtMinute?: number;
  note?: string;
}

/**
 * 같은 와드인지 가리는 열쇠.
 *
 * 형식 · 길이 · 동작과 분량이 모두 같아야 같은 와드다. 동작 하나만 달라도
 * 다른 와드이고, 다른 와드끼리 시간을 비교하면 거짓말이 된다.
 */
export function wodSignature(workout: ConditioningWorkout): string {
  const moves = workout.movements
    .map((movement) => `${movement.exerciseId}:${movement.amount}${movement.unit}`)
    .sort()  // 순서가 바뀌어도 같은 와드로 본다
    .join('|');
  return `${workout.format}/${workout.durationMinutes}/${moves}`;
}

/** 구성을 한 줄로. 기록 목록에서 무엇이었는지 알아보게 한다. */
export function wodLabel(workout: ConditioningWorkout): string {
  return workout.movements.map((movement) => `${movement.name} ${movement.display}`).join(' · ');
}

/** 기록 한 줄을 사람이 읽는 말로. */
export function describeScore(result: WodResult): string {
  switch (scoreKindOf(result.format)) {
    case 'time':
      return result.seconds === undefined ? '기록 없음' : `${formatDuration(result.seconds)}`;
    case 'rounds': {
      if (result.rounds === undefined) return '기록 없음';
      const extra = result.extraReps ? ` + ${result.extraReps}회` : '';
      return `${result.rounds}라운드${extra}`;
    }
    default:
      if (result.completed === undefined) return '기록 없음';
      if (result.completed) return '완주';
      return result.stoppedAtMinute !== undefined
        ? `${result.stoppedAtMinute}분에서 중단`
        : '중단';
  }
}

/**
 * 비교할 수 있는 숫자 하나로.
 *
 * AMRAP은 라운드에 추가 반복을 소수로 붙인다 — 5라운드 + 8회가
 * 5라운드보다 낫다는 걸 숫자 하나로 담아야 정렬이 된다.
 */
function scalarOf(result: WodResult): number | undefined {
  switch (scoreKindOf(result.format)) {
    case 'time': return result.seconds;
    case 'rounds':
      if (result.rounds === undefined) return undefined;
      return result.rounds + (result.extraReps ?? 0) / 1000;
    default:
      if (result.completed === undefined) return undefined;
      return result.completed ? result.minutes : (result.stoppedAtMinute ?? 0);
  }
}

/** For Time은 낮을수록, 나머지는 높을수록 좋다. */
export function lowerIsBetter(format: ConditioningFormat): boolean {
  return scoreKindOf(format) === 'time';
}

export type WodTrend = 'better' | 'same' | 'worse';

export interface WodComparison {
  /** 같은 구성으로 한 지난 기록. 없으면 undefined */
  previous?: WodResult;
  /** 같은 구성 중 제일 좋았던 기록 */
  best?: WodResult;
  trend?: WodTrend;
  /** 사용자에게 그대로 보여줄 한 줄 */
  text: string;
  /** 같은 구성으로 몇 번 했는가 (이번 포함) */
  attempts: number;
}

/**
 * 이번 기록을 같은 구성의 지난 기록과 비교한다.
 *
 * 구성이 다른 와드는 아예 보지 않는다. "지난주보다 2분 빨랐다"가 사실이
 * 아니면 말하지 않는 게 낫다.
 */
export function compareWod(
  current: WodResult,
  history: readonly WodResult[],
): WodComparison {
  const same = history
    .filter((result) => result.signature === current.signature && result.date < current.date)
    .sort((a, b) => (a.date < b.date ? 1 : -1));

  if (same.length === 0) {
    return {
      attempts: 1,
      text: '이 구성은 처음입니다. 다음에 같은 와드를 하면 비교해 드립니다.',
    };
  }

  const currentValue = scalarOf(current);
  const previous = same[0]!;
  const previousValue = scalarOf(previous);

  const lower = lowerIsBetter(current.format);
  const best = same.reduce((pick, result) => {
    const a = scalarOf(result);
    const b = scalarOf(pick);
    if (a === undefined) return pick;
    if (b === undefined) return result;
    return (lower ? a < b : a > b) ? result : pick;
  }, same[0]!);

  if (currentValue === undefined || previousValue === undefined) {
    return {
      previous,
      best,
      attempts: same.length + 1,
      text: `같은 구성으로 ${same.length + 1}번째입니다.`,
    };
  }

  let trend: WodTrend = 'same';
  if (currentValue !== previousValue) {
    const improved = lower ? currentValue < previousValue : currentValue > previousValue;
    trend = improved ? 'better' : 'worse';
  }

  const bestValue = scalarOf(best);
  const isBest = bestValue === undefined
    || (lower ? currentValue <= bestValue : currentValue >= bestValue);

  const verdict = trend === 'better' ? '나아졌습니다'
    : trend === 'worse' ? '지난번보다 못했습니다'
    : '같습니다';

  let text = `지난번 ${describeScore(previous)} → 오늘 ${describeScore(current)} — ${verdict}`;
  if (isBest) text += '. 최고 기록입니다.';

  return { previous, best, trend, attempts: same.length + 1, text };
}

/** 저장할 기록을 만든다. 형식에 안 맞는 값은 담지 않는다. */
export function recordWod(
  workout: ConditioningWorkout,
  date: string,
  score: Pick<WodResult, 'seconds' | 'rounds' | 'extraReps' | 'completed' | 'stoppedAtMinute' | 'note'>,
): WodResult {
  const base: WodResult = {
    signature: wodSignature(workout),
    format: workout.format,
    date,
    minutes: workout.durationMinutes,
    label: wodLabel(workout),
    note: score.note,
  };

  switch (scoreKindOf(workout.format)) {
    case 'time':
      return { ...base, seconds: score.seconds };
    case 'rounds':
      return { ...base, rounds: score.rounds, extraReps: score.extraReps };
    default:
      return { ...base, completed: score.completed, stoppedAtMinute: score.stoppedAtMinute };
  }
}

/** 같은 구성으로 한 기록들 — 최근순. 진행 탭에서 추이를 보여줄 때 쓴다. */
export function historyOf(
  history: readonly WodResult[],
  signature: string,
): WodResult[] {
  return history
    .filter((result) => result.signature === signature)
    .sort((a, b) => (a.date < b.date ? 1 : -1));
}

/** 형식 이름 — 목록에 쓴다. */
export function formatLabel(format: ConditioningFormat): string {
  return FORMAT_LABELS_KO[format];
}
