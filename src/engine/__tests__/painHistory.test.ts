import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { CHRONIC_DAYS, PAIN_THRESHOLD, activePain, painHistory } from '../painHistory.ts';
import { EXERCISES } from '../exercises.ts';
import type { CheckIn, Joint, SessionLog } from '../types.ts';

const index = new Map(EXERCISES.map((exercise) => [exercise.id, exercise]));
const TODAY = '2026-09-26';

const dayBefore = (n: number): string =>
  new Date(Date.parse(TODAY + 'T00:00:00Z') - n * 86400000).toISOString().slice(0, 10);

const checkIn = (date: string, pain: { joint: Joint; score: number }[]): CheckIn =>
  ({ id: 'c' + date, date, updatedAt: date, pain }) as CheckIn;

const session = (date: string, exerciseIds: string[]): SessionLog =>
  ({
    id: 's' + date,
    date,
    updatedAt: date,
    sets: exerciseIds.map((exerciseId) => ({
      exerciseId, weightKg: 50, reps: 8, rir: 2, warmup: false,
    })),
  }) as SessionLog;

const run = (checkIns: CheckIn[], sessions: SessionLog[] = []) =>
  painHistory({ checkIns, sessions, index, today: TODAY });

describe('통증 이력 — 한 점이 아니라 선', () => {
  it('언제부터인지를 센다', () => {
    const history = run([
      checkIn(dayBefore(20), [{ joint: 'shoulder', score: 4 }]),
      checkIn(dayBefore(10), [{ joint: 'shoulder', score: 5 }]),
      checkIn(dayBefore(0), [{ joint: 'shoulder', score: 5 }]),
    ]);
    assert.equal(history[0]?.joint, 'shoulder');
    assert.equal(history[0]?.days, 20);
    assert.match(history[0]?.summary ?? '', /주째/);
  });

  it('약한 통증은 세지 않는다', () => {
    // pain.ts가 종목을 조정하는 기준과 같은 선을 쓴다.
    assert.equal(PAIN_THRESHOLD, 3);
    const history = run([checkIn(dayBefore(0), [{ joint: 'knee', score: 2 }])]);
    assert.equal(history.length, 0);
  });

  it('마지막 체크인에 없으면 없어진 것으로 본다', () => {
    /*
     * 사흘 전에 5점이었고 그 뒤 체크인에서 안 적었으면 그건 5점이
     * 아니라 없어진 것이다. 마지막 "보고"가 아니라 마지막 "체크인"을 본다.
     */
    const history = run([
      checkIn(dayBefore(5), [{ joint: 'knee', score: 5 }]),
      checkIn(dayBefore(0), []),
    ]);
    assert.equal(history[0]?.latest, 0);
    assert.equal(history[0]?.trend, 'gone');
    assert.match(history[0]?.summary ?? '', /지금은 없습니다/);
  });

  it('지금 아픈 것을 앞에 둔다', () => {
    const history = run([
      checkIn(dayBefore(30), [{ joint: 'knee', score: 6 }]),
      checkIn(dayBefore(0), [{ joint: 'shoulder', score: 4 }]),
    ]);
    assert.equal(history[0]?.joint, 'shoulder');
    assert.equal(activePain(history).length, 1);
  });
});

describe('추세', () => {
  it('마지막 한 점으로 정하지 않는다', () => {
    /*
     * 아픈 정도는 날마다 출렁인다. 어제 좋았다고 낫는 중인 게 아니다.
     * 앞 절반과 뒤 절반을 견준다.
     */
    const history = run([
      checkIn(dayBefore(20), [{ joint: 'shoulder', score: 7 }]),
      checkIn(dayBefore(15), [{ joint: 'shoulder', score: 7 }]),
      checkIn(dayBefore(10), [{ joint: 'shoulder', score: 4 }]),
      checkIn(dayBefore(0), [{ joint: 'shoulder', score: 4 }]),
    ]);
    assert.equal(history[0]?.trend, 'better');
    assert.match(history[0]?.summary ?? '', /나아지는/);
  });

  it('심해지는 것을 잡는다', () => {
    const history = run([
      checkIn(dayBefore(20), [{ joint: 'lowBack', score: 3 }]),
      checkIn(dayBefore(15), [{ joint: 'lowBack', score: 3 }]),
      checkIn(dayBefore(10), [{ joint: 'lowBack', score: 6 }]),
      checkIn(dayBefore(0), [{ joint: 'lowBack', score: 6 }]),
    ]);
    assert.equal(history[0]?.trend, 'worse');
  });

  it('두 번으로는 추세를 말하지 않는다', () => {
    const history = run([
      checkIn(dayBefore(5), [{ joint: 'knee', score: 3 }]),
      checkIn(dayBefore(0), [{ joint: 'knee', score: 6 }]),
    ]);
    assert.equal(history[0]?.trend, 'flat');
  });
});

describe('유발 후보', () => {
  /** 주 2회 오버헤드, 그 다음 날 어깨 통증. */
  const overheadPattern = () => {
    const checkIns: CheckIn[] = [];
    const sessions: SessionLog[] = [];
    for (let i = 40; i >= 0; i -= 1) {
      const date = dayBefore(i);
      const overhead = i % 7 === 5 || i % 7 === 1;
      sessions.push(session(date, overhead ? ['barbell-overhead-press'] : ['lat-pulldown']));
      const yesterdayOverhead = (i + 1) % 7 === 5 || (i + 1) % 7 === 1;
      checkIns.push(checkIn(date, yesterdayOverhead ? [{ joint: 'shoulder', score: 5 }] : []));
    }
    return { checkIns, sessions };
  };

  it('"항상 오버헤드 다음 날"을 찾아낸다', () => {
    const { checkIns, sessions } = overheadPattern();
    const history = painHistory({ checkIns, sessions, index, today: TODAY });
    const trigger = history[0]?.triggers[0];
    assert.equal(trigger?.pattern, 'verticalPush');
    assert.ok(trigger && trigger.rate > trigger.baseRate);
  });

  it('같은 날은 세지 않는다', () => {
    /*
     * 체크인은 운동 "전"에 한다. 그날 아침에 적은 통증이 그날 저녁
     * 운동 때문일 수는 없다. 같은 날을 세면 매일 하는 동작이 늘
     * 1등으로 나오고, 그 목록은 거짓말이 된다.
     */
    const checkIns: CheckIn[] = [];
    const sessions: SessionLog[] = [];
    for (let i = 20; i >= 0; i -= 1) {
      const date = dayBefore(i);
      // 통증이 있는 날에만 오버헤드를 한다 — 인과가 거꾸로다
      const hurts = i % 4 === 0;
      sessions.push(session(date, hurts ? ['barbell-overhead-press'] : ['leg-press']));
      checkIns.push(checkIn(date, hurts ? [{ joint: 'shoulder', score: 5 }] : []));
    }
    const history = painHistory({ checkIns, sessions, index, today: TODAY });
    assert.equal(history[0]?.triggers.length, 0);
  });

  it('몇 번 안 겹친 것은 패턴이라 부르지 않는다', () => {
    /*
     * 우연히 두 번 겹치는 일은 늘 있다. 그걸 패턴이라고 부르면
     * 사용자는 멀쩡한 종목을 버린다.
     */
    const history = run(
      [
        checkIn(dayBefore(10), [{ joint: 'shoulder', score: 5 }]),
        checkIn(dayBefore(0), [{ joint: 'shoulder', score: 5 }]),
      ],
      [session(dayBefore(11), ['barbell-overhead-press']), session(dayBefore(1), ['barbell-overhead-press'])],
    );
    assert.equal(history[0]?.triggers.length, 0);
  });

  it('그 관절에 안 실리는 동작은 후보로 보지 않는다', () => {
    // 어깨 통증에 레그컬이 1등으로 나오면 그 목록은 아무도 안 믿는다.
    const checkIns: CheckIn[] = [];
    const sessions: SessionLog[] = [];
    for (let i = 30; i >= 0; i -= 1) {
      const date = dayBefore(i);
      sessions.push(session(date, ['lying-leg-curl']));
      checkIns.push(checkIn(date, i % 3 === 0 ? [{ joint: 'shoulder', score: 5 }] : []));
    }
    const history = painHistory({ checkIns, sessions, index, today: TODAY });
    assert.equal(history[0]?.triggers.length, 0);
  });

  it('이어지는 통증은 하루로 친다', () => {
    /*
     * 사흘 내리 아팠으면 사흘 다 세는 게 아니라 "처음 아픈 날" 하나가
     * 사건이다. 안 그러면 오래 아픈 사람일수록 모든 동작이 후보가 된다.
     */
    const checkIns: CheckIn[] = [];
    const sessions: SessionLog[] = [];
    for (let i = 30; i >= 0; i -= 1) {
      const date = dayBefore(i);
      sessions.push(session(date, ['lat-pulldown']));
      // 내리 아프다
      checkIns.push(checkIn(date, [{ joint: 'shoulder', score: 5 }]));
    }
    const history = painHistory({ checkIns, sessions, index, today: TODAY });
    assert.equal(history[0]?.triggers.length, 0);
  });
});

describe('보낼 때는 보낸다', () => {
  it('오래 끌면 진료를 권한다', () => {
    // 트레이너가 하는 일 중 제일 중요한 것 하나가 "이건 내 영역이 아니다"를 아는 것이다.
    const history = run([
      checkIn(dayBefore(CHRONIC_DAYS + 5), [{ joint: 'shoulder', score: 4 }]),
      checkIn(dayBefore(0), [{ joint: 'shoulder', score: 4 }]),
    ]);
    assert.match(history[0]?.referral ?? '', /전문의/);
  });

  it('길어지면서 심해지면 권한다', () => {
    const history = run([
      checkIn(dayBefore(25), [{ joint: 'knee', score: 3 }]),
      checkIn(dayBefore(20), [{ joint: 'knee', score: 3 }]),
      checkIn(dayBefore(10), [{ joint: 'knee', score: 6 }]),
      checkIn(dayBefore(0), [{ joint: 'knee', score: 7 }]),
    ]);
    assert.match(history[0]?.referral ?? '', /진료/);
  });

  it('많이 아팠던 적이 있으면 위험 신호를 알려 준다', () => {
    const history = run([
      checkIn(dayBefore(3), [{ joint: 'lowBack', score: 8 }]),
      checkIn(dayBefore(0), [{ joint: 'lowBack', score: 4 }]),
    ]);
    assert.match(history[0]?.referral ?? '', /저리|힘이 빠지/);
  });

  it('나은 것에는 권하지 않는다', () => {
    const history = run([
      checkIn(dayBefore(60), [{ joint: 'knee', score: 5 }]),
      checkIn(dayBefore(0), []),
    ]);
    assert.equal(history[0]?.referral, undefined);
  });

  it('가볍고 짧은 것에는 권하지 않는다', () => {
    const history = run([checkIn(dayBefore(0), [{ joint: 'wrist', score: 3 }])]);
    assert.equal(history[0]?.referral, undefined);
  });
});

describe('진단하지 않는다', () => {
  it('원인이라고 말하지 않는다', () => {
    /*
     * 같이 나왔다는 것과 원인이라는 것은 다른 말이다. 그 선을 넘으면
     * 앱이 의료기기가 된다.
     */
    const checkIns: CheckIn[] = [];
    const sessions: SessionLog[] = [];
    for (let i = 40; i >= 0; i -= 1) {
      const date = dayBefore(i);
      const overhead = i % 7 === 5 || i % 7 === 1;
      sessions.push(session(date, overhead ? ['barbell-overhead-press'] : ['lat-pulldown']));
      const yesterdayOverhead = (i + 1) % 7 === 5 || (i + 1) % 7 === 1;
      checkIns.push(checkIn(date, yesterdayOverhead ? [{ joint: 'shoulder', score: 5 }] : []));
    }
    const history = painHistory({ checkIns, sessions, index, today: TODAY });
    for (const item of history) {
      assert.doesNotMatch(item.summary, /원인|때문|진단|염|증후군/);
      if (item.referral) assert.doesNotMatch(item.referral, /원인|진단|염|증후군/);
    }
  });
});
