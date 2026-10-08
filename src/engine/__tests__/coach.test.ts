import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  COACH_STYLES,
  FEELS,
  FIRED_RESOLVE,
  afterSetLines,
  askFeelLine,
  beforeSetLines,
  forSpeech,
  growthAt,
  lastTimeFor,
  pushLine,
  readySoonLine,
  restTipLine,
  speechSeconds,
  wrapUpLines,
  feelToRir,
  type BeforeSetInput,
  type CoachStyle,
} from '../coach.ts';
import { EXERCISES } from '../exercises.ts';
import type { SessionLog } from '../types.ts';

const STYLES: CoachStyle[] = ['calm', 'fired', 'data'];
const legPress = EXERCISES.find((item) => item.id === 'leg-press')!;
const bench = EXERCISES.find((item) => item.id === 'barbell-bench-press')!;
const TODAY = '2026-10-08';
const ago = (n: number) =>
  new Date(Date.parse(TODAY + 'T00:00:00Z') - n * 86400000).toISOString().slice(0, 10);

const session = (daysAgo: number, exerciseId: string, kg: number, reps: number[], extra: Partial<SessionLog> = {}): SessionLog =>
  ({
    id: `${exerciseId}-${daysAgo}`,
    date: ago(daysAgo),
    sets: reps.map((r) => ({ exerciseId, weightKg: kg, reps: r, rir: 2 })),
    ...extra,
  }) as SessionLog;

const base = (over: Partial<BeforeSetInput> = {}): BeforeSetInput => ({
  style: 'calm',
  exerciseName: '레그프레스',
  setIndex: 0,
  totalSets: 3,
  weightKg: 125,
  repsMin: 8,
  repsMax: 10,
  targetRir: 2,
  ...over,
});

describe('말투는 셋, 모두 존댓말', () => {
  it('차분 · 빡센 · 숫자 세 가지가 있다', () => {
    assert.deepEqual(COACH_STYLES.map((item) => item.id), ['calm', 'fired', 'data']);
  });

  it('빡센 트레이너도 반말을 하지 않는다', () => {
    /* 빡세다는 건 반말이 아니라 각오다. 끝이 "~해!" "~가자!"로 떨어지면 안 된다. */
    const said = [
      ...beforeSetLines(base({ style: 'fired' })),
      ...beforeSetLines(base({ style: 'fired', setIndex: 2 })),
      pushLine('fired'),
      askFeelLine('fired'),
      ...afterSetLines({ style: 'fired', feel: 'light', lastOfLift: false, nextWeightKg: 130, deltaKg: 5 }),
      ...afterSetLines({ style: 'fired', feel: 'right', lastOfLift: true }),
      restTipLine('fired', 0), restTipLine('fired', 1), restTipLine('fired', 2),
      readySoonLine('fired'),
      ...wrapUpLines({ style: 'fired', setsDone: 18, liftsDone: 6 }),
      ...FIRED_RESOLVE,
    ].join(' ');
    assert.doesNotMatch(said, /(해|가자|버텨|해라|하자|봐)!/);
    assert.doesNotMatch(said, /(^|\s)(야|너)(\s|,)/);
  });

  it('각오 한마디는 돌려 쓴다 — 여섯 종목에 같은 말을 여섯 번 하지 않는다', () => {
    const firsts = [0, 1, 2, 3].map((liftIndex) =>
      beforeSetLines(base({ style: 'fired', liftIndex })).join(' '));
    assert.equal(new Set(firsts).size, 4);
  });
});

describe('말투가 처방을 바꾸지 않는다', () => {
  it('같은 입력이면 세 말투 모두 같은 무게와 횟수를 말한다', () => {
    for (const style of STYLES) {
      const said = beforeSetLines(base({ style })).join(' ');
      assert.match(said, /125kg/, style);
      assert.match(said, /8에서 10개/, style);
    }
  });

  it('세트 후에는 체감이 아니라 엔진이 정한 무게를 말한다', () => {
    /* "가벼웠어요"를 눌렀어도 엔진이 안 올렸으면 "올립니다"라고 하면 안 된다. */
    for (const style of STYLES) {
      const said = afterSetLines({ style, feel: 'light', lastOfLift: false, nextWeightKg: 125, deltaKg: 0 }).join(' ');
      assert.doesNotMatch(said, /올려|올립니다|\+/, style);
    }
  });
});

describe('첫 세트에 말하는 것', () => {
  it('처음 하는 종목이면 세팅부터 말한다', () => {
    const said = beforeSetLines(base({ firstTime: true, setup: ['등을 등받이에 붙입니다'] }));
    assert.ok(said.some((line) => line.includes('등받이')));
  });

  it('두 번째부터는 사용법 대신 적어 둔 세팅을 말한다', () => {
    const said = beforeSetLines(base({ setup: ['등을 등받이에 붙입니다'], machineSetting: '시트 4' })).join(' ');
    assert.doesNotMatch(said, /등받이에 붙입니다/);
    assert.match(said, /시트 4/);
  });

  it('지난번 기록을 말한다', () => {
    const last = { date: ago(4), daysAgo: 4, weightKg: 120, reps: 10, rir: 2, sets: 3 };
    for (const style of STYLES) {
      assert.match(beforeSetLines(base({ style, last })).join(' '), /지난번.*120kg/, style);
    }
  });

  it('"오늘"이 연달아 나오지 않는다', () => {
    const last = { date: ago(4), daysAgo: 4, weightKg: 120, reps: 10, rir: 2, sets: 3 };
    for (const style of STYLES) {
      const lines = beforeSetLines(base({ style, last }));
      for (let i = 1; i < lines.length; i += 1) {
        const both = /^오늘/.test(lines[i - 1]!) && /^오늘/.test(lines[i]!);
        assert.ok(!both, `${style}: ${lines[i - 1]} / ${lines[i]}`);
      }
    }
  });

  it('포인트는 하나만 말한다', () => {
    const cues = ['가', '나', '다'];
    const said = beforeSetLines(base({ cues }));
    assert.equal(said.filter((line) => cues.some((cue) => line.startsWith(cue))).length, 1);
  });

  it('둘째 세트부터는 짧다', () => {
    for (const style of STYLES) {
      const first = beforeSetLines(base({ style, last: { date: ago(3), daysAgo: 3, weightKg: 120, reps: 10, rir: 2, sets: 3 } }));
      const second = beforeSetLines(base({ style, setIndex: 1 }));
      assert.ok(second.join(' ').length < first.join(' ').length, style);
    }
  });
});

describe('세트 중', () => {
  it('끝나기 직전의 한마디는 숫자 사이에 들어갈 만큼 짧다', () => {
    for (const style of STYLES) assert.ok(speechSeconds(pushLine(style)) < 2, style);
  });
});

describe('무게 체감', () => {
  it('네 가지로 묻는다 — 아픈 것은 무거운 것과 따로', () => {
    assert.deepEqual(FEELS.map((item) => item.id), ['light', 'right', 'heavy', 'hurt']);
  });

  it('"딱 좋았어요"는 그 주의 목표 남은 횟수다', () => {
    assert.equal(feelToRir('right', 3), 3);
    assert.equal(feelToRir('right', 1), 1);
  });

  it('가벼우면 더 남았고 무거우면 덜 남았다', () => {
    assert.ok(feelToRir('light', 2) > feelToRir('right', 2));
    assert.ok(feelToRir('heavy', 2) < feelToRir('right', 2));
  });

  it('0~4 밖으로 나가지 않는다', () => {
    assert.equal(feelToRir('light', 4), 4);
    assert.equal(feelToRir('heavy', 0), 0);
  });

  it('아프면 목표값으로 적는다 — 그 세트로 무게를 움직이지 않는다', () => {
    assert.equal(feelToRir('hurt', 2), 2);
  });

  it('아프다고 하면 빡센 트레이너도 밀지 않는다', () => {
    const calm = afterSetLines({ style: 'calm', feel: 'hurt', lastOfLift: false }).join(' ');
    const fired = afterSetLines({ style: 'fired', feel: 'hurt', lastOfLift: false }).join(' ');
    assert.equal(fired, calm);
    assert.match(fired, /멈출게요/);
  });
});

describe('지난번', () => {
  it('가장 최근 날의 제일 무거운 세트', () => {
    const history = [session(10, 'leg-press', 110, [10]), session(3, 'leg-press', 120, [10, 9])];
    const last = lastTimeFor(history, legPress, TODAY);
    assert.equal(last?.weightKg, 120);
    assert.equal(last?.reps, 10);
    assert.equal(last?.daysAgo, 3);
    assert.equal(last?.sets, 2);
  });

  it('오늘 기록은 지난번이 아니다', () => {
    const history = [session(0, 'leg-press', 130, [10]), session(3, 'leg-press', 120, [10])];
    assert.equal(lastTimeFor(history, legPress, TODAY)?.weightKg, 120);
  });

  it('다른 헬스장 기계 무게는 "지난번"이 아니다', () => {
    const history = [
      session(2, 'leg-press', 200, [10], { gymId: 'other' }),
      session(5, 'leg-press', 120, [10], { gymId: 'mine' }),
    ];
    assert.equal(lastTimeFor(history, legPress, TODAY, { gymId: 'mine' })?.weightKg, 120);
  });

  it('바벨은 헬스장이 달라도 같은 무게다', () => {
    const history = [session(2, 'barbell-bench-press', 80, [8], { gymId: 'other' })];
    assert.equal(lastTimeFor(history, bench, TODAY, { gymId: 'mine' })?.weightKg, 80);
  });

  it('처음이면 없다', () => {
    assert.equal(lastTimeFor([], legPress, TODAY), null);
  });
});

describe('늘었다', () => {
  it('같은 무게로 전보다 더 하면 짚어 준다', () => {
    const history = [session(21, 'leg-press', 120, [8, 8])];
    const growth = growthAt(history, legPress, TODAY, 120, 10);
    assert.deepEqual(growth, { daysAgo: 21, thenReps: 8, nowReps: 10 });
    const line = afterSetLines({ style: 'calm', feel: 'right', lastOfLift: false, nextWeightKg: 120, deltaKg: 0, growth }).join(' ');
    assert.match(line, /3주 전엔 이 무게로 8개/);
  });

  it('일주일 안쪽은 성장이 아니라 그날 컨디션이다', () => {
    assert.equal(growthAt([session(3, 'leg-press', 120, [8])], legPress, TODAY, 120, 10), null);
  });

  it('제일 못했던 날을 골라 오지 않는다 — 가장 최근의 같은 무게와 비교한다', () => {
    const history = [session(35, 'leg-press', 120, [6]), session(14, 'leg-press', 120, [10])];
    assert.equal(growthAt(history, legPress, TODAY, 120, 10), null);
  });

  it('무게가 다르면 비교하지 않는다', () => {
    assert.equal(growthAt([session(21, 'leg-press', 110, [8])], legPress, TODAY, 120, 10), null);
  });
});

describe('쉬는 동안과 끝', () => {
  it('쉬는 중 한마디는 세트마다 바뀐다', () => {
    for (const style of STYLES) assert.notEqual(restTipLine(style, 0), restTipLine(style, 1), style);
  });

  it('마무리에 늘어난 종목을 말한다', () => {
    for (const style of STYLES) {
      assert.match(wrapUpLines({ style, setsDone: 12, liftsDone: 4, grew: 2 }).join(' '), /2/, style);
    }
  });
});

describe('소리로 읽기', () => {
  it('단위를 읽을 수 있는 말로 바꾼다', () => {
    assert.equal(forSpeech('62.5kg'), '62.5킬로');
    assert.equal(forSpeech('90lb'), '90파운드');
    assert.equal(forSpeech('8–10회'), '8에서 10회');
  });

  it('말 길이를 대략 잰다 — 첫 세트 말은 준비 시간보다 길 수 있다', () => {
    const long = beforeSetLines(base({ style: 'fired', last: { date: ago(3), daysAgo: 3, weightKg: 120, reps: 10, rir: 2, sets: 3 }, cues: ['무릎이 발끝 방향을 따라 벌어지게'] })).join(' ');
    assert.ok(speechSeconds(long) > 8);
    assert.ok(speechSeconds('하나') < 1);
  });
});
