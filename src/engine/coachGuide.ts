/**
 * 코치가 종목을 말로 알려 준다 — 기구 사용법(자리 잡기), 동작 방법, 흔한 실수.
 *
 * 내용은 모든 코치가 같이 쓴다(setupGuide · demos · mistakes). 앞뒤 말만 그 코치 말투다 —
 * 빡센 코치는 "제대로 알려 준다", 유머 코치는 "1분 강의 시작합니다". 동작 시연 화면의
 * "코치 목소리로 듣기"와, PT에서 처음 하는 종목 앞에서 쓴다.
 *
 * 실수는 두 개까지만 — 다섯 개를 들으면 하나도 안 남는다.
 */
import type { CoachStyle } from './coach.ts';
import { demoFor } from './demos.ts';
import { mistakesFor } from './mistakes.ts';
import { setupFor } from './setupGuide.ts';
import type { Exercise } from './types.ts';

type ByStyle<T> = Readonly<Record<CoachStyle, T>>;

const INTRO: ByStyle<(name: string) => string> = {
  energetic: (name) => `${name}! 제가 쉽게 알려 줄게요!`,
  gentle: (name) => `${name}, 하는 법을 차근차근 알려 드리겠습니다.`,
  tough: (name) => `${name}. 제대로 알려 준다. 잘 들어.`,
  fun: (name) => `${name}. 일 분 강의 시작합니다. 졸면 안 돼요.`,
};

const SETUP_HEAD: ByStyle<string> = {
  energetic: '먼저 자리부터 잡아요!',
  gentle: '먼저 자리를 잡겠습니다.',
  tough: '먼저 자리 잡고.',
  fun: '먼저 기구랑 자리부터 맞춰요.',
};

const MOVE_HEAD: ByStyle<string> = {
  energetic: '동작은 이렇게 해요!',
  gentle: '동작은 이렇게 하시면 됩니다.',
  tough: '동작은 이렇게.',
  fun: '자, 이제 본론이에요.',
};

const MISTAKE_HEAD: ByStyle<string> = {
  energetic: '이것만 조심해요!',
  gentle: '이 부분은 조심하시면 좋습니다.',
  tough: '이건 하지 마.',
  fun: '다들 한 번씩 하는 실수예요.',
};

const OUTRO: ByStyle<string> = {
  energetic: '이제 해 볼까요? 할 수 있어요!',
  gentle: '천천히, 가벼운 무게로 먼저 해 보시죠.',
  tough: '알았지? 가벼운 무게로 먼저 감 잡아.',
  fun: '강의 끝! 가벼운 무게로 먼저 연습해요. 시험은 없어요.',
};

function sentence(text: string): string {
  const trimmed = text.trim();
  return /[.!?]$/.test(trimmed) ? trimmed : trimmed + '.';
}

/** 종목 하나를 말로 — 자리 잡기(있으면) → 동작 포인트 → 흔한 실수 두 개 → 마무리. */
export function exerciseGuideLines(style: CoachStyle, exercise: Exercise): string[] {
  const lines = [INTRO[style](exercise.name)];
  const setup = setupFor(exercise);
  if (setup.length > 0) {
    lines.push(SETUP_HEAD[style]);
    for (const step of setup) lines.push(sentence(step));
  }
  const cues = demoFor(exercise).cues;
  if (cues.length > 0) {
    lines.push(MOVE_HEAD[style]);
    for (const cue of cues) lines.push(sentence(cue));
  }
  const mistakes = mistakesFor(exercise).slice(0, 2);
  if (mistakes.length > 0) {
    lines.push(MISTAKE_HEAD[style]);
    for (const mistake of mistakes) lines.push(sentence(mistake.sign), sentence(mistake.cue));
  }
  lines.push(OUTRO[style]);
  return lines;
}

/* ── 쉬는 동안 다음 운동 미리 듣기 (PT) ─────────────────── */

const PREVIEW_HEAD: ByStyle<string> = {
  energetic: '쉬는 동안 하는 법 미리 볼게요!',
  gentle: '쉬시는 동안 하는 법을 미리 알려 드리겠습니다.',
  tough: '쉬는 동안 하는 법 듣고 가.',
  fun: '쉬는 시간 예습 들어갑니다.',
};

export interface RestGuide {
  /** 잡는 법 · 자리 — 동작 설명 첫 줄 */
  grip: string | null;
  /** 동작 핵심 — 둘째 줄 */
  move: string | null;
  /** 흔한 실수 하나 — 무엇이 잘못되는지(sign)와 고치는 말(fix · short) */
  mistake: { sign: string; fix: string; short: string } | null;
}

/** 화면에 띄울 세 줄 — 잡는 법, 동작 핵심, 흔한 실수 하나. */
export function restGuideFor(exercise: Exercise): RestGuide {
  const cues = demoFor(exercise).cues;
  const first = mistakesFor(exercise)[0];
  return {
    grip: cues[0] ?? null,
    move: cues[1] ?? null,
    mistake: first ? { sign: first.sign, fix: first.cue, short: first.short } : null,
  };
}

/**
 * 쉬는 동안 PT가 다음 운동을 말로 — "다음 종목, ○○!"(이동 안내) 뒤에 붙는다.
 * 잡는 법 → 동작 핵심 → 흔한 실수 하나. 20초 안쪽이라 쉬는 시간을 다 잡아먹지 않는다.
 * 매번 한다 — 익숙한 종목도 자세는 쉬는 동안 한 번 더 듣는 게 낫다.
 */
export function restGuideLines(style: CoachStyle, exercise: Exercise): string[] {
  const guide = restGuideFor(exercise);
  const lines = [PREVIEW_HEAD[style]];
  if (guide.grip) lines.push(sentence(guide.grip));
  if (guide.move) lines.push(sentence(guide.move));
  if (guide.mistake) lines.push(MISTAKE_HEAD[style], sentence(guide.mistake.fix));
  return lines;
}
