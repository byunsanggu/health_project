/**
 * 한국어 조사 처리.
 *
 * "체스트 서포티드 로우은(는)" 같은 표기는 제품에서 그대로 쓰면 안 된다.
 * 받침 유무만 보면 정확히 고를 수 있으므로 엔진이 문장을 만들 때 직접 처리한다.
 */

const HANGUL_BASE = 0xac00;
const HANGUL_LAST = 0xd7a3;

/**
 * 판정에 쓸 마지막 글자.
 *
 * 헬스장 이름은 "예시 피트니스 A (대형)"처럼 괄호나 따옴표로 끝나는 일이
 * 흔하다. 그 기호를 그대로 보면 한글이 아니라 판정을 못 하고 "대형)와" 같은
 * 문장이 나온다. 뒤에 붙은 기호는 걷어내고 본다.
 */
const TRAILING_NOISE = /[\s"'’”)\]}»·.,!?~-]+$/;

/** 마지막 글자에 받침이 있는가. 한글이 아니면 null. */
export function hasFinalConsonant(word: string): boolean | null {
  const trimmed = word.trim().replace(TRAILING_NOISE, '');
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
    // ㄹ 받침(코드 8)은 '로'. 기호를 걷어낸 같은 글자를 봐야 한다.
    const core = word.trim().replace(TRAILING_NOISE, '');
    const code = core.charCodeAt(core.length - 1);
    if ((code - HANGUL_BASE) % 28 === 8) return withoutFinal;
  }

  return final ? withFinal : withoutFinal;
}

/** 단어 뒤에 조사를 붙인 문자열. */
export function withParticle(word: string, pair: ParticlePair): string {
  return word + particle(word, pair);
}
