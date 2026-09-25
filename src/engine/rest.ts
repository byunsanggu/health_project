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
  /** 사용자가 정한 휴식 띠. 없으면 기본 띠(1분~1분 30초). */
  band?: RestBand;
  /** 이 종목만 직접 정한 값. 있으면 계산하지 않고 그대로 쓴다. */
  overrideSeconds?: number;
}

/**
 * 휴식 띠 — 사용자가 정하는 것.
 *
 * 숫자 하나를 받지 않고 띠를 받는 이유가 있다. "휴식 90초"로 고정하면
 * 데드리프트도 90초, 레그 익스텐션도 90초가 된다. 그건 휴식을 관리하는
 * 게 아니라 안 하는 것이다. 띠를 주면 어느 종목을 띠의 어디에 둘지는
 * 계산이 맡고, 전체를 길게 갈지 짧게 갈지는 사용자가 정한다.
 */
export interface RestBand {
  minSeconds: number;
  maxSeconds: number;
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

export const DEFAULT_BAND: RestBand = {
  minSeconds: REST_MIN_SECONDS,
  maxSeconds: REST_MAX_SECONDS,
};

/** 띠를 고를 때 쓰는 기본값들. 직접 치는 것도 막지 않는다. */
export const REST_PRESETS: readonly {
  id: string;
  label: string;
  band: RestBand;
  note: string;
}[] = [
  {
    id: 'dense',
    label: '짧게',
    band: { minSeconds: 45, maxSeconds: 75 },
    note: '시간이 없는 날 · 대사 스트레스를 노릴 때',
  },
  {
    id: 'normal',
    label: '보통',
    band: DEFAULT_BAND,
    note: '근비대 기본 · 1분~1분 30초',
  },
  {
    id: 'long',
    label: '길게',
    band: { minSeconds: 90, maxSeconds: 150 },
    note: '무겁게 갈 때 · 뒤 세트 반복을 지키고 싶을 때',
  },
  {
    id: 'strength',
    label: '근력',
    band: { minSeconds: 150, maxSeconds: 240 },
    note: '5회 이하 고중량 · 신경 회복까지 기다립니다',
  },
];

/** 사람이 친 값은 뒤집혀 있거나 말이 안 될 수 있다. 쓸 수 있는 값으로 만든다. */
export function normalizeBand(band: Partial<RestBand> | null | undefined): RestBand {
  const min = Math.round(band?.minSeconds ?? DEFAULT_BAND.minSeconds);
  const max = Math.round(band?.maxSeconds ?? DEFAULT_BAND.maxSeconds);
  const low = clamp(Math.min(min, max), 20, 600);
  const high = clamp(Math.max(min, max), low, 600);
  return { minSeconds: low, maxSeconds: high };
}

export function describeBand(band: RestBand): string {
  const safe = normalizeBand(band);
  return `${formatDuration(safe.minSeconds)}~${formatDuration(safe.maxSeconds)}`;
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

/** 타이머에 5초 단위로 올린다. 87초 같은 숫자는 아무도 지키지 않는다. */
function toStep(seconds: number): number {
  return Math.round(seconds / 5) * 5;
}

/*
 * 띠 안에서 어디에 둘 것인가.
 *
 * 절대 초를 계산하고 띠로 자르면 안 된다 — 띠를 2분 30초~4분으로 넓히는
 * 순간 모든 종목이 2분 30초로 붙어버리고, 그러면 고립이든 데드리프트든
 * 같은 휴식이 된다. 그래서 "얼마나 필요한가"를 0~6칸으로 먼저 정하고
 * 그 비율을 띠에 옮긴다. 띠를 넓히면 간격도 같이 벌어진다.
 */
const STEPS = 6;

export function restFor(input: RestInput): RestPrescription {
  const { exercise, reps, targetRir } = input;
  const band = normalizeBand(input.band);

  // 이 종목만 직접 정했으면 계산하지 않는다. 정한 사람이 더 잘 안다.
  if (input.overrideSeconds != null && Number.isFinite(input.overrideSeconds)) {
    const fixed = clamp(Math.round(input.overrideSeconds), 10, 900);
    return {
      seconds: fixed,
      range: { min: Math.round(fixed * 0.8), max: Math.round(fixed * 1.3) },
      reason: '이 종목은 직접 정한 휴식을 씁니다',
    };
  }

  const isIsolation = exercise.pattern === 'isolation' || exercise.pattern === 'core';

  let need: number;
  let reason: string;

  if (isIsolation) {
    need = 0;
    reason = '고립 운동은 국소 피로만 회복하면 됩니다';
  } else if (reps <= 6) {
    need = 3;
    reason = '고중량 복합 동작입니다';
  } else if (reps <= 12) {
    need = 2;
    reason = '복합 동작 중간 반복 구간입니다';
  } else {
    need = 1;
    reason = '복합 동작 고반복 구간입니다';
  }

  // 실패 근처까지 가는 세트는 회복이 더 필요하다.
  if (targetRir <= 1) {
    need += 1;
    reason += ' · 실패에 가까운 세트라 조금 더 둡니다';
  }

  // 허리에 크게 실리는 종목은 체간 회복이 늦다.
  if ((exercise.jointStress.lowBack ?? 0) >= 0.8) {
    need += 1;
    reason += ' · 허리 부담이 커서 조금 더 둡니다';
  }

  need = clamp(need, 0, STEPS);
  const span = band.maxSeconds - band.minSeconds;
  let seconds = clamp(toStep(band.minSeconds + (span * need) / STEPS), band.minSeconds, band.maxSeconds);

  /*
   * 마지막 세트는 다음 종목으로 옮겨가는 시간이 곧 휴식이다. 다만 45초
   * 아래로는 내리지 않는다 — 기구를 옮기는 데만도 그 정도는 걸린다.
   * 띠를 그보다 짧게 잡은 사람의 뜻은 거스르지 않는다.
   */
  if (input.isLastSet) {
    seconds = Math.max(Math.min(45, band.minSeconds), toStep(seconds * 0.7));
  }

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
