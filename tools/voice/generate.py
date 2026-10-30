"""
코치 목소리 조각을 만든다 — 오픈소스 Supertonic 3 (Supertone, 모델 OpenRAIL-M)를 이 컴퓨터에서 돌린다.

    node tools/voice/export.ts > /tmp/voice-pieces.json
    python3 tools/voice/generate.py --model DIR --pieces /tmp/voice-pieces.json --out prototype/voice [--voice tough]

DIR에는 Supertonic 3 ONNX 파일(duration_predictor.onnx · text_encoder.onnx · vector_estimator.onnx ·
vocoder.onnx · tts.json · unicode_indexer.bin · voice.bin)이 있어야 한다. 받는 법은 README.md.
필요한 것: pip install sherpa-onnx numpy soundfile, ffmpeg(rubberband 필터 포함).

목소리마다 prototype/voice/<목소리>/<조각 id>.mp3 와 manifest.json(조각 id 목록)을 만든다.
이미 있는 조각은 건너뛴다 — 말을 몇 줄 고치면 그 조각만 새로 만든다.
"""
import argparse
import json
import os
import subprocess
import sys
import tempfile

import numpy as np
import sherpa_onnx
import soundfile as sf

# 조각 이름 → 파일 이름. src/engine/speech.ts의 clipId와 같아야 한다 (cyrb53).
def clip_id(text: str) -> str:
    m32 = 0xFFFFFFFF
    def imul(a, b):
        return (a * b) & m32
    h1, h2 = 0xDEADBEEF, 0x41C6CE57
    for ch in text.encode('utf-16-le').decode('utf-16-le'):
        code = ord(ch)
        units = [code] if code < 0x10000 else [0xD800 + ((code - 0x10000) >> 10), 0xDC00 + ((code - 0x10000) & 0x3FF)]
        for c in units:
            h1 = imul(h1 ^ c, 2654435761)
            h2 = imul(h2 ^ c, 1597334677)
    h1 = imul(h1 ^ (h1 >> 16), 2246822507) ^ imul(h2 ^ (h2 >> 13), 3266489909)
    h2 = imul(h2 ^ (h2 >> 16), 2246822507) ^ imul(h1 ^ (h1 >> 13), 3266489909)
    h1 &= m32
    h2 &= m32
    return format(4294967296 * (2097151 & h2) + h1, 'x').rjust(14, '0')


# 읽힐 글 — src/engine/speech.ts의 synthText와 같게 (영어 글자는 한국어 소리로)
def synth_text(piece: str) -> str:
    return piece.replace('PT', '피티').replace('W-Y', '더블유 와이').replace('·', ',')


# 거칠게: 저음 · 중음을 세우고, 살짝 찌그러뜨리고(배음), 세게 눌러 외치는 듯이
GRIT = 'equalizer=f=110:t=q:w=1:g=5,equalizer=f=1800:t=q:w=1.2:g=4,asoftclip=type=tanh:param=1.6,acompressor=threshold=-24dB:ratio=6:attack=3:release=60:makeup=4'

# 목소리 다섯 — 들어 보고 고른 것 (활기 남 1-B · 활기 여 1-A · 젠틀 2-A · 빡센 3-B · 유머 4-A)
VOICES = {
    'energetic-m': {'style': 'energetic', 'mix': [(7, 1.0)], 'push': 0.35, 'speed': 1.1, 'pitch': 1.06, 'fx': 'equalizer=f=3000:t=q:w=1:g=3'},
    'energetic-f': {'style': 'energetic', 'mix': [(1, 1.0)], 'push': 0.35, 'speed': 1.1, 'pitch': 1.06, 'fx': 'equalizer=f=3500:t=q:w=1:g=3'},
    'gentle': {'style': 'gentle', 'mix': [(5, 0.5), (8, 0.5)], 'push': 0.0, 'speed': 0.93, 'pitch': 1.0, 'fx': 'equalizer=f=150:t=q:w=1:g=3,equalizer=f=6000:t=q:w=1:g=-2'},
    'tough': {'style': 'tough', 'mix': [(6, 0.6), (7, 0.4)], 'push': 0.5, 'speed': 1.08, 'pitch': 0.95, 'fx': GRIT},
    'fun': {'style': 'fun', 'mix': [(7, 1.0)], 'push': 0.2, 'speed': 1.04, 'pitch': 1.03, 'fx': ''},
}


def custom_voices(model_dir: str, work: str) -> tuple[str, dict]:
    """기존 10개 목소리 결을 섞거나 과장해 다섯 목소리를 만들어 voice.bin 뒤에 붙인다."""
    raw = open(os.path.join(model_dir, 'voice.bin'), 'rb').read()
    n, a1, a2, _, b1, b2 = [int(x) for x in np.frombuffer(raw[:48], dtype=np.int64)]
    body = np.frombuffer(raw[48:], dtype=np.float32)
    ttl = body[:n * a1 * a2].reshape(n, a1, a2)
    dp = body[n * a1 * a2:].reshape(n, b1, b2)
    mean_t, mean_d = ttl.mean(0), dp.mean(0)
    names = list(VOICES)
    new_t, new_d = [], []
    for name in names:
        spec = VOICES[name]
        t = sum(w * ttl[i] for i, w in spec['mix'])
        d = sum(w * dp[i] for i, w in spec['mix'])
        k = spec['push']
        new_t.append(mean_t + (1 + k) * (t - mean_t))
        new_d.append(mean_d + (1 + k) * (d - mean_d))
    T = np.concatenate([ttl, np.stack(new_t)]).astype(np.float32)
    D = np.concatenate([dp, np.stack(new_d)]).astype(np.float32)
    total = T.shape[0]
    path = os.path.join(work, 'voice_coach.bin')
    with open(path, 'wb') as f:
        f.write(np.array([total, a1, a2, total, b1, b2], dtype=np.int64).tobytes() + T.tobytes() + D.tobytes())
    return path, {name: n + i for i, name in enumerate(names)}


def trim(samples: np.ndarray, rate: int) -> np.ndarray:
    """앞뒤 무음을 덜어 낸다 — 조각을 이어 붙일 때 틈이 벌어지지 않게. 30ms는 남긴다."""
    level = np.abs(samples)
    loud = np.where(level > max(0.01, level.max() * 0.04))[0]
    if len(loud) == 0:
        return samples
    keep = int(0.03 * rate)
    return samples[max(0, loud[0] - keep): min(len(samples), loud[-1] + keep)]


def level(samples: np.ndarray) -> np.ndarray:
    """조각마다 크기를 맞춘다 — 소리 큰 조각 뒤에 작은 조각이 오면 끊겨 들린다."""
    rms = float(np.sqrt(np.mean(samples ** 2))) or 1e-6
    out = samples * (0.1 / rms)
    peak = float(np.abs(out).max()) or 1.0
    return out * min(1.0, 0.9 / peak)


def encode(samples: np.ndarray, rate: int, fx: str, pitch: float, out: str, work: str) -> None:
    wav = os.path.join(work, 'clip.wav')
    sf.write(wav, samples.astype(np.float32), rate)
    chain = []
    if abs(pitch - 1.0) > 1e-3:
        chain.append(f'rubberband=pitch={pitch}:formant=preserved')
    if fx:
        chain.append(fx)
    chain.append('alimiter=limit=0.95')
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', wav, '-af', ','.join(chain), '-ac', '1', '-ar', '24000', '-b:a', '32k', out], check=True)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--model', required=True)
    parser.add_argument('--pieces', required=True)
    parser.add_argument('--out', required=True)
    parser.add_argument('--voice', action='append', help='이 목소리만 (여러 번 줄 수 있다)')
    parser.add_argument('--only', help='이 조각들만 (JSON 배열 파일) — 샘플용')
    parser.add_argument('--threads', type=int, default=4)
    args = parser.parse_args()

    data = json.load(open(args.pieces, encoding='utf-8'))
    only = set(json.load(open(args.only, encoding='utf-8'))) if args.only else None
    work = tempfile.mkdtemp(prefix='voice-')
    voice_bin, sid = custom_voices(args.model, work)
    m = args.model
    tts = sherpa_onnx.OfflineTts(sherpa_onnx.OfflineTtsConfig(model=sherpa_onnx.OfflineTtsModelConfig(
        supertonic=sherpa_onnx.OfflineTtsSupertonicModelConfig(
            os.path.join(m, 'duration_predictor.onnx'), os.path.join(m, 'text_encoder.onnx'),
            os.path.join(m, 'vector_estimator.onnx'), os.path.join(m, 'vocoder.onnx'), os.path.join(m, 'tts.json'),
            os.path.join(m, 'unicode_indexer.bin'), voice_bin),
        num_threads=args.threads)))

    for name in args.voice or list(VOICES):
        spec = VOICES[name]
        pieces = data['styles'][spec['style']]
        if only is not None:
            pieces = [piece for piece in pieces if piece in only]
        folder = os.path.join(args.out, name)
        os.makedirs(folder, exist_ok=True)
        made = 0
        for index, piece in enumerate(pieces):
            out = os.path.join(folder, clip_id(piece) + '.mp3')
            if os.path.exists(out):
                continue
            config = sherpa_onnx.GenerationConfig()
            config.sid = sid[name]
            config.speed = spec['speed']
            config.num_steps = 10
            config.extra = {'lang': 'ko'}
            audio = tts.generate(synth_text(piece), config)
            samples = level(trim(np.asarray(audio.samples, dtype=np.float32), audio.sample_rate))
            encode(samples, audio.sample_rate, spec['fx'], spec['pitch'], out, work)
            made += 1
            if made % 100 == 0:
                print(f'{name}: {index + 1}/{len(pieces)}', file=sys.stderr, flush=True)
        if only is None:
            ids = sorted({clip_id(piece) for piece in data['styles'][spec['style']]})
            # 목록에 없는 옛 조각은 지운다 — 말을 고치면 옛 소리가 남지 않게
            for file in os.listdir(folder):
                if file.endswith('.mp3') and file[:-4] not in ids:
                    os.remove(os.path.join(folder, file))
            json.dump({'voice': name, 'style': spec['style'], 'clips': ids}, open(os.path.join(folder, 'manifest.json'), 'w'))
        print(f'{name}: {made}개 새로 만듦', file=sys.stderr, flush=True)


if __name__ == '__main__':
    main()
