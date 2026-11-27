import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildPreview, headlineLift, liftDetail, weightLabel } from '../preview.ts';
import type { PreviewExercise } from '../preview.ts';

function lift(over: Partial<PreviewExercise> = {}): PreviewExercise {
  return {
    name: '벤치프레스',
    equipment: 'barbell',
    pattern: 'horizontalPush',
    weightKg: 105,
    sets: 4,
    repMin: 5,
    repMax: 8,
    previousKg: 102.5,
    ...over,
  };
}

test('대표 종목은 복합 동작을 고른다', () => {
  const fly = lift({ name: '케이블 플라이', equipment: 'cable', pattern: 'isolation', weightKg: 30 });
  const bench = lift();
  assert.equal(headlineLift([fly, bench])?.name, '벤치프레스');
});

test('무게가 커도 머신은 바벨을 밀어내지 못한다', () => {
  const legPress = lift({
    name: '레그프레스', equipment: 'machine', pattern: 'squat', weightKg: 200,
  });
  const squat = lift({ name: '백스쿼트', equipment: 'barbell', pattern: 'squat', weightKg: 140 });
  assert.equal(headlineLift([legPress, squat])?.name, '백스쿼트');
});

test('같은 등급이면 앞에 있는 것 — 프로그램이 메인을 앞에 둔다', () => {
  const press = lift({ name: '오버헤드프레스', pattern: 'verticalPush' });
  const row = lift({ name: '바벨로우', pattern: 'horizontalPull' });
  assert.equal(headlineLift([press, row])?.name, '오버헤드프레스');
});

test('고립 운동뿐이면 그중에서 고른다', () => {
  const curl = lift({ name: '컬', equipment: 'dumbbell', pattern: 'isolation' });
  const fly = lift({ name: '플라이', equipment: 'cable', pattern: 'isolation' });
  assert.equal(headlineLift([curl, fly])?.name, '컬');
});

test('종목이 없으면 대표도 없다', () => {
  assert.equal(headlineLift([]), null);
});

test('올라가면 올라간 만큼 말한다', () => {
  assert.match(liftDetail(lift()), /지난번보다 2\.5kg 올립니다/);
});

test('제자리면 세트와 반복을 대신 말한다', () => {
  assert.match(liftDetail(lift({ previousKg: 105 })), /지난번과 같은 무게로 4세트 × 5~8회/);
});

test('내려가는 데는 이유가 붙는다', () => {
  const dropped = lift({ weightKg: 90 });
  assert.match(liftDetail(dropped, { drop: 'deload' }), /이번 주는 가볍게 하는 주라 12\.5kg 내립니다/);
  assert.match(liftDetail(dropped, { drop: 'comeback' }), /복귀 주라 12\.5kg 내려서 갑니다/);
  assert.match(liftDetail(dropped), /지난번보다 12\.5kg 내려서 갑니다/);
});

test('처음 하는 종목은 비교하지 않는다', () => {
  const detail = liftDetail(lift({ previousKg: null }));
  assert.match(detail, /첫 기록을 남깁니다/);
  assert.doesNotMatch(detail, /지난번/);
});

test('맨몸 종목에 무게를 지어내지 않는다', () => {
  const detail = liftDetail(lift({
    name: '턱걸이', equipment: 'bodyweight', pattern: 'verticalPull',
    weightKg: null, previousKg: null, sets: 3, repMin: 6, repMax: 10,
  }));
  assert.equal(detail, '턱걸이 3세트 × 6~10회');
  assert.doesNotMatch(detail, /kg/);
});

test('반복 범위가 하나면 한 번만 쓴다', () => {
  const detail = liftDetail(lift({ weightKg: null, repMin: 5, repMax: 5 }));
  assert.match(detail, /4세트 × 5회/);
});

test('무게는 필요할 때만 소수점', () => {
  assert.equal(weightLabel(105), '105kg');
  assert.equal(weightLabel(62.5), '62.5kg');
  assert.equal(weightLabel(100.04), '100kg');
});

test('약속이 있으면 언제인지 먼저 말한다', () => {
  const preview = buildPreview({
    sessionName: '상체 A', whenLabel: '목 19:00', exercises: [lift()],
  });
  assert.equal(preview.headline, '목 19:00 · 상체 A');
  assert.match(preview.detail, /^벤치프레스 105kg/);
});

test('약속이 없으면 날 이름만 남는다', () => {
  const preview = buildPreview({ sessionName: '상체 A', whenLabel: null, exercises: [lift()] });
  assert.equal(preview.headline, '상체 A');
  assert.doesNotMatch(preview.headline, /·/);
});

test('종목을 모르면 아는 척하지 않는다', () => {
  const preview = buildPreview({ sessionName: '전신', whenLabel: '월 19:00', exercises: [] });
  assert.equal(preview.lift, null);
  assert.doesNotMatch(preview.detail, /kg/);
});

/* ── 다음 도전 한 줄 ── */
import { challengeLine, nextChallenge, type ChallengeCandidate } from '../preview.ts';

function cand(over: Partial<ChallengeCandidate> = {}): ChallengeCandidate {
  return {
    name: '스쿼트', equipment: 'barbell', pattern: 'squat',
    weightKg: 60, targetReps: 8, previousKg: 60, previousReps: 8, bestKg: 60,
    ...over,
  };
}

test('도전 — 처음 드는 무게는 "첫 도전"', () => {
  const got = nextChallenge([cand({ weightKg: 62.5, bestKg: 60 })]);
  assert.equal(got?.text, '스쿼트 62.5kg 첫 도전');
  assert.equal(challengeLine('다음 화요일', got), '다음 화요일 · 스쿼트 62.5kg 첫 도전');
});

test('도전 — 전에 들어 본 무게로 다시 올리면 "첫"을 붙이지 않는다', () => {
  const got = nextChallenge([cand({ weightKg: 62.5, previousKg: 60, bestKg: 65 })]);
  assert.equal(got?.text, '스쿼트 62.5kg 도전');
});

test('도전 — 같은 무게로 하나 더', () => {
  const got = nextChallenge([cand({ name: '벤치프레스', pattern: 'horizontalPush', targetReps: 9, previousReps: 8 })]);
  assert.equal(got?.text, '벤치프레스 8회 → 9회 도전');
});

test('도전 — 오르는 게 없으면 아무것도 띄우지 않는다(지어내지 않는다)', () => {
  assert.equal(nextChallenge([cand()]), null);
  // 처음 하는 종목은 비교할 지난번이 없다
  assert.equal(nextChallenge([cand({ previousKg: null, previousReps: null, bestKg: null })]), null);
  // 내린 날
  assert.equal(nextChallenge([cand({ weightKg: 55 })]), null);
  // 지난 횟수를 모르면 횟수 도전도 없다
  assert.equal(nextChallenge([cand({ targetReps: 9, previousReps: null })]), null);
  assert.equal(challengeLine('다음 운동', null), '');
});

test('도전 — 덜어내는 주 · 복귀 주에는 띄우지 않는다', () => {
  const up = [cand({ weightKg: 62.5 })];
  assert.equal(nextChallenge(up, { drop: 'deload' }), null);
  assert.equal(nextChallenge(up, { drop: 'comeback' }), null);
});

test('도전 — 첫 무게가 무게 · 횟수보다, 복합 바벨이 고립보다 앞이다', () => {
  const curl = cand({ name: '바벨 컬', pattern: 'isolation', weightKg: 32.5, previousKg: 30, bestKg: 30 });
  const bench = cand({ name: '벤치프레스', pattern: 'horizontalPush', targetReps: 9, previousReps: 8 });
  const squat = cand({ weightKg: 62.5, previousKg: 60, bestKg: 70 });
  const press = cand({ name: '레그프레스', equipment: 'machine', weightKg: 150, previousKg: 140, bestKg: 140 });
  assert.equal(nextChallenge([bench, squat, curl])?.name, '바벨 컬');
  assert.equal(nextChallenge([bench, squat])?.name, '스쿼트');
  assert.equal(nextChallenge([press, curl])?.name, '레그프레스');
});

test('도전 — 맨몸은 횟수로만', () => {
  const pull = cand({ name: '풀업', equipment: 'bodyweight', pattern: 'verticalPull', weightKg: 0, previousKg: 0, bestKg: 0, targetReps: 7, previousReps: 6 });
  assert.equal(nextChallenge([pull])?.text, '풀업 6회 → 7회 도전');
  assert.equal(nextChallenge([cand({ name: '푸시업', equipment: 'bodyweight', weightKg: null, previousKg: 0, bestKg: 0, targetReps: 12, previousReps: 11 })])?.text,
    '푸시업 11회 → 12회 도전');
});
