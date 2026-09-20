import { MUSCLE_LABELS_KO } from './muscles.ts';
import { primaryMuscle } from './session.ts';
import { withParticle } from './korean.ts';
import type { Exercise, MuscleGroup } from './types.ts';

/**
 * 종목 순서 바꾸기.
 *
 * 현장에서 순서를 바꿀 이유는 늘 있다 — 랙에 사람이 있고, 오늘은 어깨부터
 * 하고 싶고, 시간이 없어서 중요한 것부터 하고 싶다. 막을 이유가 없다.
 *
 * 다만 순서가 아무래도 되는 건 아니다. 관절 부하가 큰 복합 동작을 뒤로
 * 빼면 이미 지친 상태로 제일 위험한 걸 하게 된다. 그래서 **막지 않고
 * 말한다** — 이 앱이 다른 결정에서 쓰는 것과 같은 규칙이다.
 */

/** 한 칸 옮긴 새 배열. 원본은 건드리지 않는다. */
export function moveItem<T>(items: readonly T[], from: number, to: number): T[] {
  const out = [...items];
  if (from < 0 || from >= out.length) return out;
  const target = Math.max(0, Math.min(out.length - 1, to));
  const [moved] = out.splice(from, 1);
  if (moved === undefined) return out;
  out.splice(target, 0, moved);
  return out;
}

export type OrderIssueKind = 'lateHeavy' | 'preExhaust';

export interface OrderIssue {
  kind: OrderIssueKind;
  exerciseId: string;
  /** 사용자에게 그대로 보여줄 한 줄 */
  text: string;
  /** 위험을 말하는가, 참고를 말하는가 */
  severity: 'warn' | 'note';
}

function lowBackOf(exercise: Exercise): number {
  return exercise.jointStress?.lowBack ?? 0;
}

function isIsolation(exercise: Exercise): boolean {
  return exercise.pattern === 'isolation' || exercise.pattern === 'core';
}

/**
 * 피로 상태에서 위험해지는 건 **허리**다.
 *
 * 처음에는 관절 부하 최댓값으로 봤는데, 그러면 "케이블 플라이 다음에
 * 벤치프레스"가 경고에 걸렸다. 그건 선피로라는 정상적인 기법이고, 가슴이
 * 지치면 드는 무게가 줄 뿐 다치지 않는다.
 *
 * 반면 허리가 지친 상태의 데드리프트는 다친다. 자세가 무너지는 곳이
 * 하필 제일 위험한 곳이기 때문이다. 그래서 경고는 허리 부하로만 낸다.
 */
const HEAVY_BACK = 0.7;

/**
 * 순서를 훑고 걸리는 것을 돌려준다. 비어 있으면 괜찮은 순서다.
 *
 * 규칙은 둘뿐이다. 늘리면 경고가 많아지고, 경고가 많아지면 아무도 안 읽는다.
 *
 * 처음에는 "무거운 종목이 세 번째 이후면 경고"로 짰는데, 하체 날은 무거운
 * 복합이 셋이라 **프로그램이 짜 준 기본 순서가 자기 경고에 걸렸다.** 앱이
 * 자기 처방에 경고를 띄우면 그 경고는 그때부터 배경 소음이다.
 *
 * 진짜 문제는 순번이 아니라 **무엇 다음에 오느냐**다. 컬을 하고 데드리프트를
 * 하는 게 위험한 것이지, 스쿼트를 하고 데드리프트를 하는 건 그냥 하체 날이다.
 */
export function reviewOrder(exercises: readonly Exercise[]): OrderIssue[] {
  const issues: OrderIssue[] = [];
  const flagged = new Set<string>();

  // 1) 고립 운동으로 지친 뒤에 무거운 복합 동작이 온다
  let isolationBefore: Exercise | undefined;
  for (const exercise of exercises) {
    if (isIsolation(exercise)) {
      if (!isolationBefore) isolationBefore = exercise;
      continue;
    }
    if (!isolationBefore || lowBackOf(exercise) < HEAVY_BACK) continue;

    issues.push({
      kind: 'lateHeavy',
      exerciseId: exercise.id,
      severity: 'warn',
      text:
        `${isolationBefore.name} 다음에 ${exercise.name}입니다. ` +
        '허리가 지친 상태에서 하면 자세가 먼저 무너집니다. 앞으로 옮기세요.',
    });
    flagged.add(exercise.id);
  }

  /*
   * 2) 같은 부위 고립이 복합 앞에 왔다.
   *
   * 이건 틀린 게 아니라 "선피로"라는 기법이다. 일부러 그랬을 수도 있으므로
   * 경고가 아니라 참고로 말한다 — 모르고 그랬다면 복합 동작에서 쓰는
   * 무게가 떨어진다는 걸 알아야 한다.
   */
  const isolatedFirst = new Map<MuscleGroup, Exercise>();
  for (const exercise of exercises) {
    const muscle = primaryMuscle(exercise);
    if (!muscle) continue;
    if (isIsolation(exercise)) {
      if (!isolatedFirst.has(muscle)) isolatedFirst.set(muscle, exercise);
      continue;
    }
    const before = isolatedFirst.get(muscle);
    if (!before) continue;
    isolatedFirst.delete(muscle);  // 한 부위에 한 번만 말한다
    // 위에서 이미 위험하다고 말했으면 같은 짝을 두 번 말하지 않는다
    if (flagged.has(exercise.id)) continue;

    issues.push({
      kind: 'preExhaust',
      exerciseId: exercise.id,
      severity: 'note',
      text:
        `${before.name} 다음에 ${exercise.name}입니다. ` +
        `${withParticle(MUSCLE_LABELS_KO[muscle], '을/를')} 먼저 지치게 하는 선피로 방식이라, ` +
        '복합 동작에서 드는 무게가 떨어집니다. 의도한 것이면 그대로 두세요.',
    });
  }

  return issues;
}

/**
 * 프로그램이 짜 준 순서로 되돌린다.
 *
 * 직접 바꾼 순서를 기억하되 되돌릴 길을 남긴다 — 바꿔 보고 아니다 싶을 때
 * 하나씩 되돌리게 하면 아무도 안 쓴다.
 */
export function isDefaultOrder(
  current: readonly string[],
  original: readonly string[],
): boolean {
  if (current.length !== original.length) return false;
  return current.every((id, index) => id === original[index]);
}

/**
 * 저장해 둔 순서를 지금 세션에 적용한다.
 *
 * 세션은 다시 짜일 수 있다 — 통증이 생기거나, 기구를 끄거나, 시간을 줄이면
 * 종목이 바뀐다. 그때 저장된 순서에 없는 종목이 생기고, 있던 종목이 사라진다.
 * 없는 것은 무시하고 새로 생긴 것은 뒤에 붙인다 — 순서를 한 번 바꿨다고
 * 이후의 종목 교체가 막히면 안 된다.
 */
export function applyOrder<T>(
  items: readonly T[],
  order: readonly string[] | null | undefined,
  idOf: (item: T) => string,
): T[] {
  if (!order || order.length === 0) return [...items];

  const rank = new Map<string, number>();
  order.forEach((id, index) => rank.set(id, index));

  const known: T[] = [];
  const fresh: T[] = [];
  for (const item of items) {
    (rank.has(idOf(item)) ? known : fresh).push(item);
  }

  known.sort((a, b) => rank.get(idOf(a))! - rank.get(idOf(b))!);
  return [...known, ...fresh];
}
