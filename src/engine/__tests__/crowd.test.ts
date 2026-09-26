import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { MIN_PEOPLE, SIGNAL_RATE, crowdSignals, memberNote, type SkipReport } from '../crowd.ts';
import { EXERCISES } from '../exercises.ts';

const index = new Map(EXERCISES.map((exercise) => [exercise.id, exercise]));
const ROW = 'barbell-row';
const DEAD = 'conventional-deadlift';

const reports = (exerciseId: string, reason: SkipReport['reason'], n: number): SkipReport[] =>
  Array.from({ length: n }, () => ({ exerciseId, reason }));

const run = (list: SkipReport[], people: number) =>
  crowdSignals({ reports: list, people, index });

describe('사람이 적으면 말하지 않는다', () => {
  it('둘 중 둘을 100%라고 하지 않는다', () => {
    /*
     * 그 숫자는 거짓말이다. 한 사람이 바뀔 때마다 비율이 50%씩 튀는
     * 구간에서는 어떤 말도 하면 안 된다.
     */
    assert.equal(run(reports(ROW, 'dislike', 2), 2).length, 0);
    assert.equal(run(reports(ROW, 'dislike', MIN_PEOPLE), MIN_PEOPLE).length, 1);
  });
});

describe('아파서 뺀 것은 세지 않는다', () => {
  it('건강 정보는 집계에 안 들어간다', () => {
    /*
     * 익명으로 모아도 "이 헬스장 사람들이 허리가 아프다"는 말이 만들어진다.
     * 그건 우리가 만들어도 되는 말이 아니다(민감정보).
     */
    assert.equal(run(reports(DEAD, 'pain', 10), 10).length, 0);
  });

  it('섞여 들어와도 아픈 것만 빠진다', () => {
    const mixed = [...reports(ROW, 'pain', 6), ...reports(ROW, 'dislike', 6)];
    const signals = run(mixed, 10);
    assert.equal(signals.length, 1);
    assert.equal(signals[0]?.count, 6);   // 12가 아니다
    assert.equal(signals[0]?.kind, 'dislike');
  });
});

describe('기구 없음과 그냥 싫음을 나눈다', () => {
  it('합쳐서 세지 않는다', () => {
    /*
     * 뜻이 다르다. 앞엣것은 기구를 사야 한다는 사실이고 뒤엣것은 뭔가
     * 불편하다는 짐작이다. 합치면 관장이 뭘 해야 할지 알 수 없다.
     */
    const mixed = [...reports(ROW, 'noEquipment', 4), ...reports(ROW, 'dislike', 4)];
    // 각각 4/10 = 40%라 둘 다 기준(50%)에 못 미친다 — 합쳤으면 80%로 떴을 것이다.
    assert.equal(run(mixed, 10).length, 0);
  });

  it('기구 없음은 기구 목록을 의심하라고 말한다', () => {
    const signals = run(reports(ROW, 'noEquipment', 6), 10);
    assert.equal(signals[0]?.kind, 'equipment');
    assert.match(signals[0]?.text ?? '', /기구 목록/);
  });
});

describe('절반은 넘어야 신호다', () => {
  it('취향이 갈리는 정상 범위는 말하지 않는다', () => {
    // 어느 헬스장에서든 데드를 싫어하는 사람은 서넛 중 하나쯤 있다.
    assert.equal(SIGNAL_RATE, 0.5);
    assert.equal(run(reports(DEAD, 'dislike', 4), 10).length, 0);
    assert.equal(run(reports(DEAD, 'dislike', 5), 10).length, 1);
  });

  it('많이 빠진 것부터 준다', () => {
    const signals = run([...reports(ROW, 'dislike', 9), ...reports(DEAD, 'dislike', 6)], 10);
    assert.deepEqual(signals.map((s) => s.exerciseId), [ROW, DEAD]);
  });
});

describe('원인을 단정하지 않는다', () => {
  it('짐작을 사실처럼 말하지 않는다', () => {
    /*
     * 우리가 아는 건 사람들이 뺐다는 사실뿐이다. 바가 휘었는지는 가 봐야
     * 안다. 단정하면 관장이 멀쩡한 기구를 버린다.
     */
    for (const signal of run(reports(ROW, 'dislike', 8), 10)) {
      assert.doesNotMatch(signal.text, /때문|원인|고장|휘었/);
      assert.match(signal.text, /보실 만합니다|있습니다/);
    }
  });

  it('조사를 규칙대로 붙인다', () => {
    for (const exercise of EXERCISES.slice(0, 30)) {
      for (const signal of run(reports(exercise.id, 'dislike', 8), 10)) {
        assert.doesNotMatch(signal.text, /을\(를\)|를을|을를/, exercise.name);
      }
    }
  });
});

describe('회원에게는 다르게 말한다', () => {
  it('"남들이 싫어한다"를 회원에게 보여주지 않는다', () => {
    /*
     * 회원에게 그 말은 "하지 말라"로 읽힌다. 우리는 그런 말을 할 자격이
     * 없다 — 그 사람에게는 그 종목이 필요할 수 있다.
     */
    const [dislike] = run(reports(ROW, 'dislike', 8), 10);
    assert.equal(memberNote(dislike!), undefined);

    const [missing] = run(reports(ROW, 'noEquipment', 8), 10);
    assert.match(memberNote(missing!) ?? '', /없으면/);
  });
});

describe('자동으로 빼지 않는다', () => {
  it('신호는 목록일 뿐 제외가 아니다', () => {
    /*
     * 남들이 싫어한다고 내 프로그램에서 종목이 사라지면 그건 내
     * 프로그램이 아니다. crowdSignals는 무엇도 바꾸지 않는다.
     */
    const list = reports(ROW, 'dislike', 10);
    const before = JSON.stringify(list);
    run(list, 10);
    assert.equal(JSON.stringify(list), before);
  });
});
