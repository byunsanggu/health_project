import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  LEVEL_LABELS_KO,
  TRAINING_LEVELS,
  assessLevel,
  levelFromExperience,
  levelFromStrength,
  levelProfile,
} from '../levels.ts';
import { landmarksFor } from '../muscles.ts';
import { session, sets } from './helpers.ts';

describe('레벨 단계', () => {
  it('네 단계를 모두 한국어로 부른다', () => {
    assert.deepEqual(TRAINING_LEVELS, ['beginner', 'intermediate', 'advanced', 'expert']);
    assert.deepEqual(
      TRAINING_LEVELS.map((level) => LEVEL_LABELS_KO[level]),
      ['초보', '중급', '고급', '전문가'],
    );
  });

  it('단계가 올라갈수록 볼륨 랜드마크가 올라간다', () => {
    const chest = TRAINING_LEVELS.map((level) => landmarksFor(level).chest);
    for (let i = 1; i < chest.length; i += 1) {
      assert.ok(chest[i]!.mev >= chest[i - 1]!.mev, `${TRAINING_LEVELS[i]} MEV`);
    }
  });

  it('전문가는 MRV가 MEV만큼 올라가지 않는다 — 쓸 수 있는 폭이 좁다', () => {
    const intermediate = landmarksFor('intermediate').chest;
    const expert = landmarksFor('expert').chest;
    const mevGrowth = expert.mev / intermediate.mev;
    const mrvGrowth = expert.mrv / intermediate.mrv;
    assert.ok(mrvGrowth < mevGrowth);
  });

  it('단계마다 블록 길이와 시작 RIR이 다르다', () => {
    assert.ok(levelProfile('beginner').accumulationWeeks > levelProfile('expert').accumulationWeeks);
    assert.ok(levelProfile('beginner').startingRir > levelProfile('advanced').startingRir);
    assert.ok(levelProfile('beginner').perSessionCap < levelProfile('expert').perSessionCap);
  });
});

describe('levelFromExperience', () => {
  it('경력 개월 수로 단계를 나눈다', () => {
    assert.equal(levelFromExperience(2), 'beginner');
    assert.equal(levelFromExperience(12), 'intermediate');
    assert.equal(levelFromExperience(36), 'advanced');
    assert.equal(levelFromExperience(72), 'expert');
  });
});

describe('levelFromStrength', () => {
  const history = (weightKg: number) => [
    session('2026-09-14', sets('barbell-bench-press', 1, { weightKg, reps: 5, rir: 0 })),
  ];

  it('체중 대비 기록으로 단계를 본다', () => {
    // 80kg 기준: 추정 1RM이 체중의 1.0 / 1.35 / 1.6배가 경계다
    assert.equal(levelFromStrength(history(50), 80), 'beginner');
    assert.equal(levelFromStrength(history(80), 80), 'intermediate');
    assert.equal(levelFromStrength(history(100), 80), 'advanced');
    assert.equal(levelFromStrength(history(120), 80), 'expert');
  });

  it('참고할 기록이 없으면 판단하지 않는다', () => {
    assert.equal(levelFromStrength([], 80), null);
    assert.equal(levelFromStrength(history(80), 0), null);
  });
});

describe('assessLevel', () => {
  it('자가 신고가 경력과 맞으면 그대로 쓴다', () => {
    const result = assessLevel({ selfReported: 'intermediate', monthsTraining: 14 });
    assert.equal(result.level, 'intermediate');
    assert.equal(result.adjusted, false);
  });

  it('경력이 짧으면 자가 신고보다 낮춘다', () => {
    const result = assessLevel({ selfReported: 'advanced', monthsTraining: 4 });
    assert.equal(result.level, 'beginner');
    assert.equal(result.adjusted, true);
    assert.equal(result.source, 'experience');
    assert.match(result.note, /4개월/);
  });

  it('겸손하게 답했어도 올려잡지는 않는다', () => {
    const result = assessLevel({ selfReported: 'beginner', monthsTraining: 60 });
    assert.equal(result.level, 'beginner', '틀릴 때 손해가 작은 쪽을 고른다');
  });

  it('기록이 있으면 근력도 함께 본다', () => {
    const result = assessLevel({
      selfReported: 'advanced',
      monthsTraining: 40,
      bodyweightKg: 80,
      history: [session('2026-09-14', sets('barbell-bench-press', 1, { weightKg: 55, reps: 5, rir: 1 }))],
    });
    assert.equal(result.level, 'beginner');
    assert.equal(result.source, 'strength');
  });

  it('근거가 자가 신고뿐이면 그대로 따른다', () => {
    const result = assessLevel({ selfReported: 'expert' });
    assert.equal(result.level, 'expert');
    assert.equal(result.source, 'self');
  });
});
