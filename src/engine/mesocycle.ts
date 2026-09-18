import { MUSCLE_GROUPS, MUSCLE_LABELS_KO, ZONE_LABELS_KO, zoneOf } from './muscles.ts';
import { assessFatigue, type FatigueAssessment } from './readiness.ts';
import { actionableFrequency, frequencyReport, type MuscleFrequency } from './frequency.ts';
import { addDays, aggregateVolume, sessionsInWeek, weekStart } from './volume.ts';
import type {
  CheckIn,
  Exercise,
  LandmarksByMuscle,
  MuscleGroup,
  SessionLog,
  VolumeZone,
} from './types.ts';

export type Phase = 'accumulation' | 'deload';

/**
 * 그 부위에 내린 처방의 성격.
 * 측정된 볼륨은 소수인데 처방은 정수라 델타만 보면 반올림 노이즈와 구분이 안 된다.
 * UI와 테스트는 이 값을 본다.
 */
export type VolumeAction = 'increase' | 'hold' | 'reduce' | 'split' | 'skip' | 'deload';

export interface MuscleVolumePlan {
  muscle: MuscleGroup;
  label: string;
  currentSets: number;
  prescribedSets: number;
  deltaSets: number;
  zone: VolumeZone;
  zoneLabel: string;
  action: VolumeAction;
  rationale: string;
}

export interface WeeklyPlan {
  /** 처방이 적용될 주의 시작일(월요일) */
  weekStart: string;
  phase: Phase;
  /** 축적 블록 내 몇 주차인지. 디로드 주는 0. */
  weekInBlock: number;
  /** 그 주의 기본 목표 RIR */
  targetRir: number;
  /** 디로드 주의 중량 배율 (축적기에는 1) */
  intensityMultiplier: number;
  fatigue: FatigueAssessment;
  volume: MuscleVolumePlan[];
  /** 최근 4주간 전혀 훈련하지 않은 부위. 프로그램 구멍을 한 번만 알려주기 위한 것. */
  neglected: MuscleGroup[];
  /** 분배를 손봐야 하는 부위 — 볼륨을 더 넣기 전에 먼저 해결할 것. */
  frequency: MuscleFrequency[];
  summary: string;
}

export interface PlanInput {
  sessions: readonly SessionLog[];
  checkIns?: readonly CheckIn[];
  index: ReadonlyMap<string, Exercise>;
  landmarks: LandmarksByMuscle;
  /** 방금 끝낸 주의 아무 날짜 */
  asOf: string;
  /** 디로드 없이 지나온 주차 수 (방금 끝낸 주 포함) */
  weekInBlock: number;
  accumulationWeeks?: number;
  /** 이번 주 통증이 보고된 부위 — 볼륨을 올리지 않는다. */
  painfulMuscles?: readonly MuscleGroup[];
  /** 방금 끝낸 주가 디로드였는지. 디로드 다음 주는 무조건 훈련으로 복귀한다. */
  lastWeekPhase?: Phase;
  /** RIR 신고 보정값. 볼륨 집계와 빈도 판정에 함께 적용한다 */
  rirOffset?: number;
}

/**
 * 축적 주차별 목표 RIR.
 * 블록 초반은 여유 있게 시작해 후반으로 갈수록 실패에 가까워진다.
 * 1주차부터 RIR 0으로 밀면 4주차에 남는 카드가 없다.
 */
function targetRirFor(weekInBlock: number): number {
  if (weekInBlock <= 1) return 3;
  if (weekInBlock <= 3) return 2;
  return 1;
}

/**
 * 다음 주 처방을 만든다. 이 함수가 엔진의 중심이다.
 *
 * 디로드 주에는 볼륨을 절반으로 줄이되 중량은 크게 낮추지 않는다(90%).
 * 볼륨이 피로의 주된 원인이고, 강도를 유지해야 복귀 시 수행력이 살아 있다.
 */
export function planNextWeek(input: PlanInput): WeeklyPlan {
  const fatigue = assessFatigue({
    sessions: input.sessions,
    checkIns: input.checkIns,
    index: input.index,
    landmarks: input.landmarks,
    asOf: input.asOf,
    weekInBlock: input.weekInBlock,
    accumulationWeeks: input.accumulationWeeks,
    lastWeekPhase: input.lastWeekPhase,
  });

  // 디로드를 연달아 두 번 하지 않는다. 쉬는 목적은 훈련으로 돌아가는 것이고,
  // 한 주 쉰 뒤에도 신호가 남아 있다면 그건 볼륨이 아니라 다른 문제다.
  const justDeloaded = input.lastWeekPhase === 'deload';
  const phase: Phase = fatigue.deloadRecommended && !justDeloaded ? 'deload' : 'accumulation';
  const nextWeekInBlock = phase === 'deload' ? 0 : input.weekInBlock + 1;

  const lastWeekSessions = sessionsInWeek(input.sessions, input.asOf);
  const volumeOptions = { rirOffset: input.rirOffset ?? 0 };
  const current = aggregateVolume(lastWeekSessions, input.index, volumeOptions);
  const trailing = aggregateVolume(trailingSessions(input.sessions, input.asOf), input.index, volumeOptions);
  const painful = new Set(input.painfulMuscles ?? []);
  const neglected: MuscleGroup[] = [];

  // 볼륨을 올리기 전에 분배부터 본다. 한 세션에 몰린 부위에 세트를 더 넣으면
  // 버려지는 세트만 늘어난다 — 먼저 나누고, 그다음에 늘린다.
  const frequency = frequencyReport(lastWeekSessions, input.index, volumeOptions);
  const concentrated = new Set(
    frequency.filter((item) => item.verdict === 'concentrated').map((item) => item.muscle),
  );

  const volume: MuscleVolumePlan[] = MUSCLE_GROUPS.map((muscle) => {
    const currentSets = current[muscle].effectiveSets;
    const landmark = input.landmarks[muscle];
    const zone = zoneOf(currentSets, landmark);

    // 최근 4주간 한 세트도 안 한 부위에 매주 볼륨을 처방하면 소음만 늘어난다.
    // 프로그램에 없는 부위인지, 빠뜨린 부위인지는 사용자가 판단할 문제다.
    const untrained = trailing[muscle].effectiveSets === 0;
    if (untrained) neglected.push(muscle);

    const { sets, rationale, action } = untrained
      ? { sets: 0, action: 'skip' as VolumeAction, rationale: '최근 4주간 훈련 기록이 없습니다. 프로그램에 넣을지 결정하세요' }
      : phase === 'deload'
        ? deloadVolume(currentSets, landmark.mev)
        : accumulationVolume({
            currentSets,
            zone,
            landmark,
            fatigueScore: fatigue.score,
            painful: painful.has(muscle),
            concentrated: concentrated.has(muscle),
            recommendedSessions: frequency.find((item) => item.muscle === muscle)?.recommendedSessions ?? 2,
          });

    return {
      muscle,
      label: MUSCLE_LABELS_KO[muscle],
      currentSets,
      prescribedSets: sets,
      deltaSets: round1(sets - currentSets),
      zone,
      zoneLabel: ZONE_LABELS_KO[zone],
      action,
      rationale,
    };
  });

  return {
    weekStart: nextWeekStart(input.asOf),
    phase,
    weekInBlock: nextWeekInBlock,
    targetRir: phase === 'deload' ? 4 : targetRirFor(nextWeekInBlock),
    intensityMultiplier: phase === 'deload' ? 0.9 : 1,
    fatigue,
    volume,
    neglected,
    frequency: actionableFrequency(frequency),
    summary: summarize(phase, nextWeekInBlock, fatigue, volume, actionableFrequency(frequency)),
  };
}

interface VolumeDecision {
  sets: number;
  action: VolumeAction;
  rationale: string;
}

function deloadVolume(currentSets: number, mev: number): VolumeDecision {
  // 절반으로 줄이되 MEV의 절반 아래로는 내리지 않는다 — 완전히 쉬면 복귀가 더 느리다.
  const halved = Math.round(currentSets / 2);
  const floor = Math.max(2, Math.round(mev / 2));
  const sets = Math.max(floor, halved);
  return { sets, action: 'deload', rationale: `디로드: ${currentSets}세트 → ${sets}세트 (중량은 90% 유지)` };
}

function accumulationVolume(args: {
  currentSets: number;
  zone: VolumeZone;
  landmark: { mev: number; mav: number; mrv: number };
  fatigueScore: number;
  painful: boolean;
  concentrated: boolean;
  recommendedSessions: number;
}): VolumeDecision {
  const { currentSets, zone, landmark, fatigueScore, painful, concentrated } = args;

  // MEV 미만이면 늘리는 게 먼저고, MRV 초과면 줄이는 게 먼저다.
  // 분배 조정은 그 사이 구간에서만 우선순위를 갖는다.
  if (concentrated && zone !== 'underMev' && zone !== 'overMrv') {
    return {
      sets: Math.round(currentSets),
      action: 'split',
      rationale: `볼륨이 한 세션에 몰려 있습니다. 세트를 늘리기 전에 주 ${args.recommendedSessions}회로 나누세요`,
    };
  }

  if (painful) {
    return {
      sets: Math.round(currentSets),
      action: 'hold',
      rationale: '통증이 보고된 부위입니다. 볼륨을 올리지 않고 유지합니다',
    };
  }

  // 피로 점수가 임계 아래여도 신호가 쌓이면 증가 폭을 줄인다.
  const step = fatigueScore >= 3 ? 1 : 2;

  switch (zone) {
    case 'underMev':
      return {
        sets: landmark.mev,
        action: 'increase',
        rationale: `MEV(${landmark.mev}세트) 미만입니다. 자극 최소선까지 올립니다`,
      };
    case 'mevToMav':
      return {
        sets: Math.min(landmark.mav, Math.round(currentSets) + step),
        action: 'increase',
        rationale: `적정 구간입니다. ${step}세트 추가해 MAV(${landmark.mav}세트)로 접근합니다`,
      };
    case 'mavToMrv':
      return fatigueScore >= 3
        ? {
            sets: Math.round(currentSets),
            action: 'hold',
            rationale: '고강도 구간이고 피로 신호가 있어 이번 주는 유지합니다',
          }
        : {
            sets: Math.min(landmark.mrv, Math.round(currentSets) + 1),
            action: 'increase',
            rationale: `고강도 구간입니다. 1세트만 추가합니다 (MRV ${landmark.mrv}세트)`,
          };
    case 'overMrv':
      return {
        sets: landmark.mrv,
        action: 'reduce',
        rationale: `MRV를 넘겼습니다. ${landmark.mrv}세트로 되돌립니다`,
      };
  }
}

function summarize(
  phase: Phase,
  weekInBlock: number,
  fatigue: FatigueAssessment,
  volume: readonly MuscleVolumePlan[],
  frequency: readonly MuscleFrequency[],
): string {
  if (phase === 'deload') {
    const top = fatigue.signals
      .slice()
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 2)
      .map((signal) => signal.label);
    return `디로드 주간입니다. 볼륨을 절반으로 줄이고 중량은 90%로 유지합니다. 근거: ${top.join(' / ')}`;
  }

  const increased = volume.filter((item) => item.action === 'increase');
  const reduced = volume.filter((item) => item.action === 'reduce');
  const parts = [`축적 ${weekInBlock}주차`];

  if (increased.length > 0) {
    parts.push(
      `볼륨 증가: ${increased
        .slice(0, 4)
        .map((item) => `${item.label} +${item.deltaSets}`)
        .join(', ')}`,
    );
  }
  if (reduced.length > 0) {
    parts.push(`조정: ${reduced.map((item) => `${item.label} ${item.deltaSets}`).join(', ')}`);
  }
  if (increased.length === 0 && reduced.length === 0) {
    parts.push('볼륨 유지');
  }
  if (frequency.length > 0) {
    parts.push(
      `분배 조정: ${frequency
        .slice(0, 3)
        .map((item) => `${item.label} 주 ${item.recommendedSessions}회`)
        .join(', ')}`,
    );
  }
  return parts.join(' · ');
}

/** 최근 4주(이번 주 포함)의 세션. 프로그램 커버리지 판단용. */
function trailingSessions(sessions: readonly SessionLog[], asOf: string): SessionLog[] {
  const start = addDays(weekStart(asOf), -21);
  const end = addDays(weekStart(asOf), 6);
  return sessions.filter((session) => session.date >= start && session.date <= end);
}

function nextWeekStart(asOf: string): string {
  const start = new Date(`${weekStart(asOf)}T00:00:00Z`);
  start.setUTCDate(start.getUTCDate() + 7);
  return start.toISOString().slice(0, 10);
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
