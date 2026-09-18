import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildSession, primaryMuscle, type SessionTemplate } from '../session.ts';
import { planNextWeek, type WeeklyPlan } from '../mesocycle.ts';
import { landmarksFor } from '../muscles.ts';
import { exerciseById } from '../exercises.ts';
import { DEFAULT_GYM } from '../gym.ts';
import type { Exercise, PainReport, SessionLog } from '../types.ts';
import type { LifterProfile } from '../strength.ts';
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

interface BuildArgs {
  history?: SessionLog[];
  pain?: PainReport[];
  plan?: WeeklyPlan;
  lifter?: LifterProfile;
  gym?: typeof DEFAULT_GYM;
}

function build(args: BuildArgs = {}) {
  const history = args.history ?? [];
  return buildSession({
    template,
    date: '2026-09-21',
    plan: args.plan ?? planFrom(history, '2026-09-18'),
    history,
    index,
    pain: args.pain,
    lifter: args.lifter,
    gym: args.gym,
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

  it('추정할 근거가 아무것도 없으면 중량을 비워두고 탐색 세트를 안내한다', () => {
    const bench = build().exercises[0]!;
    assert.equal(bench.sets[0]?.weightKg, null);
    assert.match(bench.note, /탐색 세트/);
  });

  it('체중과 경력만 있어도 첫 중량을 제안한다', () => {
    const lifter: LifterProfile = { bodyweightKg: 75, level: 'beginner', sex: 'male' };
    const bench = build({ lifter, gym: DEFAULT_GYM }).exercises[0]!;

    assert.equal(bench.startingLoad?.method, 'bodyweight-ratio');
    assert.ok((bench.sets[0]?.weightKg ?? 0) > 20, '빈 바보다는 무겁다');
    assert.ok((bench.sets[0]?.weightKg ?? 0) < 60, '초급자에게 위험한 중량은 제안하지 않는다');
    assert.equal(bench.startingLoad?.needsCalibration, true, '추정값은 항상 확인을 요구한다');
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
    assert.ok(planned.warnings.some((w) => w.text.includes('어깨')));

    // 어깨 부담이 큰 종목은 전부 걸러진다 — 벤치프레스도 예외가 아니다.
    assert.ok(
      planned.exercises.every((item) => (item.exercise.jointStress.shoulder ?? 0) < 0.6),
    );
  });

  it('대체 종목의 첫 중량을 원래 종목 기록에서 환산하고 근거를 남긴다', () => {
    const planned = build({ history, pain: [{ joint: 'shoulder', score: 4 }] });
    const swapped = planned.exercises.find(
      (item) => item.substitutedFrom?.id === 'barbell-overhead-press',
    )!;

    assert.equal(swapped.startingLoad?.method, 'related-lift');
    assert.ok((swapped.sets[0]?.weightKg ?? 0) > 0);
    assert.equal(swapped.startingLoad?.needsCalibration, true);
    assert.match(swapped.note, /참고: 바벨 오버헤드프레스 50kg × 10회/);
    assert.equal(swapped.swapReason, 'pain');
  });

  it('대체할 종목이 없으면 그 종목을 빼고 이유를 알린다', () => {
    const planned = build({ history, pain: [{ joint: 'shoulder', score: 9 }] });

    assert.ok(!planned.exercises.some((item) => item.exercise.id === 'barbell-overhead-press'));
    assert.ok(planned.warnings.some((w) => w.text.includes('전문의')));
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
    assert.ok(planned.warnings.some((w) => w.text.includes('디로드')));
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

describe('헬스장 기구 반영', () => {
  const lifter: LifterProfile = { bodyweightKg: 80, level: 'intermediate', sex: 'male' };

  it('처방 중량을 그 기구가 실제로 만들 수 있는 값으로 맞춘다', () => {
    const history = [
      session('2026-09-14', sets('barbell-bench-press', 4, { weightKg: 80, reps: 10, rir: 4 })),
    ];
    const bench = build({ history, gym: DEFAULT_GYM, lifter }).exercises
      .find((item) => item.exercise.id === 'barbell-bench-press')!;

    const weight = bench.sets[0]!.weightKg!;
    assert.equal((weight - 20) % 2.5, 0, '20kg 바에 좌우 대칭으로 끼울 수 있는 값이어야 한다');
    assert.ok(weight > 80, '증량 처방이었으므로 올라가야 한다');
  });

  it('바벨 종목에는 한쪽에 끼울 플레이트를 같이 준다', () => {
    const history = [
      session('2026-09-14', sets('barbell-bench-press', 4, { weightKg: 80, reps: 10, rir: 4 })),
    ];
    const bench = build({ history, gym: DEFAULT_GYM, lifter }).exercises
      .find((item) => item.exercise.id === 'barbell-bench-press')!;

    assert.ok(bench.plates, '플레이트 계산 결과가 있어야 한다');
    assert.equal(bench.plates!.baseKg, 20);
    assert.equal(
      bench.plates!.baseKg + bench.plates!.perSide.reduce((sum, p) => sum + p, 0) * 2,
      bench.sets[0]!.weightKg,
      '플레이트 합계가 처방 중량과 일치해야 한다',
    );
  });

  it('스택 머신에는 플레이트 계산을 주지 않는다', () => {
    const planned = build({ gym: DEFAULT_GYM, lifter });
    const pushdown = planned.exercises.find((item) => item.exercise.id === 'triceps-pushdown')!;
    assert.equal(pushdown.plates, null);
  });

  it('헬스장에 없는 종목은 있는 종목으로 대체하고 이유를 알린다', () => {
    const gym = {
      ...DEFAULT_GYM,
      overrides: { ...DEFAULT_GYM.overrides, 'barbell-bench-press': 'unavailable' as const },
    };
    const planned = build({ gym, lifter });

    assert.ok(!planned.exercises.some((item) => item.exercise.id === 'barbell-bench-press'));
    const swapped = planned.exercises.find((item) => item.swapReason === 'unavailable')!;
    assert.equal(swapped.substitutedFrom?.id, 'barbell-bench-press');
    assert.ok(planned.warnings.some((w) => w.kind === 'equipment'));
  });

  it('없는 기구 종류는 대체 후보에서도 빠진다', () => {
    const gym = { ...DEFAULT_GYM, missingEquipment: ['machine' as const, 'smith' as const] };
    const planned = build({ gym, lifter, pain: [{ joint: 'shoulder', score: 4 }] });

    assert.ok(planned.exercises.every((item) => item.exercise.equipment !== 'machine'));
  });

  it('디로드 배율이 걸리면 기구 눈금에서 아래쪽으로 붙인다', () => {
    const history = [
      session('2026-09-14', sets('barbell-bench-press', 4, { weightKg: 100, reps: 8, rir: 2 })),
    ];
    const deloadPlan: WeeklyPlan = {
      ...planFrom(history, '2026-09-18'),
      phase: 'deload',
      targetRir: 4,
      intensityMultiplier: 0.9,
    };
    const bench = build({ history, plan: deloadPlan, gym: DEFAULT_GYM, lifter }).exercises
      .find((item) => item.exercise.id === 'barbell-bench-press')!;

    assert.ok(bench.sets[0]!.weightKg! <= 90, '반올림으로 디로드 의도를 되돌리지 않는다');
  });
});

describe('세션 경고', () => {
  it('경고마다 성격을 붙여 UI가 구분할 수 있게 한다', () => {
    const gym = {
      ...DEFAULT_GYM,
      overrides: { ...DEFAULT_GYM.overrides, 'barbell-bench-press': 'unavailable' as const },
    };
    const planned = build({
      gym,
      lifter: { bodyweightKg: 80, level: 'intermediate' },
      pain: [{ joint: 'shoulder', score: 8 }],
    });

    assert.ok(planned.warnings.some((w) => w.kind === 'equipment'));
    assert.ok(planned.warnings.some((w) => w.kind === 'pain' && w.medical));
  });

  it('대체 안내에 조사를 맞춘다', () => {
    const history = [
      session('2026-09-14', sets('barbell-overhead-press', 3, { weightKg: 50, reps: 10, rir: 2 })),
    ];
    const planned = build({ history, pain: [{ joint: 'shoulder', score: 4 }] });
    for (const warning of planned.warnings) {
      assert.ok(!warning.text.includes('(를)'), warning.text);
      assert.ok(!warning.text.includes('(는)'), warning.text);
      assert.ok(!warning.text.includes('(으)로'), warning.text);
    }
  });
});
