import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildWeeklyReport, reportText, weekLabelOf, zoneWord } from '../weeklyReport.ts';
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
    assert.equal(zoneWord('mevToMav'), '적정');
    assert.equal(zoneWord('overMrv'), '한계 초과');
  });
});
