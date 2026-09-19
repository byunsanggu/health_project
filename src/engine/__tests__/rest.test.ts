import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { REST_MAX_SECONDS, REST_MIN_SECONDS, formatDuration, restFor } from '../rest.ts';
import { exerciseById } from '../exercises.ts';
import type { Exercise } from '../types.ts';

const bench = exerciseById('barbell-bench-press') as Exercise;
const deadlift = exerciseById('conventional-deadlift') as Exercise;
const pushdown = exerciseById('triceps-pushdown') as Exercise;
const plank = exerciseById('plank') as Exercise;

describe('restFor', () => {
  it('복합 동작이 고립 운동보다 오래 쉰다', () => {
    const compound = restFor({ exercise: bench, reps: 8, targetRir: 2 }).seconds;
    const isolation = restFor({ exercise: pushdown, reps: 12, targetRir: 2 }).seconds;
    assert.ok(compound > isolation);
  });

  it('반복이 적을수록(무거울수록) 오래 쉰다', () => {
    const heavy = restFor({ exercise: bench, reps: 5, targetRir: 2 }).seconds;
    const moderate = restFor({ exercise: bench, reps: 10, targetRir: 2 }).seconds;
    const light = restFor({ exercise: bench, reps: 15, targetRir: 2 }).seconds;
    assert.ok(heavy > moderate && moderate > light);
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

  it('현장 띠(1분~1분 30초)를 벗어나지 않는다', () => {
    /*
     * 1분 아래면 복합 동작에서 뒤 세트가 무너지고, 1분 30초를 넘기면
     * 세션이 늘어져서 지키지 않게 된다. 조건이 겹쳐도 넘지 않아야 한다.
     * (블록 배율은 이 값에 곱해져서 근력 2분대, 컨디셔닝 30초대가 된다.)
     */
    for (const exercise of [bench, deadlift, plank]) {
      for (const reps of [3, 5, 8, 12, 20]) {
        for (const targetRir of [0, 1, 2, 3]) {
          const { seconds } = restFor({ exercise, reps, targetRir });
          assert.ok(
            seconds >= REST_MIN_SECONDS && seconds <= REST_MAX_SECONDS,
            `${exercise.name} ${reps}회 RIR${targetRir} → ${seconds}초`,
          );
        }
      }
    }
  });

  it('허리 부담이 큰 종목은 더 쉰다', () => {
    const hinge = restFor({ exercise: deadlift, reps: 5, targetRir: 1 }).seconds;
    const press = restFor({ exercise: bench, reps: 5, targetRir: 1 }).seconds;
    assert.ok(hinge > press);
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
