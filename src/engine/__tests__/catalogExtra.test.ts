import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { EXERCISES, EXERCISE_AKA, exerciseById, isUnloaded, matchesExerciseQuery } from '../exercises.ts';
import { EXERCISE_REQUIREMENTS, availableExercises, exercisesUsing } from '../equipment.ts';
import { demoFor } from '../demos.ts';
import { MISTAKES } from '../mistakes.ts';
import { SETUP_GUIDE } from '../setupGuide.ts';
import { clipFrame, type Clip } from '../motionKit.ts';
import { faultsFor, motionFor } from '../motions.ts';
import { EXTRA_MOTIONS } from '../motionsExtra.ts';
import type { Vec3 } from '../rig.ts';

/** 5차에 더한 종목 — 집 · 아파트 헬스장에서 빠지던 것 */
const NEW_IDS = [
  'dumbbell-curl', 'incline-push-up', 'bodyweight-squat', 'single-leg-calf-raise', 'band-row', 'band-pull-apart',
  'band-lateral-raise', 'dumbbell-hip-thrust', 'dumbbell-reverse-lunge', 'dumbbell-sumo-squat', 'cable-glute-kickback',
  'dumbbell-fly', 'smith-incline-press', 'smith-shoulder-press', 'crunch',
] as const;

/** 매트 하나뿐인 초보를 위해 더한 바닥 종목 */
const FLOOR_IDS = ['knee-push-up', 'bird-dog', 'superman'] as const;

const clipOf = (id: string, fault?: string) => motionFor({ id }, fault) as Clip;
const dist = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

describe('새 종목 15개', () => {
  it('종목 · 필요 기구 · 큐 · 실수 · 자리 잡기 · 다른 이름 · 동작이 다 있다', () => {
    for (const id of [...NEW_IDS, ...FLOOR_IDS]) {
      const exercise = exerciseById(id);
      assert.ok(exercise, `${id}: 종목이 없다`);
      assert.ok(EXERCISE_REQUIREMENTS[id]?.length, `${id}: 필요 기구`);
      assert.equal(demoFor(exercise).cues.length, 3, `${id}: 큐`);
      assert.ok((MISTAKES[id] ?? []).length >= 2, `${id}: 실수`);
      assert.ok((SETUP_GUIDE[id] ?? []).length >= 2, `${id}: 자리 잡기`);
      assert.ok((EXERCISE_AKA[id] ?? []).length >= 1, `${id}: 다른 이름`);
      const clip = motionFor(exercise);
      assert.equal(clip?.id, id, `${id}: 동작`);
      for (const fault of faultsFor(exercise)) assert.equal(motionFor(exercise, fault)?.fault, fault, `${id}/${fault}`);
    }
  });

  it('새 동작 표는 있던 종목의 동작을 덮어쓰지 않는다', () => {
    assert.deepEqual(Object.keys(EXTRA_MOTIONS).sort(), [...NEW_IDS, ...FLOOR_IDS].sort());
  });

  it('다른 이름으로 찾아진다 — 띄어쓰기를 몰라도', () => {
    const find = (query: string) => EXERCISES.filter((exercise) => matchesExerciseQuery(exercise, query)).map((e) => e.id);
    for (const id of NEW_IDS) {
      const exercise = exerciseById(id)!;
      for (const alias of EXERCISE_AKA[id]!) assert.ok(matchesExerciseQuery(exercise, alias), `${id}: ${alias}`);
    }
    assert.ok(find('덤벨컬').includes('dumbbell-curl'));
    assert.ok(find('덤벨 컬').includes('dumbbell-curl'));
    assert.ok(find('사레레').includes('lateral-raise'));
    assert.ok(find('클로즈그립 랫풀다운').includes('neutral-grip-pulldown'));
    assert.ok(find('ohp').includes('barbell-overhead-press'), '영어 이름은 대소문자를 가리지 않는다');
    assert.ok(find('힙쓰').includes('hip-thrust') && find('힙쓰').includes('dumbbell-hip-thrust'));
    assert.equal(find('').length, EXERCISES.length, '빈 검색어는 전부');
    assert.deepEqual(find('무릎 푸시업'), ['knee-push-up'], '무릎 푸시업은 인클라인 푸시업과 다른 종목이다');
  });

  it('맨몸 · 밴드는 무게를 고르지 않는 종목이다', () => {
    assert.equal(isUnloaded(exerciseById('band-row')!), true);
    assert.equal(isUnloaded(exerciseById('crunch')!), true);
    assert.equal(isUnloaded(exerciseById('dumbbell-curl')!), false);
  });
});

describe('기구가 적은 집', () => {
  it('밴드만 있어도 등 · 어깨 옆 · 어깨 뒤 종목이 열린다', () => {
    const bands = availableExercises(['resistance-bands']).map((e) => e.id).sort();
    assert.deepEqual(bands, ['band-lateral-raise', 'band-pull-apart', 'band-row']);
    assert.deepEqual(exercisesUsing('resistance-bands').sort(), bands);
  });

  it('매트 하나로 앞허벅지 · 종아리 · 가슴 · 복근을 직접 한다', () => {
    const floor = availableExercises(['floor']);
    for (const muscle of ['quads', 'calves', 'chest', 'abs'] as const) {
      assert.ok(floor.some((e) => (e.contribution[muscle] ?? 0) >= 0.75), muscle);
    }
  });

  it('덤벨만 있어도 서서 하는 컬 · 엉덩이 · 런지가 있다', () => {
    const ids = availableExercises(['dumbbells']).map((e) => e.id);
    for (const id of ['dumbbell-curl', 'dumbbell-reverse-lunge', 'dumbbell-sumo-squat']) assert.ok(ids.includes(id), id);
    assert.ok(availableExercises(['dumbbells', 'bench-incline']).some((e) => e.id === 'dumbbell-hip-thrust'), '조절식 벤치로도 힙 쓰러스트');
  });
});

describe('새 종목의 동작이 그 종목답다', () => {
  it('덤벨 컬 — 손바닥이 앞을 보고, 덤벨이 어깨 높이 가까이 올라온다', () => {
    const clip = clipOf('dumbbell-curl');
    for (const key of clip.keys) assert.equal(key.pose.armL!.turn, 0);
    const low = clipFrame(clip, 0).solved.hands.L.grip;
    const high = clipFrame(clip, 0.42).solved.hands.L.grip;
    assert.ok(high[1] - low[1] > 0.35);
  });

  it('인클라인 푸시업 — 손은 벤치 위(0.45m), 가슴이 벤치 끝까지 내려간다', () => {
    const clip = clipOf('incline-push-up');
    const top = clipFrame(clip, 0).solved;
    const low = clipFrame(clip, 0.45).solved;
    assert.ok(Math.abs(top.hands.L.grip[1] - 0.47) < 0.02, '손이 벤치 높이');
    assert.ok(top.bones.upperArmL.a[1] - low.bones.upperArmL.a[1] > 0.2, '충분히 내려간다');
    const box = clip.scene.find((prim) => prim.kind === 'box')!;
    assert.ok(Math.min(low.bones.chest.a[1], low.bones.chest.b[1]) > box.p[1] + box.size[1]! / 2, '가슴 뼈가 벤치 위에 있다');
  });

  it('밴드 로우 — 바닥에 앉아 발바닥에서 손까지 밴드, 손은 배꼽 앞까지 온다', () => {
    const clip = clipOf('band-row');
    assert.equal(clip.cables?.length, 2);
    const frame = clipFrame(clip, 0.42).solved;
    assert.ok(frame.bones.pelvis.a[1] < 0.2, '바닥에 앉았다');
    for (const side of ['L', 'R'] as const) {
      assert.ok(frame.hands[side].grip[2] > frame.bones.chest.a[2] + 0.1, '손이 몸통에 박히지 않는다');
    }
  });

  it('케이블 킥백 — 낮은 도르래에서 오른 발목으로 줄이 간다', () => {
    const clip = clipOf('cable-glute-kickback');
    assert.deepEqual(clip.cables?.map((cable) => cable.to), ['footR']);
    assert.ok((clip.cables![0]!.from as Vec3)[1] < 0.2, '낮은 도르래');
    assert.equal(clip.side, 'R');
  });

  it('덤벨 스모 스쿼트 — 발은 어깨보다 넓고, 덤벨은 다리 사이로 골반에 묻히지 않는다', () => {
    const clip = clipOf('dumbbell-sumo-squat');
    for (const t of [0, 0.25, 0.45, 0.75]) {
      const frame = clipFrame(clip, t);
      const ankles = [frame.solved.bones.shinL.b, frame.solved.bones.shinR.b];
      assert.ok(Math.abs(ankles[0]![0] - ankles[1]![0]) > 0.55, '넓은 발');
      const bell = frame.moving.find((item) => item.kind === 'dumbbell')!;
      // 위 원판(가운데에서 10.5cm)이 골반 앞에 있다
      const plate: Vec3 = [bell.p[0] + bell.x[0] * 0.105, bell.p[1] + bell.x[1] * 0.105, bell.p[2] + bell.x[2] * 0.105];
      assert.ok(plate[2] - frame.solved.bones.pelvis.a[2] > 0.1, `t=${t} 덤벨이 골반에 묻힌다`);
    }
  });

  it('덤벨 플라이 — 위에서는 손이 어깨 위, 아래에서는 몸통 높이까지 옆으로 벌린다', () => {
    const clip = clipOf('dumbbell-fly');
    const top = clipFrame(clip, 0).solved;
    const open = clipFrame(clip, 0.45).solved;
    const shoulder = open.bones.upperArmL.a;
    assert.ok(top.hands.L.grip[1] - shoulder[1] > 0.45, '위에서 팔을 세운다');
    assert.ok(Math.abs(open.hands.L.grip[1] - shoulder[1]) < 0.1, '몸통 높이까지');
    assert.ok(open.hands.L.grip[0] - shoulder[0] > 0.45, '옆으로 벌린다');
    const deep = clipFrame(clipOf('dumbbell-fly', 'too-deep'), 0.45).solved;
    assert.ok(shoulder[1] - deep.hands.L.grip[1] > 0.12, '너무 깊은 실수는 몸통보다 한참 아래로');
  });

  it('스미스 숄더프레스 — 바가 레일을 따라 곧게, 얼굴 앞을 지나 턱 높이까지', () => {
    const clip = clipOf('smith-shoulder-press');
    const bars = Array.from({ length: 13 }, (_, i) => clipFrame(clip, i / 12).solved.bar!.c);
    const zs = bars.map((bar) => bar[2]);
    assert.ok(Math.max(...zs) - Math.min(...zs) < 1e-6, '바가 앞뒤로 움직이지 않는다');
    const low = clipFrame(clip, 0).solved;
    assert.ok(low.bar!.c[2] - low.bones.head.a[2] > 0.12, '바가 얼굴 앞에');
    const top = clipFrame(clip, 0.42).solved;
    assert.ok(top.bar!.c[1] > top.bones.head.b[1] + 0.15, '머리 위로');
  });

  it('크런치 — 허리는 바닥에, 어깨만 든다 (윗몸일으키기 실수는 허리까지 든다)', () => {
    const clip = clipOf('crunch');
    const rest = clipFrame(clip, 0).solved;
    const up = clipFrame(clip, 0.42).solved;
    assert.ok(Math.abs(up.bones.pelvis.a[1] - rest.bones.pelvis.a[1]) < 0.01, '골반은 그대로');
    assert.ok(up.bones.upperArmL.a[1] - rest.bones.upperArmL.a[1] > 0.1, '어깨가 뜬다');
    const situp = clipFrame(clipOf('crunch', 'sit-up'), 0.42).solved;
    assert.ok(situp.bones.lumbar.b[1] - up.bones.lumbar.b[1] > 0.05, '허리까지 든다');
  });

  it('덤벨 리버스 런지 — 두 손에 덤벨, 원판이 넓적다리에 묻히지 않는다', () => {
    const clip = clipOf('dumbbell-reverse-lunge');
    assert.deepEqual(clip.hold, { L: 'dumbbell', R: 'dumbbell' });
    for (let i = 0; i <= 12; i += 1) {
      const frame = clipFrame(clip, i / 12).solved;
      for (const side of ['L', 'R'] as const) {
        const hand = frame.hands[side].grip;
        for (const thigh of [frame.bones.thighL, frame.bones.thighR]) {
          // 넓적다리 가운데 줄에서 원판 반지름 + 넓적다리 굵기만큼은 떨어진다
          const mid: Vec3 = [(thigh.a[0] + thigh.b[0]) / 2, (thigh.a[1] + thigh.b[1]) / 2, (thigh.a[2] + thigh.b[2]) / 2];
          assert.ok(Math.min(dist(hand, thigh.a), dist(hand, mid)) > 0.12, `t=${i / 12} ${side}`);
        }
      }
    }
  });
});
