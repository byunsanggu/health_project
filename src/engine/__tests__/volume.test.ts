import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  aggregateVolume,
  groupByWeek,
  sessionsInWeek,
  setEffectiveness,
  volumeReport,
  weekStart,
} from '../volume.ts';
import { landmarksFor } from '../muscles.ts';
import { index, session, sets } from './helpers.ts';

describe('setEffectiveness', () => {
  it('워밍업 세트는 볼륨에 세지 않는다', () => {
    assert.equal(
      setEffectiveness({ exerciseId: 'barbell-bench-press', weightKg: 40, reps: 10, rir: 5, warmup: true }),
      0,
    );
  });

  it('실패에 가까운 세트가 온전한 1세트다', () => {
    assert.equal(setEffectiveness({ exerciseId: 'x', weightKg: 80, reps: 10, rir: 2 }), 1);
    assert.equal(setEffectiveness({ exerciseId: 'x', weightKg: 80, reps: 10, rir: 3 }), 1);
  });

  it('RIR이 클수록 자극이 떨어져 가중치가 깎인다', () => {
    const rir4 = setEffectiveness({ exerciseId: 'x', weightKg: 80, reps: 10, rir: 4 });
    const rir6 = setEffectiveness({ exerciseId: 'x', weightKg: 80, reps: 10, rir: 6 });
    assert.ok(rir4 < 1 && rir4 > rir6);
    assert.ok(rir6 > 0, '가벼운 세트도 0은 아니다');
  });

  it('근비대 반복 범위를 벗어나면 가중치가 낮아진다', () => {
    const heavy = setEffectiveness({ exerciseId: 'x', weightKg: 140, reps: 3, rir: 1 });
    const endurance = setEffectiveness({ exerciseId: 'x', weightKg: 20, reps: 40, rir: 1 });
    assert.ok(heavy < 1);
    assert.ok(endurance < heavy);
  });
});

describe('aggregateVolume', () => {
  it('주동근과 협응근에 기여도만큼 나눠 센다', () => {
    const log = session('2026-09-14', sets('barbell-bench-press', 4, { weightKg: 80, reps: 8, rir: 2 }));
    const totals = aggregateVolume([log], index);

    assert.equal(totals.chest.effectiveSets, 4, '가슴은 주동근이라 4세트 전부');
    assert.equal(totals.chest.directSets, 4);
    assert.equal(totals.triceps.effectiveSets, 2, '삼두는 기여도 0.5라 2세트');
    assert.equal(totals.triceps.directSets, 0, '삼두는 주동근이 아니다');
    assert.equal(totals.quads.effectiveSets, 0);
  });

  it('같은 부위를 때리는 여러 종목의 볼륨이 합산된다', () => {
    const log = session(
      '2026-09-14',
      sets('barbell-bench-press', 3, { weightKg: 80, reps: 8, rir: 2 }),
      sets('pec-deck', 3, { weightKg: 40, reps: 12, rir: 1 }),
    );
    assert.equal(aggregateVolume([log], index).chest.effectiveSets, 6);
  });

  it('상위 기여 종목을 많은 순으로 돌려준다', () => {
    const log = session(
      '2026-09-14',
      sets('barbell-bench-press', 2, { weightKg: 80, reps: 8, rir: 2 }),
      sets('pec-deck', 4, { weightKg: 40, reps: 12, rir: 1 }),
    );
    const top = aggregateVolume([log], index).chest.topExercises;
    assert.equal(top[0]?.exerciseId, 'pec-deck');
    assert.equal(top[0]?.sets, 4);
  });

  it('알 수 없는 운동 id는 조용히 무시한다', () => {
    const log = session('2026-09-14', sets('does-not-exist', 5, { weightKg: 50, reps: 10, rir: 2 }));
    const totals = aggregateVolume([log], index);
    assert.equal(totals.chest.effectiveSets, 0);
  });
});

describe('volumeReport', () => {
  const landmarks = landmarksFor('intermediate');

  it('랜드마크 대비 구간을 판정한다', () => {
    const light = session('2026-09-14', sets('pec-deck', 3, { weightKg: 40, reps: 12, rir: 1 }));
    const chest = volumeReport([light], landmarks, index).find((r) => r.muscle === 'chest');
    assert.equal(chest?.zone, 'underMev');

    // 상한에 걸리지 않게 세 번에 나눠 24세트를 수행한 주
    const heavy = [0, 2, 4].map((offset) =>
      session('2026-09-1' + (4 + offset), sets('pec-deck', 8, { weightKg: 40, reps: 12, rir: 1 })),
    );
    const overloaded = volumeReport(heavy, landmarks, index).find((r) => r.muscle === 'chest');
    assert.equal(overloaded?.zone, 'overMrv');
    assert.ok((overloaded?.mrvRatio ?? 0) > 1);
  });
});

describe('주 단위 묶기', () => {
  it('월요일을 주의 시작으로 본다', () => {
    assert.equal(weekStart('2026-09-17'), '2026-09-14', '목요일 → 그 주 월요일');
    assert.equal(weekStart('2026-09-14'), '2026-09-14', '월요일은 그대로');
    assert.equal(weekStart('2026-09-20'), '2026-09-14', '일요일은 앞선 월요일로');
  });

  it('주별로 세션을 묶고 날짜순으로 정렬한다', () => {
    const logs = [
      session('2026-09-21', sets('pec-deck', 1, { weightKg: 40, reps: 10, rir: 2 })),
      session('2026-09-14', sets('pec-deck', 1, { weightKg: 40, reps: 10, rir: 2 })),
      session('2026-09-16', sets('pec-deck', 1, { weightKg: 40, reps: 10, rir: 2 })),
    ];
    const weeks = [...groupByWeek(logs).keys()];
    assert.deepEqual(weeks, ['2026-09-14', '2026-09-21']);
    assert.equal(sessionsInWeek(logs, '2026-09-17').length, 2);
  });
});
