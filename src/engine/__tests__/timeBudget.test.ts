import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { classifyRoles, estimateSessionTime, fitToTimeBudget } from '../timeBudget.ts';
import { decideNextSet, secondsForSet } from '../autoregulation.ts';
import { buildSession } from '../session.ts';
import { runOnboarding } from '../onboarding.ts';
import { COMMON_EQUIPMENT_IDS } from '../equipment.ts';
import { index } from './helpers.ts';
import type { LoadRule } from '../load.ts';
import type { SetLog } from '../types.ts';

const onboarded = runOnboarding({
  selfReportedLevel: 'intermediate',
  monthsTraining: 18,
  bodyweightKg: 78,
  daysPerWeek: 4,
  goals: ['hypertrophy'],
  gym: { equipmentIds: COMMON_EQUIPMENT_IDS },
});

const session = buildSession({
  template: onboarded.program.templates[0]!,
  date: '2026-09-21',
  plan: onboarded.firstWeek,
  history: [],
  index,
  gym: onboarded.gym,
  lifter: onboarded.lifter,
});

describe('세션 시간 추정', () => {
  it('워밍업 · 수행 · 휴식 · 이동을 나눠 센다', () => {
    const estimate = estimateSessionTime(session);
    const { warmup, work, rest, transition } = estimate.breakdown;

    assert.ok(warmup > 0 && work > 0 && rest > 0 && transition > 0);
    assert.equal(warmup + work + rest + transition, estimate.totalSeconds);
    assert.ok(estimate.totalMinutes > 30 && estimate.totalMinutes < 120);
  });

  it('휴식이 세션 시간의 큰 몫을 차지한다', () => {
    /*
     * 휴식을 1분~1분 30초 띠로 줄이기 전에는 휴식이 수행 시간보다 컸다.
     * 지금은 그렇지 않다 — 그래도 4분의 1 이상은 휴식이라, 시간을 맞출 때
     * 휴식부터 건드리는 게 여전히 맞다.
     */
    const { breakdown, totalSeconds } = estimateSessionTime(session);
    assert.ok(breakdown.rest / totalSeconds >= 0.25,
      `휴식 비중 ${Math.round((breakdown.rest / totalSeconds) * 100)}%`);
  });

  it('블록의 휴식 배율을 반영한다', () => {
    const normal = estimateSessionTime(session, { restMultiplier: 1 }).totalSeconds;
    const dense = estimateSessionTime(session, { restMultiplier: 0.65 }).totalSeconds;
    assert.ok(dense < normal);
  });

  it('워밍업을 빼고 셀 수도 있다', () => {
    const withWarmup = estimateSessionTime(session, { includeWarmup: true }).totalSeconds;
    const without = estimateSessionTime(session, { includeWarmup: false }).totalSeconds;
    assert.ok(without < withWarmup);
  });
});

describe('종목 역할 분류', () => {
  it('앞쪽 복합 동작이 메인, 고립은 고립으로 본다', () => {
    const roles = classifyRoles(session.exercises);
    assert.equal(roles[0], 'primary');
    assert.equal(roles.filter((role) => role === 'primary').length, 2);
    assert.ok(roles.includes('isolation'));
  });
});

describe('시간 예산에 맞추기', () => {
  it('넉넉하면 아무것도 건드리지 않는다', () => {
    const result = fitToTimeBudget(session, 180);
    assert.equal(result.fits, true);
    assert.equal(result.adjustments.length, 0);
    assert.match(result.notes[0]!, /계획대로/);
  });

  it('고립 운동부터 줄인다', () => {
    // 예산은 세션 추정치에서 끌어온다 — 휴식 기준이 바뀌면 고정 분 수는 의미가 없다.
    const full = estimateSessionTime(session).totalMinutes;
    const result = fitToTimeBudget(session, Math.round(full * 0.75));
    assert.ok(result.adjustments.length > 0);
    const roles = classifyRoles(session.exercises);
    const firstTouched = session.exercises.findIndex(
      (item) => item.exercise.id === result.adjustments[0]!.exerciseId,
    );
    assert.equal(roles[firstTouched], 'isolation');
  });

  it('예산이 빠듯해도 메인 복합 동작은 남긴다', () => {
    for (const minutes of [45, 30, 25]) {
      const result = fitToTimeBudget(session, minutes);
      const roles = classifyRoles(result.session.exercises);
      assert.ok(roles.filter((role) => role === 'primary').length >= 2, `${minutes}분`);
    }
  });

  it('메인 복합 동작의 최소 세트를 지킨다', () => {
    const result = fitToTimeBudget(session, 25, { minPrimarySets: 2 });
    const roles = classifyRoles(result.session.exercises);
    result.session.exercises.forEach((item, i) => {
      if (roles[i] === 'primary') assert.ok(item.sets.length >= 2, item.exercise.name);
    });
  });

  it('예산 안으로 줄이고 그 사실을 알린다', () => {
    const result = fitToTimeBudget(session, 45);
    assert.equal(result.fits, true);
    assert.ok(result.afterSeconds <= result.budgetSeconds);
    assert.ok(result.afterSeconds < result.beforeSeconds);
    assert.ok(result.notes.some((note) => note.includes('다음 세션에서 메웁니다')));
  });

  it('조정 안내에 조사가 어긋나지 않는다', () => {
    const result = fitToTimeBudget(session, 30);
    for (const adjustment of result.adjustments) {
      assert.ok(!adjustment.reason.includes('(를)'), adjustment.reason);
    }
  });

  it('원본 세션을 건드리지 않는다', () => {
    const before = session.exercises.map((item) => item.sets.length);
    fitToTimeBudget(session, 25);
    assert.deepEqual(session.exercises.map((item) => item.sets.length), before);
  });

  it('도저히 안 되면 못 맞췄다고 말한다', () => {
    const result = fitToTimeBudget(session, 8);
    assert.equal(result.fits, false);
    assert.ok(result.notes.some((note) => note.includes('메인은 빼지 않습니다')));
  });

  it('휴식 단축으로 맞출 수 있으면 세트를 건드리기 전에 그것부터 쓴다', () => {
    /*
     * 휴식을 25% 줄여서 닿는 예산을 잡는다. 휴식이 차지하는 몫이
     * 세션마다 다르므로 추정치에서 계산한다 — 분 수를 박아 두면
     * 휴식 기준을 손댈 때마다 이 테스트가 엉뚱하게 깨진다.
     */
    const before = estimateSessionTime(session);
    const saved = before.breakdown.rest * 0.25;
    const budget = Math.floor((before.totalSeconds - saved * 0.5) / 60);
    const result = fitToTimeBudget(session, budget, { allowShortRest: true });
    assert.equal(result.fits, true);
    assert.equal(result.adjustments[0]?.action, 'shortenRest');
    assert.equal(result.session.exercises.length, session.exercises.length, '종목이 빠지지 않았다');
    assert.ok(result.notes.some((note) => note.includes('휴식을 25% 줄여')));
  });

  it('휴식만 줄여서 안 되면 평소대로 세트를 줄인다', () => {
    const result = fitToTimeBudget(session, 40, { allowShortRest: true });
    assert.ok(result.adjustments.some((item) => item.action === 'trimSets'));
  });
});

describe('자동 세트 판단', () => {
  const rule: LoadRule = { repRange: { min: 8, max: 12 }, targetRir: 2 };
  const set = (reps: number, rir: number): SetLog => ({ exerciseId: 'x', weightKg: 80, reps, rir });

  it('아직 아무것도 안 했으면 계획대로 시작한다', () => {
    const decision = decideNextSet({ completed: [], plannedSets: 4, rule });
    assert.equal(decision.verdict, 'continue');
    assert.equal(decision.remaining, 4);
  });

  it('수행이 유지되면 계속한다', () => {
    const decision = decideNextSet({ completed: [set(12, 2), set(11, 1)], plannedSets: 4, rule });
    assert.equal(decision.verdict, 'continue');
  });

  it('반복이 무너지면 멈춘다', () => {
    const decision = decideNextSet({ completed: [set(12, 2), set(11, 1), set(7, 0)], plannedSets: 5, rule });
    assert.equal(decision.verdict, 'stop');
    assert.match(decision.reason, /피로만 쌓습니다/);
  });

  it('목표 하단도 못 채우고 실패했으면 멈춘다', () => {
    const decision = decideNextSet({ completed: [set(10, 1), set(6, 0)], plannedSets: 4, rule });
    assert.equal(decision.verdict, 'stop');
  });

  it('최소 세트는 붕괴해도 채운다', () => {
    const decision = decideNextSet({ completed: [set(12, 2)], plannedSets: 4, rule, minSets: 3 });
    assert.equal(decision.verdict, 'continue');
  });

  it('계획을 채웠는데 여유가 크면 한 세트 더 권한다', () => {
    const easy = [set(12, 4), set(12, 4), set(12, 4), set(12, 4)];
    const decision = decideNextSet({ completed: easy, plannedSets: 4, rule });
    assert.equal(decision.verdict, 'continue');
    assert.match(decision.reason, /한 세트 더/);
  });

  it('여유가 없으면 계획에서 끝낸다', () => {
    const hard = [set(12, 2), set(11, 1), set(10, 0), set(9, 0)];
    assert.equal(decideNextSet({ completed: hard, plannedSets: 4, rule }).verdict, 'stop');
  });

  it('상한을 넘겨서까지 늘리지는 않는다', () => {
    const easy = Array.from({ length: 6 }, () => set(12, 4));
    const decision = decideNextSet({ completed: easy, plannedSets: 4, rule, maxExtraSets: 2 });
    assert.equal(decision.verdict, 'stop');
  });

  it('MRV를 넘긴 부위는 최소만 하고 멈춘다', () => {
    const decision = decideNextSet({
      completed: [set(12, 2), set(12, 2)], plannedSets: 4, rule, zone: 'overMrv',
    });
    assert.equal(decision.verdict, 'stop');
    assert.match(decision.reason, /회복 가능 범위/);
  });

  it('시간이 모자라면 마지막 세트로 알리고 멈춘다', () => {
    const completed = [set(12, 2), set(11, 2)];
    const perSet = secondsForSet(12, 150);

    const lastOne = decideNextSet({
      completed, plannedSets: 5, rule, timeRemainingSeconds: perSet * 1.5, secondsPerSet: perSet,
    });
    assert.equal(lastOne.verdict, 'lastSet');

    const noTime = decideNextSet({
      completed, plannedSets: 5, rule, timeRemainingSeconds: perSet * 0.5, secondsPerSet: perSet,
    });
    assert.equal(noTime.verdict, 'stop');
  });

  it('RIR 보정을 판단에 반영한다', () => {
    // 신고는 RIR 4지만 실제로는 1이었다면 한 세트 더 권하면 안 된다
    const easy = [set(12, 4), set(12, 4), set(12, 4), set(12, 4)];
    const naive = decideNextSet({ completed: easy, plannedSets: 4, rule });
    const calibrated = decideNextSet({
      completed: easy, plannedSets: 4, rule: { ...rule, rirOffset: -3 },
    });
    assert.equal(naive.verdict, 'continue');
    assert.equal(calibrated.verdict, 'stop');
  });
});
