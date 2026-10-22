import type { CoachStyle } from './coach.ts';
import { hasFinalConsonant } from './korean.ts';
import { weightLabelIn } from './units.ts';
import type { MuscleGroup } from './types.ts';

/**
 * PT 세션 — 세트가 아니라 50분을 이끈다.
 *
 * 세트 하나를 잘 세어 주는 것과 PT는 다르다. 트레이너는 들어오면 워밍업을
 * 시키고, 종목이 끝나면 다음 기구로 데려가고, 시간이 밀리면 뒤를 줄이고,
 * 끝나면 스트레칭까지 시킨다. 여기서는 그 사이사이에 하는 말과 판단만
 * 만든다. 무게와 횟수는 여기서 정하지 않는다.
 *
 * PT를 받기 싫은 사람은 혼자 모드를 쓴다. 여기 있는 것은 PT 모드에서만 돈다.
 */

/** "레그프레스예요" / "랫 풀다운이에요" — 받침에 따라. */
function isPolite(word: string): string {
  return word + (hasFinalConsonant(word) ? '이에요' : '예요');
}

/** "시트 4번이었어요" / "4였어요" */
function wasPolite(word: string): string {
  return word + (hasFinalConsonant(word) ? '이었어요' : '였어요');
}

function load(weightKg: number, pounds?: boolean): string {
  return weightKg > 0 ? weightLabelIn(weightKg, Boolean(pounds)) : '맨몸';
}

/* ── 워밍업 ─────────────────────────────────────── */

export interface PtWarmupStep {
  weightKg: number;
  reps: number;
  restSeconds: number;
}

/** 워밍업 세트 하나 전에 하는 말. 첫 세트면 몇 세트인지도 말한다. */
export function warmupSetLine(
  style: CoachStyle,
  exerciseName: string,
  index: number,
  steps: readonly PtWarmupStep[],
  pounds?: boolean,
): string {
  const step = steps[index]!;
  const what = `${load(step.weightKg, pounds)} ${step.reps}개`;
  if (index === 0) {
    if (style === 'data') return `${exerciseName} 워밍업 ${steps.length}세트. 1번, ${what}.`;
    if (style === 'fired') return `${exerciseName}, 워밍업부터 갑니다. ${steps.length}세트, 첫 번째 ${what}!`;
    return `${exerciseName} 워밍업 ${steps.length}세트 할게요. 첫 번째, ${what}요.`;
  }
  const last = index === steps.length - 1;
  if (style === 'data') return `워밍업 ${index + 1}번, ${what}.`;
  if (style === 'fired') return `${last ? '마지막 워밍업' : '다음'}, ${what}!`;
  return `${last ? '마지막 워밍업이에요' : '다음은'}, ${what}요.`;
}

/** 워밍업 사이 쉬는 말. */
export function warmupRestLine(style: CoachStyle, seconds: number): string {
  if (style === 'data') return `${seconds}초 휴식.`;
  if (style === 'fired') return `좋습니다. ${seconds}초 쉬고 올립니다.`;
  return `좋아요. ${seconds}초 쉬고 조금 올릴게요.`;
}

/** 워밍업이 끝나고 본세트로. */
export function warmupDoneLine(style: CoachStyle): string {
  if (style === 'data') return '워밍업 종료. 본세트.';
  if (style === 'fired') return '몸 다 풀렸습니다. 이제 본세트 갑니다!';
  return '워밍업 끝났어요. 이제 본세트 할게요.';
}

/* ── 세트 사이 휴식 ─────────────────────────────── */

/** "40초" / "1분" / "1분 30초" — 트레이너가 말하는 대로. */
export function restSpoken(seconds: number): string {
  const total = Math.max(0, Math.round(seconds / 5) * 5);
  if (total < 60) return `${total}초`;
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return rest === 0 ? `${minutes}분` : `${minutes}분 ${rest}초`;
}

/**
 * 세트가 끝나고 얼마나 쉬는지 먼저 말한다.
 *
 * 쉬는 시간을 모르고 쉬면 계속 화면을 보게 된다. "1분 30초 쉬고 3세트"를
 * 듣고 나면 물 마시러 가도 된다. 처음 한 번은 더 쉬는 법도 같이 알려 준다
 * — PT는 시간이 되면 알아서 시작하니까, 더 쉬고 싶은 사람이 멈출 줄 알아야 한다.
 */
export function restAnnounceLine(
  style: CoachStyle,
  input: { seconds: number; nextSet: number; firstTime?: boolean; nextName?: string },
): string {
  const time = restSpoken(input.seconds);
  // 슈퍼세트면 다음이 짝 종목이다 — "2세트"만 말하면 같은 종목을 또 하는 줄 안다
  const what = input.nextName ? `${input.nextName} ${input.nextSet}세트` : `${input.nextSet}세트`;
  let line: string;
  if (style === 'data') line = `휴식 ${time}. 다음 ${what}.`;
  else if (style === 'fired') line = `${time} 쉬고 ${what} 올립니다!`;
  else line = `${time} 쉬고 ${what} 갈게요.`;
  if (!input.firstTime) return line;
  if (style === 'data') return `${line} 연장은 +30초.`;
  return `${line} 더 쉬고 싶으면 화면에서 +30초 누르세요.`;
}

/* ── 종목 이동 ─────────────────────────────────── */

/** 다음 기구로 걸어가서 자리 잡는 데 주는 최소 시간. */
export const TRANSITION_REST_SECONDS = 75;

export function transitionLines(style: CoachStyle, input: {
  nextName: string;
  /** 지난번에 적어 둔 기계 세팅 */
  machineSetting?: string | null;
  /** 처음 하는 종목이면 세팅을 같이 보자고 한다 */
  firstTime?: boolean;
  seconds: number;
}): string[] {
  const time = input.seconds >= 60 && input.seconds % 60 === 0
    ? `${input.seconds / 60}분`
    : `${input.seconds}초`;
  const lines: string[] = [];
  if (style === 'data') {
    lines.push(`다음 ${input.nextName}. 이동 ${time}.`);
    if (input.machineSetting) lines.push(`세팅 ${input.machineSetting}.`);
    return lines;
  }
  lines.push(style === 'fired' ? `다음은 ${input.nextName}입니다!` : `다음은 ${isPolite(input.nextName)}.`);
  if (input.machineSetting) {
    lines.push(style === 'fired' ? `세팅은 ${input.machineSetting}입니다.` : `세팅은 ${wasPolite(input.machineSetting)}.`);
  } else if (input.firstTime) {
    lines.push(style === 'fired' ? '처음 하는 기구입니다. 가서 세팅부터 봅니다.' : '처음 하시는 기구라 가서 세팅부터 같이 볼게요.');
  }
  lines.push(style === 'fired'
    ? `${time} 드립니다. 물 마시고 자리 잡으세요.`
    : `${time} 드릴게요. 물 한 모금 하고 자리 잡아요.`);
  return lines;
}

/* ── 시간 관리 ─────────────────────────────────── */

export interface PaceLift {
  name: string;
  /** 고립 종목인가 — 줄일 때 먼저 줄인다 */
  isolation: boolean;
  /** 아직 안 한 세트 수 */
  remainingSets: number;
  /** 세트 하나에 드는 시간(수행 + 휴식, 초) */
  secondsPerSet: number;
  /** 이 아래로는 줄이지 않는다. 지금 하고 있는 종목은 남은 세트 그대로 둔다 */
  minSets?: number;
}

export interface PaceCheck {
  /** 이대로 가면 정한 시간보다 몇 초 넘는가 (음수면 여유) */
  overSeconds: number;
  /** 종목별로 뺄 세트 수 — 줄일 게 없으면 빈 배열 */
  trims: { index: number; removeSets: number }[];
}

/** 이만큼은 넘어도 그냥 간다. 1~2분 때문에 세트를 빼면 오히려 손해다. */
export const PACE_TOLERANCE_SECONDS = 4 * 60;

/**
 * 정한 시간 안에 끝나는가. 아니면 무엇을 줄이나.
 *
 * 뒤 종목부터, 고립 종목부터 한 세트씩 뺀다. 남은 종목은 지우지 않는다 —
 * 고립은 1세트, 복합은 2세트까지는 남긴다. 트레이너도 시간이 밀리면
 * 뒤를 줄이지 종목을 통째로 날리지는 않는다.
 */
export function paceCheck(input: {
  elapsedSeconds: number;
  plannedSeconds: number;
  lifts: readonly PaceLift[];
}): PaceCheck {
  const remaining = input.lifts.reduce((sum, lift) => sum + lift.remainingSets * lift.secondsPerSet, 0);
  const overSeconds = Math.round(input.elapsedSeconds + remaining - input.plannedSeconds);
  if (overSeconds <= PACE_TOLERANCE_SECONDS) return { overSeconds, trims: [] };

  const left = input.lifts.map((lift) => lift.remainingSets);
  const floor = (lift: PaceLift) => lift.minSets ?? (lift.isolation ? 1 : 2);
  let toCut = overSeconds;
  for (const isolationPass of [true, false]) {
    for (let i = input.lifts.length - 1; i >= 0 && toCut > 0; i -= 1) {
      const lift = input.lifts[i]!;
      if (lift.isolation !== isolationPass) continue;
      while (toCut > 0 && left[i]! > floor(lift)) {
        left[i]! -= 1;
        toCut -= lift.secondsPerSet;
      }
    }
  }
  const trims = input.lifts
    .map((lift, index) => ({ index, removeSets: lift.remainingSets - left[index]! }))
    .filter((trim) => trim.removeSets > 0);
  return { overSeconds, trims };
}

/** 줄였을 때 하는 말. */
export function trimLine(style: CoachStyle, trimmed: readonly { name: string; sets: number }[]): string {
  const what = trimmed.map((item) => `${item.name} ${item.sets}세트`).join(', ');
  if (style === 'data') return `시간 초과 예상. 조정: ${what}.`;
  if (style === 'fired') return `시간이 좀 밀렸습니다. ${what}로 줄이고 그만큼 집중합니다.`;
  return `시간이 조금 밀렸어요. ${what}만 할게요. 무리하지 말고 가요.`;
}

/** 중간 점검. 이미 한 말은 다시 하지 않도록 열쇠를 같이 돌려준다. */
export function timeCheck(style: CoachStyle, input: {
  elapsedSeconds: number;
  plannedSeconds: number;
  said: readonly string[];
}): { key: string; line: string } | null {
  const elapsedMin = Math.floor(input.elapsedSeconds / 60);
  const leftMin = Math.round((input.plannedSeconds - input.elapsedSeconds) / 60);
  if (!input.said.includes('half') && input.elapsedSeconds >= input.plannedSeconds / 2) {
    if (style === 'data') return { key: 'half', line: `${elapsedMin}분 경과, 절반.` };
    if (style === 'fired') return { key: 'half', line: `${elapsedMin}분 지났습니다. 절반 왔습니다. 여기서부터 차이가 납니다!` };
    return { key: 'half', line: `${elapsedMin}분 지났어요. 절반 왔어요.` };
  }
  if (!input.said.includes('last10') && leftMin <= 10 && leftMin > 2 && input.said.includes('half')) {
    if (style === 'data') return { key: 'last10', line: `잔여 ${leftMin}분.` };
    if (style === 'fired') return { key: 'last10', line: `${leftMin}분 남았습니다. 다 쏟고 갑니다!` };
    return { key: 'last10', line: `${leftMin}분 남았어요. 조금만 더 힘내요.` };
  }
  return null;
}

/* ── 몸 풀기 (운동 시작) ───────────────────────── */

/*
 * 종목마다 워밍업 세트를 네 개씩 밟는 대신, 시작에 5분 몸을 푼다.
 *
 * **움직이는 스트레칭(동적)이다.** 30초씩 가만히 늘리는 스트레칭은 근육을
 * 잠깐 느슨하게 만들어 첫 세트 힘이 빠진다 — 그건 끝나고 하는 것이다.
 * 시작에는 관절을 끝까지 움직여 체온을 올리고, 오늘 쓸 부위를 깨운다.
 * 그 뒤 종목 워밍업은 오늘 처음 하는 복합 동작에만 두세 세트.
 */
export interface MobilityStep extends CooldownStep {
  /** 이 기구가 있어야 하는 동작 (헬스장 기구 id). 하나라도 있으면 된다 */
  needs?: readonly string[];
  /** 바닥(매트)에서 하는 동작 */
  floor?: boolean;
  /** 이 동작을 못 할 때만 쓰는 대신 동작 (매트가 없을 때 서서 하는 것) */
  insteadOf?: string;
}

/*
 * 시작 — 체온부터. 헬스장 한가운데서 제자리 걷기는 어색하다. 유산소 기구가
 * 있으면 그걸로 2분, 없으면 바로 관절 동작으로 들어간다.
 */
const OPENERS: readonly MobilityStep[] = [
  { id: 'treadmill-walk', name: '러닝머신 빠르게 걷기', seconds: 120, cue: '경사 3에서 5, 숨이 살짝 찰 정도로 걸으세요', muscles: [], needs: ['treadmill'] },
  { id: 'bike-easy', name: '실내 사이클', seconds: 120, cue: '가볍게 밟다가 마지막 30초만 조금 빠르게', muscles: [], needs: ['stationary-bike'] },
  { id: 'row-easy', name: '로잉머신', seconds: 120, cue: '다리로 밀고 팔은 마지막에. 가볍게, 숨이 살짝 찰 정도로', muscles: [], needs: ['rowing-machine'] },
  { id: 'stairs-easy', name: '천국의 계단', seconds: 90, cue: '제일 느린 속도로. 손잡이에 기대지 말고', muscles: [], needs: ['stair-climber'] },
];

/** 폼롤러 — 있으면 오늘 제일 많이 쓸 부위 한두 곳만. 오래 굴리는 건 끝나고. */
const ROLLS: readonly MobilityStep[] = [
  { id: 'roll-upper-back', name: '폼롤러 등 위쪽', seconds: 40, cue: '날개뼈 아래에 롤러를 두고 엉덩이를 들어 위아래로 천천히', muscles: ['back', 'traps', 'rearDelt'], needs: ['foam-roller'], floor: true },
  { id: 'roll-lats', name: '폼롤러 옆구리', seconds: 40, cue: '옆으로 누워 겨드랑이 아래를 굴리세요. 아픈 곳에서 잠깐 멈추고', muscles: ['back'], sides: true, needs: ['foam-roller'], floor: true },
  { id: 'roll-quads', name: '폼롤러 앞허벅지', seconds: 40, cue: '엎드려 허벅지 앞을 무릎 위부터 골반까지 굴리세요', muscles: ['quads'], needs: ['foam-roller'], floor: true },
  { id: 'roll-glutes', name: '폼롤러 엉덩이', seconds: 40, cue: '롤러에 앉아 한쪽 발목을 반대 무릎에 올리고 굴리세요', muscles: ['glutes'], sides: true, needs: ['foam-roller'], floor: true },
  { id: 'roll-hams-calves', name: '폼롤러 뒤허벅지 · 종아리', seconds: 40, cue: '앉아서 다리 뒤쪽을 종아리부터 허벅지까지 굴리세요', muscles: ['hamstrings', 'calves'], needs: ['foam-roller'], floor: true },
  { id: 'roll-chest', name: '폼롤러 가슴 · 어깨 앞', seconds: 30, cue: '엎드려 롤러를 가슴 옆에 대고 팔을 벌린 채 좌우로 굴리세요', muscles: ['chest', 'frontDelt'], sides: true, needs: ['foam-roller'], floor: true },
];

/** 움직이는 스트레칭. 바닥 동작은 매트가 없으면 서서 하는 동작으로 바꾼다. */
const MOVES: readonly MobilityStep[] = [
  { id: 'arm-circle', name: '팔 크게 돌리기', seconds: 30, cue: '팔을 쭉 펴고 앞으로 열 번, 뒤로 열 번 크게 돌리세요', muscles: ['frontDelt', 'sideDelt', 'chest'] },
  { id: 'band-pull-apart', name: '밴드 벌리기', seconds: 30, cue: '밴드를 어깨너비로 잡고 가슴 앞에서 양옆으로 벌리세요. 날개뼈를 모으면서', muscles: ['rearDelt', 'traps', 'back'], needs: ['resistance-bands'] },
  { id: 'wy-raise', name: 'W-Y 올리기', seconds: 30, cue: '팔을 W 모양으로 당겼다가 Y 모양으로 머리 위까지 뻗으세요. 날개뼈를 모으면서', muscles: ['rearDelt', 'traps', 'back'] },
  { id: 'thoracic', name: '등 회전', seconds: 40, cue: '네발 자세에서 한 손을 머리에 대고 팔꿈치를 천장 쪽으로 돌려 여세요', sides: true, muscles: ['back', 'chest'], floor: true },
  { id: 'standing-rotation', name: '서서 몸통 돌리기', seconds: 30, insteadOf: 'thoracic', cue: '무릎을 살짝 굽히고 팔을 가슴 앞에 모아 좌우로 천천히 돌리세요. 골반은 앞을 보게', muscles: ['back', 'chest', 'abs'] },
  { id: 'cat-cow', name: '고양이 · 소 자세', seconds: 30, cue: '네발 자세에서 등을 둥글게 말았다가 천천히 내리세요. 숨과 같이', muscles: ['back', 'abs'], floor: true },
  { id: 'pushup-dog', name: '푸시업 · 다운독', seconds: 30, cue: '푸시업 자세에서 엉덩이를 높이 들었다가 다시 내려오세요', muscles: ['chest', 'triceps', 'frontDelt'], floor: true },
  { id: 'wall-pushup', name: '벽 푸시업', seconds: 30, insteadOf: 'pushup-dog', cue: '벽에 손을 짚고 가슴이 닿을 듯 천천히 열 번', muscles: ['chest', 'triceps', 'frontDelt'] },
  { id: 'wrist-elbow', name: '손목 · 팔꿈치 돌리기', seconds: 20, cue: '주먹을 쥐고 손목을 돌리고, 팔꿈치를 굽혔다 폈다 하세요', muscles: ['biceps', 'triceps', 'forearms'] },
  { id: 'bw-squat', name: '맨몸 스쿼트', seconds: 40, cue: '천천히 앉았다 일어나세요. 바닥에서 무릎을 바깥으로 밀면서', muscles: ['quads', 'glutes'] },
  { id: 'worlds-greatest', name: '런지 + 몸통 돌리기', seconds: 40, cue: '크게 런지로 앉아 앞발 쪽 팔을 하늘로 뻗으며 몸통을 여세요', sides: true, muscles: ['glutes', 'hamstrings', 'quads', 'back'] },
  { id: 'leg-swing', name: '다리 앞뒤 흔들기', seconds: 30, cue: '기둥을 잡고 다리를 앞뒤로 크게 흔드세요. 허리는 세운 채', sides: true, muscles: ['hamstrings', 'glutes'] },
  { id: 'glute-bridge', name: '힙 브릿지', seconds: 30, cue: '누워서 무릎을 세우고 엉덩이를 들어 1초 조이고 내리세요', muscles: ['glutes', 'hamstrings'], floor: true },
  { id: 'hip-hinge', name: '맨몸 힙 힌지', seconds: 30, insteadOf: 'glute-bridge', cue: '손을 골반에 두고 엉덩이를 뒤로 빼며 숙였다 일어나세요. 등은 곧게', muscles: ['glutes', 'hamstrings'] },
  { id: 'ankle-rock', name: '발목 앞뒤로 밀기', seconds: 20, cue: '벽 앞에서 무릎을 벽 쪽으로 밀었다 빼세요', sides: true, muscles: ['calves'] },
  { id: 'dead-bug', name: '데드버그', seconds: 30, cue: '누워서 팔다리를 들고, 반대쪽 팔과 다리를 천천히 뻗으세요. 허리는 바닥에', muscles: ['abs'], floor: true },
  { id: 'standing-knee', name: '서서 무릎 · 팔꿈치 닿기', seconds: 30, insteadOf: 'dead-bug', cue: '무릎을 들어 반대 팔꿈치에 닿게, 배에 힘을 주고 천천히', muscles: ['abs'] },
];

/** 몸 풀기에 쓰는 시간. */
export const MOBILITY_SECONDS = 5 * 60;

export interface MobilityOptions {
  /** 이 헬스장에 있는 기구 id. 없으면 맨몸 · 서서 하는 동작만 */
  equipment?: readonly string[];
  budgetSeconds?: number;
}

/**
 * 오늘 쓸 부위와 이 헬스장 기구로 5분을 짠다.
 *
 * 순서: 유산소 기구 2분(있으면) → 폼롤러로 제일 많이 쓸 부위 한두 곳(있으면)
 * → 움직이는 스트레칭으로 남은 시간. 매트 공간이 없으면 바닥 동작은 빼고
 * 서서 하는 동작으로 대신한다.
 */
export function mobilityFor(
  muscles: readonly MuscleGroup[],
  options: MobilityOptions | number = {},
): MobilityStep[] {
  const opts: MobilityOptions = typeof options === 'number' ? { budgetSeconds: options } : options;
  const budget = opts.budgetSeconds ?? MOBILITY_SECONDS;
  const have = new Set(opts.equipment ?? []);
  const possible = (step: MobilityStep) =>
    (!step.needs || step.needs.some((id) => have.has(id))) && (!step.floor || have.has('floor'));
  // 대신 동작은 원래 동작을 못 할 때만 — 둘 다 넣으면 같은 걸 두 번 한다
  const usable = (step: MobilityStep): boolean => {
    if (!possible(step)) return false;
    const original = step.insteadOf ? MOVES.find((move) => move.id === step.insteadOf) : undefined;
    return !original || !possible(original);
  };

  const steps: MobilityStep[] = [];
  let used = 0;
  const add = (step: MobilityStep | undefined, cap = budget) => {
    if (!step || steps.includes(step) || !usable(step) || used + step.seconds > cap) return false;
    steps.push(step);
    used += step.seconds;
    return true;
  };

  add(OPENERS.find(usable));
  // 폼롤러는 두 곳까지, 1분 20초를 넘기지 않는다
  let rolls = 0;
  for (const muscle of muscles) {
    if (rolls >= 2) break;
    if (add(ROLLS.find((roll) => roll.muscles.includes(muscle) && !steps.includes(roll)), used + 80)) rolls += 1;
  }
  for (const muscle of muscles) add(MOVES.find((move) => move.muscles.includes(muscle) && usable(move) && !steps.includes(move)));
  for (const muscle of muscles) for (const move of MOVES) if (move.muscles.includes(muscle)) add(move);
  // 기구가 없어 3분도 안 되면 몸 전체 동작으로 채운다
  for (const move of MOVES) if (used < 180) add(move);
  return steps;
}

/** 몸 풀기 전체 길이(분) — 화면과 첫마디가 같은 숫자를 말하게. */
export function mobilityMinutes(steps: readonly MobilityStep[]): number {
  return Math.max(1, Math.round(steps.reduce((sum, step) => sum + step.seconds, 0) / 60));
}

export function mobilityLine(style: CoachStyle, step: MobilityStep, index: number, total: number, minutes = 5): string {
  const head = index === 0
    ? (style === 'fired' ? `몸부터 풉니다. ${minutes}분! ` : style === 'data' ? `몸 풀기 ${minutes}분. ` : `몸부터 풀게요. ${minutes}분이에요. `)
    : '';
  // "120초"가 아니라 "2분" — 트레이너가 말하는 대로
  const time = restSpoken(step.seconds);
  if (style === 'data') return `${head}${index + 1}/${total} ${step.name} ${time}.`;
  const sides = step.sides ? ' 반쯤 지나면 반대쪽이요.' : '';
  return `${head}${step.name} ${time}. ${step.cue}.${sides}`;
}

export function mobilityDoneLine(style: CoachStyle): string {
  if (style === 'data') return '몸 풀기 종료. 운동 시작.';
  if (style === 'fired') return '몸 다 풀렸습니다. 이제 갑니다!';
  return '몸 다 풀렸어요. 이제 운동 시작할게요.';
}

/* ── 마무리 스트레칭 ───────────────────────────── */

export interface CooldownStep {
  id: string;
  name: string;
  seconds: number;
  cue: string;
  /** 한쪽씩 하는 스트레칭이면 반쯤에서 바꾸라고 말한다 */
  sides?: boolean;
  muscles: readonly MuscleGroup[];
}

const STRETCHES: readonly CooldownStep[] = [
  { id: 'chest-doorway', name: '가슴 스트레칭', seconds: 40, cue: '팔을 벽이나 기둥에 대고 몸을 반대로 돌리세요', sides: true, muscles: ['chest', 'frontDelt'] },
  { id: 'lat-hang', name: '광배 스트레칭', seconds: 40, cue: '기둥을 잡고 엉덩이를 뒤로 빼며 옆구리를 늘리세요', sides: true, muscles: ['back'] },
  { id: 'cross-arm', name: '어깨 뒤쪽 스트레칭', seconds: 30, cue: '한 팔을 가슴 앞으로 당겨 반대 팔로 누르세요', sides: true, muscles: ['rearDelt', 'sideDelt', 'traps'] },
  { id: 'triceps-overhead', name: '삼두 스트레칭', seconds: 30, cue: '팔꿈치를 머리 뒤로 접고 반대 손으로 지그시 누르세요', sides: true, muscles: ['triceps'] },
  { id: 'biceps-wall', name: '이두 · 팔 앞쪽 스트레칭', seconds: 30, cue: '손바닥을 벽에 대고 몸을 천천히 반대로 돌리세요', sides: true, muscles: ['biceps', 'forearms'] },
  { id: 'quad-stand', name: '앞허벅지 스트레칭', seconds: 40, cue: '발목을 잡아 뒤꿈치를 엉덩이 쪽으로, 무릎은 아래를 보게 하세요', sides: true, muscles: ['quads'] },
  { id: 'hamstring-reach', name: '뒤허벅지 스트레칭', seconds: 40, cue: '다리를 펴고 등을 편 채 엉덩이부터 숙이세요', sides: true, muscles: ['hamstrings'] },
  { id: 'figure-four', name: '엉덩이 스트레칭', seconds: 40, cue: '누워서 발목을 반대 무릎에 올리고 다리를 당기세요', sides: true, muscles: ['glutes'] },
  { id: 'calf-wall', name: '종아리 스트레칭', seconds: 30, cue: '벽을 밀고 뒤꿈치를 바닥에 붙인 채 몸을 앞으로 기울이세요', sides: true, muscles: ['calves'] },
  { id: 'cobra', name: '복부 스트레칭', seconds: 30, cue: '엎드려 팔로 상체를 천천히 밀어 올리세요', muscles: ['abs'] },
];

const BREATH: CooldownStep = {
  id: 'breath', name: '호흡 정리', seconds: 30,
  cue: '코로 4초 들이쉬고 입으로 6초 내쉬세요', muscles: [],
};

/** 마무리 스트레칭에 쓰는 시간. 이보다 길면 안 하고 간다. */
export const COOLDOWN_SECONDS = 4 * 60;

/**
 * 오늘 쓴 부위 위주로 4분.
 *
 * 많이 쓴 부위부터 고르고, 같은 스트레칭은 한 번만. 마지막은 호흡 30초 —
 * 심박을 내리고 끝내야 "다 했다"는 느낌으로 나간다.
 */
export function cooldownFor(
  trained: readonly MuscleGroup[],
  budgetSeconds = COOLDOWN_SECONDS,
): CooldownStep[] {
  const steps: CooldownStep[] = [];
  let used = BREATH.seconds;
  for (const muscle of trained) {
    const stretch = STRETCHES.find((item) => item.muscles.includes(muscle) && !steps.includes(item));
    if (!stretch || used + stretch.seconds > budgetSeconds) continue;
    steps.push(stretch);
    used += stretch.seconds;
  }
  return [...steps, BREATH];
}

export function cooldownLine(style: CoachStyle, step: CooldownStep, index: number, total: number): string {
  const head = index === 0
    ? (style === 'fired' ? '수고하셨습니다. 마무리 스트레칭 갑니다. ' : style === 'data' ? '쿨다운. ' : '고생하셨어요. 마무리 스트레칭 할게요. ')
    : '';
  if (style === 'data') return `${head}${index + 1}/${total} ${step.name} ${step.seconds}초.`;
  const sides = step.sides ? ' 반쯤 지나면 반대쪽으로 바꿀게요.' : '';
  return `${head}${step.name} ${step.seconds}초. ${step.cue}.${sides}`;
}

export function cooldownSwitchLine(style: CoachStyle): string {
  if (style === 'data') return '반대쪽.';
  if (style === 'fired') return '반대쪽입니다!';
  return '반대쪽으로 바꿀게요.';
}

export function cooldownDoneLine(style: CoachStyle): string {
  if (style === 'data') return '쿨다운 종료.';
  if (style === 'fired') return '오늘 PT 끝입니다. 잘 버텼습니다!';
  return '오늘 PT 끝이에요. 정말 수고 많으셨어요.';
}
