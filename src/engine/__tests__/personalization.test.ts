import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { landmarksFor } from '../muscles.ts';
import { personalizeLandmarks, weeklyPerformance } from '../personalization.ts';
import { addDays } from '../volume.ts';
import type { SessionLog } from '../types.ts';
import { index, sets } from './helpers.ts';

const MONDAY = '2026-01-05';

/**
 * 주 단위 이력을 만든다.
 * chestSets는 그 주 가슴 볼륨, topWeight는 그 주 벤치 최고 중량(수행력)이다.
 *
 * 한 세션에 몰아넣지 않고 주 3회로 쪼갠다 — 집계가 세션당 상한을 두기 때문에
 * 하루에 다 넣으면 실제 볼륨이 절반으로 깎여 들어간다.
 */
function history(weeks: { chestSets: number; topWeight: number }[]): SessionLog[] {
  const out: SessionLog[] = [];
  for (const [i, week] of weeks.entries()) {
    for (let day = 0; day < 3; day += 1) {
      const share = Math.floor(week.chestSets / 3) + (day < week.chestSets % 3 ? 1 : 0);
      out.push({
        date: addDays(MONDAY, i * 7 + day * 2),
        sets: [
          ...sets('barbell-bench-press', share, { weightKg: week.topWeight, reps: 8, rir: 1 }),
          ...sets('barbell-row', 2, { weightKg: 70, reps: 10, rir: 2 }),
        ],
      });
    }
  }
  return out;
}

describe('weeklyPerformance', () => {
  it('첫 주는 비교 대상이 없어 변화율이 없다', () => {
    const weeks = weeklyPerformance(history([
      { chestSets: 10, topWeight: 80 },
      { chestSets: 10, topWeight: 82 },
    ]));
    assert.equal(weeks[0]!.change, null);
    assert.ok(weeks[1]!.change! > 0);
  });

  it('중량이 떨어지면 변화율이 음수다', () => {
    const weeks = weeklyPerformance(history([
      { chestSets: 10, topWeight: 100 },
      { chestSets: 10, topWeight: 90 },
    ]));
    assert.ok(weeks[1]!.change! < -0.05);
  });
});

describe('personalizeLandmarks', () => {
  it('8주가 안 되면 기준값을 그대로 쓴다', () => {
    const result = personalizeLandmarks({
      history: history(Array.from({ length: 5 }, () => ({ chestSets: 12, topWeight: 80 }))),
      index,
      level: 'intermediate',
    });
    assert.equal(result.applied, false);
    assert.deepEqual(result.landmarks, landmarksFor('intermediate'));
    assert.match(result.note, /8주/);
  });

  /** 기준 MRV보다 낮은 볼륨에서 매번 회복에 실패하는 사람 */
  const failsBelowMrv = Array.from({ length: 12 }, (_, i) => ({
    chestSets: 15,
    topWeight: i % 2 === 0 ? 100 : 90,
  }));

  it('회복에 반복 실패한 볼륨은 MRV를 끌어내린다', () => {
    const base = landmarksFor('intermediate');
    const result = personalizeLandmarks({ history: history(failsBelowMrv), index, level: 'intermediate' });

    assert.ok(result.applied, '관측이 있는데 아무것도 적용되지 않았다');
    assert.ok(
      result.landmarks.chest.mrv < base.chest.mrv,
      `가슴 MRV가 내려가지 않았다: ${result.landmarks.chest.mrv}`,
    );
  });

  it('이미 아는 것을 다시 말하는 관측으로는 움직이지 않는다', () => {
    // MRV가 22인데 26세트에서 무너졌다 — "22보다 낮다"는 정보가 아니다
    const base = landmarksFor('intermediate');
    const weeks = Array.from({ length: 12 }, (_, i) => ({
      chestSets: 26,
      topWeight: i % 2 === 0 ? 100 : 90,
    }));
    const result = personalizeLandmarks({ history: history(weeks), index, level: 'intermediate' });
    assert.deepEqual(result.landmarks.chest, base.chest);
  });

  it('관측이 없는 부위는 건드리지 않는다', () => {
    const base = landmarksFor('intermediate');
    const result = personalizeLandmarks({ history: history(failsBelowMrv), index, level: 'intermediate' });

    // 가슴이 무너진 책임을 종아리나 햄스트링에 물으면 안 된다
    assert.deepEqual(result.landmarks.calves, base.calves);
    assert.deepEqual(result.landmarks.hamstrings, base.hamstrings);
  });

  it('성장한 주의 볼륨으로 MEV를 올리지는 않는다 — 관측은 상한일 뿐이다', () => {
    const base = landmarksFor('intermediate');
    // 기준 MEV보다 훨씬 많이 하면서 계속 성장하는 사람
    const weeks = Array.from({ length: 12 }, (_, i) => ({ chestSets: 16, topWeight: 80 + i }));
    const result = personalizeLandmarks({ history: history(weeks), index, level: 'intermediate' });

    assert.ok(
      result.landmarks.chest.mev <= base.chest.mev,
      `성장 관측으로 MEV가 올라갔다: ${base.chest.mev} → ${result.landmarks.chest.mev}`,
    );
  });

  it('기준 MRV를 넘겨서도 계속 회복하면 MRV가 올라간다', () => {
    const base = landmarksFor('intermediate');
    const high = base.chest.mrv + 6;
    const weeks = Array.from({ length: 12 }, (_, i) => ({ chestSets: high, topWeight: 80 + i }));
    const result = personalizeLandmarks({ history: history(weeks), index, level: 'intermediate' });

    assert.ok(
      result.landmarks.chest.mrv > base.chest.mrv,
      `회복했는데 MRV가 그대로다: ${result.landmarks.chest.mrv}`,
    );
  });

  it('숫자가 실제로 바뀐 부위만 옮겼다고 센다', () => {
    const base = landmarksFor('intermediate');
    const result = personalizeLandmarks({ history: history(failsBelowMrv), index, level: 'intermediate' });

    for (const observation of result.observations) {
      const before = base[observation.muscle];
      const after = result.landmarks[observation.muscle];
      const changed = before.mev !== after.mev || before.mrv !== after.mrv;
      assert.equal(observation.moved, changed, `${observation.label}: moved 표시가 실제와 다르다`);
    }
  });

  it('한 번의 관측으로 통째로 갈아엎지 않는다', () => {
    const base = landmarksFor('intermediate');
    const result = personalizeLandmarks({ history: history(failsBelowMrv), index, level: 'intermediate' });

    // 관측값(15)까지 그대로 내려가버리면 보정이 아니라 대체다
    assert.ok(
      result.landmarks.chest.mrv > 15,
      `관측값까지 통째로 내려갔다: ${base.chest.mrv} → ${result.landmarks.chest.mrv}`,
    );
  });
});
