/**
 * 화면이 꺼져도 울리는 휴식 끝 소리.
 *
 * 웹 앱은 폰을 잠그면 멈춘다. 타이머도 말도 멈추고, 서비스 워커 알림도 워커가
 * 내려가면 놓친다. 그런데 **이미 재생 중인 음원은** 잠금 화면에서도 끝까지
 * 재생된다 — 음악 앱이 그렇게 돈다.
 *
 * 그래서 휴식이 시작될 때 "휴식 길이만큼의 무음 + 끝에 알림음"을 한 덩어리
 * 소리 파일로 만들어 틀어 둔다. 폰을 잠가도 재생은 계속되고, 끝에서 울린다.
 *
 * 파일은 8kHz · 8비트 · 모노 WAV다. 무음은 1초에 8KB라 10분이어도 5MB가 안 되고,
 * 알림음(880Hz)을 담기에는 충분하다.
 */

export const REST_SOUND_RATE = 8000;
/** 이보다 길면 자른다 — 휴식이 10분을 넘으면 그건 휴식이 아니다. */
export const REST_SOUND_MAX_SECONDS = 600;

/** 끝의 알림음 — 짧게 세 번, 마지막은 길게. 초 단위. */
const CHIME: readonly { tone: number; seconds: number }[] = [
  { tone: 880, seconds: 0.16 }, { tone: 0, seconds: 0.1 },
  { tone: 880, seconds: 0.16 }, { tone: 0, seconds: 0.1 },
  { tone: 1175, seconds: 0.5 },
];

export function chimeSeconds(): number {
  return CHIME.reduce((sum, part) => sum + part.seconds, 0);
}

/**
 * 무음(silenceSeconds) 뒤에 알림음이 붙은 WAV 바이트.
 * 무음은 0 미만이면 0, 상한을 넘으면 상한으로 자른다.
 * withChime이 false면 무음만 — 첫 터치 때 재생기를 깨워 두는 용도다.
 */
export function restAlarmWav(silenceSeconds: number, withChime = true): Uint8Array {
  const rate = REST_SOUND_RATE;
  const silence = Math.max(0, Math.min(REST_SOUND_MAX_SECONDS, Number.isFinite(silenceSeconds) ? silenceSeconds : 0));
  const silentSamples = Math.round(silence * rate);
  const chime = withChime ? CHIME : [];
  const chimeSamples = chime.reduce((sum, part) => sum + Math.round(part.seconds * rate), 0);
  const samples = silentSamples + chimeSamples;

  const bytes = new Uint8Array(44 + samples);
  const view = new DataView(bytes.buffer);
  const text = (at: number, value: string) => {
    for (let i = 0; i < value.length; i += 1) bytes[at + i] = value.charCodeAt(i);
  };
  text(0, 'RIFF');
  view.setUint32(4, 36 + samples, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true); // fmt 덩어리 길이
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // 모노
  view.setUint32(24, rate, true);
  view.setUint32(28, rate, true); // 초당 바이트 (8비트 모노)
  view.setUint16(32, 1, true); // 한 샘플 바이트
  view.setUint16(34, 8, true); // 비트
  text(36, 'data');
  view.setUint32(40, samples, true);

  // 8비트 PCM의 무음은 0이 아니라 가운데(128)다
  bytes.fill(128, 44, 44 + silentSamples);
  let at = 44 + silentSamples;
  for (const part of chime) {
    const count = Math.round(part.seconds * rate);
    for (let i = 0; i < count; i += 1) {
      if (part.tone === 0) {
        bytes[at + i] = 128;
        continue;
      }
      // 앞뒤를 짧게 줄여 "딱" 소리 없이 — 10ms 페이드
      const fade = Math.min(1, i / (rate * 0.01), (count - i) / (rate * 0.01));
      const value = Math.sin((2 * Math.PI * part.tone * i) / rate) * 0.8 * fade;
      bytes[at + i] = Math.round(128 + value * 127);
    }
    at += count;
  }
  return bytes;
}
