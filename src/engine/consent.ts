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
 * 동의 문구의 판. 내용을 고치면 반드시 올린다.
 * 올라가면 기존 사용자에게 다시 묻는다 — 바뀐 내용에 동의한 적이 없기 때문이다.
 */
export const CONSENT_VERSION = '2026-09-19';

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
    items: ['훈련 경력', '훈련 기간', '성별', '다니는 헬스장과 보유 기구'],
    purpose: '훈련 프로그램 생성과 종목 선택',
    retention: '탈퇴 후 즉시 파기',
    ifDeclined: '프로그램을 만들 수 없어 서비스를 이용할 수 없습니다.',
    basis: '개인정보보호법 제15조',
  },
  {
    id: 'healthData',
    label: '건강정보 수집·이용 동의 (민감정보)',
    required: true,
    sensitive: true,
    items: ['체중', '운동 기록(종목·중량·반복·RIR)'],
    purpose:
      '첫 중량 추정, 경력 자가신고 검증, 주간 볼륨과 피로도 계산, 다음 주 훈련량 처방',
    retention: '탈퇴 후 즉시 파기. 앱에서 언제든 직접 삭제할 수 있습니다.',
    ifDeclined:
      '중량을 처방하거나 훈련량을 조절할 수 없습니다. 이 앱의 핵심 기능이라 서비스를 이용할 수 없습니다.',
    basis: '개인정보보호법 제23조 (민감정보 — 별도 동의)',
  },
  {
    id: 'painData',
    label: '통증 기록 수집·이용 동의 (민감정보)',
    required: false,
    sensitive: true,
    items: ['관절별 통증 점수'],
    purpose: '아픈 관절에 부담이 큰 종목을 대체하거나 제외',
    retention: '탈퇴 후 즉시 파기. 앱에서 언제든 직접 삭제할 수 있습니다.',
    ifDeclined:
      '통증에 따른 종목 대체가 동작하지 않습니다. 나머지 기능은 그대로 쓸 수 있습니다.',
    basis: '개인정보보호법 제23조 (민감정보 — 별도 동의)',
  },
  {
    id: 'location',
    label: '위치정보 이용 동의',
    required: false,
    sensitive: false,
    items: ['기기의 현재 위치'],
    purpose: '근처 헬스장 찾기, 도착한 헬스장 자동 전환, 중복 등록 판정',
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
}

export function recordConsent(given: readonly ConsentId[], at: string): ConsentRecord {
  // 중복을 정리하고 정의된 순서대로 담는다 — 증빙은 예측 가능해야 한다.
  const unique = CONSENT_ITEMS.filter((item) => given.includes(item.id)).map((item) => item.id);
  return { given: unique, version: CONSENT_VERSION, at };
}

/** 동의를 철회한다. 필수 항목을 철회하면 서비스가 멈춘다는 것도 같이 돌려준다. */
export function withdrawConsent(
  record: ConsentRecord,
  id: ConsentId,
  at: string,
): { record: ConsentRecord; stopsService: boolean } {
  const item = consentItem(id);
  const given = record.given.filter((value) => value !== id);
  return {
    record: { ...record, given, at },
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
 * 문구가 바뀌면 다시 물어야 한다.
 * 사용자는 이전 판에 동의했을 뿐, 바뀐 내용에 동의한 적이 없다.
 */
export function needsReconsent(record: ConsentRecord | undefined): boolean {
  if (!record) return true;
  return record.version !== CONSENT_VERSION;
}

export type GatedFeature = 'painGate' | 'nearbyGyms' | 'autoSwitchGym' | 'marketing';

export interface FeatureGate {
  feature: GatedFeature;
  label: string;
  /** 이 기능을 쓰려면 필요한 동의 */
  needs: ConsentId;
}

const GATES: readonly FeatureGate[] = [
  { feature: 'painGate', label: '통증에 따른 종목 대체', needs: 'painData' },
  { feature: 'nearbyGyms', label: '근처 헬스장 찾기', needs: 'location' },
  { feature: 'autoSwitchGym', label: '도착한 헬스장 자동 전환', needs: 'location' },
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
    lines.push(
      `${on ? '동의함' : '동의 안 함'} · ${item.label} — ${item.items.join(', ')} · ${item.retention}`,
    );
  }
  return lines;
}
