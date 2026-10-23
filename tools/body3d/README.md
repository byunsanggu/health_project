# 3D 근육 그림 (시안)

종목 썸네일과 "쓰는 근육" 그림을 입체로 바꾸기 위한 렌더러다. **아직 앱에 연결하지 않았다** —
시안을 보고 정한 다음 붙인다.

- 외부 3D 모델이나 남의 그림을 쓰지 않는다. 몸은 `body.html`의 셰이더 안에서 타원체 ·
  둥근 원뿔을 부드럽게 이어 붙여 직접 빚는다(SDF 레이마칭). 근육 하나가 표면 한 덩어리다.
- 색은 엔진의 기여도(`Exercise.contribution`)대로 칠한다. 진한 색이 주동근, 옅은 색이 보조근.
- 근육 칸은 엔진 `MUSCLE_GROUPS` 열네 개 + 허리(척추기립근) 하나. 엔진의 '등'은 광배근과
  허리를 한 칸에 두므로, 엉덩이를 접는 종목(데드리프트 · 굿모닝)은 허리로, 당기는 종목은
  광배근으로 나눠 칠한다(`batch.mjs`의 `paint`).

## 돌리기

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
