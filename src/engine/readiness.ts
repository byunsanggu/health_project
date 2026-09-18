import { estimate1RM } from './load.ts';
import { aggregateVolume, addDays, sessionsInWeek, weekStart } from './volume.ts';
import { MUSCLE_GROUPS, MUSCLE_LABELS_KO } from './muscles.ts';
import type {
  CheckIn,
  Exercise,
  LandmarksByMuscle,
  SessionLog,
} from './types.ts';

export interface FatigueSignal {
  id: string;
  /** 사용자에게 보여줄 한 줄. "왜 디로드를 권하는지"를 그대로 설명한다. */
  label: string;
  /** 판정 점수 기여분 */
  weight: number;
}

export interface FatigueAssessment {
  score: number;
  /** 점수가 이 값 이상이면 디로드를 권한다. */
  threshold: number;
  deloadRecommended: boolean;
  signals: FatigueSignal[];
}

export interface FatigueInput {
  sessions: readonly SessionLog[];
  checkIns?: readonly CheckIn[];
  index: ReadonlyMap<string, Exercise>;
  landmarks: LandmarksByMuscle;
  /** 판정 기준일 (보통 이번 주 마지막 훈련일) */
  asOf: string;
  /** 디로드 없이 지나온 축적 주차 수 (이번 주 포함) */
  weekInBlock: number;
  /** 계획된 축적 길이. 기본 5주. */
  accumulationWeeks?: number;
  /**
   * 방금 끝낸 주의 성격.
   * 디로드 주였다면 수행력·RIR 비교를 건너뛴다 — 볼륨을 절반으로 줄인 주의
   * 기록이 지난주보다 낮은 건 당연하고, 이걸 피로 신호로 읽으면
   * 디로드가 디로드를 부르는 무한 루프에 빠진다.
   */
  lastWeekPhase?: 'accumulation' | 'deload';
}

const DELOAD_THRESHOLD = 5;

/**
 * 디로드 판정.
 *
 * 한 가지 신호로 결정하지 않는다. 컨디션 나쁜 하루, 잠 못 잔 하루로
 * 블록을 끊으면 진도가 안 나가고, 반대로 신호를 다 무시하면 6주차에 부상이 온다.
 * 그래서 신호마다 가중치를 주고 합산한다.
 */
export function assessFatigue(input: FatigueInput): FatigueAssessment {
  const signals: FatigueSignal[] = [];
  const accumulationWeeks = input.accumulationWeeks ?? 5;
  const index = input.index;

  const thisWeek = sessionsInWeek(input.sessions, input.asOf);
  const lastWeekDate = addDays(weekStart(input.asOf), -1);
  const lastWeek = sessionsInWeek(input.sessions, lastWeekDate);

  // 방금 끝낸 주가 디로드였다면 주간 비교 신호는 의미가 없다.
  const comparable = input.lastWeekPhase !== 'deload';

  // 1) 수행력 하락 — 같은 종목의 추정 1RM이 떨어졌는가
  const dropped = comparable ? droppedLifts(thisWeek, lastWeek, 0.02) : [];
  if (dropped.length >= 2) {
    signals.push({
      id: 'performanceDrop',
      label: `${dropped.length}개 종목의 추정 1RM이 지난주보다 떨어졌습니다 (${dropped
        .slice(0, 3)
        .map((id) => index.get(id)?.name ?? id)
        .join(', ')}${dropped.length > 3 ? ' 외' : ''})`,
      weight: 3,
    });
  }

  // 2) RIR 드리프트 — 같은 일을 하는데 더 힘들어졌는가
  const thisRir = comparable ? averageRir(thisWeek) : null;
  const lastRir = comparable ? averageRir(lastWeek) : null;
  if (thisRir !== null && lastRir !== null && lastRir - thisRir >= 1) {
    signals.push({
      id: 'rirDrift',
      label: `평균 RIR이 ${lastRir.toFixed(1)} → ${thisRir.toFixed(1)}로 떨어졌습니다. 같은 중량이 더 무겁게 느껴지는 상태입니다`,
      weight: 2,
    });
  }

  // 3) MRV 초과 부위
  const volume = aggregateVolume(thisWeek, input.index);
  const over = MUSCLE_GROUPS.filter(
    (muscle) => volume[muscle].effectiveSets > input.landmarks[muscle].mrv,
  );
  if (over.length > 0) {
    // 한 부위만 넘긴 것은 그 부위 볼륨을 되돌리면 되는 문제라 가중치를 낮게 준다.
    // 세 부위 이상이 동시에 넘어갔다면 국소 과부하가 아니라 전신 회복 능력을 초과한
    // 것이므로, 다른 신호가 없어도 그 자체로 디로드 사유가 된다.
    const worstRatio = Math.max(
      ...over.map((muscle) => volume[muscle].effectiveSets / input.landmarks[muscle].mrv),
    );
    signals.push({
      id: 'volumeOverMrv',
      label: `${over.map((m) => MUSCLE_LABELS_KO[m]).join(', ')} 볼륨이 회복 가능 범위(MRV)를 넘었습니다`,
      weight:
        over.length >= 3
          ? DELOAD_THRESHOLD
          : over.length + (worstRatio >= 1.25 ? 1 : 0),
    });
  }

  // 4~6) 체크인 기반 신호
  const recent = recentCheckIns(input.checkIns ?? [], input.asOf, 7);
  const painDays = recent.filter((checkIn) =>
    (checkIn.pain ?? []).some((report) => report.score >= 3),
  );
  if (painDays.length >= 2) {
    signals.push({
      id: 'jointPain',
      label: `최근 7일 중 ${painDays.length}일에 3점 이상 관절 통증이 보고됐습니다`,
      weight: 3,
    });
  }

  const sleep = mean(recent.map((c) => c.sleepHours).filter(isNumber));
  const soreness = mean(recent.map((c) => c.soreness).filter(isNumber));
  if ((sleep !== null && sleep < 6) || (soreness !== null && soreness >= 7)) {
    signals.push({
      id: 'poorRecovery',
      label:
        sleep !== null && sleep < 6
          ? `최근 7일 평균 수면이 ${sleep.toFixed(1)}시간으로 회복에 부족합니다`
          : `근육통이 평균 ${soreness?.toFixed(1)}점으로 높게 유지되고 있습니다`,
      weight: 2,
    });
  }

  const motivation = mean(recent.map((c) => c.motivation).filter(isNumber));
  if (motivation !== null && motivation <= 3) {
    signals.push({
      id: 'lowMotivation',
      label: '운동 의욕이 지속적으로 낮습니다. 중추 피로의 흔한 신호입니다',
      weight: 1,
    });
  }

  // 7) 블록 길이 — 신호가 없어도 계획된 주차를 채우면 한 주 비운다
  if (input.weekInBlock >= accumulationWeeks) {
    signals.push({
      id: 'blockComplete',
      label: `디로드 없이 ${input.weekInBlock}주째입니다. 계획된 축적 기간(${accumulationWeeks}주)을 채웠습니다`,
      weight: 2,
    });
  }

  const score = signals.reduce((sum, signal) => sum + signal.weight, 0);

  return {
    score,
    threshold: DELOAD_THRESHOLD,
    deloadRecommended: score >= DELOAD_THRESHOLD,
    signals,
  };
}

/** 두 주를 비교해 추정 1RM이 떨어진 종목 id를 돌려준다. */
export function droppedLifts(
  thisWeek: readonly SessionLog[],
  lastWeek: readonly SessionLog[],
  tolerance = 0.02,
): string[] {
  const now = bestE1rmByExercise(thisWeek);
  const before = bestE1rmByExercise(lastWeek);
  const dropped: string[] = [];

  for (const [exerciseId, previous] of before) {
    const current = now.get(exerciseId);
    if (current === undefined) continue;
    if (current < previous * (1 - tolerance)) dropped.push(exerciseId);
  }
  return dropped;
}

export function bestE1rmByExercise(sessions: readonly SessionLog[]): Map<string, number> {
  const best = new Map<string, number>();
  for (const session of sessions) {
    for (const set of session.sets) {
      if (set.warmup || set.reps <= 0) continue;
      const value = estimate1RM(set);
      const previous = best.get(set.exerciseId);
      if (previous === undefined || value > previous) best.set(set.exerciseId, value);
    }
  }
  return best;
}

function averageRir(sessions: readonly SessionLog[]): number | null {
  const values: number[] = [];
  for (const session of sessions) {
    for (const set of session.sets) {
      if (!set.warmup && set.reps > 0) values.push(set.rir);
    }
  }
  return mean(values);
}

function recentCheckIns(
  checkIns: readonly CheckIn[],
  asOf: string,
  days: number,
): CheckIn[] {
  const from = addDays(asOf, -(days - 1));
  return checkIns.filter((checkIn) => checkIn.date >= from && checkIn.date <= asOf);
}

function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function isNumber(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}
