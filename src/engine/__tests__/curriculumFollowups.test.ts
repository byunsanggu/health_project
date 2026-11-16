import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { runOnboarding, maintenanceSetCap, MAINTENANCE_GROWTH_CAP } from '../onboarding.ts';
import { buildSession } from '../session.ts';
import { estimateSessionTime } from '../timeBudget.ts';
import { applyRepRules } from '../repRules.ts';
import { restFor, STRENGTH_HEAVY_REST_SECONDS } from '../rest.ts';
import { styleProfile } from '../styles.ts';
import { styleSets, withStyleVolume } from '../weekSets.ts';
import { planGoals, type TrainingGoal } from '../goals.ts';
import { presetEquipment } from '../gymPresets.ts';
import { exerciseById } from '../exercises.ts';
import type { TrainingLevel } from '../types.ts';
import { index } from './helpers.ts';

function onboard(goals: TrainingGoal[], level: TrainingLevel, days: number) {
  return runOnboarding({
    selfReportedLevel: level, monthsTraining: level === 'beginner' ? 1 : 18, bodyweightKg: 78, sex: 'male',
    daysPerWeek: days, goals, gym: { equipmentIds: presetEquipment('franchise') },
  });
}

function dayMinutes(result: ReturnType<typeof onboard>, style: 'hypertrophy' | 'strength', scaled: boolean, strengthGoal = false) {
  const week = scaled ? withStyleVolume(result.program.templates, style) : result.program.templates;
  return week.map((template, day) => {
    const session = buildSession({
      template: applyRepRules(template, { style }), date: '2026-09-21', plan: result.firstWeek,
      history: [], index, gym: result.gym, lifter: result.lifter, week: { templates: week, day },
    });
    return {
      minutes: estimateSessionTime(session, {
        restMultiplier: styleProfile(style).restMultiplier, strengthGoal, generalWarmupSeconds: 300,
      }).totalMinutes,
      sets: session.exercises.reduce((sum, item) => sum + item.sets.length, 0),
    };
  });
}

describe('과정 방식의 세트 배수가 실제로 걸린다', () => {
  it('근력 과정 — 세트가 줄고, 주 종목은 3세트 밑으로 내려가지 않는다', () => {
    assert.equal(styleSets(4, 'strength', 'accessory'), 3);
    assert.equal(styleSets(3, 'strength', 'isolation'), 2);
    assert.equal(styleSets(3, 'strength', 'primary'), 3);
    assert.equal(styleSets(2, 'strength', 'isolation'), 2);
    assert.equal(styleSets(4, 'hypertrophy', 'primary'), 4);
    assert.ok(styleSets(4, 'density', 'accessory') >= 4, '늘리는 배수는 줄이지 않는다');
  });

  it('기본 과정 · 내 루틴은 그대로', () => {
    const templates = onboard(['strength'], 'intermediate', 4).program.templates;
    assert.deepEqual(withStyleVolume(templates, 'hypertrophy'), [...templates]);
    const fixed = [{ ...templates[0]!, fixed: true }];
    assert.deepEqual(withStyleVolume(fixed, 'strength'), fixed);
  });

  it('주 3 · 4회 근력 과정의 하루가 60분 안팎에 끝난다', () => {
    for (const days of [3, 4]) {
      const result = onboard(['strength'], 'intermediate', days);
      const raw = dayMinutes(result, 'strength', false);
      const scaled = dayMinutes(result, 'strength', true);
      scaled.forEach((day, d) => {
        assert.ok(day.minutes <= 62, `주 ${days}회 ${d + 1}일째 ${day.minutes}분`);
        assert.ok(day.sets <= raw[d]!.sets);
      });
      assert.ok(scaled.reduce((a, b) => a + b.sets, 0) < raw.reduce((a, b) => a + b.sets, 0), '한 주 세트가 실제로 준다');
    }
  });
});

describe('근력 과정은 무거운 날 · 가벼운 날을 덮어쓰지 않는다', () => {
  it('같은 종목의 두 번째 날은 6~8회 그대로, 첫날은 3~5회', () => {
    const templates = onboard(['strength'], 'intermediate', 4).program.templates;
    const light = templates.flatMap((template) => template.slots)
      .filter((slot) => slot.role === 'primary' && slot.repRange.min === 6 && slot.repRange.max === 8);
    assert.ok(light.length > 0, '가벼운 날 칸이 있는 프로그램이어야 한다');
    const styled = templates.map((template) => applyRepRules(template, { style: 'strength' }));
    let kept = 0;
    let heavy = 0;
    templates.forEach((template, d) => template.slots.forEach((slot, i) => {
      const after = styled[d]!.slots[i]!.repRange;
      if (light.includes(slot)) { assert.deepEqual(after, { min: 6, max: 8 }); kept += 1; }
      else if (slot.role === 'primary' && slot.repRange.max <= 6 && after.max <= 5) heavy += 1;
    }));
    assert.ok(kept > 0 && heavy > 0);
  });
});

describe('근력 목표 — 무거운 바벨 세트는 3분', () => {
  const bench = exerciseById('barbell-bench-press')!;
  const press = exerciseById('dumbbell-bench-press')!;
  it('근력 과정이 아니어도 4~6회 바벨 큰 운동은 3분', () => {
    assert.equal(restFor({ exercise: bench, reps: 5, targetRir: 2, strengthGoal: true }).seconds, STRENGTH_HEAVY_REST_SECONDS);
    assert.equal(restFor({ exercise: bench, reps: 5, targetRir: 1, strengthGoal: true }).seconds, 180);
    assert.match(restFor({ exercise: bench, reps: 5, targetRir: 2, strengthGoal: true }).reason, /3분/);
  });
  it('다른 목표 · 다른 종목 · 많은 횟수는 그대로', () => {
    const plain = restFor({ exercise: bench, reps: 5, targetRir: 2 }).seconds;
    assert.equal(plain, 150);
    assert.equal(restFor({ exercise: bench, reps: 5, targetRir: 2, strengthGoal: false }).seconds, plain);
    assert.equal(restFor({ exercise: bench, reps: 8, targetRir: 2, strengthGoal: true }).seconds, restFor({ exercise: bench, reps: 8, targetRir: 2 }).seconds);
    assert.equal(restFor({ exercise: press, reps: 5, targetRir: 2, strengthGoal: true }).seconds, restFor({ exercise: press, reps: 5, targetRir: 2 }).seconds);
  });
  it('근력 과정(배수)과 직접 정한 휴식은 건드리지 않는다', () => {
    assert.equal(restFor({ exercise: bench, reps: 5, targetRir: 2, strengthGoal: true, multiplier: 1.5 }).seconds,
      restFor({ exercise: bench, reps: 5, targetRir: 2, multiplier: 1.5 }).seconds);
    assert.equal(restFor({ exercise: bench, reps: 5, targetRir: 2, strengthGoal: true, overrideSeconds: 100 }).seconds, 100);
  });
});

describe('건강 유지 — 짧은 계획', () => {
  it('하루 세트 · 종목이 줄고 40분 안팎에 끝난다', () => {
    for (const level of ['beginner', 'intermediate'] as const) for (const days of [2, 3, 4]) {
      const general = onboard(['general'], level, days);
      const grow = onboard(['hypertrophy'], level, days);
      const cap = maintenanceSetCap(general.level.level);
      general.program.templates.forEach((template) => {
        assert.ok(template.slots.length <= 5, `${level}/${days} 종목 ${template.slots.length}`);
        assert.ok(template.slots.reduce((sum, slot) => sum + slot.sets, 0) <= cap);
        assert.equal(template.growthCap, MAINTENANCE_GROWTH_CAP);
      });
      const sum = (r: typeof general) => r.program.templates.reduce((a, t) => a + t.slots.reduce((b, slot) => b + slot.sets, 0), 0);
      assert.ok(sum(general) <= sum(grow), `${level}/${days}`);
      dayMinutes(general, 'hypertrophy', false).forEach((day) => assert.ok(day.minutes <= 47, `${level}/${days} ${day.minutes}분`));
    }
  });
  it('그렇다고 쉬운 말로 알린다', () => {
    assert.match(onboard(['general'], 'intermediate', 3).program.caution ?? '', /40분 안팎/);
    assert.match(planGoals(['general']).notes.join(' '), /40분 안팎/);
  });
});
