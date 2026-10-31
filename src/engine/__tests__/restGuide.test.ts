import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { restGuideFor, restGuideLines } from '../coachGuide.ts';
import { EXERCISES } from '../exercises.ts';
import { speechSeconds } from '../coach.ts';

describe('쉬는 동안 다음 운동 미리 듣기', () => {
  it('모든 종목에 잡는 법 · 동작 핵심 · 흔한 실수 하나가 있다', () => {
    for (const exercise of EXERCISES) {
      const guide = restGuideFor(exercise);
      assert.ok(guide.grip && guide.move, exercise.id);
      assert.ok(guide.mistake, exercise.id + ' 실수가 없다');
    }
  });

  it('말로 하면 25초 안쪽 — 쉬는 시간을 다 잡아먹지 않는다', () => {
    for (const style of ['energetic', 'gentle', 'tough', 'fun'] as const) {
      for (const exercise of EXERCISES) {
        const seconds = speechSeconds(restGuideLines(style, exercise).join(' '));
        assert.ok(seconds <= 25, `${style} ${exercise.id}: ${seconds.toFixed(1)}초`);
      }
    }
  });

  it('빡센 코치 머리말은 반말이다', () => {
    const [head] = restGuideLines('tough', EXERCISES[0]!);
    assert.ok(!/요[.!]?$|니다[.!]?$/.test(head!), head);
  });
});
