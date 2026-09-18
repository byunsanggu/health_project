import { withParticle } from './korean.ts';
import type { TrainingLevel } from './types.ts';

/**
 * 블록 유형.
 *
 * 근비대 한 가지로만 돌리면 지루하고, 근력은 늘지 않으며, 한계를 확인할 기회가
 * 없다. 반대로 매주 한계에 도전하면 몇 주 만에 무너진다. 한계 돌파는 기분이
 * 아니라 계획으로 하는 것이고, 이 표가 그 계획의 단위다.
 */
export type TrainingStyle =
  | 'hypertrophy'
  | 'strength'
  | 'density'
  | 'peak'
  | 'conditioning';

export interface StyleRepRanges {
  primary: { min: number; max: number };
  accessory: { min: number; max: number };
  isolation: { min: number; max: number };
}

export interface StyleProfile {
  style: TrainingStyle;
  label: string;
  description: string;
  repRanges: StyleRepRanges;
  /** 주차별 목표 RIR. 블록이 길어질수록 실패에 가까워진다 */
  rirByWeek: number[];
  /** 휴식 시간 배율 */
  restMultiplier: number;
  /** 볼륨 랜드마크 대비 배율 */
  volumeMultiplier: number;
  blockWeeks: number;
  /** 이 스타일을 연속으로 몇 블록까지 돌릴 수 있는가 */
  maxConsecutiveBlocks: number;
  /** 강도 기법(드롭세트 등)을 허용하는 블록인가 */
  allowsIntensityTechniques: boolean;
  /** 한계 테스트를 포함하는 블록인가 */
  includesMaxTest: boolean;
  /** 이 스타일을 권하지 않는 단계 */
  minLevel?: TrainingLevel;
  caution?: string;
}

export const STYLE_PROFILES: Record<TrainingStyle, StyleProfile> = {
  hypertrophy: {
    style: 'hypertrophy',
    label: '근비대',
    description: '기본 블록. 적당한 반복과 볼륨으로 근육량을 늘립니다',
    repRanges: {
      primary: { min: 6, max: 10 },
      accessory: { min: 8, max: 12 },
      isolation: { min: 10, max: 15 },
    },
    rirByWeek: [3, 2, 2, 1, 1],
    restMultiplier: 1,
    volumeMultiplier: 1,
    blockWeeks: 5,
    maxConsecutiveBlocks: 3,
    allowsIntensityTechniques: true,
    includesMaxTest: false,
  },
  strength: {
    style: 'strength',
    label: '근력',
    description: '저반복 고중량. 드는 무게 자체를 올립니다',
    repRanges: {
      primary: { min: 3, max: 5 },
      accessory: { min: 5, max: 8 },
      isolation: { min: 8, max: 12 },
    },
    rirByWeek: [3, 2, 2, 1],
    restMultiplier: 1.5,
    volumeMultiplier: 0.7,
    blockWeeks: 4,
    maxConsecutiveBlocks: 2,
    allowsIntensityTechniques: false,
    includesMaxTest: false,
    minLevel: 'intermediate',
    caution: '자세가 잡히기 전에 저반복 고중량으로 가면 부상 위험이 큽니다',
  },
  density: {
    style: 'density',
    label: '고밀도 (빡세게)',
    description: '휴식을 줄이고 볼륨을 올려 한 세션의 밀도를 끌어올립니다',
    repRanges: {
      primary: { min: 8, max: 12 },
      accessory: { min: 10, max: 15 },
      isolation: { min: 12, max: 20 },
    },
    rirByWeek: [2, 1, 1],
    restMultiplier: 0.65,
    volumeMultiplier: 1.15,
    // 3주가 한계다. 그 이상은 회복이 따라오지 못한다.
    blockWeeks: 3,
    maxConsecutiveBlocks: 1,
    allowsIntensityTechniques: true,
    includesMaxTest: false,
    minLevel: 'intermediate',
    caution: '회복 요구가 가장 큰 블록입니다. 끝나면 반드시 디로드로 넘어갑니다',
  },
  peak: {
    style: 'peak',
    label: '한계 돌파',
    description: '볼륨을 줄이고 강도를 올려 한계를 확인합니다. 마지막 주에 최대 중량 시도',
    repRanges: {
      primary: { min: 1, max: 3 },
      accessory: { min: 3, max: 6 },
      isolation: { min: 8, max: 12 },
    },
    rirByWeek: [2, 1],
    restMultiplier: 2,
    volumeMultiplier: 0.5,
    blockWeeks: 2,
    maxConsecutiveBlocks: 1,
    allowsIntensityTechniques: false,
    includesMaxTest: true,
    minLevel: 'intermediate',
    caution: '축적 블록과 디로드를 거친 뒤에만 들어갑니다. 피로가 남은 상태로는 기록이 안 나옵니다',
  },
  conditioning: {
    style: 'conditioning',
    label: '컨디셔닝',
    description: '서킷·인터벌 중심. 심폐와 작업 능력을 올립니다',
    repRanges: {
      primary: { min: 8, max: 15 },
      accessory: { min: 10, max: 20 },
      isolation: { min: 12, max: 20 },
    },
    rirByWeek: [2, 2, 1],
    restMultiplier: 0.4,
    volumeMultiplier: 0.6,
    blockWeeks: 3,
    maxConsecutiveBlocks: 1,
    allowsIntensityTechniques: false,
    includesMaxTest: false,
    caution: '근력 세션과 같은 부위가 붙으면 양쪽 다 손해입니다',
  },
};

export const TRAINING_STYLES: readonly TrainingStyle[] = [
  'hypertrophy', 'strength', 'density', 'peak', 'conditioning',
];

export function styleProfile(style: TrainingStyle): StyleProfile {
  return STYLE_PROFILES[style];
}

/** 그 주차의 목표 RIR. 블록 길이를 넘어가면 마지막 값을 유지한다. */
export function targetRirFor(style: TrainingStyle, weekInBlock: number): number {
  const rirs = STYLE_PROFILES[style].rirByWeek;
  return rirs[Math.min(Math.max(1, weekInBlock) - 1, rirs.length - 1)]!;
}

const LEVEL_ORDER: Record<TrainingLevel, number> = {
  beginner: 0, intermediate: 1, advanced: 2, expert: 3,
};

export interface StyleAvailability {
  style: TrainingStyle;
  profile: StyleProfile;
  allowed: boolean;
  reason?: string;
}

export interface StyleContext {
  level: TrainingLevel;
  /** 최근에 돌린 블록들 (최신이 마지막) */
  recentStyles?: readonly TrainingStyle[];
  /** 직전 주가 디로드였는가 */
  justDeloaded?: boolean;
  /** 3점 이상 통증이 있는가 */
  painPresent?: boolean;
}

/**
 * 다음 블록으로 고를 수 있는 스타일.
 *
 * 하고 싶은 걸 막는 게 목적이 아니라, 지금 고르면 손해인 것을 이유와 함께
 * 알려주는 게 목적이다. 한계 돌파는 피로가 빠진 뒤에 해야 기록이 나온다.
 */
export function availableStyles(context: StyleContext): StyleAvailability[] {
  const recent = context.recentStyles ?? [];
  const last = recent[recent.length - 1];

  return TRAINING_STYLES.map((style) => {
    const profile = STYLE_PROFILES[style];
    const deny = (reason: string): StyleAvailability => ({ style, profile, allowed: false, reason });

    if (profile.minLevel && LEVEL_ORDER[context.level] < LEVEL_ORDER[profile.minLevel]) {
      const levelLabel = profile.minLevel === 'intermediate' ? '중급' : '고급';
      return deny(`${withParticle(profile.label, '은/는')} ${levelLabel} 이상에 권합니다. ${profile.caution ?? ''}`.trim());
    }

    if (context.painPresent && (style === 'peak' || style === 'density')) {
      return deny('3점 이상 통증이 있는 상태에서는 강도를 올리지 않습니다.');
    }

    if (style === 'peak' && !context.justDeloaded) {
      return deny('한계 돌파는 디로드로 피로를 뺀 다음 주에 들어갑니다. 지금 시도하면 기록이 아니라 컨디션을 재는 셈입니다.');
    }

    const streak = countTrailing(recent, style);
    if (streak >= profile.maxConsecutiveBlocks) {
      return deny(`${profile.label} 블록을 ${streak}번 연속했습니다. 다른 블록을 한 번 거친 뒤 돌아오세요.`);
    }

    if (style === 'density' && last === 'density') {
      return deny('고밀도 블록은 연속으로 돌리지 않습니다. 회복이 따라오지 못합니다.');
    }

    return { style, profile, allowed: true };
  });
}

export interface StyleSuggestion {
  style: TrainingStyle;
  profile: StyleProfile;
  reason: string;
}

/** 다음 블록으로 무엇을 권할지. 사용자가 다른 걸 골라도 막지 않는다. */
export function suggestNextStyle(context: StyleContext): StyleSuggestion {
  const options = availableStyles(context);
  const allowed = (style: TrainingStyle) => options.find((item) => item.style === style)?.allowed;
  const recent = context.recentStyles ?? [];
  const last = recent[recent.length - 1];

  if (context.justDeloaded && allowed('peak') && recent.includes('strength')) {
    return {
      style: 'peak',
      profile: STYLE_PROFILES.peak,
      reason: '근력 블록과 디로드를 마쳤습니다. 지금이 기록을 확인하기 가장 좋은 시점입니다.',
    };
  }

  if ((last === 'density' || last === 'peak') && allowed('hypertrophy')) {
    return {
      style: 'hypertrophy',
      profile: STYLE_PROFILES.hypertrophy,
      reason: `${STYLE_PROFILES[last].label} 블록 뒤에는 볼륨 블록으로 돌아와 기반을 다시 쌓습니다.`,
    };
  }

  if (recent.filter((style) => style === 'hypertrophy').length >= 2 && allowed('strength')) {
    return {
      style: 'strength',
      profile: STYLE_PROFILES.strength,
      reason: '근비대 블록이 이어졌습니다. 근력 블록으로 바꿔 드는 무게 자체를 올릴 시점입니다.',
    };
  }

  return {
    style: 'hypertrophy',
    profile: STYLE_PROFILES.hypertrophy,
    reason: '기반이 되는 블록입니다. 여기서 쌓은 볼륨이 다른 블록의 재료가 됩니다.',
  };
}

function countTrailing(list: readonly TrainingStyle[], style: TrainingStyle): number {
  let count = 0;
  for (let i = list.length - 1; i >= 0; i -= 1) {
    if (list[i] !== style) break;
    count += 1;
  }
  return count;
}
