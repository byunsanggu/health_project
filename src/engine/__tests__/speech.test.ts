import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  afterSetLines, beforeSetLines, formCueLine, pushLine, restTipLine, sessionStartLines, watchLine, wrapUpLines,
  type CoachStyle, type Feel,
} from '../coach.ts';
import { exerciseGuideLines } from '../coachGuide.ts';
import { demoFor } from '../demos.ts';
import { EXERCISES } from '../exercises.ts';
import { mistakesFor } from '../mistakes.ts';
import {
  COOLDOWN_STEPS, MOBILITY_STEPS, cooldownLine, mobilityLine, restAnnounceLine, restSpoken, timeCheck, transitionLines,
  trimLine, warmupRestLine, warmupSetLine,
} from '../ptSession.ts';
import { setupFor } from '../setupGuide.ts';
import { clipId, nativeCount, numberPieces, sinoNumber, speechPieces, synthText } from '../speech.ts';
import { speechCorpus } from '../speechCorpus.ts';
import { buildCues, koreanCount } from '../tempo.ts';

const STYLES: CoachStyle[] = ['energetic', 'gentle', 'tough', 'fun'];

/** 테스트마다 같은 순서로 나오는 난수 */
function random(seed: number): () => number {
  let x = seed >>> 0;
  return () => {
    x = (x * 1664525 + 1013904223) >>> 0;
    return x / 4294967296;
  };
}

describe('숫자 읽기', () => {
  it('한자어 수', () => {
    assert.equal(sinoNumber(0), '영');
    assert.equal(sinoNumber(10), '십');
    assert.equal(sinoNumber(62), '육십이');
    assert.equal(sinoNumber(125), '백이십오');
    assert.equal(sinoNumber(1010), '천십');
    assert.equal(sinoNumber(300), '삼백');
  });

  it('고유어 수 — 한 개 · 스무 개 · 스물한 개', () => {
    assert.equal(nativeCount(1), '한');
    assert.equal(nativeCount(4), '네');
    assert.equal(nativeCount(12), '열두');
    assert.equal(nativeCount(20), '스무');
    assert.equal(nativeCount(21), '스물한');
    assert.equal(nativeCount(55), '쉰다섯');
  });

  it('단위마다 읽는 법 — 개 · 번은 고유어, 나머지는 한자어', () => {
    assert.deepEqual(numberPieces('10', '개'), ['열 개']);
    assert.deepEqual(numberPieces('3', '번'), ['세 번']);
    assert.deepEqual(numberPieces('3', '세트'), ['삼 세트']);
    assert.deepEqual(numberPieces('40', '초'), ['사십 초']);
    assert.deepEqual(numberPieces('8', '에서'), ['팔에서']);
    assert.deepEqual(numberPieces('62.5', '킬로'), ['육십이', '점 오', '킬로']);
    assert.deepEqual(numberPieces('512', '킬로'), ['오백', '십이', '킬로']);
  });
});

describe('말을 소리 조각으로', () => {
  it('바뀌는 부분(숫자 · 이름)만 떼어 내고 나머지는 말 그대로', () => {
    assert.deepEqual(speechPieces('레그프레스, 간다!'), ['레그프레스', '간다!']);
    assert.deepEqual(speechPieces('지난번 120kg, 10개.'), ['지난번', '백이십', '킬로', '열 개']);
    assert.deepEqual(speechPieces('3세트! 62.5kg, 12개!'), ['삼 세트', '육십이', '점 오', '킬로', '열두 개']);
  });

  it('바뀌는 부분이 없는 문장은 통째로 — 제일 자연스럽다', () => {
    assert.deepEqual(speechPieces('숨 골라. 다음 세트가 진짜야.'), ['숨 골라.', '다음 세트가 진짜야.']);
  });

  it('통째로 만들어 둔 문장이면 숫자가 있어도 쪼개지 않는다', () => {
    const whole = '경사 3에서 5, 숨이 살짝 찰 정도로 걸으세요.';
    assert.deepEqual(speechPieces(whole, (sentence) => sentence === whole), [whole]);
    assert.ok(speechPieces(whole).length > 1);
  });

  it('사람이 적은 글은 소리로 읽지 않는다', () => {
    assert.deepEqual(speechPieces('지난번 세팅, 화면에 있어.⁨ (시트 4)⁩'), ['지난번 세팅, 화면에 있어.']);
  });

  it('소리를 만들 때 영어 글자는 한국어 소리로', () => {
    assert.equal(synthText('오늘 PT 끝이다.'), '오늘 피티 끝이다.');
  });
});

describe('코치 목소리 조각 목록', () => {
  const corpora = new Map(STYLES.map((style) => [style, new Set(speechCorpus(style))]));

  it('조각마다 파일 이름이 겹치지 않는다', () => {
    const all = new Set(STYLES.flatMap((style) => [...corpora.get(style)!]));
    const ids = new Set([...all].map(clipId));
    assert.equal(ids.size, all.size);
  });

  it('조각은 한국어 소리다 — 빈 조각 · 문장부호만 있는 조각이 없다', () => {
    for (const [style, corpus] of corpora) {
      for (const piece of corpus) assert.match(piece, /[가-힣]/, `${style}: ${piece}`);
    }
  });

  it('아무 입력으로 만든 말도 전부 조각으로 덮인다 — 폰 목소리로 대신 읽는 일이 없다', () => {
    const rand = random(7);
    const pick = <T>(list: readonly T[]): T => list[Math.floor(rand() * list.length)]!;
    const weight = () => Math.round(rand() * 240 / 1.25) * 1.25;
    for (const style of STYLES) {
      const corpus = corpora.get(style)!;
      const missing = new Set<string>();
      const check = (lines: string | readonly string[] | null | undefined) => {
        for (const line of typeof lines === 'string' ? [lines] : lines ?? []) {
          for (const piece of speechPieces(line, (sentence) => corpus.has(sentence))) {
            if (!corpus.has(piece)) missing.add(`${piece}  ← ${line}`);
          }
        }
      };
      for (let round = 0; round < 250; round += 1) {
        const exercise = pick(EXERCISES);
        const other = pick(EXERCISES);
        const repsMax = 1 + Math.floor(rand() * 25);
        const repsMin = Math.max(1, repsMax - Math.floor(rand() * 6));
        const totalSets = 1 + Math.floor(rand() * 6);
        const pounds = rand() < 0.2;
        check(beforeSetLines({
          style, exerciseName: exercise.name, setIndex: Math.floor(rand() * totalSets), totalSets, weightKg: weight(), pounds,
          repsMin, repsMax, targetRir: Math.floor(rand() * 5), restrained: rand() < 0.3,
          liftIndex: Math.floor(rand() * 8), totalLifts: 1 + Math.floor(rand() * 8), cues: demoFor(exercise).cues,
          last: rand() < 0.6 ? { date: '2026-10-01', daysAgo: 3, weightKg: weight(), reps: 1 + Math.floor(rand() * 20), rir: 2, sets: 3 } : null,
          firstTime: rand() < 0.3, setup: setupFor(exercise), machineSetting: rand() < 0.3 ? '시트 ' + Math.floor(rand() * 9) : null,
          watch: rand() < 0.3 && mistakesFor(exercise).length ? { cue: pick(mistakesFor(exercise)).cue, moment: pick(['flagged', 'heavy', 'first', 'lastSet'] as const) } : null,
        }));
        check(afterSetLines({
          style, feel: pick(['light', 'right', 'heavy', 'hurt'] as Feel[]), lastOfLift: rand() < 0.3, nextWeightKg: weight(), pounds,
          deltaKg: pick([2.5, 5, -2.5, -5, 0, 1.25]), at: Math.floor(rand() * 20), setsDone: Math.floor(rand() * 6), weightPr: rand() < 0.2,
          growth: rand() < 0.2 ? { daysAgo: 7 + Math.floor(rand() * 50), thenReps: 3 + Math.floor(rand() * 10), nowReps: 5 + Math.floor(rand() * 15) } : null,
          stopReason: rand() < 0.1 ? '시간이 얼마 남지 않았습니다' : null, name: rand() < 0.3 ? '지수' : null,
        }));
        check(pushLine(style, Math.floor(rand() * 20), rand() < 0.5));
        check(restTipLine(style, Math.floor(rand() * 30)));
        check(formCueLine(style, exercise.pattern, Math.floor(rand() * 5), rand() < 0.5 ? mistakesFor(exercise).map((item) => item.short) : undefined));
        if (mistakesFor(exercise).length) check(watchLine(style, pick(mistakesFor(exercise)).cue, 'heavy'));
        check(buildCues({ repRange: { min: repsMin, max: repsMax }, lastCall: rand() < 0.5 ? undefined : undefined }).map((cue) => cue.say));
        check(wrapUpLines({
          style, setsDone: 1 + Math.floor(rand() * 40), liftsDone: 1 + Math.floor(rand() * 9), grew: Math.floor(rand() * 5),
          weekDone: 1 + Math.floor(rand() * 6), weekTarget: 1 + Math.floor(rand() * 6), firstEver: rand() < 0.1,
          goal: pick(['hypertrophy', 'strength', 'fatLoss', 'general', null] as const), at: Math.floor(rand() * 10),
        }));
        check(sessionStartLines({
          style, sessionName: '내 루틴 ' + round, lifts: 1 + Math.floor(rand() * 10), minutes: rand() < 0.7 ? 10 + Math.floor(rand() * 110) : undefined,
          phase: pick(['accumulation', 'deload'] as const), weekInBlock: 1 + Math.floor(rand() * 5), accumulationWeeks: 4,
          firstEver: rand() < 0.1, streakWeeks: Math.floor(rand() * 30), condition: Math.floor(rand() * 100), name: rand() < 0.3 ? '지수' : null,
        }));
        const steps = [{ weightKg: weight(), reps: 1 + Math.floor(rand() * 12), restSeconds: 30 }, { weightKg: weight(), reps: 3, restSeconds: 60 }];
        check(warmupSetLine(style, exercise.name, Math.floor(rand() * 2), steps, pounds));
        check(warmupRestLine(style, 15 + 15 * Math.floor(rand() * 8)));
        check(restAnnounceLine(style, { seconds: 10 + Math.floor(rand() * 290), nextSet: 1 + Math.floor(rand() * 6), firstTime: rand() < 0.3, nextName: rand() < 0.3 ? other.name : undefined }));
        check(transitionLines(style, { nextName: other.name, seconds: 30 + Math.floor(rand() * 150), firstTime: rand() < 0.3, machineSetting: rand() < 0.3 ? '등받이 2' : null }));
        check(trimLine(style, [{ name: exercise.name, sets: 1 + Math.floor(rand() * 3) }, { name: other.name, sets: 1 }]));
        check(timeCheck(style, { elapsedSeconds: Math.floor(rand() * 7200), plannedSeconds: 600 + Math.floor(rand() * 6000), said: rand() < 0.5 ? [] : ['half'] })?.line);
        check(mobilityLine(style, pick(MOBILITY_STEPS), Math.floor(rand() * 2), 6, 1 + Math.floor(rand() * 6)));
        check(cooldownLine(style, pick(COOLDOWN_STEPS), Math.floor(rand() * 2), 6));
        check(exerciseGuideLines(style, exercise));
        check(restSpoken(Math.floor(rand() * 400)));
        check(koreanCount(1 + Math.floor(rand() * 40)));
      }
      assert.deepEqual([...missing].slice(0, 20), [], style);
    }
  });
});
