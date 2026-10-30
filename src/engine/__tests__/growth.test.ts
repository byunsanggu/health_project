import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { COMMON_EQUIPMENT_IDS } from '../equipment.ts';
import { EXERCISES } from '../exercises.ts';
import { growthCheck } from '../growth.ts';
import { landmarksFor } from '../muscles.ts';
import { runOnboarding } from '../onboarding.ts';
import { templateWeekLogs } from '../weekSets.ts';

const index = new Map(EXERCISES.map((exercise) => [exercise.id, exercise]));

function check(level: 'beginner' | 'intermediate', days: number, deload = false) {
  const result = runOnboarding({
    selfReportedLevel: level, monthsTraining: level === 'beginner' ? 3 : 18, bodyweightKg: 78, sex: 'male',
    daysPerWeek: days, goals: ['hypertrophy'], gym: { equipmentIds: COMMON_EQUIPMENT_IDS },
  });
  return growthCheck({ planned: templateWeekLogs(result.program.templates), done: [], landmarks: landmarksFor(level), index, deload });
}

describe('근성장 체크', () => {
  it('초보 주 4회 — 판정하는 부위가 모두 기준을 넘는다', () => {
    const result = check('beginner', 4);
    assert.ok(result.total >= 8);
    assert.equal(result.enough, result.total, JSON.stringify(result.lines.filter((line) => line.verdict === 'short')));
    assert.equal(result.note, null);
    assert.match(result.headline, /모두 근성장 기준을 넘습니다/);
  });

  it('저절로 채워지는 부위(앞어깨 · 전완 · 복근)는 판정하지 않는다', () => {
    const muscles = check('beginner', 4).lines.map((line) => line.muscle);
    for (const quiet of ['frontDelt', 'forearms', 'abs']) assert.ok(!muscles.includes(quiet as never));
  });

  it('모자란 부위는 이름을 대고 어떻게 채우는지 말한다', () => {
    const result = growthCheck({ planned: [], done: [], landmarks: landmarksFor('intermediate'), index });
    assert.equal(result.enough, 0);
    assert.match(result.note ?? '', /최소선 아래입니다. 주마다 세트를 늘려 채웁니다/);
  });

  it('덜어내는 주는 모자라다고 하지 않는다', () => {
    const result = check('intermediate', 3, true);
    assert.match(result.headline, /덜어내는 주/);
  });

  it('한 것은 따로 센다', () => {
    const planned = templateWeekLogs([{ name: 'A', slots: [{ exerciseId: 'barbell-bench-press', sets: 4, repRange: { min: 8, max: 10 } }] } as never]);
    const result = growthCheck({ planned, done: planned, landmarks: landmarksFor('intermediate'), index });
    const chest = result.lines.find((line) => line.muscle === 'chest')!;
    assert.ok(chest.done > 0 && chest.done === chest.planned);
  });
});
