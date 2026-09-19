/**
 * 목표 조합.
 *
 * 현장에서 "근비대도 하고 근력도 늘리고 체지방도 빼고 싶다"는 말을 가장 많이
 * 듣는다. 앱들은 보통 하나만 고르게 하고 끝내는데, 그건 사용자가 실제로
 * 원하는 것을 못 담는다.
 *
 * 다만 셋을 동시에 최대로 밀 수는 없다는 것도 사실이다. 그래서 고르게는 하되,
 * 무엇이 무엇을 어떻게 깎는지 숨기지 않고 말한다.
 */
export type TrainingGoal = 'hypertrophy' | 'strength' | 'fatLoss' | 'general';

export const GOAL_LABELS_KO: Record<TrainingGoal, string> = {
  hypertrophy: '근비대',
  strength: '근력',
  fatLoss: '체지방 감량',
  general: '건강 유지',
};

export const GOAL_HINTS_KO: Record<TrainingGoal, string> = {
  hypertrophy: '근육 크기를 늘립니다',
  strength: '드는 무게를 늘립니다',
  fatLoss: '근육은 지키면서 체지방을 줄입니다',
  general: '무리 없이 꾸준히 합니다',
};

export interface GoalPlan {
  goals: TrainingGoal[];
  /** 반복 범위를 정하는 기준이 되는 목표 */
  primary: TrainingGoal;
  /** 칼로리 적자를 전제로 하는가 */
  cutting: boolean;
  /**
   * 볼륨을 어디까지 밀 것인가.
   * 적자에서는 회복이 느려지므로 MAV에서 멈춘다 — MRV까지 밀면 근육을 잃는다.
   */
  volumeCeiling: 'mav' | 'mrv';
  /** 사용자에게 그대로 보여줄 설명. 상충이 있으면 숨기지 않는다 */
  notes: string[];
}

/**
 * 반복 범위를 정할 때의 우선순위.
 *
 * 근력이 목표에 있으면 메인 동작은 저반복으로 가야 한다. 근비대만 있으면
 * 중반복이다. 체지방 감량은 반복 범위를 정하지 않는다 — 뒤에서 설명한다.
 */
const PRIORITY: TrainingGoal[] = ['strength', 'hypertrophy', 'fatLoss', 'general'];

export function planGoals(input: readonly TrainingGoal[]): GoalPlan {
  const goals = PRIORITY.filter((goal) => input.includes(goal));
  if (goals.length === 0) goals.push('general');

  const has = (goal: TrainingGoal) => goals.includes(goal);
  const cutting = has('fatLoss');
  const notes: string[] = [];

  /*
   * 여기서 한 가지는 분명히 해야 한다. 체지방 감량은 반복 범위로 하는 게
   * 아니다. "고반복이 커팅"은 오래된 오해이고, 적자에서 고반복으로 바꾸면
   * 강도가 떨어져 오히려 근육을 잃는다. 감량기 훈련의 목적은 근육을 지키는
   * 것이고, 그건 중량을 유지할 때 된다.
   */
  if (has('strength') && has('hypertrophy')) {
    notes.push('메인 복합 동작은 저반복(4~6회)으로 힘을, 보조·고립은 중반복으로 크기를 가져갑니다.');
  } else if (has('strength')) {
    notes.push('메인 복합 동작을 저반복(4~6회)으로 가져갑니다.');
  } else if (has('hypertrophy')) {
    notes.push('근비대 구간인 6~12회를 중심으로 짭니다.');
  }

  if (cutting) {
    notes.push(
      '체지방은 반복 범위가 아니라 식사에서 빠집니다. 훈련에서 할 일은 근육을 지키는 것이고, ' +
      '그래서 중량을 낮추지 않고 그대로 갑니다.',
    );
    notes.push('적자에서는 회복이 느려집니다. 볼륨을 MRV까지 밀지 않고 MAV에서 멈춥니다.');

    if (has('strength')) {
      notes.push('적자에서 근력이 오르기는 어렵습니다. 올리기보다 지키는 것을 목표로 잡습니다.');
    }
    if (has('hypertrophy')) {
      notes.push('적자에서 근육을 늘리기는 어렵습니다. 초보이거나 오래 쉬었던 경우가 아니면 유지가 현실적입니다.');
    }
  }

  if (goals.length === 1 && has('general')) {
    notes.push('무리 없는 범위에서 전신을 고르게 씁니다.');
  }

  return {
    goals,
    primary: goals[0]!,
    cutting,
    volumeCeiling: cutting ? 'mav' : 'mrv',
    notes,
  };
}

/** 목표 조합에 맞는 반복 범위. */
export function repRangeForGoals(
  role: 'primary' | 'accessory' | 'isolation',
  goals: readonly TrainingGoal[],
): { min: number; max: number } {
  const plan = planGoals(goals);

  if (role === 'isolation') return { min: 10, max: 15 };
  if (role === 'accessory') return { min: 8, max: 12 };
  if (plan.goals.includes('strength')) return { min: 4, max: 6 };
  return { min: 6, max: 10 };
}

/** 고른 목표를 한 줄로. */
export function describeGoals(goals: readonly TrainingGoal[]): string {
  const plan = planGoals(goals);
  return plan.goals.map((goal) => GOAL_LABELS_KO[goal]).join(' · ');
}
