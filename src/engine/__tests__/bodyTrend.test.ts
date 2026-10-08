import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  MIN_WEIGH_INS,
  WINDOW_DAYS,
  buildBodyTrend,
  holdLoadWhileCutting,
  tidyWeighIns,
  trendPoints,
  type WeighIn,
} from '../bodyTrend.ts';

const day = (n: number, base = '2026-09-01'): string =>
  new Date(Date.parse(base + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);

/** 하루 요동을 섞은 체중계 기록. */
const NOISE = [0, 0.7, -0.5, 1.1, -0.3, 0.4, -0.8];
const ramp = (start: number, perWeek: number, days: number): WeighIn[] =>
  Array.from({ length: days }, (_, i) => ({
    date: day(i),
    kg: Math.round((start + (perWeek / 7) * i + (NOISE[i % NOISE.length] ?? 0)) * 10) / 10,
  }));

describe('하루치를 믿지 않는다', () => {
  it('같은 날 두 번 재면 나중 것만 남는다', () => {
    const tidy = tidyWeighIns([
      { date: '2026-09-01', kg: 80 },
      { date: '2026-09-01', kg: 79.2 },
      { date: '2026-09-02', kg: 79.8 },
    ]);
    assert.equal(tidy.length, 2);
    assert.equal(tidy[0]?.kg, 79.2);
  });

  it('말이 안 되는 값은 버린다', () => {
    const tidy = tidyWeighIns([
      { date: '2026-09-01', kg: 0 },
      { date: '2026-09-02', kg: Number.NaN },
      { date: '2026-09-03', kg: 78 },
    ]);
    assert.deepEqual(tidy, [{ date: '2026-09-03', kg: 78 }]);
  });

  it('이동평균 창은 기록 개수가 아니라 날짜로 센다', () => {
    /*
     * 띄엄띄엄 잰 사람의 "최근 7개"는 두 달치다. 그걸 평균 내면
     * 오늘 체중이 아니라 지난달 체중이 나온다.
     */
    const sparse: WeighIn[] = [
      { date: day(0), kg: 90 },
      { date: day(30), kg: 80 },
      { date: day(31), kg: 80 },
    ];
    const points = trendPoints(sparse);
    const last = points[points.length - 1];
    assert.equal(last?.samples, 2, '30일 전 값은 창 밖이다');
    assert.equal(last?.avgKg, 80);
  });

  it('창 안의 날만 들어간다', () => {
    const daily = ramp(80, 0, 20);
    const last = trendPoints(daily).at(-1);
    assert.equal(last?.samples, WINDOW_DAYS);
  });

  it('요동이 추세를 흔들지 못한다', () => {
    // 하루값은 ±1kg 튀지만 추세선은 완만해야 한다.
    const points = trendPoints(ramp(80, 0, 21));
    const avgs = points.slice(WINDOW_DAYS).map((point) => point.avgKg);
    const spread = Math.max(...avgs) - Math.min(...avgs);
    assert.ok(spread < 0.5, `추세선이 ${spread}kg 흔들렸다`);
  });
});

describe('속도를 말할 수 있을 때만 말한다', () => {
  it('한 번도 안 쟀으면 재라고만 한다', () => {
    const trend = buildBodyTrend({ weighIns: [], today: day(0), goal: 'cut' });
    assert.equal(trend.pace, null);
    assert.equal(trend.trendKg, null);
    assert.match(trend.message, /재면/);
  });

  it('세 번 아래로는 추세선을 긋지 않는다', () => {
    const trend = buildBodyTrend({
      weighIns: ramp(80, -0.5, MIN_WEIGH_INS - 1),
      today: day(1),
      goal: 'cut',
    });
    assert.equal(trend.pace, null);
    assert.match(trend.message, /더 재면/);
  });

  it('일주일 안쪽 기록으로는 속도를 말하지 않는다', () => {
    /* 6일치로 "주 몇 kg"을 말하면 그건 요동을 속도로 부른 것이다. */
    const trend = buildBodyTrend({ weighIns: ramp(80, -0.5, 6), today: day(5), goal: 'cut' });
    assert.equal(trend.pace, null);
    assert.equal(trend.weeklyKg, null);
    assert.ok(trend.trendKg !== null, '추세값 자체는 보여 준다');
  });

  it('2주 넘게 재면 속도가 나온다', () => {
    const trend = buildBodyTrend({ weighIns: ramp(82, -0.5, 30), today: day(29), goal: 'cut' });
    assert.equal(trend.pace, 'down');
    assert.ok(trend.weeklyKg !== null && Math.abs(trend.weeklyKg + 0.5) < 0.2, String(trend.weeklyKg));
  });

  it('속도는 평균끼리 뺀다 — 하루값끼리 빼지 않는다', () => {
    /*
     * 마지막 날만 2kg 튀게 둔다. 하루값으로 계산하면 속도가 뒤집히고,
     * 평균으로 계산하면 거의 그대로다.
     */
    const base = ramp(82, -0.5, 30);
    const spiked = base.map((entry, i) =>
      i === base.length - 1 ? { ...entry, kg: entry.kg + 2 } : entry,
    );
    const trend = buildBodyTrend({ weighIns: spiked, today: day(29), goal: 'cut' });
    assert.ok(trend.weeklyKg !== null && trend.weeklyKg < 0, '하루 요동에 방향이 뒤집혔다');
  });

  it('띄엄띄엄 재면 속도를 말하지 않는다', () => {
    const sparse: WeighIn[] = [0, 7, 14, 21].map((n) => ({ date: day(n), kg: 82 - n * 0.07 }));
    const trend = buildBodyTrend({ weighIns: sparse, today: day(21), goal: 'cut' });
    assert.equal(trend.pace, null, '네 번으로 2주 속도를 말하면 안 된다');
  });
});

describe('같은 숫자라도 목표가 다르면 다른 말이다', () => {
  const at = (perWeek: number, goal: 'cut' | 'hold' | 'grow') =>
    buildBodyTrend({ weighIns: ramp(82, perWeek, 30), today: day(29), goal });

  it('주 1%를 넘으면 경고한다', () => {
    const trend = at(-1.2, 'cut');
    assert.equal(trend.pace, 'fastDown');
    assert.ok(trend.warning);
    assert.match(trend.warning ?? '', /근육/);
  });

  it('적정 속도에는 경고가 없다', () => {
    const trend = at(-0.5, 'cut');
    assert.equal(trend.pace, 'down');
    assert.equal(trend.warning, null);
    assert.match(trend.message, /좋은 속도/);
  });

  it('정체는 실패가 아니라고 말한다', () => {
    const trend = at(0, 'cut');
    assert.equal(trend.pace, 'flat');
    assert.doesNotMatch(trend.message, /실패|못/);
  });

  it('같은 증가가 증량기에는 칭찬, 유지기에는 경고다', () => {
    const grow = at(0.2, 'grow');
    const hold = at(0.2, 'hold');
    assert.equal(grow.pace, hold.pace);
    assert.notEqual(grow.message, hold.message);
    assert.match(grow.message, /좋은 속도|근육/);
  });

  it('증량이 너무 빠르면 지방이라고 말한다', () => {
    const trend = at(0.9, 'grow');
    assert.equal(trend.pace, 'up');
    assert.match(trend.message, /지방/);
  });

  it('오래 안 쟀으면 그 말을 한다', () => {
    const trend = buildBodyTrend({ weighIns: ramp(82, -0.5, 20), today: day(45), goal: 'cut' });
    assert.match(trend.warning ?? '', /안 쟀/);
  });
});

describe('감량기에는 무게를 지키는 것이 성공이다', () => {
  it('빠지는 중이면 중량을 올리지 말라고 한다', () => {
    const trend = buildBodyTrend({ weighIns: ramp(82, -0.5, 30), today: day(29), goal: 'cut' });
    const note = holdLoadWhileCutting(trend, 'cut');
    assert.ok(note);
    assert.match(note ?? '', /지키는/);
  });

  it('증량기에는 그 말을 하지 않는다', () => {
    const trend = buildBodyTrend({ weighIns: ramp(82, 0.2, 30), today: day(29), goal: 'grow' });
    assert.equal(holdLoadWhileCutting(trend, 'grow'), null);
  });

  it('속도를 모르면 아무 말도 하지 않는다', () => {
    const trend = buildBodyTrend({ weighIns: ramp(82, -0.5, 4), today: day(3), goal: 'cut' });
    assert.equal(holdLoadWhileCutting(trend, 'cut'), null);
  });
});
