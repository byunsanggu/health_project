import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { EXERCISES } from '../exercises.ts';
import { PATTERN_LABELS_KO, demoCoverage, demoFor } from '../demos.ts';
import { MOVEMENT_PATTERNS_OR_EMPTY } from './demos.fixtures.ts';

describe('demoFor', () => {
  it('모든 종목에 시연이 있다', () => {
    for (const exercise of EXERCISES) {
      const demo = demoFor(exercise);
      assert.equal(demo.exerciseId, exercise.id);
      assert.ok(demo.cues.length > 0, `${exercise.id}: 큐가 없다`);
      assert.ok(demo.mistakes.length > 0, `${exercise.id}: 실수 항목이 없다`);
    }
  });

  it('종목별 오버라이드는 패턴 기본값을 덮어쓴다', () => {
    const squat = demoFor(EXERCISES.find((item) => item.id === 'back-squat')!);
    assert.match(squat.cues.join(' '), /승모근/);
    assert.equal(squat.pattern, 'squat');
  });

  it('아직 에셋이 없으므로 절차적 시연이다', () => {
    for (const exercise of EXERCISES) {
      const demo = demoFor(exercise);
      assert.equal(demo.source, 'procedural');
      assert.equal(demo.assetUrl, undefined);
    }
  });

  it('모든 동작 패턴에 한국어 이름이 있다', () => {
    for (const pattern of MOVEMENT_PATTERNS_OR_EMPTY) {
      assert.ok(PATTERN_LABELS_KO[pattern], `${pattern}: 이름이 없다`);
    }
  });
});

describe('demoCoverage', () => {
  it('패턴별 종목 수와 맞춤 큐가 작성된 종목 수를 센다', () => {
    const coverage = demoCoverage(EXERCISES);
    assert.equal(coverage.total, EXERCISES.length);
    assert.ok(coverage.withOverride > 0);
    assert.equal(
      Object.values(coverage.byPattern).reduce((sum, count) => sum + count, 0),
      EXERCISES.length,
    );
  });
});
