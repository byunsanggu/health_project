import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { FREEZE_AFTER, buildStreak, deloadTarget, weekDots } from '../streak.ts';
import type { SessionLog } from '../types.ts';

const day = (date: string): SessionLog =>
  ({
    id: date,
    date,
    updatedAt: date,
    sets: [{ exerciseId: 'barbell-bench-press', weightKg: 60, reps: 8, rir: 2, warmup: false }],
  }) as SessionLog;

/** 월요일부터 n일치. 주 target회를 지킨 주를 만든다. */
const keptWeek = (monday: string, count = 4): SessionLog[] => {
  const out: SessionLog[] = [];
  const base = Date.parse(monday + 'T00:00:00Z');
  for (let i = 0; i < count; i += 1) {
    out.push(day(new Date(base + i * 86400000).toISOString().slice(0, 10)));
  }
  return out;
};

const MONDAYS = ['2026-08-17', '2026-08-24', '2026-08-31', '2026-09-07', '2026-09-14'];
const fiveKept = MONDAYS.flatMap((monday) => keptWeek(monday));

describe('주 단위 약속', () => {
  it('날이 아니라 주를 센다', () => {
    /*
     * "며칠 연속"을 세면 불을 끄지 않으려고 쉬는 날 나온다. 회복이 안
     * 되면 안 자라고, 결국 다치거나 그만둔다. 쉬는 날은 약속에 이미
     * 들어 있으므로 쉬어도 불이 꺼지면 안 된다.
     */
    const streak = buildStreak({
      sessions: fiveKept,
      thisMonday: '2026-09-21',
      target: 4,
      today: '2026-09-22',
    });
    assert.equal(streak.current, 5);
  });

  it('하루에 두 번 기록해도 하루로 센다', () => {
    const twice = keptWeek('2026-09-14', 3).concat([day('2026-09-14')]);
    const streak = buildStreak({
      sessions: twice,
      thisMonday: '2026-09-14',
      target: 4,
      today: '2026-09-21',
    });
    assert.equal(streak.thisWeek.days, 3);
    assert.equal(streak.thisWeek.kept, false);
  });

  it('워밍업만 한 날은 나온 것으로 세지 않는다', () => {
    const warmupOnly: SessionLog = {
      id: 'w',
      date: '2026-09-14',
      updatedAt: '2026-09-14',
      sets: [{ exerciseId: 'barbell-bench-press', weightKg: 20, reps: 8, rir: 4, warmup: true }],
    } as SessionLog;
    const streak = buildStreak({
      sessions: [warmupOnly],
      thisMonday: '2026-09-14',
      target: 4,
      today: '2026-09-21',
    });
    assert.equal(streak.thisWeek.days, 0);
  });

  it('진행 중인 주는 연속을 끊지 않는다', () => {
    // 수요일에 0/4라고 불을 꺼 버리면 그 주를 포기하게 된다.
    const streak = buildStreak({
      sessions: fiveKept,
      thisMonday: '2026-09-21',
      target: 4,
      today: '2026-09-23',
    });
    assert.equal(streak.thisWeek.open, true);
    assert.equal(streak.current, 5);
  });
});

describe('쉼표', () => {
  it('넉 주 넘게 쌓은 사람은 한 주 놓쳐도 살린다', () => {
    /*
     * 다섯 주를 지킨 사람이 한 주 놓쳤다고 0으로 돌아가면 앱을 지우지,
     * 다음 주에 나오지 않는다.
     */
    const streak = buildStreak({
      sessions: fiveKept.filter((session) => session.date < '2026-09-14'),
      thisMonday: '2026-09-21',
      target: 4,
      today: '2026-09-22',
    });
    assert.equal(streak.freezeUsed, true);
    assert.equal(streak.current, 4);
    assert.match(streak.message, /쉬었습니다/);
  });

  it('살린 주를 연속에 더하지는 않는다', () => {
    // 안 한 주를 한 주로 세면 그건 거짓말이다.
    const streak = buildStreak({
      sessions: fiveKept.filter((session) => session.date < '2026-09-14'),
      thisMonday: '2026-09-21',
      target: 4,
      today: '2026-09-22',
    });
    assert.equal(streak.current, 4);
    assert.ok(streak.weeks.some((week) => week.forgiven));
  });

  it('덜 쌓은 사람에게는 주지 않는다', () => {
    // 처음부터 주면 약속이 약속이 아니게 된다.
    const streak = buildStreak({
      sessions: keptWeek('2026-09-07'),
      thisMonday: '2026-09-21',
      target: 4,
      today: '2026-09-22',
    });
    assert.equal(streak.freezeUsed, false);
    assert.equal(streak.current, 0);
  });

  it('두 주를 내리 빠지면 거기서 끊긴다', () => {
    const streak = buildStreak({
      sessions: fiveKept.filter((session) => session.date < '2026-09-07'),
      thisMonday: '2026-09-21',
      target: 4,
      today: '2026-09-22',
    });
    assert.equal(streak.current, 0);
  });

  it('기록이 시작되기 전의 주에는 쉼표를 쓰지 않는다', () => {
    /*
     * 앱을 깔기 전 주는 "안 한 주"가 아니라 "없는 주"다. 거기서 쉼표를
     * 써 버리면 정작 필요할 때 쉼표가 없다.
     */
    const streak = buildStreak({
      sessions: fiveKept,
      thisMonday: '2026-09-21',
      target: 4,
      today: '2026-09-22',
      lookbackWeeks: 26,
    });
    assert.equal(streak.freezeUsed, false);
    assert.equal(streak.freezeAvailable, true);
  });
});

describe('덜어내는 주', () => {
  it('디로드 주는 절반만 나와도 지킨 것이다', () => {
    // 디로드는 쉬는 주가 아니라 덜어내는 주다. 아예 안 나오면 습관이 끊긴다.
    assert.equal(deloadTarget(4), 2);
    assert.equal(deloadTarget(6), 3);
    assert.equal(deloadTarget(3), 2);

    const streak = buildStreak({
      sessions: fiveKept.concat(keptWeek('2026-09-21', 2)),
      thisMonday: '2026-09-21',
      target: 4,
      deloadWeeks: ['2026-09-21'],
      today: '2026-09-27',
    });
    assert.equal(streak.thisWeek.kept, true);
    assert.equal(streak.current, 6);
    assert.match(streak.message, /덜어내는 주/);
  });

  it('두 번 아래로는 내리지 않는다', () => {
    assert.equal(deloadTarget(2), 2);
    assert.equal(deloadTarget(1), 2);
  });
});

describe('화면에 쓸 말', () => {
  it('못 지킨 주에 혼내지 않는다', () => {
    // 혼나려고 앱을 여는 사람은 없다.
    const streak = buildStreak({
      sessions: [],
      thisMonday: '2026-09-21',
      target: 4,
      today: '2026-09-22',
    });
    assert.doesNotMatch(streak.message, /실패|못했|안 했|놓쳤/);
  });

  it('남은 횟수를 말해 준다', () => {
    const streak = buildStreak({
      sessions: keptWeek('2026-09-21', 3),
      thisMonday: '2026-09-21',
      target: 4,
      today: '2026-09-24',
    });
    assert.match(streak.message, /한 번만 더/);
  });

  it('점으로 이번 주를 그린다', () => {
    const streak = buildStreak({
      sessions: keptWeek('2026-09-21', 2),
      thisMonday: '2026-09-21',
      target: 4,
      today: '2026-09-23',
    });
    assert.deepEqual(weekDots(streak.thisWeek), { done: 2, left: 2 });
  });

  it('약속보다 많이 해도 점이 넘치지 않는다', () => {
    const streak = buildStreak({
      sessions: keptWeek('2026-09-21', 6),
      thisMonday: '2026-09-21',
      target: 4,
      today: '2026-09-27',
    });
    assert.deepEqual(weekDots(streak.thisWeek), { done: 4, left: 0 });
  });
});

describe('최고 기록', () => {
  it('쉼표 없이 순수하게 센다', () => {
    const streak = buildStreak({
      sessions: fiveKept,
      thisMonday: '2026-09-21',
      target: 4,
      today: '2026-09-22',
    });
    assert.equal(streak.best, 5);
    assert.ok(streak.best >= streak.current);
  });

  it('쉼표를 쓴 구간은 최고 기록으로 치지 않는다', () => {
    const gapped = fiveKept.filter((session) => session.date < '2026-09-14');
    const streak = buildStreak({
      sessions: gapped,
      thisMonday: '2026-09-21',
      target: 4,
      today: '2026-09-22',
    });
    assert.equal(streak.best, 4);
  });
});

describe('쉼표 기준', () => {
  it('넉 주다', () => {
    assert.equal(FREEZE_AFTER, 4);
  });
});
