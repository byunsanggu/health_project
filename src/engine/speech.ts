/**
 * 코치 목소리 — 말을 미리 만든 소리 조각으로 나눈다.
 *
 * 코치 목소리는 기기 음성합성이 아니라 미리 만들어 둔 소리 파일이다(오픈소스 Supertonic으로
 * 만든 것 — tools/voice). 처음 보는 글자는 읽을 수 없으니, 앱이 하는 말은 전부 조각으로 덮여
 * 있어야 한다. 이 파일이 그 나누는 규칙이다. 소리를 만드는 쪽(tools/voice)과 소리를 트는 쪽
 * (앱)이 **같은 규칙**으로 나눠야 조각이 맞는다.
 *
 *   1. 문장 단위로 자른다. 통째로 만든 문장이 있으면 그걸 쓴다 — 제일 자연스럽다.
 *   2. 없으면 바뀌는 부분(숫자 · 종목 이름 · 스트레칭 이름)을 떼어 내고, 그 사이 고정된 말은
 *      그 말대로, 숫자는 읽는 소리대로("열 개", "육십이 점 오 킬로"), 이름은 이름대로.
 *   3. 사람이 적은 글(이름 · 기계 세팅 · 루틴 이름)은 화면에만 있고 소리로는 뺀다(forSpeech).
 *
 * 숫자는 한국어 읽기가 단위마다 다르다. 개 · 번은 고유어(한 개, 열 번), 나머지는
 * 한자어(삼 세트, 사십 초, 육십이 킬로).
 */
import { forSpeech } from './coach.ts';
import { EXERCISES } from './exercises.ts';
import { COOLDOWN_STEPS, MOBILITY_STEPS } from './ptSession.ts';

/* ── 숫자 읽기 ─────────────────────────────────── */

const SINO_DIGIT = ['영', '일', '이', '삼', '사', '오', '육', '칠', '팔', '구'];

/** 한자어 수 — 125 → 백이십오. 0 → 영. */
export function sinoNumber(n: number): string {
  const value = Math.floor(Math.abs(n));
  if (value === 0) return '영';
  let out = '';
  const units: [number, string][] = [[10000, '만'], [1000, '천'], [100, '백'], [10, '십']];
  let rest = value;
  for (const [size, word] of units) {
    const digit = Math.floor(rest / size);
    rest %= size;
    if (digit === 0) continue;
    out += (digit === 1 && size < 10000 ? '' : sinoNumber(digit)) + word;
  }
  if (rest > 0) out += SINO_DIGIT[rest];
  return out;
}

const NATIVE_ONES = ['', '한', '두', '세', '네', '다섯', '여섯', '일곱', '여덟', '아홉'];
const NATIVE_TENS = ['', '열', '스물', '서른', '마흔', '쉰', '예순', '일흔', '여든', '아흔'];

/** 고유어 수 관형형 — 1 → 한, 20 → 스무, 21 → 스물한. 100 이상은 한자어. */
export function nativeCount(n: number): string {
  const value = Math.floor(Math.abs(n));
  if (value === 0) return '영';
  if (value >= 100) return sinoNumber(value);
  if (value === 20) return '스무';
  return NATIVE_TENS[Math.floor(value / 10)]! + NATIVE_ONES[value % 10]!;
}

/** 단위마다 읽는 법 · 통째로 만들어 둔 범위 (이 범위 밖은 숫자 + 단위로 이어 붙인다) */
const UNITS: Record<string, { native: boolean; whole: number; space: boolean }> = {
  개: { native: true, whole: 60, space: true },
  번: { native: true, whole: 30, space: true },
  세트: { native: false, whole: 20, space: true },
  초: { native: false, whole: 120, space: true },
  분: { native: false, whole: 120, space: true },
  주: { native: false, whole: 60, space: true },
  회: { native: false, whole: 30, space: true },
  종목: { native: false, whole: 20, space: true },
  에서: { native: false, whole: 50, space: false },
  킬로: { native: false, whole: 0, space: true },
  파운드: { native: false, whole: 0, space: true },
};

/** 통째로 만들어 두는 한자어 수의 끝 — 이보다 크면 백 단위와 나머지로 나눈다 */
const SINO_WHOLE = 400;

const NUMBER = /(\d+(?:\.\d+)?)\s*(킬로|파운드|개|세트|초|분|주|번|회|종목|에서)?/g;

/** 정수 부분을 조각으로 — 400까지는 하나, 넘으면 "오백" + "이십삼" */
function integerPieces(value: number): string[] {
  if (value <= SINO_WHOLE) return [sinoNumber(value)];
  const pieces: string[] = [];
  const thousands = Math.floor(value / 1000);
  const hundreds = Math.floor((value % 1000) / 100);
  const rest = value % 100;
  if (thousands > 0) pieces.push(sinoNumber(thousands * 1000));
  if (hundreds > 0) pieces.push(sinoNumber(hundreds * 100));
  if (rest > 0) pieces.push(sinoNumber(rest));
  return pieces;
}

/** 숫자 하나(단위 포함)를 소리 조각으로. */
export function numberPieces(raw: string, unit?: string): string[] {
  const [whole, fraction] = raw.split('.');
  const value = Number(whole);
  const spec = unit ? UNITS[unit] : undefined;
  if (spec && !fraction && value >= 1 && value <= spec.whole) {
    const word = spec.native ? nativeCount(value) : sinoNumber(value);
    return [word + (spec.space ? ' ' : '') + unit];
  }
  const pieces = integerPieces(value);
  if (fraction) pieces.push('점 ' + [...fraction].map((digit) => SINO_DIGIT[Number(digit)]).join(''));
  if (spec) {
    // 개 · 번은 고유어인데 범위를 넘으면 한자어 수 + 단위
    pieces.push(unit === '에서' ? '에서' : unit!);
  }
  return pieces;
}

/** 소리 조각으로 만들어 두는 숫자 전부 — 소리를 만드는 쪽이 쓴다. */
export function numberInventory(): string[] {
  const out = new Set<string>();
  for (let n = 0; n <= SINO_WHOLE; n += 1) out.add(sinoNumber(n));
  for (let h = 5; h <= 9; h += 1) out.add(sinoNumber(h * 100));
  for (let t = 1; t <= 9; t += 1) out.add(sinoNumber(t * 1000));
  for (let d = 0; d <= 9; d += 1) out.add('점 ' + SINO_DIGIT[d]);
  for (const [unit, spec] of Object.entries(UNITS)) {
    out.add(unit);
    for (let n = 1; n <= spec.whole; n += 1) out.add(numberPieces(String(n), unit)[0]!);
  }
  return [...out];
}

/* ── 문장 나누기 ───────────────────────────────── */

/** 이름 조각 — 종목 · 몸 풀기 · 스트레칭 이름. 긴 것부터 맞춘다(시티드 레그 컬 > 레그 컬). */
let NAMES: string[] | null = null;

export function speechNames(): readonly string[] {
  if (!NAMES) {
    // "맨몸"은 무게 자리에 숫자 대신 들어간다 — 숫자처럼 떼어 내야 앞뒤 조각이 늘 같다
    const all = ['맨몸', ...EXERCISES.map((item) => item.name), ...MOBILITY_STEPS.map((step) => step.name), ...COOLDOWN_STEPS.map((step) => step.name)];
    NAMES = [...new Set(all.map((name) => name.trim()).filter(Boolean))].sort((a, b) => b.length - a.length);
  }
  return NAMES;
}

/** 문장으로 자른다 — 마침표 · 느낌표 · 물음표 뒤에 빈칸이 오거나 글이 끝날 때. 62.5의 점에서는 자르지 않는다. */
export function sentences(text: string): string[] {
  const out: string[] = [];
  for (const part of text.split(/(?<=[.!?])\s+/)) {
    const clean = part.replace(/\s+/g, ' ').trim();
    if (clean && /[가-힣A-Za-z0-9]/.test(clean)) out.push(clean);
  }
  return out;
}

/** 고정된 말 조각을 다듬는다 — 앞뒤 쉼표 · 가운뎃점 · 빈칸을 뗀다. 말이 없으면 빈 문자열. */
function tidy(fragment: string): string {
  const clean = fragment.replace(/^[\s,·]+/, '').replace(/[\s,·]+$/, '').replace(/\s+/g, ' ');
  return /[가-힣A-Za-z0-9]/.test(clean) ? clean : '';
}

interface Token { start: number; end: number; pieces: string[] }

function tokens(sentence: string): Token[] {
  const found: Token[] = [];
  const taken = (start: number, end: number) => found.some((token) => start < token.end && end > token.start);
  for (const name of speechNames()) {
    let from = 0;
    for (;;) {
      const at = sentence.indexOf(name, from);
      if (at < 0) break;
      if (!taken(at, at + name.length)) found.push({ start: at, end: at + name.length, pieces: [name] });
      from = at + name.length;
    }
  }
  for (const match of sentence.matchAll(NUMBER)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    if (taken(start, end)) continue;
    found.push({ start, end, pieces: numberPieces(match[1]!, match[2]) });
  }
  return found.sort((a, b) => a.start - b.start);
}

/**
 * 말을 소리 조각 목록으로. has는 "이 문장을 통째로 만들어 두었는가" — 있으면 그 문장 그대로.
 * 소리를 만드는 쪽은 has 없이(통째 문장 목록으로) 부르고, 앱은 그 목록으로 부른다.
 */
export function speechPieces(text: string, has: (piece: string) => boolean = () => false): string[] {
  const out: string[] = [];
  for (const sentence of sentences(forSpeech(text))) {
    const found = tokens(sentence);
    if (found.length === 0 || has(sentence)) {
      out.push(sentence);
      continue;
    }
    let at = 0;
    for (const token of found) {
      const before = tidy(sentence.slice(at, token.start));
      if (before) out.push(before);
      out.push(...token.pieces);
      at = token.end;
    }
    const after = tidy(sentence.slice(at));
    if (after) out.push(after);
  }
  return out;
}

/**
 * 조각을 만들 때 실제로 읽힐 글 — 영어 글자는 한국어 소리로(PT → 피티).
 * 조각 이름(파일을 찾는 열쇠)은 바꾸지 않는다.
 */
export function synthText(piece: string): string {
  return piece
    .replace(/PT/g, '피티')
    .replace(/W-Y/g, '더블유 와이')
    .replace(/\bkg\b/g, '킬로')
    .replace(/·/g, ',');
}

/** 조각 이름 → 파일 이름. 소리 만드는 쪽과 앱이 같은 값을 낸다 (cyrb53, 16진수). */
export function clipId(piece: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < piece.length; i += 1) {
    const ch = piece.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0');
}
