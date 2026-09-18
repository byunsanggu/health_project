import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildSession, primaryMuscle, type SessionTemplate } from '../session.ts';
import { planNextWeek, type WeeklyPlan } from '../mesocycle.ts';
import { landmarksFor } from '../muscles.ts';
import { exerciseById } from '../exercises.ts';
import type { Exercise, PainReport, SessionLog } from '../types.ts';
import { index, session, sets } from './helpers.ts';

const landmarks = landmarksFor('intermediate');

const template: SessionTemplate = {
  name: '상체 A',
  slots: [
    { exerciseId: 'barbell-bench-press', sets: 4, repRange: { min: 6, max: 10 } },
    { exerciseId: 'barbell-overhead-press', sets: 3, repRange: { min: 8, max: 12 } },
    { exerciseId: 'triceps-pushdown', sets: 3, repRange: { min: 10, max: 15 } },
  ],
};

function planFrom(history: SessionLog[], asOf: string, weekInBlock = 2): WeeklyPlan {
  return planNextWeek({ sessions: history, index, landmarks, asOf, weekInBlock });
}

function build(args: { history?: SessionLog[]; pain?: PainReport[]; plan?: WeeklyPlan } = {}) {
  const history = args.history ?? [];
  return buildSession({
    template,
    date: '2026-09-21',
    plan: args.plan ?? planFrom(history, '2026-09-18'),
    history,
    index,
    pain: args.pain,
  });
}

describe('buildSession', () => {
  it('템플릿의 모든 종목을 처방한다', () => {
    const planned = build();
    assert.deepEqual(
      planned.exercises.map((item) => item.exercise.id),
      template.slots.map((slot) => slot.exerciseId),
    );
  });

  it('첫 수행 종목은 중량을 비워두고 사용자가 정하게 한다', () => {
    const planned = build();
    const bench = planned.exercises[0]!;
    assert.equal(bench.sets[0]?.weightKg, null);
    assert.match(bench.note, /첫 수행/);
  });

  it('직전 기록을 바탕으로 다음 중량을 정한다', () => {
    const history = [
      session('2026-09-14', sets('barbell-bench-press', 4, { weightKg: 80, reps: 10, rir: 3 })),
    ];
    const bench = build({ history }).exercises.find((e) => e.exercise.id === 'barbell-bench-press')!;
    assert.equal(bench.sets[0]?.weightKg, 82.5, '목표 상단 + 여유 → 증량');
  });

  it('모든 세트에 그 주의 목표 RIR이 붙는다', () => {
    const planned = build();
    for (const exercise of planned.exercises) {
      for (const set of exercise.sets) {
        assert.equal(set.targetRir, planned.targetRir);
      }
    }
  });

  it('세트 번호는 1부터 이어진다', () => {
    const planned = build();
    for (const exercise of planned.exercises) {
      assert.deepEqual(
        exercise.sets.map((set) => set.setNumber),
        exercise.sets.map((_, i) => i + 1),
      );
    }
  });
});

describe('통증 대응', () => {
  const history = [
    session('2026-09-14', sets('barbell-overhead-press', 3, { weightKg: 50, reps: 10, rir: 2 })),
  ];

  it('아픈 관절에 부담이 큰 종목을 대체 종목으로 바꾼다', () => {
    const planned = build({ history, pain: [{ joint: 'shoulder', score: 4 }] });
    const swapped = planned.exercises.find(
      (item) => item.substitutedFrom?.id === 'barbell-overhead-press',
    );

    assert.ok(swapped, '오버헤드프레스가 교체되어야 한다');
    assert.ok((swapped!.exercise.jointStress.shoulder ?? 0) < 0.6);
    assert.ok(planned.warnings.some((w) => w.includes('어깨')));

    // 어깨 부담이 큰 종목은 전부 걸러진다 — 벤치프레스도 예외가 아니다.
    assert.ok(
      planned.exercises.every((item) => (item.exercise.jointStress.shoulder ?? 0) < 0.6),
    );
  });

  it('대체 종목에는 원래 종목의 마지막 기록을 참고로 붙인다', () => {
    const planned = build({ history, pain: [{ joint: 'shoulder', score: 4 }] });
    const swapped = planned.exercises.find(
      (item) => item.substitutedFrom?.id === 'barbell-overhead-press',
    )!;

    assert.equal(swapped.sets[0]?.weightKg, null, '다른 종목의 중량을 임의로 환산하지 않는다');
    assert.match(swapped.note, /참고: 바벨 오버헤드프레스 50kg × 10회/);
  });

  it('대체할 종목이 없으면 그 종목을 빼고 이유를 알린다', () => {
    const planned = build({ history, pain: [{ joint: 'shoulder', score: 9 }] });

    assert.ok(!planned.exercises.some((item) => item.exercise.id === 'barbell-overhead-press'));
    assert.ok(planned.warnings.some((w) => w.includes('전문의')));
  });

  it('중간 부하 관절의 통증은 종목을 유지하고 중량만 낮춘다', () => {
    const benchHistory = [
      session('2026-09-14', sets('barbell-bench-press', 4, { weightKg: 80, reps: 8, rir: 2 })),
    ];
    // 벤치프레스의 손목 부하는 0.4 — 대체까지 갈 정도는 아니고 감량 대상이다.
    const planned = build({ history: benchHistory, pain: [{ joint: 'wrist', score: 4 }] });
    const bench = planned.exercises.find((e) => e.exercise.id === 'barbell-bench-press')!;

    assert.equal(bench.painRuling.action, 'reduceLoad');
    assert.equal(bench.sets[0]?.weightKg, 72.5, '80kg 유지 처방에 0.9 배율');
  });

  it('통증 판정은 부하 계산보다 먼저 적용된다', () => {
    // 증량 조건을 충족한 기록이지만 통증이 있으면 최종 중량은 직전보다 높지 않아야 한다.
    const benchHistory = [
      session('2026-09-14', sets('barbell-bench-press', 4, { weightKg: 80, reps: 10, rir: 4 })),
    ];
    const planned = build({ history: benchHistory, pain: [{ joint: 'wrist', score: 4 }] });
    const bench = planned.exercises.find((e) => e.exercise.id === 'barbell-bench-press')!;
    assert.ok((bench.sets[0]?.weightKg ?? 0) <= 80);
  });
});

describe('디로드 주 세션', () => {
  it('중량을 90%로 낮추고 경고에 근거를 담는다', () => {
    const history = [
      session('2026-09-14', sets('barbell-bench-press', 4, { weightKg: 100, reps: 8, rir: 2 })),
    ];
    const deloadPlan: WeeklyPlan = {
      ...planFrom(history, '2026-09-18'),
      phase: 'deload',
      targetRir: 4,
      intensityMultiplier: 0.9,
      summary: '디로드 주간입니다',
    };
    const planned = build({ history, plan: deloadPlan });
    const bench = planned.exercises.find((e) => e.exercise.id === 'barbell-bench-press')!;

    assert.equal(planned.phase, 'deload');
    assert.equal(bench.sets[0]?.weightKg, 90);
    assert.equal(bench.sets[0]?.targetRir, 4);
    assert.ok(planned.warnings.some((w) => w.includes('디로드')));
  });
});

describe('세트 수 조정', () => {
  it('주간 처방을 반영하되 한 번에 ±2세트를 넘지 않는다', () => {
    // 지난주 가슴 볼륨이 매우 낮으면 처방 배율이 크게 잡히지만, 적용은 제한된다.
    const history = [session('2026-09-14', sets('pec-deck', 1, { weightKg: 40, reps: 10, rir: 2 }))];
    const planned = build({ history });
    const bench = planned.exercises.find((e) => e.exercise.id === 'barbell-bench-press')!;

    assert.ok(bench.sets.length >= 2 && bench.sets.length <= 6);
    assert.ok(Math.abs(bench.sets.length - 4) <= 2);
  });

  it('세트 수는 최소 1세트를 보장한다', () => {
    for (const exercise of build().exercises) {
      assert.ok(exercise.sets.length >= 1);
    }
  });
});

describe('primaryMuscle', () => {
  it('기여도가 가장 높은 근육을 고른다', () => {
    assert.equal(primaryMuscle(exerciseById('barbell-bench-press') as Exercise), 'chest');
    assert.equal(primaryMuscle(exerciseById('lying-leg-curl') as Exercise), 'hamstrings');
    assert.equal(primaryMuscle(exerciseById('lateral-raise') as Exercise), 'sideDelt');
  });
});
