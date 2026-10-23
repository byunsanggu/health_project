# 3D 근육 그림

종목 썸네일과 "쓰는 근육" 그림을 입체로 그리는 렌더러다. 앱은 여기서 미리 그린 장
(`prototype/body3d/*.png`)을 싣고, 종목마다 색만 칠한다(`prototype/bodyMap3d.js`) — 폰에서 3D를
돌리지 않는다. 몸 모양을 고쳤으면 `node tools/body3d/layers.mjs`로 장을 다시 그린다.

- 외부 3D 모델이나 남의 그림을 쓰지 않는다. 몸은 `body.html`의 셰이더 안에서 타원체 ·
  둥근 원뿔을 부드럽게 이어 붙여 직접 빚는다(SDF 레이마칭). 근육 하나가 표면 한 덩어리다.
- 색은 엔진의 기여도(`Exercise.contribution`)대로 칠한다. 진한 색이 주동근, 옅은 색이 보조근.
- 근육 칸은 엔진 `MUSCLE_GROUPS` 열네 개 + 허리(척추기립근) 하나. 엔진의 '등'은 광배근과
  허리를 한 칸에 두므로, 엉덩이를 접는 종목(데드리프트 · 굿모닝)은 허리로, 당기는 종목은
  광배근으로 나눠 칠한다(`batch.mjs`의 `paint`).

## 앱에 싣는 장 다시 그리기

```sh
node tools/body3d/layers.mjs     # → prototype/body3d/{upper,lower,full}-{front,back}.png
```

장 한 장의 위 절반은 빛(R = √(곱할 빛/1.4) · G = 더할 빛/0.5 · B = 덮인 정도), 아래 절반은 표면에
가장 가까운 근육 둘(번호 × 16 + 가까운 정도)이다. 투명도는 쓰지 않는다 — 브라우저가 반투명 화소를
그리며 값을 반올림하면 근육 번호가 깨진다.

## 시안 페이지 돌리기

```sh
mkdir -p tools/body3d/out
node tools/body3d/contrib.ts barbell-bench-press pull-up cable-fly seated-dumbbell-press \
  lateral-raise barbell-curl triceps-pushdown back-squat romanian-deadlift leg-press \
  > tools/body3d/out/contrib.json
node tools/body3d/batch.mjs                 # 밝은 화면용 → out/light
THEME=dark node tools/body3d/batch.mjs      # 어두운 화면용 → out/dark
node tools/body3d/gen-preview.ts            # 지금 그림과 나란히 놓은 시안 페이지 → out/preview.html
node tools/body3d/shoot.mjs out.png '#part-list' light
```

한 장만 그릴 때: `node tools/body3d/render.mjs a.png view=back w=480 h=960 ss=3 fiber=1 m=0,1,...`

`body.html`의 주소 인자 — `view`(front · back) · `w` · `h` · `ss`(한 픽셀 광선 수, 한 변) ·
`m`(근육 15칸 칠할 세기) · `frame`(가운데 높이, 보이는 높이 — 상반신 `1.29,1.06`, 하반신
`0.50,1.08`) · `yaw`(도) · `fiber`(근섬유 결, 작은 그림은 0) · `accent` · `clay`(16진 색).
