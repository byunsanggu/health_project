/**
 * 수집 동의.
 *
 * 이 앱이 받는 것 중 체중·통증·운동 기록은 건강에 관한 정보다. 개인정보보호법은
 * 이걸 민감정보로 보고 다른 동의와 묶지 말라고 한다(제23조) — 이용약관에 끼워
 * 넣고 한 번에 받으면 동의로 치지 않는다.
 *
 * 그래서 여기서 정하는 규칙은 셋이다.
 *
 *   1. 민감정보는 따로 묻는다. 한 번에 다 체크되는 버튼을 두지 않는다.
 *   2. 필수와 선택을 가른다. 선택을 거부해도 앱은 돌아가야 한다 — 거부했다고
 *      서비스를 막으면 그것도 위법이다(제22조).
 *   3. 무엇을 왜 받고 얼마나 갖고 있으며 거부하면 어떻게 되는지 먼저 말한다.
 *
 * 그리고 하나 더 — 이 파일은 동의를 "받는 장치"이지 법률 자문이 아니다.
 * 실제 출시 전에는 문구를 변호사에게 검토받아야 한다.
 */
export type ConsentId =
  | 'terms'
  | 'privacy'
  | 'healthData'
  | 'painData'
  | 'dietLog'
  | 'location'
  | 'marketing';

export interface ConsentItem {
  id: ConsentId;
  label: string;
  /** 거부하면 앱을 쓸 수 없는가 */
  required: boolean;
  /**
   * 민감정보라 별도 동의가 필요한가.
   * true면 다른 항목과 함께 한 번에 체크되어서는 안 된다.
   */
  sensitive: boolean;
  /** 수집 항목 */
  items: string[];
  /** 이용 목적 */
  purpose: string;
  /** 보유·이용 기간 */
  retention: string;
  /** 거부했을 때 무엇이 안 되는가 — 법이 요구하는 고지다 */
  ifDeclined: string;
  /** 근거 조항 (제품 화면에는 안 보여도 되지만 검토에 필요하다) */
  basis: string;
}

/**
 * 동의 문구의 판. 내용을 고치면 반드시 올리고, 아래 CONSENT_CHANGES에 무엇이 바뀌었는지 적는다.
 * 올라가면 기존 사용자에게 다시 묻는다 — 바뀐 내용에 동의한 적이 없기 때문이다.
 *
 * 2026-11-28: 식단 기록 동의에 키 · 출생 연도 · 평소 활동량(적는 경우에만)과 "식단 목표 칼로리 계산"을
 * 더했다(주인 결정). 바뀐 것이 선택 항목뿐이라 기존 사용자에게는 그 항목만 한 번 다시 묻고, 거부해도
 * 예전 문구의 동의는 그대로 살아 있다 — 식단 기록은 남고 목표는 예전처럼 체중으로 어림한다.
 */
export const CONSENT_VERSION = '2026-11-28';

/**
 * 판마다 바뀐 것. 다시 물을 때 "무엇이 새로 생겼는지"를 이 글 그대로 보여 준다.
 * 동의한 항목 중 여기 적힌 것만 다시 묻는다 — 동의하지 않은 항목은 쓰려는 순간에 지금 문구로 묻는다.
 */
export interface ConsentChange {
  /** 이 판에서 */
  version: string;
  /** 문구가 바뀐 항목 */
  items: ConsentId[];
  /** 다시 묻는 화면의 제목 */
  title: string;
  /** 무엇이 새로 생겼는지 한 줄씩 */
  lines: string[];
}

export const CONSENT_CHANGES: readonly ConsentChange[] = [
  {
    version: '2026-11-28',
    items: ['dietLog'],
    title: '식단 기록 동의에 새 내용이 더해졌습니다',
    lines: [
      '더해진 수집 항목: 키, 출생 연도, 평소 활동량 — 직접 적는 경우에만 받습니다.',
      '더해진 이용 목적: 식단 목표 칼로리 계산 — 이미 받은 체중 · 성별과 함께 씁니다.',
    ],
  },
];

/** 바뀐 내용을 적기 시작한 판. 이보다 오래된 동의는 무엇이 바뀌었는지 몰라 처음부터 다시 묻는다. */
const FIRST_TRACKED_VERSION = '2026-11-01';

export const CONSENT_ITEMS: readonly ConsentItem[] = [
  {
    id: 'terms',
    label: '이용약관 동의',
    required: true,
    sensitive: false,
    items: ['계정 식별자', '앱 설정'],
    purpose: '서비스 제공과 계정 관리',
    retention: '탈퇴 시까지',
    ifDeclined: '서비스를 이용할 수 없습니다.',
    basis: '개인정보보호법 제15조',
  },
  {
    id: 'privacy',
    label: '개인정보 수집·이용 동의',
    required: true,
    sensitive: false,
    items: ['운동 경력', '운동한 기간', '성별', '다니는 헬스장과 그곳 기구'],
    purpose: '운동 계획을 짜고 종목을 고르는 데',
    retention: '탈퇴 후 즉시 파기',
    ifDeclined: '운동 계획을 짤 수 없어 앱을 쓸 수 없습니다.',
    basis: '개인정보보호법 제15조',
  },
  {
    id: 'healthData',
    label: '건강정보 수집·이용 동의 (민감정보)',
    required: true,
    sensitive: true,
    items: ['체중', '운동 기록(종목 · 무게 · 횟수 · 남은 힘)'],
    purpose:
      '첫 무게 정하기, 고른 운동 경력 확인, 한 주 운동량과 피로 계산, 다음 주 운동량 정하기',
    retention: '탈퇴 후 즉시 파기. 앱에서 언제든 직접 삭제할 수 있습니다.',
    ifDeclined:
      '무게를 정해 드리거나 운동량을 맞출 수 없습니다. 이 앱에서 가장 중요한 기능이라 앱을 쓸 수 없습니다.',
    basis: '개인정보보호법 제23조 (민감정보 — 별도 동의)',
  },
  {
    id: 'painData',
    label: '통증 기록 수집·이용 동의 (민감정보)',
    required: false,
    sensitive: true,
    items: ['관절별 통증 점수'],
    purpose: '아픈 관절에 무리가 가는 종목을 다른 종목으로 바꾸거나 빼는 데',
    retention: '탈퇴 후 즉시 파기. 앱에서 언제든 직접 삭제할 수 있습니다.',
    ifDeclined:
      '아픈 곳에 맞춰 종목을 바꿔 주는 기능만 꺼집니다. 나머지 기능은 그대로 쓸 수 있습니다.',
    basis: '개인정보보호법 제23조 (민감정보 — 별도 동의)',
  },
  {
    /*
     * 먹은 음식도 건강에 관한 정보로 본다. 체중과 같이 보면 그 사람의 몸을
     * 짐작할 수 있다. 쓰는 사람만 따로 동의하게 둔다 — 적을 생각이 없는 사람에게
     * 처음부터 물을 이유가 없다(처음 적으려는 순간에 묻는다).
     *
     * 키 · 출생 연도 · 활동량도 여기에 둔다(2026-11-28). 쓰는 곳이 식단 목표 칼로리 하나뿐이고, 적는 것도
     * 선택이다. 필수인 건강정보 동의에 넣으면 선택 정보를 필수 동의에 묶는 셈이 된다(제22조). 나이는
     * 생년월일이 아니라 출생 연도만 받는다 — 칼로리 계산에는 그것으로 충분하다. 성별은 운동 계획용으로
     * 이미 받았으므로, 칼로리 계산에도 쓴다는 것을 이용 목적에 적는다.
     */
    id: 'dietLog',
    label: '식단 기록 수집·이용 동의 (민감정보)',
    required: false,
    sensitive: true,
    items: ['먹은 음식과 양, 끼니', '키, 출생 연도, 평소 활동량(적는 경우에만)'],
    purpose:
      '칼로리 · 단백질 · 지방 · 탄수화물 계산, 체중 변화와 맞춰 내 유지 칼로리 계산, ' +
      '식단 목표 칼로리 계산(적어 주신 키 · 나이 · 활동량과 이미 받은 체중 · 성별로)',
    retention: '탈퇴 후 즉시 파기. 앱에서 언제든 직접 삭제할 수 있습니다.',
    ifDeclined:
      '먹은 것을 적고 계산하는 기능만 꺼집니다. 나머지 기능은 그대로 쓸 수 있습니다. ' +
      '키 · 나이 · 활동량은 적지 않아도 되고, 적지 않으면 목표 칼로리를 체중으로 어림합니다.',
    basis: '개인정보보호법 제23조 (민감정보 — 별도 동의)',
  },
  {
    id: 'location',
    label: '위치정보 이용 동의',
    required: false,
    sensitive: false,
    items: ['기기의 현재 위치'],
    purpose: '근처 헬스장 찾기, 도착한 헬스장으로 자동으로 바꾸기, 같은 헬스장이 두 번 등록되지 않게 확인',
    retention: '이용 시점에만 쓰고 저장하지 않습니다.',
    ifDeclined:
      '헬스장을 이름으로 검색하고 직접 고르면 됩니다. 나머지 기능은 그대로 쓸 수 있습니다.',
    basis: '위치정보의 보호 및 이용 등에 관한 법률 제19조',
  },
  {
    id: 'marketing',
    label: '마케팅 정보 수신 동의',
    required: false,
    sensitive: false,
    items: ['알림 수신 설정'],
    purpose: '새 기능과 이벤트 안내',
    retention: '동의 철회 시까지',
    ifDeclined: '안내를 받지 않습니다. 휴식 타이머 같은 기능 알림은 그대로 옵니다.',
    basis: '정보통신망법 제50조',
  },
];

export function consentItem(id: ConsentId): ConsentItem | undefined {
  return CONSENT_ITEMS.find((item) => item.id === id);
}

/* ── 동의 기록 ─────────────────────────────────────────── */

export interface ConsentRecord {
  /** 동의한 항목들 */
  given: ConsentId[];
  /** 어느 판의 문구에 동의했는가 */
  version: string;
  /** 언제 (ISO) */
  at: string;
  /**
   * 바뀐 내용에 동의하지 않아 예전 판 문구로 남아 있는 항목 — { dietLog: '2026-11-01' }.
   * version은 "어느 판까지 물었는가"이고, 여기 적힌 항목만 그 판의 문구로 동의한 채다.
   * 증빙에 "새 문구에 동의했다"고 적으면 안 되는 항목을 따로 적어 두는 칸이다.
   */
  olderText?: Partial<Record<ConsentId, string>>;
}

/** 이 판 뒤로 이 항목의 문구가 바뀌었는가. 기록을 적기 전 판이면 모르므로 바뀐 것으로 본다. */
function changedSince(id: ConsentId, version: string): boolean {
  if (version < FIRST_TRACKED_VERSION) return true;
  return CONSENT_CHANGES.some((change) => change.version > version && change.items.includes(id));
}

/** 이 기록에서 항목이 몇 판 문구로 동의된 것인가 */
function textVersionOf(record: ConsentRecord, id: ConsentId): string {
  return record.olderText?.[id] ?? record.version;
}

/**
 * 지금 판으로 동의를 남긴다.
 *
 * previous를 주면 그 기록에서 이미 동의했던 항목 중 문구가 바뀌었는데 아직 새 문구를 본 적이 없는 것은
 * 예전 판 문구로 남긴다(olderText). 위치 동의 하나를 켜면서 식단 기록의 새 문구까지 동의한 것으로
 * 적으면 거짓 증빙이 된다. 이번에 새로 켠 항목은 지금 문구를 보고 켠 것이다.
 */
export function recordConsent(
  given: readonly ConsentId[],
  at: string,
  previous?: ConsentRecord | null,
): ConsentRecord {
  // 중복을 정리하고 정의된 순서대로 담는다 — 증빙은 예측 가능해야 한다.
  const unique = CONSENT_ITEMS.filter((item) => given.includes(item.id)).map((item) => item.id);
  const record: ConsentRecord = { given: unique, version: CONSENT_VERSION, at };
  if (previous) {
    const older: Partial<Record<ConsentId, string>> = {};
    for (const id of unique) {
      if (!previous.given.includes(id)) continue;
      const was = textVersionOf(previous, id);
      if (changedSince(id, was)) older[id] = was;
    }
    if (Object.keys(older).length > 0) record.olderText = older;
  }
  return record;
}

/** 한 항목을 지금 문구로 받았다 — 동의 화면에서 그 항목의 지금 문구를 보고 눌렀을 때. */
export function agreeToCurrent(
  previous: ConsentRecord | null | undefined,
  id: ConsentId,
  given: readonly ConsentId[],
  at: string,
): ConsentRecord {
  const record = recordConsent(given.includes(id) ? given : [...given, id], at, previous);
  if (record.olderText && id in record.olderText) {
    const rest = { ...record.olderText };
    delete rest[id];
    if (Object.keys(rest).length > 0) record.olderText = rest;
    else delete record.olderText;
  }
  return record;
}

/**
 * 바뀐 내용을 물었는데 "지금은 안 함" — 이 판까지 물었다고 적고(다시 묻지 않는다), 바뀐 항목은
 * 예전 문구의 동의로 남긴다. 아무것도 지우지 않는다.
 */
export function declineUpdate(record: ConsentRecord, at: string): ConsentRecord {
  return recordConsent(record.given, at, record);
}

/** 이 항목을 지금 판 문구로 동의했는가 — 새 문구에만 있는 것(키 · 나이 · 활동량)을 받아도 되는가. */
export function agreedToCurrent(record: ConsentRecord | null | undefined, id: ConsentId): boolean {
  if (!record || !record.given.includes(id)) return false;
  return !changedSince(id, textVersionOf(record, id));
}

/** 동의를 철회한다. 필수 항목을 철회하면 서비스가 멈춘다는 것도 같이 돌려준다. */
export function withdrawConsent(
  record: ConsentRecord,
  id: ConsentId,
  at: string,
): { record: ConsentRecord; stopsService: boolean } {
  const item = consentItem(id);
  const given = record.given.filter((value) => value !== id);
  const next: ConsentRecord = { ...record, given, at };
  if (next.olderText && id in next.olderText) {
    const rest = { ...next.olderText };
    delete rest[id];
    if (Object.keys(rest).length > 0) next.olderText = rest;
    else delete next.olderText;
  }
  return {
    record: next,
    stopsService: Boolean(item?.required),
  };
}

/* ── 판정 ──────────────────────────────────────────────── */

export function missingRequired(given: readonly ConsentId[]): ConsentItem[] {
  return CONSENT_ITEMS.filter((item) => item.required && !given.includes(item.id));
}

export function canUseService(given: readonly ConsentId[]): boolean {
  return missingRequired(given).length === 0;
}

/**
 * 다시 물을 것.
 *
 *   none   — 묻지 않는다. 지금 판이거나, 이미 물었거나, 바뀐 것이 동의하지 않은 선택 항목뿐이다
 *            (그 항목은 쓰려는 순간에 지금 문구로 묻는다).
 *   gentle — 동의했던 선택 항목의 문구만 바뀌었다. 앱은 그대로 열고 바뀐 것만 한 번 묻는다.
 *            거부해도 예전 문구의 동의는 살아 있고 기록도 그대로다.
 *   full   — 기록이 없거나, 필수 항목이 바뀌었거나, 무엇이 바뀌었는지 모르는 옛 판이다. 동의 화면부터.
 */
export interface ReconsentPlan {
  kind: 'none' | 'gentle' | 'full';
  /** 다시 묻는 항목 — 동의했던 것 중 문구가 바뀐 것 */
  items: ConsentItem[];
  /** 그 사이 판들에서 바뀐 것 */
  changes: ConsentChange[];
}

export function reconsentPlan(record: ConsentRecord | null | undefined): ReconsentPlan {
  if (!record) return { kind: 'full', items: [], changes: [] };
  if (record.version === CONSENT_VERSION) return { kind: 'none', items: [], changes: [] };
  if (record.version < FIRST_TRACKED_VERSION) return { kind: 'full', items: [], changes: [] };
  const changes = CONSENT_CHANGES.filter((change) => change.version > record.version);
  const ids = new Set(changes.flatMap((change) => change.items));
  if (CONSENT_ITEMS.some((item) => item.required && ids.has(item.id))) {
    return { kind: 'full', items: CONSENT_ITEMS.filter((item) => ids.has(item.id)), changes };
  }
  const items = CONSENT_ITEMS.filter((item) => ids.has(item.id) && record.given.includes(item.id));
  if (items.length === 0) return { kind: 'none', items: [], changes: [] };
  return {
    kind: 'gentle',
    items,
    changes: changes.filter((change) => change.items.some((id) => record.given.includes(id))),
  };
}

/**
 * 아직 새 문구로 동의하지 않은 항목 — 묻기 전인 것과, 물었는데 "지금은 안 함"이었던 것(olderText)을 같이.
 * 내 정보에서 "바뀐 내용 보고 동의하기"를 다시 열 때 쓴다. 다시 열기는 사용자가 누른 것이라 묻는 횟수와 상관없다.
 */
export function pendingUpdates(record: ConsentRecord | null | undefined): ReconsentPlan {
  if (!record) return { kind: 'none', items: [], changes: [] };
  const items = CONSENT_ITEMS.filter((item) => !item.required && record.given.includes(item.id)
    && !agreedToCurrent(record, item.id));
  if (items.length === 0) return { kind: 'none', items: [], changes: [] };
  const changes = CONSENT_CHANGES.filter((change) => change.items.some((id) => items.some((item) => item.id === id)
    && change.version > textVersionOf(record, id)));
  return { kind: 'gentle', items, changes };
}

/**
 * 문구가 바뀌면 다시 물어야 한다.
 * 사용자는 이전 판에 동의했을 뿐, 바뀐 내용에 동의한 적이 없다.
 * 무엇을 어떻게 물을지는 reconsentPlan이 정한다 — 바뀐 것이 동의하지 않은 항목뿐이면 묻지 않는다.
 */
export function needsReconsent(record: ConsentRecord | null | undefined): boolean {
  return reconsentPlan(record).kind !== 'none';
}

export type GatedFeature = 'painGate' | 'dietLog' | 'nearbyGyms' | 'autoSwitchGym' | 'marketing';

export interface FeatureGate {
  feature: GatedFeature;
  label: string;
  /** 이 기능을 쓰려면 필요한 동의 */
  needs: ConsentId;
}

const GATES: readonly FeatureGate[] = [
  { feature: 'painGate', label: '아픈 곳에 맞춰 종목 바꾸기', needs: 'painData' },
  { feature: 'dietLog', label: '먹은 것 적고 칼로리 계산', needs: 'dietLog' },
  { feature: 'nearbyGyms', label: '근처 헬스장 찾기', needs: 'location' },
  { feature: 'autoSwitchGym', label: '도착한 헬스장으로 자동 바꾸기', needs: 'location' },
  { feature: 'marketing', label: '새 기능·이벤트 안내', needs: 'marketing' },
];

export function allows(given: readonly ConsentId[], feature: GatedFeature): boolean {
  const gate = GATES.find((item) => item.feature === feature);
  return gate ? given.includes(gate.needs) : true;
}

/** 선택 동의를 거부해서 잠긴 기능들. 무엇이 꺼졌는지 보여줄 때 쓴다. */
export function blockedFeatures(given: readonly ConsentId[]): FeatureGate[] {
  return GATES.filter((gate) => !given.includes(gate.needs));
}

/* ── 사용자에게 보여줄 요약 ───────────────────────────── */

/**
 * 내 정보가 어떻게 쓰이는지 한 화면에 모은다.
 * 열람권(제35조)은 "어딘가에 적혀 있다"가 아니라 앱에서 바로 볼 수 있어야 한다.
 */
export function describeConsent(record: ConsentRecord | undefined): string[] {
  if (!record) return ['아직 동의한 항목이 없습니다.'];

  const lines = [`${record.at}에 ${record.version} 판 문구로 동의했습니다.`];
  for (const item of CONSENT_ITEMS) {
    const on = record.given.includes(item.id);
    const older = on ? record.olderText?.[item.id] : undefined;
    lines.push(
      `${on ? '동의함' : '동의 안 함'}${older ? `(${older} 판 문구 — 바뀐 내용에는 동의 안 함)` : ''} · ` +
        `${item.label} — ${item.items.join(', ')} · ${item.retention}`,
    );
  }
  return lines;
}
