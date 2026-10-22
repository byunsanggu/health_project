import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { hasFinalConsonant, particle, withParticle } from '../korean.ts';

describe('hasFinalConsonant', () => {
  it('받침 유무를 판별한다', () => {
    assert.equal(hasFinalConsonant('로우'), false);
    assert.equal(hasFinalConsonant('스쿼트'), false, '트는 받침이 없다');
    assert.equal(hasFinalConsonant('익스텐션'), true);
    assert.equal(hasFinalConsonant('케이블'), true, 'ㄹ 받침');
  });

  it('한글이 아니면 판단하지 않는다', () => {
    assert.equal(hasFinalConsonant('RDL'), null);
    assert.equal(hasFinalConsonant(''), null);
  });
});

describe('particle', () => {
  it('목적격 조사를 고른다', () => {
    assert.equal(withParticle('시티드 케이블 로우', '을/를'), '시티드 케이블 로우를');
    assert.equal(withParticle('백 스쿼트', '을/를'), '백 스쿼트를');
    assert.equal(withParticle('레그 익스텐션', '을/를'), '레그 익스텐션을');
  });

  it('주격·보조사도 고른다', () => {
    assert.equal(withParticle('풀업', '은/는'), '풀업은');
    assert.equal(withParticle('페이스 풀', '은/는'), '페이스 풀은');
    assert.equal(withParticle('펙덱 플라이', '이/가'), '펙덱 플라이가');
  });

  it('ㄹ 받침 뒤에는 으로가 아니라 로를 쓴다', () => {
    assert.equal(withParticle('케이블', '으로/로'), '케이블로');
    assert.equal(withParticle('머신', '으로/로'), '머신으로');
    assert.equal(withParticle('펙덱 플라이', '으로/로'), '펙덱 플라이로');
  });

  it('판단할 수 없으면 받침 없는 쪽으로 둔다', () => {
    assert.equal(particle('RDL', '을/를'), '를');
  });
});

describe('기호로 끝나는 이름', () => {
  it('괄호를 걷어내고 받침을 본다', () => {
    // "예시 피트니스 A (대형)" → 마지막 한글은 '형', 받침 있음
    assert.equal(withParticle('예시 피트니스 A (대형)', '과/와'), '예시 피트니스 A (대형)과');
    assert.equal(withParticle('상구헬스장 (3층)', '이/가'), '상구헬스장 (3층)이');
  });

  it('따옴표로 끝나도 판정한다', () => {
    assert.equal(particle('바디짐"', '은/는'), '은');
    assert.equal(particle('상구헬스장"', '을/를'), '을');
  });

  it('기호를 걷어낸 뒤에도 ㄹ 받침은 로를 쓴다', () => {
    assert.equal(particle('서울 (본점)', '으로/로'), '으로');
    assert.equal(particle('케이블', '으로/로'), '로');
    assert.equal(particle('케이블)', '으로/로'), '로');
  });

  it('한글이 남지 않으면 받침 없는 쪽', () => {
    assert.equal(particle('GYM)', '은/는'), '는');
    assert.equal(particle('(((', '은/는'), '는');
  });
});

describe('숫자로 끝나는 말', () => {
  it('읽는 소리로 받침을 본다 — 삼 · 육 · 칠은 있고 이 · 사 · 구는 없다', () => {
    assert.equal(withParticle('등받이 3', '이/가'), '등받이 3이');
    assert.equal(withParticle('시트 4', '이/가'), '시트 4가');
    assert.equal(withParticle('10', '은/는'), '10은');
    assert.equal(particle('2', '을/를'), '를');
    assert.equal(particle('6', '과/와'), '과');
  });

  it('일 · 칠 · 팔은 ㄹ 받침이라 로', () => {
    assert.equal(particle('1', '으로/로'), '로');
    assert.equal(particle('8', '으로/로'), '로');
    assert.equal(particle('3', '으로/로'), '으로');
    assert.equal(particle('9', '으로/로'), '로');
  });
});
