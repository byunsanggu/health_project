import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  FRESH_DAYS, LAYOFF_REASONS, LOAD_FLOOR,
  comebackLine, comebackWeek, loadFactorAt, planComeback, setDropAt, setsAfterDrop,
} from '../comeback.ts';
import type { LayoffReason } from '../comeback.ts';

const TODAY = '2026-10-01';
const ago = (days: number) =>
  new Date(Date.parse(TODAY + 'T00:00:00Z') - days * 86400000).toISOString().slice(0, 10);

const at = (days: number, reason: LayoffReason = 'busy') =>
  planComeback({ lastTrainedISO: ago(days), today: TODAY, reason });

describe('돌아왔을 때', () => {
  it('한 주까지는 손대지 않는다', () => {
    /*
     * 쉬는 날은 프로그램 안에 이미 들어 있다. 사흘 쉬었다고 무게를
     * 내리면 그건 도움이 아니라 방해다.
     */
    for (const days of [0, 1, 3, FRESH_DAYS]) {
      const plan = at(days);
      assert.equal(plan.needed, false, `${days}일`);
      assert.equal(plan.startLoad, 1);
      assert.equal(plan.startSetDrop, 0);
    }
    assert.equal(at(FRESH_DAYS + 1).needed, true);
  });

  it('기록이 아예 없으면 조정하지 않는다', () => {
    // 처음 쓰는 사람이다. "오랜만이네요"라고 하면 안 된다.
    assert.equal(planComeback({ today: TODAY }).needed, false);
  });

  it('오래 쉴수록 더 내린다 — 거꾸로 가는 구간이 없다', () => {
    const gaps = [8, 10, 14, 20, 28, 40, 56, 80, 120, 365];
    let previous = 1;
    for (const days of gaps) {
      const plan = at(days);
      assert.ok(plan.startLoad <= previous, `${days}일에서 올라갔습니다`);
      previous = plan.startLoad;
    }
  });

  it('아무리 오래 쉬어도 바닥 아래로는 안 내린다', () => {
    /*
     * 10년 만에 와도 50% 아래로는 안 간다. 그 아래는 운동이 아니라
     * 사람을 무시하는 숫자다.
     */
    for (const reason of ['busy', 'injury', 'sick'] as const) {
      assert.ok(at(3650, reason).startLoad >= LOAD_FLOOR);
    }
  });

  it('다쳐서 쉰 2주는 바빠서 쉰 2주와 다르다', () => {
    const busy = at(14, 'busy');
    const injury = at(14, 'injury');
    assert.ok(injury.startLoad < busy.startLoad);
    assert.ok(injury.startSetDrop > busy.startSetDrop);
    assert.ok(injury.weeks >= busy.weeks);
  });

  it('이유마다 왜 그런지 적어 둔다', () => {
    assert.equal(LAYOFF_REASONS.length, 3);
    for (const item of LAYOFF_REASONS) {
      assert.ok(item.label.length > 0 && item.note.length > 0);
    }
  });
});

describe('돌아오는 길', () => {
  it('마지막 주를 지나면 원래 무게다', () => {
    for (const days of [10, 20, 40, 90]) {
      const plan = at(days);
      assert.equal(loadFactorAt(plan, plan.weeks), 1, `${days}일`);
      assert.equal(setDropAt(plan, plan.weeks), 0);
    }
  });

  it('고르게 올라간다 — 한 주에 몰아서 뛰지 않는다', () => {
    const plan = at(70);
    let previous = 0;
    let biggest = 0;
    for (let week = 0; week <= plan.weeks; week += 1) {
      const factor = loadFactorAt(plan, week);
      assert.ok(factor >= previous, '내려갔습니다');
      if (week > 0) biggest = Math.max(biggest, factor - previous);
      previous = factor;
    }
    // 한 주에 15%p 넘게 뛰면 그 주가 통째로 과부하가 된다.
    assert.ok(biggest <= 0.15, `한 주에 ${Math.round(biggest * 100)}%p 뛰었습니다`);
  });

  it('세트는 중량보다 먼저 돌려준다', () => {
    /*
     * 세트를 줄인 채로 무게만 올리면 자극이 모자란 주가 길어진다.
     * 세트가 먼저 제자리로 와야 한다.
     */
    const plan = at(30, 'injury');
    const setsBackAt = Array.from({ length: plan.weeks + 1 }, (_, week) => setDropAt(plan, week))
      .findIndex((drop) => drop === 0);
    const loadBackAt = Array.from({ length: plan.weeks + 1 }, (_, week) => loadFactorAt(plan, week))
      .findIndex((factor) => factor >= 1);
    assert.ok(setsBackAt <= loadBackAt, '중량이 세트보다 먼저 돌아왔습니다');
  });

  it('세트를 깎아도 한 세트는 남는다', () => {
    assert.equal(setsAfterDrop(2, 2), 1);
    assert.equal(setsAfterDrop(1, 3), 1);
    assert.equal(setsAfterDrop(5, 2), 3);
    assert.equal(setsAfterDrop(4, 0), 4);
  });

  it('몇 주째인지 날짜로 센다', () => {
    assert.equal(comebackWeek('2026-10-01', '2026-10-01'), 0);
    assert.equal(comebackWeek('2026-10-01', '2026-10-07'), 0);
    assert.equal(comebackWeek('2026-10-01', '2026-10-08'), 1);
    assert.equal(comebackWeek('2026-10-01', '2026-10-22'), 3);
  });
});

describe('뭐라고 말하는가', () => {
  it('겁주지 않고 안심시킨다', () => {
    /*
     * 돌아온 사람이 제일 두려워하는 것은 "다 날아갔겠지"다. 그 생각이
     * 들면 아예 안 온다. 실제로 근력은 덜 빠지고, 그 말을 먼저 한다.
     */
    const plan = at(30);
    assert.match(plan.note, /덜 빠집니다/);
    for (const bad of ['다 날아', '처음부터', '초보', '실패']) {
      assert.ok(!plan.note.includes(bad), plan.note);
    }
  });

  it('공백을 사람 말로 적는다', () => {
    assert.match(at(10).title, /10일 만에/);
    assert.match(at(21).title, /3주 만에/);
    assert.match(at(90).title, /3달 만에/);
  });

  it('진행 중인 복귀를 한 줄로 — 조사가 받침을 따라간다', () => {
    const plan = at(30);
    assert.match(comebackLine(plan, 0), /복귀 1주차 · 무게 80%/);
    assert.match(comebackLine(plan, 0), /3주가 남았습니다/);
    assert.match(comebackLine(plan, 1), /2주가 남았습니다/);
    assert.match(comebackLine(plan, plan.weeks), /복귀를 마쳤습니다/);
  });
});
