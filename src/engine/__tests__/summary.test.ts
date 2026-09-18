import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { landmarksFor } from '../muscles.ts';
import { bestEffort, summarizeSession } from '../summary.ts';
import { index, session, sets } from './helpers.ts';

const landmarks = landmarksFor('intermediate');
const TODAY = '2026-01-09';

const base = {
  date: TODAY,
  name: '상체 A',
  index,
  landmarks,
};

describe('summarizeSession', () => {
  it('완료한 본세트만 센다 — 워밍업과 0회는 빼고', () => {
    const summary = summarizeSession({
      ...base,
      sets: [
        ...sets('barbell-bench-press', 2, { weightKg: 40, reps: 8, rir: 5, warmup: true }),
        ...sets('barbell-bench-press', 3, { weightKg: 80, reps: 10, rir: 2 }),
        { exerciseId: 'barbell-bench-press', weightKg: 80, reps: 0, rir: 0 },
      ],
      history: [],
    });

    assert.equal(summary.setsCompleted, 3);
    assert.equal(summary.totalReps, 30);
    assert.equal(summary.tonnageKg, 2400);
  });

  it('오늘 볼륨과 이번 주 누적을 나눠서 보여준다', () => {
    const summary = summarizeSession({
      ...base,
      sets: sets('barbell-bench-press', 4, { weightKg: 80, reps: 10, rir: 2 }),
      // 같은 주 월요일에 이미 4세트를 했다
      history: [session('2026-01-05', sets('barbell-bench-press', 4, { weightKg: 80, reps: 10, rir: 2 }))],
    });

    const chest = summary.byMuscle.find((row) => row.muscle === 'chest')!;
    assert.ok(chest.week > chest.today, '주간 누적이 오늘보다 커야 한다');
    assert.equal(chest.landmark.mrv, landmarks.chest.mrv);
  });

  it('오늘 건드리지 않은 부위는 요약에 넣지 않는다', () => {
    const summary = summarizeSession({
      ...base,
      sets: sets('barbell-bench-press', 3, { weightKg: 80, reps: 10, rir: 2 }),
      history: [],
    });
    assert.equal(summary.byMuscle.find((row) => row.muscle === 'calves'), undefined);
  });

  it('중량을 올렸으면 그 사실을 남긴다', () => {
    const summary = summarizeSession({
      ...base,
      sets: sets('barbell-bench-press', 3, { weightKg: 85, reps: 8, rir: 2 }),
      history: [session('2026-01-02', sets('barbell-bench-press', 3, { weightKg: 80, reps: 8, rir: 2 }))],
    });

    const highlight = summary.highlights.find((item) => item.exerciseId === 'barbell-bench-press');
    assert.ok(highlight, '중량 증가가 잡히지 않았다');
    assert.equal(highlight!.kind, 'increase');
    assert.match(highlight!.message, /80kg → 85kg/);
  });

  it('없는 성과를 억지로 만들지 않는다', () => {
    const summary = summarizeSession({
      ...base,
      sets: sets('barbell-bench-press', 3, { weightKg: 80, reps: 8, rir: 2 }),
      history: [session('2026-01-02', sets('barbell-bench-press', 3, { weightKg: 85, reps: 8, rir: 2 }))],
    });
    assert.equal(summary.highlights.length, 0);
    assert.equal(summary.records.length, 0);
  });

  it('오늘 깬 개인 기록만 기록으로 센다', () => {
    const summary = summarizeSession({
      ...base,
      sets: sets('barbell-bench-press', 1, { weightKg: 100, reps: 5, rir: 1 }),
      history: [session('2026-01-02', sets('barbell-bench-press', 3, { weightKg: 80, reps: 8, rir: 2 }))],
    });

    assert.equal(summary.records.length, 1);
    assert.equal(summary.records[0]!.weightKg, 100);
  });

  it('회복 범위를 넘긴 부위는 다음 세션에서 줄인다고 알린다', () => {
    const many = landmarks.chest.mrv + 10;
    const summary = summarizeSession({
      ...base,
      sets: sets('barbell-bench-press', 9, { weightKg: 80, reps: 10, rir: 1 }),
      history: [
        session('2026-01-05', sets('barbell-bench-press', 9, { weightKg: 80, reps: 10, rir: 1 })),
        session('2026-01-07', sets('barbell-bench-press', many, { weightKg: 80, reps: 10, rir: 1 })),
      ],
    });
    assert.ok(summary.notes.some((note) => note.includes('회복 범위')), summary.notes.join(' / '));
  });

  it('조사를 붙여서 말한다', () => {
    const summary = summarizeSession({
      ...base,
      sets: sets('barbell-bench-press', 12, { weightKg: 80, reps: 10, rir: 1 }),
      history: [],
    });
    const joined = summary.notes.join(' ');
    assert.doesNotMatch(joined, /가슴는|등는|복근는|삼두은|이두은|은\(는\)/);
  });

  it('세트가 없으면 없다고 말한다', () => {
    const summary = summarizeSession({ ...base, sets: [], history: [] });
    assert.equal(summary.setsCompleted, 0);
    assert.deepEqual(summary.notes, ['완료한 세트가 없습니다.']);
  });

  it('소요 시간은 분으로 반올림한다', () => {
    const summary = summarizeSession({
      ...base,
      sets: sets('barbell-bench-press', 3, { weightKg: 80, reps: 10, rir: 2 }),
      history: [],
      durationSeconds: 3_270,
    });
    assert.equal(summary.durationMinutes, 55);
  });
});

describe('bestEffort', () => {
  it('추정 1RM이 가장 높은 세트를 고른다', () => {
    const best = bestEffort([
      { exerciseId: 'barbell-bench-press', weightKg: 80, reps: 10, rir: 2 },
      { exerciseId: 'barbell-bench-press', weightKg: 100, reps: 5, rir: 0 },
      { exerciseId: 'barbell-bench-press', weightKg: 60, reps: 12, rir: 3 },
    ])!;
    assert.equal(best.set.weightKg, 100);
    assert.ok(best.value > 100);
  });

  it('워밍업은 후보가 아니다', () => {
    const best = bestEffort([
      { exerciseId: 'barbell-bench-press', weightKg: 200, reps: 1, rir: 5, warmup: true },
      { exerciseId: 'barbell-bench-press', weightKg: 80, reps: 8, rir: 2 },
    ])!;
    assert.equal(best.set.weightKg, 80);
  });

  it('후보가 없으면 null이다', () => {
    assert.equal(bestEffort([]), null);
  });
});
