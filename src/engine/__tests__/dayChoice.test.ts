import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { assessDay, dayOptions, daysSinceMuscle, skipNote, templateMuscles } from '../dayChoice.ts';
import { EXERCISES } from '../exercises.ts';
import type { SessionTemplate } from '../session.ts';
import type { SessionLog } from '../types.ts';

const byId = (id: string) => EXERCISES.find((exercise) => exercise.id === id);

const UPPER: SessionTemplate = {
  name: '상체 A',
  slots: [
    { exerciseId: 'barbell-bench-press', sets: 4, repRange: { min: 6, max: 10 } },
    { exerciseId: 'lat-pulldown', sets: 4, repRange: { min: 8, max: 12 } },
    { exerciseId: 'barbell-curl', sets: 3, repRange: { min: 10, max: 15 } },
  ],
};

const LOWER: SessionTemplate = {
  name: '하체 A',
  slots: [
    { exerciseId: 'back-squat', sets: 4, repRange: { min: 6, max: 10 } },
    { exerciseId: 'romanian-deadlift', sets: 3, repRange: { min: 8, max: 12 } },
  ],
};

function log(date: string, exerciseIds: string[]): SessionLog {
  return {
    date,
    sets: exerciseIds.map((exerciseId) => ({ exerciseId, weightKg: 60, reps: 8, rir: 2 })),
  } as SessionLog;
}

describe('오늘 할 날 고르기', () => {
  test('그 날의 부위를 기여도 큰 것부터 뽑는다', () => {
    const muscles = templateMuscles(LOWER, byId);
    assert.ok(muscles.includes('quads'));
    assert.ok(muscles.includes('glutes'));
    // 상체 부위가 하체 날의 주요 부위로 올라오면 안 된다
    assert.equal(muscles.includes('chest'), false);
  });

  test('스치기만 한 부위는 그 날의 부위가 아니다', () => {
    /*
     * 합계 1 미만은 보조로 조금 쓰인 것이다. 그걸 그 날의 부위로 세면
     * "어제 했습니다" 경고가 아무 데서나 뜬다.
     */
    const muscles = templateMuscles(UPPER, byId);
    assert.ok(muscles.includes('chest'));
    assert.equal(muscles.includes('calves'), false);
  });

  test('보조로 스친 세트는 "그 부위를 했다"로 세지 않는다', () => {
    // 데드리프트에서 대퇴사두는 0.3이다. 이걸로 다리를 했다고 하면 안 된다.
    const sessions = [log('2026-09-18', ['conventional-deadlift'])];
    assert.equal(daysSinceMuscle('quads', sessions, '2026-09-19', byId), Number.POSITIVE_INFINITY);
    assert.equal(daysSinceMuscle('glutes', sessions, '2026-09-19', byId), 1);
  });

  test('워밍업 세트는 세지 않는다', () => {
    const sessions = [{
      date: '2026-09-18',
      sets: [{ exerciseId: 'back-squat', weightKg: 40, reps: 5, rir: 5, warmup: true }],
    } as SessionLog];
    assert.equal(daysSinceMuscle('quads', sessions, '2026-09-19', byId), Number.POSITIVE_INFINITY);
  });

  test('어제 한 부위면 경고한다 — 막지는 않는다', () => {
    const sessions = [log('2026-09-18', ['back-squat'])];
    const option = assessDay(LOWER, { scheduled: true, sessions, today: '2026-09-19', exerciseById: byId });
    assert.equal(option.readiness, 'soon');
    assert.match(option.note, /어제/);
    // 고를 수 없게 만드는 필드는 없다. 판단은 사용자가 한다.
    assert.equal('disabled' in option, false);
  });

  test('오늘 이미 한 부위면 더 세게 말한다', () => {
    const sessions = [log('2026-09-19', ['back-squat'])];
    const option = assessDay(LOWER, { scheduled: true, sessions, today: '2026-09-19', exerciseById: byId });
    assert.equal(option.readiness, 'tired');
  });

  test('이틀 지나면 회복으로 본다', () => {
    const sessions = [log('2026-09-17', ['back-squat'])];
    const option = assessDay(LOWER, { scheduled: true, sessions, today: '2026-09-19', exerciseById: byId });
    assert.equal(option.readiness, 'fresh');
  });

  test('주요 부위 중 가장 최근 것을 본다 — 평균이 아니다', () => {
    /*
     * 하체 날에 둔근은 4일 전, 대퇴사두는 어제라면 문제가 되는 건
     * 대퇴사두다. 평균을 내면 "회복됐다"가 나와서 위험하다.
     */
    const sessions = [log('2026-09-15', ['hip-thrust']), log('2026-09-18', ['back-squat'])];
    const option = assessDay(LOWER, { scheduled: true, sessions, today: '2026-09-19', exerciseById: byId });
    assert.equal(option.daysSince, 1);
  });

  test('회복된 날이 위로 온다 — 정렬이 곧 조언이다', () => {
    const sessions = [log('2026-09-18', ['back-squat', 'romanian-deadlift'])];
    const sorted = dayOptions([LOWER, UPPER], {
      scheduledIndex: 0, sessions, today: '2026-09-19', exerciseById: byId,
    });
    assert.equal(sorted[0]!.template.name, '상체 A');
  });

  test('조건이 같으면 원래 차례가 위로', () => {
    // 이유 없이 프로그램 순서를 흔들지 않는다.
    const sorted = dayOptions([UPPER, LOWER], {
      scheduledIndex: 1, sessions: [], today: '2026-09-19', exerciseById: byId,
    });
    assert.equal(sorted[0]!.template.name, '하체 A');
  });

  test('건너뛴 날이 사라지지 않는다고 말한다', () => {
    const note = skipNote(LOWER, UPPER);
    assert.match(note, /밀립니다/);
    // 조사가 이름에 맞아야 한다 — "상체 A를", "하체 A는"
    assert.match(note, /상체 A를/);
    assert.match(note, /하체 A는/);
  });

  test('같은 날을 다시 고르면 할 말이 없다', () => {
    assert.equal(skipNote(LOWER, LOWER), '');
  });
});
