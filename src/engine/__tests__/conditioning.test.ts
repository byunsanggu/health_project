import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildConditioning, buildWodSession, checkInterference, type ConditioningFormat } from '../conditioning.ts';
import { COMMON_EQUIPMENT_IDS } from '../equipment.ts';
import { presetEquipment } from '../gymPresets.ts';
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
  goals: ['hypertrophy'],
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

describe('와드 한 판', () => {
  const gym = presetEquipment('franchise');

  it('몸풀기가 먼저 나온다', () => {
    /*
     * 근력 세션의 워밍업은 종목마다 올라가는 램프지만, 와드는 시작하자마자
     * 최대 강도로 들어간다. 들어가기 전에 다 풀려 있어야 한다.
     */
    const session = buildWodSession({ format: 'amrap', minutes: 12, level: 'intermediate', equipmentIds: gym });
    assert.ok(session.warmup.minutes > 0);
    assert.equal(session.warmup.steps.length, 3);
    assert.equal(session.totalMinutes, session.warmup.minutes + session.workout.durationMinutes);
  });

  it('몸풀기 마지막에 그날 할 동작을 넣는다', () => {
    // 처음 하는 동작을 시계 켜고 하면 그때부터 자세가 없다.
    const session = buildWodSession({ format: 'forTime', minutes: 12, level: 'intermediate', equipmentIds: gym });
    const rehearsal = session.warmup.steps[2]!;
    for (const movement of session.workout.movements) {
      assert.ok(rehearsal.includes(movement.name), `${movement.name}이 예행에 없습니다`);
    }
  });

  it('짧은 와드일수록 몸풀기 비중이 크다', () => {
    const short = buildWodSession({ format: 'amrap', minutes: 6, level: 'intermediate', equipmentIds: gym });
    const long = buildWodSession({ format: 'amrap', minutes: 20, level: 'intermediate', equipmentIds: gym });
    assert.ok(short.warmup.minutes / short.workout.durationMinutes >
      long.warmup.minutes / long.workout.durationMinutes);
  });

  it('바벨은 켜야만 들어간다', () => {
    const off = buildConditioning({ format: 'forTime', minutes: 12, level: 'intermediate', equipmentIds: gym });
    assert.equal(off.movements.some((m) => m.exerciseId === 'barbell-overhead-press'
      || m.exerciseId === 'conventional-deadlift' || m.exerciseId === 'front-squat'), false);

    const on = buildConditioning({ format: 'forTime', minutes: 12, level: 'intermediate', equipmentIds: gym, allowBarbell: true });
    assert.ok(on.movements.some((m) => m.exerciseId === 'barbell-overhead-press'
      || m.exerciseId === 'conventional-deadlift' || m.exerciseId === 'front-squat'),
      '켜면 바벨 한 자리는 확보된다');
  });

  it('초보에게는 켜도 안 열린다', () => {
    // 자세가 무너지는 걸 스스로 못 알아차리는 단계에서 시간에 쫓기게 하면 안 된다.
    const beginner = buildConditioning({ format: 'forTime', minutes: 12, level: 'beginner', equipmentIds: gym, allowBarbell: true });
    assert.equal(beginner.movements.some((m) => m.exerciseId === 'conventional-deadlift'), false);
  });

  it('바벨 한 자리면 충분하다', () => {
    const on = buildConditioning({ format: 'forTime', minutes: 20, level: 'advanced', equipmentIds: gym, allowBarbell: true });
    const barbells = on.movements.filter((m) => ['conventional-deadlift', 'sumo-deadlift',
      'front-squat', 'barbell-overhead-press'].includes(m.exerciseId));
    assert.ok(barbells.length <= 1, `바벨 ${barbells.length}개`);
  });

  it('위험한 동작이 들어가면 무게 상한을 말한다', () => {
    const session = buildWodSession({ format: 'forTime', minutes: 12, level: 'intermediate', equipmentIds: gym, allowBarbell: true });
    assert.ok(session.cautions.some((line) => line.includes('절반 이하')));
    // 조사 자리표시자가 남으면 안 된다
    assert.equal(session.cautions.some((line) => /은\(는\)|을\(를\)/.test(line)), false);
  });

  it('속도 제한 없는 형식이면 그것도 말한다', () => {
    const forTime = buildWodSession({ format: 'forTime', minutes: 12, level: 'intermediate', equipmentIds: gym, allowBarbell: true });
    assert.ok(forTime.cautions.some((line) => line.includes('EMOM')));

    const emom = buildWodSession({ format: 'emom', minutes: 12, level: 'intermediate', equipmentIds: gym, allowBarbell: true });
    assert.equal(emom.cautions.some((line) => line.includes('EMOM처럼')), false);
  });

  it('맨몸 와드에는 잔소리를 하지 않는다', () => {
    // 켠 사람에게 매번 같은 경고를 하면 그때부터 안 읽는다.
    const session = buildWodSession({ format: 'amrap', minutes: 12, level: 'intermediate', equipmentIds: gym });
    assert.equal(session.cautions.some((line) => line.includes('절반 이하')), false);
  });

  it('단독으로 하면 볼륨을 대체하지 않는다고 말한다', () => {
    const session = buildWodSession({ format: 'amrap', minutes: 12, level: 'intermediate', equipmentIds: gym, standalone: true });
    assert.ok(session.cautions.some((line) => line.includes('주간 볼륨')));
  });
});
