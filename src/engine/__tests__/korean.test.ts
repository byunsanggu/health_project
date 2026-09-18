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
