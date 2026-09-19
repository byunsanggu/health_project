import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { exerciseById } from '../exercises.ts';
import { describeGymWeight, isGymSpecific, weightHistoryFor } from '../gymWeight.ts';
import type { SessionLog } from '../types.ts';

const squat = exerciseById('back-squat')!;
const legPress = exerciseById('leg-press')!;
const pulldown = exerciseById('lat-pulldown')!;
const dumbbellPress = exerciseById('dumbbell-bench-press')!;

const history: SessionLog[] = [
  {
    date: '2026-09-01', gymId: 'A',
    sets: [
      { exerciseId: 'back-squat', weightKg: 100, reps: 8, rir: 2 },
      { exerciseId: 'leg-press', weightKg: 200, reps: 12, rir: 2 },
    ],
  },
  {
    date: '2026-09-08', gymId: 'B',
    sets: [{ exerciseId: 'back-squat', weightKg: 105, reps: 8, rir: 2 }],
  },
];

describe('isGymSpecific', () => {
  it('머신·케이블·스미스는 헬스장마다 다르다', () => {
    assert.equal(isGymSpecific(legPress), true);
    assert.equal(isGymSpecific(pulldown), true);
  });

  it('바벨·덤벨은 어디서나 같다', () => {
    assert.equal(isGymSpecific(squat), false);
    assert.equal(isGymSpecific(dumbbellPress), false);
  });
});

describe('weightHistoryFor', () => {
  it('바벨은 헬스장을 가리지 않는다 — 100kg은 어디서나 100kg이다', () => {
    assert.equal(weightHistoryFor(history, squat, { gymId: 'B' }).length, 2);
  });

  it('머신은 같은 헬스장 기록만 본다', () => {
    const atA = weightHistoryFor(history, legPress, { gymId: 'A' });
    assert.equal(atA.length, 1);
    assert.equal(atA[0]!.gymId, 'A');
  });

  it('다른 헬스장의 머신 기록은 보이지 않는다 — 처방 쪽에서 첫 수행으로 본다', () => {
    // A짐 레그프레스 200kg을 B짐에서 그대로 쓰면 엉뚱한 무게가 된다
    const atB = weightHistoryFor(history, legPress, { gymId: 'B' });
    const hasLegPress = atB.some((session) =>
      session.sets.some((set) => set.exerciseId === 'leg-press'),
    );
    assert.equal(hasLegPress, false);
  });

  it('헬스장을 모르면 전부 본다', () => {
    assert.equal(weightHistoryFor(history, legPress, {}).length, 2);
  });

  it('anyGym이면 머신도 전부 본다 — 볼륨 집계에는 헬스장이 상관없다', () => {
    assert.equal(weightHistoryFor(history, legPress, { gymId: 'B', anyGym: true }).length, 2);
  });
});

describe('describeGymWeight', () => {
  it('처음 쓰는 기계면 알려준다', () => {
    const note = describeGymWeight(history, legPress, 'B');
    assert.equal(note.known, false);
    assert.equal(note.knownElsewhere, true);
    assert.match(note.note!, /기계마다/);
  });

  it('해본 기계면 조용하다', () => {
    const note = describeGymWeight(history, legPress, 'A');
    assert.equal(note.known, true);
    assert.equal(note.note, undefined);
  });

  it('바벨은 헬스장이 바뀌어도 말하지 않는다', () => {
    assert.equal(describeGymWeight(history, squat, 'B').note, undefined);
  });

  it('어느 헬스장인지 모르면 경고하지 않는다 — 이력을 거르지도 않았다', () => {
    // 전체 이력을 쓰면서 "처음 쓰는 기계"라고 하면 앞뒤가 안 맞는다
    assert.equal(describeGymWeight(history, legPress, undefined).note, undefined);
  });

  it('아무 데서도 해본 적 없으면 별도 안내를 하지 않는다 — 첫 수행 안내가 따로 있다', () => {
    const note = describeGymWeight(history, exerciseById('pec-deck')!, 'A');
    assert.equal(note.known, false);
    assert.equal(note.knownElsewhere, false);
    assert.equal(note.note, undefined);
  });
});
