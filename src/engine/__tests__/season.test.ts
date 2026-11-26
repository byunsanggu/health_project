import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  CAREER_LADDERS, MAX_MULTIPLIER, PROMOTE_AT, STAGE_COUNT, advanceCareer, avatarGrowth, cosmeticsFor, emptyCareer,
  markShortDate, normalizeCareer, outcomeFor, outcomeLine, seasonDayLine, seasonFeedbackLine, seasonProgress,
  seasonStrengthHighlight, seasonWindow, stageLabel, trackForGoals, GROWTH_PARTS,
  type CareerInput, type CareerState, type SeasonBlock,
} from '../season.ts';
import { STAGE_MOTION_IDS, stageMotionFor } from '../motionsStage.ts';
import { clipFrame } from '../motionKit.ts';
import { addDays } from '../volume.ts';
import type { SessionLog } from '../types.ts';

const day = (date: string, weightKg = 60, exerciseId = 'barbell-bench-press'): SessionLog =>
  ({ id: date, date, updatedAt: date, sets: [{ exerciseId, weightKg, reps: 8, rir: 2 }] }) as SessionLog;

/** 그 주 월요일부터 count일 */
const week = (monday: string, count: number, weightKg = 60): SessionLog[] =>
  Array.from({ length: count }, (_, i) => day(addDays(monday, i), weightKg));

// 중급: 축적 5주 + 피킹 주 = 6주. 2026-09-07(월) ~ 2026-10-18(일)
const BLOCK: SeasonBlock = { startedOn: '2026-09-07', level: 'intermediate' };
const WINDOW = seasonWindow(BLOCK);
const MONDAYS = WINDOW.weeks;

/** 시즌 내내 약속(target회)을 지킨 기록. 피킹 주는 절반(최소 2회)만 하면 지킨 것이다 */
function keptSeason(target: number, perWeek = target): SessionLog[] {
  return MONDAYS.flatMap((monday) => week(monday, monday === WINDOW.peak ? Math.max(2, Math.ceil(target / 2)) : perWeek));
}

const score = (sessions: SessionLog[], target: number, extra: Partial<Parameters<typeof seasonProgress>[0]> = {}) =>
  seasonProgress({ sessions, window: WINDOW, target, today: '2026-10-19', ...extra });

describe('시즌 기간', () => {
  it('한 블록이 한 시즌 — 축적 주 다음 주가 피킹 주, 그 주 일요일이 대회 당일', () => {
    assert.equal(WINDOW.start, '2026-09-07');
    assert.equal(WINDOW.peak, '2026-10-12');
    assert.equal(WINDOW.end, '2026-10-18');
    assert.equal(WINDOW.weeks.length, 6);
  });

  it('피로로 일찍 덜어냈으면 그 주가 피킹 주다', () => {
    const early = seasonWindow({ ...BLOCK, deloadOn: '2026-09-28' });
    assert.equal(early.peak, '2026-09-28');
    assert.equal(early.end, '2026-10-04');
    assert.equal(early.weeks.length, 4);
  });

  it('단계마다 시즌 길이가 다르다 (초보는 축적 6주)', () => {
    assert.equal(seasonWindow({ startedOn: '2026-09-09', level: 'beginner' }).weeks.length, 7);
    assert.equal(seasonWindow({ startedOn: '2026-09-09', level: 'beginner' }).start, '2026-09-07');
  });
});

describe('점수 — 약속을 지킨 만큼', () => {
  it('주 3회와 주 5회는 약속을 지키면 같은 점수다', () => {
    const three = score(keptSeason(3), 3);
    const five = score(keptSeason(5), 5);
    assert.equal(three.score, five.score);
    assert.equal(three.adherence, 1);
    assert.equal(five.adherence, 1);
    assert.equal(three.keptWeeks, 6);
  });

  it('주 3회면 운동 한 번에 10점, 다 지킨 주는 20점을 더 받는다', () => {
    const first = seasonProgress({ sessions: week(MONDAYS[0]!, 1), window: WINDOW, target: 3, today: addDays(MONDAYS[0]!, 1) });
    assert.equal(first.weeks[0]!.points, 10);
    const kept = seasonProgress({ sessions: week(MONDAYS[0]!, 3), window: WINDOW, target: 3, today: addDays(MONDAYS[0]!, 3) });
    assert.equal(kept.weeks[0]!.points, 50);
  });

  it('약속보다 더 해도 점수는 그대로다', () => {
    assert.equal(score(keptSeason(3, 6), 3).score, score(keptSeason(3), 3).score);
    const extra = score(keptSeason(3, 6), 3);
    assert.ok(extra.weeks.every((item) => item.credited <= item.target));
  });

  it('줄인 날(15분 · 25분)은 절반만 센다 — 그래도 약속은 지킨 것이다', () => {
    const sessions = week(MONDAYS[0]!, 3);
    const shortDates = [sessions[2]!.date];
    const progress = seasonProgress({ sessions, window: WINDOW, target: 3, today: addDays(MONDAYS[0]!, 3), shortDates });
    assert.equal(progress.weeks[0]!.kept, true);
    assert.equal(progress.weeks[0]!.short, 1);
    assert.equal(progress.weeks[0]!.points, 25 + 20);
  });

  it('연달아 지키면 배율이 오르되 ×1.5를 넘지 않는다', () => {
    const progress = score(keptSeason(3), 3);
    assert.deepEqual(progress.weeks.map((item) => item.multiplier), [1, 1.1, 1.2, 1.3, 1.4, 1.5]);
    // 지난 시즌부터 이어 온 연속도 센다 — 열 주를 지킨 뒤면 처음부터 1.5
    const before = Array.from({ length: 10 }, (_, i) => week(addDays(WINDOW.start, -7 * (i + 1)), 3)).flat();
    const long = score([...before, ...keptSeason(3)], 3);
    assert.ok(long.weeks.every((item) => item.multiplier === MAX_MULTIPLIER));
  });

  it('통증을 적은 주는 못 지켜도 깎지 않고 연속도 끊지 않는다', () => {
    const missWeek = MONDAYS[1]!;
    const sessions = keptSeason(3).filter((item) => item.date < missWeek || item.date > addDays(missWeek, 6));
    const plain = score(sessions, 3);
    const hurt = score(sessions, 3, { painDates: [addDays(missWeek, 2)] });
    assert.equal(hurt.weeks[1]!.excused, true);
    assert.equal(plain.weeks[1]!.excused, false);
    // 지킨 비율에서 빠지고, 다음 주 배율이 이어진다
    assert.equal(hurt.adherence, 1);
    assert.ok((plain.adherence ?? 1) < 1);
    assert.equal(hurt.weeks[2]!.multiplier, 1.1);
    assert.equal(plain.weeks[2]!.multiplier, 1);
    assert.ok(hurt.score > plain.score);
    // 깎는 점수는 없다 — 빠진 주는 0점이지 음수가 아니다
    assert.ok(plain.weeks.every((item) => item.points >= 0));
  });

  it('쉼표로 살린 주도 깎지 않는다', () => {
    // 시즌 앞 4주를 지킨 사람이 시즌 첫 주를 쉬었다
    const before = Array.from({ length: 4 }, (_, i) => week(addDays(WINDOW.start, -7 * (i + 1)), 3)).flat();
    const rest = keptSeason(3).filter((item) => item.date > addDays(MONDAYS[0]!, 6));
    const progress = score([...before, ...rest], 3);
    assert.equal(progress.weeks[0]!.excused, true);
    assert.equal(progress.adherence, 1);
    assert.equal(progress.weeks[1]!.multiplier, 1.4);
  });

  it('피킹 주(덜어내는 주)는 절반만 나와도 지킨 주이고 점수도 그대로다', () => {
    const progress = score(keptSeason(4), 4);
    const peak = progress.weeks[5]!;
    assert.equal(peak.peak, true);
    assert.equal(peak.target, 2);
    assert.equal(peak.kept, true);
    assert.equal(peak.points, Math.round(50 * peak.multiplier));
  });

  it('시작한 주는 남은 날만큼만 약속한다', () => {
    // 목요일에 시작 — 주 3회 × 4/7 ≈ 2회
    const progress = seasonProgress({ sessions: [day('2026-09-10'), day('2026-09-11')], window: WINDOW, target: 3, today: '2026-09-14', startDate: '2026-09-10' });
    assert.equal(progress.weeks[0]!.target, 2);
    assert.equal(progress.weeks[0]!.kept, true);
    assert.equal(progress.weeks[0]!.points, 50);
  });

  it('무대 안 세 걸음 — 점수로 Ⅲ → Ⅱ → Ⅰ', () => {
    const full = 6 * 50;
    const empty = seasonProgress({ sessions: [], window: WINDOW, target: 3, today: WINDOW.start });
    assert.equal(empty.subStep, 0);
    assert.deepEqual(empty.thresholds, [0, 100, 200]);
    assert.equal(empty.fullScore, full);
    assert.equal(empty.toNext, 100);
    assert.equal(empty.daysLeft, 41);
    const done = score(keptSeason(3), 3);
    assert.equal(done.subStep, 2);
    assert.equal(done.toNext, null);
  });

  it('지킨 비율은 끝난 주만 센다', () => {
    const progress = seasonProgress({ sessions: week(MONDAYS[0]!, 1), window: WINDOW, target: 3, today: addDays(MONDAYS[0]!, 1) });
    assert.equal(progress.adherence, null);
    assert.equal(progress.weeks[0]!.open, true);
    assert.equal(progress.weeks[1]!.future, true);
  });
});

describe('힘 기록', () => {
  it('이번 시즌에 가장 많이 오른 주 종목을 고른다', () => {
    const sessions = [
      day('2026-09-08', 60), day('2026-10-06', 70),
      day('2026-09-09', 100, 'back-squat'), day('2026-10-07', 105, 'back-squat'),
      day('2026-09-10', 10, 'lateral-raise'), day('2026-10-08', 30, 'lateral-raise'),
    ];
    const best = seasonStrengthHighlight(sessions, WINDOW);
    assert.equal(best?.exerciseId, 'barbell-bench-press');
    assert.ok(best!.changeKg > 0);
  });

  it('오른 게 없으면 없다고 둔다', () => {
    assert.equal(seasonStrengthHighlight([day('2026-09-08', 60), day('2026-10-06', 55)], WINDOW), null);
  });
});

describe('무대 — 목표마다', () => {
  it('목표를 세 무대로 나눈다', () => {
    assert.equal(trackForGoals(['hypertrophy']), 'physique');
    assert.equal(trackForGoals(['strength']), 'platform');
    assert.equal(trackForGoals(['hypertrophy', 'strength']), 'platform');
    assert.equal(trackForGoals(['fatLoss']), 'open');
    assert.equal(trackForGoals(['conditioning']), 'open');
    assert.equal(trackForGoals(['hypertrophy', 'fatLoss']), 'physique');
    assert.equal(trackForGoals([]), 'open');
  });

  it('무대마다 여섯 칸, 지어낸 일반 이름만 쓴다', () => {
    const banned = /olympia|ifbb|npc|올림피아|챌린저|다이아|플래티넘|골드|실버|브론즈|마스터즈/i;
    for (const ladder of Object.values(CAREER_LADDERS)) {
      assert.equal(ladder.length, STAGE_COUNT);
      for (const name of ladder) assert.ok(!banned.test(name), name);
    }
    assert.equal(CAREER_LADDERS.physique[0], '동네 헬스장 데뷔');
    assert.equal(stageLabel('physique', 1, 1), '시 대회 Ⅱ');
  });

  it('판정 — 잘 지키면 오르고, 어중간하면 같은 무대, 절대 내려가지 않는다', () => {
    assert.deepEqual(outcomeFor(0, 0.95), { outcome: 'promoted', stageAfter: 1 });
    assert.deepEqual(outcomeFor(2, PROMOTE_AT), { outcome: 'promoted', stageAfter: 3 });
    assert.deepEqual(outcomeFor(2, 0.6), { outcome: 'again', stageAfter: 2 });
    assert.deepEqual(outcomeFor(3, 0), { outcome: 'again', stageAfter: 3 });
    assert.deepEqual(outcomeFor(3, null), { outcome: 'again', stageAfter: 3 });
    assert.deepEqual(outcomeFor(5, 1), { outcome: 'top', stageAfter: 5 });
    assert.equal(outcomeLine({ outcome: 'promoted', track: 'physique', stageAfter: 2 }), '전국 대회 진출!');
    assert.equal(outcomeLine({ outcome: 'again', track: 'physique', stageAfter: 2 }), '같은 무대에 다시 도전합니다');
  });
});

describe('커리어 — 시즌을 열고 닫기', () => {
  const input = (today: string, sessions: SessionLog[], extra: Partial<CareerInput> = {}): CareerInput => ({
    block: BLOCK, today, sessions, target: 3, goals: ['hypertrophy'], ...extra,
  });

  it('처음 열면 지금 블록으로 첫 시즌을 연다', () => {
    const step = advanceCareer(emptyCareer(), input('2026-09-08', []));
    assert.equal(step.career.current?.number, 1);
    assert.equal(step.career.current?.end, '2026-10-18');
    assert.equal(step.concluded, null);
  });

  function through(career: CareerState, sessions: SessionLog[], nextBlock: SeasonBlock, today = '2026-10-19') {
    return advanceCareer(career, input(today, sessions, { block: nextBlock }));
  }
  const NEXT: SeasonBlock = { startedOn: '2026-10-19', level: 'intermediate' };

  it('대회 당일이 지나면 판정하고, 잘 지켰으면 다음 무대 · 새 시즌', () => {
    const open = advanceCareer(emptyCareer(), input('2026-09-08', [])).career;
    const step = through(open, keptSeason(3), NEXT);
    assert.equal(step.concluded?.outcome, 'promoted');
    assert.equal(step.concluded?.adherence, 1);
    assert.equal(step.career.stage, 1);
    assert.equal(step.career.pending?.season, 1);
    assert.equal(step.career.current?.number, 2);
    assert.equal(step.career.current?.start, '2026-10-19');
    assert.equal(step.career.history.length, 1);
  });

  it('어중간하면 같은 무대에 다시 — 무대는 내려가지 않는다', () => {
    const open = { ...advanceCareer(emptyCareer(), input('2026-09-08', [])).career, stage: 3 };
    // 주 3회 약속에 주 2회씩
    const step = through(open, MONDAYS.flatMap((monday) => week(monday, 2)), NEXT);
    assert.equal(step.concluded?.outcome, 'again');
    assert.equal(step.career.stage, 3);
    const low = through(open, [day('2026-10-14'), day('2026-10-16')], NEXT);
    assert.equal(low.career.stage, 3);
  });

  it('대회 당일에 운동을 마치면 그 자리에서 끝낸다 — 같은 시즌을 다시 열지 않는다', () => {
    const open = advanceCareer(emptyCareer(), input('2026-09-08', [])).career;
    const sessions = keptSeason(3);
    const notYet = advanceCareer(open, input('2026-10-18', sessions));
    assert.equal(notYet.concluded, null);
    const done = advanceCareer(open, input('2026-10-18', sessions, { dayDone: true }));
    assert.equal(done.concluded?.outcome, 'promoted');
    assert.equal(done.career.current, null);
    // 다음 날 블록이 넘어가면 새 시즌
    const next = advanceCareer({ ...done.career, pending: null }, input('2026-10-19', sessions, { block: NEXT }));
    assert.equal(next.concluded, null);
    assert.equal(next.career.current?.number, 2);
  });

  it('오래 쉬다 대회 당일을 맞았으면 결과 없이 새 시즌 — 벌점 없음', () => {
    const open = advanceCareer(emptyCareer(), input('2026-09-08', [])).career;
    const early = week(MONDAYS[0]!, 3);
    const step = advanceCareer(open, input('2026-11-09', early, { block: { startedOn: '2026-11-09', level: 'intermediate' } }));
    assert.equal(step.paused, true);
    assert.equal(step.concluded, null);
    assert.equal(step.career.pending, null);
    assert.equal(step.career.stage, 0);
    assert.equal(step.career.current?.start, '2026-11-09');
    assert.equal(step.career.history.at(-1)?.outcome, 'paused');
  });

  it('쉬어서 블록을 다시 셌으면 그 시즌은 조용히 접는다', () => {
    const open = advanceCareer(emptyCareer(), input('2026-09-08', [day('2026-09-08')])).career;
    const step = advanceCareer({ ...open, stage: 2 }, input('2026-10-05', [day('2026-09-08')], { block: { startedOn: '2026-10-05', level: 'intermediate' } }));
    assert.equal(step.paused, true);
    assert.equal(step.career.stage, 2);
    assert.equal(step.career.current?.start, '2026-10-05');
    assert.equal(step.career.current?.number, 2);
  });

  it('목표를 바꾸면 칸은 그대로, 무대만 바뀐다', () => {
    const open = { ...advanceCareer(emptyCareer(), input('2026-09-08', [])).career, stage: 2 };
    const step = advanceCareer(open, input('2026-09-09', [], { goals: ['strength'] }));
    assert.equal(step.career.stage, 2);
    assert.equal(step.career.track, 'platform');
  });

  it('지킨 주는 그때 무대 몫으로 한 번만 쌓인다', () => {
    let career = advanceCareer(emptyCareer(), input('2026-09-08', [])).career;
    const sessions = keptSeason(3);
    career = advanceCareer(career, input('2026-09-22', sessions)).career;
    assert.equal(career.banked.physique, 2);
    career = advanceCareer(career, input('2026-09-23', sessions)).career;
    assert.equal(career.banked.physique, 2);
    career = advanceCareer(career, input('2026-09-29', sessions, { goals: ['fatLoss'] })).career;
    assert.equal(career.banked.physique, 2);
    assert.equal(career.banked.open, 1);
  });

  it('예전 저장소 · 이상한 값은 기본값으로', () => {
    assert.deepEqual(normalizeCareer(undefined), emptyCareer());
    const fixed = normalizeCareer({ stage: 99, banked: { physique: -3 }, shortDates: ['x', '2026-09-08'], current: { start: 'nope' } });
    assert.equal(fixed.stage, 5);
    assert.equal(fixed.banked.physique, 0);
    assert.deepEqual(fixed.shortDates, ['2026-09-08']);
    assert.equal(fixed.current, null);
    assert.equal(fixed.shareNumbers, false);
  });

  it('줄인 날 적기 · 지우기', () => {
    const on = markShortDate(emptyCareer(), '2026-09-08', true);
    assert.deepEqual(on.shortDates, ['2026-09-08']);
    assert.equal(markShortDate(on, '2026-09-08', true), on);
    assert.deepEqual(markShortDate(on, '2026-09-08', false).shortDates, []);
  });
});

describe('몸이 자란다', () => {
  it('처음에는 지금 그림 그대로 (전부 0)', () => {
    const zero = avatarGrowth({});
    for (const part of GROWTH_PARTS) assert.equal(zero[part], 0);
  });

  it('쌓은 주가 늘면 어느 부위도 줄지 않고, 1을 넘지 않는다', () => {
    let prev = avatarGrowth({});
    for (let n = 1; n <= 400; n += 1) {
      const banked = { physique: n, platform: Math.floor(n / 3), open: Math.floor(n / 5) };
      const next = avatarGrowth(banked);
      for (const part of GROWTH_PARTS) {
        assert.ok(next[part] >= prev[part], `${part} @${n}`);
        assert.ok(next[part] < 1 || next[part] === 1, part);
        assert.ok(next[part] <= 1, part);
      }
      prev = next;
    }
  });

  it('한 주는 은은하게, 몇 달이면 확실하게', () => {
    const one = avatarGrowth({ physique: 1 });
    const half = avatarGrowth({ physique: 26 });
    assert.ok(one.arms < 0.04);
    assert.ok(half.arms > 0.4);
  });

  it('목표가 모양을 정한다 — 감량은 허리, 근력은 다리 · 등, 근육 키우기는 넓게', () => {
    const fat = avatarGrowth({ open: 20 });
    const lift = avatarGrowth({ platform: 20 });
    const size = avatarGrowth({ physique: 20 });
    assert.ok(fat.waist > fat.arms && fat.waist > size.waist && fat.waist > lift.waist);
    assert.ok(lift.legs > size.legs && lift.back > size.back);
    assert.ok(size.shoulders > lift.shoulders && size.arms > fat.arms);
  });

  it('무대에 오를 때마다 꾸밈이 하나씩 열린다', () => {
    assert.deepEqual(cosmeticsFor(0), { wristbands: false, belt: false, platesColored: false, outfit: 0, trim: false });
    assert.equal(cosmeticsFor(1).wristbands, true);
    assert.equal(cosmeticsFor(3).belt, true);
    assert.equal(cosmeticsFor(5).trim, true);
  });
});

describe('한 줄 · 코치 말', () => {
  it('운동 뒤 한 줄 — 오른 점수와 다음 걸음까지', () => {
    const before = seasonProgress({ sessions: week(MONDAYS[0]!, 2), window: WINDOW, target: 3, today: addDays(MONDAYS[0]!, 2) });
    const after = seasonProgress({ sessions: week(MONDAYS[0]!, 3), window: WINDOW, target: 3, today: addDays(MONDAYS[0]!, 2) });
    assert.equal(seasonFeedbackLine('physique', 0, before, after), '+30점 · 동네 헬스장 데뷔 Ⅱ까지 50점');
  });

  it('대회 당일 코치 말은 네 말투 모두 있다', () => {
    for (const style of ['energetic', 'gentle', 'tough', 'fun'] as const) {
      assert.ok(seasonDayLine(style, 'promoted').length > 5);
      assert.notEqual(seasonDayLine(style, 'promoted'), seasonDayLine(style, 'again'));
    }
  });
});

describe('무대 동작', () => {
  it('모든 동작이 풀리고 발이 바닥 아래로 꺼지지 않는다', () => {
    for (const id of STAGE_MOTION_IDS) {
      for (const posture of [0, 1]) {
        const clip = stageMotionFor(id, posture)!;
        assert.ok(clip, id);
        for (let i = 0; i <= 24; i += 1) {
          const frame = clipFrame(clip, i / 24);
          for (const bone of Object.values(frame.solved.bones)) {
            for (const p of [bone.a, bone.b]) {
              assert.ok(p.every(Number.isFinite), id);
              assert.ok(p[1] > -0.03, `${id} 바닥 아래 ${p[1]}`);
            }
          }
        }
      }
    }
  });

  it('플랫폼 동작은 손이 바를 놓치지 않는다', () => {
    const clip = stageMotionFor('stage-lockout')!;
    for (let i = 0; i <= 24; i += 1) {
      const miss = clipFrame(clip, i / 24).solved.miss;
      assert.ok(miss.armL < 0.02 && miss.armR < 0.02, JSON.stringify(miss));
    }
  });

  it('모르는 동작은 없다고 한다', () => {
    assert.equal(stageMotionFor('nope'), null);
  });
});
