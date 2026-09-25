import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  DEFAULT_TEMPO,
  TEMPO_PRESETS,
  buildCues,
  koreanCount,
  repSeconds,
  repsAt,
  setSeconds,
  tempoLabel,
} from '../tempo.ts';

describe('템포', () => {
  it('현장 표기 네 자리로 쓴다', () => {
    assert.equal(tempoLabel(DEFAULT_TEMPO), '2-0-1-0');
  });

  it('반복 하나에 걸리는 시간은 네 구간의 합이다', () => {
    assert.equal(repSeconds({ eccentric: 3, bottom: 1, concentric: 1, top: 0 }), 5);
  });

  it('준비된 템포는 전부 쓸 수 있는 값이다', () => {
    for (const preset of TEMPO_PRESETS) {
      assert.ok(repSeconds(preset.tempo) >= 2, preset.label);
      assert.ok(preset.note.length > 0, preset.label);
    }
  });
});

describe('세는 말', () => {
  it('한국에서 반복은 고유어로 센다', () => {
    /*
     * 숫자를 그대로 읽히면 기계가 "팔"이라고 읽는다. 여덟인지 8인지
     * 모르게 되고, 헬스장 소음 속에서는 더 안 들린다.
     */
    assert.equal(koreanCount(1), '하나');
    assert.equal(koreanCount(8), '여덟');
    assert.equal(koreanCount(10), '열');
    assert.equal(koreanCount(15), '열다섯');
    assert.equal(koreanCount(20), '스물');
  });

  it('스물을 넘으면 숫자로 간다', () => {
    // 고유어가 오히려 길어져서 박자를 놓친다.
    assert.equal(koreanCount(25), '25');
  });
});

describe('세트 대본', () => {
  const range = { min: 6, max: 10 };

  it('시작 신호로 연다', () => {
    const cues = buildCues({ repRange: range });
    assert.equal(cues[0]?.say, '시작');
    assert.equal(cues[0]?.atMs, 0);
  });

  it('목표 반복 수만큼 센다', () => {
    const cues = buildCues({ repRange: range });
    assert.equal(cues.filter((cue) => cue.rep > 0).length, 10);
    assert.equal(cues[cues.length - 1]?.rep, 10);
  });

  it('템포대로 간격이 벌어진다', () => {
    const fast = buildCues({ repRange: range, tempo: { eccentric: 1, bottom: 0, concentric: 1, top: 0 } });
    const slow = buildCues({ repRange: range, tempo: { eccentric: 3, bottom: 1, concentric: 1, top: 0 } });
    assert.ok((slow[slow.length - 1]?.atMs ?? 0) > (fast[fast.length - 1]?.atMs ?? 0));
  });

  it('목표 구간에 들어온 순간을 알려 준다', () => {
    // 6개를 한 뒤 알고 멈추는 것과 모르고 멈추는 것은 다른 일이다.
    const cues = buildCues({ repRange: range });
    assert.match(cues.find((cue) => cue.rep === 6)?.say ?? '', /목표/);
  });

  it('마지막 하나 전에 알려 준다', () => {
    const cues = buildCues({ repRange: range });
    assert.match(cues.find((cue) => cue.rep === 9)?.say ?? '', /하나 남/);
    assert.match(cues.find((cue) => cue.rep === 10)?.say ?? '', /끝/);
  });

  it('말이 겹치지 않는다', () => {
    // 세트 중에 설명을 늘어놓는 트레이너는 없다. 한 반복에 한마디다.
    const cues = buildCues({ repRange: range });
    for (const cue of cues) {
      assert.ok(cue.say.split(',').length <= 2, cue.say);
    }
  });

  it('한 회짜리 세트도 깨지지 않는다', () => {
    const cues = buildCues({ repRange: { min: 1, max: 1 } });
    assert.equal(cues.filter((cue) => cue.rep > 0).length, 1);
    assert.match(cues[1]?.say ?? '', /끝/);
  });

  it('시각이 순서대로 늘어난다', () => {
    const cues = buildCues({ repRange: { min: 3, max: 12 } });
    for (let i = 1; i < cues.length; i += 1) {
      assert.ok((cues[i]?.atMs ?? 0) > (cues[i - 1]?.atMs ?? 0));
    }
  });
});

describe('멈춘 자리', () => {
  const input = { repRange: { min: 6, max: 10 } };

  it('흘러간 시간만큼을 반복 수로 제안한다', () => {
    /*
     * 앱은 실제 반복을 못 본다. 박자를 따라갔다면 시간이 곧 반복 수이고,
     * 그 이상을 아는 척하면 거짓말이다 — 그래서 "제안"이고 고쳐 칠 수 있다.
     */
    assert.equal(repsAt(3000, input), 0);
    assert.equal(repsAt(20000, input), 5);
    assert.equal(repsAt(33000, input), 10);
  });

  it('목표를 넘겨 세지 않는다', () => {
    assert.equal(repsAt(999000, input), 10);
  });

  it('시작 전에 멈추면 0개다', () => {
    assert.equal(repsAt(0, input), 0);
  });

  it('한 세트에 걸리는 시간을 준다', () => {
    assert.equal(setSeconds(input), 33);
  });
});
