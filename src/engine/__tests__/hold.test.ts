import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { decideNextSet } from '../autoregulation.ts';
import { buildProgram, type OnboardingAnswers } from '../onboarding.ts';
import { countLabel, countRangeLabel, exerciseById, isTimed } from '../exercises.ts';
import { HOLD_CAP_SECONDS, buildHoldCues, holdFeedbackLine, holdRange, prescribeHold } from '../hold.ts';
import { prescribeLoad } from '../load.ts';
import { applyRepRules, suggestRepRange } from '../repRules.ts';
import { setEffectiveness } from '../volume.ts';
import { summarizeSession } from '../summary.ts';
import { estimateSessionTime } from '../timeBudget.ts';
import { beforeSetLines } from '../coach.ts';
import { restFeedbackLine } from '../ptSession.ts';
import { buildSession } from '../session.ts';
import { firstWeekPlan } from '../onboarding.ts';
import { landmarksFor } from '../muscles.ts';
import { presetEquipment } from '../gymPresets.ts';
import { index } from './helpers.ts';
import type { SetLog } from '../types.ts';

const plank = exerciseById('plank')!;
const hold = (seconds: number[], extra: Partial<SetLog> = {}): SetLog[] =>
  seconds.map((reps) => ({ exerciseId: 'plank', weightKg: 0, reps, rir: 2, ...extra }));
const rule = (min = 20, max = 30) => ({ repRange: { min, max }, targetRir: 2 });

describe('버티는 종목 — 초로 센다', () => {
  it('플랭크 · 사이드 플랭크는 초, 나머지는 회', () => {
    assert.equal(isTimed(plank), true);
    assert.equal(isTimed('side-plank'), true);
    assert.equal(isTimed('push-up'), false);
    assert.equal(isTimed('없는-종목'), false);
    assert.equal(countLabel('plank', 30), '30초');
    assert.equal(countLabel('push-up', 12), '12회');
    assert.equal(countRangeLabel(plank, { min: 20, max: 30 }), '20~30초');
  });

  it('초보는 3 × 20~30초에서 시작한다 — 중급 · 상급은 더 길게', () => {
    assert.deepEqual(holdRange('beginner'), { min: 20, max: 30 });
    assert.ok(holdRange('intermediate').max > 30 && holdRange('advanced').max > holdRange('intermediate').max);
    const program = buildProgram(answersFor(['floor'], 'beginner', 4), 'beginner');
    const plankSlots = program.templates.flatMap((template) => template.slots).filter((slot) => slot.exerciseId === 'plank');
    assert.ok(plankSlots.length > 0, '매트뿐인 초보에게 플랭크가 들어간다');
    for (const slot of plankSlots) {
      assert.deepEqual(slot.repRange, { min: 20, max: 30 });
      assert.ok(slot.sets >= 2 && slot.sets <= 3);
    }
  });

  it('처음은 범위 그대로, 맨몸(0kg)로 — "무게를 정하세요"가 아니다', () => {
    const first = prescribeLoad(plank, undefined, rule());
    assert.equal(first.change, 'start');
    assert.equal(first.weightKg, 0);
    assert.deepEqual(first.targetReps, { min: 20, max: 30 });
    assert.match(first.reason, /20~30초/);
    assert.doesNotMatch(first.reason, /kg|회/);
  });

  it('모든 세트가 위 끝을 채우면 5초 늘린다 — 넉넉히 넘겼으면 10초', () => {
    const up = prescribeHold(plank, hold([30, 30, 30]), rule());
    assert.deepEqual(up.targetReps, { min: 25, max: 35 });
    assert.match(up.reason, /35초/);
    assert.equal(up.weightKg, 0);
    assert.equal(up.deltaKg, 0);
    const lots = prescribeHold(plank, hold([37, 36, 36]), rule());
    // 지난번 목표 위 끝은 가장 오래 버틴 세트를 5초 단위로 올린 값(40) — 36초 세트는 못 채웠다
    assert.deepEqual(lots.targetReps, { min: 30, max: 40 });
    const easy = prescribeHold(plank, hold([40, 40, 40]), rule());
    assert.deepEqual(easy.targetReps, { min: 35, max: 45 });
    // 46 · 45 · 45 — 목표 위 끝(50)을 못 채운 세트가 있으니 50을 다시
    assert.deepEqual(prescribeHold(plank, hold([46, 45, 45]), rule()).targetReps, { min: 40, max: 50 });
  });

  it('위 끝을 한 세트라도 못 채우면 같은 위 끝을 다시', () => {
    const same = prescribeHold(plank, hold([35, 32, 28]), rule());
    assert.deepEqual(same.targetReps, { min: 25, max: 35 });
    assert.match(same.reason, /35초까지/);
  });

  it('아래 끝도 못 채웠으면 되는 만큼 + 무릎 대고 하는 법', () => {
    const short = prescribeHold(plank, hold([14, 12, 10]), rule());
    assert.equal(short.targetReps.min, 10);
    assert.equal(short.targetReps.max, 30);
    assert.match(short.reason, /무릎/);
  });

  it('90초에 닿으면 더 늘리지 않고 더 어렵게', () => {
    const top = prescribeHold(plank, hold([90, 90, 90]), rule());
    assert.equal(top.targetReps.max, HOLD_CAP_SECONDS);
    assert.match(top.reason, /어렵게/);
  });

  it('주에 걸쳐 이어서 늘어난다 — 매번 다 버티면 30 → 35 → 40', () => {
    let target = { min: 20, max: 30 };
    const seen: number[] = [];
    for (let week = 0; week < 3; week += 1) {
      const next = prescribeHold(plank, hold([target.max, target.max, target.max]), rule());
      target = next.targetReps;
      seen.push(target.max);
    }
    assert.deepEqual(seen, [35, 40, 45]);
  });

  it('블록 반복 · 종목별 반복 칸을 씌우지 않는다 — "바꿀까요?"도 묻지 않는다', () => {
    const template = { name: '상체 A', slots: [{ exerciseId: 'plank', sets: 3, repRange: { min: 20, max: 30 }, role: 'isolation' as const }] };
    assert.deepEqual(applyRepRules(template, { style: 'strength' }).slots[0]!.repRange, { min: 20, max: 30 });
    assert.deepEqual(applyRepRules(template, { overrides: { plank: { min: 8, max: 12 } } }).slots[0]!.repRange, { min: 20, max: 30 });
    const history = ['2026-10-01', '2026-10-03'].map((date) => ({ date, sets: hold([45, 45, 45]) }));
    assert.equal(suggestRepRange(history, 'plank', { min: 20, max: 30 }, '2026-10-05'), null);
  });

  it('유효 세트 · 요약 · 시간 계산이 초를 반복으로 읽지 않는다', () => {
    // 45초 버티기는 "45회 초고반복"이 아니다 — 깎지 않는다
    assert.equal(setEffectiveness(hold([45])[0]!), 1);
    const summary = summarizeSession({
      date: '2026-10-10', name: '상체 A', history: [], index, landmarks: landmarksFor('beginner'),
      sets: [...hold([30, 30]), { exerciseId: 'incline-push-up', weightKg: 0, reps: 10, rir: 2 }],
    });
    assert.equal(summary.totalReps, 10);
    assert.equal(summary.holdSeconds, 60);
    assert.equal(summary.tonnageKg, 0);
    assert.ok(summary.records.every((record) => record.exerciseId !== 'plank'), '1회 최대 기록에 플랭크가 없다');

    const session = buildSession({
      template: { name: '상체 A', slots: [{ exerciseId: 'plank', sets: 3, repRange: { min: 20, max: 30 } }] },
      date: '2026-10-10', plan: firstWeekPlan({ name: 'x' } as never, 2), history: [], index,
    });
    const time = estimateSessionTime(session, { includeWarmup: false });
    const work = time.exercises[0]!;
    assert.ok(Number.isFinite(time.totalSeconds));
    // 3세트 × 30초 + 준비 — 30 × 한 회 시간이 아니다
    assert.ok(work.workSeconds <= 3 * (30 + 30), `일하는 시간 ${work.workSeconds}초`);
  });

  it('대체 · 내 루틴 — 반복 자리에 온 플랭크는 초로, 플랭크 자리의 반복 종목은 회로', () => {
    const session = buildSession({
      template: { name: 'x', fixed: true, slots: [{ exerciseId: 'plank', sets: 3, repRange: { min: 8, max: 12 } }] },
      date: '2026-10-10', plan: firstWeekPlan({ name: 'x' } as never, 2), history: [], index,
      lifter: { level: 'beginner' } as never,
    });
    assert.deepEqual(session.exercises[0]!.sets[0]!.targetReps, { min: 20, max: 30 });
  });

  it('세트가 무너졌을 때 이유도 초로 말한다', () => {
    const decision = decideNextSet({ completed: hold([40, 25]), plannedSets: 3, rule: rule() });
    assert.match(decision.reason, /40초에서 25초로/);
    assert.doesNotMatch(decision.reason, /회/);
  });
});

describe('PT가 세는 버티기', () => {
  it('시작 말 · 절반 · 5초 전 · 넷 셋 둘 하나 · 끝 — rep은 버틴 초', () => {
    const cues = buildHoldCues({ seconds: 30, leadInSeconds: 8, style: 'gentle' });
    assert.equal(cues[0]!.rep, 0);
    assert.match(cues[0]!.say, /30초/);
    const said = cues.map((cue) => cue.say);
    assert.ok(said.includes('절반 지났습니다. 숨 쉬면서 그대로 버티세요.'));
    assert.ok(said.includes('5초 남았습니다.'));
    assert.deepEqual(said.slice(-5, -1), ['넷', '셋', '둘', '하나']);
    assert.match(said[said.length - 1]!, /^끝/);
    const half = cues.find((cue) => cue.say.startsWith('절반'))!;
    assert.equal(half.rep, 15);
    assert.equal(half.atMs, (8 + 15) * 1000);
    assert.equal(cues[cues.length - 1]!.rep, 30);
    assert.equal(cues[cues.length - 1]!.atMs, 38000);
    // 시간 순서
    for (let i = 1; i < cues.length; i += 1) assert.ok(cues[i]!.atMs >= cues[i - 1]!.atMs);
  });

  it('네 코치 모두 말이 있고, 반말은 빡센 코치만', () => {
    for (const style of ['energetic', 'gentle', 'tough', 'fun'] as const) {
      const said = buildHoldCues({ seconds: 20, style }).map((cue) => cue.say);
      assert.ok(said.every((line) => line.length > 0), style);
      const banmal = /(버텨|왔다|남았다|버텼어)[.!]/;
      if (style === 'tough') assert.ok(said.some((line) => banmal.test(line)), style);
      else assert.ok(said.every((line) => !banmal.test(line)), `${style}: ${said.join(' / ')}`);
    }
  });

  it('짧은 버티기(10초 아래)는 절반 · 5초 전을 말하지 않는다', () => {
    const said = buildHoldCues({ seconds: 8, style: 'energetic' }).map((cue) => cue.say);
    assert.equal(said.length, 2);
  });

  it('세트 앞 말 · 쉬는 동안 한마디가 "개 · 무게"가 아니라 초로 말한다', () => {
    for (const style of ['energetic', 'gentle', 'tough', 'fun'] as const) {
      for (const setIndex of [0, 1, 2]) {
        const lines = beforeSetLines({
          style, exerciseName: '플랭크', setIndex, totalSets: 3, weightKg: 0, repsMin: 20, repsMax: 30, targetRir: 2, seconds: true,
          last: setIndex === 0 ? { date: '2026-10-01', daysAgo: 7, weightKg: 0, reps: 30, rir: 2, sets: 3 } : null,
        }).join(' ');
        assert.match(lines, /20에서 30초/, `${style} ${setIndex}: ${lines}`);
        assert.doesNotMatch(lines, /개수|\d+개|같은 무게|NaN|undefined/, `${style} ${setIndex}: ${lines}`);
      }
      const feedback = restFeedbackLine(style, { reps: 30, repsMin: 20, repsMax: 30, seconds: true });
      assert.match(feedback, /30초/);
      assert.doesNotMatch(feedback, /개|무게/);
      assert.match(holdFeedbackLine(style, { seconds: 12, min: 20, max: 30 }), /12초/);
    }
  });
});

describe('매트뿐인 초보의 바닥 종목', () => {
  it('매트 · 매트+케틀벨 초보의 상체 · 푸시 날은 네 종목, 풀 날도 세 종목 넘게 — 같은 동작 · 어려운 동작 없이, 코어는 끝에', () => {
    const HARD = new Set(['pike-push-up', 'chest-dip', 'triceps-dip', 'pull-up', 'chin-up', 'hanging-leg-raise']);
    const PUSH_UPS = ['push-up', 'incline-push-up', 'knee-push-up'];
    for (const ids of [['floor'], ['floor', 'kettlebells']]) {
      for (const days of [2, 3, 4, 5, 6]) {
        for (const priorities of [[], ['glutes']] as OnboardingAnswers['priorities'][]) {
          for (const template of buildProgram(answersFor(ids, 'beginner', days, priorities), 'beginner').templates) {
            const dayIds = template.slots.map((slot) => slot.exerciseId);
            const tag = `${ids.join(',')} 주 ${days}회 ${template.name}: ${dayIds.join(', ')}`;
            assert.ok(dayIds.length >= 3, tag);
            if (/상체|푸시/.test(template.name)) assert.ok(dayIds.length >= 4, tag);
            assert.equal(new Set(dayIds).size, dayIds.length, tag);
            assert.ok(dayIds.filter((id) => PUSH_UPS.includes(id)).length <= 1, `푸시업 둘: ${tag}`);
            assert.ok(!dayIds.some((id) => HARD.has(id)), `어려운 동작: ${tag}`);
            const patterns = dayIds.map((id) => exerciseById(id)!.pattern);
            const firstCore = patterns.indexOf('core');
            assert.ok(firstCore < 0 || patterns.slice(firstCore).every((pattern) => pattern === 'core'), `코어 순서: ${tag}`);
            assert.ok(!(dayIds.includes('plank') && dayIds.includes('side-plank')), tag);
          }
        }
      }
    }
  });

  it('무릎 푸시업 · 슈퍼맨 · 플랭크가 실제로 들어간다', () => {
    const all = buildProgram(answersFor(['floor'], 'beginner', 5), 'beginner').templates.flatMap((template) => template.slots.map((slot) => slot.exerciseId));
    for (const id of ['knee-push-up', 'superman', 'plank', 'bird-dog']) assert.ok(all.includes(id), `${id}: ${all.join(', ')}`);
  });

  it('기구가 넉넉한 헬스장에서는 무릎 푸시업이 펙덱 · 플라이 자리를 뺏지 않는다', () => {
    for (const preset of ['franchise', 'neighborhood', 'unknown'] as const) {
      for (const days of [3, 4, 5]) {
        for (const template of buildProgram(answersFor(presetEquipment(preset), 'beginner', days), 'beginner').templates) {
          assert.ok(!template.slots.some((slot) => slot.exerciseId === 'knee-push-up'), `${preset} ${days} ${template.name}`);
        }
      }
    }
  });
});

function answersFor(equipmentIds: readonly string[], level: 'beginner' | 'intermediate', days: number,
  priorities: OnboardingAnswers['priorities'] = []): OnboardingAnswers {
  return {
    selfReportedLevel: level, monthsTraining: level === 'beginner' ? 1 : 18, bodyweightKg: 70, sex: 'female',
    daysPerWeek: days, goals: ['hypertrophy'], gym: { equipmentIds: [...equipmentIds] }, priorities,
  } as OnboardingAnswers;
}
