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
    const available = availableExercises(COMMON_EQUIPMENT_IDS);
    assert.ok(available.length >= EXERCISES.length * 0.8);
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
