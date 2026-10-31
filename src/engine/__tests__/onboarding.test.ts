import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { assignRepRanges, buildProgram, runOnboarding, type OnboardingAnswers } from '../onboarding.ts';
import { buildSession } from '../session.ts';
import { HEAVY_PULLS } from '../exercises.ts';
import { COMMON_EQUIPMENT_IDS, EQUIPMENT_CATALOG } from '../equipment.ts';

const EQUIPMENT_IDS = new Set(EQUIPMENT_CATALOG.map((item) => item.id));
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
    // 아예 없는 부위는 무엇을 더하면 되는지, 한 가지뿐인 부위는 바꿔 가며 못 한다는 것
    assert.ok(result.notes.some((note) => /더하면 채워집니다|기구를 더 고르면/.test(note)), result.notes.join(' / '));
  });

  it('덤벨만 있는 집에서도 등 · 가슴 · 뒤허벅지 · 후면 어깨를 하고, 메인 자리는 복합 동작이다', () => {
    const result = runOnboarding(answers({ selfReportedLevel: 'beginner', monthsTraining: 3, daysPerWeek: 3, gym: { equipmentIds: ['floor', 'dumbbells'] } }));
    const all = exercisesOf(result.program);
    for (const muscle of ['back', 'chest', 'hamstrings', 'rearDelt'] as const) {
      assert.ok(all.some((exercise) => (exercise.contribution[muscle] ?? 0) >= 0.85), muscle);
    }
    for (const template of result.program.templates) {
      for (const slot of template.slots.filter((item) => item.role === 'primary')) {
        assert.ok(!['isolation', 'core'].includes(exerciseById(slot.exerciseId)!.pattern), `${template.name}: ${slot.exerciseId}`);
      }
    }
    // 바벨이 없는 집에 "바벨 스쿼트는 중급에 들어온다"고 하지 않는다
    assert.ok(!result.notes.some((note) => note.includes('바벨 백 스쿼트')), result.notes.join(' / '));
  });

  it('주 2회 전신은 가슴을 두 번 한다', () => {
    const program = buildProgram(answers({ daysPerWeek: 2 }), 'intermediate');
    for (const template of program.templates) {
      assert.ok(template.slots.some((slot) => (exerciseById(slot.exerciseId)!.contribution.chest ?? 0) >= 0.75), template.name);
    }
  });

  it('주의 문구는 짠 프로그램의 실제 볼륨으로 — 주 2회 가슴 미달이면 말한다', () => {
    const program = buildProgram(answers({ daysPerWeek: 2 }), 'intermediate');
    assert.match(program.caution ?? '', /주 2회.*최소 세트 아래/);
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

  it('통증 3~6점이어도 그 관절에 부담이 큰 종목(오늘이면 대체할 종목)은 처음부터 빼고 짠다', () => {
    const onboarded = runOnboarding(answers({ pain: [{ joint: 'knee', score: 5 }] }));
    for (const exercise of exercisesOf(onboarded.program)) {
      assert.ok((exercise.jointStress.knee ?? 0) < 0.6, `${exercise.name} 무릎 ${exercise.jointStress.knee}`);
    }
    // 하체는 부담이 덜한 종목으로 남는다 — 통째로 빠지지 않는다
    assert.ok(exercisesOf(onboarded.program).some((exercise) => (exercise.contribution.quads ?? 0) >= 0.7));
    const note = onboarded.notes.find((line) => line.includes('통증'));
    assert.ok(note?.includes('무릎') && note.includes('백 스쿼트'), note);
  });

  it('통증이 없거나 뺄 종목이 없으면 "뺐다"고 말하지 않는다', () => {
    assert.ok(!runOnboarding(answers()).notes.some((line) => line.includes('통증')));
    // 목 통증 3점 — 목에 부담이 큰 종목이 없으면 뺀 것도 없다
    const neck = runOnboarding(answers({ pain: [{ joint: 'neck', score: 3 }] }));
    const removed = EXERCISES.some((exercise) => (exercise.jointStress.neck ?? 0) >= 0.6);
    assert.equal(neck.notes.some((line) => line.includes('빼고 짰습니다')), removed);
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
          // 종아리는 대신 채워 줄 복합 종목이 없다 — 고립 한 세트 더(4세트)는 예외로 둔다
          if (exerciseById(slot.exerciseId)!.contribution.calves === 1) {
            assert.ok(slot.sets <= Math.max(most, 4), `${label} ${template.name}: ${slot.exerciseId} ${slot.sets}`);
            continue;
          }
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

describe('buildProgram — 하체 구성 · 데드리프트 · 풀업', () => {
  const isCurl = (id: string) => {
    const exercise = exerciseById(id)!;
    return exercise.pattern === 'isolation' && (exercise.contribution.hamstrings ?? 0) >= 0.85;
  };
  const heavyHinge = (id: string) => {
    const exercise = exerciseById(id)!;
    return exercise.pattern === 'hinge' && (exercise.jointStress.lowBack ?? 0) >= 0.5;
  };

  it('주 5 · 6회 레그 날마다 레그컬이 있다 — 힌지만으로는 뒤허벅지가 덜 자란다', () => {
    for (const days of [5, 6]) {
      for (const level of ['intermediate', 'advanced'] as const) {
        const program = buildProgram(answers({ daysPerWeek: days }), level);
        for (const template of program.templates.filter((item) => item.name.startsWith('레그'))) {
          assert.ok(template.slots.some((slot) => isCurl(slot.exerciseId)), `${days}회 ${level} ${template.name}`);
        }
      }
    }
  });

  it('하루에 허리를 많이 쓰는 힌지는 하나 — 데드리프트 뒤에 스티프 레그 데드를 붙이지 않는다', () => {
    const gyms = [COMMON_EQUIPMENT_IDS, ['floor', 'barbell-set', 'power-rack', 'bench-flat', 'dumbbells', 'pull-up-bar']];
    for (const equipmentIds of gyms) {
      for (const days of [2, 3, 4, 5, 6]) {
        const program = buildProgram(answers({ daysPerWeek: days, gym: { equipmentIds } }), 'intermediate');
        for (const template of program.templates) {
          const hinges = template.slots.filter((slot) => heavyHinge(slot.exerciseId)).map((slot) => slot.exerciseId);
          assert.ok(hinges.length <= 1, `${days}회 ${template.name}: ${hinges.join(', ')}`);
        }
      }
    }
  });

  it('데드리프트는 4~6회(근력이면 3~5회)이고, 블록 끝에도 여유를 2개는 남긴다', () => {
    const program = buildProgram(answers({ daysPerWeek: 4 }), 'intermediate');
    const slots = program.templates.flatMap((template) => template.slots).filter((slot) => HEAVY_PULLS.has(slot.exerciseId));
    assert.ok(slots.length > 0, '주 4회 하체 B에 데드리프트가 있어야 이 시험이 뜻이 있다');
    for (const slot of slots) assert.deepEqual(slot.repRange, { min: 4, max: 6 });
    const strength = buildProgram(answers({ daysPerWeek: 4, goals: ['strength'] }), 'intermediate');
    for (const slot of strength.templates.flatMap((template) => template.slots).filter((item) => HEAVY_PULLS.has(item.exerciseId))) {
      assert.deepEqual(slot.repRange, { min: 3, max: 5 });
    }
    const day = program.templates.find((template) => template.slots.some((slot) => HEAVY_PULLS.has(slot.exerciseId)))!;
    const plan = { ...runOnboarding(answers()).firstWeek, targetRir: 1, weekInBlock: 1 };
    const planned = buildSession({ template: day, date: '2026-09-21', plan, history: [], index });
    for (const item of planned.exercises) {
      const floor = HEAVY_PULLS.has(item.exercise.id) ? 2 : 1;
      assert.ok(item.sets.every((set) => set.targetRir === floor), `${item.exercise.name} ${item.sets[0]!.targetRir}`);
    }
  });

  it('데드리프트 전날에는 허리를 많이 쓰는 로우를 두지 않는다', () => {
    const program = buildProgram(answers({ daysPerWeek: 4 }), 'intermediate');
    program.templates.forEach((template, d) => {
      const next = program.templates[d + 1];
      if (!next?.slots.some((slot) => HEAVY_PULLS.has(slot.exerciseId))) return;
      for (const slot of template.slots) {
        assert.ok((exerciseById(slot.exerciseId)!.jointStress.lowBack ?? 0) < 0.7, `${template.name} ${slot.exerciseId}`);
      }
    });
  });

  it('중급부터는 고블릿 스쿼트 · 케이블 풀스루를 메인으로 두지 않는다 — 레그프레스 · 힙 쓰러스트가 있으면', () => {
    const residence = ['dumbbells', 'bench-flat', 'bench-incline', 'leg-press-machine', 'smith-machine', 'cable-station', 'lat-pulldown-machine', 'leg-curl-machine', 'leg-extension-machine', 'floor']
      .filter((id) => EQUIPMENT_IDS.has(id));
    const program = buildProgram(answers({ daysPerWeek: 4, gym: { equipmentIds: residence } }), 'intermediate');
    for (const template of program.templates) {
      const main = template.slots.filter((slot) => slot.role === 'primary').map((slot) => slot.exerciseId);
      assert.ok(!main.includes('goblet-squat') && !main.includes('cable-pull-through'), `${template.name}: ${main.join(', ')}`);
    }
    // 초보에게 고블릿 스쿼트는 좋은 첫 스쿼트다
    const beginner = buildProgram(answers({ selfReportedLevel: 'beginner', monthsTraining: 2, daysPerWeek: 3 }), 'beginner');
    assert.ok(beginner.templates.some((template) => template.slots.some((slot) => slot.role === 'primary' && slot.exerciseId === 'goblet-squat')));
  });

  it('랫풀다운이 있으면 풀업보다 먼저 — 몇 개 되는지 모르는 처음이다. 철봉뿐이면 풀업', () => {
    const ids = (program: ReturnType<typeof buildProgram>) => program.templates.flatMap((template) => template.slots.map((slot) => slot.exerciseId));
    for (const level of ['beginner', 'intermediate'] as const) {
      assert.ok(!ids(buildProgram(answers({ daysPerWeek: 4 }), level)).includes('pull-up'), level);
    }
    const bar = buildProgram(answers({ daysPerWeek: 4, gym: { equipmentIds: ['floor', 'dumbbells', 'bench-flat', 'pull-up-bar'] } }), 'intermediate');
    assert.ok(ids(bar).some((id) => id === 'pull-up' || id === 'chin-up'));
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

describe('근력 목표의 반복 범위', () => {
  const primaries = (program: ReturnType<typeof buildProgram>) => program.templates.flatMap((template) =>
    template.slots.filter((slot) => slot.role === 'primary').map((slot) => ({ slot, exercise: exerciseById(slot.exerciseId)!, day: template.name })));
  const lowRep = (slot: { repRange: { max: number } }) => slot.repRange.max <= 6;

  it('4~6회는 양손 바벨 주 종목에만 — 덤벨 · 머신 · 한쪽씩 · 루마니안은 근력이어도 6~10회', () => {
    for (const days of [3, 4]) {
      const program = buildProgram(answers({ daysPerWeek: days, goals: ['strength'] }), 'intermediate');
      for (const { slot, exercise } of primaries(program)) {
        const barbell = exercise.equipment === 'barbell' && !exercise.unilateral &&
          !['romanian-deadlift', 'stiff-leg-deadlift', 'good-morning', 'hip-thrust', 'landmine-press'].includes(exercise.id);
        if (!barbell) assert.deepEqual(slot.repRange, { min: 6, max: 10 }, exercise.name);
        // 근력만이면 같은 동작의 두 번째 날은 가벼운 날(6~8회) — 무거운 날 · 가벼운 날
        else assert.ok(slot.repRange.max <= 8, `${exercise.name} ${slot.repRange.min}-${slot.repRange.max}`);
      }
      // 동작마다 한 번은 무겁게(6회 이하)
      const patterns = new Set(primaries(program).filter(({ exercise }) => exercise.equipment === 'barbell').map(({ exercise }) => exercise.pattern));
      for (const pattern of patterns) {
        assert.ok(primaries(program).some(({ slot, exercise }) => exercise.pattern === pattern && lowRep(slot)), pattern + ' 무거운 날이 없습니다');
      }
    }
  });

  it('근력 + 근비대면 동작마다 한 주에 한 번만 무겁게 — 같은 동작의 다른 날은 볼륨', () => {
    for (const days of [3, 4, 5]) {
      const program = buildProgram(answers({ daysPerWeek: days, goals: ['strength', 'hypertrophy'] }), 'intermediate');
      const heavy = primaries(program).filter(({ slot }) => lowRep(slot));
      const patterns = heavy.map(({ exercise }) => exercise.pattern);
      assert.equal(new Set(patterns).size, patterns.length, `${days}회 무거운 동작이 겹칩니다: ${heavy.map((h) => h.exercise.name).join(', ')}`);
      assert.ok(heavy.length >= 2, `${days}회 무거운 종목이 너무 적습니다`);
      for (const template of program.templates) {
        assert.ok(template.slots.filter((slot) => slot.role === 'primary' && lowRep(slot)).length <= 2, template.name);
      }
    }
  });

  it('초보가 근력을 고르면 바벨 주 종목도 5~8회 — 자세가 잡히기 전에 최대 근처로 몇 개만 하지 않는다', () => {
    const program = buildProgram(answers({ daysPerWeek: 3, goals: ['strength'] }), 'beginner');
    for (const { slot, exercise } of primaries(program)) {
      assert.ok(slot.repRange.min >= 4 && slot.repRange.max >= 6, `${exercise.name} ${slot.repRange.min}-${slot.repRange.max}`);
      if (!HEAVY_PULLS.has(exercise.id)) assert.ok(slot.repRange.min >= 5, `${exercise.name} ${slot.repRange.min}-${slot.repRange.max}`);
    }
  });

  it('근비대만이면 바뀐 게 없다 — 주 종목 6~10회', () => {
    const program = buildProgram(answers({ daysPerWeek: 4, goals: ['hypertrophy'] }), 'intermediate');
    for (const { slot, exercise } of primaries(program)) {
      if (HEAVY_PULLS.has(exercise.id)) continue;
      assert.deepEqual(slot.repRange, { min: 6, max: 10 }, exercise.name);
    }
  });

  it('이미 저장된 예전 프로그램도 반복 범위만 새 규칙으로 — 종목 · 세트는 그대로, 내 루틴은 손대지 않는다', () => {
    const fresh = buildProgram(answers({ daysPerWeek: 3, goals: ['strength', 'hypertrophy'] }), 'intermediate');
    const old = fresh.templates.map((template) => ({
      ...template,
      slots: template.slots.map((slot) => (slot.role === 'primary' ? { ...slot, repRange: { min: 4, max: 6 } } : slot)),
    }));
    const fixed = assignRepRanges(old, ['strength', 'hypertrophy'], 'intermediate');
    assert.deepEqual(fixed, fresh.templates);
    const mine = [{ ...old[0]!, fixed: true }];
    assert.deepEqual(assignRepRanges(mine, ['strength', 'hypertrophy'], 'intermediate'), mine);
  });
});

describe('기구 골고루 · 맨몸 섞기', () => {
  const kitOf = (id: string) => (exerciseById(id) as Exercise).equipment;

  it('주 3회부터 맨몸 종목이 들어가고, 하루를 한 가지 기구로 채우지 않는다', () => {
    for (const daysPerWeek of [3, 4, 5]) for (const level of ['beginner', 'intermediate'] as const) {
      const { program } = runOnboarding(answers({ daysPerWeek, selfReportedLevel: level }));
      const kits = exercisesOf(program).map((exercise) => exercise.equipment);
      assert.ok(kits.filter((kit) => kit === 'bodyweight').length >= (daysPerWeek >= 4 ? 2 : 1), `${daysPerWeek}회 ${level}`);
      for (const template of program.templates) {
        const counts = new Map<string, number>();
        for (const slot of template.slots) counts.set(kitOf(slot.exerciseId), (counts.get(kitOf(slot.exerciseId)) ?? 0) + 1);
        assert.ok(Math.max(...counts.values()) <= Math.ceil(template.slots.length / 2), `${template.name}: ${[...counts]}`);
      }
    }
  });

  it('초보에게는 딥스 · 행잉 레그레이즈를 먼저 넣지 않고, 플랭크처럼 버티는 동작은 횟수 칸에 넣지 않는다', () => {
    for (const daysPerWeek of [3, 4, 5]) {
      const { program } = runOnboarding(answers({ daysPerWeek, selfReportedLevel: 'beginner', monthsTraining: 2 }));
      const ids = program.templates.flatMap((template) => template.slots.map((slot) => slot.exerciseId));
      for (const hard of ['chest-dip', 'triceps-dip', 'hanging-leg-raise', 'plank', 'side-plank']) {
        assert.ok(!ids.includes(hard), `${daysPerWeek}회: ${hard}`);
      }
    }
  });

  it('무게를 못 올리는 맨몸 종목은 횟수를 넓게 잡는다', () => {
    let seen = 0;
    for (const daysPerWeek of [4, 5]) {
      const { program } = runOnboarding(answers({ daysPerWeek }));
      for (const slot of program.templates.flatMap((template) => template.slots)) {
        if (slot.exerciseId !== 'push-up') continue;
        assert.deepEqual(slot.repRange, { min: 12, max: 20 });
        seen += 1;
      }
    }
    assert.ok(seen > 0);
  });
});
