import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  blockStatus, markDeload, newlyIntroduced, nextBlock, programChanges, programOptionsFor,
  reviewBlock, startTraining, TECHNICAL_ORDER, type TrainingBlock,
} from '../blocks.ts';
import { buildProgram, type OnboardingAnswers } from '../onboarding.ts';
import { COMMON_EQUIPMENT_IDS, availableExercises } from '../equipment.ts';
import { EXERCISES } from '../exercises.ts';
import { addDays } from '../volume.ts';
import type { SessionLog } from '../types.ts';

const MONDAY = '2026-01-05';

/** 블록 동안 주 n회, 무게를 조금씩 올리며 한 기록. */
function trained(block: TrainingBlock, weeks: number, perWeek: number, grow = 2.5): SessionLog[] {
  const out: SessionLog[] = [];
  for (let w = 0; w < weeks; w += 1) {
    for (let d = 0; d < perWeek; d += 1) {
      out.push({
        date: addDays(block.startedOn, w * 7 + d * 2),
        sets: [{ exerciseId: 'leg-press', weightKg: 100 + w * grow, reps: 10, rir: 2 }],
      });
    }
  }
  return out;
}

const gymIds = availableExercises(COMMON_EQUIPMENT_IDS, EXERCISES).map((item) => item.id);

describe('블록 주기', () => {
  it('축적 주를 채우면 다음 주가 디로드, 그다음 주에 끝난다', () => {
    const block = startTraining({ today: '2026-01-07', level: 'beginner', monthsTraining: 2 });
    assert.equal(block.startedOn, MONDAY);
    assert.deepEqual(blockStatus(block, MONDAY), { stage: 'accumulation', weekInBlock: 1, accumulationWeeks: 6 });
    assert.equal(blockStatus(block, addDays(MONDAY, 5 * 7)).stage, 'accumulation');
    assert.equal(blockStatus(block, addDays(MONDAY, 6 * 7)).stage, 'deload');
    assert.equal(blockStatus(block, addDays(MONDAY, 7 * 7)).stage, 'done');
  });

  it('피로 때문에 일찍 디로드에 들어가면 그다음 주에 끝난다', () => {
    const block = markDeload(startTraining({ today: MONDAY, level: 'intermediate' }), addDays(MONDAY, 14));
    assert.equal(blockStatus(block, addDays(MONDAY, 16)).stage, 'deload');
    assert.equal(blockStatus(block, addDays(MONDAY, 21)).stage, 'done');
  });

  it('초보로 시작하면 바벨 기본 종목은 아직 안 배운 상태다', () => {
    assert.deepEqual(startTraining({ today: MONDAY, level: 'beginner' }).technicalIntroduced, []);
    assert.equal(startTraining({ today: MONDAY, level: 'intermediate' }).technicalIntroduced, null);
  });
});

describe('블록 판정 — 조금씩 올린다', () => {
  const end = addDays(MONDAY, 7 * 7);

  it('나오고 · 늘고 · 경력이 차면 다음 단계로 — 하지만 절반만', () => {
    const block = startTraining({ today: MONDAY, level: 'beginner', monthsTraining: 5 });
    const review = reviewBlock({ block, history: trained(block, 6, 3), today: end, daysPerWeek: 3 });
    assert.equal(review.decision, 'promote');
    assert.equal(review.level, 'beginner', '볼륨 기준은 아직 초보');
    assert.deepEqual(review.transition, { to: 'intermediate', step: 1 });

    const next = nextBlock(block, review, end, gymIds);
    const { level, options } = programOptionsFor(next);
    assert.equal(level, 'beginner');
    assert.deepEqual(options.blendToward, { level: 'intermediate', amount: 0.5 });
  });

  it('옮기는 중에 잘 해내면 그다음 블록에서 다 옮긴다', () => {
    const first = startTraining({ today: MONDAY, level: 'beginner', monthsTraining: 5 });
    const review = reviewBlock({ block: first, history: trained(first, 6, 3), today: end, daysPerWeek: 3 });
    const second = nextBlock(first, review, end, gymIds);
    const end2 = addDays(second.startedOn, 7 * 7);
    const review2 = reviewBlock({ block: second, history: trained(second, 6, 3), today: end2, daysPerWeek: 3 });
    assert.equal(review2.decision, 'complete');
    assert.equal(review2.level, 'intermediate');
    assert.equal(review2.transition, null);
  });

  it('출석이 모자라면 올리지 않는다', () => {
    const block = startTraining({ today: MONDAY, level: 'beginner', monthsTraining: 8 });
    const review = reviewBlock({ block, history: trained(block, 6, 1), today: end, daysPerWeek: 3 });
    assert.equal(review.decision, 'stay');
    assert.ok(review.reasons.some((line) => line.includes('출석')));
  });

  it('경력이 모자라면 올리지 않는다 — 6주 만에 초보를 졸업하지 않는다', () => {
    const block = startTraining({ today: MONDAY, level: 'beginner', monthsTraining: 1 });
    const review = reviewBlock({ block, history: trained(block, 6, 3), today: end, daysPerWeek: 3 });
    assert.equal(review.decision, 'stay');
    assert.ok(review.reasons.some((line) => line.includes('6개월')));
  });

  it('기록이 계속 떨어지면 올리지 않는다', () => {
    const block = startTraining({ today: MONDAY, level: 'beginner', monthsTraining: 8 });
    const review = reviewBlock({ block, history: trained(block, 6, 3, -5), today: end, daysPerWeek: 3 });
    assert.equal(review.decision, 'stay');
  });

  it('옮기는 중에 출석이 무너지면 그 자리에서 한 블록 더', () => {
    const first = startTraining({ today: MONDAY, level: 'beginner', monthsTraining: 5 });
    const review = reviewBlock({ block: first, history: trained(first, 6, 3), today: end, daysPerWeek: 3 });
    const second = nextBlock(first, review, end, gymIds);
    const end2 = addDays(second.startedOn, 7 * 7);
    const review2 = reviewBlock({ block: second, history: trained(second, 6, 1), today: end2, daysPerWeek: 3 });
    assert.equal(review2.decision, 'hold');
    assert.equal(review2.level, 'beginner');
    assert.deepEqual(review2.transition, { to: 'intermediate', step: 1 });
  });

  it('전문가는 더 올라갈 데가 없다', () => {
    const block = startTraining({ today: MONDAY, level: 'expert', monthsTraining: 80 });
    const review = reviewBlock({ block, history: trained(block, 4, 5), today: addDays(MONDAY, 35), daysPerWeek: 5 });
    assert.equal(review.decision, 'top');
  });
});

describe('바벨 기본 종목은 한 블록에 하나씩', () => {
  it('올라가기 시작한 블록부터 순서대로 하나씩 들어온다', () => {
    let block = startTraining({ today: MONDAY, level: 'beginner', monthsTraining: 5 });
    const added: (string | null)[] = [];
    for (let i = 0; i < 6; i += 1) {
      const today = addDays(block.startedOn, 7 * 7);
      const review = reviewBlock({ block, history: trained(block, 6, 3), today, daysPerWeek: 3 });
      const next = nextBlock(block, review, today, gymIds);
      added.push(newlyIntroduced(block, next));
      block = next;
    }
    assert.deepEqual(added.slice(0, 4).filter(Boolean).length, 4);
    assert.equal(block.technicalIntroduced, null, '넷을 다 배우면 제한이 풀린다');
  });

  it('초보에 머무는 동안에는 들이지 않는다', () => {
    const block = startTraining({ today: MONDAY, level: 'beginner', monthsTraining: 0 });
    const today = addDays(MONDAY, 49);
    const review = reviewBlock({ block, history: trained(block, 6, 3), today, daysPerWeek: 3 });
    assert.deepEqual(nextBlock(block, review, today, gymIds).technicalIntroduced, []);
  });

  it('헬스장에 없는 종목은 건너뛴다', () => {
    const block: TrainingBlock = { ...startTraining({ today: MONDAY, level: 'beginner', monthsTraining: 5 }) };
    const today = addDays(MONDAY, 49);
    const review = reviewBlock({ block, history: trained(block, 6, 3), today, daysPerWeek: 3 });
    const next = nextBlock(block, review, today, gymIds.filter((id) => id !== TECHNICAL_ORDER[0]));
    assert.deepEqual(next.technicalIntroduced, [TECHNICAL_ORDER[1]]);
  });

  it('배운 종목만 프로그램에 들어온다', () => {
    const answers: OnboardingAnswers = {
      selfReportedLevel: 'beginner', bodyweightKg: 70, daysPerWeek: 3,
      goals: ['hypertrophy'], gym: { equipmentIds: COMMON_EQUIPMENT_IDS },
    };
    const program = buildProgram(answers, 'beginner', { technicalIntroduced: ['back-squat'] });
    const ids = program.templates.flatMap((template) => template.slots.map((slot) => slot.exerciseId));
    assert.ok(ids.includes('back-squat'));
    assert.ok(!ids.includes('conventional-deadlift'));
  });
});

describe('블록이 바뀌면 보조 종목을 바꾼다', () => {
  const answers: OnboardingAnswers = {
    selfReportedLevel: 'intermediate', monthsTraining: 18, bodyweightKg: 80, daysPerWeek: 4,
    goals: ['hypertrophy'], gym: { equipmentIds: COMMON_EQUIPMENT_IDS },
  };

  it('메인은 그대로, 보조 · 고립은 다른 종목으로', () => {
    const before = buildProgram(answers, 'intermediate');
    const after = buildProgram(answers, 'intermediate', { previous: before });
    before.templates.forEach((template, d) => {
      template.slots.forEach((slot, i) => {
        const next = after.templates[d]!.slots[i]!;
        if (slot.role === 'primary') assert.equal(next.exerciseId, slot.exerciseId, `${template.name} 메인`);
      });
    });
    assert.ok(programChanges(before, after).length >= 4, '보조가 여럿 바뀐다');
  });
});
