import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { planNextWeek } from '../mesocycle.ts';
import { assessFatigue, droppedLifts } from '../readiness.ts';
import { landmarksFor } from '../muscles.ts';
import { addDays } from '../volume.ts';
import type { CheckIn, MuscleGroup, SessionLog } from '../types.ts';
import { index, session, sets } from './helpers.ts';

const landmarks = landmarksFor('intermediate');

/**
 * 가슴을 n 세트 수행한 한 주를 만든다 (펙덱 = 가슴 전용이라 계산이 깔끔하다).
 * 세션당 상한에 걸리지 않도록 실제 분할처럼 2~3회로 나눈다.
 */
function chestWeek(monday: string, setCount: number, weightKg = 40): SessionLog[] {
  return spreadWeek(monday, 'pec-deck', setCount, weightKg);
}

function spreadWeek(monday: string, exerciseId: string, setCount: number, weightKg: number): SessionLog[] {
  const days = setCount <= 9 ? [0] : setCount <= 18 ? [0, 3] : [0, 2, 4];
  const perDay = Math.ceil(setCount / days.length);
  let left = setCount;

  return days
    .map((offset) => {
      const n = Math.min(perDay, left);
      left -= n;
      return session(addDays(monday, offset), sets(exerciseId, n, { weightKg, reps: 10, rir: 2 }));
    })
    .filter((log) => log.sets.length > 0);
}

function plan(args: {
  sessions: SessionLog[];
  asOf: string;
  weekInBlock: number;
  checkIns?: CheckIn[];
  painfulMuscles?: MuscleGroup[];
  lastWeekPhase?: 'accumulation' | 'deload';
}) {
  return planNextWeek({
    sessions: args.sessions,
    checkIns: args.checkIns,
    index,
    landmarks,
    asOf: args.asOf,
    weekInBlock: args.weekInBlock,
    painfulMuscles: args.painfulMuscles,
    lastWeekPhase: args.lastWeekPhase,
  });
}

/** 볼륨을 줄인 디로드 주를 보내고 난 직후의 이력. */
function afterDeload(): SessionLog[] {
  return [
    // 축적 주: 정상 수행
    session('2026-09-07', sets('barbell-bench-press', 4, { weightKg: 90, reps: 10, rir: 1 })),
    session('2026-09-09', sets('back-squat', 4, { weightKg: 140, reps: 8, rir: 1 })),
    // 디로드 주: 볼륨 절반, 중량 90% → 기록이 낮게 남는 것이 정상이다
    session('2026-09-14', sets('barbell-bench-press', 2, { weightKg: 81, reps: 8, rir: 4 })),
    session('2026-09-16', sets('back-squat', 2, { weightKg: 126, reps: 6, rir: 4 })),
  ];
}

function chestPlan(result: ReturnType<typeof plan>) {
  return result.volume.find((item) => item.muscle === 'chest')!;
}

describe('볼륨 진행', () => {
  it('MEV 미만이면 최소 자극선까지 끌어올린다', () => {
    const result = plan({ sessions: chestWeek('2026-09-14', 4), asOf: '2026-09-14', weekInBlock: 1 });
    const chest = chestPlan(result);
    assert.equal(chest.zone, 'underMev');
    assert.equal(chest.prescribedSets, landmarks.chest.mev);
  });

  it('적정 구간에서는 주당 2세트씩 올린다', () => {
    const result = plan({ sessions: chestWeek('2026-09-14', 12), asOf: '2026-09-14', weekInBlock: 1 });
    const chest = chestPlan(result);
    assert.equal(chest.zone, 'mevToMav');
    assert.equal(chest.deltaSets, 2);
  });

  it('MAV를 넘어선 고강도 구간에서는 1세트만 올린다', () => {
    const result = plan({ sessions: chestWeek('2026-09-14', 18), asOf: '2026-09-14', weekInBlock: 1 });
    const chest = chestPlan(result);
    assert.equal(chest.zone, 'mavToMrv');
    assert.equal(chest.deltaSets, 1);
  });

  it('MAV를 넘기지 않는다', () => {
    const result = plan({ sessions: chestWeek('2026-09-14', 15), asOf: '2026-09-14', weekInBlock: 1 });
    assert.ok(chestPlan(result).prescribedSets <= landmarks.chest.mav);
  });

  it('통증이 보고된 부위는 볼륨을 올리지 않는다', () => {
    const result = plan({
      sessions: chestWeek('2026-09-14', 12),
      asOf: '2026-09-14',
      weekInBlock: 1,
      painfulMuscles: ['chest'],
    });
    assert.equal(chestPlan(result).action, 'hold');
    assert.match(chestPlan(result).rationale, /통증/);
  });
});

describe('디로드 판정', () => {
  it('한 부위만 MRV를 넘겼으면 전신 디로드가 아니라 그 부위만 되돌린다', () => {
    const result = plan({ sessions: chestWeek('2026-09-14', 30), asOf: '2026-09-14', weekInBlock: 3 });

    assert.equal(result.phase, 'accumulation', '가슴 하나 때문에 전신을 쉬게 하지 않는다');
    assert.equal(chestPlan(result).prescribedSets, landmarks.chest.mrv);
    assert.ok(result.fatigue.signals.some((s) => s.id === 'volumeOverMrv'));
  });

  it('여러 부위가 동시에 MRV를 넘기면 전신 디로드로 전환한다', () => {
    const everything = [
      ...spreadWeek('2026-09-14', 'pec-deck', 27, 40),
      ...spreadWeek('2026-09-14', 'lying-leg-curl', 24, 40),
      ...spreadWeek('2026-09-14', 'barbell-curl', 24, 30),
    ];
    const result = plan({ sessions: everything, asOf: '2026-09-14', weekInBlock: 3 });

    assert.equal(result.phase, 'deload');
    assert.equal(result.weekInBlock, 0, '디로드는 블록 주차를 0으로 되돌린다');
    assert.equal(result.targetRir, 4);
    assert.equal(result.intensityMultiplier, 0.9, '중량은 유지에 가깝게 — 줄이는 건 볼륨이다');
    assert.ok(chestPlan(result).prescribedSets < 27);
  });

  it('신호가 없어도 계획된 축적 주차를 채우면 디로드한다', () => {
    const result = plan({ sessions: chestWeek('2026-09-14', 12), asOf: '2026-09-14', weekInBlock: 5 });
    assert.equal(result.phase, 'accumulation', '블록 길이만으로는 임계에 못 미친다');

    const withPain = plan({
      sessions: chestWeek('2026-09-14', 12),
      asOf: '2026-09-14',
      weekInBlock: 5,
      checkIns: [
        { date: '2026-09-12', pain: [{ joint: 'shoulder', score: 4 }] },
        { date: '2026-09-14', pain: [{ joint: 'shoulder', score: 4 }] },
      ],
    });
    assert.equal(withPain.phase, 'deload', '블록 길이 + 통증이면 디로드');
  });

  it('수행력이 떨어지고 회복이 부족하면 디로드한다', () => {
    const sessions = [
      // 지난주: 잘 나왔다
      session('2026-09-07', sets('barbell-bench-press', 3, { weightKg: 90, reps: 10, rir: 1 })),
      session('2026-09-09', sets('back-squat', 3, { weightKg: 140, reps: 8, rir: 1 })),
      // 이번주: 같은 중량에서 반복이 줄었다
      session('2026-09-14', sets('barbell-bench-press', 3, { weightKg: 90, reps: 6, rir: 0 })),
      session('2026-09-16', sets('back-squat', 3, { weightKg: 140, reps: 5, rir: 0 })),
    ];
    const result = plan({
      sessions,
      asOf: '2026-09-16',
      weekInBlock: 4,
      checkIns: [
        { date: '2026-09-14', sleepHours: 5, soreness: 8 },
        { date: '2026-09-16', sleepHours: 5.5, soreness: 8 },
      ],
    });

    assert.equal(result.phase, 'deload');
    const ids = result.fatigue.signals.map((s) => s.id);
    assert.ok(ids.includes('performanceDrop'));
    assert.ok(ids.includes('poorRecovery'));
  });

  it('컨디션이 멀쩡하면 디로드하지 않는다', () => {
    const sessions = [
      session('2026-09-07', sets('barbell-bench-press', 3, { weightKg: 90, reps: 8, rir: 2 })),
      session('2026-09-14', sets('barbell-bench-press', 3, { weightKg: 92.5, reps: 8, rir: 2 })),
    ];
    const result = plan({
      sessions,
      asOf: '2026-09-14',
      weekInBlock: 2,
      checkIns: [{ date: '2026-09-14', sleepHours: 7.5, soreness: 3, motivation: 8 }],
    });
    assert.equal(result.phase, 'accumulation');
    assert.equal(result.fatigue.deloadRecommended, false);
  });

  it('디로드 근거를 사용자에게 설명한다', () => {
    const result = plan({
      sessions: chestWeek('2026-09-14', 12),
      asOf: '2026-09-14',
      weekInBlock: 5,
      checkIns: [
        { date: '2026-09-12', pain: [{ joint: 'shoulder', score: 4 }] },
        { date: '2026-09-14', pain: [{ joint: 'shoulder', score: 4 }] },
      ],
    });
    assert.match(result.summary, /디로드/);
    assert.ok(result.fatigue.signals.length > 0);
    assert.ok(result.fatigue.signals.every((signal) => signal.label.length > 0));
  });
});

describe('주차별 목표 RIR', () => {
  it('블록이 진행될수록 실패에 가까워진다', () => {
    const rirByWeek = [1, 2, 3, 4].map(
      (week) => plan({ sessions: chestWeek('2026-09-14', 12), asOf: '2026-09-14', weekInBlock: week }).targetRir,
    );
    assert.deepEqual(rirByWeek, [2, 2, 1, 1]);
    assert.ok(rirByWeek[0]! >= rirByWeek[3]!);
  });
});

describe('droppedLifts', () => {
  it('추정 1RM이 떨어진 종목만 집어낸다', () => {
    const lastWeek = [session('2026-09-07', sets('back-squat', 1, { weightKg: 140, reps: 8, rir: 1 }))];
    const thisWeek = [session('2026-09-14', sets('back-squat', 1, { weightKg: 140, reps: 5, rir: 0 }))];
    assert.deepEqual(droppedLifts(thisWeek, lastWeek), ['back-squat']);
    assert.deepEqual(droppedLifts(lastWeek, thisWeek), [], '올라간 경우는 잡지 않는다');
  });

  it('이번 주에 안 한 종목은 비교 대상이 아니다', () => {
    const lastWeek = [session('2026-09-07', sets('back-squat', 1, { weightKg: 140, reps: 8, rir: 1 }))];
    const thisWeek = [session('2026-09-14', sets('pec-deck', 1, { weightKg: 40, reps: 10, rir: 2 }))];
    assert.deepEqual(droppedLifts(thisWeek, lastWeek), []);
  });
});

describe('assessFatigue', () => {
  it('데이터가 전혀 없으면 디로드를 권하지 않는다', () => {
    const result = assessFatigue({
      sessions: [], index, landmarks, asOf: '2026-09-14', weekInBlock: 1,
    });
    assert.equal(result.score, 0);
    assert.equal(result.deloadRecommended, false);
  });
});

describe('프로그램 커버리지', () => {
  it('최근 4주간 안 한 부위에는 볼륨을 처방하지 않고 따로 알려준다', () => {
    const result = plan({ sessions: chestWeek('2026-09-14', 12), asOf: '2026-09-14', weekInBlock: 1 });

    const back = result.volume.find((item) => item.muscle === 'back')!;
    assert.equal(back.prescribedSets, 0, '안 하는 부위에 매주 +10세트를 띄우지 않는다');
    assert.ok(result.neglected.includes('back'));
    assert.ok(!result.neglected.includes('chest'));
    assert.ok(!result.summary.includes('등'), '요약은 실제로 훈련하는 부위만 다룬다');
  });

  it('지난주에 쉬었어도 최근 4주 안에 했으면 계속 처방한다', () => {
    const sessions = chestWeek('2026-09-07', 12);
    const result = plan({ sessions, asOf: '2026-09-14', weekInBlock: 2 });
    const chest = result.volume.find((item) => item.muscle === 'chest')!;
    assert.ok(!result.neglected.includes('chest'));
    assert.ok(chest.prescribedSets > 0);
  });
});

describe('디로드 이후 복귀', () => {
  it('디로드를 연달아 두 번 하지 않는다', () => {
    const result = plan({
      sessions: afterDeload(),
      asOf: '2026-09-16',
      weekInBlock: 0,
      lastWeekPhase: 'deload',
      checkIns: [
        { date: '2026-09-14', pain: [{ joint: 'shoulder', score: 4 }] },
        { date: '2026-09-16', pain: [{ joint: 'shoulder', score: 4 }] },
      ],
    });
    assert.equal(result.phase, 'accumulation', '쉬는 목적은 훈련으로 돌아가는 것이다');
    assert.equal(result.weekInBlock, 1, '새 축적 블록이 시작된다');
  });

  it('디로드 주의 낮은 기록을 수행력 하락으로 읽지 않는다', () => {
    const afterDeloadSignals = plan({
      sessions: afterDeload(),
      asOf: '2026-09-16',
      weekInBlock: 0,
      lastWeekPhase: 'deload',
    }).fatigue.signals.map((signal) => signal.id);

    assert.ok(!afterDeloadSignals.includes('performanceDrop'));
    assert.ok(!afterDeloadSignals.includes('rirDrift'));

    // 같은 기록이라도 축적 주였다면 하락으로 잡혀야 한다.
    const afterAccumulation = plan({
      sessions: afterDeload(),
      asOf: '2026-09-16',
      weekInBlock: 2,
      lastWeekPhase: 'accumulation',
    }).fatigue.signals.map((signal) => signal.id);

    assert.ok(afterAccumulation.includes('performanceDrop'));
  });

  it('수행력 하락 메시지에 종목 이름을 사람이 읽을 수 있게 넣는다', () => {
    const signal = plan({
      sessions: afterDeload(),
      asOf: '2026-09-16',
      weekInBlock: 2,
      lastWeekPhase: 'accumulation',
    }).fatigue.signals.find((s) => s.id === 'performanceDrop');

    assert.ok(signal);
    assert.match(signal!.label, /벤치프레스|스쿼트/, '운동 id가 아니라 한국어 이름이어야 한다');
  });
});

describe('빈도와 볼륨 처방의 우선순위', () => {
  it('한 세션에 몰린 부위에는 세트를 더 넣지 않고 분할을 먼저 요구한다', () => {
    // 14세트를 하루에 몰아서 한 주 — 볼륨 구간은 적정이지만 분배가 틀렸다
    const massed = [session('2026-09-14', sets('pec-deck', 14, { weightKg: 40, reps: 10, rir: 2 }))];
    const result = plan({ sessions: massed, asOf: '2026-09-14', weekInBlock: 2 });
    const chest = chestPlan(result);

    assert.equal(chest.action, 'split', '버려지는 세트를 더 늘리지 않는다');
    assert.match(chest.rationale, /나누세요/);
    assert.ok(result.frequency.some((item) => item.muscle === 'chest' && item.verdict === 'concentrated'));
    assert.match(result.summary, /분배 조정/);
  });

  it('같은 볼륨을 나눠서 했으면 정상적으로 증량 처방한다', () => {
    const split = [
      session('2026-09-14', sets('pec-deck', 7, { weightKg: 40, reps: 10, rir: 2 })),
      session('2026-09-17', sets('pec-deck', 7, { weightKg: 40, reps: 10, rir: 2 })),
    ];
    const result = plan({ sessions: split, asOf: '2026-09-14', weekInBlock: 2 });

    assert.equal(chestPlan(result).action, 'increase');
    assert.ok(!result.frequency.some((item) => item.muscle === 'chest'));
  });

  it('MRV를 넘겼으면 분배보다 감량이 먼저다', () => {
    const massed = [
      session('2026-09-14', sets('pec-deck', 16, { weightKg: 40, reps: 10, rir: 2 })),
      session('2026-09-16', sets('pec-deck', 16, { weightKg: 40, reps: 10, rir: 2 })),
    ];
    const result = plan({ sessions: massed, asOf: '2026-09-16', weekInBlock: 2 });

    assert.equal(chestPlan(result).zone, 'overMrv');
    assert.equal(chestPlan(result).prescribedSets, landmarks.chest.mrv);
  });
});
