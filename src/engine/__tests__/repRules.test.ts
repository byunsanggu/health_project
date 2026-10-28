import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { prescribeLoad } from '../load.ts';
import { exerciseById } from '../exercises.ts';
import { buildProgram, type OnboardingAnswers } from '../onboarding.ts';
import { COMMON_EQUIPMENT_IDS } from '../equipment.ts';
import {
  applyRepRules, cleanRange, suggestRepRange, topSetLoad, topSetPick, withTopSet,
} from '../repRules.ts';
import type { PlannedExercise, SessionTemplate } from '../session.ts';
import type { SessionLog } from '../types.ts';
import { index } from './helpers.ts';

function answers(overrides: Partial<OnboardingAnswers> = {}): OnboardingAnswers {
  return {
    selfReportedLevel: 'intermediate', monthsTraining: 24, bodyweightKg: 78, sex: 'male',
    daysPerWeek: 4, goals: ['hypertrophy'], gym: { equipmentIds: [...COMMON_EQUIPMENT_IDS, 'barbell-set', 'power-rack'] },
    ...overrides,
  };
}

const slots = (program: ReturnType<typeof buildProgram>) => program.templates.flatMap((template) => template.slots);

describe('평소 반복 스타일', () => {
  it('가볍게 많이 — 메인 10~15회, 고립 12~20회, 데드리프트는 6~10회에서 멈춘다', () => {
    const program = buildProgram(answers({ repStyle: 'light', goals: ['strength'] }), 'intermediate');
    for (const slot of slots(program)) {
      if (slot.exerciseId.includes('deadlift') && slot.role === 'primary') continue;
      if (slot.role === 'primary') assert.ok(slot.repRange.min >= 6 && slot.repRange.max >= 10, `${slot.exerciseId} ${slot.repRange.min}-${slot.repRange.max}`);
      if (slot.role === 'isolation') assert.deepEqual(slot.repRange, { min: 12, max: 20 });
    }
    const dead = slots(buildProgram(answers({ repStyle: 'light' }), 'intermediate')).find((slot) => slot.exerciseId === 'conventional-deadlift');
    if (dead) assert.deepEqual(dead.repRange, { min: 6, max: 10 });
  });

  it('무겁게 — 바벨 메인은 4~6회, 덤벨 · 머신 주 종목은 6~10회', () => {
    const program = buildProgram(answers({ repStyle: 'heavy' }), 'intermediate');
    for (const slot of slots(program).filter((item) => item.role === 'primary')) {
      const exercise = exerciseById(slot.exerciseId)!;
      if (exercise.equipment === 'barbell' && !exercise.unilateral && !['romanian-deadlift', 'hip-thrust'].includes(exercise.id)) {
        assert.ok(slot.repRange.max <= 6, exercise.name);
      } else assert.ok(slot.repRange.min >= 6, exercise.name);
    }
  });

  it('보통은 목표가 근력이어도 6~10회, 목표에 맞춰는 예전 그대로', () => {
    const moderate = buildProgram(answers({ repStyle: 'moderate', goals: ['strength'] }), 'intermediate');
    for (const slot of slots(moderate).filter((item) => item.role === 'primary' && !item.exerciseId.includes('deadlift'))) {
      assert.deepEqual(slot.repRange, { min: 6, max: 10 });
    }
    assert.deepEqual(buildProgram(answers({ repStyle: 'auto' }), 'intermediate').templates, buildProgram(answers(), 'intermediate').templates);
  });
});

const template: SessionTemplate = {
  name: '상체',
  slots: [
    { exerciseId: 'barbell-bench-press', sets: 3, repRange: { min: 6, max: 10 }, role: 'primary' },
    { exerciseId: 'dumbbell-bench-press', sets: 3, repRange: { min: 6, max: 10 }, role: 'primary' },
    { exerciseId: 'cable-lateral-raise', sets: 3, repRange: { min: 10, max: 15 }, role: 'isolation' },
  ],
};

describe('블록 유형과 종목별 반복', () => {
  it('근비대 블록은 프로그램 반복 그대로, 다른 블록은 그 블록의 반복으로 — 예전에는 적기만 하고 안 바뀌었다', () => {
    assert.deepEqual(applyRepRules(template, { style: 'hypertrophy' }), template);
    const density = applyRepRules(template, { style: 'density' });
    assert.deepEqual(density.slots.map((slot) => slot.repRange), [{ min: 8, max: 12 }, { min: 8, max: 12 }, { min: 12, max: 20 }]);
  });

  it('근력 블록의 저반복은 바벨에만 — 덤벨 벤치는 보조 칸 반복', () => {
    const strength = applyRepRules(template, { style: 'strength' });
    assert.deepEqual(strength.slots[0]!.repRange, { min: 3, max: 5 });
    assert.deepEqual(strength.slots[1]!.repRange, { min: 5, max: 8 });
  });

  it('사람이 정한 반복이 블록보다 먼저다 — 내 루틴은 손대지 않는다', () => {
    const mine = applyRepRules(template, { style: 'strength', overrides: { 'barbell-bench-press': { min: 10, max: 15 } } });
    assert.deepEqual(mine.slots[0]!.repRange, { min: 10, max: 15 });
    const fixed = { ...template, fixed: true };
    assert.equal(applyRepRules(fixed, { style: 'strength', overrides: { 'barbell-bench-press': { min: 1, max: 2 } } }), fixed);
  });

  it('이상한 반복은 받지 않는다', () => {
    assert.equal(cleanRange({ min: 12, max: 8 }), null);
    assert.equal(cleanRange({ min: 0, max: 8 }), null);
    assert.equal(cleanRange({ min: 5, max: 40 }), null);
    assert.deepEqual(cleanRange({ min: 10, max: 15 }), { min: 10, max: 15 });
  });
});

const day = (date: string, reps: number[], weightKg = 60, exerciseId = 'barbell-bench-press'): SessionLog => ({
  id: date, date, updatedAt: date, sets: reps.map((count) => ({ exerciseId, weightKg, reps: count, rir: 2 })),
} as SessionLog);

describe('바꿀까요? — 처방보다 늘 많이 할 때만 묻는다', () => {
  it('두 번 연속 12~14회를 했으면 10~15회를 권한다', () => {
    const history = [day('2026-10-20', [14, 13, 12]), day('2026-10-23', [14, 12, 12])];
    const tip = suggestRepRange(history, 'barbell-bench-press', { min: 6, max: 10 }, '2026-10-27');
    assert.ok(tip);
    assert.deepEqual(tip!.suggested, { min: 10, max: 15 });
    assert.deepEqual(tip!.did, { min: 12, max: 14 });
  });

  it('한 번만 넘었거나 한두 개 넘친 정도면 묻지 않는다', () => {
    assert.equal(suggestRepRange([day('2026-10-23', [14, 14, 14])], 'barbell-bench-press', { min: 6, max: 10 }, '2026-10-27'), null);
    const near = [day('2026-10-20', [11, 10, 10]), day('2026-10-23', [11, 11, 10])];
    assert.equal(suggestRepRange(near, 'barbell-bench-press', { min: 6, max: 10 }, '2026-10-27'), null);
  });

  it('오늘 기록과 무거운 세트는 보지 않는다', () => {
    const history = [day('2026-10-20', [14, 13]), day('2026-10-27', [14, 14])];
    assert.equal(suggestRepRange(history, 'barbell-bench-press', { min: 6, max: 10 }, '2026-10-27'), null);
  });
});

describe('주 1회 무거운 세트', () => {
  const templates: SessionTemplate[] = [
    { name: 'A', slots: [{ exerciseId: 'barbell-bench-press', sets: 3, repRange: { min: 6, max: 10 }, role: 'primary' }] },
    { name: 'B', slots: [{ exerciseId: 'back-squat', sets: 3, repRange: { min: 6, max: 10 }, role: 'primary' }] },
    { name: 'C', slots: [{ exerciseId: 'dumbbell-bench-press', sets: 3, repRange: { min: 6, max: 10 }, role: 'primary' }] },
  ];

  it('한 주에 한 종목, 주마다 돌아간다 — 덤벨 종목은 고르지 않는다', () => {
    const one = topSetPick(templates, '2026-10-26')!;
    const next = topSetPick(templates, '2026-11-02')!;
    assert.notEqual(one.exerciseId, next.exerciseId);
    for (const pick of [one, next]) {
      assert.ok(['barbell-bench-press', 'back-squat'].includes(pick.exerciseId));
      assert.equal(templates[pick.templateIndex]!.slots[0]!.exerciseId, pick.exerciseId);
    }
    assert.deepEqual(topSetPick(templates, '2026-10-27'), one, '같은 주면 같은 종목');
  });

  it('기록이 있어야 만든다 — 2개 하고 2개 남는 무게, 백오프보다 무겁다', () => {
    assert.equal(topSetLoad([], 'barbell-bench-press', '2026-10-27'), null);
    const load = topSetLoad([day('2026-10-20', [8, 8, 7], 80)], 'barbell-bench-press', '2026-10-27')!;
    assert.ok(load.weightKg > 85 && load.weightKg < 100, String(load.weightKg));
    const item = {
      exercise: exerciseById('barbell-bench-press')!,
      sets: [1, 2, 3].map((n) => ({ setNumber: n, weightKg: 80, targetReps: { min: 6, max: 10 }, targetRir: 2 })),
      painRuling: {} as never, note: '',
    } as PlannedExercise;
    const topped = withTopSet(item, load, (kg) => Math.floor(kg / 2.5) * 2.5);
    assert.equal(topped.sets.length, 4);
    assert.equal(topped.sets[0]!.top, true);
    assert.deepEqual(topped.sets[0]!.targetReps, { min: 1, max: 3 });
    assert.ok(topped.sets[0]!.weightKg! > 80);
    assert.deepEqual(topped.sets.slice(1).map((set) => set.setNumber), [2, 3, 4]);
  });

  it('무거운 세트는 다음 무게를 정하는 근거에서 빠진다 — 2회라고 무게를 내리지 않는다', () => {
    const bench = exerciseById('barbell-bench-press')!;
    const sets = [
      { exerciseId: bench.id, weightKg: 92.5, reps: 2, rir: 2, top: true },
      { exerciseId: bench.id, weightKg: 80, reps: 10, rir: 2 },
      { exerciseId: bench.id, weightKg: 80, reps: 10, rir: 2 },
    ];
    const next = prescribeLoad(bench, sets, { repRange: { min: 6, max: 10 }, targetRir: 2 });
    assert.equal(next.change, 'increase');
    assert.ok(next.weightKg! > 80);
  });

  it('무거운 세트는 다음 주 세트 수의 출발점에 넣지 않는다', async () => {
    const { planWeekSets } = await import('../weekSets.ts');
    const templates: SessionTemplate[] = [{ name: 'A', slots: [{ exerciseId: 'barbell-bench-press', sets: 3, repRange: { min: 6, max: 10 }, role: 'primary' }] }];
    const week = (top: boolean) => [{
      id: 'w', date: '2026-10-20', updatedAt: '2026-10-20',
      sets: [
        ...(top ? [{ exerciseId: 'barbell-bench-press', weightKg: 90, reps: 2, rir: 2, top: true }] : []),
        ...[1, 2, 3].map(() => ({ exerciseId: 'barbell-bench-press', weightKg: 80, reps: 8, rir: 2 })),
      ],
    }] as SessionLog[];
    // 늘리거나 줄일 부위가 없는 주 — 지난주에 한 만큼(startingSets)이 그대로 나온다
    const plan = { phase: 'accumulation', weekInBlock: 3, volume: [{ muscle: 'chest', action: 'skip', currentSets: 0, prescribedSets: 0 }] };
    const input = (top: boolean) => ({ templates, plan, index, lastWeek: week(top) }) as never;
    assert.deepEqual(planWeekSets(input(false)), [[3]]);
    assert.deepEqual(planWeekSets(input(true)), [[3]]);
  });
});
