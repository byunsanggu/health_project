import { EXERCISES } from './exercises.ts';
import { MUSCLE_GROUPS } from './muscles.ts';
import type { Equipment, Exercise, Joint, PainReport } from './types.ts';

export type PainAction =
  /** 그대로 수행 */
  | 'allow'
  /** 수행하되 중량을 낮춘다 */
  | 'reduceLoad'
  /** 대체 운동으로 바꾼다 */
  | 'substitute'
  /** 오늘은 이 관절을 쓰는 동작을 넣지 않는다 */
  | 'stop';

export const JOINT_LABELS_KO: Record<Joint, string> = {
  neck: '목',
  shoulder: '어깨',
  elbow: '팔꿈치',
  wrist: '손목',
  lowBack: '허리',
  hip: '고관절',
  knee: '무릎',
  ankle: '발목',
};

export interface PainRuling {
  exerciseId: string;
  action: PainAction;
  /** 판정을 유발한 관절 */
  joint?: Joint;
  painScore?: number;
  /** 중량 배율. reduceLoad면 0.9, 그 외에는 1 */
  loadMultiplier: number;
  message: string;
  /** action이 substitute/stop일 때 제안할 대체 종목 */
  substitutes: Exercise[];
}

export interface PainScreenOptions {
  pool?: readonly Exercise[];
  availableEquipment?: readonly Equipment[];
  substituteLimit?: number;
}

/**
 * 통증 게이트.
 *
 * 현장에서 트레이너가 매 세션 하는 판단 — "오늘 어깨 아프다니 이건 빼고 저걸로" —
 * 을 규칙으로 옮긴 것이다. 앱이 통증을 무시하고 루틴을 띄우는 게
 * 사용자가 앱을 끊는 가장 흔한 이유다.
 *
 * 임계값:
 *   7점 이상 → 해당 관절에 부하가 실리는 동작은 중단하고 전문의 상담을 권한다
 *   3~6점    → 스트레스 0.6 이상 종목은 대체, 0.3~0.6은 감량 수행
 *   1~2점    → 고부하 종목만 감량
 */
export function screenExercise(
  exercise: Exercise,
  pain: readonly PainReport[],
  options: PainScreenOptions = {},
): PainRuling {
  const base = { exerciseId: exercise.id, loadMultiplier: 1, substitutes: [] as Exercise[] };

  // 가장 심한 판정을 유발하는 관절을 찾는다.
  let worst: { report: PainReport; stress: number; action: PainAction } | null = null;

  for (const report of pain) {
    if (report.score <= 0) continue;
    const stress = exercise.jointStress[report.joint] ?? 0;
    if (stress <= 0) continue;

    const action = rule(report.score, stress);
    if (action === 'allow') continue;
    if (!worst || severity(action) > severity(worst.action)) {
      worst = { report, stress, action };
    }
  }

  if (!worst) {
    return { ...base, action: 'allow', message: '통증 관련 제한 없음' };
  }

  const jointLabel = JOINT_LABELS_KO[worst.report.joint];

  if (worst.action === 'reduceLoad') {
    return {
      ...base,
      action: 'reduceLoad',
      joint: worst.report.joint,
      painScore: worst.report.score,
      loadMultiplier: 0.9,
      message: `${jointLabel} 통증 ${worst.report.score}점. 중량을 10% 낮추고 통증이 나타나지 않는 가동 범위에서만 수행하세요.`,
    };
  }

  const substitutes = findSubstitutes(exercise, pain, options);

  if (worst.action === 'stop') {
    return {
      ...base,
      action: 'stop',
      joint: worst.report.joint,
      painScore: worst.report.score,
      substitutes,
      message: `${jointLabel} 통증 ${worst.report.score}점으로 높습니다. 오늘은 ${jointLabel}에 부하가 실리는 동작을 넣지 않습니다. 통증이 지속되면 전문의 진료를 받으세요.`,
    };
  }

  return {
    ...base,
    action: 'substitute',
    joint: worst.report.joint,
    painScore: worst.report.score,
    substitutes,
    message:
      substitutes.length > 0
        ? `${jointLabel} 통증 ${worst.report.score}점. ${exercise.name} 대신 ${substitutes[0]!.name}을(를) 권합니다.`
        : `${jointLabel} 통증 ${worst.report.score}점. 이 종목은 부담이 큽니다. 해당 부위는 오늘 건너뛰세요.`,
  };
}

function rule(painScore: number, stress: number): PainAction {
  if (painScore >= 7) return stress > 0.3 ? 'stop' : 'allow';
  if (painScore >= 3) {
    if (stress >= 0.6) return 'substitute';
    if (stress >= 0.3) return 'reduceLoad';
    return 'allow';
  }
  // 1~2점
  return stress >= 0.6 ? 'reduceLoad' : 'allow';
}

function severity(action: PainAction): number {
  switch (action) {
    case 'allow': return 0;
    case 'reduceLoad': return 1;
    case 'substitute': return 2;
    case 'stop': return 3;
  }
}

/**
 * 대체 운동 탐색.
 *
 * "같은 근육을 때리면서 아픈 관절은 덜 쓰는 것"을 고른다.
 * 자극 유사도(코사인)에서 통증 관절 부하를 뺀 점수로 정렬한다.
 */
/** 대체로 인정할 최소 점수. 자극 유사도에서 통증 부하를 뺀 값. */
const SUBSTITUTE_MIN_SCORE = 0.5;

export function findSubstitutes(
  exercise: Exercise,
  pain: readonly PainReport[],
  options: PainScreenOptions = {},
): Exercise[] {
  const pool = options.pool ?? EXERCISES;
  const limit = options.substituteLimit ?? 3;

  const candidates = pool
    .filter((candidate) => candidate.id !== exercise.id)
    .filter((candidate) =>
      !options.availableEquipment || options.availableEquipment.includes(candidate.equipment),
    )
    // 같은 판정에 걸리는 종목은 후보에서 제외한다.
    .filter((candidate) => {
      for (const report of pain) {
        if (report.score <= 0) continue;
        const stress = candidate.jointStress[report.joint] ?? 0;
        if (rule(report.score, stress) === 'substitute' || rule(report.score, stress) === 'stop') {
          return false;
        }
      }
      return true;
    });

  return candidates
    .map((candidate) => ({
      candidate,
      score: similarity(exercise, candidate) - painPenalty(candidate, pain),
    }))
    // 자극이 충분히 겹치지 않으면 대체가 아니다. 애매한 후보를 내놓느니 없다고 하는 편이 낫다.
    .filter((entry) => entry.score >= SUBSTITUTE_MIN_SCORE)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((entry) => entry.candidate);
}

/** 두 종목의 근육 기여도 벡터 코사인 유사도. */
export function similarity(a: Exercise, b: Exercise): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (const muscle of MUSCLE_GROUPS) {
    const left = a.contribution[muscle] ?? 0;
    const right = b.contribution[muscle] ?? 0;
    dot += left * right;
    normA += left * left;
    normB += right * right;
  }

  if (normA === 0 || normB === 0) return 0;
  return dot / Math.sqrt(normA * normB);
}

function painPenalty(exercise: Exercise, pain: readonly PainReport[]): number {
  let penalty = 0;
  for (const report of pain) {
    if (report.score <= 0) continue;
    const stress = exercise.jointStress[report.joint] ?? 0;
    penalty += stress * (report.score / 10);
  }
  return penalty;
}

export interface SessionScreen {
  rulings: PainRuling[];
  /** 그대로 수행할 종목 */
  keep: PainRuling[];
  /** 대체가 필요한 종목 */
  swap: PainRuling[];
  /** 오늘 제외할 종목 */
  drop: PainRuling[];
  /** 의료 상담 권고가 필요한가 (7점 이상 통증) */
  medicalAdvisory: boolean;
}

/** 세션 전체를 한 번에 통과시킨다. */
export function screenSession(
  exercises: readonly Exercise[],
  pain: readonly PainReport[],
  options: PainScreenOptions = {},
): SessionScreen {
  const rulings = exercises.map((exercise) => screenExercise(exercise, pain, options));

  return {
    rulings,
    keep: rulings.filter((r) => r.action === 'allow' || r.action === 'reduceLoad'),
    swap: rulings.filter((r) => r.action === 'substitute'),
    drop: rulings.filter((r) => r.action === 'stop'),
    medicalAdvisory: pain.some((report) => report.score >= 7),
  };
}
