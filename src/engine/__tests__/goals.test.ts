import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { describeGoals, planGoals, repRangeForGoals } from '../goals.ts';

describe('planGoals', () => {
  it('근력이 있으면 반복 범위의 기준이 된다', () => {
    assert.equal(planGoals(['hypertrophy', 'strength']).primary, 'strength');
    assert.equal(repRangeForGoals('primary', ['hypertrophy', 'strength']).max, 6);
  });

  it('근비대만이면 중반복', () => {
    assert.deepEqual(repRangeForGoals('primary', ['hypertrophy']), { min: 6, max: 10 });
  });

  it('감량은 반복 범위를 바꾸지 않는다 — 체지방은 식사에서 빠진다', () => {
    // "고반복이 커팅"은 오래된 오해다. 적자에서 강도를 낮추면 근육을 잃는다.
    assert.deepEqual(
      repRangeForGoals('primary', ['hypertrophy']),
      repRangeForGoals('primary', ['hypertrophy', 'fatLoss']),
    );
    assert.deepEqual(
      repRangeForGoals('primary', ['strength']),
      repRangeForGoals('primary', ['strength', 'fatLoss']),
    );
  });

  it('감량 중에는 볼륨을 MAV에서 멈춘다', () => {
    assert.equal(planGoals(['hypertrophy']).volumeCeiling, 'mrv');
    assert.equal(planGoals(['hypertrophy', 'fatLoss']).volumeCeiling, 'mav');
    assert.equal(planGoals(['fatLoss']).cutting, true);
  });

  it('상충을 숨기지 않고 말한다', () => {
    const plan = planGoals(['hypertrophy', 'strength', 'fatLoss']);
    const text = plan.notes.join(' ');
    assert.match(text, /식사/, '체지방이 어디서 빠지는지 말해야 한다');
    assert.match(text, /지키는/, '적자에서는 유지가 목표라고 말해야 한다');
    assert.ok(plan.notes.length >= 3);
  });

  it('잘 맞는 조합은 어떻게 가는지 알려준다', () => {
    const plan = planGoals(['strength', 'hypertrophy']);
    assert.match(plan.notes.join(' '), /메인.*저반복.*보조/);
  });

  it('아무것도 안 고르면 건강 유지로 본다', () => {
    const plan = planGoals([]);
    assert.deepEqual(plan.goals, ['general']);
    assert.ok(plan.notes.length > 0);
  });

  it('순서를 바꿔 골라도 결과가 같다', () => {
    const a = planGoals(['fatLoss', 'strength', 'hypertrophy']);
    const b = planGoals(['hypertrophy', 'fatLoss', 'strength']);
    assert.deepEqual(a.goals, b.goals);
    assert.deepEqual(a.notes, b.notes);
  });

  it('중복을 골라도 한 번만 센다', () => {
    assert.deepEqual(planGoals(['strength', 'strength']).goals, ['strength']);
  });

  it('보조와 고립은 목표와 무관하게 중·고반복이다', () => {
    for (const goals of [['strength'], ['hypertrophy'], ['fatLoss'], ['general']] as const) {
      assert.deepEqual(repRangeForGoals('isolation', goals), { min: 10, max: 15 });
      assert.deepEqual(repRangeForGoals('accessory', goals), { min: 8, max: 12 });
    }
  });
});

describe('describeGoals', () => {
  it('고른 순서와 상관없이 같은 문장이 나온다', () => {
    assert.equal(describeGoals(['fatLoss', 'strength']), describeGoals(['strength', 'fatLoss']));
    assert.equal(describeGoals(['strength', 'hypertrophy', 'fatLoss']), '근력 · 근비대 · 체지방 감량');
  });
});
