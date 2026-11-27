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

/** 괄호 바깥에 붙는 기호(따옴표 · 마침표 …) — 괄호 묶음을 떼기 전에 걷어낸다. */
const TRAILING_NOISE_OUTSIDE = /[\s"'’”»·.,!?~-]+$/;

/**
 * 이름 끝에 붙은 괄호 묶음 — "힙 어브덕션 머신 (아웃타이)", "딥스 (가슴)".
 *
 * 조사는 괄호 앞 낱말에 맞춘다(표기 규칙: 커피(coffee)를). 괄호 안 마지막 글자로
 * 보면 "힙 어브덕션 머신 (아웃타이)가 없습니다", "딥스 (가슴)을"이 나왔다.
 */
const TRAILING_GROUP = /\s*[(\[][^()\[\]]*[)\]]$/;

/** 받침을 판정할 부분 — 끝 기호와 끝 괄호 묶음을 걷어낸다. 괄호만 있는 이름이면 괄호 안을 본다. */
function judgedPart(word: string): string {
  let core = word.trim().replace(TRAILING_NOISE_OUTSIDE, '');
  const outside = core.replace(TRAILING_GROUP, '');
  if (outside !== core && outside.replace(TRAILING_NOISE, '').length > 0) core = outside;
  return core.replace(TRAILING_NOISE, '');
}

/**
 * 숫자는 읽는 소리로 본다 — "등받이 3"은 "삼"이라 "3이었어요"다.
 * 영 · 일 · 삼 · 육 · 칠 · 팔은 받침이 있다. 10 · 100 · 1000(십 · 백 · 천)도
 * 0으로 끝나고 모두 받침이 있다.
 */
const DIGIT_FINAL: Readonly<Record<string, boolean>> = {
  '0': true, '1': true, '2': false, '3': true, '4': false,
  '5': false, '6': true, '7': true, '8': true, '9': false,
};
/** ㄹ 받침으로 끝나는 숫자(일 · 칠 · 팔) — '으로' 대신 '로'를 쓴다. */
const DIGIT_RIEUL = new Set(['1', '7', '8']);

/** 마지막 글자에 받침이 있는가. 한글도 숫자도 아니면 null. */
export function hasFinalConsonant(word: string): boolean | null {
  const trimmed = judgedPart(word);
  if (trimmed.length === 0) return null;

  const last = trimmed[trimmed.length - 1]!;
  if (DIGIT_FINAL[last] !== undefined) return DIGIT_FINAL[last]!;
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
    const core = judgedPart(word);
    if (DIGIT_RIEUL.has(core[core.length - 1]!)) return withoutFinal;
    const code = core.charCodeAt(core.length - 1);
    if ((code - HANGUL_BASE) % 28 === 8) return withoutFinal;
  }

  return final ? withFinal : withoutFinal;
}

/** 단어 뒤에 조사를 붙인 문자열. */
export function withParticle(word: string, pair: ParticlePair): string {
  return word + particle(word, pair);
}

/*
 * 운동 날 이름 — 프로그램 안에서는 "상체 A · 하체 B · 전신 C"가 그날을 가리키는 이름(저장 · 순환에 그대로 쓴다)이고,
 * 화면에는 처음 온 사람이 알아듣는 말로 바꿔 보여 준다. "A/B"는 무슨 뜻인지 몰랐다.
 *   긴 이름: "상체 (가슴·등·팔)" — 머리줄 · 요약 제목처럼 자리가 있는 곳
 *   짧은 이름: "상체 ①" — 이번 주 칸처럼 좁고, 같은 상체가 두 번 나와 구별해야 하는 곳
 * 모르는 이름(내 루틴에서 직접 지은 이름)은 그대로 둔다.
 */
const DAY_BASES: Record<string, { base: string; parts: string }> = {
  상체: { base: '상체', parts: '가슴·등·팔' },
  하체: { base: '하체', parts: '엉덩이·허벅지' },
  전신: { base: '전신', parts: '하체·가슴·등' },
  푸시: { base: '미는 날', parts: '가슴·어깨·팔 뒤' },
  풀: { base: '당기는 날', parts: '등·팔 앞' },
  레그: { base: '하체', parts: '엉덩이·허벅지' },
};
const DAY_ORDER = ['①', '②', '③', '④', '⑤'];

function splitDayName(name: string): { base: string; parts: string; order: string } | null {
  const match = /^(\S+)(?:\s+([A-E]))?$/.exec(String(name || '').trim());
  if (!match) return null;
  const known = DAY_BASES[match[1]!];
  if (!known) return null;
  const order = match[2] ? DAY_ORDER[match[2].charCodeAt(0) - 65] ?? '' : '';
  return { base: known.base, parts: known.parts, order };
}

/** "상체 A" → "상체 (가슴·등·팔)" · "푸시" → "미는 날 (가슴·어깨·팔 뒤)". 모르는 이름은 그대로. */
export function dayPlainName(name: string): string {
  const day = splitDayName(name);
  return day ? `${day.base} (${day.parts})` : String(name || '');
}

/** "상체 A" → "상체 ①" · "레그" → "하체". 모르는 이름은 그대로. */
export function dayShortName(name: string): string {
  const day = splitDayName(name);
  return day ? (day.order ? `${day.base} ${day.order}` : day.base) : String(name || '');
}
