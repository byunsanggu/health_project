import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { startTraining, markDeload, type TrainingBlock } from '../blocks.ts';
import { presetEquipment } from '../gymPresets.ts';
import { availableExercises } from '../equipment.ts';
import { EXERCISES, exerciseById } from '../exercises.ts';
import { buildProgram, runOnboarding, type OnboardingAnswers } from '../onboarding.ts';
import { findPlateaus, similarExercise, switchedRepRange, PLATEAU_SESSIONS } from '../plateau.ts';
import { programRoadmap } from '../roadmap.ts';
import { goalRirFloor, type TrainingGoal } from '../goals.ts';
import { planWeekSets, withStyleVolume, SESSION_GROWTH_MAX_GENTLE } from '../weekSets.ts';
import { addDays } from '../volume.ts';
import type { SessionTemplate } from '../session.ts';
import type { SessionLog, TrainingLevel } from '../types.ts';
import type { WeeklyPlan } from '../mesocycle.ts';
import { index } from './helpers.ts';

const MONDAY = '2026-03-02';

/** 종목 하나를 주 2회, 정한 무게 · 횟수로 한 기록. */
function log(exerciseId: string, rows: readonly [number, number][], everyDays = 3.5): SessionLog[] {
  return rows.map(([weightKg, reps], i) => ({
    date: addDays(MONDAY, Math.round(i * everyDays)),
    sets: [1, 2, 3].map(() => ({ exerciseId, weightKg, reps, rir: 2 })),
  }));
}

const DAY: SessionTemplate[] = [{
  name: '상체 A',
  slots: [
    { exerciseId: 'barbell-bench-press', sets: 3, repRange: { min: 6, max: 10 }, role: 'primary' },
    { exerciseId: 'lateral-raise', sets: 3, repRange: { min: 10, max: 15 }, role: 'isolation' },
    { exerciseId: 'push-up', sets: 2, repRange: { min: 12, max: 20 }, role: 'accessory' },
  ],
}];

const gymPool = availableExercises(presetEquipment('franchise'), EXERCISES);
const todayAfter = (history: readonly SessionLog[]) => addDays(history[history.length - 1]!.date, 2);

describe('멈춘 종목 — 찾기', () => {
  it('횟수나 무게가 늘고 있으면 멈춘 것이 아니다', () => {
    const history = log('barbell-bench-press', [[60, 6], [60, 7], [60, 8], [60, 9], [60, 10], [62.5, 7], [62.5, 8]]);
    assert.deepEqual(findPlateaus({ history, templates: DAY, index, today: todayAfter(history) }), []);
  });

  it('무게를 올린 뒤 횟수가 잠깐 줄어드는 것은 이중 진행의 정상이다', () => {
    const history = log('barbell-bench-press', [[60, 10], [62.5, 7], [62.5, 7], [62.5, 8], [62.5, 9], [62.5, 10]], 5);
    assert.deepEqual(findPlateaus({ history, templates: DAY, index, today: todayAfter(history) }), []);
  });

  it('같은 무게 · 같은 횟수가 2주 넘게 이어지면 찾는다 — 메인은 10% 내려 다시 쌓기', () => {
    const history = log('barbell-bench-press', [[60, 7], [60, 8], [60, 8], [60, 8], [60, 7], [60, 8]]);
    const [found, ...rest] = findPlateaus({ history, templates: DAY, index, today: todayAfter(history) });
    assert.equal(rest.length, 0);
    assert.equal(found!.exerciseId, 'barbell-bench-press');
    assert.equal(found!.role, 'primary');
    assert.equal(found!.weightKg, 60);
    assert.equal(found!.reps, 8);
    assert.ok(found!.sessions >= PLATEAU_SESSIONS);
    assert.match(found!.headline, /벤치프레스 — \d주째 60kg × 8회에서 늘지 않았습니다\./);
    assert.equal(found!.fix.kind, 'reset');
    assert.equal(found!.fix.factor, 0.9);
    assert.match(found!.fix.text, /52.5kg/);
    assert.match(found!.fix.text, /니다\.$/);
  });

  it('한 주 안에서 몇 번 같은 것은 아직 멈춘 것이 아니다(2주 넘게)', () => {
    const history = log('barbell-bench-press', [[60, 7], [60, 8], [60, 8], [60, 8], [60, 8]], 2);
    assert.deepEqual(findPlateaus({ history, templates: DAY, index, today: todayAfter(history) }), []);
  });

  it('가볍게 한 날(가볍게 하는 주 · 아픈 날)은 세지 않는다', () => {
    const history = log('barbell-bench-press', [[60, 7], [60, 8], [54, 8], [54, 8], [60, 9], [60, 9]]);
    assert.deepEqual(findPlateaus({ history, templates: DAY, index, today: todayAfter(history) }), []);
  });

  it('오래 쉬었으면 묻지 않는다 · 맨몸 종목은 보지 않는다', () => {
    const history = log('barbell-bench-press', [[60, 8], [60, 8], [60, 8], [60, 8], [60, 8]]);
    assert.deepEqual(findPlateaus({ history, templates: DAY, index, today: addDays(todayAfter(history), 30) }), []);
    const pushups = log('push-up', [[0, 12], [0, 12], [0, 12], [0, 12], [0, 12]]);
    assert.deepEqual(findPlateaus({ history: pushups, templates: DAY, index, today: todayAfter(pushups) }), []);
  });

  it('처방하거나 "그대로 두기"를 누른 날부터 다시 센다', () => {
    const history = log('barbell-bench-press', [[60, 8], [60, 8], [60, 8], [60, 8], [60, 8]]);
    const today = todayAfter(history);
    assert.equal(findPlateaus({ history, templates: DAY, index, today }).length, 1);
    const fixes = { 'barbell-bench-press': { kind: 'keep' as const, date: addDays(today, -3) } };
    assert.deepEqual(findPlateaus({ history, templates: DAY, index, today, fixes }), []);
  });
});

describe('멈춘 종목 — 처방이 차례로 바뀐다', () => {
  const stalled = log('barbell-bench-press', [[60, 8], [60, 8], [60, 8], [60, 8], [60, 8]]);
  const today = todayAfter(stalled);
  const before = addDays(MONDAY, -10);

  it('메인 — 내려 다시 쌓기를 한 번 했는데 또 멈추면 반복 범위를 바꾼다', () => {
    const fixes = { 'barbell-bench-press': { kind: 'reset' as const, date: before } };
    const [found] = findPlateaus({ history: stalled, templates: DAY, index, today, fixes });
    assert.equal(found!.fix.kind, 'reps');
    assert.deepEqual(found!.fix.repRange, { min: 8, max: 12 });
    assert.match(found!.fix.text, /6~10회에서 8~12회로/);
    assert.equal(found!.fix.action, '8~12회로 바꾸기');
  });

  it('메인은 바꾸지 않는다 — 다른 종목이 있어도', () => {
    const [found] = findPlateaus({ history: stalled, templates: DAY, index, today, available: gymPool });
    assert.notEqual(found!.fix.kind, 'swap');
  });

  it('작은 운동은 비슷한 종목으로 바꾸기부터 — 프로그램에 없는 것, 무게를 싣는 것', () => {
    const history = log('lateral-raise', [[6, 12], [6, 12], [6, 12], [6, 12], [6, 12]]);
    const [found] = findPlateaus({ history, templates: DAY, index, today: todayAfter(history), available: gymPool });
    assert.equal(found!.fix.kind, 'swap');
    const to = exerciseById(found!.fix.swapTo!)!;
    assert.equal(to.pattern, 'isolation');
    assert.ok((to.contribution.sideDelt ?? 0) >= 0.85);
    assert.ok(to.equipment !== 'bodyweight' && to.equipment !== 'band');
    assert.ok(!DAY[0]!.slots.some((slot) => slot.exerciseId === to.id));
    assert.match(found!.fix.action, /바꾸기$/);
  });

  it('바꿨는데 또 멈추면 범위, 그다음은 내려 다시 쌓기', () => {
    const history = log('lateral-raise', [[6, 12], [6, 12], [6, 12], [6, 12], [6, 12]]);
    const at = todayAfter(history);
    const swap = findPlateaus({ history, templates: DAY, index, today: at, available: gymPool, fixes: { 'lateral-raise': { kind: 'swap', date: before } } });
    assert.equal(swap[0]!.fix.kind, 'reps');
    assert.deepEqual(swap[0]!.fix.repRange, { min: 12, max: 15 });
    const reps = findPlateaus({ history, templates: DAY, index, today: at, available: gymPool, fixes: { 'lateral-raise': { kind: 'reps', date: before } } });
    assert.equal(reps[0]!.fix.kind, 'reset');
  });

  it('내 루틴의 종목은 바꾸지 않는다 — 루틴은 사용자 것이다', () => {
    const history = log('lateral-raise', [[6, 12], [6, 12], [6, 12], [6, 12], [6, 12]]);
    const fixed = DAY.map((template) => ({ ...template, fixed: true }));
    const [found] = findPlateaus({ history, templates: fixed, index, today: todayAfter(history), available: gymPool });
    assert.notEqual(found!.fix.kind, 'swap');
  });

  it('반복 범위 바꾸기 — 무거운 칸은 조금 가볍게, 많이 하는 칸은 조금 무겁게', () => {
    assert.deepEqual(switchedRepRange({ min: 4, max: 6 }, false), { min: 6, max: 8 });
    assert.deepEqual(switchedRepRange({ min: 6, max: 10 }, false), { min: 8, max: 12 });
    assert.deepEqual(switchedRepRange({ min: 8, max: 12 }, false), { min: 6, max: 10 });
    assert.deepEqual(switchedRepRange({ min: 12, max: 20 }, true), { min: 8, max: 12 });
  });

  it('비슷한 종목 — 무게를 싣던 것을 맨몸으로 주지 않고, 초보에게 바벨 기술 종목을 주지 않는다', () => {
    const press = exerciseById('machine-shoulder-press')!;
    const other = similarExercise(press, gymPool, new Set(), 'intermediate');
    assert.ok(other && other.pattern === 'verticalPush' && other.equipment !== 'bodyweight');
    const forBeginner = similarExercise(press, gymPool, new Set(), 'beginner');
    assert.ok(!forBeginner || forBeginner.id !== 'barbell-overhead-press');
  });
});

function block(level: TrainingLevel, number = 1, startedOn = MONDAY): TrainingBlock {
  return { ...startTraining({ today: startedOn, level, monthsTraining: level === 'beginner' ? 0 : 12 }), number };
}

describe('내 프로그램 — 지금 어디쯤인지', () => {
  const templates = DAY;

  it('초보 첫 과정 첫 주 — 6주 쌓고 한 주 가볍게, 자세를 익히는 주', () => {
    const map = programRoadmap({ block: block('beginner'), today: MONDAY, goals: ['hypertrophy'], style: 'hypertrophy', templates, history: [] });
    assert.equal(map.title, '첫 과정 · 근육 키우기');
    assert.equal(map.totalWeeks, 7);
    assert.equal(map.week, 1);
    assert.deepEqual(map.weeks.map((week) => week.label), ['시작', '쌓기', '쌓기', '쌓기', '쌓기', '기록 확인', '가볍게']);
    assert.ok(map.weeks[0]!.current && !map.weeks[0]!.done);
    assert.match(map.now, /^1주차 — 자세를 익히는 주/);
    assert.match(map.purpose, /자세/);
    assert.match(map.next, /6주를 마치면 한 주 가볍게 하고 2번째 과정/);
    assert.match(map.next, /백 스쿼트를 새로 배웁니다/);
  });

  it('중급 둘째 과정 마지막 쌓는 주 — 기록 확인 주, 늘어난 메인 종목', () => {
    const b = block('intermediate', 2);
    const history = log('barbell-bench-press', [[60, 8], [60, 9], [62.5, 8], [62.5, 9]], 7);
    const today = addDays(MONDAY, 4 * 7 + 1);
    const map = programRoadmap({ block: b, today, goals: ['hypertrophy'], style: 'hypertrophy', templates, history });
    assert.equal(map.title, '2번째 과정 · 근육 키우기');
    assert.equal(map.week, 5);
    assert.equal(map.totalWeeks, 6);
    assert.equal(map.weeks[4]!.kind, 'check');
    assert.equal(map.weeks.filter((week) => week.done).length, 4);
    assert.match(map.now, /^5주차 — 이번 과정에서 가장 힘든 주/);
    assert.deepEqual(map.gains, ['바벨 벤치프레스 60kg × 8회 → 62.5kg × 9회']);
    assert.match(map.next, /메인 종목은 그대로/);
  });

  it('가볍게 하는 주 — 마지막 칸, 다음 주부터 새 과정', () => {
    const map = programRoadmap({ block: block('intermediate'), today: addDays(MONDAY, 5 * 7), goals: ['hypertrophy'], style: 'hypertrophy', templates, history: [] });
    assert.equal(map.week, 6);
    assert.equal(map.weeks[5]!.kind, 'deload');
    assert.match(map.now, /^가볍게 하는 주/);
    assert.match(map.next, /^다음 주부터 2번째 과정/);
  });

  it('피로 때문에 일찍 가볍게 하는 주에 들어가면 그 주가 마지막 칸이다', () => {
    const today = addDays(MONDAY, 2 * 7);
    const map = programRoadmap({ block: markDeload(block('intermediate'), today), today, goals: ['hypertrophy'], style: 'hypertrophy', templates, history: [] });
    assert.equal(map.totalWeeks, 3);
    assert.equal(map.weeks[2]!.kind, 'deload');
    assert.ok(map.weeks[2]!.current);
  });

  it('목표 · 과정 방식마다 하는 일을 쉬운 말로', () => {
    const at = (goals: TrainingGoal[], style: 'hypertrophy' | 'strength' = 'hypertrophy', custom = false) =>
      programRoadmap({ block: block('intermediate'), today: MONDAY, goals, style, templates, history: [], custom });
    assert.equal(at(['fatLoss']).title, '첫 과정 · 다이어트');
    assert.match(at(['fatLoss']).purpose, /무게를 낮추지 않고/);
    assert.equal(at(['strength'], 'strength').title, '첫 과정 · 근력');
    assert.equal(at(['general']).title, '첫 과정 · 건강 유지');
    assert.equal(at(['conditioning']).title, '첫 과정 · 체력 기르기');
    assert.match(at(['hypertrophy'], 'hypertrophy', true).next, /종목이 그대로/);
    for (const map of [at(['fatLoss']), at(['strength'], 'strength'), at(['general'])]) {
      for (const line of [map.purpose, map.now, map.next]) {
        assert.match(line, /니다\.$/, line);
        assert.ok(!/블록|디로드|볼륨|메조|RIR/.test(line), line);
      }
    }
  });
});

/* ── 프로그램을 짜는 규칙 ─────────────────────────────── */

const GOALS: TrainingGoal[][] = [['hypertrophy'], ['strength'], ['fatLoss'], ['strength', 'fatLoss'], ['general'], ['conditioning']];
const GYMS: Record<string, string[]> = {
  gym: presetEquipment('franchise'),
  home: ['floor', 'dumbbells', 'bench-incline'],
  bw: ['floor'],
};
function answers(goals: TrainingGoal[], level: TrainingLevel, days: number, gym: string): OnboardingAnswers {
  return {
    selfReportedLevel: level, monthsTraining: level === 'beginner' ? 0 : level === 'intermediate' ? 12 : 36,
    bodyweightKg: 70, sex: 'female', daysPerWeek: days, goals, gym: { equipmentIds: GYMS[gym]! },
  };
}

describe('큰 운동이 먼저', () => {
  it('어느 목표 · 단계 · 일수 · 기구든 한 근육 운동이 큰 운동보다 앞에 오지 않는다', () => {
    for (const goals of GOALS) for (const level of ['beginner', 'intermediate'] as TrainingLevel[]) for (const days of [2, 3, 4, 5]) {
      for (const gym of Object.keys(GYMS)) {
        const { program } = runOnboarding(answers(goals, level, days, gym));
        for (const template of program.templates) {
          const patterns = template.slots.map((slot) => exerciseById(slot.exerciseId)!.pattern);
          const firstSmall = patterns.findIndex((pattern) => pattern === 'isolation' || pattern === 'core');
          const lastBig = patterns.map((pattern) => pattern !== 'isolation' && pattern !== 'core').lastIndexOf(true);
          assert.ok(firstSmall < 0 || lastBig < firstSmall,
            `${goals.join('+')} ${level} ${days} ${gym} ${template.name}: ${template.slots.map((slot) => slot.exerciseId).join(', ')}`);
        }
      }
    }
  });

  it('약점으로 고른 작은 운동은 일부러 앞에 둔 그대로다', () => {
    const program = buildProgram({ ...answers(['hypertrophy'], 'intermediate', 4, 'gym'), priorities: ['sideDelt'] }, 'intermediate');
    const upper = program.templates[0]!;
    const side = upper.slots.findIndex((slot) => (exerciseById(slot.exerciseId)!.contribution.sideDelt ?? 0) >= 0.85);
    const lastBig = upper.slots.map((slot) => exerciseById(slot.exerciseId)!.pattern !== 'isolation').lastIndexOf(true);
    assert.ok(side >= 0 && side < lastBig, upper.slots.map((slot) => slot.exerciseId).join(', '));
  });
});

describe('과정이 바뀔 때 — 메인은 그대로, 보조는 비슷한 것으로', () => {
  it('메인 종목은 같은 날 같은 자리에 그대로 남는다', () => {
    for (const gym of ['gym', 'home']) for (const days of [2, 3, 4, 5]) {
      const a = answers(['hypertrophy'], 'intermediate', days, gym);
      const first = buildProgram(a, 'intermediate');
      const second = buildProgram(a, 'intermediate', { previous: first });
      const third = buildProgram(a, 'intermediate', { previous: second });
      for (const [before, after] of [[first, second], [second, third]] as const) {
        before.templates.forEach((template, d) => {
          const mains = template.slots.filter((slot) => slot.role === 'primary').map((slot) => slot.exerciseId).sort();
          const now = after.templates[d]!.slots.filter((slot) => slot.role === 'primary').map((slot) => slot.exerciseId).sort();
          assert.deepEqual(now, mains, `${gym} ${days} ${template.name}`);
        });
      }
    }
  });

  it('보조는 바뀌되 더 약한 종목으로는 바뀌지 않는다', () => {
    let changed = 0;
    for (const gym of ['gym', 'home']) for (const days of [3, 4]) {
      const a = answers(['hypertrophy'], 'intermediate', days, gym);
      const first = buildProgram(a, 'intermediate');
      const second = buildProgram(a, 'intermediate', { previous: first });
      const before = new Set(first.templates.flatMap((template) => template.slots.map((slot) => slot.exerciseId)));
      for (const template of second.templates) {
        for (const slot of template.slots) {
          if (slot.role === 'primary' || before.has(slot.exerciseId)) continue;
          changed += 1;
          const exercise = exerciseById(slot.exerciseId)!;
          // 무게를 싣던 집 · 헬스장 보조 자리에 맨몸 · 더 쉬운 판(파이크 · 인클라인 푸시업)이 새로 들어오지 않는다
          assert.ok(!['pike-push-up', 'incline-push-up', 'back-extension'].includes(exercise.id), `${gym} ${days}: ${exercise.id}`);
        }
      }
    }
    assert.ok(changed >= 8, `바뀐 보조가 너무 적습니다: ${changed}`);
  });
});

describe('근력 과정 — 세트는 천천히 늘린다', () => {
  it('세트를 줄이는 과정은 하루가 과정 안에서 3세트까지만 는다', () => {
    const { program } = runOnboarding(answers(['strength'], 'intermediate', 2, 'gym'));
    const strength = withStyleVolume(program.templates, 'strength');
    assert.ok(strength.every((template) => template.growthCap === SESSION_GROWTH_MAX_GENTLE));
    assert.ok(withStyleVolume(program.templates, 'hypertrophy').every((template) => template.growthCap === undefined));
    const plan = {
      weekStart: '', phase: 'accumulation', weekInBlock: 5, targetRir: 1, intensityMultiplier: 1,
      fatigue: { score: 0, threshold: 5, deloadRecommended: false, signals: [] }, neglected: [], frequency: [], summary: '',
      volume: (['chest', 'back', 'quads', 'hamstrings', 'glutes', 'sideDelt', 'biceps', 'triceps'] as const).map((muscle) => ({
        muscle, label: muscle, currentSets: 4, prescribedSets: 30, deltaSets: 26, zone: 'underMev', zoneLabel: '', action: 'increase', rationale: '',
      })),
    } as unknown as WeeklyPlan;
    const sets = planWeekSets({ templates: strength, plan, index });
    strength.forEach((template, d) => {
      const base = template.slots.reduce((sum, slot) => sum + slot.sets, 0);
      assert.ok(sets[d]!.reduce((sum, value) => sum + value, 0) <= base + SESSION_GROWTH_MAX_GENTLE, template.name);
    });
  });
});

describe('건강 유지 — 끝까지 몰아붙이지 않는다', () => {
  it('건강 유지만 고르면 세트마다 2개는 남긴다 — 다른 목표는 제한이 없다', () => {
    assert.equal(goalRirFloor(['general']), 2);
    assert.equal(goalRirFloor(['hypertrophy']), 0);
    assert.equal(goalRirFloor(['general', 'hypertrophy']), 0);
    assert.equal(goalRirFloor([]), 2);
  });
});
