/**
 * 종목 빼기 — "싫어요" 하나로 받지 않는다.
 *
 * 경쟁 앱들은 종목 옆에 "싫어요" 버튼 하나를 단다. 그러면 초보는 해야 할
 * 것을 전부 뺀다. 스쿼트는 힘들어서, 데드는 무서워서, 풀업은 하나도 못
 * 해서 — 남는 건 머신 컬이다. 트레이너는 절대 그렇게 하지 않는다.
 * **"왜요?"를 먼저 묻는다.**
 *
 * 이유를 물으면 네 갈래가 되는데, 그중 진짜 "빼기"는 하나뿐이다.
 *
 *   아파요         → 통증 엔진이 대체한다. 영구가 아니다. 나으면 돌아온다.
 *   기구가 없어요   → 헬스장 정보다. 다른 사람도 덕을 본다.
 *   자신이 없어요   → **빼지 않는다.** 가르칠 일이지 뺄 일이 아니다.
 *   그냥 싫어요     → 이것만 진짜 제외다.
 *
 * 나머지 셋은 앱이 이미 더 잘 처리하는 길이 있는데, "싫어요" 하나로
 * 받으면 그게 전부 묻힌다.
 */
import { EXERCISES } from './exercises.ts';
import { withParticle } from './korean.ts';
import { findSubstitutes } from './pain.ts';
import type { Exercise, Joint } from './types.ts';

export type ExcludeReason = 'pain' | 'noEquipment' | 'unsure' | 'dislike';

/** 이유가 어디로 가는가. 화면이 다음에 뭘 물을지 여기서 갈린다. */
export type ExcludeRoute = 'pain' | 'equipment' | 'coach' | 'exclude';

export interface ReasonSpec {
  reason: ExcludeReason;
  label: string;
  hint: string;
  route: ExcludeRoute;
  /** 이 이유로 뺀 것이 남에게 보여도 되는가 */
  shareable: boolean;
}

/**
 * 고르는 차례가 중요하다.
 *
 * 아픈 것을 맨 위에 둔다 — 다치면서 하는 것이 제일 나쁘고, 그 경우 앱이
 * 할 수 있는 일이 제일 많다. "그냥 싫어요"를 맨 아래 둔다. 위에서부터
 * 읽다 보면 대부분 자기 경우가 그 위에서 끝난다.
 */
export const EXCLUDE_REASONS: readonly ReasonSpec[] = [
  {
    reason: 'pain',
    label: '하면 아파요',
    hint: '어디가 아픈지 알려주시면 부담이 적은 종목으로 바꿉니다',
    route: 'pain',
    // 건강 정보다. 남에게 보내지 않는다.
    shareable: false,
  },
  {
    reason: 'noEquipment',
    label: '기구가 없어요',
    hint: '이 헬스장 정보로 남깁니다. 같은 곳 다니는 사람도 덕을 봅니다',
    route: 'equipment',
    shareable: true,
  },
  {
    reason: 'unsure',
    label: '동작이 자신 없어요',
    hint: '빼지 않습니다. 시연을 보고 가벼운 무게로 4주 해 봅니다',
    route: 'coach',
    shareable: false,
  },
  {
    reason: 'dislike',
    label: '그냥 하기 싫어요',
    hint: '뺍니다. 빠진 볼륨은 비슷한 종목으로 채웁니다',
    route: 'exclude',
    shareable: true,
  },
];

export function reasonSpec(reason: ExcludeReason): ReasonSpec {
  return EXCLUDE_REASONS.find((spec) => spec.reason === reason) ?? EXCLUDE_REASONS[3]!;
}

/**
 * 다시 묻기까지 몇 주.
 *
 * 사람은 바뀐다. 어깨가 나으면 오버헤드를 다시 하고, 무서웠던 동작도
 * 배우면 한다. 안 물어보면 반년 뒤에도 안 하고 있다.
 *
 * 4주인 이유는 한 메소사이클이라서다. 그보다 짧으면 잔소리가 되고, 길면
 * 프로그램 한 주기를 통째로 반쪽으로 돌게 된다.
 */
export const REVIEW_WEEKS = 4;

export interface Exclusion {
  exerciseId: string;
  reason: ExcludeReason;
  /** 뺀 날 */
  since: string;
  /**
   * 영원히 뺀 것인가.
   *
   * 기본은 false다 — "당분간"이 기본이어야 한다. 영구를 기본으로 두면
   * 한 번 힘들었던 날의 기분이 프로그램에 영영 남는다.
   */
  forever?: boolean;
  /** 아파서 뺀 경우에만 */
  joint?: Joint;
}

const DAY = 86400000;

const daysBetween = (from: string, to: string): number =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY);

/**
 * 지금 빠져 있는 종목.
 *
 * "자신 없어요"는 여기 안 들어간다 — 그건 빼는 게 아니라 가르치는 것이다.
 * 기간이 지난 당분간 제외도 빠진다: 다시 물어보기 전에 슬그머니 돌아오는
 * 것이 아니라, 기간이 끝나면 돌아오고 화면이 그 사실을 알린다.
 */
export function activeExclusions(
  list: readonly Exclusion[],
  today: string,
): Exclusion[] {
  return list.filter((item) => {
    if (reasonSpec(item.reason).route === 'coach') return false;
    if (item.forever) return true;
    return daysBetween(item.since, today) < REVIEW_WEEKS * 7;
  });
}

export function excludedIds(list: readonly Exclusion[], today: string): Set<string> {
  return new Set(activeExclusions(list, today).map((item) => item.exerciseId));
}

/**
 * 다시 물어볼 것.
 *
 * 기간이 끝난 것만. "계속 빼둘게요"를 고르면 시계가 다시 돌아가서 4주 뒤에
 * 또 한 번 묻는다.
 *
 * 한 번 묻고 마는 쪽이 덜 귀찮겠지만, 그러면 화면이 "4주 뒤에 다시
 * 여쭤봅니다"라고 해 놓고 안 묻는 셈이 된다. 그리고 어깨는 8주째에 낫기도
 * 한다. 계속 묻는 게 싫은 사람에게는 **영원히**가 있고, 그걸 고르면 다시는
 * 안 묻는다 — 선택지가 이미 있으므로 몰래 안 묻는 쪽을 택할 이유가 없다.
 */
export function dueForReview(
  list: readonly Exclusion[],
  today: string,
): Exclusion[] {
  return list.filter((item) => {
    if (item.forever) return false;
    if (reasonSpec(item.reason).route === 'coach') return false;
    return daysBetween(item.since, today) >= REVIEW_WEEKS * 7;
  });
}

/**
 * 가르치기로 한 종목.
 *
 * "자신 없어요"를 고른 것들이다. 빠지지 않고 그대로 나오되, 무게를 낮추고
 * 시연을 붙인다. 4주가 지나면 목록에서 빠진다 — 그때쯤이면 배웠거나,
 * 배우지 못했다는 것을 본인이 안다.
 */
export function coaching(list: readonly Exclusion[], today: string): Exclusion[] {
  return list.filter((item) =>
    reasonSpec(item.reason).route === 'coach' &&
    daysBetween(item.since, today) < REVIEW_WEEKS * 7);
}

/**
 * 가르치는 중인 종목의 무게 비율.
 *
 * 60%다. 동작이 무서운 사람에게 필요한 건 가벼운 무게로 여러 번 해 보는
 * 것이지, 안 하는 것이 아니다. 여기서 더 낮추면 자극이 없어서 배울 것도
 * 없고, 더 높이면 무서운 것이 그대로다.
 */
export const COACH_LOAD_RATIO = 0.6;

export interface ExclusionInput {
  exerciseId: string;
  reason: ExcludeReason;
  today: string;
  forever?: boolean;
  joint?: Joint;
}

/** 새로 하나 뺀다. 같은 종목이 이미 있으면 덮어쓴다. */
export function addExclusion(
  list: readonly Exclusion[],
  input: ExclusionInput,
): Exclusion[] {
  const next: Exclusion = {
    exerciseId: input.exerciseId,
    reason: input.reason,
    since: input.today,
    ...(input.forever ? { forever: true } : {}),
    ...(input.joint ? { joint: input.joint } : {}),
  };
  return [...list.filter((item) => item.exerciseId !== input.exerciseId), next];
}

export function removeExclusion(
  list: readonly Exclusion[],
  exerciseId: string,
): Exclusion[] {
  return list.filter((item) => item.exerciseId !== exerciseId);
}

/** 계속 빼두기로 했다. 시계를 다시 돌린다 — 4주 뒤에 한 번 더 묻는다. */
export function keepExcluded(
  list: readonly Exclusion[],
  exerciseId: string,
  today: string,
): Exclusion[] {
  return list.map((item) =>
    item.exerciseId === exerciseId ? { ...item, since: today } : item);
}

/** 다시는 묻지 말라고 했다. */
export function excludeForever(
  list: readonly Exclusion[],
  exerciseId: string,
): Exclusion[] {
  return list.map((item) =>
    item.exerciseId === exerciseId ? { ...item, forever: true } : item);
}

/* ── 빠진 자리를 채운다 ─────────────────────────────── */

export interface Replacement {
  /** 뺀 종목 */
  removed: Exercise;
  /** 대신 할 것. 없을 수도 있다. */
  substitutes: Exercise[];
  text: string;
}

export interface ReplacementOptions {
  /**
   * 고를 수 있는 종목.
   *
   * 헬스장으로 좁히려면 `availableExercises(gym.equipmentIds)`를 넣는다.
   *
   * **기구 id 목록을 그대로 넘기면 안 된다.** 헬스장 기구는
   * 'barbell-set' · 'leg-press-machine' 같은 id이고, 종목이 들고 있는
   * `equipment`는 'barbell' · 'machine' 같은 갈래다. 둘은 다른 말이라
   * 섞으면 아무것도 안 맞고, 화면에는 "대체가 없습니다"가 뜬다 —
   * 있는데 없다고 말하는 것이라 제일 나쁜 종류의 거짓말이다.
   */
  pool?: readonly Exercise[];
  /** 이미 빠진 것들. 대체가 또 빠진 종목이면 안 된다. */
  excluded?: ReadonlySet<string>;
  limit?: number;
}

/**
 * 뺐으면 그 자리를 채운다.
 *
 * 그냥 빼기만 하면 그 부위 볼륨이 비고, 사용자는 왜 등이 안 크는지 모르게
 * 된다. **빼는 것은 허용하되 프로그램이 망가지지는 않게 한다** — 이게
 * 트레이너가 하는 일이다.
 *
 * 대체를 못 찾으면 못 찾았다고 말한다. 억지로 비슷하지도 않은 종목을
 * 내놓으면 그때부터 아무도 이 목록을 안 믿는다.
 */
export function replacementFor(
  exercise: Exercise,
  options: ReplacementOptions = {},
): Replacement {
  const excluded = options.excluded ?? new Set<string>();
  const pool = (options.pool ?? EXERCISES).filter((item) => !excluded.has(item.id));

  const substitutes = findSubstitutes(exercise, [], {
    pool,
    substituteLimit: options.limit ?? 2,
  });

  if (substitutes.length === 0) {
    return {
      removed: exercise,
      substitutes,
      text: `${withParticle(exercise.name, '을/를')} 뺍니다. 비슷한 자극을 주는 종목이 ` +
        '이 헬스장에는 없어서, 그 부위 주간 볼륨이 그만큼 줄어듭니다.',
    };
  }

  const names = substitutes.map((item) => item.name).join(' · ');
  return {
    removed: exercise,
    substitutes,
    // 조사는 바로 앞 단어에 붙는다 — 여럿을 이어 붙였으면 마지막 것을 본다.
    text: `${exercise.name} 대신 ${withParticle(names, '으로/로')} 그 볼륨을 채웁니다.`,
  };
}

/* ── 화면에 쓸 말 ───────────────────────────────────── */

/** 언제부터, 왜, 언제까지. */
export function describeExclusion(item: Exclusion, today: string): string {
  const days = daysBetween(item.since, today);
  const spec = reasonSpec(item.reason);

  if (spec.route === 'coach') {
    const left = REVIEW_WEEKS * 7 - days;
    return left > 0
      ? `가벼운 무게로 배우는 중 · ${Math.ceil(left / 7)}주 남음`
      : '배우는 기간이 끝났습니다';
  }

  if (item.forever) return `${spec.label} · 계속 뺍니다`;

  const left = REVIEW_WEEKS * 7 - days;
  if (left <= 0) return `${spec.label} · ${REVIEW_WEEKS}주가 지나 다시 여쭤봅니다`;
  return `${spec.label} · ${Math.ceil(left / 7)}주 뒤에 다시 여쭤봅니다`;
}

/** 다시 물을 때의 한 줄. 조르지 않고 사실만 말한다. */
export function reviewQuestion(item: Exclusion, exercise: Exercise): string {
  const named = withParticle(exercise.name, '을/를');
  if (item.reason === 'pain') {
    return `${named} 뺀 지 ${REVIEW_WEEKS}주가 됐습니다. 지금은 어떠신가요?`;
  }
  return `${named} 뺀 지 ${REVIEW_WEEKS}주가 됐습니다. 다시 해 보시겠어요?`;
}
