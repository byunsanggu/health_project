import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { exerciseById, isAssisted, liftedKg } from '../exercises.ts';
import { adjustWithinSession, easierLoad, prescribeLoad, topWorkingSet } from '../load.ts';
import { buildSession, type SessionTemplate } from '../session.ts';
import { suggestStartingLoad } from '../strength.ts';
import { DEFAULT_GYM, loadingFor } from '../gym.ts';
import { bestImprovement, compareToPast, describeComparison } from '../comparison.ts';
import { liftDetail, nextChallenge } from '../preview.ts';
import { liftProgress, personalRecords } from '../progress.ts';
import { bestE1rmByExercise } from '../readiness.ts';
import { findPlateaus } from '../plateau.ts';
import { lastTimeFor } from '../coach.ts';
import { buildWeeklyReport } from '../weeklyReport.ts';
import { landmarksFor } from '../muscles.ts';
import { addDays } from '../volume.ts';
import type { WeeklyPlan } from '../mesocycle.ts';
import type { SessionLog, SetLog } from '../types.ts';
import { index } from './helpers.ts';

/*
 * 어시스트 풀업 — 스택 숫자는 기계가 들어 주는 몫(도움)이라 클수록 쉽다. 보통 기계처럼 무게를 올리면
 * 시간이 갈수록 도움이 커져 운동이 쉬워졌다. 잘되면 도움을 줄이고, 비교 · 기록에서도 도움이 줄면 는 것이다.
 */
const ASSIST = exerciseById('assisted-pull-up')!;
const RULE = { repRange: { min: 6, max: 10 }, targetRir: 2 };
const set = (weightKg: number, reps: number, rir = 2): SetLog => ({ exerciseId: ASSIST.id, weightKg, reps, rir });
const MONDAY = '2026-03-02';

function plan(over: Partial<WeeklyPlan> = {}): WeeklyPlan {
  return {
    weekStart: MONDAY, phase: 'accumulation', weekInBlock: 2, targetRir: 2, intensityMultiplier: 1,
    fatigue: { score: 0, threshold: 5, deloadRecommended: false, signals: [] },
    volume: [], neglected: [], frequency: [], summary: '', ...over,
  };
}
const TEMPLATE: SessionTemplate = {
  name: '풀', slots: [{ exerciseId: ASSIST.id, sets: 3, repRange: { min: 6, max: 10 }, role: 'primary' }],
};
function session(history: SessionLog[], over: Partial<WeeklyPlan> = {}, bodyweightKg = 75) {
  return buildSession({
    template: TEMPLATE, date: '2026-03-20', plan: plan(over), history, index, gym: DEFAULT_GYM,
    lifter: { bodyweightKg, level: 'beginner', sex: 'male' },
  });
}

describe('어시스트 풀업 — 도움은 숫자가 작을수록 어렵다', () => {
  it('도와주는 기계를 알아본다 · 든 무게는 체중 − 도움', () => {
    assert.ok(isAssisted(ASSIST) && isAssisted('assisted-pull-up'));
    assert.ok(!isAssisted('lat-pulldown'));
    assert.equal(liftedKg(set(30, 8), 75), 45);
    assert.equal(liftedKg(set(30, 8)), null, '체중을 모르면 힘 추정에서 뺀다');
    assert.equal(liftedKg({ exerciseId: 'lat-pulldown', weightKg: 50 }), 50);
  });

  it('위 끝을 다 채우고 여유가 있으면 도움을 한 칸 줄인다', () => {
    const next = prescribeLoad(ASSIST, [set(30, 10, 2), set(30, 10, 2), set(30, 10, 3)], RULE);
    assert.equal(next.weightKg, 25);
    assert.equal(next.change, 'increase');
    assert.match(next.reason, /도움을 5kg 줄입니다/);
  });

  it('아래 끝에 못 미치면 도움을 한 칸 늘린다 · 범위 안이면 같은 도움으로 한 개 더', () => {
    const short = prescribeLoad(ASSIST, [set(30, 5, 0), set(30, 4, 0)], RULE);
    assert.equal(short.weightKg, 35);
    assert.equal(short.change, 'decrease');
    assert.match(short.reason, /도움을 5kg 늘려/);
    const middle = prescribeLoad(ASSIST, [set(30, 8, 2), set(30, 7, 2)], RULE);
    assert.equal(middle.weightKg, 30);
    assert.equal(middle.targetReps.min, 8);
  });

  it('도움이 가장 적은 칸에서 다 채우면 맨몸 풀업을 권한다 · 처음에는 도움으로 시작하라고 한다', () => {
    const last = prescribeLoad(ASSIST, [set(5, 10, 3), set(5, 10, 3)], RULE);
    assert.equal(last.weightKg, 5);
    assert.match(last.reason, /맨몸 풀업/);
    const first = prescribeLoad(ASSIST, undefined, RULE);
    assert.equal(first.weightKg, null);
    assert.match(first.reason, /숫자가 작을수록 어렵습니다/);
  });

  it('세트 사이 — 넉넉하면 다음 세트 도움을 줄이고, 끝까지 가도 못 채우면 늘린다', () => {
    const easy = adjustWithinSession(ASSIST, set(30, 10, 5), RULE);
    assert.equal(easy.weightKg, 25);
    assert.ok(easy.deltaKg < 0);
    assert.match(easy.reason, /도움을 5kg 줄입니다/);
    const hard = adjustWithinSession(ASSIST, set(30, 4, 0), RULE);
    assert.equal(hard.weightKg, 35);
  });

  it('가장 잘한 세트는 도움이 가장 적은 세트다', () => {
    assert.equal(topWorkingSet([set(35, 10), set(30, 8), set(30, 9)], ASSIST.id)!.weightKg, 30);
    assert.equal(topWorkingSet([set(35, 10), set(30, 8), set(30, 9)], ASSIST.id)!.reps, 9);
  });

  it('오늘 처방 — 잘된 다음 번은 도움이 줄고, 가볍게 하는 주는 도움이 는다', () => {
    const history: SessionLog[] = [{ date: '2026-03-16', sets: [set(30, 10, 3), set(30, 10, 3), set(30, 10, 3)] }];
    const after = session(history);
    assert.equal(after.exercises[0]!.sets[0]!.weightKg, 25);
    const deload = session([{ date: '2026-03-16', sets: [set(30, 8, 2), set(30, 8, 2)] }], { phase: 'deload', intensityMultiplier: 0.9, targetRir: 4 });
    assert.ok(deload.exercises[0]!.sets[0]!.weightKg! > 30, `가볍게 하는 주에 도움이 ${deload.exercises[0]!.sets[0]!.weightKg}kg`);
  });

  it('첫 도움 — 체중에서 당길 수 있는 만큼을 뺀 몫, 힘이 셀수록 도움이 적다', () => {
    const loading = loadingFor(ASSIST, DEFAULT_GYM);
    const at = (bodyweightKg: number, level: 'beginner' | 'intermediate' | 'advanced', sex: 'male' | 'female') =>
      suggestStartingLoad({ exercise: ASSIST, repRange: { min: 6, max: 10 }, targetRir: 3, profile: { bodyweightKg, level, sex }, loading }).weightKg!;
    const novice = at(58, 'beginner', 'female');
    const trained = at(75, 'advanced', 'male');
    assert.ok(novice > 0 && novice <= 58 * 0.75 + 5, `초보 여성 58kg 도움 ${novice}`);
    assert.ok(novice / 58 > trained / 75, `힘이 셀수록 체중 대비 도움이 적어야 합니다: ${novice}/58 · ${trained}/75`);
    assert.ok(at(75, 'beginner', 'male') > at(75, 'advanced', 'male'));
    const result = suggestStartingLoad({ exercise: ASSIST, repRange: { min: 6, max: 10 }, targetRir: 3, profile: { bodyweightKg: 58, level: 'beginner', sex: 'female' }, loading });
    assert.match(result.rationale, /도움 \d+kg/);
    assert.match(result.rationale, /숫자가 작을수록 어렵습니다/);
  });

  it('어시스트 기록으로 다른 당기기 종목의 첫 무게를 키우지 않는다', () => {
    const pulldown = exerciseById('lat-pulldown')!;
    const history: SessionLog[] = [{ date: '2026-03-10', sets: [set(60, 10, 1), set(60, 10, 1)] }];
    const profile = { bodyweightKg: 60, level: 'beginner' as const, sex: 'female' as const };
    const withAssist = suggestStartingLoad({ exercise: pulldown, repRange: { min: 8, max: 12 }, targetRir: 3, profile, history, index });
    const without = suggestStartingLoad({ exercise: pulldown, repRange: { min: 8, max: 12 }, targetRir: 3, profile, history: [], index });
    assert.equal(withAssist.weightKg, without.weightKg);
  });

  it('쉽게 만들기 — 도움은 늘리고(칸 위로), 보통 종목은 줄인다(칸 아래로)', () => {
    const stack = loadingFor(ASSIST, DEFAULT_GYM);
    assert.equal(easierLoad(ASSIST, 30, 0.9, stack), 35);
    assert.equal(easierLoad(ASSIST, 0, 0.9, stack), 5);
    assert.equal(easierLoad(exerciseById('lat-pulldown')!, 60, 0.9, stack), 52.5);
    assert.equal(easierLoad(ASSIST, 30, 1, stack), 30);
  });
});

describe('어시스트 풀업 — 기록 · 비교 · 예고에서 도움이 줄면 는 것이다', () => {
  const before: SessionLog = { date: '2026-03-10', sets: [set(30, 8), set(30, 8)] };

  it('지난번과 비교 — 도움 30kg → 25kg은 오른 것이고, 줄에 "도움"이 붙는다', () => {
    const rows = compareToPast({ todaySets: [set(25, 8), set(25, 7)], today: '2026-03-17', history: [before], index, bodyweightKg: 75 });
    assert.equal(rows.length, 1);
    assert.ok(rows[0]!.deltaPrevious! > 0, `줄었다고 봅니다: ${rows[0]!.deltaPrevious}`);
    assert.match(describeComparison(rows[0]!, 'previous'), /도움 30kg × 8회 → 오늘 힘이 약 [\d.]+kg만큼 늘었습니다/);
    assert.equal(bestImprovement(rows)!.text, '도움 30kg → 25kg');
    const worse = compareToPast({ todaySets: [set(35, 8)], today: '2026-03-17', history: [before], index });
    assert.ok(worse[0]!.deltaPrevious! < 0, '체중을 몰라도 도움이 늘면 내려간 것');
    const same = compareToPast({ todaySets: [set(30, 9)], today: '2026-03-17', history: [before], index });
    assert.match(describeComparison(same[0]!, 'previous'), /같은 도움으로 1회 더/);
  });

  it('다음 운동 예고 · 다음 도전 — "도움을 줄입니다", "도움 25kg 첫 도전"', () => {
    const lift = { name: '어시스트 풀업', equipment: 'machine' as const, pattern: 'verticalPull' as const, assisted: true,
      weightKg: 25, sets: 3, repMin: 6, repMax: 10, previousKg: 30 };
    assert.equal(liftDetail(lift), '어시스트 풀업 도움 25kg — 지난번보다 도움을 5kg 줄입니다');
    assert.equal(liftDetail({ ...lift, weightKg: 35 }, { drop: 'deload' }), '어시스트 풀업 도움 35kg — 이번 주는 가볍게 하는 주라 도움을 5kg 늘립니다');
    const challenge = nextChallenge([{ name: '어시스트 풀업', equipment: 'machine', pattern: 'verticalPull', assisted: true,
      weightKg: 25, targetReps: 6, previousKg: 30, previousReps: 8, bestKg: 30 }]);
    assert.equal(challenge!.text, '어시스트 풀업 도움 25kg 첫 도전');
    assert.equal(nextChallenge([{ name: '어시스트 풀업', equipment: 'machine', pattern: 'verticalPull', assisted: true,
      weightKg: 35, targetReps: 6, previousKg: 30, previousReps: 8, bestKg: 30 }]), null, '도움을 늘린 날은 도전이 아니다');
  });

  it('지난번 기록 · 주간 리포트 — 도움이 가장 적은 세트, "도움 5kg 줄임"', () => {
    assert.equal(lastTimeFor([{ date: '2026-03-10', sets: [set(35, 10), set(30, 8)] }], ASSIST, '2026-03-17')!.weightKg, 30);
    const report = buildWeeklyReport({
      sessions: [{ date: '2026-03-17', sets: [set(25, 8)] }], history: [before],
      landmarks: landmarksFor('intermediate'), index, from: '2026-03-16', to: '2026-03-22',
    });
    assert.deepEqual(report.gains.map((gain) => gain.detail), ['도움 5kg 줄임']);
    assert.equal(report.tonnage, 0, '도움은 들어 올린 총무게가 아니다');
  });

  it('추정 1RM(그래프 · 신기록 · 피로 신호)에서는 뺀다 — 도움을 줄인 주가 기록이 떨어진 주로 읽히지 않게', () => {
    const history: SessionLog[] = [before, { date: '2026-03-17', sets: [set(25, 8)] }];
    assert.ok(!liftProgress(history, index).some((lift) => lift.exerciseId === ASSIST.id));
    assert.ok(!personalRecords(history, index).some((record) => record.exerciseId === ASSIST.id));
    assert.ok(!bestE1rmByExercise(history).has(ASSIST.id));
  });
});

describe('어시스트 풀업 — 멈춘 종목', () => {
  const templates = [TEMPLATE];
  const days = (rows: [number, number][]) => rows.map(([weightKg, reps], i) => ({
    date: addDays(MONDAY, i * 4), sets: [set(weightKg, reps), set(weightKg, reps)],
  }));

  it('도움을 줄여 가고 있으면 멈춘 것이 아니다', () => {
    const history = days([[40, 8], [35, 7], [35, 8], [30, 7], [30, 8], [25, 6]]);
    assert.deepEqual(findPlateaus({ history, templates, index, today: addDays(MONDAY, 26) }), []);
  });

  it('같은 도움 · 같은 횟수가 이어지면 찾고, 도움을 한 칸 늘려 다시 쌓으라고 한다', () => {
    const history = days([[30, 8], [30, 8], [30, 8], [30, 8], [30, 8]]);
    const [found] = findPlateaus({ history, templates, index, today: addDays(MONDAY, 20) });
    assert.match(found!.headline, /도움 30kg × 8회에서 늘지 않았습니다/);
    assert.equal(found!.fix.kind, 'reset');
    assert.match(found!.fix.text, /도움을 35kg으로 한 칸 늘려/);
    assert.equal(found!.fix.action, '도움 한 칸 늘려 다시 쌓기');
  });
});
