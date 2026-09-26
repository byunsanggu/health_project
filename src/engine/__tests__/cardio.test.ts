import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  CARDIO,
  ZONES,
  cardioById,
  cardioZoneOf,
  describeCardio,
  interference,
  rankForToday,
  weeklyLoad,
} from '../cardio.ts';
import type { CardioExercise, CardioLog } from '../cardio.ts';

const by = (id: string) => cardioById(id) as CardioExercise;
const LEG_DAY = ['quads', 'hamstrings', 'glutes'] as const;
const PUSH_DAY = ['chest', 'triceps', 'frontDelt'] as const;

describe('유산소 종목', () => {
  it('다리에 실리는 정도가 종목마다 다르다', () => {
    /*
     * 자전거와 달리기는 둘 다 "유산소"지만 하체 근력에 주는 방해가
     * 완전히 다르다. 이 숫자가 이 모듈의 핵심이다.
     */
    assert.ok(by('bike').legLoad < by('treadmill-run').legLoad);
    assert.ok(by('treadmill-run').legLoad < by('outdoor-run').legLoad);
  });

  it('모든 종목이 쓸 수 있는 값을 갖는다', () => {
    for (const exercise of CARDIO) {
      assert.ok(exercise.legLoad >= 0 && exercise.legLoad <= 1, exercise.name);
      assert.ok(exercise.muscles.length > 0, exercise.name);
      assert.ok(exercise.note.length > 0, exercise.name);
    }
  });
});

describe('강도', () => {
  it('심박수가 아니라 말할 수 있는 정도로 준다', () => {
    /*
     * 대부분은 심박계가 없고, 있어도 자기 최대심박을 모른다.
     * "최대심박의 65%"는 숫자처럼 보이지만 아무것도 지시하지 않는다.
     */
    for (const zone of ZONES) {
      assert.ok(zone.talk.length > 0, zone.id);
    }
    assert.match(cardioZoneOf('steady').talk, /대화/);
  });

  it('심박계가 있는 사람을 위한 참고값도 준다', () => {
    const zone = cardioZoneOf('hard');
    assert.ok(zone.hrPercent[0] < zone.hrPercent[1]);
    assert.ok(zone.hrPercent[0] > cardioZoneOf('steady').hrPercent[0]);
  });
});

describe('간섭 효과', () => {
  it('근력 전에 무거운 유산소를 하면 막는다', () => {
    // 적응 이전에 그날 운동을 못 하게 되는 문제다.
    const result = interference({
      exercise: by('treadmill-run'),
      zone: 'steady',
      minutes: 20,
      todayMuscles: [...PUSH_DAY],
      before: true,
    });
    assert.equal(result.level, 'avoid');
    assert.match(result.fix ?? '', /근력을 먼저/);
  });

  it('근력 전이라도 아주 쉽게면 막지 않는다', () => {
    // 가볍게 데우는 것까지 막으면 워밍업도 못 한다.
    const result = interference({
      exercise: by('treadmill-run'),
      zone: 'easy',
      minutes: 10,
      todayMuscles: [...PUSH_DAY],
      before: true,
    });
    assert.notEqual(result.level, 'avoid');
  });

  it('다리 한 날의 긴 달리기를 막는다', () => {
    const result = interference({
      exercise: by('outdoor-run'),
      zone: 'hard',
      minutes: 40,
      todayMuscles: [...LEG_DAY],
      before: false,
    });
    assert.equal(result.level, 'avoid');
    assert.match(result.fix ?? '', /자전거|걷기/);
  });

  it('다리 한 날의 자전거는 괜찮다고 말한다', () => {
    /*
     * "유산소 하면 근육 안 큰다"는 과장이다. 앉아서 돌리는 자전거는
     * 하체 근비대를 거의 안 건드린다.
     */
    const result = interference({
      exercise: by('bike'),
      zone: 'steady',
      minutes: 25,
      todayMuscles: [...LEG_DAY],
      before: false,
    });
    assert.equal(result.level, 'none');
  });

  it('겹치는 부위를 또 쓰면 회복이 늦는다고 말한다', () => {
    const result = interference({
      exercise: by('row'),
      zone: 'steady',
      minutes: 25,
      todayMuscles: [...LEG_DAY],
      before: false,
    });
    assert.equal(result.level, 'notable');
    assert.ok(result.fix);
  });

  it('가슴 한 날의 달리기는 막지 않는다', () => {
    const result = interference({
      exercise: by('treadmill-run'),
      zone: 'steady',
      minutes: 25,
      todayMuscles: [...PUSH_DAY],
      before: false,
    });
    assert.ok(result.level === 'none' || result.level === 'mild');
  });

  it('세게 오래 하면 전신 회복을 나눠 쓴다고 말한다', () => {
    const result = interference({
      exercise: by('bike'),
      zone: 'interval',
      minutes: 40,
      todayMuscles: [...PUSH_DAY],
      before: false,
    });
    assert.equal(result.level, 'mild');
  });

  it('막을 때는 어떻게 하라는 말이 늘 붙는다', () => {
    // 막기만 하고 대안이 없으면 사용자는 앱을 무시하고 그냥 한다.
    for (const exercise of CARDIO) {
      const result = interference({
        exercise,
        zone: 'hard',
        minutes: 40,
        todayMuscles: [...LEG_DAY],
        before: false,
      });
      if (result.level === 'avoid' || result.level === 'notable') {
        assert.ok(result.fix, exercise.name);
      }
    }
  });
});

describe('오늘 하기 좋은 순서', () => {
  it('겹치는 것을 뒤로 민다', () => {
    const ranked = rankForToday([...LEG_DAY]);
    const first = ranked[0] as CardioExercise;
    const last = ranked[ranked.length - 1] as CardioExercise;
    assert.ok(first.legLoad < last.legLoad);
    assert.equal(last.id, 'outdoor-run');
  });

  it('수영장이 필요한 것은 앞에 두지 않는다', () => {
    // 헬스장 대부분에 수영장이 없는데 맨 위에 띄우면 목록이 쓸모없어진다.
    const ranked = rankForToday([...LEG_DAY]);
    assert.notEqual(ranked[0]?.id, 'swim');
  });

  it('기구가 없으면 기구 없는 것만 준다', () => {
    const ranked = rankForToday([...PUSH_DAY], { needsMachine: false });
    assert.ok(ranked.every((exercise) => !exercise.needsMachine));
    assert.ok(ranked.length > 0);
  });
});

describe('기록', () => {
  it('칼로리를 쓰지 않는다', () => {
    /*
     * 기구가 보여주는 칼로리는 체중·체성분·효율을 모르고 낸 값이라
     * 실제와 20~30%씩 어긋난다. 그 숫자로 먹는 양을 정하면 해가 된다.
     */
    const line = describeCardio({ exerciseId: 'row', minutes: 20, zone: 'steady', distanceKm: 4.2 });
    assert.doesNotMatch(line, /칼로리|kcal/i);
    assert.match(line, /20분/);
    assert.match(line, /4\.2km/);
  });

  it('있는 것만 쓴다', () => {
    const line = describeCardio({ exerciseId: 'bike', minutes: 30, zone: 'easy' });
    assert.doesNotMatch(line, /km|bpm/);
  });
});

describe('주간 부담', () => {
  const log = (exerciseId: string, minutes: number, zone: string): CardioLog =>
    ({ exerciseId, minutes, zone }) as CardioLog;

  it('분을 그냥 더하지 않는다', () => {
    // 대화되는 정도 40분과 인터벌 10분은 몸에 남기는 것이 다르다.
    const easy = weeklyLoad([log('bike', 40, 'steady')]);
    const hard = weeklyLoad([log('bike', 40, 'interval')]);
    assert.equal(easy.minutes, hard.minutes);
    assert.ok(hard.weighted > easy.weighted);
  });

  it('다리에 실리는 것일수록 더 무겁게 센다', () => {
    const bike = weeklyLoad([log('bike', 30, 'steady')]);
    const run = weeklyLoad([log('outdoor-run', 30, 'steady')]);
    assert.ok(run.weighted > bike.weighted);
  });

  it('가벼운 주에는 걱정시키지 않는다', () => {
    const light = weeklyLoad([log('bike', 25, 'steady'), log('bike', 25, 'steady')]);
    assert.match(light.text, /영향 없는/);
  });

  it('많은 주에는 줄이라고 말한다', () => {
    const heavy = weeklyLoad([
      log('outdoor-run', 45, 'hard'),
      log('outdoor-run', 45, 'hard'),
      log('treadmill-run', 30, 'interval'),
    ]);
    assert.match(heavy.text, /줄이/);
  });

  it('안 한 주는 안 했다고만 쓴다', () => {
    assert.match(weeklyLoad([]).text, /없음/);
  });
});
