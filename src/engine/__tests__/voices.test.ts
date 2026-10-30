import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { STYLE_TONE, VOICE_PITCHES, VOICE_RATES, pickKoreanVoice, voiceChoices, voiceTuning } from '../voices.ts';

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

describe('목소리 직접 고르기', () => {
  const PHONE = [
    { name: 'Microsoft Heami - Korean (Korea)', lang: 'ko-KR', localService: true },
    { name: 'Microsoft SunHi Online (Natural) - Korean (Korea)', lang: 'ko-KR', localService: false },
    { name: 'Google 한국의', lang: 'ko-KR', localService: false },
    { name: 'Yuna', lang: 'ko-KR', localService: true },
    { name: 'Yuna (향상됨)', lang: 'ko-KR', localService: true },
    { name: 'Grandma (한국어(대한민국))', lang: 'ko-KR', localService: true },
    { name: 'Samsung ko-kr-x-ism-local', lang: 'ko-KR', localService: true },
    { name: 'ko-kr-x-kod-network', lang: 'ko-KR', localService: false },
    { name: 'Samantha', lang: 'en-US', localService: true },
  ];

  it('고른 목소리가 이 폰에 있으면 그것, 없으면 제일 자연스러운 것', () => {
    assert.equal(pickKoreanVoice(PHONE, 'Yuna')!.name, 'Yuna');
    assert.equal(pickKoreanVoice(PHONE, '다른 폰에서 고른 목소리')!.name, 'Microsoft SunHi Online (Natural) - Korean (Korea)');
    assert.equal(pickKoreanVoice(PHONE, null)!.name, 'Microsoft SunHi Online (Natural) - Korean (Korea)');
    // 영어 목소리는 이름으로 골라도 쓰지 않는다
    assert.equal(pickKoreanVoice(PHONE, 'Samantha')!.name, 'Microsoft SunHi Online (Natural) - Korean (Korea)');
  });

  it('목록은 한국어만, 장난감 목소리는 빼고, 자연스러운 것부터', () => {
    const list = voiceChoices(PHONE);
    const names = list.map((item) => item.voice.name);
    assert.ok(!names.includes('Samantha'));
    assert.ok(!names.some((name) => name.startsWith('Grandma')));
    assert.equal(names[0], 'Microsoft SunHi Online (Natural) - Korean (Korea)');
    assert.equal(list.length, 7);
    assert.ok(names.indexOf('Yuna (향상됨)') < names.indexOf('Yuna'), '향상된 목소리가 먼저');
  });

  it('이름은 회사 · 언어 꼬리표를 떼고, 같은 사람 고급판은 구별하고, 겹치면 번호', () => {
    const labels = new Map(voiceChoices(PHONE).map((item) => [item.voice.name, item.label]));
    assert.equal(labels.get('Microsoft SunHi Online (Natural) - Korean (Korea)'), 'SunHi');
    assert.equal(labels.get('Microsoft Heami - Korean (Korea)'), 'Heami');
    assert.equal(labels.get('Google 한국의'), '구글 목소리');
    assert.equal(labels.get('Yuna (향상됨)'), 'Yuna 향상됨');
    assert.equal(labels.get('Yuna'), 'Yuna');
    // 안드로이드 엔진 id는 읽을 이름이 아니다 — 둘이면 번호로 나눈다
    assert.deepEqual([labels.get('ko-kr-x-kod-network'), labels.get('Samsung ko-kr-x-ism-local')].sort(), ['기기 목소리', '기기 목소리 2']);
    assert.equal(new Set(labels.values()).size, labels.size, '이름이 겹치는 목소리가 있다');
  });

  it('고급 목소리 · 인터넷 목소리를 표시한다', () => {
    const sunhi = voiceChoices(PHONE).find((item) => item.label === 'SunHi')!;
    assert.equal(sunhi.natural, true);
    assert.equal(sunhi.online, true);
    const yuna = voiceChoices(PHONE).find((item) => item.label === 'Yuna')!;
    assert.equal(yuna.natural, false);
    assert.equal(yuna.online, false);
  });

  it('같은 목소리가 두 번 오면 하나만', () => {
    const twice = [PHONE[3]!, { ...PHONE[3]! }];
    assert.equal(voiceChoices(twice).length, 1);
  });

  it('한국어 목소리가 없는 폰은 빈 목록', () => {
    assert.deepEqual(voiceChoices([{ name: 'Samantha', lang: 'en-US' }]), []);
  });
});

describe('말투마다 목소리 결', () => {
  it('혼자 모드(말투 없음)는 고른 값 그대로', () => {
    assert.deepEqual(voiceTuning(null, 1, 1), { rate: 1, pitch: 1 });
    assert.deepEqual(voiceTuning(undefined, 0.85, 1.14), { rate: 0.85, pitch: 1.14 });
  });

  it('활기 · 빡센은 빠르게, 젠틀은 느리고 낮게', () => {
    const gentle = voiceTuning('gentle');
    assert.ok(voiceTuning('tough').rate > gentle.rate && voiceTuning('energetic').rate > gentle.rate);
    assert.ok(voiceTuning('energetic').pitch > 1 && gentle.pitch < 1);
  });

  it('사람이 고른 빠르기 · 높이는 말투 결 위에 곱한다 — 말투를 바꿔도 "느리게"는 남는다', () => {
    for (const style of ['energetic', 'gentle', 'tough', 'fun'] as const) {
      const base = voiceTuning(style);
      const slow = voiceTuning(style, 0.85, 1);
      const low = voiceTuning(style, 1, 0.86);
      assert.ok(slow.rate < base.rate && slow.pitch === base.pitch, style);
      assert.ok(low.pitch < base.pitch && low.rate === base.rate, style);
      assert.equal(slow.rate, Math.round(STYLE_TONE[style].rate * 0.85 * 100) / 100);
    }
  });

  it('알아듣기 어려운 끝값은 자른다', () => {
    assert.deepEqual(voiceTuning('tough', 5, 5), { rate: 2, pitch: 1.5 });
    assert.deepEqual(voiceTuning('gentle', 0.1, 0.1), { rate: 0.5, pitch: 0.6 });
    // 저장된 값이 비었거나 0이면 보통으로
    assert.deepEqual(voiceTuning(null, 0, null), { rate: 1, pitch: 1 });
  });

  it('고르는 칸은 보통을 가운데에 두고 느린 · 낮은 것부터', () => {
    for (const options of [VOICE_RATES, VOICE_PITCHES]) {
      assert.equal(options.length, 3);
      assert.equal(options[1]!.value, 1);
      assert.ok(options[0]!.value < 1 && options[2]!.value > 1);
    }
  });
});
