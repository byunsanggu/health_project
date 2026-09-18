import type { Exercise, MovementPattern } from './types.ts';

/**
 * 운동 시연 데이터.
 *
 * 83개 종목에 시연이 하나도 없으면 초보자는 "랜드마인 프레스"가 뭔지 모른다.
 * 실제 제품에서는 촬영 영상이나 구매한 3D 에셋이 들어갈 자리인데, 여기서는
 * 관절 각도 키프레임으로 절차적 애니메이션을 돌려 그 자리를 보여준다.
 *
 * 구조를 이렇게 잡은 이유가 있다 — 종목마다 에셋을 만들면 83개를 다 찍어야
 * 하지만, 동작 패턴 10개로 묶으면 10개만 만들고 종목별로는 큐와 실수만
 * 덧붙이면 된다. 실제 에셋 파이프라인도 같은 구조로 간다.
 */
export type BodyOrientation = 'standing' | 'supine' | 'prone' | 'bentOver' | 'seated' | 'hanging';

/** 관절 각도(도). 옆에서 본 기준이고, 0은 해부학적 기본 자세다. */
export interface Pose {
  /** 상체 전방 경사 */
  spine?: number;
  /** 고관절 굴곡 */
  hip?: number;
  /** 무릎 굴곡 */
  knee?: number;
  /** 발목 배측 굴곡 */
  ankle?: number;
  /** 어깨 굴곡 (팔을 앞·위로) */
  shoulder?: number;
  /** 팔꿈치 굴곡 */
  elbow?: number;
  /** 런지에서 앞발이 나간 거리 (m) */
  split?: number;
  /** 몸 전체 상하 이동 (m) — 풀업처럼 몸이 올라가는 동작 */
  rootY?: number;
}

export interface DemoKeyframe {
  /** 0~1 주기 위치 */
  t: number;
  pose: Pose;
  /** 이 구간에서 강조할 말 */
  label?: string;
}

export type DemoSource = 'procedural' | 'video' | 'model3d';

export interface ExerciseDemo {
  exerciseId: string;
  name: string;
  pattern: MovementPattern;
  source: DemoSource;
  orientation: BodyOrientation;
  /** 카메라 각도 */
  view: 'side' | 'front' | 'threeQuarter';
  /** 한 번 반복하는 데 걸리는 시간 (초) */
  cycleSeconds: number;
  keyframes: DemoKeyframe[];
  /** 수행 큐 — 하면서 떠올릴 것 */
  cues: string[];
  /** 흔한 실수 */
  mistakes: string[];
  /** 실제 촬영 영상이나 3D 에셋이 붙을 자리 */
  assetUrl?: string;
}

/* ── 패턴별 기본 동작 ──────────────────────────────────── */

interface PatternDemo {
  orientation: BodyOrientation;
  view: ExerciseDemo['view'];
  cycleSeconds: number;
  keyframes: DemoKeyframe[];
  cues: string[];
  mistakes: string[];
}

const PATTERN_DEMOS: Record<MovementPattern, PatternDemo> = {
  squat: {
    orientation: 'standing',
    view: 'threeQuarter',
    cycleSeconds: 3.4,
    keyframes: [
      { t: 0, pose: { spine: 8, hip: 0, knee: 3, ankle: 3, shoulder: 125, elbow: 115 }, label: '시작' },
      { t: 0.45, pose: { spine: 32, hip: 100, knee: 112, ankle: 22, shoulder: 125, elbow: 115 }, label: '최저점' },
      { t: 0.62, pose: { spine: 30, hip: 92, knee: 100, ankle: 20, shoulder: 125, elbow: 115 } },
      { t: 1, pose: { spine: 8, hip: 0, knee: 3, ankle: 3, shoulder: 125, elbow: 115 }, label: '복귀' },
    ],
    cues: ['가슴을 세운 채 상체 각도를 유지합니다', '무릎이 발끝 방향을 따라 벌어지게', '뒤꿈치로 바닥을 밀어 올라옵니다'],
    mistakes: ['무릎이 안쪽으로 무너짐', '뒤꿈치가 들림', '엉덩이만 먼저 올라오고 상체가 따라옴'],
  },
  hinge: {
    orientation: 'standing',
    view: 'side',
    cycleSeconds: 3.6,
    keyframes: [
      { t: 0, pose: { spine: 5, hip: 0, knee: 8, shoulder: 8, elbow: 4 }, label: '직립' },
      // 힌지는 대퇴가 아니라 상체가 내려간다. hip을 크게 주면 앉는 자세가 된다.
      { t: 0.5, pose: { spine: 74, hip: 12, knee: 20, shoulder: 12, elbow: 4 }, label: '최저점' },
      { t: 1, pose: { spine: 5, hip: 0, knee: 8, shoulder: 8, elbow: 4 }, label: '고관절 신전' },
    ],
    cues: ['고관절을 뒤로 밀며 내려갑니다', '등을 편 상태를 끝까지 유지', '바를 다리에 붙여 움직입니다'],
    mistakes: ['등이 말림', '무릎을 굽혀 스쿼트처럼 됨', '바가 몸에서 멀어짐'],
  },
  horizontalPush: {
    orientation: 'supine',
    view: 'side',
    cycleSeconds: 3,
    keyframes: [
      { t: 0, pose: { shoulder: 88, elbow: 6 }, label: '락아웃' },
      { t: 0.45, pose: { shoulder: 66, elbow: 92 }, label: '가슴 터치' },
      { t: 0.6, pose: { shoulder: 70, elbow: 84 } },
      { t: 1, pose: { shoulder: 88, elbow: 6 }, label: '밀어냄' },
    ],
    cues: ['견갑을 모아 고정하고 가슴을 들어올립니다', '바를 명치 아래로 내립니다', '발로 바닥을 밀어 전신 긴장을 유지'],
    mistakes: ['어깨가 앞으로 말림', '바가 목 쪽으로 내려옴', '허리가 과하게 들림'],
  },
  verticalPush: {
    orientation: 'standing',
    view: 'side',
    cycleSeconds: 3,
    keyframes: [
      { t: 0, pose: { spine: 4, shoulder: 88, elbow: 100 }, label: '어깨 높이' },
      { t: 0.45, pose: { spine: 2, shoulder: 172, elbow: 6 }, label: '머리 위 락아웃' },
      { t: 1, pose: { spine: 4, shoulder: 88, elbow: 100 }, label: '복귀' },
    ],
    cues: ['갈비뼈를 닫고 복부에 힘을 준 채 밀어올립니다', '바가 지나가도록 머리를 살짝 뒤로', '팔꿈치를 완전히 폅니다'],
    mistakes: ['허리를 젖혀서 밀어냄', '바가 몸 앞으로 나감', '어깨가 으쓱 올라간 채 시작'],
  },
  horizontalPull: {
    orientation: 'bentOver',
    view: 'side',
    cycleSeconds: 3,
    keyframes: [
      { t: 0, pose: { spine: 68, hip: 88, knee: 24, shoulder: 8, elbow: 6 }, label: '늘어뜨림' },
      { t: 0.45, pose: { spine: 68, hip: 88, knee: 24, shoulder: 28, elbow: 112 }, label: '당김' },
      { t: 1, pose: { spine: 68, hip: 88, knee: 24, shoulder: 8, elbow: 6 }, label: '신장' },
    ],
    cues: ['견갑을 먼저 모으고 팔이 따라옵니다', '상체 각도를 끝까지 고정', '배꼽 쪽으로 당깁니다'],
    mistakes: ['상체를 세우며 반동을 씀', '팔로만 당김', '어깨가 앞으로 말린 채 시작'],
  },
  verticalPull: {
    orientation: 'hanging',
    view: 'side',
    cycleSeconds: 3.2,
    keyframes: [
      { t: 0, pose: { shoulder: 168, elbow: 8, rootY: -0.34 }, label: '완전 신장' },
      { t: 0.45, pose: { shoulder: 122, elbow: 132, rootY: 0 }, label: '턱이 바 위로' },
      { t: 1, pose: { shoulder: 168, elbow: 8, rootY: -0.34 }, label: '내려옴' },
    ],
    cues: ['견갑을 아래로 내리며 시작합니다', '팔꿈치를 옆구리 쪽으로 당깁니다', '내려올 때도 힘을 유지'],
    mistakes: ['반동으로 올라감', '가동 범위를 반만 씀', '어깨가 귀에 붙은 채 매달림'],
  },
  lunge: {
    orientation: 'standing',
    view: 'threeQuarter',
    cycleSeconds: 3.4,
    keyframes: [
      { t: 0, pose: { spine: 6, hip: 0, knee: 4, shoulder: 6, elbow: 4, split: 0 }, label: '시작' },
      { t: 0.45, pose: { spine: 10, hip: 62, knee: 92, shoulder: 6, elbow: 4, split: 0.55 }, label: '최저점' },
      { t: 1, pose: { spine: 6, hip: 0, knee: 4, shoulder: 6, elbow: 4, split: 0 }, label: '복귀' },
    ],
    cues: ['상체를 세운 채 수직으로 내려갑니다', '앞발 뒤꿈치로 밀어 올라옵니다', '뒷무릎이 바닥에 닿기 직전까지'],
    mistakes: ['앞무릎이 안쪽으로 무너짐', '상체가 앞으로 쏠림', '보폭이 너무 좁음'],
  },
  isolation: {
    orientation: 'standing',
    view: 'side',
    cycleSeconds: 2.6,
    keyframes: [
      { t: 0, pose: { spine: 4, shoulder: 6, elbow: 8 }, label: '신장' },
      { t: 0.45, pose: { spine: 4, shoulder: 14, elbow: 132 }, label: '수축' },
      { t: 1, pose: { spine: 4, shoulder: 6, elbow: 8 }, label: '신장' },
    ],
    cues: ['목표 근육 외에는 움직이지 않습니다', '수축 지점에서 잠깐 멈춥니다', '내려올 때 더 천천히'],
    mistakes: ['몸통 반동을 씀', '가동 범위를 반만 씀', '중량이 무거워 자세가 무너짐'],
  },
  core: {
    orientation: 'supine',
    view: 'side',
    cycleSeconds: 3,
    keyframes: [
      { t: 0, pose: { spine: 0, hip: 10, knee: 20, shoulder: 20, elbow: 20 }, label: '시작' },
      { t: 0.45, pose: { spine: 24, hip: 88, knee: 24, shoulder: 26, elbow: 24 }, label: '수축' },
      { t: 1, pose: { spine: 0, hip: 10, knee: 20, shoulder: 20, elbow: 20 }, label: '복귀' },
    ],
    cues: ['허리를 바닥에 붙인 채 유지합니다', '복부로 당기고 다리는 따라옵니다', '호흡을 멈추지 않습니다'],
    mistakes: ['허리가 바닥에서 뜸', '목으로 당김', '반동을 씀'],
  },
  carry: {
    orientation: 'standing',
    view: 'threeQuarter',
    cycleSeconds: 1.6,
    keyframes: [
      { t: 0, pose: { spine: 3, hip: 12, knee: 14, shoulder: 4, elbow: 4, split: 0.18 }, label: '보행' },
      { t: 0.5, pose: { spine: 3, hip: 12, knee: 14, shoulder: 4, elbow: 4, split: -0.18 }, label: '보행' },
      { t: 1, pose: { spine: 3, hip: 12, knee: 14, shoulder: 4, elbow: 4, split: 0.18 }, label: '보행' },
    ],
    cues: ['가슴을 세우고 어깨를 내립니다', '작은 보폭으로 빠르게', '복부에 힘을 유지'],
    mistakes: ['어깨가 앞으로 말림', '보폭이 너무 큼', '몸이 좌우로 흔들림'],
  },
};

/* ── 종목별 큐와 실수 ──────────────────────────────────── */

interface DemoOverride {
  cues?: string[];
  mistakes?: string[];
  orientation?: BodyOrientation;
  view?: ExerciseDemo['view'];
  /** 패턴 기본 동작이 그 종목과 다를 때만 쓴다 (예: 등척성 버티기) */
  keyframes?: DemoKeyframe[];
  cycleSeconds?: number;
}

/**
 * 버티는 동작.
 *
 * 플랭크를 코어 패턴으로 돌리면 크런치가 된다 — 등척성 종목은 반복이 아니라
 * 자세를 유지하는 것이 동작 자체다. 호흡만큼만 움직이게 두고, 무너지는
 * 방향(허리 꺼짐·엉덩이 들림)을 실수 항목으로 대신 설명한다.
 */
const HOLD_KEYFRAMES: DemoKeyframe[] = [
  { t: 0, pose: { spine: 2, hip: 4, knee: 2, shoulder: 88, elbow: 92, rootY: -0.42 }, label: '버티기' },
  { t: 0.5, pose: { spine: 3, hip: 6, knee: 2, shoulder: 88, elbow: 92, rootY: -0.42 }, label: '버티기' },
  { t: 1, pose: { spine: 2, hip: 4, knee: 2, shoulder: 88, elbow: 92, rootY: -0.42 }, label: '버티기' },
];

const OVERRIDES: Record<string, DemoOverride> = {
  'back-squat': {
    cues: ['바를 승모근 위에 얹고 상체 각도를 유지합니다', '무릎이 발끝 방향을 따라 벌어지게', '대퇴가 수평 아래까지 내려갑니다'],
    mistakes: ['무릎이 안쪽으로 무너짐', '뒤꿈치가 들림', '상체가 먼저 올라오고 엉덩이만 따라옴'],
  },
  'front-squat': {
    cues: ['팔꿈치를 높게 유지해 바를 받칩니다', '상체를 최대한 세운 채 내려갑니다'],
    mistakes: ['팔꿈치가 떨어지며 바가 앞으로 굴러감', '상체가 숙여짐'],
  },
  'conventional-deadlift': {
    cycleSeconds: 3.6,
    keyframes: [
      { t: 0, pose: { spine: 6, hip: 0, knee: 6, shoulder: 8, elbow: 4 }, label: '락아웃' },
      // 바닥에서 출발하는 만큼 RDL보다 무릎이 깊게 들어간다
      { t: 0.5, pose: { spine: 58, hip: 34, knee: 64, shoulder: 10, elbow: 4 }, label: '바닥' },
      { t: 1, pose: { spine: 6, hip: 0, knee: 6, shoulder: 8, elbow: 4 }, label: '고관절 신전' },
    ],
    cues: ['바를 정강이에 붙인 채 출발합니다', '가슴을 열고 등을 편 상태를 유지', '엉덩이와 어깨가 같이 올라옵니다'],
    mistakes: ['등이 말림', '엉덩이가 먼저 올라감', '바가 몸에서 멀어짐'],
  },
  'romanian-deadlift': {
    cues: ['무릎 각도를 고정한 채 고관절만 접습니다', '햄스트링이 당겨지는 지점까지만', '바를 다리에 붙여 내립니다'],
    mistakes: ['무릎을 계속 굽힘', '허리로 내려감', '가동 범위를 과하게 늘림'],
  },
  'barbell-bench-press': {
    cues: ['견갑을 모아 고정하고 가슴을 들어올립니다', '바를 명치 아래로 내립니다', '발로 바닥을 밀어 전신 긴장을 유지'],
    mistakes: ['어깨가 앞으로 말림', '바가 목 쪽으로 내려옴', '엉덩이가 벤치에서 뜸'],
  },
  'barbell-overhead-press': {
    cues: ['갈비뼈를 닫고 복부에 힘을 준 채 밀어올립니다', '바가 지나가도록 머리를 살짝 뒤로', '머리 위에서 팔꿈치를 완전히 폅니다'],
    mistakes: ['허리를 젖혀서 밀어냄', '바가 몸 앞으로 나감', '다리 반동을 씀'],
  },
  'barbell-row': {
    cues: ['상체 각도를 45도 아래로 고정합니다', '견갑을 먼저 모으고 팔이 따라옵니다', '배꼽 쪽으로 당깁니다'],
    mistakes: ['상체를 세우며 반동을 씀', '팔로만 당김', '허리가 말림'],
  },
  'pull-up': {
    cues: ['견갑을 아래로 내리며 시작합니다', '팔꿈치를 옆구리 쪽으로 당깁니다', '내려올 때도 통제합니다'],
    mistakes: ['반동으로 올라감', '가동 범위를 반만 씀', '어깨가 귀에 붙은 채 매달림'],
  },
  'lat-pulldown': {
    cues: ['가슴을 살짝 들고 상체를 고정합니다', '바를 쇄골 쪽으로 당깁니다', '팔꿈치를 아래로 밀어내듯'],
    mistakes: ['상체를 과하게 젖힘', '목 뒤로 당김', '손목으로 당김'],
  },
  'hip-thrust': {
    cues: ['턱을 당기고 갈비뼈를 닫습니다', '정점에서 둔근을 1초 조입니다', '무릎은 90도를 유지'],
    mistakes: ['허리를 젖혀서 올림', '발이 너무 앞에 있음', '가동 범위가 짧음'],
  },
  'barbell-curl': {
    cues: ['팔꿈치를 옆구리에 고정합니다', '손목을 중립으로 유지', '내려올 때 더 천천히'],
    mistakes: ['몸통 반동을 씀', '팔꿈치가 앞으로 나감', '어깨로 들어올림'],
  },
  'triceps-pushdown': {
    cues: ['팔꿈치를 몸통에 붙여 고정합니다', '아래에서 완전히 폅니다', '상체를 세운 채 유지'],
    mistakes: ['팔꿈치가 벌어짐', '상체를 숙여 체중으로 누름', '가동 범위가 짧음'],
  },
  'leg-press': {
    cues: ['허리를 등받이에 붙인 채 유지합니다', '무릎을 90도 아래까지 굽힙니다', '무릎을 완전히 잠그지 않습니다'],
    mistakes: ['골반이 말려 허리가 들림', '무릎을 완전히 잠금', '가동 범위가 짧음'],
    orientation: 'seated',
  },
  plank: {
    orientation: 'prone',
    view: 'side',
    cycleSeconds: 4,
    keyframes: HOLD_KEYFRAMES,
    cues: ['팔꿈치를 어깨 바로 아래에 둡니다', '갈비뼈를 닫고 엉덩이를 조입니다', '머리부터 뒤꿈치까지 한 줄'],
    mistakes: ['허리가 꺼짐', '엉덩이가 위로 솟음', '숨을 참음'],
  },
  'side-plank': {
    orientation: 'prone',
    view: 'front',
    cycleSeconds: 4,
    keyframes: HOLD_KEYFRAMES,
    cues: ['아래쪽 어깨를 팔꿈치 위에 세웁니다', '골반을 천장 쪽으로 밀어 올립니다', '몸이 앞뒤로 기울지 않게'],
    mistakes: ['골반이 아래로 처짐', '몸이 앞으로 말림', '목이 꺾임'],
  },
  'dead-bug': {
    cues: ['허리를 바닥에 붙인 채 반대 팔다리를 뻗습니다', '천천히 — 속도가 아니라 통제가 목적입니다', '내내 숨을 내쉽니다'],
    mistakes: ['허리가 바닥에서 뜸', '너무 빠르게 반복함', '팔다리를 같은 쪽으로 움직임'],
  },
  'lateral-raise': {
    cues: ['팔꿈치를 살짝 굽힌 채 고정합니다', '어깨 높이까지만 올립니다', '새끼손가락이 살짝 위로'],
    mistakes: ['반동으로 들어올림', '승모근이 먼저 개입', '어깨 위로 과하게 올림'],
  },
};

/** 동작 패턴의 한국어 이름 — 화면과 시연 제목에 쓴다. */
export const PATTERN_LABELS_KO: Record<MovementPattern, string> = {
  horizontalPush: '수평 밀기',
  verticalPush: '수직 밀기',
  horizontalPull: '수평 당기기',
  verticalPull: '수직 당기기',
  squat: '스쿼트',
  hinge: '힌지',
  lunge: '런지',
  isolation: '고립',
  carry: '캐리',
  core: '코어',
};

/* ── 조회 ─────────────────────────────────────────────── */

/**
 * 종목의 시연 데이터.
 * 종목별 오버라이드가 있으면 그것을, 없으면 패턴 기본값을 쓴다.
 */
export function demoFor(exercise: Exercise): ExerciseDemo {
  const pattern = PATTERN_DEMOS[exercise.pattern];
  const override = OVERRIDES[exercise.id] ?? {};

  return {
    exerciseId: exercise.id,
    name: exercise.name,
    pattern: exercise.pattern,
    // 실제 에셋이 붙기 전까지는 절차적 애니메이션으로 자리를 채운다.
    source: 'procedural',
    orientation: override.orientation ?? pattern.orientation,
    view: override.view ?? pattern.view,
    cycleSeconds: override.cycleSeconds ?? pattern.cycleSeconds,
    keyframes: override.keyframes ?? pattern.keyframes,
    cues: override.cues ?? pattern.cues,
    mistakes: override.mistakes ?? pattern.mistakes,
  };
}

/** 종목별 맞춤 큐가 작성된 종목 수 — 콘텐츠 진척을 재는 데 쓴다. */
export function demoCoverage(exercises: readonly Exercise[]): {
  total: number;
  withOverride: number;
  byPattern: Record<string, number>;
} {
  const byPattern: Record<string, number> = {};
  for (const exercise of exercises) {
    byPattern[exercise.pattern] = (byPattern[exercise.pattern] ?? 0) + 1;
  }
  return {
    total: exercises.length,
    withOverride: exercises.filter((exercise) => OVERRIDES[exercise.id]).length,
    byPattern,
  };
}

/** 키프레임 사이를 보간한 자세. 렌더러가 매 프레임 부른다. */
export function poseAt(demo: ExerciseDemo, t: number): Required<Pose> {
  const clamped = wrap(t);
  const frames = demo.keyframes;

  let previous = frames[0]!;
  let next = frames[frames.length - 1]!;
  for (let i = 0; i < frames.length - 1; i += 1) {
    if (clamped >= frames[i]!.t && clamped <= frames[i + 1]!.t) {
      previous = frames[i]!;
      next = frames[i + 1]!;
      break;
    }
  }

  const span = next.t - previous.t;
  const raw = span <= 0 ? 0 : (clamped - previous.t) / span;
  // 양 끝에서 부드럽게 — 실제 동작도 등속이 아니다.
  const eased = raw * raw * (3 - 2 * raw);

  const keys: (keyof Pose)[] = ['spine', 'hip', 'knee', 'ankle', 'shoulder', 'elbow', 'split', 'rootY'];
  const pose = {} as Required<Pose>;
  for (const key of keys) {
    const from = previous.pose[key] ?? 0;
    const to = next.pose[key] ?? 0;
    pose[key] = from + (to - from) * eased;
  }
  return pose;
}

/**
 * 0~1 주기로 접는다.
 * ((t % 1) + 1) % 1 은 0.45 를 0.4499999… 로 만들어 키프레임 경계를 놓친다.
 */
function wrap(t: number): number {
  if (t >= 0 && t < 1) return t;
  const wrapped = t % 1;
  return wrapped < 0 ? wrapped + 1 : wrapped;
}

/** 지금 구간의 라벨 — 화면에 "최저점" 같은 글자를 띄운다. */
export function labelAt(demo: ExerciseDemo, t: number): string | undefined {
  const clamped = wrap(t);
  let label: string | undefined;
  for (const frame of demo.keyframes) {
    // 1.45 % 1 은 0.4499…로 떨어진다. 그 오차만큼 경계를 열어두지 않으면
    // 두 번째 주기부터 키프레임의 말이 한 박자씩 늦게 뜬다.
    if (frame.t <= clamped + EPSILON && frame.label) label = frame.label;
  }
  return label;
}

const EPSILON = 1e-9;
