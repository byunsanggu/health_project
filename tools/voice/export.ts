/**
 * 코치 목소리로 만들 조각 목록을 JSON으로 뽑는다 — generate.py가 읽는다.
 *
 *   node tools/voice/export.ts > /tmp/voice-pieces.json
 *
 * { "styles": { "tough": ["간다!", "열 개", ...], ... }, "samples": { "tough": [{ title, text, sentences: [["조각", ...], ...] }] } }
 * samples는 들어 보기용 — 앱이 실제로 이어 붙이는 대로의 PT 장면 몇 개.
 */
import { afterSetLines, beforeSetLines, lastCallLine, restTipLine, sessionStartLines, wrapUpLines, type CoachStyle } from '../../src/engine/coach.ts';
import { exerciseGuideLines } from '../../src/engine/coachGuide.ts';
import { demoFor } from '../../src/engine/demos.ts';
import { EXERCISES } from '../../src/engine/exercises.ts';
import { restAnnounceLine } from '../../src/engine/ptSession.ts';
import { speechPieces } from '../../src/engine/speech.ts';
import { speechCorpus } from '../../src/engine/speechCorpus.ts';
import { buildCues } from '../../src/engine/tempo.ts';

const STYLES: CoachStyle[] = ['energetic', 'gentle', 'tough', 'fun'];
const bench = EXERCISES.find((item) => item.id === 'barbell-bench-press')!;
const squat = EXERCISES.find((item) => item.id === 'back-squat')!;

function scenes(style: CoachStyle): { title: string; lines: string[] }[] {
  return [
    { title: '시작', lines: sessionStartLines({ style, sessionName: '상체 A', lifts: 5, minutes: 45, weekInBlock: 1, accumulationWeeks: 4, streakWeeks: 3 }) },
    { title: '첫 세트 전', lines: beforeSetLines({ style, exerciseName: bench.name, setIndex: 0, totalSets: 4, weightKg: 62.5, repsMin: 8, repsMax: 10, targetRir: 2, liftIndex: 0, totalLifts: 5, cues: demoFor(bench).cues, last: { date: '2026-10-20', daysAgo: 7, weightKg: 60, reps: 10, rir: 2, sets: 4 } }) },
    { title: '세트 중 (세기)', lines: buildCues({ repRange: { min: 8, max: 10 }, lastCall: lastCallLine(style) }).map((cue) => cue.say) },
    { title: '세트 끝', lines: [...afterSetLines({ style, feel: 'heavy', lastOfLift: false, nextWeightKg: 62.5, deltaKg: 0, at: 1 }), restAnnounceLine(style, { seconds: 90, nextSet: 2 }), restTipLine(style, 3)] },
    { title: '종목 설명', lines: exerciseGuideLines(style, squat) },
    { title: '마무리', lines: wrapUpLines({ style, setsDone: 18, liftsDone: 5, grew: 2, weekDone: 3, weekTarget: 3, goal: 'hypertrophy', at: 1 }) },
  ];
}

const out = {
  styles: Object.fromEntries(STYLES.map((style) => [style, speechCorpus(style)])),
  samples: Object.fromEntries(STYLES.map((style) => {
    const corpus = new Set(speechCorpus(style));
    return [style, scenes(style).map((scene) => ({
      title: scene.title,
      text: scene.lines.join(' '),
      // 문장마다 조각 묶음 — 문장 사이는 조금 더 쉰다
      sentences: scene.lines.map((line) => speechPieces(line, (sentence) => corpus.has(sentence))).filter((pieces) => pieces.length > 0),
    }))];
  })),
};
process.stdout.write(JSON.stringify(out));
