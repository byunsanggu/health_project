import { withParticle } from './korean.ts';
import type { MuscleGroup } from './types.ts';

/**
 * 유산소.
 *
 * 근력 앱에 유산소를 붙일 때 제일 흔한 실수는 **그냥 목록에 끼워 넣는
 * 것**이다. 유산소는 세트×반복×중량이 아니라 시간×강도이고, 무엇보다
 * **근비대를 방해할 수 있다.** 그걸 말 안 하고 "러닝머신 30분"만 띄우면,
 * 다리 하고 나서 바로 뛰어서 그 다리 운동을 반쯤 버리는 사람이 나온다.
 *
 * 이 모듈이 하는 일은 셋이다.
 *
 *   1. 기구마다 다리에 얼마나 실리는지 안다 — 간섭의 크기가 거기서 갈린다.
 *   2. 오늘 근력 세션과 겹치면 얼마나 손해인지, 어떻게 줄이는지 말한다.
 *   3. 강도를 심박수가 아니라 **말할 수 있는 정도**로 준다. 대부분은
 *      심박계가 없고, 있어도 최대심박을 모른다.
 */

export type CardioMode =
  | 'treadmill-walk'
  | 'treadmill-run'
  | 'bike'
  | 'row'
  | 'elliptical'
  | 'stair'
  | 'jump-rope'
  | 'outdoor-run'
  | 'swim';

export interface CardioExercise {
  id: CardioMode;
  name: string;
  /** 다리에 실리는 정도 0~1 — 간섭의 크기가 여기서 갈린다 */
  legLoad: number;
  /** 관절 충격 */
  impact: 'low' | 'mid' | 'high';
  /** 주로 쓰는 부위 — 근력 세션과 겹치는지 보는 데 쓴다 */
  muscles: MuscleGroup[];
  /** 기구 없이 되는가 */
  needsMachine: boolean;
  /** 수영장이 있어야 하는가 — 헬스장 대부분에는 없다 */
  poolOnly?: boolean;
  note: string;
}

/**
 * 종목 목록.
 *
 * legLoad가 이 모듈의 핵심 숫자다. 자전거와 달리기는 둘 다 "유산소"지만
 * 하체 근력에 주는 방해가 완전히 다르다 — 앉아서 돌리는 자전거는 하체
 * 근비대를 거의 안 건드리는 반면, 내리막이 있는 달리기는 신장성 수축이
 * 들어가서 근육통까지 남긴다.
 */
export const CARDIO: readonly CardioExercise[] = [
  {
    id: 'treadmill-walk',
    name: '트레드밀 경사 걷기',
    legLoad: 0.3,
    impact: 'low',
    muscles: ['glutes', 'hamstrings', 'calves'],
    needsMachine: true,
    note: '경사를 올리고 속도를 낮춥니다. 무릎에 제일 편하면서 심박은 올라갑니다.',
  },
  {
    id: 'bike',
    name: '실내 자전거',
    legLoad: 0.35,
    impact: 'low',
    muscles: ['quads'],
    needsMachine: true,
    note: '근력 세션과 제일 덜 부딪힙니다. 다리 한 날에도 이건 괜찮습니다.',
  },
  {
    id: 'elliptical',
    name: '일립티컬',
    legLoad: 0.4,
    impact: 'low',
    muscles: ['quads', 'glutes'],
    needsMachine: true,
    note: '발이 떨어지지 않아 충격이 없습니다. 무릎·발목이 안 좋을 때.',
  },
  {
    id: 'row',
    name: '로잉머신',
    legLoad: 0.5,
    impact: 'low',
    muscles: ['back', 'quads', 'glutes'],
    needsMachine: true,
    note: '전신입니다. 등 한 날에는 피하세요 — 당기는 힘을 또 씁니다.',
  },
  {
    id: 'treadmill-run',
    name: '트레드밀 달리기',
    legLoad: 0.7,
    impact: 'high',
    muscles: ['quads', 'hamstrings', 'calves'],
    needsMachine: true,
    note: '착지 충격이 있습니다. 다리 한 날에 하면 회복이 늦습니다.',
  },
  {
    id: 'stair',
    name: '스텝밀 · 계단',
    legLoad: 0.75,
    impact: 'mid',
    muscles: ['glutes', 'quads', 'calves'],
    needsMachine: true,
    note: '엉덩이와 허벅지를 크게 씁니다. 사실상 가벼운 하체 운동입니다.',
  },
  {
    id: 'outdoor-run',
    name: '야외 달리기',
    legLoad: 0.8,
    impact: 'high',
    muscles: ['quads', 'hamstrings', 'calves'],
    needsMachine: false,
    note: '내리막에서 신장성 수축이 들어가 근육통이 남습니다.',
  },
  {
    id: 'jump-rope',
    name: '줄넘기',
    legLoad: 0.6,
    impact: 'high',
    muscles: ['calves'],
    needsMachine: false,
    note: '종아리에 많이 옵니다. 기구가 없을 때 제일 싼 유산소입니다.',
  },
  {
    id: 'swim',
    name: '수영',
    legLoad: 0.25,
    impact: 'low',
    muscles: ['back', 'frontDelt'],
    needsMachine: false,
    poolOnly: true,
    note: '관절 부담이 가장 적습니다. 어깨를 많이 쓰니 상체 한 날에는 생각해 보세요.',
  },
];

export function cardioById(id: string): CardioExercise | undefined {
  return CARDIO.find((item) => item.id === id);
}

/**
 * 강도 — 심박수가 아니라 말할 수 있는 정도로.
 *
 * 대부분은 심박계가 없고, 있어도 자기 최대심박을 모른다. "최대심박의
 * 65%"는 숫자처럼 보이지만 실제로는 아무것도 지시하지 않는다.
 * "옆 사람과 문장으로 대화가 되는 정도"는 누구나 지금 확인할 수 있다.
 */
export type CardioZone = 'easy' | 'steady' | 'hard' | 'interval';

export interface ZoneSpec {
  id: CardioZone;
  label: string;
  /** 말할 수 있는 정도 */
  talk: string;
  /** 심박계가 있는 사람을 위한 참고값 (최대심박 대비) */
  hrPercent: [number, number];
  rpe: [number, number];
}

export const ZONES: readonly ZoneSpec[] = [
  {
    id: 'easy',
    label: '아주 쉽게',
    talk: '노래를 부를 수 있습니다',
    hrPercent: [50, 60],
    rpe: [2, 3],
  },
  {
    id: 'steady',
    label: '대화되는 정도',
    talk: '문장으로 대화가 됩니다 — 숨이 차지만 말이 끊기지 않습니다',
    hrPercent: [60, 70],
    rpe: [4, 6],
  },
  {
    id: 'hard',
    label: '말 짧아지는 정도',
    talk: '단어 몇 개씩만 나옵니다',
    hrPercent: [75, 85],
    rpe: [7, 8],
  },
  {
    id: 'interval',
    label: '인터벌',
    talk: '켜는 구간에는 말을 못 합니다. 쉬는 구간에 돌아옵니다',
    hrPercent: [85, 95],
    rpe: [9, 10],
  },
];

export function cardioZoneOf(id: CardioZone): ZoneSpec {
  return ZONES.find((zone) => zone.id === id) ?? (ZONES[1] as ZoneSpec);
}

/*
 * 간섭 효과.
 *
 * 같은 근육을 같은 날 유산소로 또 쓰면 근력 적응이 줄어든다. 다만
 * "유산소 하면 근육 안 큰다"는 과장이다. 실제로 갈리는 것은 세 가지다.
 *
 *   - **같은 부위인가.** 다리 한 날의 달리기가 제일 나쁘고, 같은 날의
 *     자전거는 훨씬 덜하다.
 *   - **얼마나 센가.** 대화되는 정도로 20분은 거의 영향이 없다.
 *   - **순서.** 유산소를 먼저 하면 근력 세션의 무게가 그 자리에서 떨어진다.
 *     이건 적응 이전에 그날 운동을 못 하게 되는 문제다.
 */
export type Interference = 'none' | 'mild' | 'notable' | 'avoid';

export interface CardioInterferenceInput {
  exercise: CardioExercise;
  zone: CardioZone;
  minutes: number;
  /** 오늘 근력 세션이 쓴 부위 */
  todayMuscles: readonly MuscleGroup[];
  /** 근력 전에 할 것인가 */
  before: boolean;
}

export interface CardioInterferenceResult {
  level: Interference;
  /** 화면에 그대로 쓸 한 줄 */
  text: string;
  /** 피할 수 있으면 어떻게 */
  fix?: string;
}

const OVERLAP_MUSCLES: MuscleGroup[] = ['quads', 'hamstrings', 'glutes', 'calves'];

export function interference(input: CardioInterferenceInput): CardioInterferenceResult {
  const { exercise, zone, minutes, todayMuscles, before } = input;

  // 순서가 먼저다. 이건 적응이 아니라 그날 운동을 못 하게 되는 문제다.
  if (before && exercise.legLoad >= 0.5 && zone !== 'easy') {
    return {
      level: 'avoid',
      text:
        `근력 전에 ${withParticle(exercise.name, '을/를')} 하면 오늘 드는 무게가 그 자리에서 떨어집니다. ` +
        '적응 이전에 그날 운동을 못 하게 됩니다.',
      fix: '근력을 먼저 하고 유산소를 뒤에 붙이세요.',
    };
  }

  const sharesLegs = exercise.muscles.some((muscle) => OVERLAP_MUSCLES.includes(muscle))
    && todayMuscles.some((muscle) => OVERLAP_MUSCLES.includes(muscle));
  const sharesAny = exercise.muscles.some((muscle) => todayMuscles.includes(muscle));
  const hardEnough = zone === 'hard' || zone === 'interval';
  const longEnough = minutes >= 30;

  if (sharesLegs && exercise.legLoad >= 0.7 && (hardEnough || longEnough)) {
    return {
      level: 'avoid',
      text:
        `오늘 다리를 했는데 ${withParticle(exercise.name, '은/는')} 다리에 크게 실립니다. ` +
        '방금 한 하체 운동의 효과를 깎습니다.',
      fix: '실내 자전거나 경사 걷기로 바꾸거나, 다리 안 하는 날로 옮기세요.',
    };
  }

  if (sharesLegs && exercise.legLoad >= 0.5) {
    return {
      level: 'notable',
      text: `오늘 쓴 부위를 유산소로 또 씁니다. 회복이 그만큼 늦어집니다.`,
      fix: '20분 안쪽으로 하거나, 자전거처럼 다리를 덜 쓰는 것으로 바꾸세요.',
    };
  }

  if (sharesAny && hardEnough) {
    return {
      level: 'mild',
      text: '오늘 쓴 부위와 조금 겹칩니다. 대화되는 정도로 낮추면 거의 영향이 없습니다.',
    };
  }

  if (hardEnough && longEnough) {
    return {
      level: 'mild',
      text: '세게 오래 하면 전신 회복을 나눠 씁니다. 다음 근력 세션이 무거우면 짧게 가세요.',
    };
  }

  return {
    level: 'none',
    text: '오늘 근력 세션과 부딪히지 않습니다.',
  };
}

/** 오늘 하기 좋은 순서대로 — 겹치는 것을 뒤로 민다. */
export function rankForToday(
  todayMuscles: readonly MuscleGroup[],
  options: { needsMachine?: boolean } = {},
): CardioExercise[] {
  const rank = (exercise: CardioExercise): number => {
    const result = interference({
      exercise,
      zone: 'steady',
      minutes: 25,
      todayMuscles,
      before: false,
    });
    if (result.level === 'avoid') return 3;
    if (result.level === 'notable') return 2;
    if (result.level === 'mild') return 1;
    return 0;
  };

  return CARDIO
    .filter((exercise) => (options.needsMachine === false ? !exercise.needsMachine : true))
    .slice()
    /*
     * 겹치는 것 → 다리를 덜 쓰는 것 순. 다만 수영은 맨 뒤로 민다 —
     * 헬스장 대부분에 수영장이 없는데 맨 위에 띄우면 목록이 쓸모없어진다.
     */
    .sort((a, b) => rank(a) - rank(b)
      || Number(Boolean(a.poolOnly)) - Number(Boolean(b.poolOnly))
      || a.legLoad - b.legLoad);
}

export interface CardioLog {
  exerciseId: CardioMode;
  minutes: number;
  zone: CardioZone;
  /** 거리 (km) — 기구가 알려주면 */
  distanceKm?: number;
  /** 평균 심박 — 시계가 있으면 */
  avgHr?: number;
  /** 근력 전에 했는가 */
  before?: boolean;
}

/**
 * 기록 한 줄.
 *
 * 칼로리는 쓰지 않는다. 기구가 보여주는 칼로리는 체중·체성분·효율을
 * 모르고 낸 값이라 실제와 20~30%씩 어긋나고, 그 숫자로 먹는 양을
 * 정하면 오히려 해가 된다. 시간·거리·강도만 남긴다 — 그건 실제로 잰 것이다.
 */
export function describeCardio(log: CardioLog): string {
  const exercise = cardioById(log.exerciseId);
  const zone = cardioZoneOf(log.zone);
  const parts = [exercise ? exercise.name : log.exerciseId, `${log.minutes}분`, zone.label];
  if (log.distanceKm) parts.push(`${log.distanceKm}km`);
  if (log.avgHr) parts.push(`평균 ${log.avgHr}bpm`);
  return parts.join(' · ');
}

/**
 * 이번 주 유산소가 회복에 주는 부담.
 *
 * 분을 그냥 더하면 안 된다. 대화되는 정도 40분과 인터벌 10분은 몸에
 * 남기는 것이 다르다. 강도로 가중해서 "근력 세션 몇 개어치"로 바꾼다.
 */
export function weeklyLoad(logs: readonly CardioLog[]): {
  minutes: number;
  weighted: number;
  text: string;
} {
  const weightOf = (zone: CardioZone): number => {
    if (zone === 'easy') return 0.5;
    if (zone === 'steady') return 1;
    if (zone === 'hard') return 1.8;
    return 2.5;
  };

  const minutes = logs.reduce((sum, log) => sum + log.minutes, 0);
  const weighted = logs.reduce((sum, log) => {
    const exercise = cardioById(log.exerciseId);
    // 다리에 실리는 것일수록 근력 회복을 더 나눠 쓴다.
    const legFactor = 1 + (exercise ? exercise.legLoad : 0.5) * 0.5;
    return sum + log.minutes * weightOf(log.zone) * legFactor;
  }, 0);

  const rounded = Math.round(weighted);
  let text: string;
  if (minutes === 0) text = '이번 주 유산소 없음';
  else if (rounded < 120) text = `유산소 ${minutes}분 — 근력에 영향 없는 수준입니다`;
  else if (rounded < 250) text = `유산소 ${minutes}분 — 적당합니다`;
  else text = `유산소 ${minutes}분 — 근력 회복을 나눠 쓰는 양입니다. 근력이 목표면 줄이세요`;

  return { minutes, weighted: rounded, text };
}
