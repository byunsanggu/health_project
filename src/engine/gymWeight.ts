import type { Equipment, Exercise, SessionLog } from './types.ts';

/**
 * 헬스장마다 다른 중량.
 *
 * 바벨 100kg은 어디서나 100kg이다. 그런데 레그프레스 100kg은 그렇지 않다 —
 * 기계마다 썰매 각도와 카운터웨이트가 달라서 실제 부하가 20~30% 차이난다.
 * 케이블은 도르래 비율이 2:1인 기계와 1:1인 기계가 섞여 있고, 스미스머신은
 * 바 자체가 7kg짜리도 있고 25kg짜리도 있다.
 *
 * 세 곳을 다니는 사람에게 이걸 무시하면 A짐에서 쌓은 100kg 기록을 들고 B짐에
 * 가서 엉뚱한 무게로 시작하게 된다. 너무 가벼우면 한 세션을 버리고, 너무
 * 무거우면 다친다.
 *
 * 그래서 중량 이력을 종목이 아니라 "종목 × 헬스장"으로 본다. 다만 전부
 * 나누면 안 된다 — 바벨과 덤벨까지 나누면 헬스장을 옮길 때마다 처음부터
 * 시작하게 되고, 그건 사실과 다르다.
 */

/**
 * 기계마다 표기 중량이 다른 기구.
 *
 * band는 밴드 색깔마다 장력이 다르고 제조사 기준도 제각각이라 같이 묶는다.
 * bodyweight는 체중이 기준이라 어디서나 같지만, 어시스트 풀업 머신처럼
 * 보조 중량이 붙는 종목은 machine으로 분류돼 있어 따로 처리할 필요가 없다.
 */
/**
 * 기계 식별자. 라벨이 아니라 열쇠다 — 화면에 그대로 보여주지 않는다.
 * 쓰는 쪽 규칙은 machine.ts에 있다.
 */
export type MachineId = string;

/**
 * 처음부터 쓰던 기계.
 *
 * 옛 기록에는 이 칸이 없다. 없으면 'a'로 본다 — 그래서 이미 쌓인 기록을
 * 손댈 필요가 없다.
 */
export const FIRST_MACHINE: MachineId = 'a';

/** 이 세트는 어느 기계에서 나왔는가. */
export function machineOf(set: { machine?: string }): MachineId {
  return set.machine || FIRST_MACHINE;
}

export const GYM_SPECIFIC_EQUIPMENT: readonly Equipment[] = ['machine', 'cable', 'smith', 'band'];

const GYM_SPECIFIC = new Set<Equipment>(GYM_SPECIFIC_EQUIPMENT);

/** 이 종목의 중량이 헬스장에 따라 달라지는가. */
export function isGymSpecific(exercise: Exercise): boolean {
  return GYM_SPECIFIC.has(exercise.equipment);
}

export interface HistoryScope {
  /** 지금 있는 헬스장 */
  gymId?: string;
  /**
   * 그 헬스장에 같은 종목 기계가 둘 이상일 때 어느 쪽인가.
   *
   * 안 주면 첫 번째 기계로 본다. 기계를 나눈 적이 없는 사람에게는
   * 모든 기록이 첫 번째 기계이므로 아무것도 달라지지 않는다.
   */
  machine?: string;
  /**
   * 헬스장을 가리지 않고 전부 본다.
   * 볼륨 집계처럼 "몇 세트 했는가"만 보는 계산에서는 헬스장이 상관없다.
   */
  anyGym?: boolean;
}

/**
 * 중량 처방에 쓸 이력.
 *
 * 바벨·덤벨은 전부 본다. 머신·케이블·스미스는 같은 헬스장 기록만 본다.
 * 같은 헬스장 기록이 없으면 빈 배열을 돌려주고, 그러면 처방 쪽에서
 * "첫 수행"으로 보고 다른 종목에서 환산해 출발점을 잡는다.
 */
export function weightHistoryFor(
  sessions: readonly SessionLog[],
  exercise: Exercise,
  scope: HistoryScope = {},
): SessionLog[] {
  if (scope.anyGym || !isGymSpecific(exercise) || !scope.gymId) return [...sessions];

  const atGym = sessions.filter((session) => session.gymId === scope.gymId);
  const machine = scope.machine || FIRST_MACHINE;

  /*
   * 다른 기계로 한 세트는 **이 종목에 한해** 걷어낸다.
   *
   * 세션을 통째로 버리면 안 된다. 같은 날 다른 종목도 했고, 그 기록은
   * 멀쩡하다. 그리고 이 종목 세트가 하나도 안 남은 세션은 findLastSession이
   * 알아서 건너뛴다 — "지난번"이 다른 기계가 되는 일이 없다.
   */
  return atGym.map((session) => ({
    ...session,
    sets: session.sets.filter(
      (set) => set.exerciseId !== exercise.id || machineOf(set) === machine,
    ),
  }));
}

export interface GymWeightNote {
  /** 이 헬스장에서 이 종목을 해본 적이 있는가 */
  known: boolean;
  /** 다른 헬스장에는 기록이 있는가 */
  knownElsewhere: boolean;
  note?: string;
}

/**
 * 처음 쓰는 기계인지 알려준다.
 *
 * "다른 곳에서 100kg 했지만 이 기계는 처음"이라는 사실을 숨기면 안 된다.
 * 사용자가 첫 세트에서 확인하게 만들어야 한다.
 */
export function describeGymWeight(
  sessions: readonly SessionLog[],
  exercise: Exercise,
  gymId?: string,
): GymWeightNote {
  if (!isGymSpecific(exercise)) return { known: true, knownElsewhere: true };

  /*
   * 어느 헬스장인지 모르면 경고할 근거도 없다. 이력을 헬스장으로 거르지 않고
   * 전부 쓰면서 "처음 쓰는 기계"라고 말하면 앞뒤가 안 맞는다.
   */
  if (!gymId) return { known: true, knownElsewhere: true };

  let known = false;
  let knownElsewhere = false;

  for (const session of sessions) {
    if (!session.sets.some((set) => set.exerciseId === exercise.id && !set.warmup)) continue;
    if (session.gymId === gymId) known = true;
    else knownElsewhere = true;
  }

  if (known) return { known, knownElsewhere };

  if (knownElsewhere) {
    return {
      known: false,
      knownElsewhere: true,
      note:
        '이 헬스장에서는 처음 쓰는 기계입니다. 같은 종목이라도 기계마다 표기 중량이 다르니, ' +
        '첫 세트는 가볍게 잡고 확인한 뒤 올리세요.',
    };
  }

  return { known: false, knownElsewhere: false };
}
