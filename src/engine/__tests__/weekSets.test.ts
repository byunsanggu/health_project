import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { planWeekSets, SESSION_GROWTH_PER_WEEK, SLOT_SWING } from '../weekSets.ts';
import { buildSession, type SessionTemplate } from '../session.ts';
import { planNextWeek, type WeeklyPlan } from '../mesocycle.ts';
import { assessFatigue } from '../readiness.ts';
import { runOnboarding } from '../onboarding.ts';
import { COMMON_EQUIPMENT_IDS } from '../equipment.ts';
import { landmarksFor } from '../muscles.ts';
import { addDays, aggregateVolume } from '../volume.ts';
import { levelProfile } from '../levels.ts';
import type { SessionLog } from '../types.ts';
import { index, session, sets } from './helpers.ts';

/*
 * 처방대로 하는 사람 — 모든 세트를 목표 반복 상한으로, 정확히 목표 RIR로 끝낸다.
 * 생리 모델 없이 엔진의 처방 · 배분만 본다.
 */
const WEEK_OFFSETS: Record<number, number[]> = { 3: [0, 2, 4], 4: [0, 1, 3, 4], 6: [0, 1, 2, 3, 4, 5] };

interface Week { phase: WeeklyPlan['phase']; weekInBlock: number; sets: number[][]; logs: SessionLog[] }

function simulate(level: 'intermediate' | 'advanced', days: 3 | 4 | 6, weeks: number): { weeks: Week[]; templates: SessionTemplate[]; mev: Record<string, number> } {
  const onboarded = runOnboarding({
    selfReportedLevel: level, monthsTraining: level === 'advanced' ? 40 : 18, bodyweightKg: 80, sex: 'male',
    daysPerWeek: days, goals: ['hypertrophy'], gym: { equipmentIds: COMMON_EQUIPMENT_IDS },
  });
  const templates = onboarded.program.templates;
  const landmarks = landmarksFor(onboarded.level.level);
  const profile = levelProfile(onboarded.level.level);
  const history: SessionLog[] = [];
  const out: Week[] = [];
  let weekInBlock = 1;
  let lastPhase: WeeklyPlan['phase'] = 'accumulation';

  for (let w = 0; w < weeks; w += 1) {
    const monday = addDays('2026-01-05', 7 * w);
    let plan: WeeklyPlan;
    if (w === 0) {
      plan = { ...onboarded.firstWeek, weekStart: monday, targetRir: profile.startingRir };
    } else {
      plan = planNextWeek({
        sessions: history, index, landmarks, asOf: addDays(monday, -1), weekInBlock: weekInBlock - 1,
        accumulationWeeks: profile.accumulationWeeks, lastWeekPhase: lastPhase,
        forceDeload: weekInBlock > profile.accumulationWeeks,
      });
      if (plan.phase !== 'deload') plan = { ...plan, weekInBlock };
    }
    const week: Week = { phase: plan.phase, weekInBlock: plan.weekInBlock, sets: [], logs: [] };
    WEEK_OFFSETS[days]!.forEach((offset, day) => {
      const planned = buildSession({
        template: templates[day]!, date: addDays(monday, offset), plan, history, index,
        week: { templates, day }, landmarks,
      });
      week.sets.push(planned.exercises.map((item) => item.sets.length));
      const log: SessionLog = {
        date: planned.date,
        sets: planned.exercises.flatMap((item) => item.sets.map((set) => ({
          exerciseId: item.exercise.id, weightKg: set.weightKg ?? 20, reps: set.targetReps.max, rir: set.targetRir,
        }))),
      };
      history.push(log);
      week.logs.push(log);
    });
    out.push(week);
    if (plan.phase === 'deload') { lastPhase = 'deload'; weekInBlock = 1; } else { lastPhase = 'accumulation'; weekInBlock += 1; }
  }
  const mev = Object.fromEntries(Object.entries(landmarks).map(([muscle, mark]) => [muscle, mark.mev]));
  return { weeks: out, templates, mev };
}

const total = (week: Week) => week.sets.flat().reduce((sum, value) => sum + value, 0);
const templateSets = (templates: readonly SessionTemplate[]) => templates.map((template) => template.slots.map((slot) => slot.sets));

describe('주간 세트 — 처방대로 하는 사람', () => {
  for (const [level, days] of [['intermediate', 4], ['advanced', 6], ['intermediate', 3]] as const) {
    describe(`${level} 주 ${days}회`, () => {
      const { weeks, templates, mev } = simulate(level, days, 12);
      const base = templateSets(templates);

      it('블록 안에서 주간 합계가 줄지 않고 쌓인다(3 · 4 · 3 · 4로 흔들리지 않는다)', () => {
        for (let w = 1; w < weeks.length; w += 1) {
          if (weeks[w]!.phase === 'deload' || weeks[w]!.weekInBlock === 1) continue;
          assert.ok(total(weeks[w]!) >= total(weeks[w - 1]!), `${w + 1}주: ${total(weeks[w - 1]!)} → ${total(weeks[w]!)}`);
        }
        assert.ok(total(weeks[2]!) > total(weeks[0]!), '3주차에는 1주차보다 많아야 한다');
      });

      it('종목마다 세트도 블록 안에서 줄지 않는다', () => {
        for (let w = 1; w < weeks.length; w += 1) {
          if (weeks[w]!.phase === 'deload' || weeks[w]!.weekInBlock === 1) continue;
          weeks[w]!.sets.forEach((day, d) => day.forEach((count, i) => {
            assert.ok(count >= weeks[w - 1]!.sets[d]![i]!, `${w + 1}주 ${templates[d]!.name} ${templates[d]!.slots[i]!.exerciseId}: ${weeks[w - 1]!.sets[d]![i]} → ${count}`);
          }));
        }
      });

      it('하루는 블록 주차마다 2세트까지만 길어지고, 종목은 템플릿 +2까지', () => {
        for (const week of weeks) {
          if (week.phase === 'deload') continue;
          week.sets.forEach((day, d) => {
            const grown = day.reduce((a, b) => a + b, 0) - base[d]!.reduce((a, b) => a + b, 0);
            assert.ok(grown <= SESSION_GROWTH_PER_WEEK * (week.weekInBlock - 1), `${week.weekInBlock}주차 ${templates[d]!.name} +${grown}`);
            day.forEach((count, i) => assert.ok(count <= base[d]![i]! + SLOT_SWING));
          });
        }
      });

      it('덜어내는 주는 템플릿의 절반이고, 그다음 주는 다시 1주차(템플릿)다', () => {
        const deload = weeks.findIndex((week) => week.phase === 'deload');
        assert.ok(deload > 0, '12주 안에 덜어내는 주가 있어야 한다');
        assert.deepEqual(weeks[deload]!.sets, base.map((day) => day.map((count) => Math.ceil(count / 2))));
        assert.deepEqual(weeks[deload + 1]!.sets, base, '디로드 다음 주가 블록에서 제일 무거운 주가 되면 안 된다');
      });

      it('처방대로 했는데 피로 신호로 디로드가 앞당겨지지 않는다', () => {
        // 블록 일정(축적 주 다 채움)으로만 덜어낸다
        const deloads = weeks.map((week, w) => (week.phase === 'deload' ? w : -1)).filter((w) => w >= 0);
        const accumulation = levelProfile(level).accumulationWeeks;
        assert.equal(deloads[0], accumulation, `첫 디로드 ${deloads[0]! + 1}주`);
        if (deloads[1] !== undefined) assert.equal(deloads[1] - deloads[0]!, accumulation + 1);
      });

      it('최소 바로 밑 부위도 늘어서 셋째 주에는 최소에 닿는다(전에는 9 / 최소 10에서 영영 멈췄다)', () => {
        const first = aggregateVolume(weeks[0]!.logs, index);
        const second = aggregateVolume(weeks[1]!.logs, index);
        const third = aggregateVolume(weeks[2]!.logs, index);
        for (const muscle of ['chest', 'back', 'quads', 'sideDelt'] as const) {
          if (first[muscle].effectiveSets >= mev[muscle]! || first[muscle].effectiveSets < mev[muscle]! - 2) continue;
          assert.ok(second[muscle].effectiveSets > first[muscle].effectiveSets, `${muscle} 둘째 주에 안 늘었다`);
          assert.ok(third[muscle].effectiveSets >= mev[muscle]! - 0.5, `${muscle} ${first[muscle].effectiveSets} → ${second[muscle].effectiveSets} → ${third[muscle].effectiveSets} (최소 ${mev[muscle]})`);
        }
      });
    });
  }
});

describe('주간 세트 — 경계', () => {
  const template: SessionTemplate = {
    name: '상체',
    slots: [
      { exerciseId: 'barbell-bench-press', sets: 3, repRange: { min: 6, max: 10 } },
      { exerciseId: 'lat-pulldown', sets: 3, repRange: { min: 8, max: 12 } },
      { exerciseId: 'lateral-raise', sets: 3, repRange: { min: 10, max: 15 } },
    ],
  };
  const planFor = (overrides: Partial<WeeklyPlan>): WeeklyPlan => ({
    weekStart: '2026-09-21', phase: 'accumulation', weekInBlock: 3, targetRir: 2, intensityMultiplier: 1,
    fatigue: { score: 0, threshold: 5, deloadRecommended: false, signals: [] },
    volume: [], neglected: [], frequency: [], summary: '', ...overrides,
  });

  it('여유를 많이 남긴 종목이 있어도 덜어내는 주에 세트가 늘지 않는다', () => {
    const history = [session('2026-09-15', sets('lateral-raise', 3, { weightKg: 6, reps: 15, rir: 5 }))];
    const plan = planNextWeek({ sessions: history, index, landmarks: landmarksFor('intermediate'), asOf: '2026-09-20', weekInBlock: 4, forceDeload: true });
    const planned = buildSession({ template, date: '2026-09-21', plan, history, index });
    assert.equal(plan.phase, 'deload');
    for (const item of planned.exercises) assert.ok(item.sets.length <= 2, `${item.exercise.id} ${item.sets.length}세트`);
  });

  it('한계를 넘긴 부위는 그 부위를 가장 많이 쓰는 종목에서 덜어낸다', () => {
    const plan = planFor({
      volume: [{ muscle: 'sideDelt', label: '', currentSets: 30, prescribedSets: 1, deltaSets: -29, zone: 'overMrv', zoneLabel: '', action: 'reduce', rationale: '' }],
    });
    const [day] = planWeekSets({ templates: [template], plan, index });
    assert.deepEqual(day, [3, 3, 1], '레터럴 레이즈만 템플릿 −2까지');
  });

  it('지난주에 하루 빠졌다고 이번 주 세트를 템플릿 밑으로 깎지 않는다', () => {
    const plan = planFor({
      volume: [{ muscle: 'chest', label: '', currentSets: 1, prescribedSets: 1, deltaSets: 0, zone: 'underMev', zoneLabel: '', action: 'hold', rationale: '' }],
    });
    const [day] = planWeekSets({ templates: [template], plan, index });
    assert.deepEqual(day, [3, 3, 3]);
  });

  it('뺀 종목 자리의 대체는 원래 자리 몫을 받고, 오늘만 끼운 종목은 고른 세트 그대로', () => {
    const plan = planFor({
      volume: [{ muscle: 'chest', label: '', currentSets: 3, prescribedSets: 5, deltaSets: 2, zone: 'underMev', zoneLabel: '', action: 'increase', rationale: '' }],
    });
    const week = { templates: [template], day: 0 };
    const today: SessionTemplate = {
      name: '상체',
      slots: [
        { exerciseId: 'machine-chest-press', sets: 3, repRange: { min: 6, max: 10 }, replacedFrom: 'barbell-bench-press' },
        { exerciseId: 'lat-pulldown', sets: 3, repRange: { min: 8, max: 12 } },
        { exerciseId: 'lateral-raise', sets: 3, repRange: { min: 10, max: 15 } },
        { exerciseId: 'barbell-curl', sets: 4, repRange: { min: 10, max: 15 } },
      ],
    };
    const planned = buildSession({ template: today, date: '2026-09-21', plan, history: [], index, week });
    const [bench] = planWeekSets({ templates: [template], plan, index });
    assert.equal(planned.exercises[0]!.sets.length, bench![0]);
    assert.ok(planned.exercises[0]!.sets.length > 3, '가슴 처방이 대체 종목에 그대로 간다');
    assert.equal(planned.exercises[3]!.sets.length, 4);
  });
});

describe('피로 신호 — 계획대로 줄인 여유는 피로가 아니다', () => {
  const landmarks = landmarksFor('intermediate');
  const week = (date: string, rir: number) => session(date, sets('barbell-bench-press', 4, { weightKg: 80, reps: 8, rir }));

  it('여유를 계획대로 3 → 2로 줄였으면 신호가 없다', () => {
    const fatigue = assessFatigue({
      sessions: [week('2026-09-08', 3), week('2026-09-15', 2)], index, landmarks, asOf: '2026-09-20', weekInBlock: 3,
      plannedRir: { thisWeek: 2, lastWeek: 3 },
    });
    assert.ok(!fatigue.signals.some((signal) => signal.id === 'rirDrift'));
  });

  it('계획보다 한 개 넘게 더 줄었으면 신호다', () => {
    const fatigue = assessFatigue({
      sessions: [week('2026-09-08', 3), week('2026-09-15', 1)], index, landmarks, asOf: '2026-09-20', weekInBlock: 3,
      plannedRir: { thisWeek: 2, lastWeek: 3 },
    });
    const drift = fatigue.signals.find((signal) => signal.id === 'rirDrift');
    assert.ok(drift);
    assert.match(drift.label, /계획\(1개 줄이기\)보다 더 줄었습니다/);
  });

  it('처방은 기본 일정(3 → 2 → 1)을 알고 있다 — 따로 안 줘도 계획대로면 조용하다', () => {
    const plan = planNextWeek({
      sessions: [week('2026-09-08', 3), week('2026-09-15', 2)], index, landmarks, asOf: '2026-09-20', weekInBlock: 2,
    });
    assert.ok(!plan.fatigue.signals.some((signal) => signal.id === 'rirDrift'));
  });
});
