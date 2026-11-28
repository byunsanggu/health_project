import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  CONSENT_CHANGES,
  CONSENT_ITEMS,
  CONSENT_VERSION,
  agreeToCurrent,
  agreedToCurrent,
  allows,
  blockedFeatures,
  canUseService,
  consentItem,
  describeConsent,
  missingRequired,
  declineUpdate,
  needsReconsent,
  pendingUpdates,
  reconsentPlan,
  recordConsent,
  withdrawConsent,
  type ConsentId,
  type ConsentRecord,
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

describe('2026-11-28 판 — 식단 목표에 키 · 출생 연도 · 활동량', () => {
  const OLD = '2026-11-01';
  const oldRecord = (given: ConsentId[]): ConsentRecord => ({ given, version: OLD, at: '2026-11-05' });
  const WITH_DIET: ConsentId[] = [...REQUIRED, 'dietLog'];

  it('판을 올렸고, 무엇이 바뀌었는지 적혀 있다', () => {
    assert.equal(CONSENT_VERSION, '2026-11-28');
    const last = CONSENT_CHANGES[CONSENT_CHANGES.length - 1]!;
    assert.equal(last.version, CONSENT_VERSION, '판을 올렸으면 바뀐 것을 CONSENT_CHANGES에 적는다');
    assert.deepEqual(last.items, ['dietLog']);
    assert.ok(last.lines.some((line) => line.includes('키') && line.includes('출생 연도') && line.includes('활동량')));
    assert.ok(last.lines.some((line) => line.includes('식단 목표 칼로리 계산')));
  });

  it('식단 기록 동의(선택 · 민감정보)에 들어 있다 — 필수 동의에 묶지 않는다', () => {
    const diet = consentItem('dietLog')!;
    assert.equal(diet.required, false);
    assert.equal(diet.sensitive, true);
    const items = diet.items.join(' ');
    assert.match(items, /키/);
    assert.match(items, /출생 연도/);
    assert.match(items, /활동량/);
    assert.doesNotMatch(items, /생년월일/, '생년월일이 아니라 출생 연도만 받는다');
    assert.match(diet.purpose, /식단 목표 칼로리 계산/);
    assert.match(diet.purpose, /성별/, '이미 받은 성별을 칼로리에도 쓴다는 것을 적는다');
    assert.match(diet.ifDeclined, /체중으로 어림/);
    // 건강정보(필수)는 그대로다
    assert.deepEqual(consentItem('healthData')!.items, ['체중', '운동 기록(종목 · 무게 · 횟수 · 남은 힘)']);
  });

  it('예전 판에서 식단 기록에 동의한 사람에게만 그 항목을 한 번 묻는다', () => {
    const plan = reconsentPlan(oldRecord(WITH_DIET));
    assert.equal(plan.kind, 'gentle');
    assert.deepEqual(plan.items.map((item) => item.id), ['dietLog']);
    assert.equal(plan.changes.length, 1);
    assert.equal(needsReconsent(oldRecord(WITH_DIET)), true);

    // 식단 기록에 동의한 적이 없으면 바뀐 것이 없다 — 쓰려는 순간에 지금 문구로 묻는다
    assert.equal(reconsentPlan(oldRecord(REQUIRED)).kind, 'none');
    assert.equal(needsReconsent(oldRecord(REQUIRED)), false);

    assert.equal(reconsentPlan(undefined).kind, 'full');
    assert.equal(reconsentPlan({ given: ALL, version: '2020-01-01', at: '2020-01-01' }).kind, 'full');
    assert.equal(reconsentPlan(recordConsent(ALL, '2026-11-28')).kind, 'none');
  });

  it('동의하면 지금 문구로 — 키 · 나이 · 활동량을 받아도 된다', () => {
    const before = oldRecord(WITH_DIET);
    assert.equal(agreedToCurrent(before, 'dietLog'), false, '예전 문구에는 키 · 나이가 없다');
    const after = recordConsent(before.given, '2026-11-28');
    assert.equal(after.version, CONSENT_VERSION);
    assert.equal(after.olderText, undefined);
    assert.equal(agreedToCurrent(after, 'dietLog'), true);
    assert.equal(needsReconsent(after), false);
  });

  it('거부해도 아무것도 잃지 않는다 — 식단 기록 동의는 예전 문구로 남고, 다시 묻지 않는다', () => {
    const declined = declineUpdate(oldRecord(WITH_DIET), '2026-11-28');
    assert.deepEqual(declined.given, WITH_DIET, '거부했다고 식단 기록 동의를 끄면 기록이 지워진다');
    assert.equal(declined.version, CONSENT_VERSION);
    assert.deepEqual(declined.olderText, { dietLog: OLD });
    assert.equal(needsReconsent(declined), false, '한 번만 묻는다');
    assert.equal(canUseService(declined.given), true);
    assert.equal(allows(declined.given, 'dietLog'), true, '먹은 것 적기는 그대로');
    assert.equal(agreedToCurrent(declined, 'dietLog'), false, '키 · 나이 · 활동량은 받지 않는다');
  });

  it('다른 동의를 켜도 바뀐 식단 문구까지 동의한 것으로 적지 않는다', () => {
    const declined = declineUpdate(oldRecord(WITH_DIET), '2026-11-28');
    const more = recordConsent([...declined.given, 'location'], '2026-11-29', declined);
    assert.deepEqual(more.olderText, { dietLog: OLD });
    assert.equal(agreedToCurrent(more, 'location'), true);
    assert.equal(agreedToCurrent(more, 'dietLog'), false);

    // 아직 묻기 전(예전 판 기록)에 위치를 켜도 마찬가지다
    const early = recordConsent([...WITH_DIET, 'location'], '2026-11-28', oldRecord(WITH_DIET));
    assert.deepEqual(early.olderText, { dietLog: OLD });
  });

  it('나중에 바뀐 내용을 보고 동의하면 그 항목만 지금 문구로 바뀐다', () => {
    const declined = declineUpdate(oldRecord(WITH_DIET), '2026-11-28');
    const agreed = agreeToCurrent(declined, 'dietLog', declined.given, '2026-12-01');
    assert.equal(agreed.olderText, undefined);
    assert.equal(agreedToCurrent(agreed, 'dietLog'), true);
    assert.equal(agreed.at, '2026-12-01');
    // 처음 켜는 사람도 지금 문구를 보고 켠 것이다
    const fresh = agreeToCurrent(recordConsent(REQUIRED, '2026-11-28'), 'dietLog', REQUIRED, '2026-11-29');
    assert.ok(fresh.given.includes('dietLog'));
    assert.equal(agreedToCurrent(fresh, 'dietLog'), true);
  });

  it('내 정보에서 다시 열 것 — 묻기 전이든 거절했든 아직 새 문구가 아닌 선택 항목', () => {
    assert.deepEqual(pendingUpdates(oldRecord(WITH_DIET)).items.map((item) => item.id), ['dietLog']);
    const declined = declineUpdate(oldRecord(WITH_DIET), '2026-11-28');
    const again = pendingUpdates(declined);
    assert.equal(again.kind, 'gentle');
    assert.deepEqual(again.items.map((item) => item.id), ['dietLog']);
    assert.equal(again.changes.length, 1);
    assert.equal(pendingUpdates(recordConsent(WITH_DIET, '2026-11-28')).kind, 'none');
    assert.equal(pendingUpdates(oldRecord(REQUIRED)).kind, 'none');
    assert.equal(pendingUpdates(null).kind, 'none');
  });

  it('철회하면 예전 문구 표시도 같이 지운다', () => {
    const declined = declineUpdate(oldRecord(WITH_DIET), '2026-11-28');
    const { record, stopsService } = withdrawConsent(declined, 'dietLog', '2026-11-30');
    assert.equal(stopsService, false);
    assert.equal(record.olderText, undefined);
    assert.equal(agreedToCurrent(record, 'dietLog'), false);
  });

  it('내 동의 보기에 예전 문구로 남은 항목이 드러난다', () => {
    const lines = describeConsent(declineUpdate(oldRecord(WITH_DIET), '2026-11-28'));
    assert.equal(lines.length, CONSENT_ITEMS.length + 1);
    const diet = lines.find((line) => line.includes('식단 기록'))!;
    assert.match(diet, /2026-11-01 판 문구/);
  });
});
