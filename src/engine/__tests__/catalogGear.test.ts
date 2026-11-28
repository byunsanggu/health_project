import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { EXERCISE_AKA, exerciseById, matchesExerciseQuery, EXERCISES } from '../exercises.ts';
import {
  EQUIPMENT_CATALOG, EQUIPMENT_GROUPS, EQUIPMENT_SHORT, EXERCISE_REQUIREMENTS, availableExercises, equipmentGroupOf, equipmentGuide,
  exercisesUsing, findEquipment, gymFromCatalog, machineArea, parseEquipmentList, requirementsMet,
} from '../equipment.ts';
import { demoFor } from '../demos.ts';
import { MISTAKES } from '../mistakes.ts';
import { SETUP_GUIDE } from '../setupGuide.ts';
import { ANCHOR_FACTORS } from '../strength.ts';
import { GYM_PRESETS, presetEquipment } from '../gymPresets.ts';
import { findSubstitutes } from '../pain.ts';
import { clipFrame, type Clip } from '../motionKit.ts';
import { faultsFor, motionFor } from '../motions.ts';
import { GEAR_MOTIONS } from '../motionsGear.ts';
import type { Vec3 } from '../rig.ts';

/** 6차에 더한 종목 — 한국 헬스장 · PT 스튜디오에 흔한데 빠져 있던 것 */
const NEW_IDS = ['trx-row', 'trx-chest-press', 'smith-hip-thrust', 'smith-split-squat', 'dumbbell-pullover'] as const;

const clipOf = (id: string, fault?: string) => motionFor({ id }, fault) as Clip;
const dist = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const angle = (a: Vec3, b: Vec3) => {
  const dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  return (Math.acos(Math.max(-1, Math.min(1, dot / (Math.hypot(...a) * Math.hypot(...b))))) * 180) / Math.PI;
};
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

describe('6차 종목 다섯', () => {
  it('종목 · 필요 기구 · 큐 · 실수 · 자리 잡기 · 다른 이름 · 동작 · 첫 무게 근거가 다 있다', () => {
    for (const id of NEW_IDS) {
      const exercise = exerciseById(id);
      assert.ok(exercise, `${id}: 종목이 없다`);
      assert.ok(EXERCISE_REQUIREMENTS[id]?.length, `${id}: 필요 기구`);
      assert.equal(demoFor(exercise).cues.length, 3, `${id}: 큐`);
      assert.ok((MISTAKES[id] ?? []).length >= 2, `${id}: 실수`);
      assert.ok((SETUP_GUIDE[id] ?? []).length >= 2, `${id}: 자리 잡기`);
      assert.ok((EXERCISE_AKA[id] ?? []).length >= 1, `${id}: 다른 이름`);
      for (const alias of EXERCISE_AKA[id]!) assert.ok(matchesExerciseQuery(exercise, alias), `${id}: ${alias}`);
      assert.equal(motionFor(exercise)?.id, id, `${id}: 동작`);
      for (const fault of faultsFor(exercise)) assert.equal(motionFor(exercise, fault)?.fault, fault, `${id}/${fault}`);
      // 맨몸(TRX)은 무게 숫자가 없다 — 그 밖에는 첫 무게를 짐작할 근거가 있다
      if (exercise.equipment !== 'bodyweight') assert.ok(ANCHOR_FACTORS[id], `${id}: 첫 무게 근거`);
    }
  });

  it('새 동작 표는 있던 종목의 동작을 덮어쓰지 않는다', () => {
    assert.deepEqual(Object.keys(GEAR_MOTIONS).sort(), [...NEW_IDS].sort());
  });

  it('흔히 부르는 이름으로 찾아진다', () => {
    const find = (query: string) => EXERCISES.filter((exercise) => matchesExerciseQuery(exercise, query)).map((e) => e.id);
    assert.ok(find('풀오버').includes('dumbbell-pullover'));
    assert.ok(find('스미스 런지').includes('smith-split-squat'));
    assert.ok(find('trx').includes('trx-row'), '영어는 대소문자를 가리지 않는다');
    assert.ok(find('힙쓰').includes('smith-hip-thrust'));
  });

  it('아픈 날 대체 후보로도 쓰인다 — 허리가 아픈 날 바벨 로우 대신 TRX 로우', () => {
    const row = exerciseById('barbell-row')!;
    const pool = availableExercises(['suspension-trainer', 'floor']);
    const subs = findSubstitutes(row, [{ joint: 'lowBack', score: 5 }], { pool }).map((e) => e.id);
    assert.ok(subs.includes('trx-row'), subs.join(', '));
  });
});

describe('새 동작이 그 종목답다', () => {
  it('TRX 로우 — 띠 두 가닥이 위 한 점에서 손으로, 당기면 몸이 일어서고 띠 길이는 거의 그대로', () => {
    const clip = clipOf('trx-row');
    assert.equal(clip.cables?.length, 2);
    assert.ok(clip.cables!.every((cable) => cable.strap), '넓적한 띠로 그린다');
    const anchor = clip.cables![0]!.from as Vec3;
    assert.ok(anchor[1] > 2, '띠는 머리 위에 걸려 있다');
    const start = clipFrame(clip, 0);
    const end = clipFrame(clip, 0.42);
    // 띠가 그려지는 조각
    assert.equal(start.moving.filter((item) => item.kind === 'strapLine').length, 2);
    // 시작은 뒤로 기댄 몸, 끝은 더 선 몸 (골반이 위로)
    assert.ok(end.solved.bones.pelvis.a[1] - start.solved.bones.pelvis.a[1] > 0.08, '당기면 몸이 손 쪽으로 일어선다');
    for (const side of ['L', 'R'] as const) {
      const a = dist(anchor, start.solved.hands[side].grip);
      const b = dist(anchor, end.solved.hands[side].grip);
      assert.ok(Math.abs(a - b) < 0.05, `띠 길이가 ${a.toFixed(2)} → ${b.toFixed(2)}`);
    }
    // 끝에서 손은 가슴 옆 — 어깨보다 아래, 몸통 앞
    const chest = end.solved.bones.chest;
    assert.ok(end.solved.hands.L.grip[1] < chest.b[1], '손이 어깨보다 아래');
    // 뒤꿈치는 바닥에
    for (const foot of [start.solved.bones.footL, end.solved.bones.footL]) assert.ok(Math.min(foot.a[1], foot.b[1]) < 0.1);
  });

  it('TRX 체스트 프레스 — 띠를 등지고 앞으로 기운 몸, 내려가면 몸이 더 눕는다', () => {
    const clip = clipOf('trx-chest-press');
    const anchor = clip.cables![0]!.from as Vec3;
    const top = clipFrame(clip, 0).solved;
    const low = clipFrame(clip, 0.45).solved;
    assert.ok(anchor[2] < top.bones.pelvis.a[2], '띠는 몸 뒤쪽 위에 걸려 있다');
    assert.ok(top.hands.L.grip[2] > top.bones.chest.b[2], '위에서 손은 몸 앞으로 뻗는다');
    assert.ok(low.bones.chest.b[1] < top.bones.chest.b[1] - 0.1, '내려가면 어깨가 낮아진다');
    const a = dist(anchor, top.hands.R.grip);
    const b = dist(anchor, low.hands.R.grip);
    assert.ok(Math.abs(a - b) < 0.06, `띠 길이가 ${a.toFixed(2)} → ${b.toFixed(2)}`);
  });

  it('스미스 힙 쓰러스트 — 바는 레일을 따라 곧게, 골반 위에 얹혀 25cm 넘게 오른다', () => {
    const clip = clipOf('smith-hip-thrust');
    assert.equal(clip.bar?.kind, 'smith');
    const frames = Array.from({ length: 25 }, (_, i) => clipFrame(clip, i / 24).solved);
    const zs = frames.map((frame) => frame.bar!.c[2]);
    assert.ok(Math.max(...zs) - Math.min(...zs) < 1e-6, '바가 앞뒤로 움직이지 않는다');
    const ys = frames.map((frame) => frame.bar!.c[1]);
    assert.ok(Math.max(...ys) - Math.min(...ys) > 0.25);
    for (const frame of frames) {
      // 골반(엉덩이) 바로 위 — 10cm 안
      assert.ok(Math.abs(frame.bar!.c[2] - frame.bones.pelvis.a[2]) < 0.15, '바가 골반 위에 있다');
    }
  });

  it('스미스 스플릿 스쿼트 — 두 발은 제자리, 바는 곧게 내려오고 골반이 25cm 넘게 내려간다', () => {
    const clip = clipOf('smith-split-squat');
    const frames = Array.from({ length: 25 }, (_, i) => clipFrame(clip, i / 24).solved);
    const zs = frames.map((frame) => frame.bar!.c[2]);
    assert.ok(Math.max(...zs) - Math.min(...zs) < 0.005, '바가 앞뒤로 움직이지 않는다');
    const front = frames.map((frame) => frame.bones.shinL.b);
    assert.ok(front.every((ankle) => dist(ankle, front[0]!) < 0.01), '앞발이 제자리');
    const top = frames[0]!.bones.pelvis.a[1];
    const low = clipFrame(clip, 0.45).solved.bones.pelvis.a[1];
    assert.ok(top - low > 0.25);
    assert.equal(clip.side, 'L');
  });

  it('덤벨 풀오버 — 팔꿈치는 살짝만 굽힌 채 가슴 위에서 머리 뒤까지 반원을 그린다', () => {
    const clip = clipOf('dumbbell-pullover');
    assert.equal(clip.bar?.kind, 'dumbbell');
    const top = clipFrame(clip, 0).solved;
    const back = clipFrame(clip, 0.45).solved;
    assert.ok(top.hands.L.grip[1] - top.bones.upperArmL.a[1] > 0.45, '위에서 팔을 천장으로 세운다');
    assert.ok(back.hands.L.grip[2] < back.bones.head.b[2], '아래에서 손이 머리 뒤로 넘어간다');
    for (let i = 0; i <= 24; i += 1) {
      const b = clipFrame(clip, i / 24).solved.bones;
      const elbow = angle(sub(b.upperArmL.b, b.upperArmL.a), sub(b.forearmL.b, b.forearmL.a));
      assert.ok(elbow < 50, `t=${i / 24}: 팔꿈치 ${elbow.toFixed(0)}° — 반원이 아니라 팔을 접고 있다`);
    }
    // 팔꿈치를 접는 실수는 실제로 접는다
    const bent = clipFrame(clipOf('dumbbell-pullover', 'elbow-bend'), 0.45).solved.bones;
    assert.ok(angle(sub(bent.upperArmL.b, bent.upperArmL.a), sub(bent.forearmL.b, bent.forearmL.a)) > 60);
    // 덤벨이 벤치에 박히지 않는다 — 벤치 끝을 지나서 내려간다
    const bench = clip.scene.find((prim) => prim.kind === 'pad')!;
    const benchEnd = bench.p[2] - bench.size[2]! / 2;
    const bell = clipFrame(clip, 0.45).moving.find((item) => item.kind === 'dumbbell')!;
    assert.ok(bell.p[2] < benchEnd || bell.p[1] - 0.11 > bench.p[1] + bench.size[1]! / 2, '덤벨이 벤치에 묻힌다');
  });
});

describe('TRX · 랜드마인 · 스미스 기구', () => {
  it('TRX가 기구 목록에 있고, TRX 하나로 당기기 · 밀기가 열린다', () => {
    const item = EQUIPMENT_CATALOG.find((one) => one.id === 'suspension-trainer');
    assert.ok(item);
    assert.ok(equipmentGuide('suspension-trainer')!.aka.includes('TRX'));
    assert.deepEqual(exercisesUsing('suspension-trainer').sort(), ['trx-chest-press', 'trx-row']);
    assert.ok(findEquipment('TRX').some((one) => one.id === 'suspension-trainer'));
    assert.ok(findEquipment('서스펜션').some((one) => one.id === 'suspension-trainer'));
  });

  it('랜드마인만 있어도 T바 로우를 한다 — 국내 헬스장의 T바 로우는 대부분 랜드마인에 꽂아서 한다', () => {
    assert.ok(requirementsMet('t-bar-row', new Set(['landmine'])));
    assert.ok(requirementsMet('t-bar-row', new Set(['t-bar-row-machine'])));
    assert.ok(!requirementsMet('t-bar-row', new Set(['barbell-set'])));
  });

  it('스미스로 하는 종목은 전부 스미스 바 무게로 계산하고, 벤치가 없으면 벤치 종목은 열리지 않는다', () => {
    const gym = gymFromCatalog({ equipmentIds: ['smith-machine', 'bench-flat'], measurements: { 'smith-machine': { barKg: 7 } } });
    for (const id of ['smith-hip-thrust', 'smith-split-squat', 'smith-squat', 'smith-bench-press']) {
      const spec = gym.overrides[id];
      assert.ok(spec && spec !== 'unavailable' && spec.kind === 'barbell' && spec.barKg === 7, `${id}: ${JSON.stringify(spec)}`);
    }
    const noBench = gymFromCatalog({ equipmentIds: ['smith-machine'] });
    assert.equal(noBench.overrides['smith-hip-thrust'], 'unavailable', '벤치 없이는 힙 쓰러스트가 안 된다');
    assert.equal(noBench.overrides['smith-bench-press'], 'unavailable', '벤치 없이는 스미스 벤치프레스가 안 된다');
    assert.notEqual(noBench.overrides['smith-split-squat'], 'unavailable');
  });

  it('붙여넣은 목록에서 흔히 쓰는 말을 알아본다', () => {
    const cases: [string, string][] = [
      ['TRX', 'suspension-trainer'], ['서스펜션', 'suspension-trainer'],
      ['어썰트바이크', 'stationary-bike'], ['에어바이크', 'stationary-bike'],
      ['스텝퍼', 'stair-climber'], ['사이드 레터럴 머신', 'lateral-raise-machine'],
      ['로우 로우', 'chest-supported-row-machine'], ['멀티힙', 'glute-kickback-machine'],
    ];
    for (const [text, id] of cases) assert.deepEqual(parseEquipmentList(text).ids, [id], text);
    // 어시스트 머신 한 대를 적은 것 — 딥스 바(평행봉)까지 켜지 않는다
    assert.deepEqual(parseEquipmentList('어시스트 풀업 딥스').ids, ['assisted-pull-up-machine']);
  });
});

describe('PT 스튜디오 유형', () => {
  it('스미스 · 케이블 · 덤벨 · TRX 위주이고 부위별 전용 머신은 없다', () => {
    const ids = presetEquipment('pt-studio');
    for (const need of ['smith-machine', 'cable-station', 'dumbbells', 'bench-incline', 'suspension-trainer']) assert.ok(ids.includes(need), need);
    for (const rare of ['hack-squat-machine', 'pec-deck-machine', 'hip-abduction-machine']) assert.ok(!ids.includes(rare), rare);
    assert.ok(availableExercises(ids).length >= 60, `${availableExercises(ids).length}개`);
    assert.equal(GYM_PRESETS.find((preset) => preset.id === 'pt-studio')!.visibility, 'public');
  });
});

describe('기구 고르는 화면의 묶음 · 한 줄 설명', () => {
  it('모든 기구에 무엇을 하는 기구인지 한 줄이 있고, 칸에 들어갈 만큼 짧다', () => {
    for (const item of EQUIPMENT_CATALOG) {
      const short = EQUIPMENT_SHORT[item.id];
      assert.ok(short, `${item.id}: 한 줄이 없다`);
      assert.ok(short.length <= 18, `${item.id}: "${short}" (${short.length}자)`);
      // 쉬운 말 — 전문 용어를 쓰지 않는다
      assert.ok(!/삼각근|광배|대퇴|둔근|햄스트링|이두|삼두|고립|복합/.test(short), `${item.id}: ${short}`);
    }
    assert.deepEqual(Object.keys(EQUIPMENT_SHORT).filter((id) => !EQUIPMENT_CATALOG.some((item) => item.id === id)), []);
  });

  it('부위로 찾아진다 — "종아리" · "가슴"', () => {
    assert.ok(findEquipment('종아리').some((item) => item.id === 'calf-raise-machine'));
    assert.ok(findEquipment('가슴').some((item) => item.id === 'chest-press-machine'));
  });

  it('기계는 하체 · 상체로 갈린다', () => {
    for (const id of ['leg-press-machine', 'hack-squat-machine', 'leg-extension-machine', 'leg-curl-machine', 'hip-abduction-machine',
      'hip-thrust-machine', 'calf-raise-machine', 'pendulum-squat-machine', 'glute-kickback-machine']) {
      assert.equal(machineArea(id), 'lower', id);
    }
    for (const id of ['chest-press-machine', 'pec-deck-machine', 'shoulder-press-machine', 'rear-delt-machine', 't-bar-row-machine',
      'assisted-pull-up-machine', 'ab-crunch-machine', 'preacher-curl-machine']) {
      assert.equal(machineArea(id), 'upper', id);
    }
  });

  it('모든 기구가 묶음 하나에 들어가고, 빈 묶음이 없다', () => {
    const keys = new Set(EQUIPMENT_GROUPS.map((group) => group.key));
    const used = new Set<string>();
    for (const item of EQUIPMENT_CATALOG) {
      const key = equipmentGroupOf(item);
      assert.ok(keys.has(key), `${item.id}: ${key}`);
      used.add(key);
    }
    assert.deepEqual([...keys].filter((key) => !used.has(key)), []);
    // 유산소는 따로, 맨몸 · 소도구는 맨 뒤
    assert.equal(equipmentGroupOf(EQUIPMENT_CATALOG.find((item) => item.id === 'treadmill')!), 'cardio');
    assert.equal(EQUIPMENT_GROUPS[EQUIPMENT_GROUPS.length - 1]!.key, 'etc');
  });
});
