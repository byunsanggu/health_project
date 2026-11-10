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
/**
 * 'conditioning' — "크로스핏처럼 하고 싶다"는 사람의 목표. 근력 운동을 짧게 하고, 날마다
 * 시간을 재는 마무리 운동을 붙인다(conditioning.ts의 weeklyConditioningPlan).
 */
export type TrainingGoal = 'hypertrophy' | 'strength' | 'fatLoss' | 'conditioning' | 'general';

/** 고를 수 있는 목표 전부 — 화면에 보여 주는 순서. */
export const TRAINING_GOALS: readonly TrainingGoal[] = ['hypertrophy', 'strength', 'fatLoss', 'conditioning', 'general'];

export const GOAL_LABELS_KO: Record<TrainingGoal, string> = {
  // '근비대'는 처음 온 사람이 모르는 말이다. 하는 일로 부른다(' · '는 목표 사이 구분이라 이름 안에 쓰지 않는다)
  hypertrophy: '근육 키우기',
  strength: '근력',
  fatLoss: '체지방 감량',
  // '컨디셔닝 · 와드'는 해 본 사람만 아는 말이다 — 무엇이 좋아지는지로 부르고, 아는 이름은 괄호에
  conditioning: '체력 기르기 (크로스핏식)',
  general: '건강 유지',
};

export const GOAL_HINTS_KO: Record<TrainingGoal, string> = {
  hypertrophy: '근육을 키워 몸매를 만듭니다',
  strength: '드는 무게를 늘립니다',
  fatLoss: '근육은 지키면서 체지방을 줄입니다',
  conditioning: '근력 운동은 짧게 하고, 날마다 시간을 재는 숨찬 운동을 붙입니다',
  general: '무리 없이 꾸준히 합니다',
};

export interface GoalPlan {
  goals: TrainingGoal[];
  /** 반복 범위를 정하는 기준이 되는 목표 */
  primary: TrainingGoal;
  /** 칼로리 적자를 전제로 하는가 */
  cutting: boolean;
  /** 날마다 숨찬 마무리 운동을 붙이는가(체력 기르기). 근력 운동은 그만큼 짧아진다 */
  conditioning: boolean;
  /**
   * 볼륨을 어디까지 밀 것인가.
   * 적자에서는 회복이 느려지므로 MAV에서 멈춘다 — MRV까지 밀면 근육을 잃는다.
   * 숨찬 운동을 날마다 붙일 때도 같다. 회복할 힘을 둘이 나눠 쓴다.
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
const PRIORITY: TrainingGoal[] = ['strength', 'hypertrophy', 'conditioning', 'fatLoss', 'general'];

export function planGoals(input: readonly TrainingGoal[]): GoalPlan {
  const goals = PRIORITY.filter((goal) => input.includes(goal));
  if (goals.length === 0) goals.push('general');

  const has = (goal: TrainingGoal) => goals.includes(goal);
  const cutting = has('fatLoss');
  const conditioning = has('conditioning');
  const notes: string[] = [];

  /*
   * 여기서 한 가지는 분명히 해야 한다. 체지방 감량은 반복 범위로 하는 게
   * 아니다. "고반복이 커팅"은 오래된 오해이고, 적자에서 고반복으로 바꾸면
   * 강도가 떨어져 오히려 근육을 잃는다. 감량기 훈련의 목적은 근육을 지키는
   * 것이고, 그건 중량을 유지할 때 된다.
   */
  if (has('strength') && has('hypertrophy')) {
    notes.push('바벨 메인 동작(스쿼트 · 벤치 · 데드 · 프레스 · 로우)은 한 주에 한 번 무겁게(4~6회), 다른 날과 나머지 종목은 6~10회 이상으로 크기를 가져갑니다.');
  } else if (has('strength')) {
    notes.push('바벨 메인 동작(스쿼트 · 벤치 · 데드 · 프레스 · 로우)은 4~6회(처음이면 5~8회)로, 덤벨 · 머신 주 종목은 6~10회로 가져갑니다.');
  } else if (has('hypertrophy')) {
    notes.push('근육이 잘 크는 6~12회 위주로 짭니다.');
  }

  if (conditioning) {
    notes.push(
      '근력 운동은 큰 운동 위주로 짧게 하고, 그 뒤에 8~15분짜리 숨찬 마무리 운동을 날마다 다르게 붙입니다. ' +
      '무게를 드는 날, 맨몸으로 하는 날, 기구로 숨차게 하는 날이 한 주에 고르게 섞입니다.',
    );
    notes.push(
      '시간에 쫓기며 하는 운동에는 배우기 쉬운 동작만 넣습니다. 바벨로 무겁게 드는 동작은 근력 운동 시간에 따로 합니다.',
    );
    if (has('hypertrophy')) {
      notes.push('숨찬 운동을 날마다 붙이면 근육 키우는 세트가 줄어듭니다. 근육이 먼저라면 마무리 운동을 주 2~3번만 하세요.');
    }
    if (has('strength')) {
      notes.push('무거운 운동을 먼저 하고 숨찬 운동은 그 뒤에 합니다. 순서가 바뀌면 드는 무게가 떨어집니다.');
    }
  }

  if (cutting) {
    notes.push(
      '체지방은 반복 범위가 아니라 식사에서 빠집니다. 훈련에서 할 일은 근육을 지키는 것이고, ' +
      '그래서 중량을 낮추지 않고 그대로 갑니다.',
    );
    notes.push('적게 먹는 동안에는 회복이 느려집니다. 세트 수를 한 주 최대까지 늘리지 않고 중간에서 멈춥니다.');

    if (!conditioning) {
      notes.push(has('strength')
        ? '운동 뒤에 가볍게 걷거나 자전거를 10~15분 붙입니다. 숨이 턱까지 차는 운동은 넣지 않습니다 — 무거운 운동에 쓸 힘을 남겨야 합니다.'
        : '운동 뒤에 대화가 되는 정도의 걷기 · 자전거를 10~20분 붙이고, 쉬는 날에는 20~30분 걷습니다. 하루 걸음 수를 늘리는 것이 가장 쉽습니다.');
    }

    if (has('strength')) {
      notes.push('적게 먹으면서 근력이 오르기는 어렵습니다. 처음 시작한 분이 아니면 올리기보다 지키는 것을 목표로 잡습니다.');
    }
    if (has('hypertrophy')) {
      notes.push('적게 먹으면서 근육을 늘리기는 어렵습니다. 처음이거나 오래 쉬었던 경우가 아니면 지키는 쪽이 현실적입니다.');
    }
  }

  if (goals.length === 1 && has('general')) {
    notes.push('무리 없는 범위에서 전신을 고르게 씁니다.');
  }

  return {
    goals,
    primary: goals[0]!,
    cutting,
    conditioning,
    volumeCeiling: cutting || conditioning ? 'mav' : 'mrv',
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
