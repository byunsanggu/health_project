/**
 * 썸네일 손질 표 — 자동으로 고른 순간 · 각도가 약한 것만 여기서 바로잡는다.
 *
 * EX[운동 id] / EQ[기구 id] = { t?, view?: [yaw, pitch], zoom?, ... }
 *   t     동작 한 주기에서 찍을 때(0~1). 없으면 시작 자세에서 관절이 가장 많이 움직인 때.
 *   view  [수평 각, 내려다보는 각]. 없으면 동작이 정해 둔 각도(Clip.view).
 *   zoom  1보다 크면 몸 쪽으로 더 당긴다(기구 가장자리가 잘려도 된다). 1보다 작으면 기구가 다 들어오게 물러난다.
 *   focus 'hands' — 손에 든 기구를 가운데 두고 당겨 찍는다.
 * EQ 에는 더해서
 *   ex    이 기구를 대표할 운동 id (없으면 E.exercisesUsing(id)의 첫 종목)
 *   st    스트레칭 · 몸풀기 · 유산소 동작 id (운동이 없는 기구)
 *   cardio 몸 풀기에 없는 유산소 기계 시연 id (E.cardioMotionFor — 일립티컬)
 *   extra 'ball' | 'rope' | 'rack' | 'smith' — 동작에 없는 기구를 그 자리에서 만들어 얹는다(직접 만든 도형).
 *         rack 은 기둥 넷 · J후크 · 안전바, smith 는 바를 꿴 레일 · 걸쇠 — 둘이 작은 그림에서 헷갈리지 않게
 */
export const EX = {
  // 기구가 몸을 가리던 것 — 각도를 돌린다
  'leg-press': { view: [128, 16] },
  'dumbbell-calf-raise': { view: [-60, 12] },
  'machine-crunch': { view: [50, 12] },
  'pike-push-up': { t: 0.2, view: [95, 10] },
  // 높은 기둥 때문에 몸이 작던 것 — 몸 쪽으로 당긴다
  'lat-pulldown': { zoom: 1.25 },
  'neutral-grip-pulldown': { zoom: 1.25 },
  'straight-arm-pulldown': { zoom: 1.3 },
  'triceps-pushdown': { zoom: 1.3 },
  'inverted-row': { zoom: 1.3 },
  'machine-high-row': { zoom: 1.2 },
};

export const EQ = {
  floor: { ex: 'push-up' },
  'barbell-set': { ex: 'conventional-deadlift' },
  'ez-bar': { ex: 'barbell-curl' },
  dumbbells: { ex: 'hammer-curl', focus: 'hands', zoom: 1.3 },
  'power-rack': { ex: 'back-squat', extra: 'rack', view: [36, 18], zoom: 0.78 },
  'bench-flat': { ex: 'dumbbell-bench-press' },
  'bench-incline': { ex: 'incline-dumbbell-press' },
  'pull-up-bar': { ex: 'pull-up' },
  'cable-station': { ex: 'cable-fly' },
  'smith-machine': { ex: 'smith-squat', extra: 'smith', view: [28, 10], zoom: 0.85 },
  kettlebells: { ex: 'kettlebell-swing', focus: 'hands', zoom: 1.3 },
  'resistance-bands': { ex: 'band-lateral-raise' },
  'leg-curl-machine': { ex: 'seated-leg-curl' },
  'foam-roller': { st: 'roll-hams-calves', view: [55, 16] },
  treadmill: { st: 'treadmill-walk' },
  'stationary-bike': { st: 'bike-easy' },
  'rowing-machine': { st: 'row-easy', zoom: 0.8 },
  'stair-climber': { st: 'stairs-easy' },
  'elliptical-machine': { cardio: 'elliptical', t: 0.5, view: [42, 14] },
  'medicine-ball': { ex: 'goblet-squat', t: 0, extra: 'ball', focus: 'hands', zoom: 1.3 },
  'battle-rope': { ex: 'kettlebell-swing', extra: 'rope' },
};
