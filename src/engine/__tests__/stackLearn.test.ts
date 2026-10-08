import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { loadableWeights, nearestLoadable } from '../gym.ts';
import type { StackLoading } from '../gym.ts';
import { COARSE_SAMPLES, guessStep, learnStack, observedWeights } from '../stackLearn.ts';
import type { SessionLog } from '../types.ts';

const BASE: StackLoading = { kind: 'stack', minKg: 5, stepKg: 5, maxKg: 100, addOnKg: [2.5] };

const learn = (weights: readonly number[]) => learnStack(BASE, guessStep(weights));

describe('적은 무게에서 간격 읽기', () => {
  it('흔한 기계들을 맞게 읽는다', () => {
    assert.equal(guessStep([40, 45, 50, 55, 60])?.stepKg, 5);
    assert.equal(guessStep([25, 27.5, 30, 32.5])?.stepKg, 2.5);
    assert.equal(guessStep([49, 56, 63, 70])?.stepKg, 7);
  });

  it('보조추를 쓴 사람은 그만큼 촘촘하게 읽힌다', () => {
    // 50 → 52.5는 스택이 아니라 위에 얹은 2.5kg이다. 그래도 만들 수 있는 무게다.
    assert.equal(guessStep([50, 52.5, 55, 60])?.stepKg, 2.5);
  });

  it('한 번만 적었으면 간격은 모르지만 범위는 안다', () => {
    /*
     * 120kg을 들었다는 사실은 "이 기계는 120까지 간다"를 증명한다.
     * 간격은 아무것도 말해 주지 않는다. 둘을 따로 본다.
     */
    const one = guessStep([120]);
    assert.equal(one?.stepKg, null);
    assert.equal(one?.heaviestKg, 120);
    // 같은 무게를 여러 번 해도 마찬가지다 — 차이가 없으면 간격을 모른다.
    assert.equal(guessStep([60, 60, 60])?.stepKg, null);
    assert.equal(guessStep([]), null);
  });

  it('말이 안 되는 간격은 버리고 범위만 쓴다', () => {
    assert.equal(guessStep([60, 60.1])?.stepKg, null);   // 0.5kg 미만
    assert.equal(guessStep([10, 110])?.stepKg, null);    // 25kg 초과
    assert.equal(guessStep([10, 110])?.heaviestKg, 110);
  });

  it('한 번만 적어도 천장은 올라간다', () => {
    // 이걸 안 하면 120kg을 든 사람에게 계속 102.5를 처방한다.
    const learned = learn([120]);
    assert.ok(learned.maxKg >= 120);
    assert.equal(learned.stepKg, BASE.stepKg);
    assert.ok(loadableWeights(learned).includes(120));
  });
});

describe('배운 것을 명세에 넣기', () => {
  it('적은 무게는 전부 만들 수 있어야 한다', () => {
    /*
     * 이게 제일 중요하다. 사용자가 **실제로 든** 무게를 "그 기계는 그거
     * 못 만든다"고 하면 그건 자기가 한 일을 부정당하는 것이다.
     */
    for (const logged of [
      [25, 27.5, 30, 32.5],
      [49, 56, 63, 70],
      [110, 120, 130, 150],
      [40, 45, 50, 55, 60],
      [7.5, 15, 22.5],
    ]) {
      const all = loadableWeights(learn(logged));
      for (const weight of logged) {
        assert.ok(all.includes(weight), `${weight}kg (${logged.join(',')})`);
      }
    }
  });

  it('더 촘촘한 간격은 두 번만 봐도 받는다', () => {
    // 2.5kg 차이를 실제로 봤다면 그 기계는 2.5kg을 만들 수 있다. 증명된 사실이다.
    assert.equal(learn([40, 42.5]).stepKg, 2.5);
  });

  it('더 거친 간격은 근거가 더 필요하다', () => {
    /*
     * 60·70만 적은 사람을 보고 "10kg 간격"이라고 하면 틀릴 수 있다 —
     * 5kg 기계에서 한 판씩 올렸을 뿐일 수도 있다.
     */
    assert.equal(learn([60, 70]).stepKg, BASE.stepKg);
    assert.equal(learn([60, 70, 80]).stepKg, 10);
    assert.equal(COARSE_SAMPLES, 3);
  });

  it('100kg 천장을 걷어낸다', () => {
    /*
     * 이게 진짜 버그였다. 머신·케이블은 기본 명세가 102.5kg에서 끝나서,
     * 랫풀다운 120kg을 하는 사람에게 영영 102.5를 처방하고 있었다.
     */
    assert.equal(nearestLoadable(150, BASE), 102.5);
    const learned = learn([110, 120, 130, 150]);
    assert.equal(nearestLoadable(150, learned), 150);
    assert.ok(learned.maxKg >= 150);
  });

  it('올리려는데 내려가지 않는다', () => {
    // 150kg을 적어 둔 사람이 +를 누르면 기본 명세에서는 102.5로 떨어졌다.
    const learned = learn([110, 120, 130, 150]);
    const all = loadableWeights(learned);
    const up = all.filter((weight) => weight > 150)[0];
    assert.ok(up === undefined || up > 150);
    assert.ok(all.includes(150));
  });

  it('아래로도 넓힌다', () => {
    // 2.5kg부터 시작하는 케이블이 있다. 5kg 밑을 못 쓰면 재활이 안 된다.
    const learned = learn([2.5, 5, 7.5]);
    assert.ok(learned.minKg <= 2.5);
    assert.ok(loadableWeights(learned).includes(2.5));
  });

  it('격자에 안 맞는 보조추는 버린다', () => {
    /*
     * 7kg 기계에 2.5kg 보조추를 얹어 두면 7·9.5·14·16.5…가 된다.
     * 들쭉날쭉하고 그 기계가 저런 무게를 만든다는 근거도 없다.
     */
    const learned = learn([49, 56, 63, 70]);
    assert.deepEqual(learned.addOnKg, []);
    assert.ok(!loadableWeights(learned).includes(51.5));
  });

  it('격자에 맞는 보조추는 남긴다', () => {
    /*
     * 5kg 간격에 2.5kg 보조추는 5·7.5·10…을 만든다. 이게 있어야 고립
     * 운동을 2.5kg씩 올릴 수 있다 — 5kg씩 뛰면 너무 크다.
     */
    const learned = learn([40, 45, 50, 55]);
    assert.ok(loadableWeights(learned).includes(47.5));
  });

  it('읽을 것이 없으면 기본값 그대로다', () => {
    assert.equal(learnStack(BASE, null), BASE);
    assert.equal(learnStack(BASE, guessStep([60])), BASE);
  });

  it('배울 것이 없으면 같은 객체를 돌려준다', () => {
    // 쓰는 쪽에서 바뀌었는지 보고 다시 그릴 수 있어야 한다.
    assert.equal(learn([40, 45, 50]), BASE);
  });
});

describe('어느 세트를 보는가', () => {
  const set = (kg: number, over: Record<string, unknown> = {}) =>
    ({ exerciseId: 'lat-pulldown', weightKg: kg, reps: 10, rir: 2, ...over });

  const sessions: SessionLog[] = [
    { date: '2026-09-01', gymId: 'a', sets: [set(40), set(40)] },
    { date: '2026-09-08', gymId: 'a', sets: [set(20, { warmup: true }), set(45)] },
    { date: '2026-09-15', gymId: 'b', sets: [set(60)] },
    { date: '2026-09-22', gymId: 'a', sets: [set(70, { machine: 'b' }), set(50)] },
    { date: '2026-09-29', gymId: 'a', sets: [set(0)] },
  ];

  it('같은 헬스장 · 같은 기계의 본세트만 본다', () => {
    assert.deepEqual(observedWeights(sessions, 'lat-pulldown', 'a'), [40, 45, 50]);
  });

  it('워밍업은 안 본다', () => {
    // 램프는 처방이 만든 숫자라 기계가 만들 수 있는 값인지와 상관이 없다.
    assert.ok(!observedWeights(sessions, 'lat-pulldown', 'a').includes(20));
  });

  it('기계를 나눴으면 그 기계 것만', () => {
    assert.deepEqual(observedWeights(sessions, 'lat-pulldown', 'a', 'b'), [70]);
  });

  it('다른 헬스장은 섞지 않는다', () => {
    assert.deepEqual(observedWeights(sessions, 'lat-pulldown', 'b'), [60]);
  });

  it('0kg은 무게가 아니다', () => {
    assert.ok(!observedWeights(sessions, 'lat-pulldown', 'a').includes(0));
  });

  it('같은 무게를 여러 번 해도 한 번으로 센다', () => {
    assert.equal(observedWeights(sessions, 'lat-pulldown', 'a').filter((w) => w === 40).length, 1);
  });
});
