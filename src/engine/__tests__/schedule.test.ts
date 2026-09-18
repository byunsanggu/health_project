import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { WEEKDAY_LABELS_KO, buildSchedule, type Weekday } from '../schedule.ts';
import { buildProgram, type OnboardingAnswers } from '../onboarding.ts';
import { COMMON_EQUIPMENT_IDS } from '../equipment.ts';
import { index } from './helpers.ts';
import type { SessionTemplate } from '../session.ts';

function answers(overrides: Partial<OnboardingAnswers> = {}): OnboardingAnswers {
  return {
    selfReportedLevel: 'intermediate',
    monthsTraining: 18,
    bodyweightKg: 78,
    daysPerWeek: 4,
    goal: 'hypertrophy',
    gym: { equipmentIds: COMMON_EQUIPMENT_IDS },
    ...overrides,
  };
}

function templatesFor(days: number): SessionTemplate[] {
  return buildProgram(answers({ daysPerWeek: days }), 'intermediate').templates;
}

function gaps(weekdays: readonly Weekday[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < weekdays.length; i += 1) out.push(weekdays[i]! - weekdays[i - 1]!);
  out.push(7 - weekdays[weekdays.length - 1]! + weekdays[0]!);
  return out;
}

describe('buildSchedule', () => {
  it('요청한 횟수만큼 배치하고 나머지를 휴식일로 둔다', () => {
    for (const days of [2, 3, 4, 5]) {
      const schedule = buildSchedule({ templates: templatesFor(days), daysPerWeek: days, index });
      assert.equal(schedule.sessions.length, days);
      assert.equal(schedule.restDays.length, 7 - days);
      assert.equal(
        new Set(schedule.sessions.map((s) => s.weekday)).size,
        days,
        '같은 요일에 두 번 넣지 않는다',
      );
    }
  });

  it('훈련일을 한쪽에 몰지 않고 주에 펴 놓는다', () => {
    const schedule = buildSchedule({ templates: templatesFor(3), daysPerWeek: 3, index });
    assert.ok(Math.min(...gaps(schedule.sessions.map((s) => s.weekday))) >= 2);
  });

  it('요일마다 한국어 이름을 붙인다', () => {
    const schedule = buildSchedule({ templates: templatesFor(3), daysPerWeek: 3, index });
    for (const item of schedule.sessions) {
      assert.equal(item.label, WEEKDAY_LABELS_KO[item.weekday]);
    }
  });

  it('가능한 요일이 정해져 있으면 그 안에서 가장 고르게 편다', () => {
    const available: Weekday[] = [0, 1, 2, 3, 4, 5, 6];
    const schedule = buildSchedule({
      templates: templatesFor(3), daysPerWeek: 3, availableWeekdays: available, index,
    });
    assert.ok(schedule.sessions.every((s) => available.includes(s.weekday)));
    assert.ok(Math.min(...gaps(schedule.sessions.map((s) => s.weekday))) >= 2);
  });

  it('가능한 요일이 부족하면 있는 만큼만 쓴다', () => {
    const schedule = buildSchedule({
      templates: templatesFor(4), daysPerWeek: 4, availableWeekdays: [0, 3], index,
    });
    assert.equal(schedule.sessions.length, 2);
  });

  it('연속 훈련일이 단계 권장을 넘으면 경고한다', () => {
    const schedule = buildSchedule({
      templates: templatesFor(4), daysPerWeek: 4, level: 'beginner',
      availableWeekdays: [0, 1, 2, 5], index,
    });
    assert.ok(schedule.warnings.some((w) => w.includes('연속 훈련')));
  });

  it('고급자에게는 3일 연속까지는 경고하지 않는다', () => {
    const schedule = buildSchedule({
      templates: templatesFor(4), daysPerWeek: 4, level: 'advanced',
      availableWeekdays: [0, 1, 2, 5], index,
    });
    assert.ok(!schedule.warnings.some((w) => w.includes('연속 훈련')));
  });

  it('붙어 있는 날에 같은 부위가 겹치지 않도록 세션 순서를 고른다', () => {
    // 상체 A · 상체 B 가 월·화로 붙지 않아야 한다
    const schedule = buildSchedule({ templates: templatesFor(4), daysPerWeek: 4, index });
    for (let i = 1; i < schedule.sessions.length; i += 1) {
      if (schedule.sessions[i]!.gapDays > 1) continue;
      const previous = schedule.sessions[i - 1]!.templateName;
      const current = schedule.sessions[i]!.templateName;
      const bothUpper = previous.startsWith('상체') && current.startsWith('상체');
      const bothLower = previous.startsWith('하체') && current.startsWith('하체');
      assert.ok(!bothUpper && !bothLower, `${previous} → ${current}`);
    }
  });

  it('부위별 주간 빈도를 세어 준다', () => {
    const schedule = buildSchedule({ templates: templatesFor(4), daysPerWeek: 4, index });
    const chest = schedule.muscleFrequency.find((item) => item.muscle === 'chest');
    assert.ok(chest && chest.sessions >= 2, '가슴이 주 2회 이상');
    assert.ok(schedule.notes.some((note) => note.includes('휴식')));
  });

  it('주 1회도 처리한다', () => {
    const schedule = buildSchedule({ templates: templatesFor(2).slice(0, 1), daysPerWeek: 1, index });
    assert.equal(schedule.sessions.length, 1);
    assert.equal(schedule.restDays.length, 6);
  });
});
