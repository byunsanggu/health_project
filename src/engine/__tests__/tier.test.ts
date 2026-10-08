import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildStreak, type WeekResult } from '../streak.ts';
import { DEMOTE_AFTER, DEMOTE_WEEKS, TIERS, buildTier, tierBadge, tierFor, weeksBackTo } from '../tier.ts';
import type { SessionLog } from '../types.ts';

const MONDAY = '2026-01-05';
const day = (n: number): string =>
  new Date(Date.parse(MONDAY + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);

/**
 * 주별 '지켰다/안 지켰다'를 buildStreak에 통과시켜 진짜 WeekResult를 만든다.
 *
 * WeekResult를 손으로 지어내면 streak의 쉼표 규칙과 티어가 따로 놀게 되고,
 * 그 어긋남은 실제 화면에서만 드러난다.
 */
function weeksFrom(kept: readonly boolean[], openLast = true) {
  const sessions: SessionLog[] = [];
  kept.forEach((hit, w) => {
    if (!hit) return;
    for (let d = 0; d < 3; d += 1) {
      sessions.push({
        id: `${w}-${d}`,
        date: day(w * 7 + d),
        updatedAt: day(w * 7 + d),
        sets: [{ exerciseId: 'squat', weightKg: 60, reps: 8, rir: 2 }],
      } as SessionLog);
    }
  });
  const lastWeek = kept.length - 1;
  return buildStreak({
    sessions,
    thisMonday: day(lastWeek * 7),
    target: 3,
    lookbackWeeks: kept.length,
    today: day(lastWeek * 7 + (openLast ? 3 : 7)),
  }).weeks;
}

const all = (n: number, value = true) => Array.from({ length: n }, () => value);

describe('등급 사다리', () => {
  it('브론즈에서 다이아몬드까지 올라가기만 한다', () => {
    let last = -1;
    for (const tier of TIERS) {
      assert.ok(tier.weeks > last, tier.id);
      last = tier.weeks;
    }
    assert.equal(TIERS[0]?.id, 'bronze');
    assert.equal(TIERS[TIERS.length - 1]?.id, 'diamond');
  });

  it('일 년을 꾸준히 하면 다이아몬드다', () => {
    assert.equal(tierFor(52)?.id, 'diamond');
    assert.equal(tierFor(51)?.id, 'platinum');
  });

  it('한 주도 못 지켰으면 등급이 없다', () => {
    assert.equal(tierFor(0), null);
    assert.equal(tierBadge(0), '');
    assert.equal(tierBadge(4), '실버');
  });
});

describe('점수는 끝난 주에만 움직인다', () => {
  it('진행 중인 주는 세지 않는다', () => {
    /* 월요일에 올라갔던 등급이 금요일에 내려가면 그건 강박이다. */
    const open = buildTier({ weeks: weeksFrom(all(5), true) });
    const closed = buildTier({ weeks: weeksFrom(all(5), false) });
    assert.equal(open.score, 4);
    assert.equal(closed.score, 5);
  });

  it('지킨 주만큼 쌓인다', () => {
    assert.equal(buildTier({ weeks: weeksFrom(all(13), false) }).score, 13);
    assert.equal(buildTier({ weeks: weeksFrom(all(13), false) }).tier?.id, 'gold');
  });
});

describe('무게가 아니라 지킨 주로 나눈다', () => {
  it('주 3회를 여덟 주 지킨 사람이 실버다 — 드는 무게는 보지 않는다', () => {
    const state = buildTier({ weeks: weeksFrom(all(8), false) });
    assert.equal(state.tier?.id, 'silver');
    // 입력에 무게가 들어갈 자리가 아예 없다.
    assert.ok(!Object.keys(state).includes('weightKg'));
  });
});

describe('강등', () => {
  it('한 주 빠졌다고 내려가지 않는다', () => {
    // 쉼표를 못 쓰는 구간(4주 미만)에서도 한 주로는 안 내려간다.
    const state = buildTier({ weeks: weeksFrom([true, true, false, true], false) });
    assert.equal(state.score, 3);
    assert.equal(state.change, null);
  });

  it('두 주 연속 비면 내려간다', () => {
    const state = buildTier({ weeks: weeksFrom([...all(6), false, false], false) });
    assert.equal(state.change, 'down');
    assert.equal(state.score, 6 - DEMOTE_WEEKS);
  });

  it('반 년치가 한 번에 날아가지 않는다', () => {
    /*
     * 플래티넘(26주)이 두 주 비었다고 골드(12주)가 되면 그 사람은
     * 돌아오지 않는다. 깎는 것은 등급이 아니라 네 주다.
     */
    const state = buildTier({ weeks: weeksFrom([...all(26), false, false], false) });
    assert.equal(state.score, 22);
    assert.equal(state.tier?.id, 'gold');
    assert.match(state.message, new RegExp(`${DEMOTE_WEEKS}주 지키면 플래티넘으로 돌아옵니다`));
  });

  it('돌아가는 데 걸리는 주를 정확히 말한다', () => {
    const platinum = TIERS.find((tier) => tier.id === 'platinum');
    assert.equal(weeksBackTo(22, platinum ?? null), 4);
    assert.equal(weeksBackTo(30, platinum ?? null), 0);
    assert.equal(weeksBackTo(10, null), 0);
  });

  it('0 아래로는 안 내려간다', () => {
    const state = buildTier({ weeks: weeksFrom([true, false, false], false) });
    assert.equal(state.score, 0);
    assert.ok(state.score >= 0);
  });

  it('조사가 어색하지 않다', () => {
    for (const kept of [[...all(26), false, false], [...all(13), false, false], [...all(5), false, false]]) {
      const message = buildTier({ weeks: weeksFrom(kept, false) }).message;
      assert.doesNotMatch(message, /골드으로|실버으로|브론즈으로|다이아몬드으로/, message);
    }
  });
});

describe('봐주는 주', () => {
  it('덜어내는 주는 목표가 낮아져 자동으로 지켜진다', () => {
    /* streak이 디로드 주의 목표를 반으로 낮춘다. 티어가 따로 알 필요가 없다. */
    const sessions: SessionLog[] = [];
    for (let d = 0; d < 2; d += 1) {
      sessions.push({ id: `d${d}`, date: day(d), updatedAt: day(d), sets: [{ exerciseId: 'squat', weightKg: 60, reps: 8, rir: 2 }] } as SessionLog);
    }
    const weeks = buildStreak({
      sessions, thisMonday: day(0), target: 4, deloadWeeks: [day(0)], lookbackWeeks: 1, today: day(7),
    }).weeks;
    assert.equal(buildTier({ weeks }).score, 1);
  });

  it('아팠던 주는 빼고 센다 — 아픈 날 나오라고 미는 앱이 되면 안 된다', () => {
    const kept = [...all(6), false, false];
    const weeks = weeksFrom(kept, false);
    const hurt = [weeks[0]?.weekStart ?? '', weeks[1]?.weekStart ?? ''];
    const punished = buildTier({ weeks });
    const excused = buildTier({ weeks, excused: hurt });
    assert.equal(punished.change, 'down');
    assert.equal(excused.change, null);
    assert.equal(excused.score, 6);
  });

  it('쉼표로 살린 주는 점수를 주지도 깎지도 않는다', () => {
    /* 안 한 주를 한 주로 세면 거짓말이고, 살려 놓고 깎으면 살린 게 아니다. */
    const weeks = weeksFrom([...all(12), false], false);
    const forgiven = weeks.filter((week: WeekResult) => week.forgiven);
    assert.equal(forgiven.length, 1, '쉼표가 안 쓰였다');
    const state = buildTier({ weeks });
    assert.equal(state.score, 12);
    assert.equal(state.missRun, 0);
  });
});

describe('말', () => {
  it('한 주 비면 무엇을 잃는지 숫자로 말한다', () => {
    /* 쉼표를 이미 쓴 뒤에 또 비운 주. */
    const weeks = weeksFrom([...all(12), false, true, true, false], false);
    const state = buildTier({ weeks });
    assert.equal(state.missRun, 1);
    assert.equal(state.atRisk, true);
    assert.match(state.message, new RegExp(`${DEMOTE_WEEKS}주가 깎입니다`));
  });

  it('다음 등급까지 몇 주인지 말한다', () => {
    const state = buildTier({ weeks: weeksFrom(all(6), false) });
    assert.equal(state.weeksToNext, 6);
    assert.match(state.message, /골드까지 6주/);
  });

  it('한 주 남았으면 "한 주"라고 말한다', () => {
    const state = buildTier({ weeks: weeksFrom(all(11), false) });
    assert.match(state.message, /한 주만 더/);
  });

  it('올라선 주에만 같은 티어 사람 수를 붙인다', () => {
    const up = buildTier({ weeks: weeksFrom(all(4), false), peers: 1203 });
    assert.equal(up.change, 'up');
    assert.match(up.message, /1,203명/);
    const steady = buildTier({ weeks: weeksFrom(all(6), false), peers: 1203 });
    assert.doesNotMatch(steady.message, /명/);
  });

  it('등수를 매기지 않는다', () => {
    const state = buildTier({ weeks: weeksFrom(all(30), false), peers: 50 });
    assert.doesNotMatch(state.message, /등|위|1위|순위/);
  });

  it('처음 온 사람에게 혼내지 않는다', () => {
    const state = buildTier({ weeks: weeksFrom(all(3, false), false) });
    assert.equal(state.tier, null);
    assert.match(state.message, /지키면 브론즈/);
  });

  it('두 주 연속 미달은 DEMOTE_AFTER와 같다', () => {
    assert.equal(DEMOTE_AFTER, 2);
  });
});
