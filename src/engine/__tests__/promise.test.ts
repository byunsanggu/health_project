import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  DEFAULT_WEEKDAY_MINUTES, DEFAULT_WEEKEND_MINUTES, EARLIEST_MINUTES, LATEST_MINUTES, LEAD_MINUTES,
  clampMinutes, defaultSlots, leadMinutesFor, minutesLabel, nextSlot, nextSlotLine, nextSlotShort,
  promiseSummary, sortSlots, timeChoices,
} from '../promise.ts';
import type { Weekday } from '../schedule.ts';

describe('약속 만들기', () => {
  it('프로그램이 고른 요일에 기본 시각을 붙인다', () => {
    /*
     * 빈칸으로 두고 고르라고 하면 아무도 안 고른다. 바꾸기 쉬운 기본값이
     * 빈칸보다 낫다.
     */
    const slots = defaultSlots([0, 3] as Weekday[]);
    assert.deepEqual(slots.map((s) => s.weekday), [0, 3]);
    for (const slot of slots) assert.equal(slot.minutes, DEFAULT_WEEKDAY_MINUTES);
  });

  it('주말은 아침이 기본이다', () => {
    // 평일 저녁 7시, 주말 오전 10시 — 한국에서 제일 흔한 자리다.
    const slots = defaultSlots([1, 5, 6] as Weekday[]);
    assert.equal(slots[0]!.minutes, DEFAULT_WEEKDAY_MINUTES);
    assert.equal(slots[1]!.minutes, DEFAULT_WEEKEND_MINUTES);
    assert.equal(slots[2]!.minutes, DEFAULT_WEEKEND_MINUTES);
  });

  it('약속 개수는 프로그램을 따른다', () => {
    /*
     * 주 4회짜리에 약속을 셋만 잡게 두면, 볼륨은 넷으로 계산하면서
     * 사람에게는 셋을 약속받는 꼴이 된다.
     */
    for (const days of [[0], [0, 3], [0, 2, 4], [0, 1, 3, 4]]) {
      assert.equal(defaultSlots(days as Weekday[]).length, days.length);
    }
  });

  it('요일 순으로 정리된다', () => {
    const slots = sortSlots([
      { weekday: 4 as Weekday, minutes: 600 },
      { weekday: 0 as Weekday, minutes: 1140 },
    ]);
    assert.deepEqual(slots.map((s) => s.weekday), [0, 4]);
  });

  it('사람 말로 적는다', () => {
    assert.equal(minutesLabel(1140), '19:00');
    assert.equal(minutesLabel(630), '10:30');
    assert.equal(minutesLabel(300), '05:00');
    assert.equal(promiseSummary([
      { weekday: 1 as Weekday, minutes: 1140 },
      { weekday: 5 as Weekday, minutes: 600 },
    ]), '화 19:00 · 토 10:00');
  });
});

describe('시각 고르기', () => {
  it('새벽과 한밤중은 못 고른다', () => {
    const choices = timeChoices();
    assert.equal(choices[0], EARLIEST_MINUTES);
    assert.equal(choices[choices.length - 1], LATEST_MINUTES);
    assert.ok(choices.every((m) => m >= 5 * 60 && m <= 22 * 60));
  });

  it('30분 단위로만 고른다 — 7시 13분 같은 약속은 없다', () => {
    assert.equal(clampMinutes(1133), 1140);
    assert.equal(clampMinutes(1125), 1140);
    assert.equal(clampMinutes(0), EARLIEST_MINUTES);
    assert.equal(clampMinutes(23 * 60), LATEST_MINUTES);
    for (const m of timeChoices()) assert.equal(m % 30, 0);
  });
});

describe('다음 약속', () => {
  const slots = [
    { weekday: 1 as Weekday, minutes: 19 * 60 },   // 화 19:00
    { weekday: 3 as Weekday, minutes: 19 * 60 },   // 목 19:00
    { weekday: 5 as Weekday, minutes: 10 * 60 },   // 토 10:00
  ];

  it('오늘 것이 아직 안 지났으면 오늘이다', () => {
    const next = nextSlot(slots, 1 as Weekday, 15 * 60);
    assert.equal(next!.daysAhead, 0);
    assert.equal(next!.slot.weekday, 1);
    assert.match(nextSlotLine(next), /오늘 19:00/);
  });

  it('오늘 것이 지났으면 다음 약속으로 넘어간다', () => {
    /*
     * 화요일 저녁 8시에 앱을 연 사람에게 "화요일 7시"를 가리키면,
     * 이미 지난 시각을 약속이라고 하는 것이다.
     */
    const next = nextSlot(slots, 1 as Weekday, 20 * 60);
    assert.equal(next!.slot.weekday, 3, '목요일이어야 합니다');
    assert.equal(next!.daysAhead, 2);
  });

  it('내일이면 내일이라고 한다', () => {
    const next = nextSlot(slots, 0 as Weekday, 12 * 60);
    assert.equal(next!.daysAhead, 1);
    assert.match(nextSlotLine(next), /내일 19:00/);
  });

  it('주를 넘어가도 돈다', () => {
    // 일요일에 열면 다음 주 화요일이다.
    const next = nextSlot(slots, 6 as Weekday, 12 * 60);
    assert.equal(next!.slot.weekday, 1);
    assert.equal(next!.daysAhead, 2);
  });

  it('약속이 없으면 없다고 한다', () => {
    assert.equal(nextSlot([], 0 as Weekday, 600), null);
    assert.equal(nextSlotLine(null), '');
  });

  it('재촉하는 말이 없다', () => {
    // 약속은 지키라고 있는 것이지 겁주라고 있는 것이 아니다.
    for (const weekday of [0, 1, 3, 5, 6] as Weekday[]) {
      const line = nextSlotLine(nextSlot(slots, weekday, 12 * 60));
      for (const bad of ['안 가면', '놓치', '사라', '실패']) {
        assert.ok(!line.includes(bad), line);
      }
    }
  });
});

describe('알림 시각', () => {
  it('약속 한 시간 전이다', () => {
    assert.equal(leadMinutesFor({ weekday: 1 as Weekday, minutes: 19 * 60 }), 18 * 60);
    assert.equal(LEAD_MINUTES, 60);
  });

  it('새벽에는 깨우지 않는다', () => {
    /*
     * 새벽 6시에 운동하는 사람이라도 5시에 울리는 알림은 도움이 아니다.
     */
    assert.ok(leadMinutesFor({ weekday: 1 as Weekday, minutes: 6 * 60 }) >= 6 * 60);
    assert.ok(leadMinutesFor({ weekday: 1 as Weekday, minutes: 5 * 60 }) >= 6 * 60);
  });
});

describe('짧게 쓰는 약속', () => {
  const thu = { weekday: 3 as Weekday, minutes: 19 * 60 };

  it('오늘과 내일은 요일로 바꾸지 않는다', () => {
    /*
     * "목 19:00"은 오늘이 목요일이어도 사흘 뒤처럼 읽힌다. 가까운 날은
     * 요일보다 오늘·내일이 빠르다.
     */
    assert.equal(nextSlotShort({ slot: thu, daysAhead: 0, minutesAway: 60 }), '오늘 19:00');
    assert.equal(nextSlotShort({ slot: thu, daysAhead: 1, minutesAway: 1500 }), '내일 19:00');
    assert.equal(nextSlotShort({ slot: thu, daysAhead: 3, minutesAway: 5000 }), '목 19:00');
  });

  it('약속이 없으면 빈 문자열 — 자리를 차지하지 않는다', () => {
    assert.equal(nextSlotShort(null), '');
  });
});
