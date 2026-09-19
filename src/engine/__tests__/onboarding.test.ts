import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildProgram, runOnboarding, type OnboardingAnswers } from '../onboarding.ts';
import { COMMON_EQUIPMENT_IDS } from '../equipment.ts';
import { EXERCISES } from '../exercises.ts';
import { levelProfile } from '../levels.ts';
import { exerciseById } from '../exercises.ts';
import { aggregateVolume } from '../volume.ts';
import { index } from './helpers.ts';
import type { Exercise } from '../types.ts';

function answers(overrides: Partial<OnboardingAnswers> = {}): OnboardingAnswers {
  return {
    selfReportedLevel: 'intermediate',
    monthsTraining: 18,
    bodyweightKg: 78,
    sex: 'male',
    daysPerWeek: 4,
    goals: ['hypertrophy'],
    gym: { equipmentIds: COMMON_EQUIPMENT_IDS },
    ...overrides,
  };
}

function exercisesOf(program: ReturnType<typeof buildProgram>): Exercise[] {
  return program.templates.flatMap((template) =>
    template.slots.map((slot) => exerciseById(slot.exerciseId) as Exercise),
  );
}

describe('runOnboarding', () => {
  it('설문 하나로 단계 · 헬스장 · 프로그램 · 첫 주까지 만든다', () => {
    const result = runOnboarding(answers());

    assert.equal(result.level.level, 'intermediate');
    assert.equal(result.lifter.bodyweightKg, 78);
    assert.equal(result.program.templates.length, 4);
    assert.equal(result.firstWeek.weekInBlock, 1);
    assert.ok(result.notes.length > 0);
  });

  it('과대 신고한 단계를 낮추고 이유를 남긴다', () => {
    const result = runOnboarding(answers({ selfReportedLevel: 'expert', monthsTraining: 3 }));

    assert.equal(result.level.level, 'beginner');
    assert.equal(result.level.adjusted, true);
    assert.ok(result.notes.some((note) => note.includes('3개월')));
  });

  it('단계가 블록 길이와 첫 주 목표 RIR을 정한다', () => {
    const beginner = runOnboarding(answers({ selfReportedLevel: 'beginner', monthsTraining: 2 }));
    const advanced = runOnboarding(answers({ selfReportedLevel: 'advanced', monthsTraining: 40 }));

    assert.equal(beginner.firstWeek.targetRir, levelProfile('beginner').startingRir);
    assert.ok(beginner.firstWeek.targetRir > advanced.firstWeek.targetRir);
  });

  it('기구가 부족하면 무엇을 더하면 되는지 알려준다', () => {
    const result = runOnboarding(answers({
      gym: { equipmentIds: ['floor', 'barbell-set', 'power-rack', 'bench-flat'] },
    }));
    assert.ok(result.notes.some((note) => note.includes('기구를 더 추가하면')));
  });
});

describe('buildProgram', () => {
  it('주당 일수에 맞는 분할을 만든다', () => {
    for (const days of [2, 3, 4, 5, 6]) {
      const program = buildProgram(answers({ daysPerWeek: days }), 'intermediate');
      assert.equal(program.templates.length, days, `주 ${days}회`);
      assert.ok(program.templates.every((t) => t.slots.length >= 3));
    }
  });

  it('범위를 벗어난 일수는 붙잡아 준다', () => {
    assert.equal(buildProgram(answers({ daysPerWeek: 9 }), 'intermediate').templates.length, 7);
    assert.equal(buildProgram(answers({ daysPerWeek: 0 }), 'intermediate').templates.length, 1);
  });

  it('헬스장에 없는 종목은 넣지 않는다', () => {
    const minimal = ['floor', 'barbell-set', 'power-rack', 'bench-flat'];
    const program = buildProgram(answers({ gym: { equipmentIds: minimal } }), 'intermediate');

    for (const exercise of exercisesOf(program)) {
      assert.ok(
        ['barbell', 'bodyweight'].includes(exercise.equipment),
        `${exercise.name}(${exercise.equipment})은 이 구성에서 불가능하다`,
      );
    }
  });

  it('한 종목에 4세트를 넘기지 않는다', () => {
    const program = buildProgram(answers(), 'advanced');
    for (const template of program.templates) {
      for (const slot of template.slots) {
        assert.ok(slot.sets <= 4, `${slot.exerciseId} ${slot.sets}세트`);
        assert.ok(slot.sets >= 2);
      }
    }
  });

  it('한 세션에서 허리에 최대 부하를 거듭 싣지 않는다', () => {
    const program = buildProgram(answers({ daysPerWeek: 5 }), 'advanced');
    for (const template of program.templates) {
      const heavy = template.slots
        .map((slot) => exerciseById(slot.exerciseId) as Exercise)
        .filter((exercise) => (exercise.jointStress.lowBack ?? 0) >= 0.8);
      assert.ok(heavy.length <= 1, `${template.name}: ${heavy.map((e) => e.name).join(', ')}`);
    }
  });

  it('목표에 따라 반복 범위가 달라진다', () => {
    const strength = buildProgram(answers({ goals: ['strength'] }), 'advanced');
    const hypertrophy = buildProgram(answers({ goals: ['hypertrophy'] }), 'advanced');

    const firstOf = (p: ReturnType<typeof buildProgram>) => p.templates[0]!.slots[0]!.repRange;
    assert.ok(firstOf(strength).max < firstOf(hypertrophy).max);
  });

  it('통증이 보고된 관절에 부담이 큰 종목은 제외한다', () => {
    const program = buildProgram(
      answers({ pain: [{ joint: 'shoulder', score: 8 }] }),
      'intermediate',
    );
    for (const exercise of exercisesOf(program)) {
      assert.ok((exercise.jointStress.shoulder ?? 0) <= 0.3, exercise.name);
    }
  });

  it('생성된 프로그램의 주간 볼륨이 MEV 근처에서 시작한다', () => {
    const program = buildProgram(answers(), 'intermediate');
    const sessions = program.templates.map((template, i) => ({
      date: `2026-09-1${4 + i}`,
      sets: template.slots.flatMap((slot) =>
        Array.from({ length: slot.sets }, () => ({
          exerciseId: slot.exerciseId,
          weightKg: 50,
          reps: slot.repRange.max,
          rir: 2,
        })),
      ),
    }));

    const chest = aggregateVolume(sessions, index).chest;
    assert.ok(chest.effectiveSets >= 8, `가슴 ${chest.effectiveSets}세트`);
    assert.ok(chest.effectiveSets <= 20);
    assert.equal(chest.discountedSets, 0, '첫 프로그램이 세션당 상한을 넘지 않는다');
  });

  it('부위당 주 2회 이상 돌아가게 짠다', () => {
    const program = buildProgram(answers({ daysPerWeek: 4 }), 'intermediate');
    const daysHittingChest = program.templates.filter((template) =>
      template.slots.some((slot) => ((exerciseById(slot.exerciseId) as Exercise).contribution.chest ?? 0) >= 0.5),
    ).length;
    assert.ok(daysHittingChest >= 2, `가슴 주 ${daysHittingChest}회`);
  });
});

describe('주 7일', () => {
  it('7일째는 또 하나의 하드 세션이 아니라 보완일이다', () => {
    const program = buildProgram(answers({ daysPerWeek: 7 }), 'advanced');
    assert.equal(program.templates.length, 7);
    const last = program.templates[6]!;
    assert.match(last.name, /보완|가벼운/);
  });

  it('보완일은 관절 부담이 큰 복합 동작을 넣지 않는다', () => {
    const program = buildProgram(answers({ daysPerWeek: 7 }), 'advanced');
    const last = program.templates[6]!;
    for (const slot of last.slots) {
      const exercise = EXERCISES.find((item) => item.id === slot.exerciseId)!;
      assert.ok(
        exercise.pattern === 'isolation' || exercise.pattern === 'core' || exercise.pattern === 'carry',
        `${exercise.name}(${exercise.pattern})는 가벼운 날에 맞지 않는다`,
      );
    }
  });
});

describe('주 1~2회', () => {
  it('주 1회는 전신 한 번이다', () => {
    const program = buildProgram(answers({ daysPerWeek: 1 }), 'intermediate');
    assert.equal(program.templates.length, 1);
    assert.match(program.name, /주 1회/);
  });

  it('주 1회로 늘릴 수 있다고 말하지 않는다', () => {
    const program = buildProgram(answers({ daysPerWeek: 1 }), 'intermediate');
    assert.ok(program.caution, '한계를 말하지 않으면 사용자가 몇 달 뒤에 앱을 탓한다');
    assert.match(program.caution!, /지키는|최소 자극선/);
  });

  it('빠지는 부위 없이 전신을 돌린다', () => {
    const program = buildProgram(answers({ daysPerWeek: 1 }), 'intermediate');
    const slots = program.templates[0]!.slots.length;
    assert.ok(slots >= 5, `전신인데 슬롯이 ${slots}개뿐이다`);
  });

  it('일수가 충분하면 경고하지 않는다', () => {
    const program = buildProgram(answers({ daysPerWeek: 5 }), 'intermediate');
    assert.equal(program.caution, undefined);
  });
});
