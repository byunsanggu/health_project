import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { pickKoreanVoice } from '../voices.ts';

describe('기기 목소리 고르기', () => {
  it('윈도·엣지의 Natural 목소리를 기본 목소리보다 먼저 고른다', () => {
    const voices = [
      { name: 'Microsoft Heami - Korean (Korea)', lang: 'ko-KR', localService: true },
      { name: 'Microsoft SunHi Online (Natural) - Korean (Korea)', lang: 'ko-KR', localService: false },
    ];
    assert.equal(pickKoreanVoice(voices)!.name, 'Microsoft SunHi Online (Natural) - Korean (Korea)');
  });

  it('아이폰의 향상된 목소리를 고르고 장난감 목소리는 피한다', () => {
    const voices = [
      { name: 'Grandma (한국어(대한민국))', lang: 'ko-KR', localService: true },
      { name: 'Yuna', lang: 'ko-KR', localService: true },
      { name: 'Yuna (향상됨)', lang: 'ko-KR', localService: true },
    ];
    assert.equal(pickKoreanVoice(voices)!.name, 'Yuna (향상됨)');
  });

  it('안드로이드·크롬은 구글 목소리', () => {
    const voices = [
      { name: 'Samsung ko-kr-x-ism-local', lang: 'ko-KR', localService: true },
      { name: 'Google 한국의', lang: 'ko-KR', localService: false },
    ];
    assert.equal(pickKoreanVoice(voices)!.name, 'Google 한국의');
  });

  it('한국어 목소리가 없으면 고르지 않는다', () => {
    assert.equal(pickKoreanVoice([{ name: 'Samantha', lang: 'en-US' }]), null);
    assert.equal(pickKoreanVoice([]), null);
  });
});
