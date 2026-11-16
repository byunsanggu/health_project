import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildConditioning, buildFinisher, finisherMinutes, weeklyConditioningPlan, type WodModality,
} from '../conditioning.ts';
import { GOAL_HINTS_KO, GOAL_LABELS_KO, TRAINING_GOALS, describeGoals, planGoals, type TrainingGoal } from '../goals.ts';
import {
  CONDITIONING_GROWTH_CAP, conditioningSetCap, isStrengthLift, runOnboarding, trimForConditioning,
} from '../onboarding.ts';
import { planWeekSets } from '../weekSets.ts';
import { bodyGoalOf } from '../protein.ts';
import { wrapUpLines } from '../coach.ts';
import { presetEquipment } from '../gymPresets.ts';
import { exerciseById, isUnloaded } from '../exercises.ts';
import type { TrainingLevel } from '../types.ts';
import type { WeeklyPlan } from '../mesocycle.ts';
import { index } from './helpers.ts';

/*
 * 다섯 사람 × 단계 × 주 횟수 × 기구 — 목표마다 받는 계획이 실제로 다른지, 그 목표에 맞는지.
 */
const GYMS: Record<string, string[]> = {
  franchise: presetEquipment('franchise'),
  home: ['floor', 'dumbbells'],
  mat: ['floor'],
};
const LEVELS: TrainingLevel[] = ['beginner', 'intermediate'];
const DAYS = [2, 3, 4, 5];

function onboard(goals: TrainingGoal[], level: TrainingLevel, days: number, gym: string) {
  return runOnboarding({
    selfReportedLevel: level, monthsTraining: level === 'beginner' ? 1 : 14, bodyweightKg: 75, sex: 'male',
    daysPerWeek: days, goals, gym: { equipmentIds: GYMS[gym]! },
  });
}

function everyCase(run: (level: TrainingLevel, days: number, gym: string) => void): void {
  for (const level of LEVELS) for (const days of DAYS) for (const gym of Object.keys(GYMS)) run(level, days, gym);
}

const daySets = (result: ReturnType<typeof onboard>) =>
  result.program.templates.map((template) => template.slots.reduce((sum, slot) => sum + slot.sets, 0));

describe('목표 — 체력 기르기(크로스핏식)를 고를 수 있다', () => {
  it('목표 목록에 있고 이름 · 설명이 합니다체다', () => {
    assert.ok(TRAINING_GOALS.includes('conditioning'));
    assert.deepEqual(Object.keys(GOAL_LABELS_KO), [...TRAINING_GOALS]);
    assert.match(GOAL_LABELS_KO.conditioning, /체력/);
    assert.match(GOAL_HINTS_KO.conditioning, /니다$/);
    assert.ok(!GOAL_LABELS_KO.conditioning.includes(' · '), '목표 사이 구분 글자를 이름 안에 쓰지 않는다');
    assert.equal(describeGoals(['conditioning', 'strength']), '근력 · 체력 기르기 (크로스핏식)');
  });

  it('숨찬 운동이 회복을 나눠 쓰므로 세트는 중간에서 멈춘다 — 감량과 같다', () => {
    const plan = planGoals(['conditioning']);
    assert.equal(plan.conditioning, true);
    assert.equal(plan.cutting, false);
    assert.equal(plan.volumeCeiling, 'mav');
    assert.match(plan.notes.join(' '), /마무리 운동/);
    assert.match(plan.notes.join(' '), /바벨/, '시간에 쫓기며 바벨을 들지 않는다고 말한다');
    for (const note of plan.notes) assert.match(note, /(니다|세요)\.?$/, note);
  });

  it('다른 목표의 판단은 그대로다', () => {
    assert.equal(planGoals(['hypertrophy']).conditioning, false);
    assert.equal(planGoals(['hypertrophy']).volumeCeiling, 'mrv');
    assert.equal(planGoals(['strength', 'conditioning']).primary, 'strength');
    assert.equal(bodyGoalOf(['conditioning']), 'hold');
    assert.equal(bodyGoalOf(['conditioning', 'fatLoss']), 'cut');
  });

  it('근육 키우기와 같이 고르면 무엇이 깎이는지 말한다', () => {
    assert.match(planGoals(['hypertrophy', 'conditioning']).notes.join(' '), /세트가 줄어듭니다/);
  });

  it('코치 끝 인사는 목표 한 줄이 없는 목표에서 빈 줄을 읽지 않는다', () => {
    for (const style of ['tough', 'energetic', 'gentle', 'fun'] as const) {
      const lines = wrapUpLines({ style, setsDone: 12, liftsDone: 4, goal: 'conditioning' });
      assert.ok(lines.every((line) => typeof line === 'string' && line.length > 0), style);
      assert.ok(lines.some((line) => /마무리 운동|숨찬/.test(line)), `${style}: 체력 기르기 한 줄이 있다`);
    }
  });
});

describe('체력 기르기 — 근력 부분은 짧게', () => {
  it('어느 조합이든 하루 세트가 상한 안이고 큰 운동이 앞에 남는다', () => {
    everyCase((level, days, gym) => {
      const result = onboard(['conditioning'], level, days, gym);
      const cap = conditioningSetCap(result.level.level);
      const base = onboard(['general'], level, days, gym);
      daySets(result).forEach((sets, d) => {
        const where = `${level}/${days}/${gym}/${result.program.templates[d]!.name}`;
        assert.ok(sets <= cap, `${where}: ${sets}세트 > ${cap}`);
        assert.ok(sets >= 6, `${where}: ${sets}세트는 너무 적다`);
        assert.ok(sets <= daySets(base)[d]!, `${where}: 건강 유지보다 길면 안 된다`);
      });
      for (const template of result.program.templates) {
        assert.ok(template.slots.length >= 3 && template.slots.length <= 4, `${level}/${days}/${gym}/${template.name}: ${template.slots.length}종목`);
        assert.equal(template.growthCap, CONDITIONING_GROWTH_CAP);
        const primaries = base.program.templates.find((item) => item.name === template.name)!
          .slots.filter((slot) => slot.role === 'primary').slice(0, 4).map((slot) => slot.exerciseId);
        for (const id of primaries) assert.ok(template.slots.some((slot) => slot.exerciseId === id), `${template.name}: 메인 ${id}가 빠졌다`);
      }
      assert.match(result.program.caution ?? '', /마무리 운동/);
    });
  });

  it('반복 범위와 종목 순서는 건드리지 않는다', () => {
    const base = onboard(['general'], 'intermediate', 4, 'franchise').program.templates;
    const trimmed = trimForConditioning(base, 'intermediate');
    trimmed.forEach((template, d) => {
      const order = base[d]!.slots.map((slot) => slot.exerciseId);
      const kept = template.slots.map((slot) => slot.exerciseId);
      assert.deepEqual(kept, order.filter((id) => kept.includes(id)));
      for (const slot of template.slots) {
        assert.deepEqual(slot.repRange, base[d]!.slots.find((item) => item.exerciseId === slot.exerciseId)!.repRange);
        assert.ok(slot.sets >= 2);
      }
    });
  });

  it('내 루틴(fixed)은 그대로 둔다', () => {
    const fixed = [{ name: '내 루틴', fixed: true, slots: [{ exerciseId: 'lateral-raise', sets: 6, repRange: { min: 10, max: 15 }, role: 'isolation' as const }] }];
    assert.deepEqual(trimForConditioning(fixed, 'beginner'), fixed);
  });

  it('근육 키우기를 같이 고르면 덜 줄인다', () => {
    const only = onboard(['conditioning'], 'intermediate', 4, 'franchise');
    const both = onboard(['conditioning', 'hypertrophy'], 'intermediate', 4, 'franchise');
    const total = (result: ReturnType<typeof onboard>) => daySets(result).reduce((a, b) => a + b, 0);
    assert.ok(total(both) > total(only));
    assert.ok(Math.max(...daySets(both)) <= conditioningSetCap('intermediate', true));
  });

  it('과정이 지나도 근력 쪽이 하루 두 세트 넘게 늘지 않는다', () => {
    const result = onboard(['conditioning'], 'intermediate', 3, 'franchise');
    const templates = result.program.templates;
    const base = daySets(result);
    const plan: WeeklyPlan = {
      ...result.firstWeek, weekInBlock: 5, volumeCeiling: 'mav',
      volume: (['chest', 'back', 'quads', 'hamstrings', 'glutes', 'frontDelt'] as const).map((muscle) => ({
        muscle, currentSets: 4, prescribedSets: 16, action: 'increase' as const, reason: '',
      })) as unknown as WeeklyPlan['volume'],
    };
    const grown = planWeekSets({ templates, plan, index, level: 'intermediate' });
    grown.forEach((day, d) => {
      const sum = day.reduce((a, b) => a + b, 0);
      assert.ok(sum <= base[d]! + CONDITIONING_GROWTH_CAP, `${templates[d]!.name}: ${base[d]} → ${sum}`);
    });
    // 상한이 없는 프로그램은 전처럼 더 는다
    const free = templates.map((template) => ({ ...template, growthCap: undefined }));
    const freeSum = planWeekSets({ templates: free, plan, index, level: 'intermediate' }).flat().reduce((a, b) => a + b, 0);
    assert.ok(freeSum >= grown.flat().reduce((a, b) => a + b, 0));
  });
});

describe('체력 기르기 — 한 주의 마무리 운동', () => {
  it('운동하는 날마다 하나씩, 8~15분', () => {
    everyCase((level, days, gym) => {
      const result = onboard(['conditioning'], level, days, gym);
      const plan = result.conditioning;
      assert.equal(plan.kind, 'conditioning');
      assert.equal(plan.days.length, days);
      for (const spec of plan.days) {
        assert.ok(spec.minutes >= 8 && spec.minutes <= 20, `${spec.title}`);
        assert.match(spec.why, /니다\.$/);
        if (spec.kind === 'wod') assert.equal(spec.minutes, finisherMinutes(result.level.level, 1));
      }
      assert.ok(plan.restDay && plan.restDay.sessions === 1, '쉬는 날은 가볍게 걷기 한 번');
      for (const note of plan.notes) assert.match(note, /니다\.$/, note);
    });
  });

  it('기구가 다 있으면 무게 · 맨몸 · 유산소가 한 주에 다 들어간다 — 주 2회여도', () => {
    for (const level of LEVELS) for (const days of DAYS) {
      const plan = onboard(['conditioning'], level, days, 'franchise').conditioning;
      for (const kind of ['weights', 'bodyweight', 'cardio'] as WodModality[]) {
        assert.ok(plan.modalities.includes(kind), `${level}/${days}: ${kind} 없음`);
      }
    }
  });

  it('없는 기구의 갈래는 약속하지 않고 그렇다고 말한다', () => {
    const mat = onboard(['conditioning'], 'beginner', 3, 'mat').conditioning;
    assert.deepEqual(mat.modalities, ['bodyweight']);
    assert.match(mat.notes.join(' '), /맨몸 동작으로 짭니다/);
    assert.match(mat.notes.join(' '), /유산소 기구가 없어/);
    const home = onboard(['conditioning'], 'intermediate', 3, 'home').conditioning;
    assert.ok(home.modalities.includes('weights') && !home.modalities.includes('cardio'));
  });

  it('초보 — 처음 두 주는 속도를 스스로 내는 방식이 없고, 빨리 끝내기는 끝까지 없다', () => {
    for (const days of DAYS) for (const gym of Object.keys(GYMS)) {
      const result = onboard(['conditioning'], 'beginner', days, gym);
      for (const week of [1, 2, 3, 6]) {
        const plan = weeklyConditioningPlan({
          goals: ['conditioning'], level: 'beginner', templates: result.program.templates,
          equipmentIds: GYMS[gym], weekInBlock: week,
        });
        for (const spec of plan.days.filter((item) => item.kind === 'wod')) {
          assert.notEqual(spec.format, 'forTime', `${days}/${gym}/w${week}`);
          if (week <= 2) assert.ok(spec.format === 'emom' || spec.format === 'circuit', `${days}/${gym}/w${week}: ${spec.format}`);
          assert.equal(spec.minutes, week >= 3 ? 10 : 8);
        }
        for (const spec of plan.days) assert.notEqual(spec.zone, 'interval', '초보에게 전력 인터벌을 주지 않는다');
      }
    }
  });

  it('초보의 마무리 운동에는 바벨 · 뛰는 유산소 · 어려운 몸통 운동이 없다', () => {
    for (const days of DAYS) for (const gym of Object.keys(GYMS)) {
      const result = onboard(['conditioning'], 'beginner', days, gym);
      for (const week of [1, 4]) {
        const plan = weeklyConditioningPlan({
          goals: ['conditioning'], level: 'beginner', templates: result.program.templates, equipmentIds: GYMS[gym], weekInBlock: week,
        });
        for (const spec of plan.days) for (const seed of [0, 1, 2, 3, 4, 5, 6]) {
          const finisher = buildFinisher(spec, { level: 'beginner', equipmentIds: GYMS[gym], home: gym !== 'franchise', seed, allowBarbell: true });
          if (finisher.kind === 'cardio') {
            assert.equal(finisher.cardio.exercise.impact, 'low', finisher.cardio.text);
            continue;
          }
          const moves = finisher.session.workout.movements;
          assert.ok(moves.length >= 3, `${days}/${gym}/${spec.dayName}: 동작 ${moves.length}개`);
          for (const move of moves) {
            if (move.exerciseId.startsWith('cardio:')) {
              assert.ok(!/treadmill-run|jump-rope|stair/.test(move.exerciseId), move.exerciseId);
              continue;
            }
            const exercise = exerciseById(move.exerciseId)!;
            assert.notEqual(exercise.equipment, 'barbell', move.name);
            assert.ok(!['ab-wheel-rollout', 'hanging-leg-raise', 'kettlebell-swing'].includes(exercise.id), move.name);
            assert.ok(Math.max(0, ...Object.values(exercise.jointStress)) <= 0.5, move.name);
          }
        }
      }
    }
  });

  it('중급도 바벨은 켜야만 들어가고, 근력 운동 뒤 마무리에는 기계 세 대를 돌지 않는다', () => {
    const result = onboard(['conditioning'], 'intermediate', 4, 'franchise');
    for (const spec of result.conditioning.days.filter((item) => item.kind === 'wod')) {
      for (const seed of [0, 3, 9]) {
        const finisher = buildFinisher(spec, { level: 'intermediate', equipmentIds: GYMS.franchise, seed });
        assert.equal(finisher.kind, 'wod');
        if (finisher.kind !== 'wod') continue;
        for (const move of finisher.session.workout.movements.filter((item) => !item.exerciseId.startsWith('cardio:'))) {
          const exercise = exerciseById(move.exerciseId)!;
          assert.ok(['dumbbell', 'bodyweight', 'band'].includes(exercise.equipment), `${move.name}(${exercise.equipment})`);
        }
      }
    }
  });

  it('갈래를 좁히면 그 갈래 동작으로 짠다', () => {
    const common = { format: 'amrap' as const, minutes: 10, level: 'intermediate' as const, equipmentIds: GYMS.franchise };
    const body = buildConditioning({ ...common, only: ['bodyweight'] });
    assert.ok(body.movements.every((move) => isUnloaded(exerciseById(move.exerciseId)!)));
    const loaded = buildConditioning({ ...common, only: ['weights'], portableOnly: true });
    assert.ok(loaded.movements.filter((move) => exerciseById(move.exerciseId)!.pattern !== 'core')
      .every((move) => !isUnloaded(exerciseById(move.exerciseId)!)));
    // 좁히지 않으면 전과 같다
    assert.deepEqual(buildConditioning(common), buildConditioning({ ...common, only: undefined }));
  });

  it('유산소 구간은 한 바퀴 맨 앞에, 동작 수는 그대로', () => {
    const common = { format: 'circuit' as const, minutes: 10, level: 'intermediate' as const, equipmentIds: GYMS.franchise };
    const plain = buildConditioning(common);
    const mixed = buildConditioning({ ...common, cardioElement: { id: 'row', name: '로잉머신', seconds: 60 } });
    assert.equal(mixed.movements.length, plain.movements.length);
    assert.equal(mixed.movements[0]!.exerciseId, 'cardio:row');
    assert.equal(mixed.movements[0]!.display, '1분');
  });

  it('무거운 데드리프트를 한 날은 매 분 쉬는 방식이고 뒤허벅지 · 엉덩이를 피한다', () => {
    const result = onboard(['conditioning', 'strength'], 'intermediate', 4, 'franchise');
    const pullDay = result.program.templates.findIndex((template) =>
      template.slots.some((slot) => ['conventional-deadlift', 'sumo-deadlift', 'trap-bar-deadlift'].includes(slot.exerciseId)));
    assert.ok(pullDay >= 0, '데드리프트가 근력 부분에 남아 있어야 한다');
    const spec = result.conditioning.days[pullDay]!;
    if (spec.kind === 'wod') {
      assert.equal(spec.format, 'emom');
      assert.ok(spec.avoidMuscles.includes('hamstrings'));
    }
    // 근력을 같이 고르면 바벨 메인은 무겁게 남는다
    const heavy = result.program.templates.flatMap((template) => template.slots)
      .filter((slot) => slot.role === 'primary' && isStrengthLift(exerciseById(slot.exerciseId)!) && slot.repRange.max <= 6);
    assert.ok(heavy.length >= 2);
  });

  it('하체만 하는 날의 유산소 구간은 다리에 크게 실리는 것(계단 · 달리기)을 쓰지 않는다', () => {
    const result = onboard(['conditioning'], 'intermediate', 5, 'franchise');
    for (const spec of result.conditioning.days.filter((item) => item.easyOnLegs)) {
      for (const seed of [0, 1, 2, 3, 4, 5]) {
        const finisher = buildFinisher(spec, { level: 'intermediate', equipmentIds: GYMS.franchise, seed });
        if (finisher.kind === 'cardio') {
          assert.ok(finisher.cardio.exercise.legLoad <= 0.4, finisher.cardio.text);
          assert.notEqual(spec.zone, 'interval');
          assert.ok(finisher.cardio.exercise.needsMachine, '헬스장에서는 있는 기구부터');
        } else {
          for (const move of finisher.session.workout.movements) assert.ok(!/stair|treadmill-run/.test(move.exerciseId), move.exerciseId);
        }
      }
    }
  });

  it('덜어내는 주에는 숨찬 운동 대신 쉬운 유산소 10분', () => {
    const result = onboard(['conditioning'], 'intermediate', 4, 'franchise');
    const plan = weeklyConditioningPlan({ goals: ['conditioning'], level: 'intermediate', templates: result.program.templates, deload: true });
    assert.ok(plan.days.every((spec) => spec.kind === 'cardio' && spec.zone === 'easy' && spec.minutes === 10));
    assert.equal(plan.restDay, null);
  });

  it('주차가 지나면 길어진다 — 중급 10분에서 12분', () => {
    assert.equal(finisherMinutes('intermediate', 1), 10);
    assert.equal(finisherMinutes('intermediate', 3), 12);
    assert.equal(finisherMinutes('advanced', 4), 15);
  });
});

describe('체지방 감량 — 유산소가 계획에 들어 있다', () => {
  it('운동 뒤 대화되는 정도 10~20분 + 쉬는 날 걷기', () => {
    everyCase((level, days, gym) => {
      const result = onboard(['fatLoss'], level, days, gym);
      const plan = result.conditioning;
      assert.equal(plan.kind, 'fatLoss');
      assert.equal(plan.days.length, days);
      for (const spec of plan.days) {
        assert.equal(spec.kind, 'cardio');
        assert.ok(spec.zone === 'easy' || spec.zone === 'steady', '감량이라고 세게 시키지 않는다');
        assert.ok(spec.minutes >= 10 && spec.minutes <= 20);
        const finisher = buildFinisher(spec, { level, equipmentIds: GYMS[gym], home: gym !== 'franchise' });
        assert.equal(finisher.kind, 'cardio');
        if (finisher.kind === 'cardio') {
          if (spec.easyOnLegs) assert.ok(finisher.cardio.exercise.legLoad <= 0.4, finisher.cardio.text);
          if (gym !== 'franchise') assert.ok(!finisher.cardio.exercise.equipmentId, '집에 없는 기구를 권하지 않는다');
        }
      }
      assert.ok(plan.restDay && plan.restDay.sessions >= 1 && plan.restDay.sessions <= 3);
      assert.ok(plan.weeklyMinutes >= 60 && plan.weeklyMinutes <= 170, `${level}/${days}/${gym}: 한 주 ${plan.weeklyMinutes}분`);
      assert.ok(result.notes.some((note) => /유산소/.test(note)), '설문 끝 안내에 유산소가 나온다');
    });
  });

  it('근력 프로그램은 근육 키우기와 같다 — 감량이라고 가볍게 많이 하지 않는다', () => {
    everyCase((level, days, gym) => {
      const cut = onboard(['hypertrophy', 'fatLoss'], level, days, gym).program.templates;
      const grow = onboard(['hypertrophy'], level, days, gym).program.templates;
      assert.deepEqual(cut, grow);
    });
  });

  it('처음 두 주는 짧고 쉽게, 그 뒤에 늘린다', () => {
    const templates = onboard(['fatLoss'], 'beginner', 3, 'franchise').program.templates;
    const at = (week: number) => weeklyConditioningPlan({ goals: ['fatLoss'], level: 'beginner', templates, weekInBlock: week }).days[0]!;
    assert.deepEqual([at(1).minutes, at(1).zone], [10, 'easy']);
    assert.deepEqual([at(3).minutes, at(3).zone], [15, 'steady']);
  });
});

describe('근력 + 체지방 감량 — 한쪽이 다른 쪽을 덮지 않는다', () => {
  it('무거운 메인은 그대로, 세트는 중간에서 멈추고, 유산소는 쉽게 짧게', () => {
    everyCase((level, days, gym) => {
      const both = onboard(['strength', 'fatLoss'], level, days, gym);
      const strength = onboard(['strength'], level, days, gym);
      const cut = onboard(['fatLoss'], level, days, gym);
      // 근력 쪽 — 종목 · 반복 범위가 근력만 고른 것과 같다
      assert.deepEqual(both.program.templates, strength.program.templates);
      // 감량 쪽 — 세트 상한 · 단백질
      assert.equal(planGoals(['strength', 'fatLoss']).volumeCeiling, 'mav');
      assert.equal(bodyGoalOf(['strength', 'fatLoss']), 'cut');
      // 유산소 — 감량만 고른 것보다 많지 않고, 전부 '아주 쉽게', 하체 날은 10분
      const plan = both.conditioning;
      assert.equal(plan.kind, 'fatLoss');
      assert.ok(plan.weeklyMinutes <= cut.conditioning.weeklyMinutes, `${level}/${days}/${gym}`);
      for (const spec of plan.days) {
        assert.equal(spec.zone, 'easy');
        assert.ok(spec.minutes <= (spec.easyOnLegs ? 10 : 15));
      }
      assert.ok((plan.restDay?.sessions ?? 0) <= 2);
    });
  });

  it('안내가 두 목표를 다 말한다', () => {
    const text = planGoals(['strength', 'fatLoss']).notes.join(' ');
    assert.match(text, /4~6회/);
    assert.match(text, /식사/);
    assert.match(text, /숨이 턱까지 차는 운동은 넣지 않습니다/);
    assert.match(text, /지키는/);
  });

  it('주차가 지나도 하체 날 유산소는 10분, 그 밖은 15분에서 멈춘다', () => {
    const templates = onboard(['strength', 'fatLoss'], 'intermediate', 4, 'franchise').program.templates;
    const plan = weeklyConditioningPlan({ goals: ['strength', 'fatLoss'], level: 'intermediate', templates, weekInBlock: 5 });
    assert.deepEqual(plan.days.map((spec) => spec.minutes), [15, 10, 15, 10]);
  });
});

describe('근력 · 근육 키우기 · 건강 유지 — 붙는 것이 없고 전과 같다', () => {
  it('마무리 운동 계획이 없다', () => {
    for (const goals of [['strength'], ['hypertrophy'], ['general'], ['strength', 'hypertrophy']] as TrainingGoal[][]) {
      const result = onboard(goals, 'intermediate', 4, 'franchise');
      assert.equal(result.conditioning.kind, 'none');
      assert.deepEqual(result.conditioning.days, []);
      // 건강 유지는 일부러 짧게 짠 계획이라 늘어나는 폭에 상한이 있다
      if (!goals.includes('general')) assert.ok(result.program.templates.every((template) => template.growthCap === undefined));
    }
  });

  it('근력 — 바벨이 있는 곳은 메인이 무겁고, 근육 키우기와 반복 범위가 다르다', () => {
    for (const level of LEVELS) for (const days of DAYS) {
      const strength = onboard(['strength'], level, days, 'franchise').program.templates.flatMap((template) => template.slots);
      const heavy = strength.filter((slot) => slot.role === 'primary' && isStrengthLift(exerciseById(slot.exerciseId)!));
      assert.ok(heavy.length >= 1, `${level}/${days}`);
      assert.ok(heavy.some((slot) => slot.repRange.max <= (level === 'beginner' ? 8 : 6)), `${level}/${days}`);
      const grow = onboard(['hypertrophy'], level, days, 'franchise').program.templates.flatMap((template) => template.slots);
      assert.notDeepEqual(strength.map((slot) => slot.repRange), grow.map((slot) => slot.repRange));
    }
  });

  it('근력인데 무겁게 들 바벨 종목이 없는 집은 그렇다고 말한다', () => {
    for (const gym of ['home', 'mat']) for (const level of LEVELS) {
      const result = onboard(['strength'], level, 3, gym);
      assert.ok(result.notes.some((note) => /무겁게 들 바벨 종목이 없습니다/.test(note)), `${level}/${gym}`);
    }
    const gymResult = onboard(['strength'], 'intermediate', 3, 'franchise');
    assert.ok(!gymResult.notes.some((note) => /바벨 종목이 없습니다/.test(note)));
    const other = onboard(['hypertrophy'], 'intermediate', 3, 'home');
    assert.ok(!other.notes.some((note) => /바벨 종목이 없습니다/.test(note)), '근력을 안 고른 사람에게는 말하지 않는다');
  });
});
