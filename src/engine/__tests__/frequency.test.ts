import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { actionableFrequency, frequencyReport, recommendedSessions } from '../frequency.ts';
import { aggregateVolume, addDays } from '../volume.ts';
import { index, session, sets } from './helpers.ts';
import type { SessionLog } from '../types.ts';

const MONDAY = '2026-09-14';

/** 펙덱(가슴 전용)을 지정한 날짜들에 나눠 수행한 주. */
function chestSplit(perDay: readonly { offset: number; sets: number }[]): SessionLog[] {
  return perDay.map((day) =>
    session(addDays(MONDAY, day.offset), sets('pec-deck', day.sets, { weightKg: 40, reps: 10, rir: 2 })),
  );
}

function chestOf(logs: SessionLog[]) {
  return frequencyReport(logs, index).find((item) => item.muscle === 'chest')!;
}

describe('세션 내 수확 체감', () => {
  it('같은 볼륨이라도 한 세션에 몰면 덜 인정된다', () => {
    var massed = aggregateVolume(chestSplit([{ offset: 0, sets: 16 }]), index).chest;
    var split = aggregateVolume(chestSplit([{ offset: 0, sets: 8 }, { offset: 3, sets: 8 }]), index).chest;

    assert.equal(massed.rawSets, 16);
    assert.equal(split.rawSets, 16, '원 세트 수는 같다');
    assert.ok(massed.effectiveSets < split.effectiveSets, '몰아서 한 쪽이 손해다');
    assert.equal(split.effectiveSets, 16, '나눠서 하면 전부 인정된다');
    assert.equal(split.discountedSets, 0);
  });

  it('상한까지는 온전히 세고, 넘은 만큼만 절반으로 센다', () => {
    var detail = aggregateVolume(chestSplit([{ offset: 0, sets: 13 }]), index).chest;
    assert.equal(detail.effectiveSets, 11, '9세트 + 초과 4세트의 절반');
    assert.equal(detail.discountedSets, 2);
  });

  it('세션 수와 세션당 최대 세트를 기록한다', () => {
    var detail = aggregateVolume(
      chestSplit([{ offset: 0, sets: 6 }, { offset: 2, sets: 10 }, { offset: 4, sets: 4 }]),
      index,
    ).chest;
    assert.equal(detail.sessionCount, 3);
    assert.equal(detail.maxSetsInOneSession, 10);
  });

  it('상한은 부위별로 따로 적용된다', () => {
    var log = session('2026-09-14',
      sets('pec-deck', 9, { weightKg: 40, reps: 10, rir: 2 }),
      sets('lying-leg-curl', 9, { weightKg: 40, reps: 10, rir: 2 }),
    );
    var totals = aggregateVolume([log], index);
    assert.equal(totals.chest.discountedSets, 0);
    assert.equal(totals.hamstrings.discountedSets, 0);
  });
});

describe('recommendedSessions', () => {
  it('볼륨이 적으면 한 번으로 충분하다', () => {
    assert.equal(recommendedSessions(0), 0);
    assert.equal(recommendedSessions(3), 1);
  });

  it('근비대 볼륨이면 최소 주 2회로 나눈다', () => {
    assert.equal(recommendedSessions(6), 2);
    assert.equal(recommendedSessions(16), 2);
  });

  it('세션당 상한을 넘기는 볼륨이면 횟수를 늘린다', () => {
    assert.equal(recommendedSessions(20), 3);
    assert.equal(recommendedSessions(30), 4);
  });
});

describe('frequencyReport', () => {
  it('몰아서 한 부위를 집어내고 나눌 횟수를 알려준다', () => {
    var chest = chestOf(chestSplit([{ offset: 0, sets: 16 }]));
    assert.equal(chest.verdict, 'concentrated');
    assert.equal(chest.recommendedSessions, 2);
    assert.match(chest.advice, /주 2회로 나누면/);
  });

  it('볼륨은 맞지만 횟수가 모자라면 분산을 권한다', () => {
    var chest = chestOf(chestSplit([{ offset: 0, sets: 8 }]));
    assert.equal(chest.discountedSets, 0, '버려진 세트는 없다');
    assert.equal(chest.verdict, 'insufficient');
    assert.equal(chest.recommendedSessions, 2);
  });

  it('적절히 나눈 부위는 지적하지 않는다', () => {
    var chest = chestOf(chestSplit([{ offset: 0, sets: 8 }, { offset: 3, sets: 8 }]));
    assert.equal(chest.verdict, 'ok');
  });

  it('보조 부위의 소량 볼륨에는 분산을 요구하지 않는다', () => {
    var chest = chestOf(chestSplit([{ offset: 0, sets: 3 }]));
    assert.equal(chest.recommendedSessions, 1);
    assert.equal(chest.verdict, 'ok');
  });

  it('훈련하지 않은 부위는 idle로 따로 둔다', () => {
    var report = frequencyReport(chestSplit([{ offset: 0, sets: 8 }]), index);
    assert.equal(report.find((item) => item.muscle === 'quads')!.verdict, 'idle');
    assert.ok(!actionableFrequency(report).some((item) => item.muscle === 'quads'));
  });

  it('조치가 필요한 항목은 몰림부터 보여준다', () => {
    var logs = [
      ...chestSplit([{ offset: 0, sets: 16 }]),
      session(addDays(MONDAY, 1), sets('lying-leg-curl', 8, { weightKg: 40, reps: 10, rir: 2 })),
    ];
    var actionable = actionableFrequency(frequencyReport(logs, index));
    assert.equal(actionable[0]?.muscle, 'chest');
    assert.equal(actionable[0]?.verdict, 'concentrated');
  });
});
