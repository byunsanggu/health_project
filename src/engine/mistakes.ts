import type { Exercise, MovementPattern } from './types.ts';

/**
 * 회원이 흔히 하는 실수와 그때 트레이너가 하는 말.
 *
 * 시연 화면의 "흔한 실수"는 무엇이 틀렸는지만 말했다. 현장에서 트레이너는
 * 틀린 걸 보면 **바로 고치는 말**을 한다 — "무릎 안으로 모였어요"가 아니라
 * "무릎을 발끝 방향으로 밀어 주세요". 그리고 아무 때나 하지 않는다.
 * 무거울 때, 지칠 때(마지막 세트), 처음 할 때, 그 사람이 늘 하던 실수일 때
 * 한다. PT 모드가 그 자리에서 이 말을 쓴다.
 *
 * 말은 전부 존댓말이다. 빡센 말투는 끝에 느낌표만 붙는다.
 */
export interface CommonMistake {
  id: string;
  /** 회원이 알아보는 모습 — "무릎이 안으로 모여요" */
  sign: string;
  /** 고치는 말 — 세트 전에 한다. "~세요"로 끝나고 문장부호는 붙이지 않는다 */
  cue: string;
  /** 세트 중 숫자 사이에 끼는 짧은 말 — 뒤에 "요." 또는 "!"가 붙는다 */
  short: string;
  /** 왜 고쳐야 하나 — 안내 화면에 한 줄 */
  why: string;
  /** 무거울 때 · 지칠 때 특히 나오는가 */
  underLoad?: boolean;
}

const m = (
  id: string, sign: string, cue: string, short: string, why: string, underLoad = false,
): CommonMistake => ({ id, sign, cue, short, why, underLoad });

/* ── 하체 · 스쿼트 ─────────────────────────────── */
const KNEE_CAVE = m('knee-cave', '무릎이 안으로 모여요', '무릎을 발끝 방향으로 밀어 주세요', '무릎은 바깥으로', '무릎 안쪽 인대에 부담이 갑니다', true);
const HEELS_UP = m('heels-up', '뒤꿈치가 들려요', '뒤꿈치로 바닥을 누르세요', '뒤꿈치로', '무게가 앞으로 쏠려 무릎과 허리가 받습니다');
const TORSO_LEAN = m('torso-lean', '상체가 너무 숙여져요', '가슴을 세우고 시선은 정면에 두세요', '가슴은 앞으로', '허리가 하체 대신 무게를 받습니다', true);
const BUTT_WINK = m('butt-wink', '맨 아래에서 허리가 말려요', '깊이를 조금 줄이고 배에 힘을 꽉 주세요', '배에 힘 주고', '허리 디스크에 부담이 갑니다', true);
const HIPS_FIRST = m('hips-first', '올라올 때 엉덩이만 먼저 올라와요', '가슴과 엉덩이가 같이 올라오게 하세요', '가슴도 같이', '스쿼트가 허리 운동이 됩니다', true);
const PAD_OFF = m('pad-off', '등과 엉덩이가 패드에서 떨어져요', '등과 엉덩이를 패드에 붙인 채로 하세요', '등은 패드에', '허리가 말리면서 기계가 허리를 누릅니다', true);
const KNEE_LOCK = m('knee-lock', '끝에서 무릎을 쫙 펴서 잠가요', '끝까지 펴지 말고 살짝 굽힌 채로 멈추세요', '무릎 잠그지 말고', '무릎 관절이 무게를 그대로 받습니다');
const PRESS_BUTT_UP = m('butt-lift', '내려갈 때 엉덩이가 시트에서 떠요', '엉덩이가 뜨기 직전까지만 내리세요', '엉덩이는 시트에', '허리가 말리며 디스크를 누릅니다', true);
const ELBOWS_DROP = m('elbows-drop', '팔꿈치가 떨어져요', '팔꿈치를 높게 들어 주세요', '팔꿈치 높게', '바가 앞으로 구르며 상체가 숙여집니다', true);
const GOBLET_LEAN = m('goblet-lean', '덤벨이 몸에서 떨어지며 상체가 숙여져요', '덤벨을 가슴에 붙이고 가슴을 세우세요', '덤벨은 가슴에', '허리가 무게를 받습니다');

/* ── 런지 ──────────────────────────────────────── */
const LUNGE_KNEE = m('knee-cave', '앞무릎이 안으로 모여요', '앞무릎을 발끝 방향으로 유지하세요', '무릎은 발끝 방향으로', '무릎 안쪽 인대에 부담이 갑니다', true);
const LUNGE_LEAN = m('torso-lean', '상체가 앞으로 쏠려요', '상체를 세우고 앞발 뒤꿈치로 미세요', '상체 세우고', '무릎과 허리가 받습니다');
const LUNGE_BACK = m('back-leg', '뒷발로 밀어서 올라와요', '앞발 뒤꿈치로 바닥을 밀며 올라오세요', '앞발로', '운동하려던 앞다리가 쉽니다');

/* ── 힌지 ──────────────────────────────────────── */
const ROUND_BACK = m('round-back', '등이 둥글게 말려요', '가슴을 펴고 등을 평평하게 유지하세요', '등은 평평하게', '허리 부상이 가장 많이 나오는 자세입니다', true);
const BAR_AWAY = m('bar-away', '바가 몸에서 멀어져요', '바를 다리에 붙여서 쓸어 올리세요', '바는 몸에 붙여서', '멀어질수록 허리가 받는 무게가 커집니다', true);
const LEAN_BACK_TOP = m('lean-back', '끝에서 허리를 뒤로 젖혀요', '끝에서는 엉덩이만 조이고 뒤로 젖히지 마세요', '끝에서 엉덩이만', '허리 뒤쪽 관절이 눌립니다');
const HIPS_SHOOT = m('hips-first', '바보다 엉덩이가 먼저 올라가요', '가슴과 엉덩이가 같이 올라오게 하세요', '가슴도 같이', '다리 힘을 못 쓰고 허리로 듭니다', true);
const SQUATTING = m('squatting', '무릎을 너무 굽혀 스쿼트처럼 돼요', '무릎은 살짝만 굽히고 엉덩이를 뒤로 빼세요', '엉덩이 뒤로', '뒤허벅지 대신 앞허벅지로 들게 됩니다');
const TOO_DEEP_HINGE = m('too-deep', '너무 깊이 내려가요', '뒤허벅지가 당기는 데까지만 내리세요', '당기는 데까지만', '그 아래로는 허리가 말리면서 내려갑니다', true);
const THRUST_ARCH = m('arch', '허리를 젖혀서 들어 올려요', '갈비뼈를 내리고 엉덩이로 밀어 올리세요', '엉덩이로', '엉덩이 근육 대신 허리가 일합니다');
const THRUST_CHIN = m('chin-up', '턱이 들리며 머리가 뒤로 젖혀져요', '턱을 당기고 시선은 무릎 쪽에 두세요', '턱 당기고', '목과 허리가 같이 젖혀집니다');
const EXT_HYPER = m('hyper', '올라올 때 허리를 과하게 젖혀요', '몸이 일자가 되면 멈추세요', '일자에서 멈추고', '허리 뒤쪽 관절이 눌립니다');
const KB_SQUAT = m('squat-swing', '스쿼트처럼 앉았다 일어나요', '엉덩이를 뒤로 접었다가 튕기듯 펴세요', '엉덩이 뒤로', '스윙의 힘이 엉덩이가 아니라 다리에서 나옵니다');
const KB_ARMS = m('arms-lift', '팔로 들어 올려요', '팔은 줄처럼 두고 엉덩이로 튕기세요', '엉덩이로', '어깨를 다칩니다');

/* ── 가슴 프레스 ───────────────────────────────── */
const BENCH_BUTT = m('butt-off', '밀 때 엉덩이가 벤치에서 떠요', '엉덩이는 벤치에 붙인 채로 미세요', '엉덩이는 벤치에', '허리가 과하게 꺾입니다', true);
const PRESS_SHRUG = m('shoulders-up', '어깨가 들려요', '날개뼈를 모아서 벤치에 박으세요', '어깨는 내리고', '어깨 앞쪽이 끼면서 통증이 잘 생깁니다', true);
const ELBOW_FLARE = m('elbow-flare', '팔꿈치가 옆으로 쫙 벌어져요', '팔꿈치를 몸통에서 45도 정도로 모으세요', '팔꿈치는 45도로', '어깨 관절에 부담이 가장 큰 각도입니다');
const BOUNCE = m('bounce', '가슴에서 튕겨 올려요', '가슴 바로 위에서 살짝 멈췄다가 미세요', '튕기지 말고', '반동이 가슴 대신 일을 합니다');
const WRIST_BACK = m('wrist-back', '손목이 뒤로 꺾여요', '바를 손바닥 아래쪽에 두고 손목을 세우세요', '손목은 세워서', '손목이 무게를 받아 통증이 납니다');
const SHOULDERS_ROLL = m('shoulders-roll', '어깨가 앞으로 말려요', '가슴을 내밀고 어깨는 뒤로 고정하세요', '가슴 내밀고', '가슴 대신 어깨 앞쪽으로 밀게 됩니다');
const SEAT_HEIGHT = m('seat', '손잡이가 가슴보다 너무 높거나 낮아요', '손잡이가 가슴 중간에 오게 시트를 맞추세요', '손잡이는 가슴 높이로', '높이가 틀리면 어깨가 일을 합니다');
const HIPS_SAG = m('hips-sag', '허리가 아래로 처져요', '배에 힘을 주고 몸을 일자로 유지하세요', '몸은 일자로', '허리가 꺾이며 허리에 부담이 갑니다', true);
const DIP_DEEP = m('too-deep', '어깨가 너무 깊이 내려가요', '어깨가 팔꿈치보다 살짝 낮을 때까지만 내리세요', '깊이는 적당히', '어깨 앞쪽이 과하게 늘어나 다칩니다', true);
const FLY_ARMS = m('arm-angle', '팔꿈치를 굽혔다 폈다 해요', '팔꿈치 각도는 고정하고 크게 안는다는 느낌으로 하세요', '팔꿈치는 고정하고', '플라이가 프레스가 되며 가슴 자극이 줄어듭니다');
const FLY_SHRUG = m('shoulders-up', '어깨로 모아요', '어깨는 내리고 가슴으로 모으세요', '어깨는 내리고', '가슴 대신 어깨 앞쪽이 일합니다');

/* ── 어깨 프레스 ───────────────────────────────── */
const OHP_ARCH = m('arch', '허리를 젖혀서 밀어요', '엉덩이를 조이고 배에 힘을 주세요', '배에 힘 주고', '허리 뒤쪽이 눌립니다', true);
const OHP_FORWARD = m('bar-forward', '바가 얼굴 앞으로 나가요', '바는 얼굴 가까이 수직으로 올리세요', '바는 수직으로', '어깨가 앞쪽 무게를 버티게 됩니다');
const SEATED_ARCH = m('arch', '등받이에서 허리가 떠요', '등을 등받이에 붙이고 미세요', '등은 등받이에', '어깨 운동이 가슴 운동이 되고 허리가 꺾입니다', true);
const PRESS_HALF = m('half-rep', '조금만 내렸다 올려요', '귀 높이까지는 내렸다가 미세요', '귀 높이까지', '가동 범위의 반만 근육이 일합니다');

/* ── 당기기 ────────────────────────────────────── */
const PULL_LEAN = m('lean-back', '몸을 뒤로 젖혀서 당겨요', '상체는 살짝만 기울이고 가슴으로 당기세요', '상체는 고정하고', '등 대신 반동이 일을 합니다', true);
const PULL_ARMS = m('arms', '팔로만 당겨요', '팔꿈치를 옆구리로 내린다는 느낌으로 당기세요', '팔꿈치로', '등보다 팔이 먼저 지칩니다');
const PULL_SHRUG = m('shoulders-up', '어깨가 귀 쪽으로 올라가요', '어깨부터 내리고 당기세요', '어깨 먼저 내리고', '승모가 대신 일하고 목이 뻐근해집니다');
const KIP = m('kip', '반동으로 올라가요', '다리를 고정하고 반동 없이 올라가세요', '반동 없이', '등 자극이 줄고 어깨를 다칩니다', true);
const HALF_HANG = m('half-rep', '끝까지 안 내려와요', '팔이 다 펴질 때까지 내려왔다가 올라가세요', '끝까지 내려와서', '가동 범위의 반만 근육이 일합니다');
const ROW_STAND = m('stand-up', '당길 때 상체가 일어나요', '상체 각도를 고정한 채 당기세요', '상체 각도는 그대로', '로우가 반동 운동이 됩니다', true);
const ROW_ROCK = m('rocking', '몸을 앞뒤로 흔들어요', '상체는 세운 채 고정하고 팔꿈치만 뒤로 보내세요', '몸 흔들지 말고', '허리 반동이 등 대신 일합니다', true);
const ROW_TWIST = m('twist', '몸통이 돌아가요', '몸통은 바닥과 평행하게 두고 팔꿈치만 뒤로 보내세요', '몸통은 고정하고', '허리가 비틀리며 등 자극이 줄어듭니다');
const CHEST_OFF = m('chest-off', '가슴이 패드에서 떨어져요', '가슴을 패드에 붙인 채로 당기세요', '가슴은 패드에', '반동이 들어가 등 자극이 줄어듭니다');
const ROW_ELBOW = m('elbow-path', '팔꿈치가 옆으로 벌어져요', '팔꿈치를 엉덩이 쪽으로 당기세요', '팔꿈치는 엉덩이 쪽으로', '넓은 등 대신 어깨 뒤쪽이 일합니다');
const STRAIGHT_BEND = m('bend', '팔꿈치를 굽혀서 당겨요', '팔꿈치는 살짝만 굽힌 채 고정하세요', '팔은 고정하고', '등 대신 삼두가 일합니다');

/* ── 어깨 고립 ─────────────────────────────────── */
const RAISE_SHRUG = m('shrug', '어깨가 으쓱 올라가요', '어깨를 내린 채 팔꿈치로 밀어 올리세요', '어깨는 내리고', '측면 어깨 대신 승모가 일합니다');
const RAISE_SWING = m('swing', '몸을 흔들어서 올려요', '몸은 고정하고 무게를 조금 줄이세요', '반동 없이', '어깨 대신 반동이 일합니다', true);
const RAISE_HIGH = m('too-high', '팔을 어깨보다 높이 올려요', '어깨 높이까지만 올리세요', '어깨 높이까지', '어깨가 끼면서 통증이 생깁니다');
const REAR_TRAPS = m('traps', '날개뼈를 모으며 등으로 당겨요', '어깨를 내리고 팔을 옆으로 벌린다는 느낌으로 하세요', '팔은 옆으로', '뒤쪽 어깨 대신 등이 일합니다');
const SHRUG_ROLL = m('roll', '어깨를 돌려요', '돌리지 말고 위아래로만 올리세요', '위아래로만', '자극은 없고 어깨만 상합니다');
const FACE_PULL_LOW = m('too-low', '줄을 가슴 쪽으로 당겨요', '줄을 얼굴 높이로, 손이 귀 옆에 오게 당기세요', '얼굴 높이로', '뒤쪽 어깨 대신 등이 일합니다');

/* ── 팔 ────────────────────────────────────────── */
const CURL_SWING = m('swing', '몸을 흔들어서 올려요', '팔꿈치를 옆구리에 고정하고 팔만 굽히세요', '팔꿈치는 고정하고', '이두 대신 허리 반동이 일합니다', true);
const CURL_DROP = m('drop', '내릴 때 툭 떨어뜨려요', '내릴 때 2초 정도 버티며 천천히 내리세요', '천천히 내려서', '내리는 구간의 자극을 버리게 됩니다');
const CURL_ELBOW = m('elbow-forward', '올릴 때 팔꿈치가 앞으로 나가요', '팔꿈치 위치는 그대로 두세요', '팔꿈치는 그대로', '어깨가 끼어들어 이두 자극이 줄어듭니다');
const PREACHER_BOUNCE = m('bottom-bounce', '맨 아래에서 튕겨 올려요', '끝까지 펴되 아래에서 튕기지 마세요', '튕기지 말고', '팔꿈치 힘줄이 다칩니다', true);
const PUSHDOWN_ELBOW = m('elbow-move', '팔꿈치가 앞뒤로 움직여요', '팔꿈치를 옆구리에 붙이고 아래팔만 움직이세요', '팔꿈치는 옆구리에', '삼두 대신 어깨와 몸통이 누릅니다');
const PUSHDOWN_LEAN = m('lean', '상체를 숙여서 체중으로 눌러요', '상체를 세우고 팔로만 미세요', '상체 세우고', '삼두 자극이 줄어듭니다', true);
const EXT_FLARE = m('elbow-flare', '팔꿈치가 옆으로 벌어져요', '팔꿈치를 안쪽으로 모은 채로 하세요', '팔꿈치 모으고', '삼두 대신 어깨가 일하고 팔꿈치가 아픕니다');
const TRI_DIP_LEAN = m('lean', '상체가 앞으로 숙여져요', '상체를 세우고 팔꿈치를 뒤로 접으세요', '상체 세우고', '삼두 대신 가슴과 어깨가 일합니다');

/* ── 하체 고립 ─────────────────────────────────── */
const EXT_HIPS = m('hips-up', '엉덩이가 들려요', '손잡이를 잡고 엉덩이를 시트에 붙이세요', '엉덩이는 시트에', '앞허벅지 자극이 빠져나갑니다');
const EXT_KICK = m('kick', '발로 차고 툭 떨어뜨려요', '끝에서 1초 멈추고 천천히 내리세요', '끝에서 멈추고', '무릎에 충격이 가고 자극은 줄어듭니다');
const LEG_CURL_HIPS = m('hips-up', '엉덩이가 들려요', '골반을 패드에 눌러 고정하세요', '골반은 패드에', '허리가 꺾이고 뒤허벅지 자극이 줄어듭니다', true);
const CALF_SHORT = m('short-range', '조금만 움직여요', '끝까지 내렸다가 끝까지 올라가세요', '끝까지', '종아리는 가동 범위가 짧으면 거의 안 자랍니다');
const CALF_BOUNCE = m('bounce', '아래에서 통통 튕겨요', '맨 아래에서 1초 멈췄다가 올라가세요', '아래서 멈추고', '힘줄 반동이 근육 대신 일합니다');
const HIP_SWING = m('swing', '상체를 흔들며 밀어요', '상체는 등받이에 붙이고 다리만 움직이세요', '상체는 고정하고', '엉덩이 근육 대신 반동이 일합니다');
const KICKBACK_ARCH = m('arch', '허리를 젖혀서 차요', '배에 힘을 주고 엉덩이로만 미세요', '엉덩이로', '허리가 꺾입니다');
const GHR_BEND = m('hips-bend', '엉덩이가 접혀요', '무릎부터 어깨까지 일자로 유지하세요', '몸은 일자로', '뒤허벅지 대신 허리가 일합니다');

/* ── 코어 ──────────────────────────────────────── */
const PLANK_HIGH = m('hips-high', '엉덩이가 너무 높아요', '머리부터 뒤꿈치까지 일자로 맞추세요', '몸은 일자로', '복근이 일하지 않습니다');
const BREATH = m('breath', '숨을 참아요', '숨은 계속 쉬면서 버티세요', '숨 쉬면서', '혈압이 오르고 오래 못 버팁니다');
const LEG_RAISE_SWING = m('swing', '몸이 그네처럼 흔들려요', '흔들림이 멈춘 뒤 천천히 올리세요', '천천히', '반동이 복근 대신 일합니다');
const LEG_RAISE_HIPS = m('legs-only', '다리만 올라가요', '다리를 올릴 때 골반을 말아 올리세요', '골반 말아서', '고관절만 일하고 복근은 안 씁니다');
const CRUNCH_HIPS = m('hips', '엉덩이를 내려 앉으면서 당겨요', '엉덩이는 고정하고 배를 말아서 내려가세요', '배로 말아서', '복근 대신 체중으로 당기게 됩니다');
const ROLLOUT_SAG = m('hips-sag', '굴러 나갈 때 허리가 처져요', '허리가 처지기 전까지만 나가세요', '허리 처지기 전까지', '허리에 큰 부담이 갑니다', true);
const NECK_PULL = m('neck', '목을 당겨요', '턱과 가슴 사이에 주먹 하나 공간을 두세요', '목은 편하게', '목이 아픕니다');
const DEADBUG_BACK = m('back-arch', '허리가 바닥에서 떠요', '허리를 바닥에 눌러 붙인 채로 하세요', '허리는 바닥에', '복근이 일하지 않고 허리가 꺾입니다');
const SIDE_HIPS = m('hips-drop', '엉덩이가 내려가요', '엉덩이를 들어 몸을 일자로 맞추세요', '엉덩이 들고', '옆구리 근육이 일하지 않습니다');
const ROTATE_SWING = m('swing', '반동으로 휙 돌려요', '천천히 돌리고 끝에서 멈추세요', '천천히', '허리가 비틀리며 다칩니다');
const CARRY_LEAN = m('lean', '몸이 한쪽으로 기울어요', '어깨를 수평으로 두고 배에 힘을 주세요', '어깨 수평으로', '허리 한쪽에 부담이 몰립니다');

/**
 * 종목별 흔한 실수. 앞에 둘수록 더 흔하고 더 위험하다.
 * 여기 없는 종목은 동작 패턴의 기본 목록을 쓴다.
 */
export const MISTAKES: Record<string, readonly CommonMistake[]> = {
  // 스쿼트
  'back-squat': [KNEE_CAVE, BUTT_WINK, HEELS_UP, HIPS_FIRST],
  'front-squat': [ELBOWS_DROP, KNEE_CAVE, HEELS_UP],
  'goblet-squat': [GOBLET_LEAN, KNEE_CAVE, HEELS_UP],
  'smith-squat': [KNEE_CAVE, BUTT_WINK, HEELS_UP],
  'hack-squat': [PAD_OFF, KNEE_CAVE, KNEE_LOCK],
  'v-squat': [PAD_OFF, KNEE_CAVE, KNEE_LOCK],
  'pendulum-squat': [PAD_OFF, KNEE_CAVE, KNEE_LOCK],
  'belt-squat': [KNEE_CAVE, TORSO_LEAN, HEELS_UP],
  'leg-press': [PRESS_BUTT_UP, KNEE_LOCK, KNEE_CAVE],
  // 런지
  'walking-lunge': [LUNGE_KNEE, LUNGE_LEAN, LUNGE_BACK],
  'bulgarian-split-squat': [LUNGE_KNEE, LUNGE_BACK, LUNGE_LEAN],
  'step-up': [LUNGE_BACK, LUNGE_KNEE],
  // 힌지
  'conventional-deadlift': [ROUND_BACK, BAR_AWAY, HIPS_SHOOT, LEAN_BACK_TOP],
  'sumo-deadlift': [ROUND_BACK, KNEE_CAVE, HIPS_SHOOT],
  'trap-bar-deadlift': [ROUND_BACK, HIPS_SHOOT, LEAN_BACK_TOP],
  'romanian-deadlift': [SQUATTING, ROUND_BACK, BAR_AWAY, TOO_DEEP_HINGE],
  'stiff-leg-deadlift': [ROUND_BACK, TOO_DEEP_HINGE, BAR_AWAY],
  'good-morning': [ROUND_BACK, TOO_DEEP_HINGE],
  'hip-thrust': [THRUST_ARCH, THRUST_CHIN],
  'machine-hip-thrust': [THRUST_ARCH, THRUST_CHIN],
  'back-extension': [EXT_HYPER, ROUND_BACK],
  'cable-pull-through': [SQUATTING, KB_ARMS],
  'kettlebell-swing': [KB_SQUAT, KB_ARMS, ROUND_BACK],
  // 가슴
  'barbell-bench-press': [PRESS_SHRUG, BENCH_BUTT, ELBOW_FLARE, BOUNCE, WRIST_BACK],
  'incline-barbell-press': [PRESS_SHRUG, ELBOW_FLARE, BENCH_BUTT],
  'decline-barbell-press': [ELBOW_FLARE, BOUNCE],
  'close-grip-bench-press': [ELBOW_FLARE, WRIST_BACK],
  'smith-bench-press': [PRESS_SHRUG, ELBOW_FLARE, BENCH_BUTT],
  'floor-press': [ELBOW_FLARE, WRIST_BACK],
  'dumbbell-bench-press': [PRESS_SHRUG, ELBOW_FLARE, BENCH_BUTT],
  'incline-dumbbell-press': [PRESS_SHRUG, ELBOW_FLARE, BENCH_BUTT],
  'machine-chest-press': [SHOULDERS_ROLL, SEAT_HEIGHT, ELBOW_FLARE],
  'machine-incline-chest-press': [SHOULDERS_ROLL, SEAT_HEIGHT],
  'push-up': [HIPS_SAG, ELBOW_FLARE],
  'chest-dip': [DIP_DEEP, PRESS_SHRUG],
  'cable-fly': [FLY_ARMS, FLY_SHRUG],
  'pec-deck': [FLY_SHRUG, FLY_ARMS],
  'low-to-high-cable-fly': [FLY_ARMS, FLY_SHRUG],
  // 어깨
  'barbell-overhead-press': [OHP_ARCH, OHP_FORWARD],
  'landmine-press': [OHP_ARCH],
  'seated-dumbbell-press': [SEATED_ARCH, PRESS_HALF],
  'machine-shoulder-press': [SEATED_ARCH, PRESS_HALF],
  'arnold-press': [SEATED_ARCH, PRESS_HALF],
  'lateral-raise': [RAISE_SHRUG, RAISE_SWING, RAISE_HIGH],
  'cable-lateral-raise': [RAISE_SHRUG, RAISE_SWING],
  'machine-lateral-raise': [RAISE_SHRUG, RAISE_HIGH],
  'front-raise': [RAISE_SWING, RAISE_HIGH],
  'face-pull': [FACE_PULL_LOW, REAR_TRAPS],
  'reverse-pec-deck': [REAR_TRAPS, RAISE_SHRUG],
  'cable-rear-delt-fly': [REAR_TRAPS, RAISE_SWING],
  'machine-rear-delt-raise': [REAR_TRAPS, RAISE_SHRUG],
  'barbell-shrug': [SHRUG_ROLL],
  'dumbbell-shrug': [SHRUG_ROLL],
  // 등
  'lat-pulldown': [PULL_LEAN, PULL_ARMS, PULL_SHRUG],
  'neutral-grip-pulldown': [PULL_LEAN, PULL_ARMS, PULL_SHRUG],
  'pull-up': [KIP, HALF_HANG, PULL_SHRUG],
  'chin-up': [KIP, HALF_HANG, PULL_SHRUG],
  'assisted-pull-up': [HALF_HANG, PULL_SHRUG],
  'barbell-row': [ROW_STAND, ROUND_BACK, ROW_ELBOW],
  'pendlay-row': [ROUND_BACK, ROW_STAND],
  't-bar-row': [ROW_STAND, ROUND_BACK, ROW_ELBOW],
  'seated-cable-row': [ROW_ROCK, PULL_SHRUG, PULL_ARMS],
  'one-arm-dumbbell-row': [ROW_TWIST, PULL_SHRUG],
  'chest-supported-row': [CHEST_OFF, PULL_SHRUG],
  'machine-high-row': [CHEST_OFF, PULL_SHRUG],
  'straight-arm-pulldown': [STRAIGHT_BEND, PULL_SHRUG],
  // 팔
  'barbell-curl': [CURL_SWING, CURL_DROP, CURL_ELBOW],
  'cable-curl': [CURL_SWING, CURL_ELBOW],
  'hammer-curl': [CURL_SWING, CURL_DROP],
  'incline-dumbbell-curl': [CURL_ELBOW, CURL_DROP],
  'concentration-curl': [CURL_DROP],
  'preacher-curl': [PREACHER_BOUNCE, CURL_DROP],
  'machine-preacher-curl': [PREACHER_BOUNCE, CURL_DROP],
  'wrist-curl': [CURL_DROP],
  'triceps-pushdown': [PUSHDOWN_ELBOW, PUSHDOWN_LEAN],
  'overhead-cable-extension': [EXT_FLARE, OHP_ARCH],
  'skull-crusher': [EXT_FLARE, CURL_DROP],
  'triceps-kickback': [PUSHDOWN_ELBOW, CURL_DROP],
  'machine-triceps-extension': [PUSHDOWN_ELBOW, EXT_FLARE],
  'triceps-dip': [TRI_DIP_LEAN, DIP_DEEP],
  'machine-triceps-dip': [TRI_DIP_LEAN, PRESS_SHRUG],
  // 하체 고립
  'leg-extension': [EXT_HIPS, EXT_KICK],
  'lying-leg-curl': [LEG_CURL_HIPS, CURL_DROP],
  'seated-leg-curl': [LEG_CURL_HIPS, CURL_DROP],
  'standing-calf-raise': [CALF_SHORT, CALF_BOUNCE],
  'seated-calf-raise': [CALF_SHORT, CALF_BOUNCE],
  'leg-press-calf-raise': [CALF_SHORT, CALF_BOUNCE],
  'machine-hip-abduction': [HIP_SWING],
  'machine-hip-adduction': [HIP_SWING],
  'machine-glute-kickback': [KICKBACK_ARCH],
  'glute-ham-raise': [GHR_BEND],
  // 코어
  'plank': [HIPS_SAG, PLANK_HIGH, BREATH],
  'side-plank': [SIDE_HIPS, BREATH],
  'hanging-leg-raise': [LEG_RAISE_SWING, LEG_RAISE_HIPS],
  'captains-chair-knee-raise': [LEG_RAISE_HIPS, LEG_RAISE_SWING],
  'cable-crunch': [CRUNCH_HIPS, NECK_PULL],
  'machine-crunch': [NECK_PULL, CRUNCH_HIPS],
  'decline-sit-up': [NECK_PULL],
  'ab-wheel-rollout': [ROLLOUT_SAG],
  'dead-bug': [DEADBUG_BACK],
  'torso-rotation': [ROTATE_SWING],
  'farmers-walk': [CARRY_LEAN],
};

/** 종목별 목록이 없을 때 동작 패턴의 기본. */
const BY_PATTERN: Partial<Record<MovementPattern, readonly CommonMistake[]>> = {
  squat: [KNEE_CAVE, HEELS_UP, TORSO_LEAN],
  lunge: [LUNGE_KNEE, LUNGE_LEAN],
  hinge: [ROUND_BACK, BAR_AWAY],
  horizontalPush: [PRESS_SHRUG, ELBOW_FLARE],
  verticalPush: [SEATED_ARCH, PRESS_HALF],
  verticalPull: [PULL_LEAN, PULL_SHRUG],
  horizontalPull: [ROW_ROCK, PULL_SHRUG],
  isolation: [RAISE_SWING, CURL_DROP],
  core: [BREATH],
  carry: [CARRY_LEAN],
};

export function mistakesFor(exercise: Pick<Exercise, 'id' | 'pattern'>): readonly CommonMistake[] {
  return MISTAKES[exercise.id] ?? BY_PATTERN[exercise.pattern] ?? [];
}

/** 왜 이 실수를 짚는가 — 말의 앞머리가 달라진다. */
export type MistakeMoment = 'flagged' | 'heavy' | 'first' | 'lastSet';

/**
 * 이번 세트에 짚을 실수 하나.
 *
 * 하나만 고른다. 세 개를 말하면 셋 다 잊는다. 회원이 스스로 체크한
 * 실수가 제일 먼저고, 그다음이 무거울 때 · 지칠 때 나오는 실수다.
 */
export function mistakeToWatch(input: {
  exercise: Pick<Exercise, 'id' | 'pattern'>;
  setIndex: number;
  totalSets: number;
  /** 회원이 "나도 이래요"를 누른 실수 */
  flagged?: readonly string[];
  /** 바로 앞 세트가 "무거웠어요"였는가 */
  afterHeavy?: boolean;
  /** 처음 하는 종목인가 */
  firstTime?: boolean;
}): { mistake: CommonMistake; moment: MistakeMoment } | null {
  const list = mistakesFor(input.exercise);
  if (list.length === 0) return null;
  const rotate = <T>(items: readonly T[]): T => items[input.setIndex % items.length] as T;

  const flagged = list.filter((item) => input.flagged?.includes(item.id));
  // 체크한 실수는 첫 세트와 마지막 세트에 — 매 세트 같은 말을 들으면 잔소리가 된다.
  const isLast = input.setIndex === input.totalSets - 1 && input.totalSets > 1;
  if (flagged.length > 0 && (input.setIndex === 0 || isLast || input.afterHeavy)) {
    return { mistake: rotate(flagged), moment: 'flagged' };
  }

  const loaded = list.filter((item) => item.underLoad);
  if (input.afterHeavy) return { mistake: rotate(loaded.length ? loaded : list), moment: 'heavy' };
  if (input.firstTime && input.setIndex === 0) return { mistake: list[0]!, moment: 'first' };
  if (isLast && input.totalSets >= 3 && loaded.length > 0) return { mistake: rotate(loaded), moment: 'lastSet' };
  return null;
}
