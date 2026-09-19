import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  MEANINGFUL_KG,
  RELIABLE_REPS,
  biggestGain,
  compareToPast,
  describeComparison,
  directionOf,
  monthLine,
  summarizeComparison,
} from '../comparison.ts';
import { EXERCISES } from '../exercises.ts';
import type { SessionLog, SetLog } from '../types.ts';

const index = new Map(EXERCISES.map((exercise) => [exercise.id, exercise]));

function session(date: string, rows: [string, number, number, number][]): SessionLog {
  return {
    date,
    sets: rows.map(([exerciseId, weightKg, reps, rir]) => ({ exerciseId, weightKg, reps, rir })),
  } as SessionLog;
}

const SQUAT = 'back-squat';
const TODAY = '2026-09-19';

describe('지난번과 비교', () => {
  it('오늘 한 종목만 나온다', () => {
    // 끝난 자리에서 오늘 안 한 종목의 숫자를 보여줄 이유가 없다.
    const rows = compareToPast({
      todaySets: [{ exerciseId: SQUAT, weightKg: 100, reps: 8, rir: 2 }] as SetLog[],
      today: TODAY,
      history: [session('2026-09-12', [[SQUAT, 95, 8, 2], ['barbell-curl', 30, 10, 2]])],
      index,
    });
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.exerciseId, SQUAT);
  });

  it('가장 최근 기록을 "지난번"으로 본다', () => {
    const rows = compareToPast({
      todaySets: [{ exerciseId: SQUAT, weightKg: 100, reps: 8, rir: 2 }] as SetLog[],
      today: TODAY,
      history: [
        session('2026-09-05', [[SQUAT, 90, 8, 2]]),
        session('2026-09-16', [[SQUAT, 95, 8, 2]]),
      ],
      index,
    });
    assert.equal(rows[0]!.previous?.date, '2026-09-16');
    assert.equal(rows[0]!.previous?.daysAgo, 3);
  });

  it('그 세션의 최고 세트만 쓴다', () => {
    // 뒤 세트는 피로가 섞여 있어 능력의 변화가 아니다.
    const rows = compareToPast({
      todaySets: [
        { exerciseId: SQUAT, weightKg: 100, reps: 8, rir: 2 },
        { exerciseId: SQUAT, weightKg: 100, reps: 5, rir: 0 },
      ] as SetLog[],
      today: TODAY,
      history: [session('2026-09-12', [[SQUAT, 95, 8, 2]])],
      index,
    });
    assert.equal(rows[0]!.today.set.reps, 8);
  });

  it('워밍업은 세지 않는다', () => {
    const rows = compareToPast({
      todaySets: [
        { exerciseId: SQUAT, weightKg: 40, reps: 10, rir: 5, warmup: true },
        { exerciseId: SQUAT, weightKg: 100, reps: 8, rir: 2 },
      ] as SetLog[],
      today: TODAY,
      history: [session('2026-09-12', [[SQUAT, 95, 8, 2]])],
      index,
    });
    assert.equal(rows[0]!.today.set.weightKg, 100);
  });

  it('한 달 창(21~35일) 밖이면 한 달 기록으로 안 쓴다', () => {
    /*
     * 두 달 전 기록을 "한 달 전"이라고 부르면 그건 거짓말이다.
     * 정확히 28일 전에 그 종목을 했을 확률은 낮으므로 창을 둔다.
     */
    const rows = compareToPast({
      todaySets: [{ exerciseId: SQUAT, weightKg: 100, reps: 8, rir: 2 }] as SetLog[],
      today: TODAY,
      history: [
        session('2026-09-12', [[SQUAT, 95, 8, 2]]),
        session('2026-07-01', [[SQUAT, 80, 8, 2]]),
      ],
      index,
    });
    assert.equal(rows[0]!.monthAgo, undefined);
    assert.match(describeComparison(rows[0]!, 'month'), /기록이 없습니다/);
  });

  it('처음 하는 종목은 없는 비교를 지어내지 않는다', () => {
    const rows = compareToPast({
      todaySets: [{ exerciseId: SQUAT, weightKg: 100, reps: 8, rir: 2 }] as SetLog[],
      today: TODAY,
      history: [],
      index,
    });
    assert.equal(rows[0]!.deltaPrevious, undefined);
    assert.match(describeComparison(rows[0]!, 'previous'), /오늘이 처음/);
  });

  it('작은 흔들림은 "늘었다"고 하지 않는다', () => {
    /*
     * 추정 1RM은 RIR 신고에 따라 1~2kg은 쉽게 흔들린다. 그 안의 변화를
     * 성장이라 부르면 매주 늘었다고 말하게 되고 아무도 안 믿는다.
     */
    assert.equal(directionOf(MEANINGFUL_KG - 0.1), 'same');
    assert.equal(directionOf(MEANINGFUL_KG), 'up');
    assert.equal(directionOf(-MEANINGFUL_KG), 'down');
    assert.equal(directionOf(undefined), 'same');
  });

  it('무게가 같으면 환산을 꺼내지 않고 반복으로 말한다', () => {
    // "1회 더 했다"가 사실 그대로이고 훨씬 잘 읽힌다.
    const rows = compareToPast({
      todaySets: [{ exerciseId: SQUAT, weightKg: 100, reps: 9, rir: 2 }] as SetLog[],
      today: TODAY,
      history: [session('2026-09-12', [[SQUAT, 100, 8, 2]])],
      index,
    });
    const line = describeComparison(rows[0]!, 'previous');
    assert.match(line, /같은 무게로 1회 더/);
    assert.equal(/환산/.test(line), false);
  });

  it('같은 무게·반복인데 RIR이 나빠지면 더 힘들었다고 말한다', () => {
    const rows = compareToPast({
      todaySets: [{ exerciseId: SQUAT, weightKg: 100, reps: 8, rir: 0 }] as SetLog[],
      today: TODAY,
      history: [session('2026-09-12', [[SQUAT, 100, 8, 3]])],
      index,
    });
    assert.match(describeComparison(rows[0]!, 'previous'), /더 힘들었습니다/);
  });

  it('고반복은 환산을 믿지 않는다고 표시한다', () => {
    /*
     * 102.5kg 14회(RIR 0)와 15회(RIR 2)의 환산 차이는 13.7kg이지만,
     * 실제로 달라진 건 한 번 더 했다는 것뿐이다.
     */
    const rows = compareToPast({
      todaySets: [{ exerciseId: SQUAT, weightKg: 102.5, reps: 15, rir: 2 }] as SetLog[],
      today: TODAY,
      history: [session('2026-09-12', [[SQUAT, 100, 14, 0]])],
      index,
    });
    assert.equal(rows[0]!.reliable, false);
    assert.match(describeComparison(rows[0]!, 'previous'), /환산이 정확하지 않습니다/);
  });

  it('유효 반복이 기준 이하면 환산을 믿는다', () => {
    const rows = compareToPast({
      todaySets: [{ exerciseId: SQUAT, weightKg: 100, reps: RELIABLE_REPS - 2, rir: 2 }] as SetLog[],
      today: TODAY,
      history: [session('2026-09-12', [[SQUAT, 95, RELIABLE_REPS - 2, 2]])],
      index,
    });
    assert.equal(rows[0]!.reliable, true);
  });

  it('고반복이면 한 달 문장에서 kg를 단정하지 않는다', () => {
    const rows = compareToPast({
      todaySets: [{ exerciseId: SQUAT, weightKg: 102.5, reps: 15, rir: 2 }] as SetLog[],
      today: TODAY,
      history: [session('2026-08-29', [[SQUAT, 102.5, 14, 0]])],
      index,
    });
    const line = monthLine(rows[0]!);
    assert.match(line, /같은 무게로 1회 더/);
    assert.equal(/kg 늘었습니다/.test(line), false);
  });

  it('내려간 종목을 감추지 않는다', () => {
    // 내려간 날을 감추면 올라간 날도 못 믿게 된다.
    const rows = compareToPast({
      todaySets: [
        { exerciseId: SQUAT, weightKg: 80, reps: 8, rir: 2 },
        { exerciseId: 'barbell-bench-press', weightKg: 90, reps: 8, rir: 2 },
      ] as SetLog[],
      today: TODAY,
      history: [session('2026-09-12', [[SQUAT, 100, 8, 2], ['barbell-bench-press', 70, 8, 2]])],
      index,
    });
    const rollup = summarizeComparison(rows);
    assert.equal(rollup.up, 1);
    assert.equal(rollup.down, 1);
    assert.match(rollup.headline, /내려갔습니다/);
  });

  it('많이 오른 것부터 보여준다', () => {
    const rows = compareToPast({
      todaySets: [
        { exerciseId: SQUAT, weightKg: 102.5, reps: 8, rir: 2 },
        { exerciseId: 'barbell-bench-press', weightKg: 90, reps: 8, rir: 2 },
      ] as SetLog[],
      today: TODAY,
      history: [session('2026-09-12', [[SQUAT, 100, 8, 2], ['barbell-bench-press', 70, 8, 2]])],
      index,
    });
    assert.equal(rows[0]!.exerciseId, 'barbell-bench-press');
    assert.equal(biggestGain(rows)?.exerciseId, 'barbell-bench-press');
  });

  it('오른 게 없으면 최고 상승을 지어내지 않는다', () => {
    const rows = compareToPast({
      todaySets: [{ exerciseId: SQUAT, weightKg: 100, reps: 8, rir: 2 }] as SetLog[],
      today: TODAY,
      history: [session('2026-09-12', [[SQUAT, 100, 8, 2]])],
      index,
    });
    assert.equal(biggestGain(rows), undefined);
  });

  it('조사가 이름에 맞는다', () => {
    const rows = compareToPast({
      todaySets: [{ exerciseId: SQUAT, weightKg: 110, reps: 8, rir: 2 }] as SetLog[],
      today: TODAY,
      history: [session('2026-08-25', [[SQUAT, 100, 8, 2]])],
      index,
    });
    // "백 스쿼트는" — 받침 없는 이름
    assert.match(monthLine(rows[0]!), /백 스쿼트는/);
  });
});
