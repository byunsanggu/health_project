import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  COOLDOWN_SECONDS, MOBILITY_SECONDS, PACE_TOLERANCE_SECONDS, mobilityDoneLine, mobilityFor, mobilityLine, mobilityMinutes, cooldownDoneLine, cooldownFor, cooldownLine,
  paceCheck, restAnnounceLine, restSpoken, timeCheck, transitionLines, trimLine, warmupDoneLine, warmupRestLine, warmupSetLine,
} from '../ptSession.ts';
import { speechSeconds } from '../coach.ts';

const STYLES = ['calm', 'fired', 'data'] as const;
const BANMAL = /(해|가자|버텨|해라|하자|봐|밀어)!/;

describe('워밍업 안내', () => {
  const steps = [{ weightKg: 20, reps: 10, restSeconds: 45 }, { weightKg: 40, reps: 5, restSeconds: 60 }];
  it('첫 세트에 몇 세트인지와 무게 · 개수를 말한다', () => {
    const line = warmupSetLine('calm', '백 스쿼트', 0, steps);
    assert.match(line, /워밍업 2세트/);
    assert.match(line, /20kg 10개/);
  });
  it('마지막 워밍업이라고 말한다', () => {
    assert.match(warmupSetLine('calm', '백 스쿼트', 1, steps), /마지막 워밍업/);
  });
  it('빡세게도 존댓말', () => {
    const said = [warmupSetLine('fired', '백 스쿼트', 0, steps), warmupSetLine('fired', '백 스쿼트', 1, steps),
      warmupRestLine('fired', 45), warmupDoneLine('fired')].join(' ');
    assert.doesNotMatch(said, BANMAL);
  });
});

describe('종목 이동', () => {
  it('다음 종목과 적어 둔 세팅, 이동 시간을 말한다', () => {
    const lines = transitionLines('calm', { nextName: '레그프레스', machineSetting: '시트 4번', seconds: 60 }).join(' ');
    assert.match(lines, /다음은 레그프레스예요/);
    assert.match(lines, /시트 4번이었어요/);
    assert.match(lines, /1분 드릴게요/);
  });
  it('받침에 맞게 말한다', () => {
    assert.match(transitionLines('calm', { nextName: '랫 풀다운', seconds: 75 }).join(' '), /랫 풀다운이에요/);
  });
  it('처음 하는 기구면 세팅부터 보자고 한다', () => {
    assert.match(transitionLines('calm', { nextName: '핵 스쿼트', firstTime: true, seconds: 75 }).join(' '), /세팅부터/);
  });
});

describe('시간 관리', () => {
  const lifts = [
    { name: '백 스쿼트', isolation: false, remainingSets: 3, secondsPerSet: 180 },
    { name: '레그프레스', isolation: false, remainingSets: 3, secondsPerSet: 150 },
    { name: '레그 익스텐션', isolation: true, remainingSets: 3, secondsPerSet: 100 },
    { name: '카프레이즈', isolation: true, remainingSets: 3, secondsPerSet: 90 },
  ];

  it('시간 안에 끝나면 아무것도 줄이지 않는다', () => {
    const result = paceCheck({ elapsedSeconds: 600, plannedSeconds: 50 * 60, lifts });
    assert.deepEqual(result.trims, []);
  });

  it('조금 넘는 건 그냥 간다', () => {
    const total = lifts.reduce((s, l) => s + l.remainingSets * l.secondsPerSet, 0);
    const result = paceCheck({ elapsedSeconds: 0, plannedSeconds: total - PACE_TOLERANCE_SECONDS + 10, lifts });
    assert.deepEqual(result.trims, []);
  });

  it('많이 밀리면 뒤 고립 종목부터 줄이고, 종목은 지우지 않는다', () => {
    const result = paceCheck({ elapsedSeconds: 30 * 60, plannedSeconds: 50 * 60, lifts });
    assert.ok(result.trims.length > 0);
    const byIndex = new Map(result.trims.map((t) => [t.index, t.removeSets]));
    assert.ok((byIndex.get(3) ?? 0) >= (byIndex.get(0) ?? 0), '뒤 · 고립부터');
    for (const [index, remove] of byIndex) {
      const floor = lifts[index]!.isolation ? 1 : 2;
      assert.ok(lifts[index]!.remainingSets - remove >= floor, `${lifts[index]!.name}을 다 지우지 않는다`);
    }
  });

  it('줄였다고 말한다', () => {
    assert.match(trimLine('calm', [{ name: '카프레이즈', sets: 1 }]), /카프레이즈 1세트만/);
  });

  it('절반과 10분 남았을 때 한 번씩만 말한다', () => {
    const planned = 50 * 60;
    const half = timeCheck('calm', { elapsedSeconds: 26 * 60, plannedSeconds: planned, said: [] })!;
    assert.equal(half.key, 'half');
    assert.equal(timeCheck('calm', { elapsedSeconds: 27 * 60, plannedSeconds: planned, said: ['half'] }), null);
    const last = timeCheck('calm', { elapsedSeconds: 41 * 60, plannedSeconds: planned, said: ['half'] })!;
    assert.equal(last.key, 'last10');
    assert.match(last.line, /9분 남았어요/);
    assert.equal(timeCheck('calm', { elapsedSeconds: 42 * 60, plannedSeconds: planned, said: ['half', 'last10'] }), null);
  });
});

describe('마무리 스트레칭', () => {
  it('오늘 쓴 부위부터, 4분 안에, 호흡으로 끝난다', () => {
    const steps = cooldownFor(['quads', 'hamstrings', 'glutes', 'calves', 'abs']);
    assert.equal(steps[0]!.id, 'quad-stand');
    assert.equal(steps[steps.length - 1]!.id, 'breath');
    assert.ok(steps.reduce((s, x) => s + x.seconds, 0) <= COOLDOWN_SECONDS);
  });
  it('상체 날은 상체 스트레칭', () => {
    const ids = cooldownFor(['chest', 'back', 'triceps']).map((s) => s.id);
    assert.ok(ids.includes('chest-doorway') && ids.includes('lat-hang'));
    assert.ok(!ids.includes('quad-stand'));
  });
  it('같은 스트레칭은 한 번만', () => {
    const ids = cooldownFor(['chest', 'frontDelt']).map((s) => s.id);
    assert.equal(new Set(ids).size, ids.length);
  });
  it('말이 짧고 존댓말이다', () => {
    for (const style of STYLES) {
      const steps = cooldownFor(['chest', 'quads']);
      steps.forEach((step, i) => {
        const line = cooldownLine(style, step, i, steps.length);
        assert.ok(speechSeconds(line) < 14, line);
        if (style === 'fired') assert.doesNotMatch(line, BANMAL);
      });
      assert.ok(cooldownDoneLine(style).length > 0);
    }
  });
});

describe('세트 사이 휴식 안내', () => {
  it('쉬는 시간을 트레이너 말로 읽는다', () => {
    assert.equal(restSpoken(40), '40초');
    assert.equal(restSpoken(60), '1분');
    assert.equal(restSpoken(90), '1분 30초');
    assert.equal(restSpoken(152), '2분 30초');
  });

  it('몇 초 쉬고 몇 세트인지 말한다 — 처음 한 번만 더 쉬는 법을 붙인다', () => {
    for (const style of ['calm', 'fired', 'data'] as const) {
      const first = restAnnounceLine(style, { seconds: 90, nextSet: 3, firstTime: true });
      const later = restAnnounceLine(style, { seconds: 40, nextSet: 2 });
      assert.match(first, /1분 30초/);
      assert.match(first, /3세트/);
      assert.match(first, /\+30초/);
      assert.match(later, /40초/);
      assert.doesNotMatch(later, /\+30초/);
    }
  });

  it('빡센 말투도 존댓말이다', () => {
    assert.match(restAnnounceLine('fired', { seconds: 60, nextSet: 2 }), /니다/);
  });
});

describe('몸 풀기', () => {
  const FULL = ['treadmill', 'stationary-bike', 'foam-roller', 'floor', 'resistance-bands'];
  const total = (steps: { seconds: number }[]) => steps.reduce((sum, step) => sum + step.seconds, 0);

  it('러닝머신이 있으면 러닝머신 2분으로 시작한다 — 제자리 걷기는 없다', () => {
    const steps = mobilityFor(['chest', 'frontDelt', 'triceps'], { equipment: FULL });
    assert.equal(steps[0]!.id, 'treadmill-walk');
    assert.ok(!steps.some((step) => step.id === 'march'));
    assert.ok(total(steps) <= MOBILITY_SECONDS && total(steps) >= 200, String(total(steps)));
    assert.equal(new Set(steps.map((step) => step.id)).size, steps.length);
  });

  it('러닝머신이 없으면 사이클, 유산소 기구가 없으면 바로 관절 동작', () => {
    assert.equal(mobilityFor(['quads'], { equipment: ['stationary-bike', 'floor'] })[0]!.id, 'bike-easy');
    const none = mobilityFor(['quads'], { equipment: ['floor'] });
    assert.ok(!['treadmill-walk', 'bike-easy', 'row-easy', 'stairs-easy'].includes(none[0]!.id));
  });

  it('폼롤러가 있으면 오늘 제일 많이 쓸 부위 한두 곳만 굴린다', () => {
    const legs = mobilityFor(['quads', 'glutes', 'hamstrings'], { equipment: FULL });
    const rolls = legs.filter((step) => step.id.startsWith('roll-'));
    assert.ok(rolls.length >= 1 && rolls.length <= 2, String(rolls.length));
    assert.equal(rolls[0]!.id, 'roll-quads');
    assert.ok(!mobilityFor(['quads'], { equipment: ['treadmill', 'floor'] }).some((step) => step.id.startsWith('roll-')));
  });

  it('매트 공간이 없으면 바닥 동작 대신 서서 하는 동작', () => {
    const steps = mobilityFor(['chest', 'back', 'glutes', 'abs'], { equipment: ['treadmill'] });
    assert.ok(!steps.some((step) => step.floor), steps.map((step) => step.id).join(','));
    assert.ok(steps.some((step) => step.id === 'wall-pushup' || step.id === 'standing-rotation'));
  });

  it('대신 동작은 원래 동작을 못 할 때만 — 푸시업과 벽 푸시업을 같이 넣지 않는다', () => {
    const mat = mobilityFor(['chest', 'triceps'], { equipment: FULL }).map((step) => step.id);
    assert.ok(!(mat.includes('pushup-dog') && mat.includes('wall-pushup')));
    const noMat = mobilityFor(['chest', 'triceps'], { equipment: ['treadmill'] }).map((step) => step.id);
    assert.ok(noMat.includes('wall-pushup') && !noMat.includes('pushup-dog'));
  });

  it('기구가 하나도 없어도 3분은 채우고, 첫마디는 실제 길이를 말한다', () => {
    const steps = mobilityFor(['quads', 'glutes'], { equipment: [] });
    assert.ok(total(steps) >= 180, String(total(steps)));
    const minutes = mobilityMinutes(steps);
    assert.match(mobilityLine('calm', steps[0]!, 0, steps.length, minutes), new RegExp(minutes + '분이에요'));
  });

  it('하체 날은 하체 동작, 상체 동작은 넣지 않는다', () => {
    const steps = mobilityFor(['quads', 'glutes', 'hamstrings'], { equipment: FULL });
    assert.ok(steps.some((step) => step.id === 'bw-squat'));
    assert.ok(!steps.some((step) => step.id === 'arm-circle'));
  });

  it('가만히 늘리는 스트레칭이 아니라 움직이는 동작이다 — 마무리 스트레칭과 겹치지 않는다', () => {
    const warm = mobilityFor(['chest', 'back', 'quads', 'hamstrings', 'glutes'], { equipment: FULL }).map((step) => step.id);
    const cool = cooldownFor(['chest', 'back', 'quads', 'hamstrings', 'glutes']).map((step) => step.id);
    assert.equal(warm.filter((id) => cool.includes(id)).length, 0);
  });

  it('첫 동작에 몇 분인지 말하고, 빡센 말투도 존댓말', () => {
    const steps = mobilityFor(['chest'], { equipment: FULL });
    assert.match(mobilityLine('calm', steps[0]!, 0, steps.length), /5분/);
    assert.match(mobilityLine('fired', steps[0]!, 0, steps.length), /니다/);
    assert.match(mobilityDoneLine('fired'), /니다/);
  });
});
