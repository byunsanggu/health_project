import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  BACKUP_FORMAT,
  BACKUP_SETTING_KEYS,
  backupStartDate,
  backupSummary,
  backupWithConsent,
  isCalendarDate,
  mergeBackup,
  readBackup,
  type Backup,
} from '../backup.ts';
import { runOnboarding, type OnboardingAnswers } from '../onboarding.ts';
import { createGymBook } from '../gyms.ts';
import { COMMON_EQUIPMENT_IDS } from '../equipment.ts';

const answers: OnboardingAnswers = {
  selfReportedLevel: 'intermediate',
  monthsTraining: 18,
  bodyweightKg: 78,
  sex: 'male',
  daysPerWeek: 3,
  goals: ['hypertrophy'],
  gym: { equipmentIds: COMMON_EQUIPMENT_IDS.slice() },
};
const onboarded = runOnboarding(answers);

/** 앱의 "내 데이터 내려받기"가 쓰는 모양 그대로 */
function exported(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    앱: '볼륨 코치',
    형식: BACKUP_FORMAT,
    내보낸시각: '2026-10-20T11:00:00.000Z',
    동의: { given: ['terms', 'privacy', 'healthData', 'painData', 'dietLog'], version: '2026-09-19', at: '2026-08-01' },
    설문: answers,
    신체: onboarded.lifter,
    프로그램: onboarded.program,
    헬스장: {
      목록: createGymBook({ id: 'my-gym', name: '내 헬스장', equipmentIds: answers.gym.equipmentIds.slice() }),
      직접등록: [],
    },
    운동기록: [
      { id: 's1', date: '2026-10-13', gymId: 'my-gym', updatedAt: '2026-10-13T10:00:00Z', deviceId: 'old-phone',
        sets: [{ exerciseId: 'back-squat', weightKg: 100, reps: 8, rir: 2 }, { exerciseId: 'back-squat', weightKg: 100, reps: 8, rir: 1, machine: 'b' }] },
      { id: 's2', date: '2026-10-15', sets: [{ exerciseId: 'barbell-bench-press', weightKg: 70, reps: 10, rir: 2 }] },
      // 내려받은 날의 오늘치에는 id가 없다
      { date: '2026-10-20', sets: [{ exerciseId: 'lat-pulldown', weightKg: 55, reps: 12, rir: 3 }], gymId: 'my-gym' },
    ],
    체크인: [
      { id: 'c1', date: '2026-10-13', bodyweightKg: 78.4, sleepHours: 7, pain: [{ joint: 'knee', score: 4 }] },
      { id: 'c2', date: '2026-10-15', bodyweightKg: 78.1, proteinHit: true },
    ],
    식단기록: [
      { id: 'f1', date: '2026-10-15', meal: 'lunch', name: '제육볶음', grams: 300, amount: '1인분', kcal: 600, protein: 35, fat: 30, carbs: 40 },
    ],
    설정: {
      style: 'hypertrophy', blockHistory: ['hypertrophy'], startedOn: '2026-08-01',
      block: { number: 2, startedOn: '2026-09-29', level: 'intermediate', transition: null, technicalIntroduced: null, deloadOn: null, firstStartedOn: '2026-07-28', monthsAtStart: 18 },
      coach: { mode: 'pt', style: 'fired' }, restAlerts: false, voiceRate: 1.2,
      // 하루치 · 이 폰에 묶인 것은 실려 와도 들이지 않는다
      todaySets: [{ exerciseId: 'back-squat' }], friendCode: 'ABCD-1234',
    },
    ...over,
  };
}

function read(payload: unknown): Backup {
  const result = readBackup(JSON.stringify(payload));
  assert.ok(result.ok, result.ok ? '' : result.reason);
  return result.backup;
}

describe('백업 파일을 읽는다', () => {
  it('내려받은 파일을 그대로 다시 읽는다 — 기록 · 체크인 · 식단 · 설문 · 프로그램 · 설정', () => {
    const backup = read(exported());
    assert.equal(backup.exportedAt, '2026-10-20');
    assert.deepEqual(backup.sessions.map((session) => session.date), ['2026-10-13', '2026-10-15', '2026-10-20']);
    assert.equal(backup.sessions[0]!.sets[1]!.machine, 'b');
    assert.equal(backup.sessions[0]!.id, 's1');
    assert.equal(backup.sessions[2]!.id, undefined);
    assert.equal(backup.checkIns.length, 2);
    assert.equal(backup.foodLog.length, 1);
    assert.deepEqual(backup.answers, answers);
    assert.ok(backup.program, '지금 앱의 종목으로 짠 프로그램은 그대로 쓴다');
    assert.equal(backup.lifter?.level, onboarded.lifter.level);
    assert.equal(backup.gymBook?.activeId, 'my-gym');
    assert.deepEqual(backup.dropped, { sessions: 0, sets: 0, checkIns: 0 });
  });

  it('동기화 칸(수정 시각 · 기기)은 버린다 — 이 폰에서 새로 찍는다', () => {
    const session = read(exported()).sessions[0]!;
    assert.equal(session.updatedAt, undefined);
    assert.equal(session.deviceId, undefined);
  });

  it('설정은 정해 둔 칸만, 모양이 맞는 것만 들인다', () => {
    const settings = read(exported()).settings;
    assert.equal(settings.startedOn, '2026-08-01');
    assert.deepEqual(settings.coach, { mode: 'pt', style: 'fired' });
    assert.equal(settings.restAlerts, false);
    assert.ok(settings.block);
    assert.equal(settings.todaySets, undefined, '하루치는 다른 날 불러오면 틀린 값이다');
    assert.equal(settings.friendCode, undefined, '이 폰 · 이 계정에 묶인 것');
    assert.ok(!BACKUP_SETTING_KEYS.includes('todaySets'));

    const odd = read(exported({ 설정: { coach: { mode: 'pt', style: 'shouty' }, voiceRate: 9, block: { number: 1 }, startedOn: '2026-02-30' } })).settings;
    assert.deepEqual(odd, {});
  });

  it('내 루틴도 싣는다 — 날 목록 뼈대가 틀린 것만 버린다(종목은 앱이 다시 고른다)', () => {
    const routine = { days: [{ name: '상체', slots: [{ exerciseId: 'barbell-bench-press', sets: 4, repRange: { min: 6, max: 10 } }] }] };
    assert.deepEqual(read(exported({ 설정: { customRoutine: routine } })).settings.customRoutine, routine);
    assert.equal(read(exported({ 설정: { customRoutine: { days: 'x' } } })).settings.customRoutine, undefined);
  });

  it('첫 형식(형식 · 설정 칸이 없던 때)도 읽는다', () => {
    const payload = exported();
    delete payload['앱'];
    delete payload['형식'];
    delete payload['설정'];
    const backup = read(payload);
    assert.equal(backup.format, 1);
    assert.deepEqual(backup.settings, {});
    assert.equal(backup.sessions.length, 3);
  });

  it('읽을 수 없는 파일 · 남의 파일 · 더 새 판 파일은 거절하고 이유를 말한다', () => {
    const broken = readBackup('{"운동기록": [');
    assert.ok(!broken.ok && /JSON/.test(broken.reason));
    for (const other of ['[]', '{"name":"다른 앱"}', '"text"', 'null']) {
      const result = readBackup(other);
      assert.ok(!result.ok && /백업 파일이 아닙니다/.test(result.reason), other);
    }
    const newer = readBackup(JSON.stringify(exported({ 형식: BACKUP_FORMAT + 1 })));
    assert.ok(!newer.ok && /새 판/.test(newer.reason));
  });

  it('모양이 틀린 세트 · 날 · 체크인은 하나씩 버리고 센다', () => {
    const backup = read(exported({
      운동기록: [
        { date: '2026-10-13', sets: [
          { exerciseId: 'back-squat', weightKg: 100, reps: 8, rir: 2 },
          { exerciseId: 'back-squat', weightKg: '100', reps: 8, rir: 2 },
          { exerciseId: 'back-squat', weightKg: 100, reps: 8 },
          { exerciseId: '', weightKg: 100, reps: 8, rir: 2 },
          { exerciseId: 'back-squat', weightKg: -5, reps: 8, rir: 2 },
        ] },
        { date: '2026-02-30', sets: [{ exerciseId: 'back-squat', weightKg: 100, reps: 8, rir: 2 }] },
        { date: '2026-10-14', sets: [{ exerciseId: 'back-squat', weightKg: 100, reps: 8 }] },
        { date: '2026-10-15', deleted: true, sets: [{ exerciseId: 'back-squat', weightKg: 100, reps: 8, rir: 2 }] },
        'oops',
      ],
      체크인: [{ date: '어제', bodyweightKg: 78 }, { date: '2026-10-13', bodyweightKg: 9999, pain: [{ joint: 'tail', score: 3 }] }],
    }));
    assert.deepEqual(backup.sessions.map((session) => session.date), ['2026-10-13']);
    assert.equal(backup.sessions[0]!.sets.length, 1);
    assert.deepEqual(backup.dropped, { sessions: 4, sets: 5, checkIns: 1 });
    // 틀린 칸만 빠지고 날짜는 남는다
    assert.deepEqual(backup.checkIns, [{ date: '2026-10-13' }]);
  });

  it('유산소만 한 날도 운동한 날이다', () => {
    const backup = read(exported({ 운동기록: [{ date: '2026-10-13', sets: [], cardio: [{ exerciseId: 'treadmill', minutes: 30, zone: 'z2' }] }] }));
    assert.equal(backup.sessions.length, 1);
    assert.equal(backup.sessions[0]!.cardio?.length, 1);
  });

  it('같은 날이 두 번 있으면 본세트가 많은 쪽을 둔다', () => {
    const set = { exerciseId: 'back-squat', weightKg: 100, reps: 8, rir: 2 };
    const backup = read(exported({ 운동기록: [{ date: '2026-10-13', sets: [set] }, { date: '2026-10-13', sets: [set, set, set] }, { date: '2026-10-13', sets: [set, set] }] }));
    assert.equal(backup.sessions.length, 1);
    assert.equal(backup.sessions[0]!.sets.length, 3);
  });

  it('지금 앱에 없는 종목이 든 프로그램은 버린다 — 설문 답이 있으면 그걸로 다시 짠다', () => {
    const program = JSON.parse(JSON.stringify(onboarded.program));
    program.templates[0].slots[0].exerciseId = 'retired-exercise';
    const backup = read(exported({ 프로그램: program }));
    assert.equal(backup.program, null);
    assert.ok(backup.answers);
    assert.ok(runOnboarding(backup.answers!).program.templates.length > 0);
  });

  it('설문 답이 틀리면 없는 것으로 본다 — 설문을 다시 한다', () => {
    for (const broken of [
      { ...answers, daysPerWeek: 0 },
      { ...answers, selfReportedLevel: 'godlike' },
      { ...answers, goals: [] },
      { ...answers, gym: { equipmentIds: 'all' } },
    ]) {
      assert.equal(read(exported({ 설문: broken })).answers, null, JSON.stringify(broken).slice(0, 60));
    }
  });

  it('남은 설문 답은 그대로 프로그램을 짤 수 있다 — 이상한 기구 이름이 섞여 있어도', () => {
    const backup = read(exported({ 설문: { ...answers, gym: { equipmentIds: ['barbell-set', 'unknown-gadget'] }, extra: 'x' } }));
    assert.ok(backup.answers);
    assert.equal((backup.answers as unknown as Record<string, unknown>).extra, undefined);
    assert.doesNotThrow(() => runOnboarding(backup.answers!));
  });

  it('활성 헬스장이 목록에 없으면 첫 헬스장을 고른다', () => {
    const book = read(exported({ 헬스장: { 목록: { gyms: [{ id: 'a', name: 'A', equipmentIds: [] }, { id: 'b', name: 'B', equipmentIds: [] }], activeId: 'z' } } })).gymBook;
    assert.equal(book?.activeId, 'a');
  });
});

describe('지금 받은 동의만큼만 들인다', () => {
  it('통증 동의가 없으면 체크인의 통증과 설문의 통증을 뺀다', () => {
    const backup = read(exported({ 설문: { ...answers, pain: [{ joint: 'knee', score: 4 }] } }));
    const { backup: allowed, removed } = backupWithConsent(backup, ['terms', 'privacy', 'healthData']);
    assert.equal(removed.pains, 1);
    assert.ok(allowed.checkIns.every((entry) => entry.pain === undefined));
    assert.equal(allowed.answers?.pain, undefined);
    // 체중은 필수 동의(건강정보) 안이다 — 그대로
    assert.equal(allowed.checkIns[0]!.bodyweightKg, 78.4);
  });

  it('식단 동의가 없으면 식단 기록을 뺀다', () => {
    const { backup: allowed, removed } = backupWithConsent(read(exported()), ['terms', 'privacy', 'healthData', 'painData']);
    assert.deepEqual(allowed.foodLog, []);
    assert.equal(removed.food, 1);
    assert.equal(allowed.checkIns[0]!.pain?.length, 1);
  });

  it('둘 다 동의했으면 그대로다', () => {
    const backup = read(exported());
    const { backup: allowed, removed } = backupWithConsent(backup, ['terms', 'privacy', 'healthData', 'painData', 'dietLog']);
    assert.deepEqual(allowed, backup);
    assert.deepEqual(removed, { pains: 0, food: 0 });
  });
});

describe('이 폰의 기록과 합친다', () => {
  it('빠진 날만 채운다 — 같은 날은 이 폰 것을 둔다', () => {
    const backup = read(exported());
    const merged = mergeBackup({
      sessions: [{ id: 'here', date: '2026-10-15', sets: [] }, { id: 'gone', date: '2026-10-13', sets: [], deleted: true }],
      checkIns: [{ id: 'here-c', date: '2026-10-15', bodyweightKg: 77 }],
      foodLog: [{ ...backup.foodLog[0]! }],
    }, backup, '2026-10-22');
    assert.deepEqual(merged.sessions.map((session) => session.date), ['2026-10-13', '2026-10-20']);
    assert.deepEqual(merged.checkIns.map((entry) => entry.date), ['2026-10-13']);
    assert.deepEqual(merged.foodLog, []);
    assert.deepEqual(merged.kept, { sessions: 1, checkIns: 1, food: 1 });
  });

  it('빈 폰이면 전부 들어간다', () => {
    const backup = read(exported());
    const merged = mergeBackup({ sessions: [], checkIns: [], foodLog: [] }, backup, '2026-10-22');
    assert.equal(merged.sessions.length, 3);
    assert.equal(merged.checkIns.length, 2);
    assert.equal(merged.foodLog.length, 1);
  });

  it('내일 이후 날짜(시계가 틀린 폰)는 들이지 않는다', () => {
    const backup = read(exported());
    const merged = mergeBackup({ sessions: [], checkIns: [], foodLog: [] }, backup, '2026-10-14');
    assert.deepEqual(merged.sessions.map((session) => session.date), ['2026-10-13']);
    assert.deepEqual(merged.kept, { sessions: 0, checkIns: 0, food: 0 });
  });
});

describe('불러오기 전에 보여 줄 것', () => {
  it('운동한 날 · 기간 · 세트 · 체중 · 통증 · 식단을 센다', () => {
    const summary = backupSummary(read(exported()));
    assert.deepEqual(summary, {
      exportedAt: '2026-10-20', days: 3, first: '2026-10-13', last: '2026-10-20', sets: 4,
      checkIns: 2, weights: 2, pains: 1, food: 1, program: true, dropped: 0,
    });
  });

  it('시작한 날 — 저장된 날이 있으면 그날, 첫 운동이 더 이르면 그날', () => {
    assert.equal(backupStartDate(read(exported())), '2026-08-01');
    assert.equal(backupStartDate(read(exported({ 설정: { startedOn: '2026-10-14' } }))), '2026-10-13');
    assert.equal(backupStartDate(read(exported({ 설정: {} }))), '2026-10-13');
    assert.equal(backupStartDate(read(exported({ 설정: {}, 운동기록: [] }))), null);
  });

  it('달력에 없는 날짜는 날짜가 아니다', () => {
    assert.ok(isCalendarDate('2026-10-22'));
    assert.ok(isCalendarDate('2028-02-29'));
    assert.ok(!isCalendarDate('2026-02-29'));
    assert.ok(!isCalendarDate('2026-10-22T00:00'));
    assert.ok(!isCalendarDate(20261022));
  });
});
