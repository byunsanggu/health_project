# 코치 목소리 만들기

PT 코치 목소리는 기기 음성합성이 아니라 미리 만든 소리 조각이다. 오픈소스
[Supertonic 3](https://github.com/supertone-inc/supertonic) (Supertone · 코드 MIT, 모델 OpenRAIL-M)을
이 컴퓨터에서 돌려 만든다. 인터넷 음성 서비스 · 요금 없음.

## 무엇을 만드나

- `src/engine/speechCorpus.ts` — 코치가 할 수 있는 말 전부를 조각으로(`src/engine/speech.ts`의 규칙).
  숫자 · 종목 이름은 따로 조각이 있고, 나머지 고정된 말은 문장 그대로.
- 목소리 다섯: 활기(남 · 여) · 젠틀 · 빡센(반말) · 유머. 목소리 결은 Supertonic 기본 목소리 10개를
  섞거나 과장해서 만든다(`generate.py`의 `VOICES`).
- 결과: `prototype/voice/<목소리>/<조각 id>.mp3`, `manifest.json`.

## 다시 만들기

```sh
# 1) 모델 파일 — Hugging Face(Supertone/supertonic-3)에서 받거나, 같은 파일을 실은 npm 패키지에서 꺼낸다
#    npm pack @3sln/donki-lle-voice-multi @3sln/donki-lle-voice-multi-2 @3sln/donki-lle-voice-multi-3
#    (ES 모듈 안에 base64로 나뉘어 있다 — voice.js의 files 표대로 이어 붙이면 된다)
# 2) 준비
pip install sherpa-onnx numpy soundfile   # ffmpeg(rubberband 포함)도 있어야 한다
# 3) 말 목록 → 소리
node tools/voice/export.ts > /tmp/voice-pieces.json
python3 tools/voice/generate.py --model <모델 폴더> --pieces /tmp/voice-pieces.json --out prototype/voice
```

이미 있는 조각은 건너뛰고, 목록에서 빠진 옛 조각은 지운다. 말을 몇 줄 고치면 그 조각만 새로 만든다.
코치 말을 고치고 이걸 다시 돌리지 않으면 테스트(`speech.test.ts`)는 통과해도 새 말은 소리가 없다 —
앱은 그 조각을 건너뛰고 화면 글만 보여 준다.
