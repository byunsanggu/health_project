import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  DEFAULT_HOUR, MAX_PER_WEEK, MIN_GAP_HOURS, PAIN_QUIET_SCORE,
  decideNudge, nudgeHour,
} from '../nudge.ts';
import type { NudgeInput } from '../nudge.ts';

const base: NudgeInput = {
  daysThisWeek: 1,
  target: 4,
  daysLeftInWeek: 4,
  worstPain: 0,
  streakWeeks: 3,
  sentThisWeek: 0,
  trainedToday: false,
};

const at = (over: Partial<NudgeInput>) => decideNudge({ ...base, ...over });

describe('다시 부르기 — 입을 다무는 쪽이 먼저', () => {
  it('아프면 부르지 않는다 — 다른 어떤 이유보다 먼저', () => {
    /*
     * 이게 이 모듈의 전부다. 연속이 걸렸든 횟수가 남았든 상관없다.
     * 아픈 사람을 헬스장으로 부르는 앱은 트레이너가 만든 앱이 아니다.
     */
    const decision = at({
      worstPain: PAIN_QUIET_SCORE,
      daysThisWeek: 3, target: 4, daysLeftInWeek: 1, streakWeeks: 20,
    });
    assert.equal(decision.send, false);
    assert.equal(decision.skip, 'pain');
  });

  it('덜 아프면 부른다 — 앱이 세션을 바꿔 주는 구간이다', () => {
    /*
     * 3~6점은 종목을 대체하거나 중량을 낮추는 구간이다(pain.ts). 나와도
     * 되는 상태이므로 부른다.
     */
    assert.equal(at({ worstPain: PAIN_QUIET_SCORE - 1 }).send, true);
    assert.equal(at({ worstPain: 3 }).send, true);
  });

  it('입을 다무는 선이 앱의 "중단" 선과 같다', () => {
    /*
     * 두 곳이 갈리면 앱이 한 입으로 두말한다 — 화면에서는 오늘 쉬라고
     * 하면서 알림으로는 나오라고 한다. pain.ts가 7점부터 중단이다.
     */
    assert.equal(PAIN_QUIET_SCORE, 7);
    assert.equal(at({ worstPain: 7 }).skip, 'pain');
    assert.equal(at({ worstPain: 10 }).skip, 'pain');
  });

  it('이번 주 약속을 이미 지켰으면 안 부른다', () => {
    const decision = at({ daysThisWeek: 4, target: 4 });
    assert.equal(decision.send, false);
    assert.equal(decision.skip, 'done');
  });

  it('오늘 이미 했으면 안 부른다', () => {
    assert.equal(at({ trainedToday: true }).skip, 'trainedToday');
  });

  it('한 주에 두 번까지만', () => {
    assert.equal(at({ sentThisWeek: MAX_PER_WEEK - 1 }).send, true);
    assert.equal(at({ sentThisWeek: MAX_PER_WEEK }).skip, 'quota');
  });

  it('부른 지 얼마 안 됐으면 안 부른다', () => {
    assert.equal(at({ hoursSinceLast: MIN_GAP_HOURS - 1 }).skip, 'tooSoon');
    assert.equal(at({ hoursSinceLast: MIN_GAP_HOURS }).send, true);
  });

  it('주가 끝났으면 안 부른다', () => {
    assert.equal(at({ daysLeftInWeek: 0 }).skip, 'weekOver');
  });
});

describe('무슨 말을 할 것인가', () => {
  it('한 번 남았으면 연속을 말한다', () => {
    const decision = at({ daysThisWeek: 3, target: 4, daysLeftInWeek: 2, streakWeeks: 8 });
    assert.equal(decision.title, '한 번만 더');
    assert.match(decision.body!, /9주 연속/);
  });

  it('연속이 없는 사람에게 연속을 들먹이지 않는다', () => {
    const decision = at({ daysThisWeek: 3, target: 4, daysLeftInWeek: 2, streakWeeks: 0 });
    assert.doesNotMatch(decision.body!, /연속/);
    assert.match(decision.body!, /약속/);
  });

  it('못 지킬 주에는 약속을 들먹이지 않는다', () => {
    /*
     * 남은 날이 하루인데 세 번이 남았다. 여기서 "이번 주 약속을 지킵니다"는
     * 거짓말이고, 못 지킬 약속을 흔들면 그 주를 통째로 포기한다.
     */
    const decision = at({ daysThisWeek: 1, target: 4, daysLeftInWeek: 1 });
    assert.equal(decision.send, true);
    assert.doesNotMatch(decision.body!, /약속|연속/);
    assert.match(decision.body!, /15분/);
  });

  it('보내는 말에는 겁주는 표현이 없다', () => {
    /*
     * "사라집니다", "놓쳤습니다", "실패" — 습관 앱들이 쓰는 말이다.
     * 공부 앱에서는 통하지만 여기서 통하면 아픈 사람이 헬스장에 간다.
     */
    const cases: Partial<NudgeInput>[] = [
      { daysThisWeek: 3, target: 4, daysLeftInWeek: 2 },
      { daysThisWeek: 1, target: 4, daysLeftInWeek: 1 },
      { daysThisWeek: 0, target: 3, daysLeftInWeek: 5 },
    ];
    for (const over of cases) {
      const decision = at(over);
      assert.equal(decision.send, true);
      const text = decision.title! + ' ' + decision.body!;
      for (const bad of ['사라', '실패', '놓쳤', '경고', '끊깁니다']) {
        assert.ok(!text.includes(bad), `겁주는 말: "${bad}" — ${text}`);
      }
    }
  });

  it('조사가 받침을 따라간다', () => {
    assert.match(at({ daysThisWeek: 1, target: 4, daysLeftInWeek: 4 }).title!, /3번이 남았습니다/);
    assert.match(at({ daysThisWeek: 0, target: 2, daysLeftInWeek: 4 }).title!, /2번이 남았습니다/);
  });
});

describe('언제 보낼 것인가', () => {
  it('기록이 적으면 짐작하지 않는다', () => {
    assert.equal(nudgeHour([]), DEFAULT_HOUR);
    assert.equal(nudgeHour([7, 7]), DEFAULT_HOUR);
  });

  it('늘 가던 시각 한 시간 전', () => {
    assert.equal(nudgeHour([19, 20, 19, 20, 19]), 18);
    assert.equal(nudgeHour([7, 7, 8]), 6);
  });

  it('밤중에 깨우지 않는다', () => {
    /*
     * 새벽 다섯 시에 운동하는 사람이라도 네 시에 울리는 알림은 도움이
     * 아니라 사고다.
     */
    assert.ok(nudgeHour([5, 5, 5]) >= 6);
    assert.ok(nudgeHour([23, 23, 23]) <= 21);
  });
});
