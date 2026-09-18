import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  STYLE_PROFILES,
  TRAINING_STYLES,
  availableStyles,
  styleProfile,
  suggestNextStyle,
  targetRirFor,
  type TrainingStyle,
} from '../styles.ts';
import {
  TECHNIQUES,
  availableTechniques,
  planMaxTest,
  techniqueEffect,
  testRepsFor,
} from '../intensity.ts';
import { exerciseById } from '../exercises.ts';
import type { Exercise } from '../types.ts';

const squat = exerciseById('back-squat') as Exercise;
const curl = exerciseById('barbell-curl') as Exercise;
const pushdown = exerciseById('triceps-pushdown') as Exercise;

function allowed(list: ReturnType<typeof availableStyles>, style: TrainingStyle): boolean {
  return list.find((item) => item.style === style)!.allowed;
}

describe('블록 유형', () => {
  it('다섯 가지를 모두 정의한다', () => {
    assert.equal(TRAINING_STYLES.length, 5);
    for (const style of TRAINING_STYLES) {
      const profile = styleProfile(style);
      assert.ok(profile.label.length > 0);
      assert.ok(profile.rirByWeek.length > 0);
      assert.ok(profile.blockWeeks > 0);
    }
  });

  it('근력 블록이 근비대보다 무겁고 덜 반복한다', () => {
    const strength = STYLE_PROFILES.strength;
    const hypertrophy = STYLE_PROFILES.hypertrophy;
    assert.ok(strength.repRanges.primary.max < hypertrophy.repRanges.primary.max);
    assert.ok(strength.restMultiplier > hypertrophy.restMultiplier);
    assert.ok(strength.volumeMultiplier < hypertrophy.volumeMultiplier);
  });

  it('고밀도 블록은 휴식이 가장 짧고 길이가 가장 제한된다', () => {
    const density = STYLE_PROFILES.density;
    assert.ok(density.restMultiplier < 1);
    assert.ok(density.volumeMultiplier > 1);
    assert.equal(density.blockWeeks, 3, '3주가 한계다');
    assert.equal(density.maxConsecutiveBlocks, 1);
  });

  it('한계 돌파 블록은 볼륨이 가장 낮고 테스트를 포함한다', () => {
    const peak = STYLE_PROFILES.peak;
    assert.ok(peak.volumeMultiplier <= 0.5);
    assert.equal(peak.includesMaxTest, true);
    assert.equal(peak.allowsIntensityTechniques, false, '테스트 블록에 드롭세트를 붙이지 않는다');
  });

  it('주차가 갈수록 목표 RIR이 내려간다', () => {
    const first = targetRirFor('hypertrophy', 1);
    const last = targetRirFor('hypertrophy', 5);
    assert.ok(first > last);
    assert.equal(targetRirFor('hypertrophy', 99), last, '블록을 넘어가면 마지막 값을 유지한다');
  });
});

describe('블록 선택 가능 여부', () => {
  it('초보자에게는 근비대와 컨디셔닝만 연다', () => {
    const list = availableStyles({ level: 'beginner' });
    assert.equal(allowed(list, 'hypertrophy'), true);
    assert.equal(allowed(list, 'conditioning'), true);
    assert.equal(allowed(list, 'strength'), false);
    assert.equal(allowed(list, 'peak'), false);
  });

  it('막을 때는 이유를 함께 준다', () => {
    const denied = availableStyles({ level: 'beginner' }).filter((item) => !item.allowed);
    assert.ok(denied.every((item) => (item.reason ?? '').length > 10));
    assert.ok(!denied.some((item) => (item.reason ?? '').includes('근력는')), '조사를 맞춘다');
  });

  it('한계 돌파는 디로드 다음 주에만 연다', () => {
    const notReady = availableStyles({ level: 'advanced', justDeloaded: false });
    assert.equal(allowed(notReady, 'peak'), false);
    assert.match(notReady.find((i) => i.style === 'peak')!.reason!, /디로드/);

    const ready = availableStyles({ level: 'advanced', justDeloaded: true });
    assert.equal(allowed(ready, 'peak'), true);
  });

  it('통증이 있으면 강도를 올리는 블록을 막는다', () => {
    const list = availableStyles({ level: 'advanced', justDeloaded: true, painPresent: true });
    assert.equal(allowed(list, 'peak'), false);
    assert.equal(allowed(list, 'density'), false);
    assert.equal(allowed(list, 'hypertrophy'), true, '기본 블록까지 막지는 않는다');
  });

  it('같은 블록을 연속 한도 이상 돌리지 못하게 한다', () => {
    const list = availableStyles({
      level: 'advanced',
      recentStyles: ['hypertrophy', 'hypertrophy', 'hypertrophy'],
    });
    assert.equal(allowed(list, 'hypertrophy'), false);
    assert.match(list.find((i) => i.style === 'hypertrophy')!.reason!, /연속/);
  });

  it('고밀도 블록은 연달아 돌리지 않는다', () => {
    const list = availableStyles({ level: 'advanced', recentStyles: ['density'] });
    assert.equal(allowed(list, 'density'), false);
  });
});

describe('다음 블록 추천', () => {
  it('근력 블록 + 디로드 뒤에는 한계 돌파를 권한다', () => {
    const suggestion = suggestNextStyle({
      level: 'advanced', recentStyles: ['hypertrophy', 'strength'], justDeloaded: true,
    });
    assert.equal(suggestion.style, 'peak');
    assert.ok(suggestion.reason.length > 10);
  });

  it('고밀도·한계 돌파 뒤에는 볼륨 블록으로 돌린다', () => {
    for (const last of ['density', 'peak'] as TrainingStyle[]) {
      const suggestion = suggestNextStyle({ level: 'advanced', recentStyles: [last] });
      assert.equal(suggestion.style, 'hypertrophy', last);
    }
  });

  it('근비대가 이어지면 근력으로 바꿀 것을 권한다', () => {
    const suggestion = suggestNextStyle({
      level: 'advanced', recentStyles: ['hypertrophy', 'hypertrophy'],
    });
    assert.equal(suggestion.style, 'strength');
  });

  it('초보자에게는 항상 기본 블록을 권한다', () => {
    assert.equal(suggestNextStyle({ level: 'beginner', recentStyles: ['hypertrophy'] }).style, 'hypertrophy');
  });
});

describe('강도 기법', () => {
  const base = { level: 'intermediate' as const, style: 'hypertrophy' as const, zone: 'mevToMav' as const, isLastSet: true };

  it('고립 운동에는 대부분 열린다', () => {
    const list = availableTechniques({ ...base, exercise: curl });
    assert.ok(list.filter((item) => item.allowed).length >= 5);
  });

  it('관절 부하가 큰 복합 동작에는 드롭세트를 막는다', () => {
    const list = availableTechniques({ ...base, exercise: squat });
    const drop = list.find((item) => item.technique.id === 'dropSet')!;
    assert.equal(drop.allowed, false);
    assert.match(drop.reason!, /관절 부하/);
  });

  it('디로드 주에는 전부 막는다', () => {
    const list = availableTechniques({ ...base, exercise: curl, deloadWeek: true });
    assert.ok(list.every((item) => !item.allowed));
  });

  it('한계 돌파 블록에서는 강도 기법을 쓰지 않는다', () => {
    const list = availableTechniques({ ...base, exercise: curl, style: 'peak' });
    assert.ok(list.every((item) => !item.allowed));
    assert.match(list[0]!.reason!, /강도는 중량으로/);
  });

  it('MRV를 넘긴 부위에는 막는다', () => {
    const list = availableTechniques({ ...base, exercise: curl, zone: 'overMrv' });
    assert.ok(list.every((item) => !item.allowed));
  });

  it('고강도 구간에서는 피로가 적은 기법만 남긴다', () => {
    const list = availableTechniques({ ...base, exercise: curl, zone: 'mavToMrv' });
    const allowedOnes = list.filter((item) => item.allowed);
    assert.ok(allowedOnes.length > 0);
    assert.ok(allowedOnes.every((item) => item.technique.fatigueFactor <= 1.5));
  });

  it('초보자는 고립 운동에만 쓸 수 있다', () => {
    const onCompound = availableTechniques({ ...base, exercise: squat, level: 'beginner' });
    assert.ok(onCompound.every((item) => !item.allowed));

    const onIsolation = availableTechniques({ ...base, exercise: pushdown, level: 'beginner' });
    assert.ok(onIsolation.some((item) => item.allowed));
  });

  it('통증이 보고된 관절을 쓰는 종목에는 막는다', () => {
    const list = availableTechniques({
      ...base, exercise: pushdown, pain: [{ joint: 'elbow', score: 5 }],
    });
    assert.ok(list.every((item) => !item.allowed));
  });

  it('앞 세트에는 피로가 큰 기법을 붙이지 않는다', () => {
    const list = availableTechniques({ ...base, exercise: curl, isLastSet: false });
    const drop = list.find((item) => item.technique.id === 'dropSet')!;
    assert.equal(drop.allowed, false);
    assert.match(drop.reason!, /뒤쪽에 붙이세요/);
  });

  it('유효 세트와 피로를 따로 센다', () => {
    const drop = techniqueEffect('dropSet');
    assert.ok(drop.effectiveSets > 1);
    assert.ok(drop.fatigueLoad > drop.effectiveSets, '자극보다 피로가 더 크게 붙는다');

    const antagonist = techniqueEffect('antagonistSuperset');
    assert.equal(antagonist.effectiveSets, 1, '길항근 슈퍼세트는 시간만 줄인다');
    assert.ok(antagonist.fatigueLoad < drop.fatigueLoad);
  });

  it('모든 기법에 수행 방법이 적혀 있다', () => {
    for (const technique of Object.values(TECHNIQUES)) {
      assert.ok(technique.howTo.length > 15, technique.label);
    }
  });
});

describe('한계 테스트', () => {
  const ready = {
    exercise: squat, estimated1RM: 180, level: 'advanced' as const,
    justDeloaded: true, weeksAccumulated: 4,
  };

  it('단계에 따라 테스트 반복 수가 다르다', () => {
    assert.equal(testRepsFor('beginner'), 5, '초보에게 1RM 시도는 위험하다');
    assert.equal(testRepsFor('intermediate'), 3);
    assert.equal(testRepsFor('advanced'), 1);
    assert.equal(testRepsFor('expert'), 1);
  });

  it('워밍업 램프가 가벼운 것부터 올라간다', () => {
    const plan = planMaxTest(ready);
    assert.ok(plan.warmups.length >= 3);
    for (let i = 1; i < plan.warmups.length; i += 1) {
      assert.ok(plan.warmups[i]!.weightKg > plan.warmups[i - 1]!.weightKg);
      assert.ok(plan.warmups[i]!.reps <= plan.warmups[i - 1]!.reps, '올라갈수록 반복은 줄어든다');
    }
    assert.ok(plan.warmups[plan.warmups.length - 1]!.weightKg < plan.attempts[0]!.weightKg);
  });

  it('시도는 세 번까지이고 점점 무거워진다', () => {
    const plan = planMaxTest(ready);
    assert.equal(plan.attempts.length, 3);
    assert.ok(plan.attempts[0]!.weightKg < plan.attempts[2]!.weightKg);
    assert.ok(plan.safety.some((note) => note.includes('세 번')));
  });

  it('초보자에게는 5RM으로 계획한다', () => {
    const plan = planMaxTest({ ...ready, level: 'beginner' });
    assert.equal(plan.testReps, 5);
    assert.ok(plan.attempts[1]!.weightKg < 180 * 0.9, '1RM보다 한참 가볍다');
  });

  it('디로드 전이거나 축적이 짧으면 막는다', () => {
    const early = planMaxTest({ ...ready, justDeloaded: false, weeksAccumulated: 2 });
    assert.equal(early.eligible, false);
    assert.equal(early.blockers.length, 2);
  });

  it('통증이 있으면 막는다', () => {
    const hurt = planMaxTest({ ...ready, pain: [{ joint: 'knee', score: 5 }] });
    assert.equal(hurt.eligible, false);
    assert.match(hurt.blockers[0]!, /통증/);
  });

  it('종목에 맞는 안전 안내를 붙인다', () => {
    const squatPlan = planMaxTest(ready);
    assert.ok(squatPlan.safety.some((note) => note.includes('세이프티')));

    const deadlift = exerciseById('conventional-deadlift') as Exercise;
    const dlPlan = planMaxTest({ ...ready, exercise: deadlift, estimated1RM: 220 });
    assert.ok(dlPlan.safety.some((note) => note.includes('허리')));
  });

  it('기구에서 만들 수 있는 중량으로 맞춘다', () => {
    const plan = planMaxTest({ ...ready, snap: (weight) => Math.round(weight / 5) * 5 });
    for (const attempt of plan.attempts) {
      assert.equal(attempt.weightKg % 5, 0);
    }
  });
});
