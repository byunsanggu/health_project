import type { LoadRule } from './load.ts';
import type { SetLog, VolumeZone } from './types.ts';

/**
 * 세트 수를 그때그때 정한다.
 *
 * 계획서에 "4세트"라고 적혀 있어도 그날 컨디션에 따라 3세트가 맞을 수도,
 * 5세트가 맞을 수도 있다. 기준은 감이 아니라 수행이다 — 반복이 무너지기
 * 시작하면 그 뒤 세트는 자극이 아니라 피로만 쌓는다.
 *
 * 반대로 계획보다 잘 나오면 한 세트 더 권한다. "알아서" 라는 말의 절반은
 * 줄이는 것이고 나머지 절반은 늘리는 것이다.
 */
export type SetVerdict = 'continue' | 'lastSet' | 'stop';

export interface SetDecision {
  verdict: SetVerdict;
  setsCompleted: number;
  /** 앞으로 더 할 세트 수 */
  remaining: number;
  reason: string;
}

export interface SetDecisionInput {
  /** 오늘 이 종목에서 완료한 본세트 (수행 순서대로) */
  completed: readonly SetLog[];
  /** 계획된 세트 수 */
  plannedSets: number;
  rule: LoadRule;
  /** 컨디션이 나빠도 이만큼은 채운다 */
  minSets?: number;
  /** 계획보다 더 할 수 있는 상한 */
  maxExtraSets?: number;
  /** 그 부위의 주간 볼륨 구간 */
  zone?: VolumeZone;
  /** 남은 훈련 시간 (초) */
  timeRemainingSeconds?: number;
  /** 세트 하나에 드는 시간 (휴식 포함, 초) */
  secondsPerSet?: number;
}

/** 반복이 첫 세트 대비 이만큼 떨어지면 그 뒤는 유효 볼륨이 아니다. */
const REP_DROP_LIMIT = 0.3;

export function decideNextSet(input: SetDecisionInput): SetDecision {
  const completed = input.completed.filter((set) => !set.warmup);
  const done = completed.length;
  const minSets = input.minSets ?? Math.min(2, input.plannedSets);
  const maxSets = input.plannedSets + (input.maxExtraSets ?? 2);
  const offset = input.rule.rirOffset ?? 0;

  const decide = (verdict: SetVerdict, reason: string): SetDecision => ({
    verdict,
    setsCompleted: done,
    remaining: verdict === 'stop' ? 0 : verdict === 'lastSet' ? 1 : Math.max(0, input.plannedSets - done),
    reason,
  });

  if (done === 0) return decide('continue', `계획은 ${input.plannedSets}세트입니다. 수행을 보고 조정합니다.`);

  const first = completed[0]!;
  const last = completed[done - 1]!;
  const lastRir = clamp(last.rir + offset, 0, 5);

  // 1) 시간이 모자라면 더 볼 것도 없다.
  if (input.timeRemainingSeconds !== undefined && input.secondsPerSet !== undefined) {
    if (input.timeRemainingSeconds < input.secondsPerSet && done >= minSets) {
      return decide('stop', '남은 시간이 한 세트에 못 미칩니다. 여기서 마칩니다.');
    }
    if (input.timeRemainingSeconds < input.secondsPerSet * 2 && done >= minSets) {
      return decide('lastSet', '시간이 얼마 남지 않았습니다. 이번이 마지막 세트입니다.');
    }
  }

  // 2) 반복이 무너지기 시작했다 — 여기서 더 하면 피로만 쌓인다.
  const dropRatio = (first.reps - last.reps) / Math.max(1, first.reps);
  if (done >= minSets && dropRatio >= REP_DROP_LIMIT) {
    return decide(
      'stop',
      `첫 세트 ${first.reps}회에서 ${last.reps}회로 떨어졌습니다. ` +
        '이 뒤의 세트는 자극이 아니라 피로만 쌓습니다.',
    );
  }

  // 3) 목표 하단도 못 채우면서 실패까지 갔다.
  if (done >= minSets && lastRir <= 0 && last.reps < input.rule.repRange.min) {
    return decide('stop', `실패 지점에서 ${last.reps}회로 목표 하단(${input.rule.repRange.min}회)에 못 미쳤습니다.`);
  }

  // 4) 이미 회복 범위를 넘긴 부위라면 최소만 채운다.
  if (input.zone === 'overMrv' && done >= minSets) {
    return decide('stop', '이 부위는 이미 회복 가능 범위를 넘었습니다. 오늘은 여기까지가 이득입니다.');
  }

  // 5) 계획을 채웠다 — 잘 나왔으면 한 세트 더.
  if (done >= input.plannedSets) {
    const spare = lastRir - input.rule.targetRir;
    if (done < maxSets && spare >= 2 && dropRatio <= 0.1 && input.zone !== 'mavToMrv') {
      return decide(
        'continue',
        `계획한 ${input.plannedSets}세트를 마쳤는데 마지막 세트가 RIR ${round1(lastRir)}로 여유가 있었습니다. ` +
          '한 세트 더 할 수 있습니다.',
      );
    }
    return decide('stop', `계획한 ${input.plannedSets}세트를 마쳤습니다.`);
  }

  // 6) 마지막 계획 세트를 앞두고 있다.
  if (done === input.plannedSets - 1) {
    return decide('lastSet', '계획상 마지막 세트입니다.');
  }

  return decide('continue', `${done}/${input.plannedSets}세트 · 수행이 유지되고 있습니다.`);
}

/** 세트 하나에 드는 대략적인 시간. 시간 예산 계산과 같은 모델을 쓴다. */
export function secondsForSet(reps: number, restSeconds: number, secondsPerRep = 3, setupSeconds = 20): number {
  return Math.round(reps * secondsPerRep + setupSeconds + restSeconds);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
