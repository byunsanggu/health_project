import { MUSCLE_LABELS_KO } from './muscles.ts';
import { primaryMuscle } from './session.ts';
import { withParticle } from './korean.ts';
import type { Exercise, MuscleGroup } from './types.ts';

/**
 * 종목 묶기 — 슈퍼세트와 크로스핏 세트.
 *
 * 둘을 묶으면 슈퍼세트, 셋에서 다섯을 묶으면 한 바퀴를 도는
 * 크로스핏 세트(서킷)다. 규칙은 같다. 다른 것은 바퀴의 길이뿐이다.
 *
 * 중요한 것 하나: 이건 **오늘 할 종목을 묶는 기능**이지, 프로그램을
 * 크로스핏으로 바꾸는 기능이 아니다. 하던 운동, 하던 중량, 하던 세트
 * 수를 그대로 두고 쉬는 방식만 바꾼다. 묶지 않으면 아무것도 달라지지
 * 않는다.
 *
 * 두 종목을 번갈아 하면 한쪽이 쉬는 동안 다른 쪽을 한다. 같은 볼륨을
 * 더 짧은 시간에 끝낼 수 있고, 이 앱이 이미 받고 있는 "오늘 40분밖에
 * 없다"에 대한 제일 직접적인 답이다.
 *
 * 다만 아무거나 묶으면 안 된다. 묶어서 잃는 것이 있다.
 *
 *   1. 같은 부위를 묶으면 뒤 종목의 무게가 떨어진다 — 볼륨은 남지만
 *      강도가 준다.
 *   2. 허리가 실리는 종목 둘을 묶으면 허리가 쉬질 못한다. 이건 시간을
 *      아끼자고 감수할 것이 아니다.
 *   3. 같은 기구를 쓰면 매 세트 원판을 갈아야 한다. 이론상 되지만
 *      현장에서 안 된다.
 *
 * 그래서 막을 것만 막고, 나머지는 무엇을 잃는지 말한 뒤 사용자가 정한다.
 */

export type PairQuality = 'best' | 'fine' | 'caution' | 'blocked';

export interface PairCheck {
  quality: PairQuality;
  /** 묶을 수 있는가 */
  allowed: boolean;
  /** 사용자에게 그대로 보여줄 한 줄 */
  reason: string;
}

/**
 * 길항근 짝.
 *
 * 미는 근육과 당기는 근육을 번갈아 하면 서로의 회복을 거의 방해하지 않는다.
 * 슈퍼세트가 제일 잘 통하는 조합이고, 시간도 가장 많이 아낀다.
 */
const ANTAGONIST: Partial<Record<MuscleGroup, MuscleGroup[]>> = {
  chest: ['back', 'rearDelt'],
  back: ['chest', 'frontDelt'],
  biceps: ['triceps'],
  triceps: ['biceps'],
  quads: ['hamstrings'],
  hamstrings: ['quads'],
  frontDelt: ['back', 'rearDelt'],
  rearDelt: ['chest', 'frontDelt'],
};

/** 허리가 실리는 정도. 둘 다 크면 묶지 않는다. */
function lowBackOf(exercise: Exercise): number {
  return exercise.jointStress?.lowBack ?? 0;
}

const HEAVY_BACK = 0.7;

/** 원판을 갈아야 하는 기구. 이런 것끼리 묶으면 세트마다 세팅을 다시 한다. */
const PLATE_LOADED = new Set(['barbell', 'smith']);

function isAntagonist(a: MuscleGroup | undefined, b: MuscleGroup | undefined): boolean {
  if (!a || !b) return false;
  return (ANTAGONIST[a] ?? []).includes(b);
}

/** 두 종목을 묶어도 되는가. */
export function checkPair(a: Exercise, b: Exercise): PairCheck {
  if (a.id === b.id) {
    return { quality: 'blocked', allowed: false, reason: '같은 종목끼리는 묶을 수 없습니다.' };
  }

  // 1) 허리 — 시간을 아끼자고 감수할 것이 아니다
  if (lowBackOf(a) >= HEAVY_BACK && lowBackOf(b) >= HEAVY_BACK) {
    return {
      quality: 'blocked',
      allowed: false,
      reason:
        `${withParticle(a.name, '과/와')} ${b.name} 둘 다 허리에 크게 실립니다. ` +
        '번갈아 하면 허리가 쉴 틈이 없습니다.',
    };
  }

  const muscleA = primaryMuscle(a);
  const muscleB = primaryMuscle(b);

  // 2) 같은 기구 — 매 세트 원판을 갈아야 한다
  if (PLATE_LOADED.has(a.equipment) && PLATE_LOADED.has(b.equipment)) {
    return {
      quality: 'caution',
      allowed: true,
      reason: '둘 다 원판을 끼우는 기구라 세트마다 무게를 바꿔야 합니다. 같은 무게로 할 수 있을 때만 묶으세요.',
    };
  }

  // 3) 같은 부위 — 컴파운드 세트. 볼륨은 남지만 강도가 준다
  if (muscleA && muscleA === muscleB) {
    return {
      quality: 'caution',
      allowed: true,
      reason:
        `둘 다 ${withParticle(MUSCLE_LABELS_KO[muscleA], '을/를')} 씁니다. ` +
        '뒤 종목의 무게가 떨어집니다 — 시간은 아끼지만 강도는 줍니다.',
    };
  }

  // 4) 길항근 — 제일 잘 맞는다
  if (isAntagonist(muscleA, muscleB)) {
    return {
      quality: 'best',
      allowed: true,
      reason: '미는 근육과 당기는 근육이라 서로 방해하지 않습니다. 슈퍼세트가 제일 잘 통하는 조합입니다.',
    };
  }

  return {
    quality: 'fine',
    allowed: true,
    reason: '쓰는 부위가 달라 번갈아 해도 괜찮습니다.',
  };
}

/** 나쁜 쪽이 이긴다 — 여러 짝을 한꺼번에 볼 때 쓴다. */
const QUALITY_RANK: Record<PairQuality, number> = {
  blocked: 0,
  caution: 1,
  fine: 2,
  best: 3,
};

/** 한 묶음에 넣을 수 있는 최대 종목 수. */
export const MAX_GROUP = 5;

/**
 * 크로스핏 세트에 넣을 수 있는, 허리가 실리는 종목의 수.
 *
 * 바퀴 후반에는 숨이 차 있다. 그 상태로 무거운 걸 또 드는 것이
 * 크로스핏에서 사람이 다치는 제일 흔한 방식이다. 한 바퀴에 하나까지다.
 */
const HEAVY_PER_CIRCUIT = 1;

export type GroupKind = 'superset' | 'circuit';

/** 둘이면 슈퍼세트, 셋 이상이면 크로스핏 세트다. */
export function groupKind(group: readonly string[]): GroupKind {
  return group.length >= 3 ? 'circuit' : 'superset';
}

/** 화면에 그대로 쓸 이름. */
export function groupLabel(group: readonly string[]): string {
  return groupKind(group) === 'circuit' ? '크로스핏 세트' : '슈퍼세트';
}

/**
 * 이 묶음에 이 종목을 더 넣어도 되는가.
 *
 * 이미 들어 있는 것들과 하나씩 다 따져 보고 제일 나쁜 답을 돌려준다.
 * 거기에 바퀴가 길어질 때만 생기는 문제 두 가지를 더 본다.
 */
export function checkAdd(members: readonly Exercise[], candidate: Exercise): PairCheck {
  if (members.some((member) => member.id === candidate.id)) {
    return { quality: 'blocked', allowed: false, reason: '이미 이 묶음에 들어 있습니다.' };
  }

  if (members.length >= MAX_GROUP) {
    return {
      quality: 'blocked',
      allowed: false,
      reason:
        `한 묶음은 ${MAX_GROUP}종목까지입니다. 더 늘리면 한 바퀴가 너무 길어져 ` +
        '첫 종목으로 돌아왔을 때 이미 회복이 끝나 있습니다 — 그러면 묶은 뜻이 없습니다.',
    };
  }

  // 1) 하나씩 다 따진다. 막히는 게 하나라도 있으면 못 넣는다.
  let worst: PairCheck = { quality: 'best', allowed: true, reason: '쓰는 부위가 달라 번갈아 해도 괜찮습니다.' };
  for (const member of members) {
    const check = checkPair(member, candidate);
    if (QUALITY_RANK[check.quality] < QUALITY_RANK[worst.quality]) worst = check;
  }
  if (!worst.allowed) return worst;

  const size = members.length + 1;

  // 2) 바퀴가 길어지면 허리가 실리는 종목은 하나까지다
  if (size >= 3) {
    const heavy = [...members, candidate].filter((exercise) => lowBackOf(exercise) >= HEAVY_BACK);
    const [first, second] = heavy;
    if (first && second) {
      return {
        quality: 'blocked',
        allowed: false,
        reason:
          `${withParticle(first.name, '과/와')} ${second.name} 둘 다 허리에 크게 실립니다. ` +
          '한 바퀴에 허리 쓰는 종목은 하나까지입니다 — 숨이 찬 상태로 두 번째를 들면 자세가 먼저 무너집니다.',
      };
    }
    if (first && heavy.length === HEAVY_PER_CIRCUIT && QUALITY_RANK[worst.quality] > QUALITY_RANK.caution) {
      return {
        quality: 'caution',
        allowed: true,
        reason:
          `${withParticle(first.name, '은/는')} 바퀴 맨 앞에 두세요. ` +
          '숨이 찬 뒤에 하면 반복이 아니라 자세가 먼저 떨어집니다.',
      };
    }
  }

  return worst;
}

export interface SupersetTiming {
  /** 두 종목 사이 — 기구를 옮기는 시간만 */
  betweenSeconds: number;
  /** 한 바퀴를 마치고 쉬는 시간 */
  afterSeconds: number;
  /** 따로 할 때보다 한 바퀴에 아끼는 시간 */
  savedSeconds: number;
}

/**
 * 묶었을 때의 휴식.
 *
 * 흔한 오해가 하나 있다. 슈퍼세트는 "쉬지 않고 하는 것"이 아니다. 두 종목
 * 사이에는 기구를 옮길 만큼만 쉬고, **한 바퀴를 마친 뒤에는 원래대로
 * 쉬어야 한다.** 여기서 휴식을 깎으면 뒤 세트가 무너지고, 그러면 아낀
 * 시간만큼 볼륨을 잃는다.
 *
 * 아끼는 시간은 "두 번 쉴 것을 한 번만 쉬는 것"이다. 그 이상을 약속하면
 * 거짓말이다.
 */
export function supersetTiming(
  a: Exercise,
  b: Exercise,
  restSeconds: number,
): SupersetTiming {
  return circuitTiming([a, b], restSeconds);
}

/**
 * 한 동작에서 다음 동작으로 넘어갈 때 쉬는 시간.
 *
 * 기구를 옮기는 시간만이다. 다만 같은 근육을 또 쓰면 바로 이어갈 수가
 * 없다 — 반복이 절반으로 떨어진다. 그럴 때만 조금 더 준다.
 */
export function transitionRest(from: Exercise, to: Exercise): number {
  const muscle = primaryMuscle(from);
  return muscle && muscle === primaryMuscle(to) ? 45 : 20;
}

/**
 * 묶었을 때의 휴식 — 둘이든 다섯이든 같은 계산이다.
 *
 * 동작 사이에는 옮길 만큼만 쉬고, **한 바퀴를 마친 뒤에는 제대로 쉰다.**
 * 바퀴가 길수록 한 바퀴 끝의 숨이 더 차 있으므로 그만큼 더 준다. 여기서
 * 아끼면 다음 바퀴의 첫 종목이 무너지고, 아낀 시간만큼 볼륨을 잃는다.
 */
export function circuitTiming(
  exercises: readonly Exercise[],
  restSeconds: number,
): SupersetTiming {
  if (exercises.length < 2) {
    return { betweenSeconds: 0, afterSeconds: restSeconds, savedSeconds: 0 };
  }

  // 한 바퀴를 돌며 실제로 쉬는 시간을 다 더한다 (마지막 동작 뒤는 제외)
  let transitions = 0;
  let longest = 0;
  for (let i = 0; i + 1 < exercises.length; i += 1) {
    const from = exercises[i];
    const to = exercises[i + 1];
    if (!from || !to) continue;
    const gap = transitionRest(from, to);
    transitions += gap;
    if (gap > longest) longest = gap;
  }

  /*
   * 바퀴가 길면 한 바퀴 끝의 피로가 다르다. 3종목부터 동작 하나마다
   * 15초씩 더 쉰다 — 5종목이면 45초가 붙는다.
   */
  const after = restSeconds + Math.max(0, exercises.length - 2) * 15;

  // 따로 하면 종목마다 한 번씩 쉰다. 묶으면 사이 휴식 + 한 번만 쉰다.
  const saved = Math.max(0, restSeconds * exercises.length - (transitions + after));

  return { betweenSeconds: longest, afterSeconds: after, savedSeconds: saved };
}

/**
 * 묶음 하나. 둘이면 슈퍼세트, 셋에서 다섯이면 크로스핏 세트다.
 * 순서가 곧 바퀴 도는 순서다.
 */
export type SupersetGroup = string[];

/**
 * 묶음 목록에서 이 종목이 속한 짝을 찾는다.
 * 없으면 undefined — 혼자 하는 종목이다.
 */
export function groupOf(
  groups: readonly SupersetGroup[],
  exerciseId: string,
): SupersetGroup | undefined {
  return groups.find((group) => group.includes(exerciseId));
}

/**
 * 묶음을 지금 세션에 맞게 정리한다.
 *
 * 종목이 교체되거나 빠지면 묶음이 깨진다. 넷 중 하나가 빠졌다고 나머지
 * 셋까지 버릴 이유는 없으니 빠진 것만 빼고, 하나만 남으면 버린다 —
 * 혼자 남은 묶음은 그냥 단일 종목이다.
 */
export function pruneGroups(
  groups: readonly SupersetGroup[],
  presentIds: readonly string[],
): SupersetGroup[] {
  const present = new Set(presentIds);
  return groups
    .map((group) => group.filter((id) => present.has(id)))
    .filter((group) => group.length >= 2);
}

/**
 * 묶은 뒤의 순서.
 *
 * 짝이 떨어져 있으면 번갈아 할 수가 없다. 앞쪽 종목 자리에 짝을 붙여
 * 나란히 놓는다 — 순서를 직접 바꾼 사용자의 의도(앞에 둔 것은 앞에)는
 * 지키면서 짝만 끌어온다.
 */
export function orderWithGroups(
  ids: readonly string[],
  groups: readonly SupersetGroup[],
): string[] {
  const out: string[] = [];
  const placed = new Set<string>();

  for (const id of ids) {
    if (placed.has(id)) continue;
    out.push(id);
    placed.add(id);

    const group = groupOf(groups, id);
    if (!group) continue;
    for (const other of group) {
      if (placed.has(other) || !ids.includes(other)) continue;
      out.push(other);
      placed.add(other);
    }
  }

  return out;
}
