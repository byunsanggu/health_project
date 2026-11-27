import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import {
  alarmStep,
  planRestAlarm,
  restAlarmCopy,
  REST_ALARM_FALLBACK,
  REST_ALARM_MAX_AHEAD_MS,
  type AlarmStepInput,
} from '../restAlarm.ts';

const NOW = 1_700_000_000_000;

describe('잠금 화면 휴식 끝 알림 — 거는 시각', () => {
  it('휴식이 끝나는 시각 그대로 건다', () => {
    assert.deepEqual(planRestAlarm({ now: NOW, endsAt: NOW + 90_000 }), { sendAt: NOW + 90_000 });
  });

  it('이미 끝났거나 2초 안에 끝나는 휴식은 걸지 않는다 — 알림이 휴식보다 늦게 온다', () => {
    assert.equal(planRestAlarm({ now: NOW, endsAt: NOW - 1000 }), null);
    assert.equal(planRestAlarm({ now: NOW, endsAt: NOW + 1500 }), null);
  });

  it('15분보다 먼 휴식(시계가 틀어진 기록)은 걸지 않는다 — 서버도 같은 값으로 막는다', () => {
    assert.ok(planRestAlarm({ now: NOW, endsAt: NOW + REST_ALARM_MAX_AHEAD_MS }));
    assert.equal(planRestAlarm({ now: NOW, endsAt: NOW + REST_ALARM_MAX_AHEAD_MS + 1 }), null);
    assert.equal(planRestAlarm({ now: NOW, endsAt: Number.NaN }), null);
  });
});

describe('잠금 화면 휴식 끝 알림 — 문장 (폰 안에서만 만든다)', () => {
  it('같은 종목의 다음 세트 — "휴식 끝 · 2세트 시작", 본문에 종목', () => {
    assert.deepEqual(restAlarmCopy({ next: '2세트', exerciseName: '벤치프레스' }),
      { title: '휴식 끝 · 2세트 시작', body: '벤치프레스 2세트' });
  });

  it('슈퍼세트 짝 · 다음 종목 · 마무리', () => {
    assert.equal(restAlarmCopy({ next: '랫풀다운 2세트', exerciseName: '벤치프레스' }).title, '휴식 끝 · 랫풀다운 2세트 시작');
    assert.deepEqual(restAlarmCopy({ next: '스쿼트', exerciseName: '레그 프레스' }),
      { title: '휴식 끝 · 스쿼트 시작', body: '다음 종목으로 넘어가세요' });
    assert.deepEqual(restAlarmCopy({ next: '마무리' }), { title: '휴식 끝 · 마무리', body: '오늘 운동을 마무리하세요' });
  });

  it('PT는 화면의 다음 세트 한 줄을 본문으로, 열면 이어서 센다고 덧붙인다', () => {
    const copy = restAlarmCopy({ next: '3세트', exerciseName: '스쿼트', detail: '스쿼트 3세트 · 60kg × 8–10회', pt: true });
    assert.equal(copy.title, '휴식 끝 · 3세트 시작');
    assert.equal(copy.body, '스쿼트 3세트 · 60kg × 8–10회 · 앱을 열면 PT가 이어서 셉니다');
  });

  it('다음이 비어 있으면 서비스 워커의 기본 문장과 같다', () => {
    assert.deepEqual(restAlarmCopy({ next: '' }), { ...REST_ALARM_FALLBACK });
    assert.equal(`${REST_ALARM_FALLBACK.title} · ${REST_ALARM_FALLBACK.body}`, '휴식 끝 · 다음 세트를 시작하세요');
  });

  it('시계 화면을 넘치지 않게 자른다', () => {
    const copy = restAlarmCopy({ next: '아주아주긴이름의운동'.repeat(6) });
    assert.ok(Array.from(copy.title).length <= 40);
    assert.ok(copy.title.endsWith('…'));
  });
});

describe('서버가 기다리는 방법 (functions/rest-alarm)', () => {
  const base: AlarmStepInput = { now: NOW, sendAt: NOW, startedAt: NOW, budgetMs: 110_000, pollMs: 15_000, leadMs: 1000 };

  /** 한 호출이 깨어나는 순서를 그대로 흉내 낸다 — 몇 번 이어 부르고 언제 쏘는가. */
  function simulate(restMs: number): { sentAt: number; hops: number; wakes: number } {
    const sendAt = NOW + restMs;
    let now = NOW;
    let startedAt = NOW;
    let hops = 0;
    let wakes = 0;
    for (let guard = 0; guard < 10_000; guard += 1) {
      const step = alarmStep({ ...base, now, sendAt, startedAt });
      if (step.action === 'send') return { sentAt: now, hops, wakes };
      if (step.action === 'chain') { hops += 1; startedAt = now; continue; }
      now += step.ms;
      wakes += 1;
    }
    throw new Error('끝나지 않는다');
  }

  it('시각이 되면 (1초 일찍) 쏜다', () => {
    assert.deepEqual(alarmStep({ ...base, sendAt: NOW + 1000 }), { action: 'send' });
    assert.deepEqual(alarmStep({ ...base, sendAt: NOW - 5000 }), { action: 'send' });
  });

  it('기다리는 동안에도 15초마다 깨어 취소됐는지 본다', () => {
    assert.deepEqual(alarmStep({ ...base, sendAt: NOW + 90_000 }), { action: 'sleep', ms: 15_000 });
    assert.deepEqual(alarmStep({ ...base, sendAt: NOW + 6000 }), { action: 'sleep', ms: 5000 });
  });

  it('110초를 다 쓰면 자기 자신을 다시 부른다 — 150초 벽 앞에서', () => {
    assert.deepEqual(alarmStep({ ...base, now: NOW + 110_000, sendAt: NOW + 300_000 }), { action: 'chain' });
    // 남은 예산까지만 잔다 — 예산을 넘겨 자지 않는다
    assert.deepEqual(alarmStep({ ...base, now: NOW + 100_000, sendAt: NOW + 300_000 }), { action: 'sleep', ms: 10_000 });
  });

  it('90초 휴식은 한 번에, 5분은 두 번 이어서, 15분은 여덟 번 이어서 — 늘 제시간(1초 일찍)', () => {
    assert.deepEqual(simulate(90_000), { sentAt: NOW + 89_000, hops: 0, wakes: 6 });
    const five = simulate(300_000);
    assert.equal(five.sentAt, NOW + 299_000);
    assert.equal(five.hops, 2);
    const fifteen = simulate(15 * 60_000);
    assert.equal(fifteen.sentAt, NOW + 15 * 60_000 - 1000);
    assert.equal(fifteen.hops, 8);
  });

  it('Edge Function에 들어 있는 것과 글자 그대로 같다', () => {
    const block = (path: string): string => {
      const text = readFileSync(new URL(path, import.meta.url), 'utf8');
      const match = text.match(/\/\/ <alarm-step>\n([\s\S]*?)\/\/ <\/alarm-step>/);
      assert.ok(match, path + '에 <alarm-step> 표시가 없다');
      return match[1]!.trim();
    };
    assert.equal(block('../../../server/functions/rest-alarm/index.ts'), block('../restAlarm.ts'));
  });
});
