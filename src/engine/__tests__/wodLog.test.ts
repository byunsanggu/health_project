import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  compareWod, describeScore, historyOf, lowerIsBetter,
  recordWod, scoreKindOf, wodSignature,
} from '../wodLog.ts';
import { buildConditioning } from '../conditioning.ts';
import { presetEquipment } from '../gymPresets.ts';
import type { ConditioningWorkout } from '../conditioning.ts';

const gym = presetEquipment('franchise');
const make = (format: 'forTime' | 'amrap' | 'emom', minutes = 12): ConditioningWorkout =>
  buildConditioning({ format, minutes, level: 'intermediate', equipmentIds: gym });

describe('와드 기록 형식', () => {
  it('형식마다 남기는 것이 다르다', () => {
    assert.equal(scoreKindOf('forTime'), 'time');
    assert.equal(scoreKindOf('amrap'), 'rounds');
    assert.equal(scoreKindOf('circuit'), 'rounds');
    assert.equal(scoreKindOf('emom'), 'completion');
    assert.equal(scoreKindOf('intervals'), 'completion');
  });

  it('For Time만 낮을수록 좋다', () => {
    assert.equal(lowerIsBetter('forTime'), true);
    assert.equal(lowerIsBetter('amrap'), false);
    assert.equal(lowerIsBetter('emom'), false);
  });

  it('형식에 안 맞는 값은 담지 않는다', () => {
    // For Time에 라운드 수가 남아 있으면 비교가 엉킨다.
    const result = recordWod(make('forTime'), '2026-09-25', { seconds: 600, rounds: 5 });
    assert.equal(result.seconds, 600);
    assert.equal(result.rounds, undefined);
  });

  it('읽는 말로 바꾼다', () => {
    const forTime = recordWod(make('forTime'), '2026-09-25', { seconds: 655 });
    assert.equal(describeScore(forTime), '10:55');

    const amrap = recordWod(make('amrap'), '2026-09-25', { rounds: 5, extraReps: 8 });
    assert.equal(describeScore(amrap), '5라운드 + 8회');

    const done = recordWod(make('emom'), '2026-09-25', { completed: true });
    assert.equal(describeScore(done), '완주');

    const quit = recordWod(make('emom'), '2026-09-25', { completed: false, stoppedAtMinute: 7 });
    assert.equal(describeScore(quit), '7분에서 중단');
  });
});

describe('같은 와드 가리기', () => {
  it('구성이 같으면 같은 열쇠', () => {
    assert.equal(wodSignature(make('forTime')), wodSignature(make('forTime')));
  });

  it('길이가 다르면 다른 와드', () => {
    assert.notEqual(wodSignature(make('amrap', 12)), wodSignature(make('amrap', 20)));
  });

  it('형식이 다르면 다른 와드', () => {
    assert.notEqual(wodSignature(make('forTime')), wodSignature(make('amrap')));
  });

  it('동작 순서가 바뀌어도 같은 와드', () => {
    // 순서는 기록에 영향을 주지 않는다.
    const base = make('forTime');
    const shuffled = { ...base, movements: [...base.movements].reverse() };
    assert.equal(wodSignature(base), wodSignature(shuffled));
  });

  it('동작 하나만 달라도 다른 와드', () => {
    const base = make('forTime');
    const changed = {
      ...base,
      movements: [{ ...base.movements[0]!, amount: base.movements[0]!.amount + 1 }, ...base.movements.slice(1)],
    };
    assert.notEqual(wodSignature(base), wodSignature(changed));
  });
});

describe('와드 비교', () => {
  const workout = make('forTime');

  it('처음이면 비교하지 않는다', () => {
    const only = recordWod(workout, '2026-09-25', { seconds: 700 });
    const comparison = compareWod(only, []);
    assert.equal(comparison.previous, undefined);
    assert.equal(comparison.attempts, 1);
    assert.match(comparison.text, /처음입니다/);
  });

  it('구성이 다르면 비교하지 않는다', () => {
    /*
     * 이게 제일 중요하다. 지난주 12분 AMRAP과 이번 주 12분 AMRAP은 동작이
     * 달라서 라운드 수를 비교하면 아무 의미가 없다. "지난주보다 2분
     * 빨랐다"가 사실이 아니면 말하지 않는 게 낫다.
     */
    const past = recordWod(make('amrap'), '2026-09-18', { rounds: 9 });
    const now = recordWod(workout, '2026-09-25', { seconds: 700 });
    const comparison = compareWod(now, [past]);
    assert.equal(comparison.previous, undefined);
    assert.match(comparison.text, /처음입니다/);
  });

  it('For Time은 빨라지면 나아진 것', () => {
    const before = recordWod(workout, '2026-09-18', { seconds: 700 });
    const now = recordWod(workout, '2026-09-25', { seconds: 655 });
    const comparison = compareWod(now, [before]);
    assert.equal(comparison.trend, 'better');
    assert.match(comparison.text, /나아졌습니다/);
  });

  it('AMRAP은 라운드가 늘면 나아진 것', () => {
    const amrap = make('amrap');
    const before = recordWod(amrap, '2026-09-18', { rounds: 5, extraReps: 8 });
    const now = recordWod(amrap, '2026-09-25', { rounds: 6 });
    assert.equal(compareWod(now, [before]).trend, 'better');
  });

  it('추가 반복까지 센다', () => {
    // 5라운드 + 8회가 5라운드보다 낫다.
    const amrap = make('amrap');
    const before = recordWod(amrap, '2026-09-18', { rounds: 5 });
    const now = recordWod(amrap, '2026-09-25', { rounds: 5, extraReps: 8 });
    assert.equal(compareWod(now, [before]).trend, 'better');
  });

  it('EMOM은 완주가 중단보다 낫다', () => {
    const emom = make('emom', 10);
    const before = recordWod(emom, '2026-09-18', { completed: false, stoppedAtMinute: 7 });
    const now = recordWod(emom, '2026-09-25', { completed: true });
    assert.equal(compareWod(now, [before]).trend, 'better');
  });

  it('못했으면 못했다고 말한다', () => {
    // 내려간 날을 감추면 올라간 날도 못 믿는다.
    const before = recordWod(workout, '2026-09-18', { seconds: 600 });
    const now = recordWod(workout, '2026-09-25', { seconds: 660 });
    const comparison = compareWod(now, [before]);
    assert.equal(comparison.trend, 'worse');
    assert.match(comparison.text, /못했습니다/);
    assert.equal(/최고 기록/.test(comparison.text), false);
  });

  it('최고 기록이면 알린다', () => {
    const a = recordWod(workout, '2026-09-04', { seconds: 700 });
    const b = recordWod(workout, '2026-09-18', { seconds: 680 });
    const now = recordWod(workout, '2026-09-25', { seconds: 640 });
    const comparison = compareWod(now, [a, b]);
    assert.match(comparison.text, /최고 기록/);
    assert.equal(comparison.attempts, 3);
  });

  it('최고가 아니면 최고라고 하지 않는다', () => {
    const best = recordWod(workout, '2026-09-04', { seconds: 600 });
    const before = recordWod(workout, '2026-09-18', { seconds: 700 });
    const now = recordWod(workout, '2026-09-25', { seconds: 660 });
    const comparison = compareWod(now, [best, before]);
    assert.equal(comparison.trend, 'better', '지난번보다는 나아졌다');
    assert.equal(/최고 기록/.test(comparison.text), false);
    assert.equal(comparison.best?.date, '2026-09-04');
  });

  it('바로 직전 기록과 비교한다', () => {
    const old1 = recordWod(workout, '2026-09-04', { seconds: 900 });
    const recent = recordWod(workout, '2026-09-18', { seconds: 650 });
    const now = recordWod(workout, '2026-09-25', { seconds: 700 });
    assert.equal(compareWod(now, [old1, recent]).previous?.date, '2026-09-18');
  });

  it('미래 기록은 보지 않는다', () => {
    const later = recordWod(workout, '2026-10-02', { seconds: 500 });
    const now = recordWod(workout, '2026-09-25', { seconds: 700 });
    assert.equal(compareWod(now, [later]).previous, undefined);
  });
});

describe('같은 구성 이력', () => {
  it('최근순으로 준다', () => {
    const workout = make('forTime');
    const a = recordWod(workout, '2026-09-04', { seconds: 900 });
    const b = recordWod(workout, '2026-09-18', { seconds: 650 });
    const other = recordWod(make('amrap'), '2026-09-20', { rounds: 5 });
    const list = historyOf([a, other, b], wodSignature(workout));
    assert.deepEqual(list.map((result) => result.date), ['2026-09-18', '2026-09-04']);
  });
});
