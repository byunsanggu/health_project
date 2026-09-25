import { MUSCLE_LABELS_KO } from './muscles.ts';
import { primaryMuscle } from './session.ts';
import { withParticle } from './korean.ts';
import type { Exercise, MuscleGroup } from './types.ts';

/**
 * 슈퍼세트.
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
  const check = checkPair(a, b);

  /*
   * 같은 부위를 묶었으면 사이 휴식을 조금 더 준다. 뒤 종목이 같은 근육을
   * 또 쓰는데 바로 이어가면 반복이 절반으로 떨어진다.
   */
  const between = check.quality === 'caution' && primaryMuscle(a) === primaryMuscle(b) ? 45 : 20;
  const after = restSeconds;

  // 따로 하면 restSeconds를 두 번 쉰다. 묶으면 between + after만 쉰다.
  const saved = Math.max(0, restSeconds * 2 - (between + after));

  return { betweenSeconds: between, afterSeconds: after, savedSeconds: saved };
}

/** 슈퍼세트 묶음 하나. 지금은 둘까지만 묶는다. */
export type SupersetGroup = [string, string];

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
 * 종목이 교체되거나 빠지면 짝이 깨진다. 한쪽만 남은 묶음은 버린다 —
 * 한쪽이 사라진 슈퍼세트는 그냥 단일 종목이다.
 */
export function pruneGroups(
  groups: readonly SupersetGroup[],
  presentIds: readonly string[],
): SupersetGroup[] {
  const present = new Set(presentIds);
  return groups.filter((group) => group.every((id) => present.has(id)));
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
