import type { Exercise } from './types.ts';

export interface RestPrescription {
  /** 타이머에 넣을 초 */
  seconds: number;
  /** 허용 범위 — 딱 맞출 필요는 없다 */
  range: { min: number; max: number };
  reason: string;
}

export interface RestInput {
  exercise: Exercise;
  /** 그 세트의 목표 반복 */
  reps: number;
  /** 그 세트의 목표 RIR */
  targetRir: number;
  /** 마지막 세트면 다음 종목으로 넘어가므로 조금 짧아도 된다 */
  isLastSet?: boolean;
}

/**
 * 세트 간 휴식 시간.
 *
 * 볼륨을 관리하면서 휴식을 안 다루면 앞뒤가 안 맞는다. 90초 쉬고 한 4세트와
 * 3분 쉬고 한 4세트는 같은 4세트가 아니다 — 짧게 쉬면 뒤 세트의 반복이 무너져
 * 유효 볼륨이 줄어든다.
 *
 * 기준: 복합 동작일수록, 무거울수록(반복이 적을수록), 실패에 가까울수록 길게.
 *
 * 여기서 나오는 값은 **근비대 기준**이다. 블록 유형이 배수로 늘리고 줄인다
 * (근력 ×1.5, 한계 돌파 ×2, 고밀도 ×0.65, 컨디셔닝 ×0.4). 그래서 이 함수가
 * 좁은 띠를 지키면 근력 블록은 알아서 2분대가 되고 컨디셔닝은 30초대가 된다.
 * 여기서 3분을 주면 근력 블록이 4분 반이 되어 아무도 안 지킨다.
 */

/**
 * 휴식 띠. 현장 기준이다.
 *
 * 1분 아래로 내려가면 복합 동작에서 뒤 세트가 확실히 무너지고, 1분 30초를
 * 넘기면 한 세션이 늘어져서 지키지 않게 된다. 이 두 값이 트레이너 판단이고,
 * 아래 계산은 그 안에서 어디에 둘지만 정한다.
 */
export const REST_MIN_SECONDS = 60;
export const REST_MAX_SECONDS = 90;

export function restFor(input: RestInput): RestPrescription {
  const { exercise, reps, targetRir } = input;
  const isIsolation = exercise.pattern === 'isolation' || exercise.pattern === 'core';

  let seconds: number;
  let reason: string;

  if (isIsolation) {
    seconds = 60;
    reason = '고립 운동은 국소 피로만 회복하면 됩니다';
  } else if (reps <= 6) {
    seconds = 75;
    reason = '고중량 복합 동작입니다';
  } else if (reps <= 12) {
    seconds = 70;
    reason = '복합 동작 중간 반복 구간입니다';
  } else {
    seconds = 60;
    reason = '복합 동작 고반복 구간입니다';
  }

  // 실패 근처까지 가는 세트는 회복이 더 필요하다.
  if (targetRir <= 1) {
    seconds += 10;
    reason += ' · 실패에 가까운 세트라 조금 더 둡니다';
  }

  // 허리에 크게 실리는 종목은 체간 회복이 늦다.
  if ((exercise.jointStress.lowBack ?? 0) >= 0.8) {
    seconds += 10;
    reason += ' · 허리 부담이 커서 조금 더 둡니다';
  }

  /*
   * 띠 밖으로 나가지 않게 한다. 조건이 겹쳐도 1분 30초를 넘기지 않는다 —
   * 넘기기 시작하면 결국 옛날처럼 3분이 되고, 그러면 아무도 안 지킨다.
   */
  seconds = Math.min(REST_MAX_SECONDS, Math.max(REST_MIN_SECONDS, seconds));

  /*
   * 마지막 세트는 다음 종목으로 옮겨가는 시간이 곧 휴식이다. 다만 45초
   * 아래로는 내리지 않는다 — 기구를 옮기는 데만도 그 정도는 걸린다.
   */
  if (input.isLastSet) seconds = Math.max(45, Math.round(seconds * 0.7));

  return {
    seconds,
    range: { min: Math.round(seconds * 0.8), max: Math.round(seconds * 1.3) },
    reason,
  };
}

/** 타이머 표시용 mm:ss. */
export function formatDuration(seconds: number): string {
  const safe = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(safe / 60);
  const rest = safe % 60;
  return `${minutes}:${String(rest).padStart(2, '0')}`;
}
