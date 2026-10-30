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

import type { CoachStyle } from './coach.ts';

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

/**
 * 쓸 한국어 목소리. 사람이 고른 목소리(preferred — 이름)가 이 기기에 있으면 그것,
 * 없으면 제일 자연스러운 것. 한국어 목소리가 하나도 없으면 null.
 */
export function pickKoreanVoice<T extends VoiceLike>(voices: readonly T[], preferred?: string | null): T | null {
  if (preferred) {
    const chosen = voices.find((voice) => voice.name === preferred && voiceScore(voice) > -Infinity);
    if (chosen) return chosen;
  }
  let best: T | null = null;
  let bestScore = -Infinity;
  for (const voice of voices) {
    const score = voiceScore(voice);
    if (score > bestScore) { best = voice; bestScore = score; }
  }
  return bestScore === -Infinity ? null : best;
}

/* ── 고르는 목록 ─────────────────────────────────── */

export interface VoiceChoice<T extends VoiceLike = VoiceLike> {
  voice: T;
  /** 화면에 보일 이름 — 회사 이름 · 언어 꼬리표를 뗀 것 */
  label: string;
  /** Natural · 향상됨 · 프리미엄 같은 고급 목소리 */
  natural: boolean;
  /** 인터넷으로 만드는 목소리 — 신호가 없으면 기기가 기본 목소리로 바꿀 수 있다 */
  online: boolean;
}

// 이름에서 뗄 꼬리표. 남는 것이 사람 이름(SunHi, Yuna)이다
const NOISE: readonly RegExp[] = [
  /\b(microsoft|google|samsung|apple|online)\b/gi,
  /\b(natural|neural|enhanced|premium|compact)\b/gi,
  /향상됨|프리미엄|고품질/g,
  /\bkorean\b|\bkorea\b|\bsouth\b/gi,
  /한국어|대한민국|한국의|한국/g,
];

/** 안드로이드 음성 엔진의 목소리 id (ko-kr-x-ism-local) — 사람이 읽을 이름이 아니다 */
const ENGINE_ID = /^ko[-_]kr[-_]x[-_]/i;

/**
 * 화면에 보일 목소리 이름. 같은 사람 목소리의 고급판(아이폰 "Yuna (향상됨)")은 꼬리표를
 * 한국어로 남겨서 기본판과 구별한다.
 */
export function voiceLabel(voice: VoiceLike): string {
  const raw = voice.name.replace(/^samsung\s+/i, '');
  if (ENGINE_ID.test(raw)) return '기기 목소리';
  let name = raw;
  for (const pattern of NOISE) name = name.replace(pattern, ' ');
  name = name.replace(/[()[\]\-–_,]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!name) return /google/i.test(voice.name) ? '구글 목소리' : '기본 목소리';
  if (/premium|프리미엄/i.test(raw)) return name + ' 프리미엄';
  if (/enhanced|향상됨/i.test(raw)) return name + ' 향상됨';
  return name;
}

/**
 * 고를 수 있는 한국어 목소리 — 자연스러운 것부터. 장난감 목소리는 빼고, 같은 이름은 하나만.
 * 이름이 겹치면(기기 목소리가 여럿) 뒤에 번호를 붙인다.
 */
export function voiceChoices<T extends VoiceLike>(voices: readonly T[]): VoiceChoice<T>[] {
  const seen = new Set<string>();
  const list = voices
    .filter((voice) => voiceScore(voice) > -5)
    .filter((voice) => (seen.has(voice.name) ? false : (seen.add(voice.name), true)))
    .sort((a, b) => voiceScore(b) - voiceScore(a) || a.name.localeCompare(b.name));
  const used = new Map<string, number>();
  return list.map((voice) => {
    const base = voiceLabel(voice);
    const count = (used.get(base) ?? 0) + 1;
    used.set(base, count);
    return {
      voice,
      label: count === 1 ? base : base + ' ' + count,
      natural: NATURAL.test(voice.name),
      online: voice.localService === false,
    };
  });
}

/* ── 높이 · 빠르기 ──────────────────────────────── */

export interface VoiceOption { label: string; value: number }

/** 말 빠르기 — 카운트는 조금 빨라야 박자에 맞는다 */
export const VOICE_RATES: readonly VoiceOption[] = [
  { label: '느리게', value: 0.85 },
  { label: '보통', value: 1 },
  { label: '빠르게', value: 1.2 },
];

/** 목소리 높이 — 같은 목소리도 낮추면 굵고 차분하게, 올리면 밝게 들린다 */
export const VOICE_PITCHES: readonly VoiceOption[] = [
  { label: '낮게', value: 0.86 },
  { label: '보통', value: 1 },
  { label: '높게', value: 1.14 },
];

/**
 * 말투마다 기본 결. 차분하게는 조금 느리고 낮게, 빡세게는 조금 빠르고 힘 있게(높게),
 * 숫자로는 또박또박 낮게. 사람이 고른 빠르기 · 높이는 이 위에 곱한다 — 말투를 바꿔도
 * "나는 느리게"가 그대로 남는다.
 */
export const STYLE_TONE: Readonly<Record<CoachStyle, { rate: number; pitch: number }>> = {
  gentle: { rate: 0.94, pitch: 0.97 },
  tough: { rate: 1.08, pitch: 0.94 },
  energetic: { rate: 1.08, pitch: 1.07 },
  fun: { rate: 1.03, pitch: 1.02 },
};

const clamp = (value: number, low: number, high: number): number => Math.min(high, Math.max(low, value));
const round2 = (value: number): number => Math.round(value * 100) / 100;

/**
 * 실제로 읽을 빠르기 · 높이. style이 없으면(혼자 모드 카운트) 말투 결 없이 고른 값 그대로.
 * 브라우저가 받는 범위(빠르기 0.5~2, 높이 0~2) 안에서도 너무 끝은 알아듣기 어려워 좁게 자른다.
 */
export function voiceTuning(style: CoachStyle | null | undefined, rate?: number | null, pitch?: number | null): { rate: number; pitch: number } {
  const tone = (style && STYLE_TONE[style]) || { rate: 1, pitch: 1 };
  return {
    rate: round2(clamp(tone.rate * (rate || 1), 0.5, 2)),
    pitch: round2(clamp(tone.pitch * (pitch || 1), 0.6, 1.5)),
  };
}
