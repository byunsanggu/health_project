import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { countsAsTrainingDay, keptLine, shortOptions, SHORT_MINUTES } from '../shortSession.ts';
import { estimateSessionTime } from '../timeBudget.ts';
import { buildSession } from '../session.ts';
import { runOnboarding } from '../onboarding.ts';
import { COMMON_EQUIPMENT_IDS } from '../equipment.ts';
import { classifyRoles } from '../timeBudget.ts';
import { index } from './helpers.ts';

const onboarded = runOnboarding({
  selfReportedLevel: 'intermediate',
  monthsTraining: 18,
  bodyweightKg: 78,
  daysPerWeek: 4,
  goals: ['hypertrophy'],
  gym: { equipmentIds: COMMON_EQUIPMENT_IDS },
});

const sessions = onboarded.program.templates.map((template) =>
  buildSession({
    template, date: '2026-09-21', plan: onboarded.firstWeek,
    history: [], index, gym: onboarded.gym, lifter: onboarded.lifter,
  }));

const full = (i: number) => estimateSessionTime(sessions[i]!).totalMinutes;

describe('시간이 없는 날', () => {
  it('권한 시간 안에 끝난다', () => {
    /*
     * 15분을 누른 사람은 15분 뒤에 나가야 한다. 넘기면 그 버튼은
     * 다음부터 안 눌린다.
     */
    for (const [i, session] of sessions.entries()) {
      for (const option of shortOptions(session, full(i))) {
        assert.ok(option.actualMinutes <= option.budgetMinutes,
          `${option.budgetMinutes}분을 눌렀는데 ${option.actualMinutes}분이 걸립니다`);
      }
    }
  });

  it('무엇을 고르든 "운동한 날"로 세어진다', () => {
    /*
     * 화면이 "이것만 해도 이번 주 약속은 지켜집니다"라고 말한다.
     * 줄이는 규칙이 언젠가 바뀌어 본 세트가 하나도 안 남으면 그 문장은
     * 거짓말이 된다. 여기서 막는다.
     */
    for (const [i, session] of sessions.entries()) {
      for (const option of shortOptions(session, full(i))) {
        assert.ok(countsAsTrainingDay(option.session), option.kept);
      }
    }
  });

  it('메인 복합 동작이 남는다', () => {
    /*
     * 고립부터 덜어내는 것이 규칙이다. 15분밖에 없는 날 남는 하나가
     * 컬이라면 그 세션은 한 의미가 없다.
     */
    for (const [i, session] of sessions.entries()) {
      for (const option of shortOptions(session, full(i))) {
        const roles = classifyRoles(option.session.exercises);
        assert.ok(roles.includes('primary'), `${option.kept} — 메인이 없습니다`);
      }
    }
  });

  it('같은 결과를 두 번 권하지 않는다', () => {
    for (const [i, session] of sessions.entries()) {
      const kept = shortOptions(session, full(i)).map((option) => option.kept);
      assert.equal(new Set(kept).size, kept.length);
    }
  });

  it('이미 짧은 날에는 권하지 않는다', () => {
    // 20분짜리 세션에 "15분만 하기"를 띄우면 5분 아끼자고 누르게 하는 것이다.
    assert.deepEqual(shortOptions(sessions[0]!, 20), []);
    assert.deepEqual(shortOptions(sessions[0]!, 22), []);
    assert.ok(shortOptions(sessions[0]!, 60).length > 0);
  });

  it('권하는 길이는 짧은 것부터', () => {
    assert.deepEqual([...SHORT_MINUTES], [...SHORT_MINUTES].sort((a, b) => a - b));
  });

  it('남은 것을 사람 말로 적는다', () => {
    const [option] = shortOptions(sessions[0]!, full(0));
    assert.ok(option);
    assert.match(option.kept, /세트/);
    assert.ok(!option.kept.includes('0세트'), '세트가 0인 종목은 안 적는다');
  });
});
