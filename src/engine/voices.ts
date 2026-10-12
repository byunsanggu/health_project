/**
 * 기기 목소리 고르기.
 *
 * 브라우저가 주는 한국어 목소리는 기기마다 여러 개고, 목록 맨 앞의 것이
 * 대개 제일 기계 같다(용량 작은 기본 목소리). 같은 폰 안에도 훨씬 자연스러운
 * 목소리가 있는 경우가 많다 — 윈도·엣지의 "Natural", 아이폰의 "향상됨/프리미엄",
 * 구글의 온라인 목소리. 그걸 먼저 고른다.
 *
 * 아이폰의 장난감 목소리(Eddy, Grandma 같은 것)는 고르지 않는다. 운동 중에
 * 할머니 목소리로 "하나 더! 마지막!!"을 들으면 웃음부터 난다.
 */

export interface VoiceLike {
  name: string;
  lang: string;
  localService?: boolean;
}

const NATURAL = /natural|neural|premium|enhanced|프리미엄|향상/i;
const NOVELTY = /eddy|flo|grandma|grandpa|reed|rocko|sandy|shelley|할머니|할아버지|bad news|bells|boing|bubbles|cellos|jester|organ|trinoids|whisper|zarvox|superstar|wobble/i;

export function voiceScore(voice: VoiceLike): number {
  if (!/^ko/i.test(voice.lang || '')) return -Infinity;
  let score = 0;
  if (NATURAL.test(voice.name)) score += 5;
  if (/google/i.test(voice.name)) score += 3;
  // 온라인 목소리가 대개 더 자연스럽다(구글 · 마이크로소프트 온라인)
  if (voice.localService === false) score += 2;
  if (/^ko[-_]KR$/i.test(voice.lang)) score += 1;
  if (NOVELTY.test(voice.name)) score -= 10;
  return score;
}

/** 제일 자연스러운 한국어 목소리. 없으면 null. */
export function pickKoreanVoice<T extends VoiceLike>(voices: readonly T[]): T | null {
  let best: T | null = null;
  let bestScore = -Infinity;
  for (const voice of voices) {
    const score = voiceScore(voice);
    if (score > bestScore) { best = voice; bestScore = score; }
  }
  return bestScore === -Infinity ? null : best;
}
