import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildWeeklyReport, plannedDaysLeft, reportText, weekInProgress, weekLabelOf, weekdayKo, zoneWord } from '../weeklyReport.ts';
import { EXERCISES } from '../exercises.ts';
import { landmarksFor } from '../muscles.ts';
import type { SessionLog, SetLog } from '../types.ts';

const index = new Map(EXERCISES.map((exercise) => [exercise.id, exercise]));
const landmarks = landmarksFor('intermediate');

const set = (exerciseId: string, weightKg: number, reps: number, rir = 2): SetLog =>
  ({ exerciseId, weightKg, reps, rir, warmup: false }) as SetLog;

const session = (date: string, sets: SetLog[]): SessionLog =>
  ({ id: date, date, updatedAt: date, sets }) as SessionLog;

const base = {
  landmarks,
  index,
  from: '2026-09-21',
  to: '2026-09-27',
  targetSessions: 4,
};

describe('주차 이름', () => {
  it('며칠인지로 몇 주차인지 센다', () => {
    assert.equal(weekLabelOf('2026-09-03'), '9월 1주차');
    assert.equal(weekLabelOf('2026-09-25'), '9월 4주차');
  });
});

describe('주간 리포트', () => {
  const week = [
    session('2026-09-21', [
      set('barbell-bench-press', 100, 8),
      set('barbell-bench-press', 100, 8),
      set('lat-pulldown', 70, 10),
    ]),
    session('2026-09-23', [set('back-squat', 140, 5, 1), set('back-squat', 140, 5, 1)]),
  ];

  it('운동한 날 수를 센다 — 세션 수가 아니다', () => {
    /*
     * 하루에 두 번 기록을 남겼다고 이틀 운동한 게 아니다. 날로 세야
     * "주 4회"라는 약속과 같은 단위가 된다.
     */
    const twice = week.concat([session('2026-09-23', [set('triceps-pushdown', 35, 12)])]);
    const report = buildWeeklyReport({ ...base, sessions: twice, history: twice });
    assert.equal(report.sessionCount, 2);
  });

  it('워밍업은 세트로 세지 않는다', () => {
    const withWarmup = [
      session('2026-09-21', [
        { ...set('barbell-bench-press', 60, 8), warmup: true } as SetLog,
        set('barbell-bench-press', 100, 8),
      ]),
    ];
    const report = buildWeeklyReport({ ...base, sessions: withWarmup, history: withWarmup });
    assert.equal(report.setCount, 1);
  });

  it('총 무게를 더한다', () => {
    const one = [session('2026-09-21', [set('barbell-bench-press', 100, 10)])];
    const report = buildWeeklyReport({ ...base, sessions: one, history: one });
    assert.equal(report.tonnage, 1000);
  });

  it('주 밖의 기록은 빼고 센다', () => {
    const spill = week.concat([session('2026-09-28', [set('barbell-curl', 30, 10)])]);
    const report = buildWeeklyReport({ ...base, sessions: spill, history: spill });
    assert.ok(!report.days.includes('2026-09-28'));
  });
});

describe('오른 종목', () => {
  it('지난주보다 무거우면 kg으로 말한다', () => {
    const before = [session('2026-09-14', [set('barbell-bench-press', 100, 8)])];
    const now = [session('2026-09-21', [set('barbell-bench-press', 102.5, 8)])];
    const report = buildWeeklyReport({ ...base, sessions: now, history: before.concat(now) });
    assert.equal(report.gains[0]?.detail, '+2.5kg');
  });

  it('같은 무게로 더 했으면 반복으로 말한다', () => {
    /*
     * 1RM 환산으로 부풀리지 않는다. 늘어난 건 반복이고, 반복이 늘어난
     * 것도 충분히 오른 것이다.
     */
    const before = [session('2026-09-14', [set('lat-pulldown', 70, 8)])];
    const now = [session('2026-09-21', [set('lat-pulldown', 70, 10)])];
    const report = buildWeeklyReport({ ...base, sessions: now, history: before.concat(now) });
    assert.equal(report.gains[0]?.detail, '같은 무게 2회 더');
  });

  it('처음 한 종목은 "올랐다"고 하지 않는다', () => {
    // 지난주에 안 한 종목은 기록이 아니라 처음 한 것이다.
    const now = [session('2026-09-21', [set('hammer-curl', 20, 12)])];
    const report = buildWeeklyReport({ ...base, sessions: now, history: now });
    assert.equal(report.gains.length, 0);
  });

  it('내려간 종목은 오른 것으로 세지 않는다', () => {
    const before = [session('2026-09-14', [set('back-squat', 140, 5)])];
    const now = [session('2026-09-21', [set('back-squat', 130, 5)])];
    const report = buildWeeklyReport({ ...base, sessions: now, history: before.concat(now) });
    assert.equal(report.gains.length, 0);
  });

  it('많아도 셋까지만 보여준다', () => {
    const ids = ['barbell-bench-press', 'lat-pulldown', 'back-squat', 'barbell-curl', 'triceps-pushdown'];
    const before = [session('2026-09-14', ids.map((id) => set(id, 50, 8)))];
    const now = [session('2026-09-21', ids.map((id) => set(id, 60, 8)))];
    const report = buildWeeklyReport({ ...base, sessions: now, history: before.concat(now) });
    assert.equal(report.gains.length, 3);
  });
});

describe('한 줄 제목과 다음 주 지시', () => {
  it('안 나간 주는 안 나갔다고 쓴다', () => {
    // 잘한 주만 예쁘게 뽑으면 그다음 장을 아무도 안 믿는다.
    const report = buildWeeklyReport({ ...base, sessions: [], history: [] });
    assert.match(report.headline, /쉬었/);
    assert.match(report.advice, /한 번/);
  });

  it('계획보다 적게 한 주는 횟수부터 말한다', () => {
    const now = [session('2026-09-21', [set('barbell-bench-press', 100, 8)])];
    const report = buildWeeklyReport({ ...base, sessions: now, history: now });
    assert.match(report.headline, /계획은 4번/);
    assert.match(report.advice, /4번을 먼저/);
  });

  it('계획한 날이 남은 주는 진행 중으로 말한다 — 과거형은 마지막 계획일이 지난 뒤에만', () => {
    // 월요일 첫 운동 직후: 월 · 수 · 금 중 월만 했다
    const now = [session('2026-09-21', [set('barbell-bench-press', 100, 8)])];
    const remainingDays = plannedDaysLeft({ planned: ['2026-09-21', '2026-09-23', '2026-09-25'], done: ['2026-09-21'], today: '2026-09-21' });
    assert.deepEqual(remainingDays, ['2026-09-23', '2026-09-25']);
    const report = buildWeeklyReport({ ...base, targetSessions: 3, sessions: now, history: now, remainingDays });
    assert.equal(report.inProgress, true);
    assert.equal(report.headline, '3번 중 1번 했습니다 · 수 · 금 남음');
    assert.doesNotMatch(report.headline + report.advice, /이었습니다|다음 주는/);
    assert.match(report.advice, /남은 2번/);
    assert.match(reportText(report), /진행 중|적정/);
    assert.doesNotMatch(reportText(report), /부족/);

    // 금요일이 지나면 그때는 지난 일로 말한다
    const over = buildWeeklyReport({ ...base, targetSessions: 3, sessions: now, history: now, remainingDays: [] });
    assert.equal(over.inProgress, false);
    assert.match(over.headline, /계획은 3번이었습니다/);
  });

  it('놓친 날이 있으면 "채웁니다"라고 하지 않는다 — 목요일, 월만 하고 수를 놓쳤으면 금 하나로는 3번이 안 된다', () => {
    const now = [session('2026-09-21', [set('barbell-bench-press', 100, 8)])];
    const remainingDays = plannedDaysLeft({ planned: ['2026-09-21', '2026-09-23', '2026-09-25'], done: ['2026-09-21'], today: '2026-09-24' });
    assert.deepEqual(remainingDays, ['2026-09-25']);
    const report = buildWeeklyReport({ ...base, targetSessions: 3, sessions: now, history: now, remainingDays });
    assert.equal(report.headline, '3번 중 1번 했습니다 · 금 남음');
    assert.doesNotMatch(report.advice, /채웁니다/);
    assert.equal(report.advice, '남은 1번을 하면 이번 주 2번입니다.');
  });

  it('남은 날 — 오늘 이미 했으면 오늘은 빼고, 지난 날은 남은 날이 아니다', () => {
    const planned = ['2026-09-21', '2026-09-23', '2026-09-25'];
    assert.deepEqual(plannedDaysLeft({ planned, done: [], today: '2026-09-23' }), ['2026-09-23', '2026-09-25']);
    assert.deepEqual(plannedDaysLeft({ planned, done: ['2026-09-23'], today: '2026-09-23' }), ['2026-09-25']);
    assert.deepEqual(plannedDaysLeft({ planned, done: [], today: '2026-09-26' }), []);
    assert.equal(weekInProgress({ planned, done: ['2026-09-21'], today: '2026-09-21' }), true);
    assert.equal(weekInProgress({ planned, done: ['2026-09-21'], today: '2026-09-26' }), false);
    // 목표를 다 채웠으면 남은 날이 있어도 진행 중이 아니다
    assert.equal(weekInProgress({ planned, done: ['2026-09-21', '2026-09-22', '2026-09-23'], today: '2026-09-23', targetSessions: 3 }), false);
    assert.equal(weekdayKo('2026-09-23'), '수');
  });

  it('오른 종목이 있으면 그걸 제목으로 쓴다', () => {
    const before = [session('2026-09-14', [set('barbell-bench-press', 100, 8)])];
    const now = ['2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24'].map((date) =>
      session(date, [set('barbell-bench-press', 102.5, 8)]));
    const report = buildWeeklyReport({ ...base, sessions: now, history: before.concat(now) });
    assert.match(report.headline, /벤치프레스/);
    assert.match(report.headline, /\+2\.5kg/);
  });

  it('회복 한계를 넘긴 부위는 줄이라고 말한다', () => {
    const heavy = ['2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24'].map((date) =>
      session(date, Array.from({ length: 9 }, () => set('barbell-bench-press', 100, 8))));
    const report = buildWeeklyReport({ ...base, sessions: heavy, history: heavy });
    assert.match(report.advice, /줄이|늘리지/);
  });
});

describe('카톡에 붙여 넣을 글', () => {
  it('제목 · 숫자 · 지시가 다 들어간다', () => {
    const now = [session('2026-09-21', [set('barbell-bench-press', 100, 10)])];
    const report = buildWeeklyReport({ ...base, sessions: now, history: now });
    const text = reportText(report);
    assert.match(text, /볼륨 코치/);
    assert.match(text, /9월 4주차/);
    assert.ok(text.includes(report.headline));
    assert.ok(text.includes(report.advice));
  });

  it('구역을 사람 말로 쓴다', () => {
    assert.equal(zoneWord('underMev'), '부족');
    assert.equal(zoneWord('underMev', true), '진행 중');
    assert.equal(zoneWord('mevToMav'), '적정');
    assert.equal(zoneWord('overMrv'), '한계 초과');
  });
});
