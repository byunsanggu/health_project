/**
 * 한국어 조사 처리.
 *
 * "체스트 서포티드 로우은(는)" 같은 표기는 제품에서 그대로 쓰면 안 된다.
 * 받침 유무만 보면 정확히 고를 수 있으므로 엔진이 문장을 만들 때 직접 처리한다.
 */

const HANGUL_BASE = 0xac00;
const HANGUL_LAST = 0xd7a3;

/** 마지막 글자에 받침이 있는가. 한글이 아니면 null. */
export function hasFinalConsonant(word: string): boolean | null {
  const trimmed = word.trim();
  if (trimmed.length === 0) return null;

  const code = trimmed.charCodeAt(trimmed.length - 1);
  if (code < HANGUL_BASE || code > HANGUL_LAST) return null;
  return (code - HANGUL_BASE) % 28 !== 0;
}

export type ParticlePair = '을/를' | '은/는' | '이/가' | '과/와' | '으로/로' | '이다/다';

const PAIRS: Record<ParticlePair, [withFinal: string, withoutFinal: string]> = {
  '을/를': ['을', '를'],
  '은/는': ['은', '는'],
  '이/가': ['이', '가'],
  '과/와': ['과', '와'],
  // ㄹ 받침은 '로'를 쓴다 (예: 케이블로)
  '으로/로': ['으로', '로'],
  '이다/다': ['이다', '다'],
};

/** 단어에 맞는 조사를 고른다. 판단할 수 없으면 받침 없는 쪽을 쓴다. */
export function particle(word: string, pair: ParticlePair): string {
  const [withFinal, withoutFinal] = PAIRS[pair];
  const final = hasFinalConsonant(word);
  if (final === null) return withoutFinal;

  if (pair === '으로/로' && final) {
    // ㄹ 받침(코드 8)은 '로'
    const code = word.trim().charCodeAt(word.trim().length - 1);
    if ((code - HANGUL_BASE) % 28 === 8) return withoutFinal;
  }

  return final ? withFinal : withoutFinal;
}

/** 단어 뒤에 조사를 붙인 문자열. */
export function withParticle(word: string, pair: ParticlePair): string {
  return word + particle(word, pair);
}
