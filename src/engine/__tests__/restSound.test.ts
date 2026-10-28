import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { REST_SOUND_MAX_SECONDS, REST_SOUND_RATE, chimeSeconds, restAlarmWav } from '../restSound.ts';

const text = (bytes: Uint8Array, at: number, length: number) =>
  String.fromCharCode(...bytes.slice(at, at + length));

describe('화면 꺼도 울리는 휴식 끝 소리', () => {
  it('재생기가 읽는 WAV 머리 — 8kHz · 8비트 · 모노 PCM', () => {
    const wav = restAlarmWav(5);
    const view = new DataView(wav.buffer);
    assert.equal(text(wav, 0, 4), 'RIFF');
    assert.equal(text(wav, 8, 4), 'WAVE');
    assert.equal(text(wav, 36, 4), 'data');
    assert.equal(view.getUint16(20, true), 1);
    assert.equal(view.getUint16(22, true), 1);
    assert.equal(view.getUint32(24, true), REST_SOUND_RATE);
    assert.equal(view.getUint16(34, true), 8);
    assert.equal(view.getUint32(4, true), wav.length - 8);
    assert.equal(view.getUint32(40, true), wav.length - 44);
  });

  it('휴식 길이만큼 조용하다가 끝에서 울린다', () => {
    const wav = restAlarmWav(90);
    const silent = 90 * REST_SOUND_RATE;
    assert.equal(wav.length, 44 + silent + Math.round(chimeSeconds() * REST_SOUND_RATE));
    assert.ok(wav.slice(44, 44 + silent).every((value) => value === 128), '무음 구간에 소리가 있습니다');
    const tail = wav.slice(44 + silent);
    assert.ok(Math.max(...tail) - Math.min(...tail) > 150, '끝에 알림음이 없습니다');
  });

  it('음수 · 이상한 값은 바로 울리고, 너무 긴 휴식은 자른다', () => {
    const chime = Math.round(chimeSeconds() * REST_SOUND_RATE);
    assert.equal(restAlarmWav(-3).length, 44 + chime);
    assert.equal(restAlarmWav(Number.NaN).length, 44 + chime);
    assert.equal(restAlarmWav(5000).length, 44 + REST_SOUND_MAX_SECONDS * REST_SOUND_RATE + chime);
  });

  it('알림음 없이 무음만 만들 수 있다 — 재생기 깨우기용', () => {
    const wav = restAlarmWav(0.1, false);
    assert.equal(wav.length, 44 + 0.1 * REST_SOUND_RATE);
    assert.ok(wav.slice(44).every((value) => value === 128));
  });
});
