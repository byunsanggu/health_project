/**
 * 엔진 전역 도메인 타입.
 *
 * 설계 원칙: 엔진은 순수 함수만 노출한다. 저장소·네트워크·UI를 모른다.
 * 앱(React Native / 웹)은 로그를 모아서 넣고 처방을 받아 그리기만 한다.
 */

/** 볼륨을 따로 세는 근육군. 부위별 주간 세트 관리의 최소 단위다. */
export type MuscleGroup =
  | 'chest'
  | 'back'
  | 'frontDelt'
  | 'sideDelt'
  | 'rearDelt'
  | 'traps'
  | 'biceps'
  | 'triceps'
  | 'forearms'
  | 'quads'
  | 'hamstrings'
  | 'glutes'
  | 'calves'
  | 'abs';

/** 통증 체크인과 운동 필터링에 쓰는 관절. */
export type Joint =
  | 'neck'
  | 'shoulder'
  | 'elbow'
  | 'wrist'
  | 'lowBack'
  | 'hip'
  | 'knee'
  | 'ankle';

export type TrainingLevel = 'beginner' | 'intermediate' | 'advanced' | 'expert';

export type Equipment =
  | 'barbell'
  | 'dumbbell'
  | 'machine'
  | 'cable'
  | 'smith'
  | 'bodyweight'
  | 'band';

export type MovementPattern =
  | 'horizontalPush'
  | 'verticalPush'
  | 'horizontalPull'
  | 'verticalPull'
  | 'squat'
  | 'hinge'
  | 'lunge'
  | 'isolation'
  | 'carry'
  | 'core';

export interface Exercise {
  id: string;
  /** 한국어 운동명. 일반 명칭이라 특정 앱의 자산이 아니다. */
  name: string;
  nameEn: string;
  equipment: Equipment;
  pattern: MovementPattern;
  /**
   * 근육군별 자극 기여도 (0~1).
   * 1.0 = 주동근, 0.5 = 유의미한 협응근, 0.25 = 보조 정도.
   * 주간 유효 세트를 셀 때 그대로 가중치로 쓰인다.
   */
  contribution: Partial<Record<MuscleGroup, number>>;
  /**
   * 관절별 기계적 스트레스 (0~1).
   * 통증 게이트가 이 값으로 종목을 걸러내고 대체 운동을 고른다.
   */
  jointStress: Partial<Record<Joint, number>>;
  /** 한 번에 올리는 최소 중량 단위(kg). 머신/케이블은 스택 간격. */
  increment: number;
  /** 한쪽씩 하는 종목이면 true (좌우 합산 세트 계산에 쓴다). */
  unilateral?: boolean;
}

export interface SetLog {
  exerciseId: string;
  weightKg: number;
  reps: number;
  /**
   * RIR(Reps In Reserve) = 그 세트에서 더 할 수 있었던 반복 수.
   * 0 = 실패 지점, 5 = 5회 이상 남음. 엔진의 핵심 입력값이다.
   */
  rir: number;
  /** 워밍업 세트는 볼륨에서 제외한다. */
  warmup?: boolean;
}

/**
 * 오프라인 우선 동기화를 위한 공통 필드.
 *
 * 헬스장 지하에는 신호가 없다. 로컬이 원본이고 서버는 사본이라는 전제로
 * 설계해야 하는데, 나중에 붙이면 이미 쌓인 기록을 전부 손봐야 한다.
 * 그래서 처음부터 모든 기록이 자기 신원과 수정 시각을 갖는다.
 */
export interface Syncable {
  /** 기기 간에 겹치지 않는 식별자 */
  id?: string;
  /** 마지막 수정 시각 (ISO). 충돌 시 이 값으로 승자를 정한다 */
  updatedAt?: string;
  /** 어느 기기에서 쓴 기록인가. updatedAt 이 같을 때 순서를 가른다 */
  deviceId?: string;
  /** 삭제 표시. 실제로 지우면 다른 기기가 되살린다 */
  deleted?: boolean;
}

export interface SessionLog extends Syncable {
  /** YYYY-MM-DD */
  date: string;
  sets: SetLog[];
}

export interface PainReport {
  joint: Joint;
  /** 0 = 없음, 10 = 극심. 3점 이상부터 종목 조정이 들어간다. */
  score: number;
}

/** 운동 시작 전 30초 체크인. 디로드 판정의 보조 신호. */
export interface CheckIn extends Syncable {
  date: string;
  sleepHours?: number;
  /** 전신 근육통 0~10 */
  soreness?: number;
  /** 생활 스트레스 0~10 */
  stress?: number;
  /** 의욕 0~10 */
  motivation?: number;
  pain?: PainReport[];
}

/** 근육군별 주간 볼륨 랜드마크 (유효 세트 수 기준). */
export interface VolumeLandmark {
  /** MEV: 최소 유효 볼륨. 이 아래는 성장 자극이 부족하다. */
  mev: number;
  /** MAV: 적응 최대 볼륨. 대부분의 주차가 머무는 구간. */
  mav: number;
  /** MRV: 회복 가능 최대 볼륨. 넘기면 누적 피로가 회복을 앞선다. */
  mrv: number;
}

export type VolumeByMuscle = Partial<Record<MuscleGroup, number>>;
export type LandmarksByMuscle = Record<MuscleGroup, VolumeLandmark>;

/** 부위가 랜드마크 대비 어디에 있는지. */
export type VolumeZone = 'underMev' | 'mevToMav' | 'mavToMrv' | 'overMrv';
