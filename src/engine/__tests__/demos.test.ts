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

  it('모든 종목의 큐는 세 줄이고, 소리로 읽기 좋게 한 줄 40자 이하다', () => {
    for (const exercise of EXERCISES) {
      const { cues } = demoFor(exercise);
      assert.equal(cues.length, 3, `${exercise.id}: 큐가 ${cues.length}줄`);
      for (const cue of cues) {
        assert.ok([...cue].length <= 40, `${exercise.id}: 너무 긴 큐 — ${cue}`);
        assert.doesNotMatch(cue, /[A-Za-z]/, `${exercise.id}: 영어가 섞인 큐 — ${cue}`);
      }
    }
  });

  it('두 종목이 같은 큐 목록을 쓰지 않는다 — 고립 운동의 일반 큐도 더는 쓰지 않는다', () => {
    // 정말 같은 동작이라 큐를 같이 써야 하는 종목이 생기면 여기에 적고 이유를 단다.
    const ALLOWED_SHARED: readonly string[][] = [];
    const allowed = new Set(ALLOWED_SHARED.map((ids) => [...ids].sort().join(',')));
    const byCues = new Map<string, string[]>();
    for (const exercise of EXERCISES) {
      const key = JSON.stringify(demoFor(exercise).cues);
      byCues.set(key, [...(byCues.get(key) ?? []), exercise.id]);
    }
    const shared = [...byCues.values()].filter((ids) => ids.length > 1 && !allowed.has([...ids].sort().join(',')));
    assert.deepEqual(shared, [], `같은 큐를 쓰는 종목: ${shared.map((ids) => ids.join(', ')).join(' / ')}`);

    const generic = JSON.stringify(['목표 근육 외에는 움직이지 않습니다', '수축 지점에서 잠깐 멈춥니다', '내려올 때 더 천천히']);
    assert.deepEqual(byCues.get(generic) ?? [], []);
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
