import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  ROUTINE_MAX_LIFTS,
  ROUTINE_MAX_SETS,
  ROUTINE_NAME,
  defaultRepRange,
  isRoutineShape,
  reviewRoutine,
  routineFromProgram,
  routineHeadline,
  routineProgram,
  routineSlotFor,
  sanitizeRoutine,
  type CustomRoutine,
  type RoutineSlot,
} from '../routine.ts';
import { buildProgram, type OnboardingAnswers } from '../onboarding.ts';
import { buildSession } from '../session.ts';
import { planNextWeek, type WeeklyPlan } from '../mesocycle.ts';
import { COMMON_EQUIPMENT_IDS } from '../equipment.ts';
import { exerciseById } from '../exercises.ts';
import { landmarksFor } from '../muscles.ts';
import type { SessionLog } from '../types.ts';
import { index, session, sets } from './helpers.ts';

const landmarks = landmarksFor('intermediate');

function slot(exerciseId: string, count: number, min = 8, max = 12): RoutineSlot {
  return { exerciseId, sets: count, repRange: { min, max } };
}

const answers: OnboardingAnswers = {
  selfReportedLevel: 'intermediate',
  monthsTraining: 18,
  bodyweightKg: 78,
  sex: 'male',
  daysPerWeek: 4,
  goals: ['hypertrophy'],
  gym: { equipmentIds: COMMON_EQUIPMENT_IDS },
};

/** 흔한 5분할 — 하루 한 부위 */
const broSplit: CustomRoutine = {
  days: [
    { name: '가슴', slots: [slot('barbell-bench-press', 5, 6, 10), slot('incline-dumbbell-press', 4), slot('machine-chest-press', 4), slot('cable-fly', 4, 10, 15), slot('pec-deck', 3, 10, 15)] },
    { name: '등', slots: [slot('conventional-deadlift', 4, 4, 6), slot('pull-up', 4), slot('barbell-row', 4), slot('lat-pulldown', 4), slot('seated-cable-row', 3)] },
    { name: '어깨', slots: [slot('barbell-overhead-press', 4, 6, 10), slot('lateral-raise', 4, 12, 20), slot('reverse-pec-deck', 4, 12, 20), slot('barbell-shrug', 4)] },
    { name: '하체', slots: [slot('back-squat', 5, 6, 10), slot('leg-press', 4), slot('leg-extension', 3, 10, 15), slot('lying-leg-curl', 4, 10, 15), slot('standing-calf-raise', 4, 10, 15)] },
    { name: '팔', slots: [slot('barbell-curl', 4), slot('triceps-pushdown', 4, 10, 15), slot('hammer-curl', 3), slot('overhead-cable-extension', 3, 10, 15)] },
  ],
};

/** 밀기 · 당기기 · 하체 두 번 — 부위마다 주 두 번, 고르게 */
const ppl: CustomRoutine = {
  days: [
    { name: '밀기 A', slots: [slot('barbell-bench-press', 4, 6, 10), slot('barbell-overhead-press', 3), slot('cable-fly', 3, 10, 15), slot('lateral-raise', 3, 12, 20), slot('triceps-pushdown', 3, 10, 15)] },
    { name: '당기기 A', slots: [slot('barbell-row', 4, 6, 10), slot('lat-pulldown', 3), slot('face-pull', 3, 12, 20), slot('barbell-curl', 3)] },
    { name: '하체 A', slots: [slot('back-squat', 4, 6, 10), slot('romanian-deadlift', 3), slot('leg-extension', 3, 10, 15), slot('standing-calf-raise', 4, 10, 15)] },
    { name: '밀기 B', slots: [slot('incline-dumbbell-press', 4), slot('seated-dumbbell-press', 3), slot('pec-deck', 3, 10, 15), slot('cable-lateral-raise', 3, 12, 20), slot('overhead-cable-extension', 3, 10, 15)] },
    { name: '당기기 B', slots: [slot('pull-up', 4), slot('seated-cable-row', 3), slot('reverse-pec-deck', 3, 12, 20), slot('hammer-curl', 3)] },
    { name: '하체 B', slots: [slot('leg-press', 4), slot('lying-leg-curl', 3), slot('bulgarian-split-squat', 3), slot('seated-calf-raise', 4, 10, 15)] },
  ],
};

describe('내 루틴 — 프로그램으로', () => {
  it('지금 프로그램을 옮겨 적으면 날 · 종목 · 세트 · 반복이 그대로다', () => {
    const program = buildProgram(answers, 'intermediate');
    const routine = routineFromProgram(program);
    assert.deepEqual(routine.days.map((day) => day.name), program.templates.map((template) => template.name));
    routine.days.forEach((day, i) => {
      assert.deepEqual(day.slots, program.templates[i]!.slots.map((item) => ({
        exerciseId: item.exerciseId, sets: item.sets, repRange: item.repRange,
      })));
    });
  });

  it('루틴 프로그램은 날 수가 곧 주 몇 회이고, 날마다 세트가 고정이다', () => {
    const program = routineProgram(ppl, index);
    assert.equal(program.name, ROUTINE_NAME);
    assert.equal(program.custom, true);
    assert.equal(program.daysPerWeek, 6);
    assert.ok(program.templates.every((template) => template.fixed === true));
    assert.deepEqual(program.templates[0]!.slots.map((item) => item.sets), [4, 3, 3, 3, 3]);
  });

  it('날마다 첫 복합 종목이 메인, 나머지 복합은 보조, 고립은 고립', () => {
    const program = routineProgram(ppl, index);
    assert.deepEqual(program.templates[0]!.slots.map((item) => item.role),
      ['primary', 'accessory', 'isolation', 'isolation', 'isolation']);
    // 고립으로 시작하는 날이어도 첫 복합이 메인이다
    const odd = routineProgram({ days: [{ name: '팔 먼저', slots: [slot('barbell-curl', 3), slot('chin-up', 3)] }] }, index);
    assert.deepEqual(odd.templates[0]!.slots.map((item) => item.role), ['isolation', 'primary']);
  });

  it('새로 넣는 종목은 3세트 — 고립은 10~15회, 나머지는 8~12회', () => {
    assert.deepEqual(routineSlotFor(exerciseById('lateral-raise')!), { exerciseId: 'lateral-raise', sets: 3, repRange: { min: 10, max: 15 } });
    assert.deepEqual(defaultRepRange(exerciseById('barbell-row')!), { min: 8, max: 12 });
    assert.deepEqual(defaultRepRange(exerciseById('cable-crunch')!), { min: 10, max: 15 });
  });
});

describe('내 루틴 — 세션은 정한 세트대로', () => {
  const day = routineProgram(ppl, index).templates[0]!;

  function plan(history: SessionLog[], overrides: Partial<WeeklyPlan> = {}): WeeklyPlan {
    return { ...planNextWeek({ sessions: history, index, landmarks, asOf: '2026-09-18', weekInBlock: 3 }), ...overrides };
  }

  it('주간 처방이 세트를 늘리라고 해도 정한 세트 그대로다', () => {
    // 지난주 가슴을 거의 안 했다 — 앱 프로그램이면 벤치 세트가 늘어난다
    const history = [session('2026-09-14', sets('pec-deck', 1, { weightKg: 40, reps: 10, rir: 2 }))];
    const weekly = plan(history);
    const fixed = buildSession({ template: day, date: '2026-09-21', plan: weekly, history, index });
    assert.deepEqual(fixed.exercises.map((item) => item.sets.length), [4, 3, 3, 3, 3]);

    const loose = buildSession({ template: { ...day, fixed: undefined }, date: '2026-09-21', plan: weekly, history, index });
    assert.notDeepEqual(loose.exercises.map((item) => item.sets.length), [4, 3, 3, 3, 3],
      '비교 대상(앱 프로그램)은 같은 처방에서 세트가 바뀌어야 이 시험이 뜻이 있다');
  });

  it('덜어내는 주에는 절반(올림)으로 줄인다', () => {
    const weekly = plan([], { phase: 'deload', targetRir: 4, intensityMultiplier: 0.9 });
    const planned = buildSession({ template: day, date: '2026-09-21', plan: weekly, history: [], index });
    assert.deepEqual(planned.exercises.map((item) => item.sets.length), [2, 2, 2, 2, 2]);
  });

  it('무게는 앱 프로그램과 같은 규칙으로 올린다', () => {
    const history = [session('2026-09-14', sets('barbell-bench-press', 4, { weightKg: 80, reps: 10, rir: 2 }))];
    const weekly = plan(history);
    const fixed = buildSession({ template: day, date: '2026-09-21', plan: weekly, history, index });
    const loose = buildSession({ template: { ...day, fixed: undefined }, date: '2026-09-21', plan: weekly, history, index });
    const bench = (planned: typeof fixed) => planned.exercises.find((item) => item.exercise.id === 'barbell-bench-press')!;
    assert.equal(bench(fixed).sets[0]!.weightKg, bench(loose).sets[0]!.weightKg);
    assert.ok(bench(fixed).sets[0]!.weightKg! > 80, '10회를 RIR 2로 채웠으면 무게가 오른다');
  });
});

describe('내 루틴 — 받은 것 고르기', () => {
  it('지금 앱에 없는 종목 · 모양이 틀린 종목은 빼고, 같은 날 같은 종목은 한 번만', () => {
    const routine = sanitizeRoutine({
      days: [{
        name: '  상체  ',
        slots: [
          slot('barbell-bench-press', 4),
          slot('no-such-lift', 3),
          { exerciseId: 'barbell-row', sets: 'three', repRange: { min: 8, max: 12 } },
          slot('barbell-bench-press', 2),
          slot('lat-pulldown', 3),
        ],
      }],
    }, index);
    assert.deepEqual(routine, { days: [{ name: '상체', slots: [slot('barbell-bench-press', 4), slot('lat-pulldown', 3)] }] });
  });

  it('세트 · 반복은 범위 안으로, 거꾸로 적은 반복은 바로 세운다', () => {
    const routine = sanitizeRoutine({ days: [{ name: 'A', slots: [{ exerciseId: 'leg-press', sets: 40, repRange: { min: 15, max: 8 } }] }] }, index)!;
    assert.equal(routine.days[0]!.slots[0]!.sets, ROUTINE_MAX_SETS);
    assert.deepEqual(routine.days[0]!.slots[0]!.repRange, { min: 8, max: 15 });
  });

  it('종목이 하나도 안 남은 날은 빼고, 남는 날이 없으면 null', () => {
    const routine = sanitizeRoutine({ days: [{ name: '', slots: [slot('leg-press', 3)] }, { name: '빈 날', slots: [] }] }, index)!;
    assert.deepEqual(routine.days.map((day) => day.name), ['1일차']);
    assert.equal(sanitizeRoutine({ days: [{ name: 'A', slots: [slot('no-such-lift', 3)] }] }, index), null);
    assert.equal(sanitizeRoutine({ days: [] }, index), null);
    assert.equal(sanitizeRoutine(null, index), null);
    assert.equal(sanitizeRoutine({ days: Array.from({ length: 8 }, () => ({ name: 'x', slots: [slot('leg-press', 3)] })) }, index), null);
  });

  it('하루 종목은 상한까지만', () => {
    const many = [...index.keys()].slice(0, ROUTINE_MAX_LIFTS + 5).map((id) => slot(id, 2));
    const routine = sanitizeRoutine({ days: [{ name: 'A', slots: many }] }, index)!;
    assert.equal(routine.days[0]!.slots.length, ROUTINE_MAX_LIFTS);
  });

  it('뼈대 검사 — 날 목록과 종목 목록만 본다', () => {
    assert.equal(isRoutineShape(ppl), true);
    assert.equal(isRoutineShape({ days: [{ name: 'A', slots: [{ junk: true }] }] }), true, '종목 하나하나는 sanitize가 거른다');
    assert.equal(isRoutineShape({ days: [{ name: 'A' }] }), false);
    assert.equal(isRoutineShape({ days: 'x' }), false);
    assert.equal(isRoutineShape([]), false);
  });
});

describe('내 루틴 — 점검', () => {
  it('부위마다 주 두 번 고르게 짠 루틴은 손볼 데가 거의 없다', () => {
    const review = reviewRoutine(ppl, index, landmarks);
    assert.deepEqual(review.notes.map((note) => note.kind), []);
    assert.equal(routineHeadline(review), '부위마다 주 최소 세트를 넘고 한계 안입니다');
    assert.deepEqual(review.days.map((day) => day.sets), [16, 13, 14, 16, 13, 14]);
  });

  it('하루 한 부위로 몰면 그 사실을 말한다 — 하루 9세트를 넘는 몫은 절반만 센다', () => {
    const review = reviewRoutine(broSplit, index, landmarks);
    const crammed = review.notes.find((note) => note.kind === 'crammed');
    assert.ok(crammed?.muscles?.includes('chest'));
    assert.ok(crammed!.text.includes('가슴 하루'));
    const chest = review.muscles.find((line) => line.muscle === 'chest')!;
    assert.ok(chest.discounted > 5, '가슴 날 20세트 중 9세트 넘는 몫이 깎인다');
  });

  it('모자란 부위는 이름과 숫자를 대고, 한두 세트 차이는 잔소리하지 않는다', () => {
    const review = reviewRoutine(broSplit, index, landmarks);
    const under = review.notes.find((note) => note.kind === 'under')!;
    assert.deepEqual(under.muscles, ['sideDelt', 'calves']);
    assert.ok(under.text.includes('측면 삼각근 6세트(최소 8)'));
    assert.equal(routineHeadline(reviewRoutine(broSplit, index, landmarks)), '측면 삼각근 · 종아리가 주 최소 세트에 못 미칩니다');
    // 종아리 4세트 → 6.3(최소 8)은 15% 넘게 모자라다. 5세트면 7.3 — 말하지 않는다
    const more: CustomRoutine = structuredClone(broSplit);
    more.days[3]!.slots[4]!.sets = 5;
    more.days[2]!.slots[1]!.sets = 6;
    assert.equal(reviewRoutine(more, index, landmarks).notes.find((note) => note.kind === 'under'), undefined);
  });

  it('한계를 크게 넘는 부위는 덜어내라고 한다', () => {
    const heavy: CustomRoutine = {
      days: [0, 1, 2].map((i) => ({
        name: `가슴 ${i + 1}`,
        slots: [slot('barbell-bench-press', 5), slot('incline-dumbbell-press', 5), slot('cable-fly', 4, 10, 15)],
      })),
    };
    const review = reviewRoutine(heavy, index, landmarks);
    const over = review.notes[0]!;
    assert.equal(over.kind, 'over', '회복을 넘는 것을 먼저 말한다');
    assert.ok(over.muscles!.includes('chest'));
    assert.match(routineHeadline(review), /가슴.*회복 한계를 넘습니다/);
  });

  it('하체가 없으면 · 미는 쪽으로 치우치면 · 하루가 너무 길면 말한다', () => {
    const upper: CustomRoutine = {
      days: [{
        name: '상체',
        slots: [slot('barbell-bench-press', 5), slot('incline-dumbbell-press', 5), slot('barbell-overhead-press', 5),
          slot('chest-dip', 5), slot('lat-pulldown', 2), slot('lateral-raise', 5), slot('triceps-pushdown', 5)],
      }],
    };
    const upperReview = reviewRoutine(upper, index, landmarks);
    // "가슴 · 등 등이"처럼 읽히지 않게 — 둘까지 대고 나머지는 "외 N곳"
    assert.match(routineHeadline(upperReview), / 외 \d+곳이 주 최소 세트에 못 미칩니다$/);
    assert.ok(!routineHeadline(upperReview).includes('등 등'));
    const kinds = upperReview.notes.map((note) => note.kind);
    assert.ok(kinds.includes('noLegs'));
    assert.ok(kinds.includes('pushPull'));
    assert.ok(kinds.includes('longDay'), '32세트 하루');
  });
});
