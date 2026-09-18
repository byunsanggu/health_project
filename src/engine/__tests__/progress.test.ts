import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { liftProgress, personalRecords, totalVolumeTrend, volumeTrend } from '../progress.ts';
import { index, session, sets } from './helpers.ts';
import type { SessionLog } from '../types.ts';

const BENCH = 'barbell-bench-press';

/** 4주에 걸쳐 조금씩 무거워진 이력. */
const improving: SessionLog[] = [
  session('2026-08-24', sets(BENCH, 3, { weightKg: 80, reps: 8, rir: 2 })),
  session('2026-08-31', sets(BENCH, 3, { weightKg: 82.5, reps: 8, rir: 2 })),
  session('2026-09-07', sets(BENCH, 3, { weightKg: 85, reps: 8, rir: 2 })),
  session('2026-09-14', sets(BENCH, 3, { weightKg: 87.5, reps: 8, rir: 2 })),
];

describe('liftProgress', () => {
  it('세션별 최고 세트로 추이를 만든다', () => {
    const progress = liftProgress(improving, index)[0]!;
    assert.equal(progress.exerciseId, BENCH);
    assert.equal(progress.name, '바벨 벤치프레스');
    assert.equal(progress.points.length, 4, '세션당 한 점');
    assert.ok(progress.points[0]!.date < progress.points[3]!.date, '날짜순으로 정렬한다');
  });

  it('그날의 뒤 세트는 추이에 넣지 않는다', () => {
    const mixed = [
      session('2026-09-14',
        [{ exerciseId: BENCH, weightKg: 90, reps: 8, rir: 1 }],
        [{ exerciseId: BENCH, weightKg: 90, reps: 5, rir: 0 }]),
      session('2026-09-21', sets(BENCH, 1, { weightKg: 92.5, reps: 8, rir: 1 })),
    ];
    const progress = liftProgress(mixed, index)[0]!;
    assert.equal(progress.points.length, 2);
    assert.ok(progress.points[0]!.value > 100, '피로가 섞인 세트가 아니라 최고 세트를 쓴다');
  });

  it('변화율과 방향을 계산한다', () => {
    const progress = liftProgress(improving, index)[0]!;
    assert.ok(progress.changePercent > 5);
    assert.equal(progress.trend, 'up');
    assert.equal(progress.best, progress.latest);
  });

  it('떨어지면 down으로 잡는다', () => {
    const declining = [...improving].reverse().map((log, i) => ({
      ...log,
      date: `2026-09-0${i + 1}`,
    }));
    assert.equal(liftProgress(declining, index)[0]!.trend, 'down');
  });

  it('세션이 하나뿐인 종목은 추이로 보지 않는다', () => {
    const single = [session('2026-09-14', sets(BENCH, 3, { weightKg: 80, reps: 8, rir: 2 }))];
    assert.equal(liftProgress(single, index).length, 0);
    assert.equal(liftProgress(single, index, { minSessions: 1 }).length, 1);
  });

  it('워밍업은 빼고 본다', () => {
    const withWarmup = [
      session('2026-09-07', [{ exerciseId: BENCH, weightKg: 200, reps: 1, rir: 0, warmup: true }],
        [{ exerciseId: BENCH, weightKg: 80, reps: 8, rir: 2 }]),
      session('2026-09-14', sets(BENCH, 1, { weightKg: 82.5, reps: 8, rir: 2 })),
    ];
    assert.ok(liftProgress(withWarmup, index)[0]!.points[0]!.value < 150);
  });

  it('RIR 보정을 추이에도 반영한다', () => {
    const raw = liftProgress(improving, index)[0]!.latest;
    const corrected = liftProgress(improving, index, { rirOffset: -2 })[0]!.latest;
    assert.ok(corrected < raw, '실제로는 여유가 없었으므로 추정치가 낮아진다');
  });

  it('기간을 자를 수 있다', () => {
    const recent = liftProgress(improving, index, { from: '2026-09-01' })[0]!;
    assert.equal(recent.points.length, 2);
  });
});

describe('volumeTrend', () => {
  it('부위별 주간 볼륨을 주 단위로 준다', () => {
    const trend = volumeTrend(improving, index, 'chest');
    assert.equal(trend.length, 4);
    assert.ok(trend.every((point) => point.sets === 3));
    assert.ok(trend[0]!.weekStart < trend[3]!.weekStart);
  });

  it('건드리지 않은 부위는 0으로 나온다', () => {
    assert.ok(volumeTrend(improving, index, 'quads').every((point) => point.sets === 0));
  });

  it('전체 볼륨 추이도 센다', () => {
    const total = totalVolumeTrend(improving, index);
    assert.equal(total.length, 4);
    assert.equal(total[0]!.sets, 3);
  });
});

describe('personalRecords', () => {
  it('종목별 최고 기록을 고른다', () => {
    const records = personalRecords(improving, index);
    assert.equal(records.length, 1);
    assert.equal(records[0]!.weightKg, 87.5);
    assert.equal(records[0]!.date, '2026-09-14');
    assert.equal(records[0]!.isRecent, true, '마지막 세션에 세운 기록');
  });

  it('추정 1RM이 높은 순으로 준다', () => {
    const multi = [
      session('2026-09-14',
        sets(BENCH, 1, { weightKg: 100, reps: 5, rir: 0 }),
        sets('back-squat', 1, { weightKg: 140, reps: 5, rir: 0 })),
    ];
    const records = personalRecords(multi, index);
    assert.equal(records[0]!.exerciseId, 'back-squat');
    assert.ok(records[0]!.estimated1RM > records[1]!.estimated1RM);
  });

  it('예전에 세운 기록은 최근 표시가 붙지 않는다', () => {
    const stale = [
      session('2026-08-24', sets(BENCH, 1, { weightKg: 100, reps: 5, rir: 0 })),
      session('2026-09-14', sets(BENCH, 1, { weightKg: 80, reps: 5, rir: 2 })),
    ];
    assert.equal(personalRecords(stale, index)[0]!.isRecent, false);
  });
});
