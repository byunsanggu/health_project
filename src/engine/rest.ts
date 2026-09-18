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
 */
export function restFor(input: RestInput): RestPrescription {
  const { exercise, reps, targetRir } = input;
  const isIsolation = exercise.pattern === 'isolation' || exercise.pattern === 'core';

  let seconds: number;
  let reason: string;

  if (isIsolation) {
    seconds = reps >= 15 ? 60 : 75;
    reason = '고립 운동은 국소 피로만 회복하면 됩니다';
  } else if (reps <= 6) {
    seconds = 180;
    reason = '고중량 복합 동작입니다. 충분히 쉬어야 다음 세트가 나옵니다';
  } else if (reps <= 12) {
    seconds = 150;
    reason = '복합 동작 중간 반복 구간입니다';
  } else {
    seconds = 120;
    reason = '복합 동작 고반복 구간입니다';
  }

  // 실패 근처까지 가는 세트는 회복이 더 필요하다.
  if (targetRir <= 1) {
    seconds += 30;
    reason += ' · 실패에 가까운 세트라 30초 더 둡니다';
  }

  // 허리에 크게 실리는 종목은 체간 회복이 늦다.
  if ((exercise.jointStress.lowBack ?? 0) >= 0.8) {
    seconds += 30;
    reason += ' · 허리 부담이 커서 30초 더 둡니다';
  }

  if (input.isLastSet) seconds = Math.round(seconds * 0.7);

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
