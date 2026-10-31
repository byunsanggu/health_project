import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { BIG_LIFT_REST_SECONDS, HEAVY_COMPOUND_REST_SECONDS, MAX_DEFAULT_REST_SECONDS, REST_MAX_SECONDS, REST_MIN_SECONDS, describeBand, formatDuration, normalizeBand, restFor } from '../rest.ts';
import { exerciseById } from '../exercises.ts';
import type { Exercise } from '../types.ts';

const bench = exerciseById('barbell-bench-press') as Exercise;
const deadlift = exerciseById('conventional-deadlift') as Exercise;
const pushdown = exerciseById('triceps-pushdown') as Exercise;
const plank = exerciseById('plank') as Exercise;
const pulldown = exerciseById('lat-pulldown') as Exercise;

describe('restFor', () => {
  it('복합 동작이 고립 운동보다 오래 쉰다', () => {
    const compound = restFor({ exercise: bench, reps: 8, targetRir: 2 }).seconds;
    const isolation = restFor({ exercise: pushdown, reps: 12, targetRir: 2 }).seconds;
    assert.ok(compound > isolation);
  });

  it('종목 종류로 정한다 — 같은 스쿼트가 날마다 70초 · 120초를 오가지 않는다', () => {
    const heavy = restFor({ exercise: bench, reps: 5, targetRir: 2 }).seconds;
    const moderate = restFor({ exercise: bench, reps: 10, targetRir: 2 }).seconds;
    assert.equal(heavy, moderate);
    // 큰 바벨 동작이 아닌 복합 동작은 고반복(13회+)만 짧다
    assert.ok(restFor({ exercise: pulldown, reps: 15, targetRir: 2 }).seconds < restFor({ exercise: pulldown, reps: 10, targetRir: 2 }).seconds);
  });

  it('실패에 가까운 세트는 더 쉰다', () => {
    /*
     * 얼마나 더 쉬는지는 띠 안에서 조정되는 값이라 숫자로 못 박지 않는다.
     * 지켜야 하는 건 "더 쉰다"는 방향이다.
     */
    const near = restFor({ exercise: bench, reps: 8, targetRir: 0 }).seconds;
    const easy = restFor({ exercise: bench, reps: 8, targetRir: 3 }).seconds;
    assert.ok(near > easy, `${near} > ${easy}`);
  });

  it('복합 동작은 2분부터(큰 바벨 동작 2분 30초, 최대 3분), 고립 · 코어는 1분~1분 30초', () => {
    for (const reps of [3, 5, 8, 12, 20]) {
      for (const targetRir of [0, 1, 2, 3]) {
        for (const exercise of [bench, deadlift]) {
          const { seconds } = restFor({ exercise, reps, targetRir });
          assert.ok(seconds >= BIG_LIFT_REST_SECONDS && seconds <= MAX_DEFAULT_REST_SECONDS, `${exercise.name} ${reps}회 RIR${targetRir} → ${seconds}초`);
        }
        const pull = restFor({ exercise: pulldown, reps, targetRir }).seconds;
        assert.ok(pull >= (reps > 12 ? 90 : HEAVY_COMPOUND_REST_SECONDS) && pull <= MAX_DEFAULT_REST_SECONDS, `랫풀다운 ${reps}회 → ${pull}초`);
        for (const exercise of [plank, pushdown]) {
          const { seconds } = restFor({ exercise, reps, targetRir });
          assert.ok(seconds >= REST_MIN_SECONDS && seconds <= REST_MAX_SECONDS, `${exercise.name} ${reps}회 → ${seconds}초`);
        }
      }
    }
  });

  it('"보통" 띠를 고른 것은 고르지 않은 것과 같다', () => {
    assert.equal(restFor({ exercise: bench, reps: 8, targetRir: 2, band: { minSeconds: 60, maxSeconds: 90 } }).seconds,
      restFor({ exercise: bench, reps: 8, targetRir: 2 }).seconds);
  });

  it('블록 유형 배수를 곱한다 — 근력 블록이면 실제 타이머도 길어진다', () => {
    const base = restFor({ exercise: bench, reps: 5, targetRir: 2 }).seconds;
    assert.equal(restFor({ exercise: bench, reps: 5, targetRir: 2, multiplier: 1.5 }).seconds, base * 1.5);
    assert.equal(restFor({ exercise: bench, reps: 5, targetRir: 2, overrideSeconds: 100, multiplier: 1.5 }).seconds, 100, '직접 정한 값에는 안 곱한다');
  });

  it('큰 바벨 · 허리 부담 큰 동작은 다른 복합 동작보다 더 쉰다', () => {
    const hinge = restFor({ exercise: deadlift, reps: 5, targetRir: 2 }).seconds;
    const pull = restFor({ exercise: pulldown, reps: 8, targetRir: 2 }).seconds;
    assert.ok(hinge > pull, `${hinge} > ${pull}`);
  });

  it('코어 운동은 고립 운동과 같은 기준으로 본다', () => {
    assert.ok(restFor({ exercise: plank, reps: 12, targetRir: 3 }).seconds <= 90);
  });

  it('마지막 세트는 짧게 잡는다', () => {
    const middle = restFor({ exercise: bench, reps: 8, targetRir: 2 }).seconds;
    const last = restFor({ exercise: bench, reps: 8, targetRir: 2, isLastSet: true }).seconds;
    assert.ok(last < middle);
  });

  it('허용 범위와 이유를 함께 준다', () => {
    const result = restFor({ exercise: bench, reps: 5, targetRir: 1 });
    assert.ok(result.range.min < result.seconds && result.seconds < result.range.max);
    assert.ok(result.reason.length > 0);
  });
});

describe('formatDuration', () => {
  it('분:초로 보여준다', () => {
    assert.equal(formatDuration(90), '1:30');
    assert.equal(formatDuration(180), '3:00');
    assert.equal(formatDuration(5), '0:05');
  });

  it('음수는 0으로 막는다', () => {
    assert.equal(formatDuration(-10), '0:00');
  });
});

describe('휴식 띠 — 사용자가 정한다', () => {
  it('띠를 넓히면 휴식도 같이 늘어난다', () => {
    const normal = restFor({ exercise: bench, reps: 5, targetRir: 2 }).seconds;
    const long = restFor({
      exercise: bench, reps: 5, targetRir: 2,
      band: { minSeconds: 150, maxSeconds: 240 },
    }).seconds;
    assert.ok(long > normal, `${long} > ${normal}`);
    assert.ok(long >= 150 && long <= 240);
  });

  it('띠를 넓혀도 종목 사이 차이는 남는다', () => {
    /*
     * 이게 제일 중요하다. 절대 초를 계산하고 띠로 자르면 띠를 넓히는 순간
     * 고립이든 데드리프트든 전부 띠 아래끝에 붙어버린다 — 그러면 휴식을
     * 관리하는 게 아니라 안 하는 것이다.
     */
    const band = { minSeconds: 150, maxSeconds: 240 };
    const isolation = restFor({ exercise: pushdown, reps: 12, targetRir: 2, band }).seconds;
    const moderate = restFor({ exercise: bench, reps: 10, targetRir: 2, band }).seconds;
    const heavy = restFor({ exercise: deadlift, reps: 5, targetRir: 1, band }).seconds;
    assert.ok(isolation < moderate && moderate < heavy, `${isolation} < ${moderate} < ${heavy}`);
  });

  it('어떤 띠를 줘도 그 띠를 벗어나지 않는다', () => {
    for (const band of [
      { minSeconds: 45, maxSeconds: 75 },
      { minSeconds: 50, maxSeconds: 100 },
      { minSeconds: 150, maxSeconds: 240 },
      { minSeconds: 30, maxSeconds: 30 },
    ]) {
      for (const exercise of [bench, deadlift, plank, pushdown]) {
        for (const reps of [3, 8, 20]) {
          for (const targetRir of [0, 2, 3]) {
            const { seconds } = restFor({ exercise, reps, targetRir, band });
            assert.ok(
              seconds >= band.minSeconds && seconds <= band.maxSeconds,
              `${exercise.name} ${reps}회 RIR${targetRir} → ${seconds}초 (띠 ${band.minSeconds}~${band.maxSeconds})`,
            );
          }
        }
      }
    }
  });

  it('5초 단위로 떨어진다', () => {
    // 87초 같은 숫자는 아무도 지키지 않는다.
    for (const band of [{ minSeconds: 45, maxSeconds: 75 }, { minSeconds: 150, maxSeconds: 240 }]) {
      for (const reps of [5, 10, 15]) {
        assert.equal(restFor({ exercise: bench, reps, targetRir: 2, band }).seconds % 5, 0);
      }
    }
  });

  it('종목별로 직접 정하면 계산하지 않는다', () => {
    const fixed = restFor({ exercise: bench, reps: 8, targetRir: 2, overrideSeconds: 180 });
    assert.equal(fixed.seconds, 180);
    assert.match(fixed.reason, /직접/);
  });

  it('직접 정한 값은 띠보다 우선한다', () => {
    const fixed = restFor({
      exercise: bench, reps: 8, targetRir: 2,
      band: { minSeconds: 45, maxSeconds: 75 },
      overrideSeconds: 200,
    });
    assert.equal(fixed.seconds, 200);
  });

  it('뒤집힌 띠도 쓸 수 있게 고친다', () => {
    // 최소 3분, 최대 1분으로 쳐도 앱이 멈추면 안 된다.
    assert.deepEqual(
      normalizeBand({ minSeconds: 180, maxSeconds: 60 }),
      { minSeconds: 60, maxSeconds: 180 },
    );
  });

  it('말이 안 되는 값은 쓸 수 있는 범위로 줄인다', () => {
    const band = normalizeBand({ minSeconds: 0, maxSeconds: 99999 });
    assert.ok(band.minSeconds >= 20 && band.maxSeconds <= 600);
  });

  it('띠를 사람이 읽는 말로 준다', () => {
    assert.equal(describeBand({ minSeconds: 60, maxSeconds: 90 }), '1:00~1:30');
  });

  it('짧은 띠에서는 마지막 세트를 45초로 끌어올리지 않는다', () => {
    /*
     * 45초는 "기구를 옮기는 데 걸리는 시간"이라 둔 바닥인데, 그보다 짧게
     * 가겠다고 정한 사람의 뜻을 앱이 뒤집으면 안 된다.
     */
    const band = { minSeconds: 30, maxSeconds: 40 };
    const last = restFor({ exercise: pushdown, reps: 12, targetRir: 3, band, isLastSet: true }).seconds;
    assert.ok(last <= 40, String(last));
  });
});
