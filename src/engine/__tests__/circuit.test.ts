import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  CIRCUIT_SCALES,
  MAIN_MINUTES,
  allowedFormat,
  benchmarkForWeek,
  benchmarkHistory,
  buildCircuit,
  circuitClock,
  circuitCueLine,
  circuitCues,
  circuitIntroLine,
  circuitNextLine,
  circuitResultText,
  circuitSeconds,
  circuitSpeechSamples,
  circuitStyleOf,
  circuitWeekPlan,
  compareCircuit,
  intervalCount,
  isCircuitResult,
  moveForRound,
  recordCircuit,
  strengthDaysFor,
  swapCircuit,
  type CircuitFormat,
  type CircuitSession,
} from '../circuit.ts';
import { COMMON_EQUIPMENT_IDS } from '../equipment.ts';
import { HEAVY_PULLS, JUMP_MOVES, exerciseById } from '../exercises.ts';
import { screenExercise } from '../pain.ts';
import { forSpeech } from '../coach.ts';
import { speechPieces } from '../speech.ts';
import { speechCorpus } from '../speechCorpus.ts';
import { buildStreak, hasWorkout } from '../streak.ts';
import { readBackup } from '../backup.ts';
import type { PainReport, TrainingLevel } from '../types.ts';

const LEVELS: TrainingLevel[] = ['beginner', 'intermediate', 'advanced', 'expert'];
const FORMATS: CircuitFormat[] = ['amrap', 'emom', 'forTime', 'intervals'];
const DATE = '2026-11-28';

/** 한 서킷에 나오는 동작 전부 — 쉽게 · 기본 · 어렵게 다 */
function allMoves(session: CircuitSession): string[] {
  const ids = session.main.movements.flatMap((item) => CIRCUIT_SCALES.map((scale) => item.scales[scale].exerciseId));
  return [...ids, ...(session.extra?.moves.map((move) => move.exerciseId) ?? [])];
}

describe('서킷 — 하루 만들기', () => {
  it('단계마다 본 운동 길이가 범위 안이고 동작이 셋 이상이다', () => {
    for (const level of LEVELS) {
      for (const format of FORMATS) {
        for (const minutes of [20, 30, 45, 60]) {
          const session = buildCircuit({ level, date: DATE, equipmentIds: COMMON_EQUIPMENT_IDS, format, minutes, weekIndex: 4, seed: minutes });
          const [low, high] = MAIN_MINUTES[level];
          assert.ok(session.main.minutes >= low && session.main.minutes <= high, `${level} ${format} ${minutes}: ${session.main.minutes}`);
          assert.ok(session.main.movements.length >= 2, `${level} ${format}`);
          if (session.main.shape === 'rounds') assert.ok(session.main.movements.length >= 3, `${level} ${format}`);
          assert.ok(session.warmup.length > 0 && session.cooldown.length > 0);
          assert.ok(session.main.how.length > 10);
        }
      }
    }
  });

  it('쓸 수 있는 시간을 넘지 않는다 — 몸 풀기 · 본 운동 · 몸통 · 스트레칭을 다 합쳐도', () => {
    for (const level of LEVELS) {
      for (const format of FORMATS) {
        for (let minutes = 20; minutes <= 60; minutes += 5) {
          const session = buildCircuit({ level, date: DATE, equipmentIds: COMMON_EQUIPMENT_IDS, format, minutes, weekIndex: 4 });
          assert.ok(session.totalMinutes <= minutes, `${level} ${format} ${minutes}분: ${session.totalMinutes}분`);
          const sum = session.warmupMinutes + session.main.minutes + (session.extra?.minutes ?? 0) + session.cooldownMinutes;
          assert.equal(session.totalMinutes, sum);
        }
      }
    }
  });

  it('시간이 아주 짧으면 본 운동을 단계의 최소 길이로 두고 그렇다고 말한다', () => {
    const session = buildCircuit({ level: 'advanced', date: DATE, equipmentIds: COMMON_EQUIPMENT_IDS, format: 'amrap', minutes: 12 });
    assert.equal(session.main.minutes, MAIN_MINUTES.advanced[0]);
    assert.ok(session.notes.some((note) => note.includes('가장 짧은')));
  });

  it('바벨 · 스미스 · 무거운 당기기 · 기술 동작은 어느 단계에도 나오지 않는다', () => {
    for (const level of LEVELS) {
      for (const format of FORMATS) {
        for (let seed = 0; seed < 12; seed += 1) {
          const session = buildCircuit({ level, date: DATE, format, seed, weekIndex: 6 });
          for (const id of allMoves(session)) {
            const exercise = exerciseById(id)!;
            assert.ok(exercise.equipment !== 'barbell' && exercise.equipment !== 'smith', `${level}: ${id}`);
            assert.ok(!HEAVY_PULLS.has(id), id);
            assert.ok(!['pull-up', 'chin-up', 'chest-dip', 'triceps-dip', 'pike-push-up'].includes(id), id);
          }
        }
      }
    }
  });

  it('초보에게는 뛰는 동작이 없다 — 쉽게 · 어렵게로 바꿔도', () => {
    for (const format of FORMATS) {
      for (let seed = 0; seed < 20; seed += 1) {
        const session = buildCircuit({ level: 'beginner', date: DATE, format, seed, weekIndex: 8 });
        for (const id of allMoves(session)) assert.ok(!JUMP_MOVES.has(id), `${format} ${seed}: ${id}`);
      }
    }
  });

  it('아픈 날에는 뛰는 동작이 없고, 아픈 곳에 부담이 큰 동작도 없다', () => {
    const pain: PainReport[] = [{ joint: 'knee', score: 4 }];
    for (const level of ['intermediate', 'advanced'] as const) {
      for (let seed = 0; seed < 20; seed += 1) {
        const session = buildCircuit({ level, date: DATE, format: 'amrap', seed, pain, equipmentIds: COMMON_EQUIPMENT_IDS, weekIndex: 4 });
        for (const id of allMoves(session)) {
          assert.ok(!JUMP_MOVES.has(id), id);
          assert.equal(screenExercise(exerciseById(id)!, pain).action, 'allow', id);
        }
        assert.ok(session.notes.some((note) => note.includes('아프다고')));
      }
    }
    // 어깨만 아파도 뛰는 동작은 뺀다(아픈 날)
    const shoulder = buildCircuit({ level: 'advanced', date: DATE, format: 'intervals', pain: [{ joint: 'shoulder', score: 2 }], seed: 4 });
    for (const id of allMoves(shoulder)) assert.ok(!JUMP_MOVES.has(id), id);
  });

  it('기구에 맞춘다 — 매트뿐이면 맨몸 동작만, 덤벨 집이면 들고 하는 것만', () => {
    const mat = buildCircuit({ level: 'intermediate', date: DATE, equipmentIds: ['floor'], format: 'amrap', weekIndex: 4 });
    assert.ok(mat.main.movements.length >= 3);
    for (const id of allMoves(mat)) assert.ok(['bodyweight', 'band'].includes(exerciseById(id)!.equipment), id);
    const home = buildCircuit({ level: 'intermediate', date: DATE, equipmentIds: ['floor', 'dumbbells', 'adjustable-bench'], format: 'emom', weekIndex: 4 });
    for (const id of allMoves(home)) assert.ok(!['machine', 'cable'].includes(exerciseById(id)!.equipment), id);
  });

  it('기계 · 케이블은 한 바퀴에 하나까지 — 붐비는 헬스장에서 세 대를 오가지 않는다', () => {
    for (let seed = 0; seed < 30; seed += 1) {
      const session = buildCircuit({ level: 'advanced', date: DATE, equipmentIds: COMMON_EQUIPMENT_IDS, format: 'amrap', minutes: 45, seed });
      const fixed = session.main.movements.filter((item) => ['machine', 'cable'].includes(exerciseById(item.scales.base.exerciseId)!.equipment));
      assert.ok(fixed.length <= 1, `${seed}: ${fixed.map((item) => item.scales.base.name)}`);
    }
  });

  it('오늘 근력 운동 대신이면 그날 쓰려던 부위를 쓴다', () => {
    const lower = swapCircuit({ level: 'intermediate', date: DATE, equipmentIds: COMMON_EQUIPMENT_IDS, focusMuscles: ['quads', 'glutes', 'hamstrings'], minutes: 45, seed: 2 });
    const lowerHits = lower.main.movements.filter((item) => ['squat', 'lunge', 'hinge'].includes(item.slot)).length;
    assert.ok(lowerHits >= 2, lower.main.movements.map((item) => item.slot).join());
    const upper = swapCircuit({ level: 'intermediate', date: DATE, equipmentIds: COMMON_EQUIPMENT_IDS, focusMuscles: ['chest', 'back', 'frontDelt', 'triceps'], minutes: 45, seed: 2 });
    const upperHits = upper.main.movements.filter((item) => ['push', 'pull', 'press'].includes(item.slot)).length;
    assert.ok(upperHits >= 2, upper.main.movements.map((item) => item.slot).join());
    assert.ok(upper.targetMuscles.includes('chest') || upper.targetMuscles.includes('back'));
  });

  it('비슷한 길이 — 오늘 운동 시간에 맞춰 본 운동이 길어지고 짧아진다', () => {
    const short = swapCircuit({ level: 'intermediate', date: DATE, equipmentIds: COMMON_EQUIPMENT_IDS, minutes: 20, format: 'amrap' });
    const long = swapCircuit({ level: 'intermediate', date: DATE, equipmentIds: COMMON_EQUIPMENT_IDS, minutes: 45, format: 'amrap' });
    assert.ok(short.totalMinutes <= 20 && long.totalMinutes > short.totalMinutes);
  });
});

describe('서킷 — 방식', () => {
  it('초보는 빨리 끝내기 · 사다리 · 긴 목록을 받지 않고, 처음 두 주는 시계가 정하는 방식만', () => {
    assert.deepEqual(allowedFormat('beginner', 0, 'forTime'), { format: 'emom', shape: 'rounds' });
    assert.deepEqual(allowedFormat('beginner', 0, 'amrap'), { format: 'emom', shape: 'rounds' });
    assert.deepEqual(allowedFormat('beginner', 3, 'forTime', 'chipper'), { format: 'amrap', shape: 'rounds' });
    assert.deepEqual(allowedFormat('beginner', 3, 'amrap', 'ladder'), { format: 'amrap', shape: 'rounds' });
    for (let week = 0; week < 2; week += 1) {
      for (const format of FORMATS) {
        const session = buildCircuit({ level: 'beginner', date: DATE, format, weekIndex: week });
        assert.ok(['emom', 'intervals'].includes(session.main.format), `${week} ${format} → ${session.main.format}`);
      }
    }
  });

  it('하고 쉬기 — 20초/10초는 고급 이상만, 초보는 30초/30초에서 시작한다', () => {
    const at = (level: TrainingLevel, week = 0) => buildCircuit({ level, date: DATE, format: 'intervals', weekIndex: week }).main;
    assert.deepEqual([at('beginner').workSeconds, at('beginner').restSeconds], [30, 30]);
    assert.deepEqual([at('beginner', 4).workSeconds, at('beginner', 4).restSeconds], [40, 20]);
    assert.deepEqual([at('intermediate').workSeconds, at('intermediate').restSeconds], [40, 20]);
    assert.deepEqual([at('advanced').workSeconds, at('advanced').restSeconds], [20, 10]);
  });

  it('사다리 · 긴 목록은 중급부터, 사다리는 바퀴마다 횟수가 는다', () => {
    const ladder = buildCircuit({ level: 'intermediate', date: DATE, format: 'amrap', shape: 'ladder', weekIndex: 4 });
    assert.equal(ladder.main.shape, 'ladder');
    const move = ladder.main.movements.find((item) => item.scales.base.unit === 'reps')!.scales.base;
    assert.equal(moveForRound(ladder.main, move, 0).amount, 2);
    assert.equal(moveForRound(ladder.main, move, 3).amount, 8);
    const chipper = buildCircuit({ level: 'advanced', date: DATE, format: 'forTime', shape: 'chipper', weekIndex: 4 });
    assert.equal(chipper.main.rounds, 1);
    assert.equal(chipper.main.movements.length, 5);
  });

  it('빨리 끝내기 바퀴 수가 제한 시간 안에 들어온다', () => {
    for (const level of ['intermediate', 'advanced'] as const) {
      const session = buildCircuit({ level, date: DATE, equipmentIds: COMMON_EQUIPMENT_IDS, format: 'forTime', minutes: 40 });
      assert.ok(session.main.rounds! >= 2 && session.main.rounds! <= 6);
      assert.match(session.main.title, /제한/);
    }
  });

  it('한 주 — 서킷 위주면 1~2번은 근력 날, 서킷 날마다 방식 · 쓰는 곳이 돈다', () => {
    assert.equal(strengthDaysFor(3), 1);
    assert.equal(strengthDaysFor(5), 2);
    for (const days of [2, 3, 4, 5, 6]) {
      const plan = circuitWeekPlan({ daysPerWeek: days, level: 'intermediate', weekIndex: 3, style: 'circuit' });
      assert.equal(plan.days.length, days);
      assert.ok(plan.strengthDays >= 1 && plan.strengthDays <= 2, `${days}: ${plan.strengthDays}`);
      assert.ok(plan.circuitDays >= plan.strengthDays, `${days}`);
      const circuits = plan.days.filter((day) => day.kind === 'circuit');
      for (let i = 1; i < circuits.length; i += 1) {
        const a = circuits[i - 1]!;
        const b = circuits[i]!;
        assert.ok(a.format !== b.format || a.shape !== b.shape || a.focus !== b.focus, `${days}: 같은 서킷이 이어진다`);
      }
    }
    const mixed = circuitWeekPlan({ daysPerWeek: 4, level: 'intermediate', weekIndex: 0, style: 'mixed' });
    assert.ok(mixed.days.every((day) => day.kind === 'strength'));
    assert.equal(circuitStyleOf('circuit'), 'circuit');
    assert.equal(circuitStyleOf('뭔가'), 'mixed');
  });

  it('주마다 방식이 바뀐다 — 넉 주 동안 같은 날에 같은 방식만 오지 않는다', () => {
    const second = (week: number) => circuitWeekPlan({ daysPerWeek: 4, level: 'advanced', weekIndex: week, style: 'circuit' }).days
      .filter((day) => day.kind === 'circuit')[1]!;
    const seen = new Set([0, 1, 2, 3].map((week) => `${second(week).format}/${second(week).shape}`));
    assert.ok(seen.size >= 3, [...seen].join());
  });
});

describe('서킷 — 강도', () => {
  it('동작마다 쉽게 · 기본 · 어렵게가 있고, 쉽게는 덜 힘들고 어렵게는 더 힘들다', () => {
    for (const level of LEVELS) {
      const session = buildCircuit({ level, date: DATE, equipmentIds: COMMON_EQUIPMENT_IDS, format: 'amrap', weekIndex: 4, seed: 3 });
      for (const item of session.main.movements) {
        const { easy, base, hard } = item.scales;
        if (easy.exerciseId === base.exerciseId) assert.ok(easy.amount < base.amount, `${level} ${base.name} 쉽게`);
        if (hard.exerciseId === base.exerciseId) assert.ok(hard.amount > base.amount, `${level} ${base.name} 어렵게`);
        assert.ok(easy.exerciseId !== base.exerciseId || easy.amount !== base.amount);
      }
    }
  });

  it('푸시업은 쉽게 하면 무릎 · 벽에 기대는 푸시업으로 바뀐다', () => {
    const session = buildCircuit({ level: 'intermediate', date: DATE, equipmentIds: ['floor'], format: 'amrap', focus: 'upper', weekIndex: 4 });
    const push = session.main.movements.find((item) => item.scales.base.exerciseId === 'push-up');
    assert.ok(push, session.main.movements.map((item) => item.scales.base.exerciseId).join());
    assert.ok(['knee-push-up', 'incline-push-up'].includes(push!.scales.easy.exerciseId));
  });

  it('기록에 고른 강도가 남는다', () => {
    const session = buildCircuit({ level: 'intermediate', date: DATE, equipmentIds: COMMON_EQUIPMENT_IDS, format: 'amrap' });
    const first = session.main.movements[0]!.scales.base.exerciseId;
    const result = recordCircuit(session, { rounds: 7, extraReps: 12 }, { [first]: 'easy' }, 'r1');
    assert.equal(result.scales[first], 'easy');
    assert.ok(Object.values(result.scales).filter((scale) => scale === 'base').length >= 2);
    assert.equal(result.moves[0], `${session.main.movements[0]!.scales.easy.name} ${session.main.movements[0]!.scales.easy.display}`);
    assert.equal(circuitResultText(result), '7바퀴 + 12회');
    assert.ok(isCircuitResult(result));
  });
});

describe('서킷 — 기본 서킷', () => {
  it('4주마다 1 · 2 · 3이 돌아오고 넷째 주는 쉰다', () => {
    assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 7].map(benchmarkForWeek), [1, 2, 3, null, 1, 2, 3, null]);
  });

  it('같은 기본 서킷은 날짜 · 무작위 값이 달라도 구성이 같다 — 지난번과 견줄 수 있게', () => {
    for (const level of LEVELS) {
      for (const number of [1, 2, 3] as const) {
        const a = buildCircuit({ level, date: '2026-11-02', equipmentIds: COMMON_EQUIPMENT_IDS, benchmark: number, seed: 11, weekIndex: 2, minutes: 30 });
        const b = buildCircuit({ level, date: '2026-11-30', equipmentIds: COMMON_EQUIPMENT_IDS, benchmark: number, seed: 97, weekIndex: 6, minutes: 45 });
        assert.equal(a.signature, b.signature, `${level} ${number}`);
        assert.equal(a.name, `기본 서킷 ${number}`);
      }
    }
  });

  it('한 주 계획의 첫 서킷이 그 주의 기본 서킷이다', () => {
    const week0 = circuitWeekPlan({ daysPerWeek: 3, level: 'intermediate', weekIndex: 0, style: 'circuit' });
    assert.equal(week0.days.find((day) => day.kind === 'circuit')!.benchmark, 1);
    const week4 = circuitWeekPlan({ daysPerWeek: 3, level: 'intermediate', weekIndex: 4, style: 'circuit' });
    assert.equal(week4.days.find((day) => day.kind === 'circuit')!.benchmark, 1);
    const week3 = circuitWeekPlan({ daysPerWeek: 3, level: 'intermediate', weekIndex: 3, style: 'circuit' });
    assert.ok(week3.days.every((day) => !day.benchmark));
  });

  it('지난번과 견준다 — 나아졌으면 나아졌다고, 강도를 바꿨으면 그렇다고', () => {
    const session = buildCircuit({ level: 'intermediate', date: DATE, equipmentIds: COMMON_EQUIPMENT_IDS, benchmark: 1 });
    const first = session.main.movements[0]!.scales.base.exerciseId;
    const before = recordCircuit({ ...session, date: '2026-10-31' }, { rounds: 6, extraReps: 4 }, {}, 'a');
    const now = recordCircuit(session, { rounds: 7, extraReps: 12 }, {}, 'b');
    const comparison = compareCircuit(now, [before]);
    assert.equal(comparison.trend, 'better');
    assert.match(comparison.text, /지난번 6바퀴 \+ 4회 → 오늘 7바퀴 \+ 12회/);
    const easier = recordCircuit(session, { rounds: 7 }, { [first]: 'easy' }, 'c');
    assert.equal(compareCircuit(easier, [before]).scaleChanged, true);
    assert.match(compareCircuit(easier, [before]).text, /강도/);
    // 처음이면 견주지 않고, 4주 뒤에 다시 한다고만
    assert.match(compareCircuit(before, []).text, /4주 뒤/);
    assert.deepEqual(benchmarkHistory([now, before], 1).map((item) => item.id), ['b', 'a']);
  });

  it('중간에 그만두면 그만둔 자리까지 기록한다', () => {
    const amrap = buildCircuit({ level: 'intermediate', date: DATE, format: 'amrap', minutes: 30 });
    const stoppedAmrap = recordCircuit(amrap, { rounds: 3, extraReps: 4, stoppedAtSecond: 420 }, {}, 'a');
    assert.equal(circuitResultText(stoppedAmrap), '3바퀴 + 4회 · 7분에서 멈춤');
    const emom = buildCircuit({ level: 'intermediate', date: DATE, format: 'emom', minutes: 30 });
    const stoppedEmom = recordCircuit(emom, { stoppedAtSecond: 125 }, {}, 'e');
    assert.equal(stoppedEmom.completed, false);
    assert.equal(circuitResultText(stoppedEmom), '2분에서 멈춤');
    assert.equal(circuitResultText(recordCircuit(emom, { completed: true }, {}, 'f')), `${emom.main.minutes}분 끝까지`);
    const forTime = buildCircuit({ level: 'advanced', date: DATE, format: 'forTime', minutes: 30 });
    const stoppedTime = recordCircuit(forTime, { rounds: 1, extraReps: 0, stoppedAtSecond: 300 }, {}, 't');
    assert.equal(stoppedTime.capped, true);
    assert.equal(circuitResultText(stoppedTime), '1바퀴 · 5분에서 멈춤');
  });

  it('빨리 끝내기는 짧을수록 좋다', () => {
    const session = buildCircuit({ level: 'advanced', date: DATE, benchmark: 3 });
    assert.equal(session.main.format, 'forTime');
    const slow = recordCircuit({ ...session, date: '2026-10-31' }, { seconds: 800 }, {}, 's');
    const fast = recordCircuit(session, { seconds: 754 }, {}, 'f');
    assert.equal(compareCircuit(fast, [slow]).trend, 'better');
    assert.equal(circuitResultText(fast), '12:34');
    const capped = recordCircuit(session, { seconds: 99999, rounds: 2, extraReps: 5 }, {}, 'c');
    assert.equal(capped.capped, true);
    assert.equal(compareCircuit(capped, [slow]).trend, 'worse');
  });
});

describe('서킷 — 시계', () => {
  const emom = buildCircuit({ level: 'intermediate', date: DATE, format: 'emom', minutes: 25, equipmentIds: COMMON_EQUIPMENT_IDS });

  it('1분마다 — 분이 바뀌면 다음 동작으로, 바뀌기 3 · 2 · 1초 전에 삑', () => {
    const n = emom.main.movements.length;
    assert.equal(circuitClock(emom.main, 30).movementIndex, 0);
    assert.equal(circuitClock(emom.main, 61).movementIndex, 1 % n);
    assert.equal(circuitClock(emom.main, 61).segmentLeft, 59);
    assert.equal(circuitClock(emom.main, 60 * n + 1).movementIndex, 0);
    const cues = circuitCues(emom.main);
    for (const at of [57, 58, 59]) assert.ok(cues.some((cue) => cue.at === at && cue.kind === 'beep'), String(at));
    assert.ok(cues.some((cue) => cue.at === 60 && cue.kind === 'next' && cue.movementIndex === 1 % n));
    assert.equal(cues.filter((cue) => cue.kind === 'next').length, emom.main.minutes - 1);
    assert.ok(cues.some((cue) => cue.kind === 'last'));
    assert.equal(cues[cues.length - 1]!.kind, 'done');
    assert.equal(cues[cues.length - 1]!.at, emom.main.minutes * 60);
  });

  it('하고 쉬기 — 운동 · 쉬기가 번갈아 오고, 쉬는 동안 다음 동작을 알린다', () => {
    const session = buildCircuit({ level: 'beginner', date: DATE, format: 'intervals', minutes: 25, weekIndex: 0 });
    const main = session.main;
    assert.equal(circuitClock(main, 10).working, true);
    assert.equal(circuitClock(main, 40).working, false);
    assert.equal(circuitClock(main, 40).movementIndex, 1);
    assert.equal(circuitSeconds(main), intervalCount(main) * 60 - 30);
    const cues = circuitCues(main);
    assert.ok(cues.some((cue) => cue.kind === 'rest' && cue.at === 30 && cue.movementIndex === 1));
    assert.ok(cues.some((cue) => cue.kind === 'go' && cue.at === 60));
  });

  it('시간 안에 최대한 — 절반 · 1분 · 30초 · 10초 · 끝', () => {
    const session = buildCircuit({ level: 'intermediate', date: DATE, format: 'amrap', minutes: 30, equipmentIds: COMMON_EQUIPMENT_IDS });
    const kinds = circuitCues(session.main).map((cue) => cue.kind);
    for (const kind of ['start', 'half', 'oneMinute', 'thirtySec', 'last10', 'done'] as const) assert.ok(kinds.includes(kind), kind);
    assert.equal(circuitClock(session.main, session.main.minutes * 60 + 5).over, true);
  });
});

describe('서킷 — 약속 · 백업', () => {
  it('서킷만 한 날도 운동한 날이다', () => {
    assert.equal(hasWorkout({ sets: [], circuit: [{}] }), true);
    assert.equal(hasWorkout({ sets: [] }), false);
    const sessions = ['2026-11-23', '2026-11-25', '2026-11-27'].map((date) => ({ date, sets: [], circuit: [{ id: date }] }));
    const streak = buildStreak({ sessions, thisMonday: '2026-11-23', target: 3, today: '2026-11-28' });
    assert.equal(streak.weeks[0]!.days, 3);
    assert.equal(streak.weeks[0]!.kept, true);
  });

  it('백업 파일에서 서킷 기록 · 방식 고른 것을 되살린다', () => {
    const session = buildCircuit({ level: 'intermediate', date: DATE, format: 'amrap' });
    const result = recordCircuit(session, { rounds: 5 }, {}, 'x');
    const text = JSON.stringify({
      앱: '볼륨 코치', 형식: 2,
      설문: { selfReportedLevel: 'intermediate', bodyweightKg: 70, daysPerWeek: 3, goals: ['conditioning'], gym: { equipmentIds: ['floor'] }, circuitStyle: 'circuit' },
      운동기록: [{ date: DATE, sets: [], circuit: [result, { 엉뚱한: 1 }] }],
    });
    const read = readBackup(text);
    assert.ok(read.ok);
    if (!read.ok) return;
    assert.equal(read.backup.sessions.length, 1);
    assert.equal((read.backup.sessions[0]!.circuit as unknown[]).length, 1);
    assert.equal(read.backup.answers?.circuitStyle, 'circuit');
  });
});

describe('서킷 — 코치 말', () => {
  const STYLES = ['tough', 'energetic', 'gentle', 'fun'] as const;
  const POLITE_END = /(니다|요|죠)[.!?]/;

  it('빡센 코치만 반말, 나머지는 존댓말', () => {
    const tough = circuitSpeechSamples('tough').join(' ') + circuitNextLine('tough', { name: '푸시업', amount: 10, unit: 'reps' });
    assert.doesNotMatch(tough, POLITE_END);
    for (const style of ['energetic', 'gentle', 'fun'] as const) {
      for (const moment of ['thirtySec', 'last', 'done', 'round'] as const) assert.match(circuitCueLine(style, moment), POLITE_END, `${style} ${moment}`);
    }
  });

  it('아무 서킷에서 나온 말도 전부 목소리 조각으로 덮인다', () => {
    for (const style of STYLES) {
      const corpus = new Set(speechCorpus(style));
      const lines: string[] = [...circuitSpeechSamples(style)];
      for (const level of LEVELS) {
        for (const format of FORMATS) {
          for (let seed = 0; seed < 6; seed += 1) {
            const session = buildCircuit({ level, date: DATE, format, seed, weekIndex: seed, equipmentIds: seed % 2 ? COMMON_EQUIPMENT_IDS : undefined });
            lines.push(circuitIntroLine(style, session.main.format, session.main.minutes));
            for (const item of session.main.movements) {
              for (const scale of CIRCUIT_SCALES) {
                for (let round = 0; round < 4; round += 1) lines.push(circuitNextLine(style, moveForRound(session.main, item.scales[scale], round)));
              }
            }
            for (const move of session.extra?.moves ?? []) lines.push(circuitNextLine(style, move));
          }
        }
      }
      for (const line of lines) {
        for (const piece of speechPieces(forSpeech(line), (sentence) => corpus.has(sentence))) assert.ok(corpus.has(piece), `${style}: ${piece} ← ${line}`);
      }
    }
  });
});
