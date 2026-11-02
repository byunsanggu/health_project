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

describe('쉬는 동안 운동 설명 — 화면과 말이 같다', () => {
  it('화면의 주의 줄은 말로 하는 고치는 말과 같은 문장이다', () => {
    for (const exercise of EXERCISES) {
      const guide = restGuideFor(exercise);
      assert.ok(guide.mistake!.warn.endsWith(guide.mistake!.fix), exercise.id);
      const said = restGuideLines('gentle', exercise).join(' ');
      assert.ok(said.includes(guide.mistake!.fix), `${exercise.id}: ${said}`);
    }
  });

  it('앞에 쉬는 시간이 없으면 "쉬는 동안"이라고 하지 않는다', () => {
    for (const style of ['energetic', 'gentle', 'tough', 'fun'] as const) {
      const [head] = restGuideLines(style, EXERCISES[0]!, { resting: false });
      assert.doesNotMatch(head!, /쉬/, `${style}: ${head}`);
      assert.match(head!, /시작 전/, style);
    }
  });

  it('세팅 순서를 막 말했으면 자리 잡는 말은 빼고 동작 · 실수만', () => {
    const exercise = EXERCISES[0]!;
    const guide = restGuideFor(exercise);
    const said = restGuideLines('gentle', exercise, { resting: false, grip: false }).join(' ');
    assert.ok(!said.includes(guide.grip!.replace(/[.!?]$/, '')), said);
    assert.ok(said.includes(guide.mistake!.fix), said);
  });
});
