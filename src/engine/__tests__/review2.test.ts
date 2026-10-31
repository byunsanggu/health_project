import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import * as E from '../index.ts';

const ALL = E.COMMON_EQUIPMENT_IDS;
const onboard = (extra: Record<string, unknown>) => E.runOnboarding({
  selfReportedLevel: 'intermediate', monthsTraining: 18, bodyweightKg: 80, sex: 'male', daysPerWeek: 4,
  goals: ['hypertrophy'], gym: { equipmentIds: ALL }, ...extra,
} as never);

describe('전문가 검토 2번', () => {
  it('둔근을 약점으로 고르면 1주차부터 "한계 넘음"이 되지 않는다', () => {
    const result = onboard({ sex: 'female', bodyweightKg: 60, priorities: ['glutes'] });
    const index = E.buildExerciseIndex();
    const volume = E.aggregateVolume(E.templateWeekLogs(result.program.templates), index);
    assert.ok(volume.glutes.effectiveSets <= E.landmarksFor(result.level.level).glutes.mrv, String(volume.glutes.effectiveSets));
  });

  it('근력만 고르면 바벨 벤치를 주 2회 — 무거운 날 · 가벼운 날', () => {
    const result = onboard({ goals: ['strength'], monthsTraining: 20, bodyweightKg: 82 });
    const bench = result.program.templates.flatMap((template) => template.slots.filter((slot) => slot.exerciseId === 'barbell-bench-press'));
    assert.ok(bench.length >= 2, bench.length + '번');
    assert.ok(bench.some((slot) => slot.repRange.max <= 6) && bench.some((slot) => slot.repRange.max > 6));
  });

  it('데드리프트 날에는 바벨 · 스미스 스쿼트를 보조로 붙이지 않는다', () => {
    for (const goals of [['hypertrophy'], ['strength']]) {
      const result = onboard({ goals });
      for (const template of result.program.templates) {
        if (!template.slots.some((slot) => E.HEAVY_PULLS.has(slot.exerciseId))) continue;
        for (const slot of template.slots) {
          const exercise = E.exerciseById(slot.exerciseId)!;
          assert.ok(!(slot.role !== 'primary' && exercise.pattern === 'squat' && (exercise.equipment === 'barbell' || exercise.equipment === 'smith')), exercise.name);
        }
      }
    }
  });

  it('무게를 못 싣는 맨몸 종목은 "0kg 올립니다"가 아니라 더 어렵게 하는 법을 말한다', () => {
    const pushUp = E.exerciseById('push-up')!;
    const sets = [0, 1, 2].map(() => ({ exerciseId: 'push-up', weightKg: 0, reps: 20, rir: 3 }));
    const result = E.prescribeLoad(pushUp, sets, { repRange: { min: 12, max: 20 }, targetRir: 2 });
    assert.notEqual(result.change, 'increase');
    assert.ok(!/0kg 올립니다/.test(result.reason), result.reason);
    assert.match(result.reason, /더 어렵게/);
  });

  it('초보의 목표 여유는 한 칸 더 — 4 · 3 · 3 · 2 · 2', () => {
    assert.deepEqual([1, 2, 3, 4, 5].map((week) => E.targetRirFor('hypertrophy', week, 'beginner')), [4, 3, 3, 2, 2]);
    assert.deepEqual([1, 2, 3, 4, 5].map((week) => E.targetRirFor('hypertrophy', week, 'intermediate')), [3, 2, 2, 1, 1]);
  });
});
