import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  QUICK_START_PARAM, needsTapToStart, quickStartRoute, wantsQuickStart, type QuickStartInput,
} from '../quickStart.ts';
import {
  ACTIVE_TICK_CAP_MS, FIVE_MINUTE_SECONDS, addActive, askToContinue, fiveMinuteAskLine, fiveMinuteDoneLine, fiveMinuteEnd,
  offerFiveMinutes,
} from '../shortSession.ts';
import { COACH_STYLES } from '../coach.ts';
import { speechCorpus } from '../speechCorpus.ts';
import { forSpeech } from '../coach.ts';
import { speechPieces } from '../speech.ts';

const ready: QuickStartInput = { hasPlan: true, restDay: false, closed: false, pain: false, started: false, pt: true };

describe('알림에서 한 번에 시작', () => {
  it('평소 날은 PT로 바로 들어간다', () => {
    assert.equal(quickStartRoute(ready), 'pt');
  });

  it('PT를 꺼 둔 사람은 혼자 운동 화면으로', () => {
    assert.equal(quickStartRoute({ ...ready, pt: false }), 'solo');
  });

  it('쉬는 날 · 마친 날 · 아픈 날은 오늘 화면을 그냥 연다', () => {
    assert.equal(quickStartRoute({ ...ready, restDay: true }), 'today');
    assert.equal(quickStartRoute({ ...ready, closed: true }), 'today');
    assert.equal(quickStartRoute({ ...ready, pain: true }), 'today');
    assert.equal(quickStartRoute({ ...ready, hasPlan: false }), 'today');
  });

  it('아픈 날은 이미 운동 중이어도 시작으로 끌고 가지 않는다', () => {
    assert.equal(quickStartRoute({ ...ready, pain: true, started: true }), 'today');
  });

  it('이미 운동 중이면 그 화면으로 돌아간다 — 처음부터 다시 시작하지 않는다', () => {
    assert.equal(quickStartRoute({ ...ready, started: true }), 'resume');
  });

  it('소리가 잠겨 있을 때만, PT일 때만 시작 단추를 한 번 띄운다', () => {
    assert.equal(needsTapToStart('pt', true), true);
    assert.equal(needsTapToStart('pt', false), false);
    assert.equal(needsTapToStart('solo', true), false);
    assert.equal(needsTapToStart('today', true), false);
  });

  it('주소를 읽는다', () => {
    assert.equal(wantsQuickStart('?' + QUICK_START_PARAM), true);
    assert.equal(wantsQuickStart('?tab=today&go=start'), true);
    assert.equal(wantsQuickStart('?go=starter'), false);
    assert.equal(wantsQuickStart('?tab=today'), false);
    assert.equal(wantsQuickStart(''), false);
  });
});

describe('5분만 해도 됩니다', () => {
  const base = { promisedMinutes: 19 * 60, nowMinutes: 19 * 60 + 5, started: false, closed: false, restDay: false };

  it('약속 시각이 지났는데 시작을 안 했으면 권한다', () => {
    assert.equal(offerFiveMinutes(base), true);
    assert.equal(offerFiveMinutes({ ...base, nowMinutes: 19 * 60 }), true);
  });

  it('약속 전에는 권하지 않는다 — 5분이 기본값이 되면 원래 운동이 줄어든다', () => {
    assert.equal(offerFiveMinutes({ ...base, nowMinutes: 18 * 60 + 59 }), false);
  });

  it('약속이 없거나 오늘이 약속한 날이 아니면 권하지 않는다', () => {
    assert.equal(offerFiveMinutes({ ...base, promisedMinutes: null }), false);
  });

  it('이미 시작했거나 마쳤거나 쉬는 날이면 권하지 않는다', () => {
    assert.equal(offerFiveMinutes({ ...base, started: true }), false);
    assert.equal(offerFiveMinutes({ ...base, closed: true }), false);
    assert.equal(offerFiveMinutes({ ...base, restDay: true }), false);
  });

  it('5분이 차도 세트 한가운데에서는 묻지 않는다', () => {
    assert.equal(askToContinue({ activeSeconds: FIVE_MINUTE_SECONDS + 30, asked: false, boundary: 'set' }), false);
    assert.equal(askToContinue({ activeSeconds: FIVE_MINUTE_SECONDS + 30, asked: false, boundary: 'rest' }), true);
    assert.equal(askToContinue({ activeSeconds: FIVE_MINUTE_SECONDS, asked: false, boundary: 'between' }), true);
  });

  it('5분 전에는 묻지 않고, 한 번 물었으면 다시 묻지 않는다', () => {
    assert.equal(askToContinue({ activeSeconds: FIVE_MINUTE_SECONDS - 1, asked: false, boundary: 'rest' }), false);
    assert.equal(askToContinue({ activeSeconds: FIVE_MINUTE_SECONDS * 3, asked: true, boundary: 'rest' }), false);
  });

  it('멈춘 시간은 세지 않고, 화면 밖에서 건너뛴 큰 틈은 상한까지만 더한다', () => {
    assert.equal(addActive(1000, 1000, true), 2000);
    assert.equal(addActive(1000, 1000, false), 1000);
    assert.equal(addActive(0, 10 * 60 * 1000, true), ACTIVE_TICK_CAP_MS);
    assert.equal(addActive(500, -20, true), 500);
  });

  it('본 세트가 하나라도 있으면 짧게 한 날, 없으면 아무것도 세지 않는다', () => {
    assert.equal(fiveMinuteEnd([{ reps: 8 }]), 'short');
    assert.equal(fiveMinuteEnd([{ reps: 8, warmup: true }]), 'none');
    assert.equal(fiveMinuteEnd([{ reps: 0 }]), 'none');
    assert.equal(fiveMinuteEnd([]), 'none');
  });

  it('끝낸 화면은 실패라고 하지 않는다', () => {
    for (const line of [fiveMinuteDoneLine('short', 2), fiveMinuteDoneLine('none', 0)]) {
      assert.ok(!/실패|못 했|포기/.test(line), line);
    }
    assert.match(fiveMinuteDoneLine('short', 2), /2세트/);
  });

  it('묻는 말은 코치 넷이 다 다르고, 목소리 조각 목록에 들어 있다', () => {
    const lines = COACH_STYLES.map((info) => fiveMinuteAskLine(info.id));
    assert.equal(new Set(lines).size, lines.length);
    for (const info of COACH_STYLES) {
      const corpus = new Set(speechCorpus(info.id));
      for (const piece of speechPieces(forSpeech(fiveMinuteAskLine(info.id)), () => false)) {
        assert.ok(corpus.has(piece), `${info.id}: "${piece}" 조각이 없습니다`);
      }
    }
    // 빡센 코치만 반말
    assert.match(fiveMinuteAskLine('tough'), /할까\?$/);
  });
});
