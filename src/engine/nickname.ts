/**
 * 닉네임.
 *
 * 친구를 연락처에서 찾지 않기로 했다. 그러면 사람을 가리킬 이름이
 * 하나 있어야 하고, 그게 닉네임이다.
 *
 * 이 이름은 **낯선 사람에게 보인다.** 그래서 규칙이 셀 수밖에 없다 —
 * 본명이 흘러나오지 않게, 전화번호가 이름 자리에 들어가지 않게,
 * "운영자"를 사칭하지 못하게.
 *
 * 그리고 이 이름 말고는 아무것도 넘어가지 않는다. 체중도 통증도
 * 운동 기록도 친구 쪽 테이블에 올라가지 않는다 — 민감정보다.
 */

export const NICKNAME_MIN = 2;
export const NICKNAME_MAX = 12;

/** 완성형 한글 · 영문 · 숫자 · 밑줄. 그 밖은 받지 않는다. */
const ALLOWED = /^[가-힣a-zA-Z0-9_]+$/;

/** 자모 단독. "ㅋㅋㅋ"은 글자가 아니라 소리다. */
const JAMO = /[ㄱ-ㅎㅏ-ㅣ]/;

/**
 * 운영자 사칭.
 *
 * 포함만 해도 막는다. "볼륨코치관리자"가 "관리자"보다 덜 위험하지 않다.
 */
const RESERVED: readonly string[] = [
  '운영자', '관리자', '고객센터', '볼륨코치', '공식',
  'admin', 'administrator', 'official', 'support', 'root', 'system', 'staff',
];

export type NicknameProblem =
  | 'empty'
  | 'tooShort'
  | 'tooLong'
  | 'badChar'
  | 'jamo'
  | 'digitsOnly'
  | 'underscoreEdge'
  | 'reserved'
  | 'phoneLike';

export interface NicknameCheck {
  ok: boolean;
  /** 저장할 모양 — 앞뒤 공백을 떼고 가운데 공백을 밑줄로 바꾼 것 */
  value: string;
  /** 중복을 볼 때 쓰는 열쇠. 대소문자와 밑줄을 무시한다 */
  key: string;
  problem: NicknameProblem | null;
  /** 사용자에게 그대로 보여줄 한 줄. 무엇을 고치면 되는지까지 말한다 */
  message: string;
}

/**
 * 받아 적기.
 *
 * 공백은 거절하지 않고 밑줄로 바꾼다. "볼륨 코치"라고 친 사람에게
 * "공백은 안 됩니다"라고 돌려보내는 것보다 "볼륨_코치"를 보여주고
 * 맞는지 묻는 쪽이 빠르다.
 */
export function cleanNickname(raw: string): string {
  return (raw ?? '')
    .normalize('NFC')
    .trim()
    .replace(/\s+/g, '_')
    .slice(0, NICKNAME_MAX);
}

/**
 * 같은 이름으로 볼 열쇠.
 *
 * 대소문자와 밑줄을 지운다. "볼륨_코치"로 "볼륨코치"를 사칭하는 길을
 * 막으려면 둘을 같은 이름으로 세야 한다.
 */
export function nicknameKey(value: string): string {
  return cleanNickname(value).toLowerCase().replace(/_/g, '');
}

export function checkNickname(raw: string): NicknameCheck {
  const value = cleanNickname(raw);
  const key = nicknameKey(value);

  const fail = (problem: NicknameProblem, message: string): NicknameCheck =>
    ({ ok: false, value, key, problem, message });

  if (value.length === 0) return fail('empty', '닉네임을 정해 주세요.');
  if (value.length < NICKNAME_MIN) {
    return fail('tooShort', `${NICKNAME_MIN}글자 이상으로 해 주세요.`);
  }
  // cleanNickname이 잘라 내므로 길이 초과는 원본으로 판단한다.
  if ((raw ?? '').trim().replace(/\s+/g, '_').length > NICKNAME_MAX) {
    return fail('tooLong', `${NICKNAME_MAX}글자까지 됩니다.`);
  }
  if (JAMO.test(value)) {
    return fail('jamo', 'ㄱ·ㅏ 같은 낱자만으로는 안 됩니다. 글자로 적어 주세요.');
  }
  if (!ALLOWED.test(value)) {
    return fail('badChar', '한글·영문·숫자·밑줄만 됩니다.');
  }
  if (/^_|_$|__/.test(value)) {
    return fail('underscoreEdge', '밑줄은 가운데에 하나씩만 쓸 수 있습니다.');
  }
  if (/01[016789]\d{6,8}/.test(value.replace(/_/g, ''))) {
    return fail('phoneLike', '전화번호처럼 보입니다. 닉네임은 친구에게 그대로 보입니다.');
  }
  if (/^\d+$/.test(value)) {
    return fail('digitsOnly', '숫자만으로는 안 됩니다. 글자를 섞어 주세요.');
  }
  if (RESERVED.some((word) => key.includes(word))) {
    return fail('reserved', '운영자로 오해받을 수 있는 이름은 쓸 수 없습니다.');
  }

  return { ok: true, value, key, problem: null, message: '쓸 수 있는 닉네임입니다.' };
}

/* ── 지어 주기 ─────────────────────────────────── */

/**
 * 빈칸으로 두면 아무도 안 고친다. 눌러서 바꾸는 쪽이 빈칸보다 낫다.
 *
 * 몸이나 외모를 가리키는 말은 넣지 않는다. 닉네임을 받는 자리에서
 * "날씬한"을 먼저 보여주면 그게 이 앱이 무엇을 중요하게 보는지에 대한
 * 선언이 된다.
 */
const ADJECTIVES: readonly string[] = [
  '꾸준한', '묵묵한', '성실한', '새벽', '저녁', '조용한', '단단한',
  '느긋한', '한결같은', '부지런한', '담담한', '차분한',
];

const NOUNS: readonly string[] = [
  '바벨', '덤벨', '스쿼트', '데드', '벤치', '케틀벨', '플레이트',
  '러너', '리프터', '헬린이', '중량', '트레이니',
];

/**
 * 닉네임 후보.
 *
 * seed가 같으면 같은 목록이 나온다 — 시험할 수 있어야 한다. 뒤에 붙는
 * 숫자는 겹칠 확률을 낮추려는 것이고, 그래도 겹치면 서버가 거절한다.
 */
export function suggestNicknames(seed: number, count = 3): string[] {
  const out: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const n = Math.abs(Math.floor(seed)) + i * 977;
    const adjective = ADJECTIVES[n % ADJECTIVES.length]!;
    const noun = NOUNS[Math.floor(n / ADJECTIVES.length) % NOUNS.length]!;
    const digits = (n * 7919) % 90 + 10;
    const candidate = cleanNickname(`${adjective}${noun}${digits}`);
    // 규칙을 통과하지 못하는 후보는 보여주지 않는다.
    if (checkNickname(candidate).ok && !out.includes(candidate)) out.push(candidate);
  }
  return out;
}
