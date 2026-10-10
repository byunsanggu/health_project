import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  COACH_STYLES,
  FEELS,
  FIRED_RESOLVE,
  FIRED_MIDDLE,
  bestWeightBefore,
  sessionStartLines,
  lastCallLine,
  formCueLine,
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
import { buildCues } from '../tempo.ts';
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

describe('멘트를 돌려 쓴다', () => {
  const range = (n: number) => Array.from({ length: n }, (_, i) => i);

  it('빡센 트레이너의 새 멘트도 전부 존댓말이다', () => {
    const said = [
      ...FIRED_MIDDLE,
      ...range(8).map((at) => pushLine('fired', at)),
      ...range(8).map((at) => askFeelLine('fired', at)),
      ...range(8).map((at) => restTipLine('fired', at)),
      ...range(8).map((at) => readySoonLine('fired', at)),
      ...range(6).flatMap((at) => (['light', 'right', 'heavy'] as const).flatMap((feel) => [
        ...afterSetLines({ style: 'fired', feel, lastOfLift: false, nextWeightKg: 100, deltaKg: 2.5, at }),
        ...afterSetLines({ style: 'fired', feel, lastOfLift: false, nextWeightKg: 100, deltaKg: -5, at }),
        ...afterSetLines({ style: 'fired', feel, lastOfLift: false, nextWeightKg: 100, deltaKg: 0, at }),
        ...afterSetLines({ style: 'fired', feel, lastOfLift: true, at }),
      ])),
      ...afterSetLines({ style: 'fired', feel: 'right', lastOfLift: false, weightPr: true, nextWeightKg: 100 }),
      ...range(4).flatMap((at) => wrapUpLines({ style: 'fired', setsDone: 18, liftsDone: 6, at, weekDone: 4, weekTarget: 4 })),
      ...wrapUpLines({ style: 'fired', setsDone: 12, liftsDone: 5, firstEver: true }),
      ...sessionStartLines({ style: 'fired', sessionName: '하체 A', lifts: 5, minutes: 40, phase: 'deload' }),
      ...sessionStartLines({ style: 'fired', sessionName: '하체 A', lifts: 5, weekInBlock: 5, accumulationWeeks: 5, streakWeeks: 4 }),
      ...beforeSetLines(base({ style: 'fired', liftIndex: 5, totalLifts: 6 })),
      ...beforeSetLines(base({ style: 'fired', liftIndex: 3, totalLifts: 6 })),
    ].join(' ');
    assert.doesNotMatch(said, /(해|가자|버텨|해라|하자|봐|밀어|짜내)!/);
    assert.doesNotMatch(said, /(^|\s)(야|너)(\s|,)/);
  });

  it('같은 자리의 말이 순번마다 바뀐다', () => {
    for (const style of ['calm', 'fired'] as const) {
      assert.ok(new Set(range(6).map((at) => pushLine(style, at))).size >= 3, `${style} 두 개 전`);
      assert.ok(new Set(range(6).map((at) => restTipLine(style, at))).size >= 5, `${style} 쉬는 동안`);
      const same = range(3).map((at) =>
        afterSetLines({ style, feel: 'right', lastOfLift: false, nextWeightKg: 100, deltaKg: 0, at }).join(' '));
      assert.equal(new Set(same).size, 3, `${style} 같은 무게`);
    }
  });

  it('숫자 사이에 끼는 말은 짧다', () => {
    for (const style of STYLES) {
      for (const at of range(6)) {
        assert.ok(speechSeconds(pushLine(style, at)) < 2.2, `${style} ${pushLine(style, at)}`);
      }
    }
  });

  it('체감 대답에 대꾸하되 무게는 엔진 숫자대로다', () => {
    const heavy = afterSetLines({ style: 'calm', feel: 'heavy', lastOfLift: false, nextWeightKg: 95, deltaKg: -5 }).join(' ');
    assert.match(heavy, /무거웠/);
    assert.match(heavy, /95kg/);
    const light = afterSetLines({ style: 'fired', feel: 'light', lastOfLift: false, nextWeightKg: 100, deltaKg: 0 }).join(' ');
    assert.doesNotMatch(light, /올립니다|올려/);
  });

  it('처음 든 무게는 제일 먼저 축하한다', () => {
    for (const style of STYLES) {
      const lines = afterSetLines({ style, feel: 'right', lastOfLift: false, weightPr: true, nextWeightKg: 100, deltaKg: 0 });
      assert.match(lines[0]!, /최고|처음 든/, style);
    }
  });

  it('지난 기록 중 제일 무거운 무게를 찾는다', () => {
    const history: SessionLog[] = [
      { date: ago(14), sets: [{ exerciseId: 'barbell-bench-press', weightKg: 80, reps: 5, rir: 1 }] },
      { date: ago(7), sets: [{ exerciseId: 'barbell-bench-press', weightKg: 75, reps: 8, rir: 2 },
        { exerciseId: 'barbell-bench-press', weightKg: 90, reps: 1, rir: 0, warmup: true }] },
    ];
    assert.equal(bestWeightBefore(history, bench, TODAY), 80, '워밍업은 빼고');
    assert.equal(bestWeightBefore([], bench, TODAY), null);
  });

  it('종목 위치를 말한다 — 절반, 마지막', () => {
    assert.match(beforeSetLines(base({ style: 'calm', liftIndex: 5, totalLifts: 6 })).join(' '), /마지막 종목/);
    assert.match(beforeSetLines(base({ style: 'calm', liftIndex: 3, totalLifts: 6 })).join(' '), /절반/);
    assert.doesNotMatch(beforeSetLines(base({ style: 'calm', liftIndex: 1, totalLifts: 6 })).join(' '), /절반|마지막 종목/);
  });

  it('시작할 때 이번 주가 블록의 어디인지 말한다', () => {
    assert.match(sessionStartLines({ style: 'calm', sessionName: '상체 A', lifts: 6, minutes: 45 }).join(' '), /상체 A.*6종목.*45분/);
    assert.match(sessionStartLines({ style: 'calm', sessionName: '상체 A', lifts: 6, phase: 'deload' }).join(' '), /덜어내는/);
    assert.match(sessionStartLines({ style: 'calm', sessionName: '상체 A', lifts: 6, weekInBlock: 5, accumulationWeeks: 5 }).join(' '), /제일 힘든/);
    assert.match(sessionStartLines({ style: 'calm', sessionName: '상체 A', lifts: 6, firstEver: true }).join(' '), /첫날/);
    assert.deepEqual(sessionStartLines({ style: 'calm', sessionName: '상체 A', lifts: 6, resuming: true }), ['이어서 할게요.']);
  });

  it('마무리에 이번 주 약속을 말한다', () => {
    assert.match(wrapUpLines({ style: 'calm', setsDone: 16, liftsDone: 5, weekDone: 3, weekTarget: 3 }).join(' '), /다 채우셨어요/);
    assert.match(wrapUpLines({ style: 'calm', setsDone: 16, liftsDone: 5, weekDone: 1, weekTarget: 3 }).join(' '), /2번 남았어요/);
    assert.match(wrapUpLines({ style: 'calm', setsDone: 16, liftsDone: 5, firstEver: true }).join(' '), /첫 운동/);
  });
});

describe('이어 붙인 말이 겹치지 않는다', () => {
  it('대꾸 다음 말에서 같은 말이 연달아 나오지 않는다 — "좋아요. 좋아요."', () => {
    for (const style of STYLES) {
      for (const feel of ['light', 'right', 'heavy'] as const) {
        for (const deltaKg of [2.5, 0, -5]) {
          for (let at = 0; at < 6; at += 1) {
            for (const lastOfLift of [false, true]) {
              const said = afterSetLines({ style, feel, lastOfLift, nextWeightKg: 100, deltaKg, at, setsDone: 3 }).join(' ');
              assert.doesNotMatch(said, /(좋습니다|좋아요|좋네요)[.!]?\s+\1/, `${style} ${feel} ${deltaKg} ${at}: ${said}`);
              assert.doesNotMatch(said, /(\S{2,})[.!]\s+\1[.!]/, `${style} ${feel} ${deltaKg} ${at}: ${said}`);
            }
          }
        }
      }
    }
  });
});

describe('트레이너가 실제로 하는 말', () => {
  it('마지막 하나 전에는 "하나 더! 마지막!!"', () => {
    assert.equal(lastCallLine('fired'), '하나 더! 마지막!!');
    const cues = buildCues({ repRange: { min: 8, max: 10 }, lastCall: lastCallLine('fired') });
    assert.equal(cues.find((cue) => cue.rep === 9)!.say, '아홉, 하나 더! 마지막!!');
    // 혼자 모드는 그대로
    assert.equal(buildCues({ repRange: { min: 8, max: 10 } }).find((cue) => cue.rep === 9)!.say, '아홉, 하나 남았습니다');
  });

  it('세트 중 자세 한마디는 동작에 맞고 짧다', () => {
    assert.match(formCueLine('fired', 'squat')!, /엉덩이|무릎|가슴/);
    assert.match(formCueLine('calm', 'hinge')!, /등|엉덩이|바/);
    assert.equal(formCueLine('data', 'squat'), null, '숫자로 말투는 자세 말을 안 한다');
    for (const pattern of ['squat', 'lunge', 'hinge', 'horizontalPush', 'verticalPush', 'verticalPull', 'horizontalPull', 'isolation', 'core'] as const) {
      for (const style of ['fired', 'calm'] as const) {
        for (let at = 0; at < 3; at += 1) {
          const line = formCueLine(style, pattern, at)!;
          assert.ok(speechSeconds(line) < 2.4, `${pattern} ${line}`);
          if (style === 'fired') assert.doesNotMatch(line, /(해|가자|버텨|해라|하자|봐|펴|열어)!/, line);
        }
      }
    }
  });

  it('이름이 있으면 부른다', () => {
    assert.match(sessionStartLines({ style: 'calm', sessionName: '상체 A', lifts: 5, name: '민수' })[0]!, /^민수님, /);
    assert.match(wrapUpLines({ style: 'fired', setsDone: 12, liftsDone: 4, name: '민수' }).join(' '), /민수님/);
    assert.match(afterSetLines({ style: 'fired', feel: 'right', lastOfLift: false, weightPr: true, nextWeightKg: 100, name: '민수' })[0]!, /^민수님/);
    assert.doesNotMatch(sessionStartLines({ style: 'calm', sessionName: '상체 A', lifts: 5 })[0]!, /님,/);
  });

  it('컨디션이 낮은 날은 자세를 먼저 말한다', () => {
    const low = sessionStartLines({ style: 'fired', sessionName: '하체 A', lifts: 5, condition: 50, weekInBlock: 5, accumulationWeeks: 5 }).join(' ');
    assert.match(low, /컨디션/);
    assert.doesNotMatch(low, /제일 힘든 주/, '컨디션 낮은 날에 "제일 힘든 주"로 밀지 않는다');
    assert.doesNotMatch(sessionStartLines({ style: 'fired', sessionName: '하체 A', lifts: 5, condition: 90 }).join(' '), /컨디션/);
  });

  it('마무리에 목표 한 줄', () => {
    assert.match(wrapUpLines({ style: 'calm', setsDone: 12, liftsDone: 4, goal: 'fatLoss' }).join(' '), /근육을 지켜/);
    assert.match(wrapUpLines({ style: 'fired', setsDone: 12, liftsDone: 4, goal: 'hypertrophy' }).join(' '), /잠/);
  });
});

describe('마무리 말이 겹치지 않는다', () => {
  it('목표 한 줄과 인사에 같은 말("푹", "주무세요")이 두 번 나오지 않는다', () => {
    for (const style of ['calm', 'fired'] as const) {
      for (const goal of ['hypertrophy', 'strength', 'fatLoss', 'general'] as const) {
        for (let at = 0; at < 3; at += 1) {
          const said = wrapUpLines({ style, setsDone: 12, liftsDone: 4, goal, at }).join(' ');
          for (const word of ['푹', '주무세요', '단백질', '잠']) {
            assert.ok(said.split(word).length <= 2, `${style} ${goal} ${at}: ${said}`);
          }
        }
      }
    }
  });
});
