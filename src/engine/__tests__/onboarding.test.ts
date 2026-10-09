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

describe('buildProgram — 트레이너 기준 점검', () => {

  const cases: { label: string; days: number; level: 'beginner' | 'intermediate' | 'advanced' }[] = [
    { label: '초보 주2', days: 2, level: 'beginner' },
    { label: '초보 주3', days: 3, level: 'beginner' },
    { label: '중급 주4', days: 4, level: 'intermediate' },
    { label: '고급 주5', days: 5, level: 'advanced' },
    { label: '고급 주6', days: 6, level: 'advanced' },
  ];

  it('고립 종목이 같은 날 복합 종목보다 세트를 많이 받지 않는다', () => {
    for (const { label, days, level } of cases) {
      const program = buildProgram(answers({ daysPerWeek: days }), level);
      for (const template of program.templates) {
        const compound = template.slots
          .filter((slot) => exerciseById(slot.exerciseId)!.pattern !== 'isolation')
          .map((slot) => slot.sets);
        if (compound.length === 0) continue;
        const most = Math.max(...compound);
        for (const slot of template.slots) {
          if (exerciseById(slot.exerciseId)!.pattern !== 'isolation') continue;
          assert.ok(slot.sets <= most, `${label} ${template.name}: ${slot.exerciseId} ${slot.sets} > ${most}`);
        }
      }
    }
  });

  it('측면 삼각근 고립 세트가 이두 고립 세트보다 적지 않다', () => {
    for (const { label, days, level } of cases) {
      if (days < 3) continue;
      const program = buildProgram(answers({ daysPerWeek: days }), level);
      const setsFor = (muscle: 'sideDelt' | 'biceps') => program.templates
        .flatMap((template) => template.slots)
        .filter((slot) => {
          const exercise = exerciseById(slot.exerciseId)!;
          return exercise.pattern === 'isolation' && (exercise.contribution[muscle] ?? 0) >= 0.85;
        })
        .reduce((sum, slot) => sum + slot.sets, 0);
      assert.ok(setsFor('sideDelt') >= setsFor('biceps'), `${label}: 어깨 ${setsFor('sideDelt')} / 이두 ${setsFor('biceps')}`);
    }
  });

  it('초보에게는 첫 블록에 기술이 필요한 바벨 종목을 주지 않는다', () => {
    const technical = ['back-squat', 'front-squat', 'conventional-deadlift', 'sumo-deadlift',
      'stiff-leg-deadlift', 'good-morning', 'barbell-row', 'pendlay-row', 'barbell-overhead-press'];
    for (const days of [2, 3, 4]) {
      const program = buildProgram(answers({ daysPerWeek: days }), 'beginner');
      for (const exercise of exercisesOf(program)) {
        assert.ok(!technical.includes(exercise.id), `주 ${days}회: ${exercise.name}`);
      }
    }
  });

  it('기술 종목밖에 없는 헬스장이면 초보에게도 준다', () => {
    const minimal = ['floor', 'barbell-set', 'power-rack', 'bench-flat'];
    const program = buildProgram(answers({ daysPerWeek: 3, gym: { equipmentIds: minimal } }), 'beginner');
    assert.ok(exercisesOf(program).some((exercise) => exercise.id === 'back-squat'));
  });

  it('케이블이 있으면 킥백 · 컨센트레이션 컬을 고르지 않는다', () => {
    for (const { days, level } of cases) {
      const program = buildProgram(answers({ daysPerWeek: days }), level);
      for (const exercise of exercisesOf(program)) {
        assert.ok(!['triceps-kickback', 'concentration-curl'].includes(exercise.id), exercise.name);
      }
    }
  });

  it('세션이 한 시간 남짓을 넘기지 않는다', () => {
    for (const { label, days, level } of cases) {
      const program = buildProgram(answers({ daysPerWeek: days }), level);
      const limit = days <= 3 ? 16 : level === 'advanced' ? 20 : 18;
      for (const template of program.templates) {
        const total = template.slots.reduce((sum, slot) => sum + slot.sets, 0);
        assert.ok(total <= limit, `${label} ${template.name}: ${total}세트`);
      }
    }
  });

  it('주 2회 전신도 대퇴사두를 두 번 자극한다', () => {
    const program = buildProgram(answers({ daysPerWeek: 2 }), 'beginner');
    for (const template of program.templates) {
      assert.ok(
        template.slots.some((slot) => (exerciseById(slot.exerciseId)!.contribution.quads ?? 0) >= 0.85),
        `${template.name}에 대퇴사두 종목이 없다`,
      );
    }
  });

  it('하루에 고중량 하체 복합은 하나만 둔다', () => {
    for (const { label, days, level } of cases) {
      const program = buildProgram(answers({ daysPerWeek: days, goals: ['strength'] }), level);
      for (const template of program.templates) {
        const heavyLower = template.slots.filter((slot) => {
          const exercise = exerciseById(slot.exerciseId)!;
          return ['squat', 'hinge', 'lunge'].includes(exercise.pattern) && slot.repRange.max <= 6;
        });
        assert.ok(heavyLower.length <= 1, `${label} ${template.name}: ${heavyLower.map((s) => s.exerciseId).join(', ')}`);
      }
    }
  });

  it('초보에게 바벨 기본 종목이 나중에 들어온다고 알려준다', () => {
    const result = runOnboarding(answers({ selfReportedLevel: 'beginner', monthsTraining: 2, daysPerWeek: 3 }));
    assert.ok(result.notes.some((note) => note.includes('중급으로 다시 짤 때')));
  });
});

describe('buildProgram — 약점 부위 · 메인 종목', () => {
  const setsFor = (program: ReturnType<typeof buildProgram>, muscle: 'calves' | 'sideDelt') => program.templates
    .flatMap((template) => template.slots)
    .filter((slot) => (exerciseById(slot.exerciseId)!.contribution[muscle] ?? 0) >= 0.85)
    .reduce((sum, slot) => sum + slot.sets, 0);

  it('약점 부위는 자리와 세트를 더 받는다', () => {
    const plain = buildProgram(answers({ daysPerWeek: 5 }), 'advanced');
    const focused = buildProgram(answers({ daysPerWeek: 5, priorities: ['calves', 'sideDelt'] }), 'advanced');
    assert.ok(setsFor(focused, 'calves') > setsFor(plain, 'calves'));
    assert.ok(setsFor(focused, 'sideDelt') > setsFor(plain, 'sideDelt'));
    assert.ok(focused.weeklyTargets.calves! > plain.weeklyTargets.calves!);
  });

  it('약점 부위를 넣어도 세션 상한은 지킨다', () => {
    const program = buildProgram(answers({ daysPerWeek: 3, priorities: ['biceps', 'calves'] }), 'intermediate');
    for (const template of program.templates) {
      assert.ok(template.slots.reduce((sum, slot) => sum + slot.sets, 0) <= 16, template.name);
    }
  });

  it('약점은 두 개까지만 받는다', () => {
    const two = buildProgram(answers({ priorities: ['calves', 'biceps'] }), 'intermediate');
    const three = buildProgram(answers({ priorities: ['calves', 'biceps', 'traps'] }), 'intermediate');
    assert.deepEqual(three, two);
  });

  it('고른 메인 종목이 그 동작의 메인 자리에 들어간다', () => {
    const program = buildProgram(
      answers({ daysPerWeek: 4, mainLifts: { horizontalPush: 'incline-barbell-press' }, gym: { equipmentIds: [...COMMON_EQUIPMENT_IDS, 'bench-incline'] } }),
      'intermediate',
    );
    const first = program.templates[0]!.slots[0]!;
    assert.equal(first.exerciseId, 'incline-barbell-press');
    assert.equal(first.role, 'primary');
  });

  it('메인 자리가 없는 분할이면 그날 맨 앞 메인으로 올리고 다른 하체 메인은 내린다', () => {
    const program = buildProgram(answers({ daysPerWeek: 5, mainLifts: { hinge: 'conventional-deadlift' } }), 'advanced');
    const day = program.templates.find((template) => template.slots.some((slot) => slot.exerciseId === 'conventional-deadlift'))!;
    assert.equal(day.slots[0]!.exerciseId, 'conventional-deadlift');
    assert.equal(day.slots[0]!.role, 'primary');
    const heavyLower = day.slots.filter((slot) => slot.role === 'primary' &&
      ['squat', 'hinge', 'lunge'].includes(exerciseById(slot.exerciseId)!.pattern));
    assert.equal(heavyLower.length, 1);
  });

  it('헬스장에 없는 종목을 골랐으면 무시한다', () => {
    const minimal = ['floor', 'barbell-set', 'power-rack', 'bench-flat'];
    const program = buildProgram(answers({ gym: { equipmentIds: minimal }, mainLifts: { squat: 'hack-squat' } }), 'intermediate');
    assert.ok(!exercisesOf(program).some((exercise) => exercise.id === 'hack-squat'));
  });
});
