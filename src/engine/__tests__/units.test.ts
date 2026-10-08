import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  KG_PER_LB, LB_STEP,
  kgToLb, lbToKg, snapLb, stepLbFromKg, weightLabelIn,
} from '../units.ts';

describe('파운드 기계', () => {
  it('기계에 찍힌 숫자를 그대로 되돌려준다', () => {
    /*
     * 이게 제일 중요하다. 90을 치고 다음에 열었을 때 89.9가 보이면
     * 사용자는 앱이 자기 기록을 건드렸다고 느낀다.
     */
    for (const lb of [5, 10, 20, 45, 50, 55, 65, 90, 100, 135, 180, 250, 300]) {
      assert.equal(kgToLb(lbToKg(lb)), lb, `${lb}lb`);
    }
  });

  it('반 파운드도 지킨다', () => {
    assert.equal(kgToLb(lbToKg(7.5)), 7.5);
    assert.equal(kgToLb(lbToKg(2.5)), 2.5);
  });

  it('정의값으로 바꾼다 — 2.2로 어림하지 않는다', () => {
    assert.equal(KG_PER_LB, 0.45359237);
    // 45lb 바벨 원판은 20.41kg이다. 20.5도 20도 아니다.
    assert.ok(Math.abs(lbToKg(45) - 20.4) < 0.05);
  });

  it('기록은 kg으로 남는다 — 90lb를 90kg으로 적지 않는다', () => {
    /*
     * 안 고치면 실제의 2.2배가 들어간다. 그 종목의 주간 볼륨도, 추정
     * 1RM도, 다른 종목과의 비교도 전부 틀어진다.
     */
    const kg = lbToKg(90);
    assert.ok(kg > 40 && kg < 41, String(kg));
    assert.ok(kg < 90 / 2);
  });
});

describe('파운드로 한 칸 움직이기', () => {
  it('기계에 찍힌 숫자 위에서만 움직인다', () => {
    // kg 격자로 움직이면 45 → 54.9처럼 어긋난 숫자가 나온다.
    let kg = lbToKg(90);
    kg = stepLbFromKg(kg, 1);
    assert.equal(kgToLb(kg), 95);
    kg = stepLbFromKg(kg, 1);
    assert.equal(kgToLb(kg), 100);
    kg = stepLbFromKg(kg, -1);
    assert.equal(kgToLb(kg), 95);
  });

  it('어긋난 값에서 시작해도 격자로 돌아온다', () => {
    // 손으로 92lb를 쳤어도 +를 누르면 95로 간다.
    assert.equal(kgToLb(stepLbFromKg(lbToKg(92), 1)), 95);
    assert.equal(kgToLb(stepLbFromKg(lbToKg(92), -1)), 85);
  });

  it('0 밑으로 내려가지 않는다', () => {
    const bottom = stepLbFromKg(lbToKg(5), -1);
    assert.ok(bottom > 0);
    assert.equal(kgToLb(bottom), LB_STEP);
  });

  it('칸 크기를 바꿀 수 있다', () => {
    assert.equal(kgToLb(stepLbFromKg(lbToKg(90), 1, 10)), 100);
    assert.equal(snapLb(93, 10), 90);
    assert.equal(snapLb(96, 10), 100);
  });
});

describe('화면에 쓰는 말', () => {
  it('단위를 붙여 준다', () => {
    assert.equal(weightLabelIn(lbToKg(90), true), '90lb');
    assert.equal(weightLabelIn(60, false), '60kg');
  });

  it('필요할 때만 소수점', () => {
    assert.equal(weightLabelIn(62.5, false), '62.5kg');
    assert.equal(weightLabelIn(60.0, false), '60kg');
    assert.equal(weightLabelIn(lbToKg(7.5), true), '7.5lb');
  });
});
