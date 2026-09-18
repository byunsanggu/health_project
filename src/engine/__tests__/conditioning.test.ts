import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildConditioning, checkInterference, type ConditioningFormat } from '../conditioning.ts';
import { COMMON_EQUIPMENT_IDS } from '../equipment.ts';
import { buildSchedule } from '../schedule.ts';
import { buildProgram, type OnboardingAnswers } from '../onboarding.ts';
import { MUSCLE_GROUPS } from '../muscles.ts';
import { index } from './helpers.ts';
import type { MuscleGroup } from '../types.ts';

const base = {
  format: 'amrap' as ConditioningFormat,
  minutes: 15,
  level: 'intermediate' as const,
  equipmentIds: COMMON_EQUIPMENT_IDS,
};

const answers: OnboardingAnswers = {
  selfReportedLevel: 'intermediate',
  monthsTraining: 18,
  bodyweightKg: 78,
  daysPerWeek: 4,
  goal: 'hypertrophy',
  gym: { equipmentIds: COMMON_EQUIPMENT_IDS },
};

describe('컨디셔닝 세션', () => {
  it('형식마다 기록 방법이 다르다', () => {
    for (const format of ['amrap', 'emom', 'forTime', 'intervals', 'circuit'] as ConditioningFormat[]) {
      const workout = buildConditioning({ ...base, format });
      assert.ok(workout.scoring.length > 0, format);
      assert.ok(workout.movements.length >= 3, format);
    }
  });

  it('시간이 길수록 동작을 더 넣되 다섯을 넘기지 않는다', () => {
    assert.equal(buildConditioning({ ...base, minutes: 8 }).movements.length, 3);
    assert.ok(buildConditioning({ ...base, minutes: 20 }).movements.length <= 5);
  });

  it('시간에 쫓기며 하면 안 되는 동작을 넣지 않는다', () => {
    for (const minutes of [8, 12, 20]) {
      const workout = buildConditioning({ ...base, minutes, level: 'advanced' });
      for (const movement of workout.movements) {
        assert.ok(!movement.exerciseId.includes('deadlift'), movement.name);
        assert.notEqual(movement.exerciseId, 'back-squat');
        assert.notEqual(movement.exerciseId, 'barbell-overhead-press');
      }
    }
  });

  it('같은 부위 동작을 두 번 넣지 않는다', () => {
    const workout = buildConditioning({ ...base, minutes: 20 });
    const primaries = workout.movements.map((movement) => {
      const exercise = index.get(movement.exerciseId)!;
      return MUSCLE_GROUPS.reduce<MuscleGroup | undefined>((best, muscle) =>
        (exercise.contribution[muscle] ?? 0) > (best ? exercise.contribution[best] ?? 0 : 0) ? muscle : best,
      undefined);
    });
    assert.equal(new Set(primaries).size, primaries.length);
  });

  it('버티는 동작은 초로, 캐리는 걸음으로 센다', () => {
    const workout = buildConditioning({ ...base, minutes: 20, level: 'advanced' });
    for (const movement of workout.movements) {
      if (movement.exerciseId === 'plank' || movement.exerciseId === 'side-plank') {
        assert.equal(movement.unit, 'seconds', movement.name);
        assert.match(movement.display, /초$/);
      }
      if (movement.exerciseId === 'farmers-walk') {
        assert.equal(movement.unit, 'steps');
      }
      assert.ok(movement.display.length > 0);
    }
  });

  it('근력 세션과 겹치는 부위를 피한다', () => {
    const workout = buildConditioning({ ...base, avoidMuscles: ['quads', 'glutes'] });
    for (const movement of workout.movements) {
      const exercise = index.get(movement.exerciseId)!;
      assert.ok((exercise.contribution.quads ?? 0) < 0.85, movement.name);
    }
    assert.ok(workout.notes.some((note) => note.includes('겹치지 않도록')));
  });

  it('초보자에게는 관절 부하가 낮은 동작만 준다', () => {
    const workout = buildConditioning({ ...base, level: 'beginner' });
    for (const movement of workout.movements) {
      const exercise = index.get(movement.exerciseId)!;
      const maxStress = Math.max(0, ...Object.values(exercise.jointStress));
      assert.ok(maxStress <= 0.5, `${movement.name} ${maxStress}`);
    }
  });

  it('통증이 있는 관절을 쓰는 동작을 빼준다', () => {
    const workout = buildConditioning({ ...base, pain: [{ joint: 'shoulder', score: 6 }] });
    for (const movement of workout.movements) {
      const exercise = index.get(movement.exerciseId)!;
      assert.ok((exercise.jointStress.shoulder ?? 0) < 0.6, movement.name);
    }
  });

  it('유효 세트가 아니라 피로에만 더한다고 분명히 밝힌다', () => {
    const workout = buildConditioning(base);
    assert.ok(workout.fatigueLoad > 0);
    assert.ok(workout.notes.some((note) => note.includes('유효 세트로 세지 않습니다')));
  });

  it('기구가 거의 없으면 그 사실을 알려준다', () => {
    const workout = buildConditioning({ ...base, equipmentIds: ['floor'] });
    assert.ok(workout.movements.length < 3);
    assert.ok(workout.notes.some((note) => note.includes('기구를 더 등록')));
  });
});

describe('근력 세션과의 간섭', () => {
  const program = buildProgram(answers, 'intermediate');
  const schedule = buildSchedule({ templates: program.templates, daysPerWeek: 4, index });

  const sessionMuscles = (session: { templateIndex: number }) => {
    const template = program.templates[session.templateIndex]!;
    const out: MuscleGroup[] = [];
    for (const slot of template.slots) {
      const exercise = index.get(slot.exerciseId)!;
      for (const muscle of MUSCLE_GROUPS) {
        if ((exercise.contribution[muscle] ?? 0) >= 0.85 && !out.includes(muscle)) out.push(muscle);
      }
    }
    return out;
  };

  it('붙어 있는 날에 같은 부위가 겹치면 경고한다', () => {
    const warnings = checkInterference({
      strengthSessions: schedule.sessions,
      conditioningDays: [{ weekday: 2, targetMuscles: ['quads', 'glutes', 'hamstrings'] }],
      sessionMuscles,
    });
    assert.ok(warnings.some((warning) => warning.severity === 'warning'));
  });

  it('겹치지 않으면 조용하다', () => {
    const warnings = checkInterference({
      strengthSessions: schedule.sessions,
      conditioningDays: [{ weekday: 6, targetMuscles: ['abs'] }],
      sessionMuscles,
    });
    assert.equal(warnings.length, 0);
  });

  it('총 훈련 횟수가 너무 많으면 짚어준다', () => {
    const warnings = checkInterference({
      strengthSessions: schedule.sessions,
      conditioningDays: [
        { weekday: 2, targetMuscles: ['abs'] },
        { weekday: 5, targetMuscles: ['abs'] },
        { weekday: 6, targetMuscles: ['abs'] },
      ],
      sessionMuscles,
    });
    assert.ok(warnings.some((warning) => warning.message.includes('주 7회')));
  });
});
