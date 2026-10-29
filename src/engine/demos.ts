import type { Exercise, MovementPattern } from './types.ts';

/**
 * 운동 시연의 글 — 수행 큐와 흔한 실수.
 *
 * 움직이는 그림은 motions.ts가 종목마다 따로 만든다. 여기는 화면 아래에 붙는 말과, PT 코치가
 * 세트 전에 짚는 큐만 둔다. 종목별로 따로 적은 것이 없으면 동작 패턴의 기본 큐를 쓴다.
 */
export type DemoSource = 'procedural' | 'video' | 'model3d';

export interface ExerciseDemo {
  exerciseId: string;
  name: string;
  pattern: MovementPattern;
  source: DemoSource;
  /** 수행 큐 — 하면서 떠올릴 것 */
  cues: string[];
  /** 흔한 실수 */
  mistakes: string[];
  /** 실제 촬영 영상이나 3D 에셋이 붙을 자리 */
  assetUrl?: string;
}

/* ── 패턴별 기본 동작 ──────────────────────────────────── */

interface PatternDemo {
  cues: string[];
  mistakes: string[];
}

const PATTERN_DEMOS: Record<MovementPattern, PatternDemo> = {
  squat: {
    cues: ['가슴을 세운 채 상체 각도를 유지합니다', '무릎이 발끝 방향을 따라 벌어지게', '뒤꿈치로 바닥을 밀어 올라옵니다'],
    mistakes: ['무릎이 안쪽으로 무너짐', '뒤꿈치가 들림', '엉덩이만 먼저 올라오고 상체가 따라옴'],
  },
  hinge: {
    cues: ['고관절을 뒤로 밀며 내려갑니다', '등을 편 상태를 끝까지 유지', '바를 다리에 붙여 움직입니다'],
    mistakes: ['등이 말림', '무릎을 굽혀 스쿼트처럼 됨', '바가 몸에서 멀어짐'],
  },
  horizontalPush: {
    cues: ['견갑을 모아 고정하고 가슴을 들어올립니다', '바를 명치 아래로 내립니다', '발로 바닥을 밀어 전신 긴장을 유지'],
    mistakes: ['어깨가 앞으로 말림', '바가 목 쪽으로 내려옴', '허리가 과하게 들림'],
  },
  verticalPush: {
    cues: ['갈비뼈를 닫고 복부에 힘을 준 채 밀어올립니다', '바가 지나가도록 머리를 살짝 뒤로', '팔꿈치를 완전히 폅니다'],
    mistakes: ['허리를 젖혀서 밀어냄', '바가 몸 앞으로 나감', '어깨가 으쓱 올라간 채 시작'],
  },
  horizontalPull: {
    cues: ['견갑을 먼저 모으고 팔이 따라옵니다', '상체 각도를 끝까지 고정', '배꼽 쪽으로 당깁니다'],
    mistakes: ['상체를 세우며 반동을 씀', '팔로만 당김', '어깨가 앞으로 말린 채 시작'],
  },
  verticalPull: {
    cues: ['견갑을 아래로 내리며 시작합니다', '팔꿈치를 옆구리 쪽으로 당깁니다', '내려올 때도 힘을 유지'],
    mistakes: ['반동으로 올라감', '가동 범위를 반만 씀', '어깨가 귀에 붙은 채 매달림'],
  },
  lunge: {
    cues: ['상체를 세운 채 수직으로 내려갑니다', '앞발 뒤꿈치로 밀어 올라옵니다', '뒷무릎이 바닥에 닿기 직전까지'],
    mistakes: ['앞무릎이 안쪽으로 무너짐', '상체가 앞으로 쏠림', '보폭이 너무 좁음'],
  },
  isolation: {
    cues: ['목표 근육 외에는 움직이지 않습니다', '수축 지점에서 잠깐 멈춥니다', '내려올 때 더 천천히'],
    mistakes: ['몸통 반동을 씀', '가동 범위를 반만 씀', '중량이 무거워 자세가 무너짐'],
  },
  core: {
    cues: ['허리를 바닥에 붙인 채 유지합니다', '복부로 당기고 다리는 따라옵니다', '호흡을 멈추지 않습니다'],
    mistakes: ['허리가 바닥에서 뜸', '목으로 당김', '반동을 씀'],
  },
  carry: {
    cues: ['가슴을 세우고 어깨를 내립니다', '작은 보폭으로 빠르게', '복부에 힘을 유지'],
    mistakes: ['어깨가 앞으로 말림', '보폭이 너무 큼', '몸이 좌우로 흔들림'],
  },
};

/* ── 종목별 큐와 실수 ──────────────────────────────────── */

interface DemoOverride {
  cues?: string[];
  mistakes?: string[];
}

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
  },
  plank: {
    cues: ['팔꿈치를 어깨 바로 아래에 둡니다', '갈비뼈를 닫고 엉덩이를 조입니다', '머리부터 뒤꿈치까지 한 줄'],
    mistakes: ['허리가 꺼짐', '엉덩이가 위로 솟음', '숨을 참음'],
  },
  'side-plank': {
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
    // 실제 에셋이 붙기 전까지는 절차적 애니메이션(motions.ts)으로 자리를 채운다.
    source: 'procedural',
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
