import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  COMMON_EQUIPMENT_IDS,
  EQUIPMENT_CATALOG,
  EXERCISE_REQUIREMENTS,
  availableExercises,
  coverageReport,
  gymFromCatalog,
  suggestNextEquipment,
  wouldEnable,
  matchEquipmentName,
  normalizeEquipmentName,
  parseEquipmentList,
  EQUIPMENT_GUIDE,
} from '../equipment.ts';
import { EXERCISES, exerciseById } from '../exercises.ts';
import { loadableWeights, loadingFor, nearestLoadable } from '../gym.ts';
import type { Exercise } from '../types.ts';

const MINIMAL = ['floor', 'barbell-set', 'power-rack', 'bench-flat'];

describe('카탈로그', () => {
  it('모든 종목에 필요 기구가 정의되어 있다', () => {
    for (const exercise of EXERCISES) {
      assert.ok(EXERCISE_REQUIREMENTS[exercise.id], `${exercise.name}(${exercise.id})`);
    }
  });

  it('필요 기구는 전부 카탈로그에 있는 것이어야 한다', () => {
    const ids = new Set(EQUIPMENT_CATALOG.map((item) => item.id));
    for (const [exerciseId, required] of Object.entries(EXERCISE_REQUIREMENTS)) {
      for (const id of required) assert.ok(ids.has(id), `${exerciseId} → ${id}`);
    }
  });

  it('기본 선택만으로도 대부분의 종목이 열린다', () => {
    /*
     * 비율로 보지 않는다. 펜듈럼·벨트 스쿼트 같은 특수 머신을 카탈로그에
     * 더할수록 분모만 커져서, 기본 기구로 할 수 있는 건 그대로인데 비율이
     * 떨어진다. 기본 종목 수가 줄지 않았는지를 본다.
     */
    const available = availableExercises(COMMON_EQUIPMENT_IDS);
    assert.ok(available.length >= 67, `기본 기구로 ${available.length}종목`);
    assert.ok(available.length >= EXERCISES.length * 0.65);
  });
});

describe('기구를 추가하면 종목이 열린다', () => {
  it('아무것도 없으면 아무것도 못 한다', () => {
    assert.equal(availableExercises([]).length, 0);
  });

  it('벤치프레스는 바벨만으로는 안 되고 벤치가 있어야 한다', () => {
    const withoutBench = availableExercises(['barbell-set', 'power-rack']).map((e) => e.id);
    assert.ok(!withoutBench.includes('barbell-bench-press'));

    const withBench = availableExercises(['barbell-set', 'power-rack', 'bench-flat']).map((e) => e.id);
    assert.ok(withBench.includes('barbell-bench-press'));
  });

  it('추가하면 열리는 종목을 미리 알려준다', () => {
    const unlocked = wouldEnable('cable-station', MINIMAL);
    assert.ok(unlocked.length >= 4);
    assert.ok(unlocked.some((e) => e.id === 'triceps-pushdown'));
  });

  it('이미 가진 기구는 아무것도 열지 않는다', () => {
    assert.deepEqual(wouldEnable('barbell-set', MINIMAL), []);
  });

  it('많이 열리는 기구부터 추천한다', () => {
    const suggestions = suggestNextEquipment(MINIMAL);
    assert.ok(suggestions.length > 0);
    for (let i = 1; i < suggestions.length; i += 1) {
      assert.ok(suggestions[i - 1]!.unlocks.length >= suggestions[i]!.unlocks.length);
    }
  });
});

describe('coverageReport', () => {
  it('종목이 부족한 부위와 해결할 기구를 짚어준다', () => {
    const gaps = coverageReport(MINIMAL).filter((item) => !item.sufficient);
    assert.ok(gaps.some((gap) => gap.muscle === 'triceps'));
    assert.ok(gaps.every((gap) => gap.suggestion || gap.possibleOptions === 0));
  });

  it('운동 DB에 선택지가 하나뿐인 부위는 그 하나로 충분하다고 본다', () => {
    // 승모근 종목을 하나만 남긴 풀에서는 그 하나를 갖추면 구멍이 아니다.
    const pool = EXERCISES.filter((e) => e.id !== 'dumbbell-shrug');
    const traps = coverageReport(EQUIPMENT_CATALOG.map((item) => item.id), pool)
      .find((item) => item.muscle === 'traps')!;

    assert.equal(traps.possibleOptions, 1);
    assert.equal(traps.directOptions, 1);
    assert.equal(traps.sufficient, true, '사용자가 더 할 수 있는 게 없으면 구멍이 아니다');
  });

  it('DB 확장으로 승모근 구멍이 메워졌다', () => {
    const traps = coverageReport(COMMON_EQUIPMENT_IDS).find((item) => item.muscle === 'traps')!;
    assert.ok(traps.directOptions >= 2, '슈러그 계열이 들어왔다');
  });

  it('기본 구성이면 남는 구멍이 거의 없다', () => {
    const gaps = coverageReport(COMMON_EQUIPMENT_IDS).filter((item) => !item.sufficient);
    assert.equal(gaps.length, 0, gaps.map((g) => g.label).join(', '));
  });
});

describe('gymFromCatalog', () => {
  it('고르지 않은 기구가 필요한 종목은 막는다', () => {
    const gym = gymFromCatalog({ equipmentIds: MINIMAL });
    assert.equal(gym.overrides?.['triceps-pushdown'], 'unavailable');
    assert.notEqual(gym.overrides?.['back-squat'], 'unavailable');
  });

  it('실측한 바 무게를 반영한다', () => {
    const gym = gymFromCatalog({
      equipmentIds: MINIMAL,
      measurements: { 'barbell-set': { barKg: 15 } },
    });
    const spec = loadingFor(exerciseById('barbell-bench-press') as Exercise, gym)!;
    assert.equal(loadableWeights(spec)[0], 15, '빈 바가 15kg');
  });

  it('실측한 스택 간격을 반영한다', () => {
    const gym = gymFromCatalog({
      equipmentIds: [...MINIMAL, 'cable-station'],
      measurements: { 'cable-station': { stepKg: 2.5 } },
    });
    const spec = loadingFor(exerciseById('triceps-pushdown') as Exercise, gym)!;
    assert.equal(nearestLoadable(36, spec), 35, '2.5kg 간격이면 35kg로 맞춘다');
  });

  it('레그프레스 캐리지 무게를 반영한다', () => {
    const gym = gymFromCatalog({
      equipmentIds: [...MINIMAL, 'leg-press-machine'],
      measurements: { 'leg-press-machine': { carriageKg: 40 } },
    });
    const spec = loadingFor(exerciseById('leg-press') as Exercise, gym)!;
    assert.equal(loadableWeights(spec)[0], 40);
  });

  it('덤벨 최대 무게에 맞춰 보유 덤벨을 만든다', () => {
    const gym = gymFromCatalog({
      equipmentIds: [...MINIMAL, 'dumbbells'],
      measurements: { dumbbells: { maxDumbbellKg: 30 } },
    });
    const weights = loadableWeights(gym.defaults.dumbbell);
    assert.equal(weights[weights.length - 1], 30);
    assert.ok(!weights.includes(35));
  });
});

describe('목록 붙여넣기', () => {
  /** 실제 헬스장(바우짐) 트레이너가 카톡처럼 적어 보낸 목록 그대로. 오타·띄어쓰기·빠진 쉼표 포함. */
  const REAL_LIST =
    '덤벨  ,바벨, 이지바, 스쿼트랙, 인클라인 벤치 프리처 컬 벤치 , 파워랙, 크로스오버 케이븍, 로우 케이블 ,' +
    '스미스 머신, 플레이트 로드 T바 머신, 플레이트 로드 벤트 오버 레터럴 레이즈 머신, 플레이트 로드 하이 로우 머신 ,' +
    '레그 프레스, 플레이트 로드 핵 스쿼트 머신, 브이 스쿼트 머신, 어시스트 머신 ,시티드 로우 머신, 플라이 머신, ' +
    '체스트프레스 머신, 인크라인 체스트 프레스 머신, 숄더프레스 머신, 라잉 레크컬 머신, 레그 익스텐션 머신, ' +
    '카프레이즈 머신, 트라이셉 딥스 머신 ,프리쳐 컬 머신, 시트드 레그 컬 머신, 폼롤러';

  it('실제 목록을 하나도 놓치지 않는다', () => {
    const result = parseEquipmentList(REAL_LIST);
    assert.deepEqual(result.unknown, []);
    const expected = [
      'dumbbells', 'barbell-set', 'ez-bar', 'power-rack', 'bench-incline', 'preacher-bench',
      'cable-station', 'seated-row-machine', 'smith-machine', 't-bar-row-machine', 'rear-delt-machine',
      'high-row-machine', 'leg-press-machine', 'hack-squat-machine', 'v-squat-machine',
      'assisted-pull-up-machine', 'chest-supported-row-machine', 'pec-deck-machine',
      'chest-press-machine', 'incline-chest-press-machine', 'shoulder-press-machine', 'leg-curl-machine',
      'leg-extension-machine', 'calf-raise-machine', 'dip-machine', 'preacher-curl-machine', 'foam-roller',
    ];
    assert.deepEqual([...result.ids].sort(), [...expected].sort());
  });

  it('쉼표를 빼먹은 줄에서 둘을 다 찾는다', () => {
    assert.deepEqual(parseEquipmentList('인클라인 벤치 프리처 컬 벤치').ids, ['bench-incline', 'preacher-bench']);
  });

  it('긴 이름이 이긴다 — 인클라인 체스트프레스는 체스트프레스가 아니다', () => {
    assert.equal(matchEquipmentName('인클라인 체스트프레스 머신')?.id, 'incline-chest-press-machine');
    assert.equal(matchEquipmentName('체스트프레스 머신')?.id, 'chest-press-machine');
    assert.equal(matchEquipmentName('벤트오버 레터럴 레이즈 머신')?.id, 'rear-delt-machine');
    assert.equal(matchEquipmentName('레터럴 레이즈 머신')?.id, 'lateral-raise-machine');
  });

  it('케이블 로우와 시티드 로우 머신을 가린다', () => {
    assert.equal(matchEquipmentName('로우 케이블')?.id, 'seated-row-machine');
    assert.equal(matchEquipmentName('시티드 로우 머신')?.id, 'chest-supported-row-machine');
  });

  it('"플레이트 로드"는 거는 방식이라 떼고 읽는다', () => {
    assert.equal(matchEquipmentName('플레이트 로드 핵 스쿼트 머신')?.id, 'hack-squat-machine');
    assert.notEqual(matchEquipmentName('플레이트 로드 핵 스쿼트 머신')?.id, 'barbell-set');
  });

  it('자주 틀리는 철자를 받아 준다', () => {
    assert.equal(matchEquipmentName('인크라인 벤치')?.id, 'bench-incline');
    assert.equal(matchEquipmentName('라잉 레크컬')?.id, 'leg-curl-machine');
    assert.equal(matchEquipmentName('프리쳐 컬 머신')?.id, 'preacher-curl-machine');
  });

  it('모르는 것은 모른다고 돌려준다 — 엉뚱한 기구를 조용히 켜지 않는다', () => {
    const result = parseEquipmentList('덤벨, 사우나, 수건');
    assert.deepEqual(result.ids, ['dumbbells']);
    assert.deepEqual(result.unknown, ['사우나', '수건']);
  });

  it('한 이름이 두 기구에 걸리지 않는다 — 걸리면 붙여넣기가 엉뚱한 쪽을 켠다', () => {
    const owner = new Map<string, string>();
    for (const item of EQUIPMENT_CATALOG) {
      for (const name of [item.name, ...(EQUIPMENT_GUIDE[item.id]?.aka ?? [])]) {
        const key = normalizeEquipmentName(name);
        const before = owner.get(key);
        assert.ok(!before || before === item.id, `"${name}" → ${before} / ${item.id}`);
        owner.set(key, item.id);
      }
    }
  });

  it('줄바꿈으로 적어도 된다', () => {
    assert.deepEqual(parseEquipmentList('덤벨\n바벨\n폼롤러').ids, ['dumbbells', 'barbell-set', 'foam-roller']);
  });

  it('새로 넣은 기구마다 열리는 종목이 있다 — 폼롤러만 빼고', () => {
    for (const id of ['incline-chest-press-machine', 'high-row-machine', 'rear-delt-machine',
      'v-squat-machine', 'dip-machine', 'preacher-curl-machine']) {
      assert.ok(wouldEnable(id, ['floor']).length > 0, id);
    }
  });

  it('브이 스쿼트는 원판을 끼우는 기계로 계산한다', () => {
    const gym = gymFromCatalog({ equipmentIds: ['v-squat-machine'] });
    assert.equal((gym.overrides?.['v-squat'] as { kind: string }).kind, 'plateLoaded');
  });
});
