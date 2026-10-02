import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { FIRST_MACHINE, machineOf, weightHistoryFor } from '../gymWeight.ts';
import {
  SPLIT_GAP, SPLIT_MIN_KG,
  machineLabel, machinesFor, mergeKnownMachines, nextMachineId, shouldAskSplit, splitGap, splitQuestion,
} from '../machine.ts';
import type { Exercise, SessionLog } from '../types.ts';

const press: Exercise = {
  id: 'machine-chest-press', name: '머신 체스트프레스', nameEn: 'Machine Chest Press',
  equipment: 'machine', pattern: 'horizontalPush',
  contribution: { chest: 1 }, jointStress: { shoulder: 0.4 }, increment: 5,
};
const bench: Exercise = {
  ...press, id: 'barbell-bench-press', name: '바벨 벤치프레스', equipment: 'barbell', increment: 2.5,
};

const set = (id: string, kg: number, machine?: string) =>
  ({ exerciseId: id, weightKg: kg, reps: 10, rir: 2, machine });

const history: SessionLog[] = [
  { date: '2026-09-01', gymId: 'gym-a', sets: [set(press.id, 60)] },
  { date: '2026-09-15', gymId: 'gym-a', sets: [set(press.id, 120, 'b')] },
  { date: '2026-09-22', gymId: 'gym-a', sets: [set(press.id, 65)] },
  { date: '2026-09-25', gymId: 'gym-a', sets: [set(press.id, 125, 'b'), set(bench.id, 100)] },
  { date: '2026-09-26', gymId: 'gym-b', sets: [set(press.id, 40)] },
];

describe('기계 열쇠', () => {
  it('칸이 비어 있으면 첫 번째 기계다 — 옛 기록을 손대지 않는다', () => {
    assert.equal(machineOf({}), FIRST_MACHINE);
    assert.equal(machineOf({ machine: undefined }), FIRST_MACHINE);
    assert.equal(machineOf({ machine: 'b' }), 'b');
  });

  it('다음 열쇠는 비어 있는 것 중 앞의 것', () => {
    assert.equal(nextMachineId([]), 'a');
    assert.equal(nextMachineId(['a']), 'b');
    assert.equal(nextMachineId(['a', 'b']), 'c');
    // 가운데가 비면 그 자리를 다시 쓴다
    assert.equal(nextMachineId(['a', 'c']), 'b');
  });
});

describe('써 온 기계 모으기', () => {
  it('헬스장 안에서 기계별로 나눠 센다', () => {
    const seen = machinesFor(history, press.id, 'gym-a');
    assert.deepEqual(seen.map((m) => m.id), ['a', 'b']);
    assert.equal(seen[0]!.sessions, 2);
    assert.equal(seen[1]!.sessions, 2);
  });

  it('최근 무게는 가장 최근 날짜의 톱세트다', () => {
    const seen = machinesFor(history, press.id, 'gym-a');
    assert.equal(seen[0]!.lastKg, 65);
    assert.equal(seen[0]!.lastDate, '2026-09-22');
    assert.equal(seen[1]!.lastKg, 125);
  });

  it('날짜가 뒤섞여 들어와도 최신이 남는다', () => {
    const shuffled = [history[3]!, history[0]!, history[2]!, history[1]!];
    const seen = machinesFor(shuffled, press.id, 'gym-a');
    assert.equal(seen.find((m) => m.id === 'a')!.lastKg, 65);
  });

  it('다른 헬스장 기록은 섞이지 않는다', () => {
    const seen = machinesFor(history, press.id, 'gym-b');
    assert.deepEqual(seen.map((m) => m.lastKg), [40]);
  });

  it('헬스장을 모르면 나눌 근거가 없다', () => {
    assert.deepEqual(machinesFor(history, press.id, undefined), []);
  });

  it('워밍업은 기계를 알아보는 단서가 못 된다', () => {
    const withWarmup: SessionLog[] = [
      { date: '2026-09-01', gymId: 'gym-a', sets: [
        { ...set(press.id, 20), warmup: true }, set(press.id, 60),
      ] },
    ];
    assert.equal(machinesFor(withWarmup, press.id, 'gym-a')[0]!.lastKg, 60);
  });

  it('이름은 무게로 짓는다 — A·B는 아무 뜻이 없다', () => {
    const seen = machinesFor(history, press.id, 'gym-a');
    assert.equal(machineLabel(seen[0]!), '65kg 쓰던 것');
    assert.equal(machineLabel(seen[1]!), '125kg 쓰던 것');
    assert.equal(machineLabel({ id: 'c', lastKg: null, lastDate: null, sessions: 0 }), '처음 쓰는 기계');
  });
});

describe('중량 처방이 보는 이력', () => {
  it('기계를 나누면 지난번이 그 기계의 지난번이 된다', () => {
    const a = weightHistoryFor(history, press, { gymId: 'gym-a', machine: 'a' });
    const b = weightHistoryFor(history, press, { gymId: 'gym-a', machine: 'b' });

    const kg = (sessions: SessionLog[]) => sessions
      .flatMap((s) => s.sets.filter((x) => x.exerciseId === press.id))
      .map((x) => x.weightKg);

    assert.deepEqual(kg(a), [60, 65]);
    assert.deepEqual(kg(b), [120, 125]);
  });

  it('안 주면 첫 번째 기계 — 나눈 적 없는 사람은 아무것도 안 달라진다', () => {
    const plain: SessionLog[] = [
      { date: '2026-09-01', gymId: 'gym-a', sets: [set(press.id, 60)] },
      { date: '2026-09-08', gymId: 'gym-a', sets: [set(press.id, 65)] },
    ];
    const scoped = weightHistoryFor(plain, press, { gymId: 'gym-a' });
    assert.deepEqual(scoped.flatMap((s) => s.sets).map((x) => x.weightKg), [60, 65]);
  });

  it('세션을 통째로 버리지 않는다 — 같은 날 다른 종목 기록은 멀쩡하다', () => {
    const a = weightHistoryFor(history, press, { gymId: 'gym-a', machine: 'a' });
    const sameDay = a.find((s) => s.date === '2026-09-25')!;
    assert.deepEqual(sameDay.sets.map((x) => x.exerciseId), [bench.id]);
  });

  it('바벨은 기계가 아니라 나누지 않는다', () => {
    const scoped = weightHistoryFor(history, bench, { gymId: 'gym-a', machine: 'b' });
    assert.equal(scoped.length, history.length);
  });

  it('원본을 건드리지 않는다', () => {
    const before = JSON.stringify(history);
    weightHistoryFor(history, press, { gymId: 'gym-a', machine: 'a' });
    assert.equal(JSON.stringify(history), before);
  });
});

describe('물어볼까', () => {
  const base = { exercise: press, gymId: 'gym-a' };

  it('많이 어긋나면 묻는다 — 양쪽 다', () => {
    assert.equal(shouldAskSplit({ ...base, plannedKg: 125, loggedKg: 65 }), true);
    assert.equal(shouldAskSplit({ ...base, plannedKg: 65, loggedKg: 125 }), true);
  });

  it('평소 변동으로는 안 묻는다', () => {
    assert.equal(shouldAskSplit({ ...base, plannedKg: 65, loggedKg: 67.5 }), false);
    // 디로드만큼 내려가도 — 처방 자체가 이미 내려와 있으므로 어긋난 게 아니다
    assert.equal(shouldAskSplit({ ...base, plannedKg: 100, loggedKg: 90 }), false);
  });

  it('비율은 크지만 무게 차이가 작으면 안 묻는다', () => {
    /*
     * 케이블 7kg → 10kg은 43%지만 3kg이다. 기계가 달라서가 아니라
     * 그냥 올린 것이다.
     */
    assert.equal(shouldAskSplit({ ...base, plannedKg: 7, loggedKg: 10 }), false);
    assert.ok(splitGap(7, 10) > SPLIT_GAP);
    assert.equal(SPLIT_MIN_KG, 5);
  });

  it('워밍업에는 안 묻는다 — 당연히 가볍다', () => {
    assert.equal(shouldAskSplit({ ...base, plannedKg: 125, loggedKg: 40, warmup: true }), false);
  });

  it('첫 수행 추정값과는 비교하지 않는다', () => {
    // 추정이 틀린 것을 "다른 기계"라고 부르면 안 된다.
    assert.equal(shouldAskSplit({ ...base, plannedKg: 125, loggedKg: 65, estimated: true }), false);
  });

  it('이미 답했으면 다시 안 묻는다', () => {
    assert.equal(shouldAskSplit({ ...base, plannedKg: 125, loggedKg: 65, dismissed: true }), false);
    assert.equal(shouldAskSplit({ ...base, plannedKg: 125, loggedKg: 65, picked: true }), false);
  });

  it('바벨·덤벨에는 안 묻는다 — 100kg은 어디서나 100kg이다', () => {
    assert.equal(shouldAskSplit({ ...base, exercise: bench, plannedKg: 125, loggedKg: 65 }), false);
  });

  it('헬스장을 모르면 안 묻는다 — 나눌 근거가 없다', () => {
    assert.equal(shouldAskSplit({ ...base, gymId: undefined, plannedKg: 125, loggedKg: 65 }), false);
  });

  it('비교할 숫자가 없으면 안 묻는다', () => {
    assert.equal(shouldAskSplit({ ...base, plannedKg: null, loggedKg: 65 }), false);
    assert.equal(shouldAskSplit({ ...base, plannedKg: 0, loggedKg: 65 }), false);
    assert.equal(shouldAskSplit({ ...base, plannedKg: 125, loggedKg: 0 }), false);
  });
});

describe('물어보는 말', () => {
  it('받침을 보고 조사를 고른다', () => {
    assert.match(splitQuestion('랫풀다운', 80, 45), /^랫풀다운은 /);
    assert.match(splitQuestion('레그프레스', 80, 45), /^레그프레스는 /);
  });

  it('사용자가 적은 무게를 틀렸다고 하지 않는다', () => {
    const text = splitQuestion('랫풀다운', 80, 45);
    assert.match(text, /다른 기계인가요\?$/);
    for (const blame of ['잘못', '틀렸', '오류', '확인하세요']) {
      assert.ok(!text.includes(blame), text);
    }
  });
});

describe('나눈 기계는 남는다', () => {
  it('세트가 하나도 없어도 목록에 남는다', () => {
    /*
     * 나눈 당일에 원래 기계로 되돌리면 새 기계에 세트가 하나도 안 남는다.
     * 그때 목록에서 사라지면, 나눠 달라고 한 사람이 보기에는 그냥 없어진
     * 것이다.
     */
    const seen = machinesFor(history, press.id, 'gym-a');
    const merged = mergeKnownMachines(seen, ['a', 'b', 'c']);
    assert.deepEqual(merged.map((m) => m.id), ['a', 'b', 'c']);
    assert.equal(merged[2]!.lastKg, null);
    assert.equal(merged[2]!.sessions, 0);
    assert.equal(machineLabel(merged[2]!), '처음 쓰는 기계');
  });

  it('이미 있는 기계를 두 번 넣지 않는다', () => {
    const seen = machinesFor(history, press.id, 'gym-a');
    const merged = mergeKnownMachines(seen, ['a', 'b']);
    assert.equal(merged.length, 2);
    assert.equal(merged[1]!.lastKg, 125);
  });

  it('적어 둔 것이 없으면 그대로다', () => {
    const seen = machinesFor(history, press.id, 'gym-a');
    assert.deepEqual(mergeKnownMachines(seen, []).map((m) => m.id), seen.map((m) => m.id));
  });
});
