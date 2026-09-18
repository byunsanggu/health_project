import { EXERCISES } from './exercises.ts';
import { availableEquipmentOf, isAvailableAt, type GymProfile } from './gym.ts';
import { withParticle } from './korean.ts';
import { MUSCLE_LABELS_KO } from './muscles.ts';
import { findSubstitutes, similarity } from './pain.ts';
import { primaryMuscle, type PlannedExercise } from './session.ts';
import { classifyRoles } from './timeBudget.ts';
import type { Equipment, Exercise, PainReport } from './types.ts';

/**
 * 기구 점유 대응.
 *
 * 헬스장에서 계획이 깨지는 가장 흔한 이유는 통증도 피로도 아니다.
 * 스쿼트랙에 사람이 있는 것이다. 그런데 대부분의 앱은 이걸 모르는 척한다 —
 * 사용자는 그냥 앱을 끄고 아무거나 하게 된다.
 *
 * 판단 순서는 현장에서 하는 것과 같다.
 *
 *   1. 순서를 바꾼다. 대체하면 자극이 달라지지만, 같은 종목을 나중에 하면
 *      잃는 게 없다. 뒤에 할 종목을 지금 앞으로 당긴다.
 *   2. 순서를 못 바꾸면(마지막 종목이거나 뒤 종목도 다 막혔으면) 대체한다.
 *   3. 메인 복합 동작은 쉽게 미루지 않는다. 피로가 쌓인 뒤에 하면 그날
 *      가장 중요한 세트를 손해 보고 한다. 짧으면 기다리는 쪽이 낫다.
 */
export type OccupancyAction = 'reorder' | 'substitute' | 'wait';

export interface OccupancyOption {
  exercise: Exercise;
  /** 원래 자극과 얼마나 겹치는가 (0~1) */
  overlap: number;
  /** 이 종목으로 바꾸면 워밍업을 다시 해야 하는가 */
  needsRewarmup: boolean;
  note: string;
}

export interface OccupancyPlan {
  action: OccupancyAction;
  /** 지금 대신 할 종목 — reorder면 세션 안의 뒤 종목, substitute면 대체 종목 */
  now?: Exercise;
  /** reorder일 때, 막힌 종목이 밀려날 자리 (0-based) */
  deferredTo?: number;
  /** 다시 데워야 하는 부위가 생기는가 */
  needsRewarmup: boolean;
  reason: string;
  /** 사용자가 직접 고를 수 있는 다른 선택지 */
  options: OccupancyOption[];
}

export interface OccupancyInput {
  /** 오늘 세션의 종목들 (순서대로) */
  exercises: readonly PlannedExercise[];
  /** 기구가 막힌 종목 */
  exerciseId: string;
  /** 이미 끝낸 종목 id */
  completed?: readonly string[];
  gym?: GymProfile;
  pain?: readonly PainReport[];
  /**
   * 지금 이 세션에서 쓸 수 없다고 표시된 기구들.
   * 랙 하나가 막히면 랙을 쓰는 종목이 전부 막힌다 — 종목이 아니라 기구 단위다.
   */
  busyEquipment?: readonly Equipment[];
  /** 이만큼은 기다릴 수 있다 (분). 메인 복합 동작을 기다릴지 판단하는 기준 */
  patienceMinutes?: number;
}

const DEFAULTS = {
  patienceMinutes: 4,
};

/** 대체로 인정할 최소 자극 겹침. 이보다 낮으면 다른 운동이지 대체가 아니다. */
const MIN_OVERLAP = 0.5;

/**
 * 한 대가 여러 종목을 받는 기구.
 *
 * 랙이 막히면 바벨 스쿼트도 바벨 로우도 못 한다 — 같은 랙을 쓰기 때문이다.
 * 반면 레그프레스가 막혔다고 레그컬까지 못 하는 건 아니다. 머신은 종목마다
 * 다른 기계다. 이걸 구분하지 않으면 "머신이 막혔다"는 이유로 헬스장의 절반을
 * 못 쓰는 것으로 계산한다.
 */
const SHARED_STATIONS = new Set<Equipment>(['barbell', 'smith']);

export function planAroundOccupied(input: OccupancyInput): OccupancyPlan {
  const config = { ...DEFAULTS, ...input };
  const completed = new Set(input.completed ?? []);
  const busy = new Set<Equipment>(input.busyEquipment ?? []);

  const index = input.exercises.findIndex((item) => item.exercise.id === input.exerciseId);
  const blocked = input.exercises[index];
  if (!blocked) {
    return {
      action: 'wait',
      needsRewarmup: false,
      reason: '오늘 세션에 없는 종목입니다.',
      options: [],
    };
  }

  // 랙처럼 여러 종목이 한 대를 나눠 쓰는 기구만 기구 단위로 막는다.
  if (SHARED_STATIONS.has(blocked.exercise.equipment)) busy.add(blocked.exercise.equipment);
  const unusable = (exercise: Exercise) =>
    exercise.id === blocked.exercise.id || busy.has(exercise.equipment);

  const roles = classifyRoles(input.exercises);
  const role = roles[index] ?? 'accessory';
  const options = substituteOptions(blocked.exercise, input, unusable);

  // 1) 뒤에 남은 종목 중 지금 할 수 있는 것
  const next = input.exercises.findIndex((item, i) =>
    i > index && !completed.has(item.exercise.id) && !unusable(item.exercise),
  );

  if (next >= 0) {
    const pulled = input.exercises[next]!.exercise;
    const rewarm = primaryMuscle(pulled) !== primaryMuscle(blocked.exercise);
    return {
      action: 'reorder',
      now: pulled,
      deferredTo: next,
      needsRewarmup: rewarm,
      reason:
        `${withParticle(pulled.name, '을/를')} 먼저 합니다. ` +
        `${withParticle(blocked.exercise.name, '은/는')} 비는 대로 돌아와서 하면 되니 자극은 그대로입니다.` +
        (role === 'primary' ? ' 다만 오늘의 메인 동작이니 너무 뒤로 미루지 말고, 비면 바로 돌아오세요.' : '') +
        (rewarm ? ` 부위가 달라 ${warmupNote(pulled)}` : ''),
      options,
    };
  }

  // 2) 미룰 곳이 없다 — 메인 복합 동작이면 기다리는 편이 낫다
  if (role === 'primary') {
    return {
      action: 'wait',
      needsRewarmup: false,
      reason:
        `${withParticle(blocked.exercise.name, '은/는')} 오늘의 메인 동작입니다. ` +
        `${config.patienceMinutes}분 안에 빌 것 같으면 기다리세요 — ` +
        '대체하면 그날 가장 중요한 세트를 손해 보고 합니다. 아래에서 직접 고를 수도 있습니다.',
      options,
    };
  }

  // 3) 보조·고립이면 대체한다
  const best = options[0];
  if (!best) {
    return {
      action: 'wait',
      needsRewarmup: false,
      reason:
        `${withParticle(blocked.exercise.name, '을/를')} 대신할 만한 종목이 이 헬스장에 없습니다. ` +
        '기다리거나, 오늘은 건너뛰고 다음 세션에서 채우세요.',
      options: [],
    };
  }

  return {
    action: 'substitute',
    now: best.exercise,
    needsRewarmup: best.needsRewarmup,
    reason:
      `${withParticle(best.exercise.name, '으로/로')} 대체합니다. ` +
      `${muscleLabel(blocked.exercise)} 자극이 ${Math.round(best.overlap * 100)}% 겹칩니다.` +
      (best.needsRewarmup ? ` ${warmupNote(best.exercise)}` : ''),
    options,
  };
}

/** 지금 쓸 수 있는 기구로 할 수 있는 대체 후보. */
function substituteOptions(
  blocked: Exercise,
  input: OccupancyInput,
  unusable: (exercise: Exercise) => boolean,
): OccupancyOption[] {
  const gym = input.gym;
  const planned = new Set(input.exercises.map((item) => item.exercise.id));

  const pool = EXERCISES.filter((candidate) => {
    if (unusable(candidate)) return false;
    if (gym && !isAvailableAt(candidate, gym)) return false;
    // 오늘 이미 하기로 한 종목은 대체가 아니라 중복이다.
    return !planned.has(candidate.id);
  });

  // 통증이 있으면 통증 게이트를 통과한 것만 후보가 된다.
  const painFiltered = (input.pain ?? []).some((report) => report.score > 0)
    ? new Set(
        findSubstitutes(blocked, input.pain ?? [], {
          pool,
          availableEquipment: gym ? availableEquipmentOf(gym) : undefined,
          substituteLimit: pool.length,
        }).map((item) => item.id),
      )
    : null;

  return pool
    .filter((candidate) => !painFiltered || painFiltered.has(candidate.id))
    .map((candidate) => ({ candidate, overlap: similarity(blocked, candidate) }))
    .filter((entry) => entry.overlap >= MIN_OVERLAP)
    /*
     * 같은 근육이라도 동작 결이 다르면 같은 운동이 아니다. 레그컬 대신
     * 스티프 레그 데드리프트를 하면 햄스트링은 겹치지만, 하나는 무릎 굴곡이고
     * 하나는 고관절 신전이다. 겹침 수치는 그대로 두고 순서에서만 같은 패턴을
     * 앞세운다 — 사용자에게 보여주는 숫자를 손대지는 않는다.
     */
    .sort((a, b) => {
      const bias = (entry: { candidate: Exercise }) =>
        entry.candidate.pattern === blocked.pattern ? 0.08 : 0;
      return (b.overlap + bias(b)) - (a.overlap + bias(a));
    })
    .slice(0, 3)
    .map((entry) => {
      const needsRewarmup = primaryMuscle(entry.candidate) !== primaryMuscle(blocked);
      const samePattern = entry.candidate.pattern === blocked.pattern;
      return {
        exercise: entry.candidate,
        overlap: Math.round(entry.overlap * 100) / 100,
        needsRewarmup,
        note:
          `${muscleLabel(blocked)} 자극 ${Math.round(entry.overlap * 100)}% 겹침` +
          (samePattern ? '' : ' · 동작 결이 다름') +
          (needsRewarmup ? ' · 워밍업 다시' : ''),
      };
    });
}

function muscleLabel(exercise: Exercise): string {
  const muscle = primaryMuscle(exercise);
  return muscle ? MUSCLE_LABELS_KO[muscle] : '같은 부위';
}

function warmupNote(exercise: Exercise): string {
  const muscle = primaryMuscle(exercise);
  return muscle
    ? `${withParticle(MUSCLE_LABELS_KO[muscle], '은/는')} 다시 데우고 들어갑니다.`
    : '워밍업을 다시 합니다.';
}
