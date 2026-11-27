import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { dayPlainName, dayShortName } from '../korean.ts';
import { MUSCLE_GROUPS, MUSCLE_LABELS_KO, MUSCLE_TECH_KO } from '../muscles.ts';

describe('운동 날 이름 — 화면에는 쉬운 말로', () => {
  it('긴 이름은 부위를 붙이고 A/B는 뺀다', () => {
    assert.equal(dayPlainName('상체 A'), '상체 (가슴·등·팔)');
    assert.equal(dayPlainName('하체 B'), '하체 (엉덩이·허벅지)');
    assert.equal(dayPlainName('전신 C'), '전신 (하체·가슴·등)');
    assert.equal(dayPlainName('푸시'), '미는 날 (가슴·어깨·팔 뒤)');
  });

  it('짧은 이름은 A/B를 ①②로 구별한다', () => {
    assert.equal(dayShortName('상체 A'), '상체 ①');
    assert.equal(dayShortName('상체 B'), '상체 ②');
    assert.equal(dayShortName('전신 C'), '전신 ③');
    assert.equal(dayShortName('레그'), '하체');
  });

  it('직접 지은 이름은 그대로 둔다', () => {
    assert.equal(dayPlainName('가슴 삼두'), '가슴 삼두');
    assert.equal(dayShortName('보완 · 가벼운 날'), '보완 · 가벼운 날');
    assert.equal(dayShortName(''), '');
  });
});

describe('부위 이름 — 화면에는 해부학 말 대신', () => {
  it('쉬운 이름에 트레이너 말이 없다', () => {
    const labels = MUSCLE_GROUPS.map((muscle) => MUSCLE_LABELS_KO[muscle]).join(' ');
    assert.doesNotMatch(labels, /삼각근|삼두|이두|대퇴|햄스트링|둔근|전완|승모|광배/);
  });

  it('해부학 이름은 따로 있다(자세히에서 괄호로)', () => {
    assert.equal(MUSCLE_TECH_KO.triceps, '삼두');
    assert.equal(MUSCLE_TECH_KO.frontDelt, '전면 삼각근');
    for (const muscle of MUSCLE_GROUPS) assert.ok(MUSCLE_TECH_KO[muscle], muscle);
  });
});
