import type { Equipment, MovementPattern } from './types.ts';

/**
 * 다음 운동 예고.
 *
 * 세션을 끝내면 지금은 요약만 나온다. 요약은 닫힌 문장이다 — 다 했고,
 * 숫자가 이만큼이고, 끝. 끝난 이야기는 돌아올 이유가 없다.
 *
 * 그래서 마지막에 한 줄을 남긴다. **다음에 무엇을, 언제, 몇 킬로로
 * 하는지.** 사람이 다시 오는 이유는 "운동해야지"가 아니라 "목요일에
 * 벤치 105 올려야지"다. 숫자가 이름을 가지면 약속이 된다.
 *
 * 지어내지 않는다. 여기 나오는 무게는 그날 실제로 처방될 무게 그대로다.
 * 예고가 105kg인데 막상 들어가서 100kg이면 다음부터 예고를 안 믿는다.
 */

export interface PreviewExercise {
  name: string;
  equipment: Equipment;
  pattern: MovementPattern;
  /** 그날 처방될 무게. 맨몸이면 null */
  weightKg: number | null;
  sets: number;
  repMin: number;
  repMax: number;
  /** 이 종목을 마지막으로 했을 때의 톱세트 무게 */
  previousKg: number | null;
}

export interface PreviewInput {
  /** 다음에 할 날 이름. "상체 A" */
  sessionName: string;
  /** 언제 하는가. 약속이 있으면 "목 19:00", 없으면 "목요일", 모르면 null */
  whenLabel: string | null;
  exercises: readonly PreviewExercise[];
  /**
   * 무게가 내려간다면 이유가 있다. 앱은 그 이유를 알고 있다 —
   * 디로드 주이거나, 쉬었다 돌아온 복귀 주이거나.
   *
   * 이유 없이 내려간 숫자를 보면 사람은 앱이 틀렸다고 생각한다.
   */
  drop?: DropReason;
}

export type DropReason = 'deload' | 'comeback' | null;

export interface NextPreview {
  sessionName: string;
  whenLabel: string | null;
  lift: PreviewExercise | null;
  /** 윗줄. "목 19:00 · 상체 A" */
  headline: string;
  /** 아랫줄. "벤치프레스 105kg — 지난번보다 2.5kg 올립니다" */
  detail: string;
}

/**
 * 그 날을 대표하는 종목.
 *
 * 세션 전체를 예고하면 아무것도 예고하지 않은 것과 같다. 일곱 줄을
 * 읽을 사람은 없다. 한 종목만 고른다.
 *
 * 고르는 기준은 무게가 아니라 **동작**이다. 레그프레스가 스쿼트보다
 * 숫자가 크다고 하체 날을 대표하지는 않는다. 기구 스택 숫자와 바벨
 * 무게는 애초에 같은 단위가 아니다.
 */
const COMPOUND: readonly MovementPattern[] = [
  'squat', 'hinge', 'horizontalPush', 'verticalPush', 'horizontalPull', 'verticalPull', 'lunge',
];

/** 자유 중량이 앞이다. 같은 100kg이라도 바벨 쪽이 그날의 얼굴이다. */
const EQUIPMENT_RANK: Record<Equipment, number> = {
  barbell: 0,
  dumbbell: 1,
  smith: 2,
  cable: 3,
  machine: 3,
  bodyweight: 4,
  band: 5,
};

export function headlineLift(
  exercises: readonly PreviewExercise[],
): PreviewExercise | null {
  if (exercises.length === 0) return null;

  let best: PreviewExercise | null = null;
  let bestRank = Infinity;

  exercises.forEach((exercise) => {
    const compound = COMPOUND.includes(exercise.pattern) ? 0 : 10;
    const rank = compound + EQUIPMENT_RANK[exercise.equipment];
    // 같은 등급이면 앞에 있는 것. 프로그램이 메인 동작을 앞에 둔다.
    if (rank < bestRank) {
      bestRank = rank;
      best = exercise;
    }
  });

  return best ?? exercises[0]!;
}

/** 소수점은 필요할 때만. 105.0kg은 읽는 사람을 느리게 만든다. */
export function weightLabel(weightKg: number): string {
  const rounded = Math.round(weightKg * 10) / 10;
  return (Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)) + 'kg';
}

/**
 * 종목 한 줄.
 *
 * 지난번과 비교한다. "105kg"만 있으면 그냥 숫자지만 "지난번보다
 * 2.5kg 올립니다"는 내가 지난번에 한 일의 결과다. 올라간 이유가 내가
 * 지난주에 간 것이기 때문에, 이번 주도 가야 할 이유가 된다.
 */
export function liftDetail(
  lift: PreviewExercise,
  options: { drop?: DropReason } = {},
): string {
  const reps = lift.repMin === lift.repMax
    ? `${lift.repMin}회`
    : `${lift.repMin}~${lift.repMax}회`;
  const volume = `${lift.sets}세트 × ${reps}`;

  if (lift.weightKg == null) return `${lift.name} ${volume}`;

  const head = `${lift.name} ${weightLabel(lift.weightKg)}`;

  if (lift.previousKg == null) return `${head} — ${volume}, 첫 기록을 남깁니다`;

  const delta = Math.round((lift.weightKg - lift.previousKg) * 10) / 10;
  if (delta > 0) return `${head} — 지난번보다 ${weightLabel(delta)} 올립니다`;
  if (delta < 0) {
    const down = weightLabel(-delta);
    if (options.drop === 'deload') return `${head} — 이번 주는 디로드라 ${down} 내립니다`;
    if (options.drop === 'comeback') return `${head} — 복귀 주라 ${down} 내려서 갑니다`;
    return `${head} — 지난번보다 ${down} 내려서 갑니다`;
  }
  return `${head} — 지난번과 같은 무게로 ${volume}`;
}

export function buildPreview(input: PreviewInput): NextPreview {
  const lift = headlineLift(input.exercises);
  const headline = input.whenLabel
    ? `${input.whenLabel} · ${input.sessionName}`
    : input.sessionName;

  return {
    sessionName: input.sessionName,
    whenLabel: input.whenLabel,
    lift: lift,
    headline: headline,
    detail: lift
      ? liftDetail(lift, { drop: input.drop })
      : '종목은 그날 몸 상태를 보고 정합니다',
  };
}
