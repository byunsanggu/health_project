import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  CONSENT_ITEMS,
  CONSENT_VERSION,
  allows,
  blockedFeatures,
  canUseService,
  consentItem,
  describeConsent,
  missingRequired,
  needsReconsent,
  recordConsent,
  withdrawConsent,
  type ConsentId,
} from '../consent.ts';

const ALL: ConsentId[] = CONSENT_ITEMS.map((item) => item.id);
const REQUIRED: ConsentId[] = CONSENT_ITEMS.filter((item) => item.required).map((item) => item.id);

describe('동의 항목', () => {
  it('민감정보는 필수든 선택이든 따로 묶여 있다', () => {
    const sensitive = CONSENT_ITEMS.filter((item) => item.sensitive);
    assert.ok(sensitive.length >= 2, '건강정보와 통증 기록은 민감정보다');
    for (const item of sensitive) {
      assert.match(item.basis, /제23조/, `${item.label}: 근거 조항이 빠졌다`);
    }
  });

  it('모든 항목이 무엇을·왜·얼마나·거부하면을 말한다', () => {
    for (const item of CONSENT_ITEMS) {
      assert.ok(item.items.length > 0, `${item.label}: 수집 항목이 없다`);
      assert.ok(item.purpose.length > 5, `${item.label}: 목적이 없다`);
      assert.ok(item.retention.length > 3, `${item.label}: 보유 기간이 없다`);
      assert.ok(item.ifDeclined.length > 5, `${item.label}: 거부 시 안내가 없다`);
      assert.ok(item.basis.length > 3, `${item.label}: 근거가 없다`);
    }
  });

  it('선택 항목은 거부해도 서비스를 쓸 수 있다', () => {
    // 선택을 거부했다고 막으면 그것도 위법이다
    assert.equal(canUseService(REQUIRED), true);
  });

  it('통증과 위치는 선택이다 — 없어도 훈련은 된다', () => {
    assert.equal(consentItem('painData')!.required, false);
    assert.equal(consentItem('location')!.required, false);
    assert.equal(consentItem('marketing')!.required, false);
  });

  it('체중과 운동 기록은 이 앱의 핵심이라 필수다', () => {
    const health = consentItem('healthData')!;
    assert.equal(health.required, true);
    assert.equal(health.sensitive, true);
  });
});

describe('판정', () => {
  it('필수를 빠뜨리면 못 쓴다', () => {
    assert.equal(canUseService([]), false);
    assert.equal(canUseService(['terms', 'privacy']), false, '건강정보 동의가 빠졌다');
    assert.ok(missingRequired(['terms']).some((item) => item.id === 'healthData'));
  });

  it('전부 동의하면 당연히 된다', () => {
    assert.equal(canUseService(ALL), true);
    assert.deepEqual(missingRequired(ALL), []);
  });
});

describe('기능 잠금', () => {
  it('통증 동의가 없으면 통증 게이트가 꺼진다', () => {
    assert.equal(allows(REQUIRED, 'painGate'), false);
    assert.equal(allows([...REQUIRED, 'painData'], 'painGate'), true);
  });

  it('위치 동의가 없으면 근처 찾기와 자동 전환이 꺼진다', () => {
    assert.equal(allows(REQUIRED, 'nearbyGyms'), false);
    assert.equal(allows(REQUIRED, 'autoSwitchGym'), false);
    assert.equal(allows([...REQUIRED, 'location'], 'nearbyGyms'), true);
  });

  it('무엇이 꺼졌는지 보여줄 수 있다', () => {
    const blocked = blockedFeatures(REQUIRED);
    assert.ok(blocked.length >= 3);
    for (const gate of blocked) assert.ok(gate.label.length > 0);
    assert.deepEqual(blockedFeatures(ALL), []);
  });
});

describe('기록과 철회', () => {
  it('언제 · 어느 판에 동의했는지 남긴다', () => {
    const record = recordConsent(ALL, '2026-09-19');
    assert.equal(record.version, CONSENT_VERSION);
    assert.equal(record.at, '2026-09-19');
  });

  it('중복을 정리하고 정의된 순서로 담는다', () => {
    const record = recordConsent(['healthData', 'terms', 'terms'], '2026-09-19');
    assert.deepEqual(record.given, ['terms', 'healthData']);
  });

  it('선택 동의는 철회해도 서비스가 멈추지 않는다', () => {
    const record = recordConsent(ALL, '2026-09-19');
    const after = withdrawConsent(record, 'location', '2026-09-20');
    assert.equal(after.stopsService, false);
    assert.equal(canUseService(after.record.given), true);
    assert.equal(allows(after.record.given, 'nearbyGyms'), false);
  });

  it('필수 동의를 철회하면 멈춘다고 알려준다', () => {
    const record = recordConsent(ALL, '2026-09-19');
    const after = withdrawConsent(record, 'healthData', '2026-09-20');
    assert.equal(after.stopsService, true);
    assert.equal(canUseService(after.record.given), false);
  });

  it('문구가 바뀌면 다시 묻는다', () => {
    assert.equal(needsReconsent(undefined), true);
    assert.equal(needsReconsent({ given: ALL, version: '2020-01-01', at: '2020-01-01' }), true);
    assert.equal(needsReconsent(recordConsent(ALL, '2026-09-19')), false);
  });
});

describe('describeConsent', () => {
  it('내 정보가 어떻게 쓰이는지 한 번에 볼 수 있다', () => {
    const lines = describeConsent(recordConsent(REQUIRED, '2026-09-19'));
    assert.ok(lines[0]!.includes('2026-09-19'));
    assert.equal(lines.length, CONSENT_ITEMS.length + 1);
    assert.ok(lines.some((line) => line.startsWith('동의 안 함')), '거부한 것도 보여야 한다');
  });

  it('동의 전에도 말이 된다', () => {
    assert.deepEqual(describeConsent(undefined), ['아직 동의한 항목이 없습니다.']);
  });
});
