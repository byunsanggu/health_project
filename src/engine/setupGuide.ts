/**
 * 사용법 — 처음 하는 종목 앞에서 하는 말.
 *
 * 동작 포인트(demos.ts)는 "어떻게 움직이나"다. 여기는 그 전, **"어떻게
 * 자리를 잡나"**다. 시트 높이, 발 위치, 손잡이, 핀. PT 첫날 트레이너가
 * 제일 먼저 하는 말이 이것이고, 혼자 온 사람이 기계 앞에서 제일 오래
 * 서 있는 이유도 이것이다.
 *
 * 세 가지를 지킨다.
 *   1. **두세 마디.** 기계 앞에서 귀로 듣는 말이다. 다섯 개를 말하면
 *      세 번째부터 안 들린다.
 *   2. **처음 한 번만.** 매번 들으면 다음 날 PT 모드를 끈다. 두 번째부터는
 *      사용자가 적어 둔 세팅("시트 4")을 대신 말한다.
 *   3. **진단처럼 들리는 말은 넣지 않는다.** 자리 잡는 법까지만 한다.
 *
 * 이 문구는 초안이다. 현장 20년의 말로 바꿔 넣는 자리가 여기다.
 */
import type { Equipment, Exercise } from './types.ts';

export const SETUP_GUIDE: Readonly<Record<string, readonly string[]>> = {
  // 가슴
  'barbell-bench-press': ['눈이 바 바로 아래 오게 눕습니다', '어깨를 모아 벤치에 고정하고 발은 바닥에', '손은 어깨너비보다 한 뼘 넓게'],
  'dumbbell-bench-press': ['덤벨을 허벅지에 올리고 앉습니다', '누우면서 무릎으로 덤벨을 밀어 올려 시작 자세로'],
  'machine-chest-press': ['손잡이가 가슴 중간 높이에 오게 시트를 맞춥니다', '등과 머리를 등받이에 붙입니다'],
  'incline-dumbbell-press': ['등받이를 30도쯤, 두세 칸만 세웁니다', '덤벨을 허벅지에서 밀어 올려 시작합니다'],
  'push-up': ['손은 어깨 바로 아래, 어깨너비보다 조금 넓게', '머리부터 발뒤꿈치까지 일자로'],
  'cable-fly': ['도르래를 어깨 높이에 맞춥니다', '한 발 앞으로 내딛고 손잡이를 양손에'],
  'pec-deck': ['손잡이가 가슴 높이에 오게 시트를 맞춥니다', '팔꿈치를 살짝 굽힌 채 시작합니다'],
  'incline-barbell-press': ['등받이를 30도쯤으로 맞춥니다', '바가 눈 위에 오게 눕고 어깨를 모읍니다'],
  'decline-barbell-press': ['발걸이에 다리를 단단히 겁니다', '바가 눈 위에 오게 눕습니다'],
  'chest-dip': ['평행봉을 잡고 팔을 펴서 몸을 띄웁니다', '상체를 앞으로 살짝 숙입니다'],
  'smith-bench-press': ['바가 가슴 아래쪽으로 떨어지게 벤치 위치를 맞춥니다', '안전 고리 높이를 가슴보다 조금 위로'],
  'low-to-high-cable-fly': ['도르래를 가장 아래로 내립니다', '한 발 앞으로 내딛고 손잡이를 아래에서 잡습니다'],
  'floor-press': ['바닥에 누워 무릎을 세웁니다', '팔꿈치가 바닥에 닿을 때까지가 한 번입니다'],
  'close-grip-bench-press': ['손은 어깨너비로, 평소보다 좁게', '팔꿈치를 몸 쪽으로 붙여 내립니다'],

  // 어깨
  'barbell-overhead-press': ['랙 높이를 쇄골보다 조금 아래로', '손은 어깨너비보다 조금 넓게, 바는 쇄골 위에'],
  'landmine-press': ['바 끝을 어깨 앞에서 한 손으로 잡습니다', '발은 어깨너비, 무릎은 살짝 굽힙니다'],
  'seated-dumbbell-press': ['등받이를 거의 세웁니다', '덤벨을 허벅지에서 어깨로 차 올려 시작합니다'],
  'machine-shoulder-press': ['손잡이가 어깨 높이에 오게 시트를 맞춥니다', '등을 등받이에 붙입니다'],
  'arnold-press': ['등받이를 세우고 앉습니다', '손바닥이 나를 보게 덤벨을 들고 시작합니다'],
  'machine-lateral-raise': ['어깨 관절이 기계 회전축과 맞게 시트를 맞춥니다', '팔꿈치 패드에 팔을 댑니다'],
  'lateral-raise': ['가벼운 덤벨로 시작합니다', '팔꿈치를 살짝 굽힌 채 몸 옆에 둡니다'],
  'cable-lateral-raise': ['도르래를 가장 아래로', '케이블 반대편 손으로 손잡이를 잡습니다'],
  'front-raise': ['덤벨을 허벅지 앞에 둡니다', '팔꿈치를 살짝 굽힌 채 시작합니다'],
  'cable-rear-delt-fly': ['도르래를 어깨 높이에, 케이블을 엇갈려 잡습니다', '팔을 앞으로 뻗고 시작합니다'],
  'face-pull': ['도르래를 얼굴 높이에 맞추고 로프를 답니다', '엄지가 나를 보게 로프를 잡고 한 걸음 뒤로'],
  'reverse-pec-deck': ['손잡이가 어깨 높이에 오게 시트를 맞춥니다', '가슴을 패드에 대고 앉습니다'],
  'barbell-shrug': ['랙 높이를 허벅지 중간에', '손은 어깨너비로 바를 잡습니다'],
  'dumbbell-shrug': ['덤벨을 몸 옆에 늘어뜨립니다', '팔은 편 채로 어깨만 올립니다'],

  // 등
  'pull-up': ['손은 어깨너비보다 조금 넓게, 손등이 나를 보게', '팔을 다 펴고 매달려 시작합니다'],
  'chin-up': ['손바닥이 나를 보게, 어깨너비로 잡습니다', '팔을 다 펴고 매달려 시작합니다'],
  'assisted-pull-up': ['무게는 나를 들어 주는 양입니다 — 숫자가 클수록 쉽습니다', '무릎을 패드에 올리고 손잡이를 잡습니다'],
  'lat-pulldown': ['허벅지 패드가 다리를 꽉 누르게 높이를 맞춥니다', '바는 어깨너비보다 조금 넓게 잡습니다'],
  'neutral-grip-pulldown': ['허벅지 패드 높이를 맞춥니다', '손바닥이 마주 보는 손잡이를 답니다'],
  'barbell-row': ['바를 정강이 앞에 두고 어깨너비로 잡습니다', '무릎을 살짝 굽히고 상체를 45도쯤 숙입니다'],
  'chest-supported-row': ['가슴 패드에 가슴을 대고 손잡이가 팔 끝에 닿게 맞춥니다', '발은 발판에 단단히'],
  'seated-cable-row': ['발판에 발을 대고 무릎을 살짝 굽힙니다', '등을 세우고 손잡이를 잡습니다'],
  'one-arm-dumbbell-row': ['한쪽 손과 무릎을 벤치에 올립니다', '등을 평평하게 하고 덤벨은 어깨 아래'],
  't-bar-row': ['바 위에 서서 발은 어깨너비', '무릎을 굽히고 상체를 숙여 손잡이를 잡습니다'],
  'pendlay-row': ['바를 바닥에 두고 상체를 거의 수평으로 숙입니다', '매 회 바를 바닥에 내려놓습니다'],
  'straight-arm-pulldown': ['도르래를 가장 높이, 바나 로프를 답니다', '한 걸음 물러나 상체를 살짝 숙입니다'],

  // 하체
  'back-squat': ['랙 높이를 어깨보다 조금 아래로', '바는 승모근 위에, 손은 어깨너비보다 넓게', '안전바를 앉았을 때 바보다 조금 아래로'],
  'front-squat': ['랙 높이를 어깨보다 조금 아래로', '바를 쇄골 앞에 올리고 팔꿈치를 앞으로 듭니다'],
  'hack-squat': ['어깨 패드 아래로 들어가 등을 등받이에 붙입니다', '발은 발판 가운데 어깨너비', '안전 손잡이를 풀고 시작합니다'],
  'leg-press': ['등과 엉덩이를 등받이에 붙입니다', '발은 발판 가운데 어깨너비', '안전 손잡이를 풀고 시작합니다'],
  'smith-squat': ['바가 어깨에 오게 고리 높이를 맞춥니다', '발은 바보다 반 걸음 앞에'],
  'goblet-squat': ['덤벨 한쪽 끝을 두 손으로 가슴 앞에 받칩니다', '발은 어깨너비보다 조금 넓게'],
  'walking-lunge': ['덤벨을 몸 옆에 듭니다', '걸어갈 공간을 먼저 확인합니다'],
  'bulgarian-split-squat': ['벤치에서 한 걸음 반 떨어져 섭니다', '뒷발 등을 벤치에 올립니다'],
  'step-up': ['무릎 높이쯤 되는 박스나 벤치를 씁니다', '한 발을 통째로 올려 둡니다'],
  'leg-extension': ['무릎이 기계 회전축과 맞게 등받이를 맞춥니다', '발목 패드는 발목 바로 위에'],
  'lying-leg-curl': ['무릎이 패드 끝에 걸리게 엎드립니다', '발목 패드는 아킬레스건 바로 위에'],
  'seated-leg-curl': ['무릎이 회전축과 맞게 등받이를 맞춥니다', '허벅지 패드를 내려 다리를 고정합니다'],
  'standing-calf-raise': ['어깨 패드 높이를 맞춥니다', '발 앞꿈치만 발판 끝에 올립니다'],
  'seated-calf-raise': ['무릎 패드가 허벅지를 누르게 높이를 맞춥니다', '발 앞꿈치를 발판 끝에'],
  'leg-press-calf-raise': ['레그프레스에 앉아 발 앞꿈치만 발판 아래쪽 끝에', '안전 손잡이는 걸어 둔 채 시작합니다'],

  // 엉덩이 · 뒤쪽
  'conventional-deadlift': ['바가 발 중간 위에 오게 섭니다', '발은 골반너비, 손은 다리 바로 바깥'],
  'romanian-deadlift': ['랙에서 바를 들고 섭니다', '무릎은 살짝만 굽힌 채 고정합니다'],
  'stiff-leg-deadlift': ['바를 들고 섭니다', '무릎을 거의 편 채 고정합니다'],
  'sumo-deadlift': ['발을 넓게, 발끝은 바깥으로', '손은 다리 안쪽에서 어깨너비로'],
  'good-morning': ['바를 승모근 위에 올립니다', '무릎은 살짝 굽힌 채 고정합니다'],
  'hip-thrust': ['날개뼈 아래가 벤치 모서리에 걸리게 앉습니다', '바에 패드를 감아 골반 위에 올립니다'],
  'machine-hip-thrust': ['등 패드에 날개뼈 아래를 댑니다', '골반 벨트나 패드를 골반 위에 맞춥니다'],
  'cable-pull-through': ['도르래를 가장 아래로, 로프를 답니다', '케이블을 등지고 다리 사이로 로프를 잡습니다'],
  'back-extension': ['패드 위쪽이 골반 바로 아래에 오게 맞춥니다', '발목을 발걸이에 겁니다'],

  // 팔
  'barbell-curl': ['손은 어깨너비, 손바닥이 앞을 보게', '팔꿈치를 옆구리에 붙입니다'],
  'incline-dumbbell-curl': ['등받이를 45도쯤으로', '팔을 몸 뒤로 늘어뜨리고 시작합니다'],
  'hammer-curl': ['손바닥이 마주 보게 덤벨을 듭니다', '팔꿈치를 옆구리에 붙입니다'],
  'preacher-curl': ['겨드랑이가 패드 위에 닿게 시트를 맞춥니다', '팔 뒤쪽을 패드에 붙입니다'],
  'cable-curl': ['도르래를 가장 아래로, 바나 로프를 답니다', '팔꿈치를 옆구리에 붙입니다'],
  'concentration-curl': ['벤치에 앉아 팔꿈치를 허벅지 안쪽에 댑니다'],
  'wrist-curl': ['벤치에 앉아 팔뚝을 허벅지에 올립니다', '손목만 벤치 끝 밖으로'],
  'triceps-pushdown': ['도르래를 가장 높이, 바나 로프를 답니다', '팔꿈치를 옆구리에 붙입니다'],
  'overhead-cable-extension': ['도르래를 가장 아래로, 로프를 답니다', '케이블을 등지고 로프를 머리 뒤로'],
  'skull-crusher': ['벤치에 누워 바를 가슴 위로 듭니다', '팔꿈치를 천장 쪽으로 고정합니다'],
  'triceps-dip': ['평행봉을 잡고 몸을 띄웁니다', '상체를 세운 채 시작합니다'],
  'triceps-kickback': ['한쪽 손과 무릎을 벤치에 올립니다', '위팔을 몸통과 나란히 고정합니다'],

  // 복근 · 기타
  'hanging-leg-raise': ['어깨너비로 매달립니다', '몸이 흔들리지 않게 멈춘 뒤 시작합니다'],
  'cable-crunch': ['도르래를 가장 높이, 로프를 답니다', '무릎을 꿇고 로프를 머리 옆에 붙입니다'],
  'plank': ['팔꿈치는 어깨 바로 아래', '머리부터 발뒤꿈치까지 일자로'],
  'side-plank': ['팔꿈치를 어깨 바로 아래에 둡니다', '발을 포개고 골반을 듭니다'],
  'ab-wheel-rollout': ['무릎 아래 매트를 깝니다', '바퀴를 무릎 앞에 두고 시작합니다'],
  'dead-bug': ['누워서 팔은 천장으로, 무릎은 90도로 듭니다', '허리를 바닥에 붙입니다'],
  'farmers-walk': ['덤벨을 몸 옆에 듭니다', '걸어갈 길을 먼저 비워 둡니다'],

  // 머신 (3차)
  'machine-incline-chest-press': ['손잡이가 윗가슴 높이에 오게 시트를 맞춥니다', '등과 머리를 등받이에 붙입니다'],
  'machine-high-row': ['허벅지 패드가 다리를 누르게 높이를 맞춥니다', '가슴을 세우고 위쪽 손잡이를 잡습니다'],
  'machine-rear-delt-raise': ['손잡이가 어깨 높이에 오게 시트를 맞춥니다', '가슴을 패드에 대고 팔을 앞으로 뻗습니다'],
  'v-squat': ['기계를 마주 보고 어깨 패드 아래로 들어갑니다', '발은 발판 가운데 어깨너비', '안전 손잡이를 풀고 시작합니다'],
  'machine-triceps-dip': ['손잡이가 몸 옆 갈비뼈 높이에 오게 시트를 맞춥니다', '등을 등받이에 붙이고 어깨를 내립니다'],
  'machine-preacher-curl': ['겨드랑이가 패드 위에 닿게 시트를 맞춥니다', '팔꿈치를 회전축과 맞춥니다'],
};

/** 표에 없는 종목은 기구 종류로 말한다. 아무 말 안 하는 것보다 낫다. */
const BY_EQUIPMENT: Record<Equipment, readonly string[]> = {
  barbell: ['바 가운데에 서서 손 간격을 양쪽 똑같이 맞춥니다', '원판 고정 클립을 꼭 끼웁니다'],
  dumbbell: ['가벼운 무게로 한 번 움직여 보고 시작합니다'],
  machine: ['손잡이나 패드가 관절 높이에 오게 시트를 맞춥니다', '핀이 끝까지 들어갔는지 확인합니다'],
  cable: ['도르래 높이를 먼저 맞춥니다', '핀이 끝까지 들어갔는지 확인합니다'],
  smith: ['고리 높이와 안전 고리를 먼저 맞춥니다'],
  bodyweight: ['주변 공간을 먼저 확인합니다'],
  band: ['밴드가 단단히 걸렸는지 당겨 보고 시작합니다'],
};

export function setupFor(exercise: Exercise): readonly string[] {
  return SETUP_GUIDE[exercise.id] ?? BY_EQUIPMENT[exercise.equipment] ?? [];
}

/**
 * 세팅을 적어 둘 만한 종목인가.
 *
 * 시트 높이나 도르래 칸이 있는 기구만이다. 덤벨에 "세팅"을 적으라고
 * 하면 쓸데없는 칸이 하나 느는 것이다. 바벨은 랙 높이가 있는 종목만.
 */
const RACK_LIFTS = new Set([
  'back-squat', 'front-squat', 'barbell-overhead-press', 'barbell-shrug',
  'romanian-deadlift', 'barbell-bench-press', 'incline-barbell-press',
  'decline-barbell-press', 'close-grip-bench-press',
]);

export function hasSetting(exercise: Exercise): boolean {
  if (exercise.equipment === 'machine' || exercise.equipment === 'cable' || exercise.equipment === 'smith') {
    return true;
  }
  return RACK_LIFTS.has(exercise.id);
}

/** 세팅 예시 — 빈칸에 깔아 두는 글. 뭘 적으라는 건지 모르면 아무도 안 적는다. */
export function settingPlaceholder(exercise: Exercise): string {
  if (exercise.equipment === 'cable') return '예: 도르래 12칸';
  if (exercise.equipment === 'smith') return '예: 고리 7번 · 안전 3번';
  if (exercise.equipment === 'barbell') return '예: 랙 9번 · 안전바 5번';
  return '예: 시트 4 · 등받이 2';
}

/** 적어 둔 세팅의 열쇠. 헬스장 · 종목 · 기계가 다 같아야 같은 세팅이다. */
export function settingKey(gymId: string, exerciseId: string, machine?: string): string {
  return [gymId || 'gym', exerciseId, machine || 'a'].join('|');
}

/** 너무 긴 세팅은 자른다 — 소리로 읽는 글이다. */
export const SETTING_MAX = 30;

export function cleanSetting(raw: string): string {
  return (raw ?? '').replace(/\s+/g, ' ').trim().slice(0, SETTING_MAX);
}
