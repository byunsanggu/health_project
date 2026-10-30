/**
 * 코치가 할 수 있는 말 전부 — 코치 목소리 조각을 만들 목록.
 *
 * 소리를 만드는 쪽(tools/voice)이 이걸로 무엇을 만들지 정하고, 테스트가 아무 입력으로나 만든
 * 말이 이 목록 밖으로 나가지 않는지 본다. 말을 새로 쓰면 여기에도 들어와야 하고, 빠지면
 * 테스트가 잡는다 — 코치 목소리는 기기 음성합성으로 대신 읽지 않으니, 빠진 조각은 소리가 안 난다.
 *
 * 숫자 값마다 다 돌릴 필요는 없다 — 숫자는 따로 조각(numberInventory)이 있다. 여기서는
 * 말의 모양(갈래 · 돌려 쓰는 순번)을 다 밟는다.
 */
import {
  COACH_STYLES, FEELS, REST_TIPS, afterSetLines, askFeelLine, beforeSetLines, formCueLine, lastCallLine, ptStartLine,
  pushLine, readySoonLine, restTipLine, resumeFromLine, resumeLine, sessionStartLines, watchLine, wrapUpLines,
  type CoachStyle, type Feel,
} from './coach.ts';
import { exerciseGuideLines } from './coachGuide.ts';
import { demoFor } from './demos.ts';
import { EXERCISES } from './exercises.ts';
import { mistakesFor, type MistakeMoment } from './mistakes.ts';
import {
  COOLDOWN_STEPS, MOBILITY_STEPS, cooldownDoneLine, cooldownLine, cooldownSwitchLine, mobilityDoneLine, mobilityLine,
  restAnnounceLine, timeCheck, transitionLines, trimLine, warmupDoneLine, warmupRestLine, warmupSetLine,
} from './ptSession.ts';
import { setupFor } from './setupGuide.ts';
import { numberInventory, sentences, speechNames, speechPieces } from './speech.ts';
import { buildCues, koreanCount } from './tempo.ts';
import { forSpeech } from './coach.ts';

const range = (n: number) => Array.from({ length: n }, (_, i) => i);
const MOMENTS: MistakeMoment[] = ['flagged', 'heavy', 'first', 'lastSet'];

/** 앱이 직접 하는 짧은 말 — 세기 시작 · 들어 보기 */
export const APP_SAYINGS: readonly string[] = ['시작', '하나', '둘', '셋', '하나, 둘, 셋', '하나, 둘, 셋, 넷'];

/**
 * 통째로 만들어 두는 문장 — 모든 코치가 같이 쓰는 설명(세팅 · 동작 · 실수 · 몸 풀기 · 스트레칭).
 * 숫자가 들어 있어도("경사 3에서 5") 쪼개지 않고 한 문장으로 읽는다.
 */
export function wholeSentences(): Set<string> {
  const texts: string[] = [];
  for (const exercise of EXERCISES) {
    texts.push(...setupFor(exercise), ...demoFor(exercise).cues);
    for (const mistake of mistakesFor(exercise)) texts.push(mistake.sign, mistake.cue);
  }
  for (const step of [...MOBILITY_STEPS, ...COOLDOWN_STEPS]) texts.push(step.cue);
  const out = new Set<string>();
  for (const text of texts) {
    const base = text.trim().replace(/[.!?]+$/, '');
    for (const mark of ['.', '!']) for (const sentence of sentences(forSpeech(base + mark))) out.add(sentence);
  }
  return out;
}

/** 한 코치가 하는 말 전부 (화면 글 그대로 — 아직 조각으로 나누기 전). */
export function coachTexts(style: CoachStyle): string[] {
  const out: string[] = [];
  const say = (lines: string | readonly string[] | null | undefined) => {
    if (!lines) return;
    if (typeof lines === 'string') out.push(lines);
    else out.push(...lines);
  };
  const last = (weightKg: number) => ({ date: '2026-10-01', daysAgo: 7, weightKg, reps: 10, rir: 2, sets: 3 });

  // 세트 전 — 갈래(첫 세트 · 중간 · 마지막 · 마지막 종목 · 무리 안 하는 날 · 지난번 대비)와 돌려 쓰는 순번
  for (const exercise of EXERCISES) {
    const cues = demoFor(exercise).cues;
    const mistakes = mistakesFor(exercise);
    for (const setIndex of range(4)) {
      for (const restrained of [false, true]) {
        for (const liftIndex of range(6)) {
          say(beforeSetLines({
            style, exerciseName: exercise.name, setIndex, totalSets: 4, weightKg: 60, repsMin: 8, repsMax: 10,
            targetRir: 2, restrained, liftIndex, totalLifts: 6, cues,
            last: setIndex === 0 ? last([50, 60, 70][liftIndex % 3]!) : null,
            firstTime: liftIndex === 0, setup: setupFor(exercise), machineSetting: liftIndex === 1 ? '시트 4' : null,
          }));
        }
      }
    }
    say(beforeSetLines({ style, exerciseName: exercise.name, setIndex: 0, totalSets: 3, weightKg: 0, repsMin: 10, repsMax: 10, targetRir: 3 }));
    for (const mistake of mistakes) {
      for (const moment of MOMENTS) say(watchLine(style, mistake.cue, moment));
    }
    const shorts = mistakes.map((item) => item.short);
    for (const at of range(shorts.length)) say(formCueLine(style, exercise.pattern, at, shorts));
    say(exerciseGuideLines(style, exercise));
  }
  for (const pattern of ['squat', 'lunge', 'hinge', 'horizontalPush', 'verticalPush', 'verticalPull', 'horizontalPull', 'isolation', 'core'] as const) {
    for (const at of range(4)) say(formCueLine(style, pattern, at));
  }

  // 세트 중 — 두 개 전 · 마지막 하나 · 세는 말
  for (const at of range(10)) { say(pushLine(style, at)); say(pushLine(style, at, true)); }
  say(lastCallLine(style));
  for (let max = 1; max <= 30; max += 1) {
    for (const min of [1, Math.max(1, max - 4), max]) {
      say(buildCues({ repRange: { min, max }, lastCall: lastCallLine(style) }).map((cue) => cue.say));
      say(buildCues({ repRange: { min, max } }).map((cue) => cue.say));
    }
  }
  for (let n = 1; n <= 30; n += 1) say(resumeFromLine(style, koreanCount(n)));

  // 세트 후
  for (const at of range(8)) {
    say(askFeelLine(style, at));
    for (const feel of FEELS.map((item) => item.id) as Feel[]) {
      for (const deltaKg of [2.5, -5, 0]) {
        for (const lastOfLift of [false, true]) say(afterSetLines({ style, feel, lastOfLift, nextWeightKg: 62.5, deltaKg, at, setsDone: 3 }));
      }
      say(afterSetLines({ style, feel, lastOfLift: false, nextWeightKg: 60, deltaKg: 0, at, weightPr: true, name: '민수' }));
      for (const daysAgo of [7, 21]) say(afterSetLines({ style, feel, lastOfLift: false, nextWeightKg: 60, deltaKg: 0, at, growth: { daysAgo, thenReps: 8, nowReps: 10 } }));
      say(afterSetLines({ style, feel, lastOfLift: false, at, stopReason: '계획한 4세트를 마쳤습니다' }));
    }
  }

  // 쉬는 동안
  for (const at of range(REST_TIPS[style].length + 2)) say(restTipLine(style, at));
  for (const at of range(6)) say(readySoonLine(style, at));

  // 시작 · 끝
  for (const at of range(6)) {
    for (const goal of ['hypertrophy', 'strength', 'fatLoss', 'general', null] as const) {
      say(wrapUpLines({ style, setsDone: 16, liftsDone: 5, grew: at % 2 ? 2 : 0, weekDone: at % 3 === 0 ? 3 : 1, weekTarget: 3, goal, at, name: at % 2 ? '민수' : null }));
    }
    say(wrapUpLines({ style, setsDone: 12, liftsDone: 4, firstEver: true, at }));
  }
  for (const minutes of [undefined, 45]) {
    const common = { style, sessionName: '하체 A', lifts: 5, minutes, name: '민수' };
    say(sessionStartLines(common));
    say(sessionStartLines({ ...common, firstEver: true }));
    say(sessionStartLines({ ...common, phase: 'deload' }));
    say(sessionStartLines({ ...common, weekInBlock: 1, accumulationWeeks: 4, streakWeeks: 3 }));
    say(sessionStartLines({ ...common, weekInBlock: 4, accumulationWeeks: 4 }));
    say(sessionStartLines({ ...common, condition: 50 }));
    say(sessionStartLines({ ...common, resuming: true }));
  }
  say(resumeLine(style));
  say(ptStartLine(style));
  for (const info of COACH_STYLES) say(info.sample);

  // PT 세션 — 워밍업 · 휴식 안내 · 종목 이동 · 시간 · 몸 풀기 · 스트레칭
  const steps = [{ weightKg: 0, reps: 10, restSeconds: 45 }, { weightKg: 40, reps: 5, restSeconds: 60 }, { weightKg: 60, reps: 3, restSeconds: 90 }];
  const [one, two] = [EXERCISES[0]!.name, EXERCISES[1]!.name];
  for (const index of range(3)) say(warmupSetLine(style, one, index, steps));
  say(warmupRestLine(style, 45));
  say(warmupDoneLine(style));
  for (const firstTime of [false, true]) {
    say(restAnnounceLine(style, { seconds: 90, nextSet: 2, firstTime }));
    say(restAnnounceLine(style, { seconds: 30, nextSet: 1, firstTime, nextName: two }));
  }
  say(transitionLines(style, { nextName: one, seconds: 75 }));
  say(transitionLines(style, { nextName: one, seconds: 60, machineSetting: '시트 4' }));
  say(transitionLines(style, { nextName: one, seconds: 90, firstTime: true }));
  say(trimLine(style, [{ name: one, sets: 1 }, { name: two, sets: 2 }]));
  say(timeCheck(style, { elapsedSeconds: 1500, plannedSeconds: 3000, said: [] })?.line);
  say(timeCheck(style, { elapsedSeconds: 2460, plannedSeconds: 3000, said: ['half'] })?.line);
  for (const step of MOBILITY_STEPS) for (const index of [0, 1]) say(mobilityLine(style, step, index, 6, 5));
  say(mobilityDoneLine(style));
  for (const step of COOLDOWN_STEPS) for (const index of [0, 1]) say(cooldownLine(style, step, index, 6));
  say(cooldownSwitchLine(style));
  say(cooldownDoneLine(style));

  say(APP_SAYINGS);
  return out;
}

/** 한 코치 목소리로 만들 조각 전부. */
export function speechCorpus(style: CoachStyle): string[] {
  const wholes = wholeSentences();
  const pieces = new Set<string>([...numberInventory(), ...speechNames()]);
  for (const text of coachTexts(style)) {
    for (const piece of speechPieces(text, (sentence) => wholes.has(sentence))) pieces.add(piece);
  }
  return [...pieces];
}
