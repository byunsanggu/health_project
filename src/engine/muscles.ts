import type {
  LandmarksByMuscle,
  MuscleGroup,
  TrainingLevel,
  VolumeLandmark,
  VolumeZone,
} from './types.ts';

export const MUSCLE_GROUPS: readonly MuscleGroup[] = [
  'chest', 'back', 'frontDelt', 'sideDelt', 'rearDelt', 'traps',
  'biceps', 'triceps', 'forearms',
  'quads', 'hamstrings', 'glutes', 'calves', 'abs',
];

export const MUSCLE_LABELS_KO: Record<MuscleGroup, string> = {
  chest: '가슴',
  back: '등',
  frontDelt: '전면 삼각근',
  sideDelt: '측면 삼각근',
  rearDelt: '후면 삼각근',
  traps: '승모근',
  biceps: '이두',
  triceps: '삼두',
  forearms: '전완',
  quads: '대퇴사두',
  hamstrings: '햄스트링',
  glutes: '둔근',
  calves: '종아리',
  abs: '복근',
};

/**
 * 중급자 기준 주간 볼륨 랜드마크 (유효 세트 수).
 *
 * 문헌에서 반복 보고된 범위를 현장 감각으로 정리한 기본값이다.
 * 개인차가 크므로 8~12주 데이터가 쌓이면 `calibrateLandmarks`로 개인화한다.
 *
 * frontDelt / abs 의 MEV가 0인 이유: 프레스 동작에서 간접 볼륨이 충분히 들어가
 * 직접 세트가 0이어도 성장이 멈추지 않는 부위이기 때문이다.
 */
const BASE_LANDMARKS: LandmarksByMuscle = {
  chest: { mev: 10, mav: 16, mrv: 22 },
  back: { mev: 10, mav: 18, mrv: 25 },
  frontDelt: { mev: 0, mav: 8, mrv: 12 },
  sideDelt: { mev: 8, mav: 16, mrv: 26 },
  rearDelt: { mev: 6, mav: 12, mrv: 20 },
  traps: { mev: 4, mav: 12, mrv: 20 },
  biceps: { mev: 8, mav: 14, mrv: 20 },
  triceps: { mev: 6, mav: 14, mrv: 20 },
  forearms: { mev: 2, mav: 8, mrv: 16 },
  quads: { mev: 8, mav: 16, mrv: 20 },
  hamstrings: { mev: 6, mav: 12, mrv: 20 },
  glutes: { mev: 4, mav: 12, mrv: 16 },
  calves: { mev: 8, mav: 16, mrv: 20 },
  abs: { mev: 0, mav: 12, mrv: 25 },
};

/**
 * 경력별 배율.
 * 초급자는 적은 볼륨으로도 자극이 충분하고 회복 여력도 작다.
 * 고급자는 자극 역치가 올라가지만 MRV는 비례해서 늘지 않는다 — 그래서 MRV 배율이 더 낮다.
 */
const LEVEL_SCALE: Record<TrainingLevel, { mev: number; mav: number; mrv: number }> = {
  beginner: { mev: 0.7, mav: 0.7, mrv: 0.75 },
  intermediate: { mev: 1, mav: 1, mrv: 1 },
  advanced: { mev: 1.2, mav: 1.15, mrv: 1.1 },
};

/** 랜드마크 순서(mev ≤ mav ≤ mrv)를 깨뜨리지 않게 보정한다. */
function normalizeLandmark(landmark: VolumeLandmark): VolumeLandmark {
  const mev = Math.max(0, Math.round(landmark.mev));
  const mav = Math.max(mev, Math.round(landmark.mav));
  const mrv = Math.max(mav + 1, Math.round(landmark.mrv));
  return { mev, mav, mrv };
}

export function landmarksFor(level: TrainingLevel): LandmarksByMuscle {
  const scale = LEVEL_SCALE[level];
  const out = {} as LandmarksByMuscle;
  for (const muscle of MUSCLE_GROUPS) {
    const base = BASE_LANDMARKS[muscle];
    out[muscle] = normalizeLandmark({
      mev: base.mev * scale.mev,
      mav: base.mav * scale.mav,
      mrv: base.mrv * scale.mrv,
    });
  }
  return out;
}

export interface LandmarkOverride {
  muscle: MuscleGroup;
  /**
   * 관측된 개인 MRV. 실제로 회복에 실패한 주차의 볼륨을 넣는다.
   * 기본 MRV와 가중 평균해 서서히 개인값으로 이동시킨다.
   */
  observedMrv?: number;
  /** 성장이 멈춘 것으로 확인된 볼륨(개인 MEV 추정). */
  observedMev?: number;
}

/**
 * 관측값으로 랜드마크를 개인화한다.
 *
 * 한 번의 관측으로 통째로 갈아엎지 않는다 — 컨디션 나쁜 한 주가
 * 그 사람의 MRV를 영구히 낮춰버리면 안 되기 때문에 30%만 반영한다.
 */
export function calibrateLandmarks(
  landmarks: LandmarksByMuscle,
  overrides: readonly LandmarkOverride[],
  weight = 0.3,
): LandmarksByMuscle {
  const blend = (base: number, observed: number) => base * (1 - weight) + observed * weight;
  const out: LandmarksByMuscle = { ...landmarks };

  for (const override of overrides) {
    const base = out[override.muscle];
    out[override.muscle] = normalizeLandmark({
      mev: override.observedMev === undefined ? base.mev : blend(base.mev, override.observedMev),
      mav: base.mav,
      mrv: override.observedMrv === undefined ? base.mrv : blend(base.mrv, override.observedMrv),
    });
  }
  return out;
}

/** 현재 볼륨이 어느 구간인지 판정한다. */
export function zoneOf(sets: number, landmark: VolumeLandmark): VolumeZone {
  if (sets < landmark.mev) return 'underMev';
  if (sets <= landmark.mav) return 'mevToMav';
  if (sets <= landmark.mrv) return 'mavToMrv';
  return 'overMrv';
}

export const ZONE_LABELS_KO: Record<VolumeZone, string> = {
  underMev: '부족',
  mevToMav: '적정',
  mavToMrv: '고강도',
  overMrv: '초과',
};
