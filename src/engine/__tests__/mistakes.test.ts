import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { MISTAKES, mistakeToWatch, mistakesFor } from '../mistakes.ts';
import { EXERCISES, exerciseById } from '../exercises.ts';
import { beforeSetLines, formCueLine, speechSeconds, watchLine } from '../coach.ts';

const squat = exerciseById('back-squat')!;

describe('흔한 실수 목록', () => {
  it('목록의 종목은 모두 실제 종목이다', () => {
    for (const id of Object.keys(MISTAKES)) assert.ok(exerciseById(id), id);
  });

  it('모든 종목에 짚을 실수가 하나 이상 있다', () => {
    for (const exercise of EXERCISES) assert.ok(mistakesFor(exercise).length > 0, exercise.name);
  });

  it('한 종목 안에서 같은 실수가 두 번 나오지 않는다', () => {
    for (const [id, list] of Object.entries(MISTAKES)) {
      assert.equal(new Set(list.map((item) => item.id)).size, list.length, id);
    }
  });

  it('고치는 말은 존댓말 "~세요"로 끝나고 문장부호는 붙이지 않는다', () => {
    for (const exercise of EXERCISES) {
      for (const item of mistakesFor(exercise)) {
        assert.match(item.cue, /세요$/, `${exercise.name}: ${item.cue}`);
        assert.doesNotMatch(item.short, /[.!?]$/, item.short);
        assert.ok(item.sign.length > 0 && item.why.length > 0);
      }
    }
  });

  it('세트 중 짧은 말은 숫자 사이에 들어갈 만큼 짧고, 빡세게도 반말이 아니다', () => {
    for (const exercise of EXERCISES) {
      const shorts = mistakesFor(exercise).map((item) => item.short);
      for (let at = 0; at < shorts.length; at += 1) {
        const fired = formCueLine('fired', exercise.pattern, at, shorts)!;
        const calm = formCueLine('calm', exercise.pattern, at, shorts)!;
        assert.ok(speechSeconds(fired) < 2.6, fired);
        assert.ok(speechSeconds(calm) < 2.6, calm);
        assert.doesNotMatch(fired, /(해|가자|버텨|해라|하자|봐|펴|열어)!/, fired);
        assert.doesNotMatch(calm, /요요\.|\.요\./, calm);
      }
    }
  });
});

describe('이번 세트에 짚을 실수', () => {
  const base = { exercise: squat, totalSets: 4 };

  it('회원이 체크한 실수가 제일 먼저다 — 첫 세트와 마지막 세트에', () => {
    const first = mistakeToWatch({ ...base, setIndex: 0, flagged: ['heels-up'] })!;
    assert.equal(first.moment, 'flagged');
    assert.equal(first.mistake.id, 'heels-up');
    assert.equal(mistakeToWatch({ ...base, setIndex: 3, flagged: ['heels-up'] })!.moment, 'flagged');
    assert.equal(mistakeToWatch({ ...base, setIndex: 1, flagged: ['heels-up'] }), null, '중간 세트마다 잔소리하지 않는다');
  });

  it('무거웠다고 하면 무거울 때 무너지는 실수를 짚는다', () => {
    const picked = mistakeToWatch({ ...base, setIndex: 1, afterHeavy: true })!;
    assert.equal(picked.moment, 'heavy');
    assert.equal(picked.mistake.underLoad, true);
  });

  it('처음 하는 종목은 첫 세트에 제일 흔한 실수 하나', () => {
    const picked = mistakeToWatch({ ...base, setIndex: 0, firstTime: true })!;
    assert.equal(picked.moment, 'first');
    assert.equal(picked.mistake.id, MISTAKES['back-squat']![0]!.id);
  });

  it('마지막 세트는 지칠 때 무너지는 실수를 짚는다', () => {
    assert.equal(mistakeToWatch({ ...base, setIndex: 3 })!.moment, 'lastSet');
  });

  it('평범한 중간 세트에는 아무것도 짚지 않는다', () => {
    assert.equal(mistakeToWatch({ ...base, setIndex: 1 }), null);
  });
});

describe('코치가 실수를 짚는 말', () => {
  it('짚을 실수가 있으면 동작 포인트 대신 그걸 말한다 — 한 세트에 한 가지', () => {
    const lines = beforeSetLines({
      style: 'fired', exerciseName: '백 스쿼트', setIndex: 1, totalSets: 4, weightKg: 100,
      repsMin: 6, repsMax: 10, targetRir: 2, cues: ['가슴을 펴고'],
      watch: { cue: '무릎을 발끝 방향으로 밀어 주세요', moment: 'heavy' },
    }).join(' ');
    assert.match(lines, /무거울 때 자세가 먼저 무너집니다\. 무릎을 발끝 방향으로 밀어 주세요!/);
    assert.doesNotMatch(lines, /가슴을 펴고/);
  });

  it('왜 지금 말하는지가 앞에 붙는다', () => {
    assert.match(watchLine('calm', '뒤꿈치로 바닥을 누르세요', 'flagged'), /^체크해 두신 거예요/);
    assert.match(watchLine('calm', '뒤꿈치로 바닥을 누르세요', 'lastSet'), /지칠 때/);
    assert.match(watchLine('data', '뒤꿈치로 바닥을 누르세요', 'heavy'), /^고중량 주의/);
    assert.doesNotMatch(watchLine('fired', '뒤꿈치로 바닥을 누르세요', 'first'), /(해|가자|버텨|해라|하자|봐)!/);
  });
});
