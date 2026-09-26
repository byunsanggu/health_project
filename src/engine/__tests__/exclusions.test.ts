import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  COACH_LOAD_RATIO,
  EXCLUDE_REASONS,
  REVIEW_WEEKS,
  activeExclusions,
  addExclusion,
  coaching,
  describeExclusion,
  dueForReview,
  excludeForever,
  excludedIds,
  keepExcluded,
  removeExclusion,
  replacementFor,
  reasonSpec,
  reviewQuestion,
  type Exclusion,
} from '../exclusions.ts';
import { EXERCISES } from '../exercises.ts';

const byId = new Map(EXERCISES.map((exercise) => [exercise.id, exercise]));
const DEAD = byId.get('conventional-deadlift')!;
const TODAY = '2026-09-26';

const plus = (days: number): string =>
  new Date(Date.parse(`${TODAY}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);

const one = (over: Partial<Exclusion> = {}): Exclusion[] => [{
  exerciseId: DEAD.id, reason: 'dislike', since: TODAY, ...over,
}];

describe('왜 빼는지를 묻는다', () => {
  it('진짜 "빼기"는 네 갈래 중 하나뿐이다', () => {
    /*
     * "싫어요" 하나로 받으면 초보는 해야 할 것을 전부 뺀다. 스쿼트는
     * 힘들어서, 데드는 무서워서, 풀업은 못 해서 — 남는 건 머신 컬이다.
     * 이유를 물으면 셋은 빼는 것보다 나은 길로 간다.
     */
    const routes = EXCLUDE_REASONS.map((spec) => spec.route);
    assert.deepEqual(routes, ['pain', 'equipment', 'coach', 'exclude']);
    assert.equal(routes.filter((route) => route === 'exclude').length, 1);
  });

  it('아파서 뺀 것은 남에게 보내지 않는다', () => {
    // 건강 정보다(개인정보보호법 제23조). 기구 정보와 성격이 다르다.
    assert.equal(reasonSpec('pain').shareable, false);
    assert.equal(reasonSpec('unsure').shareable, false);
    assert.equal(reasonSpec('noEquipment').shareable, true);
  });

  it('"자신 없어요"는 빼지 않는다', () => {
    /*
     * 못 하는 것과 하기 싫은 것은 다르다. 무서워하는 사람에게 필요한 건
     * 안 하는 것이 아니라 가벼운 무게로 여러 번 해 보는 것이다.
     */
    const list = addExclusion([], { exerciseId: DEAD.id, reason: 'unsure', today: TODAY });
    assert.equal(activeExclusions(list, TODAY).length, 0);
    assert.equal(coaching(list, TODAY).length, 1);
    assert.ok(COACH_LOAD_RATIO > 0.4 && COACH_LOAD_RATIO < 0.8);
  });

  it('가르치는 기간이 끝나면 목록에서 빠진다', () => {
    const list = addExclusion([], { exerciseId: DEAD.id, reason: 'unsure', today: TODAY });
    assert.equal(coaching(list, plus(REVIEW_WEEKS * 7)).length, 0);
    // 빠지는 것이지 제외되는 것이 아니다 — 계속 프로그램에 나온다.
    assert.equal(excludedIds(list, plus(REVIEW_WEEKS * 7)).size, 0);
  });
});

describe('기본은 "당분간"이다', () => {
  it('그냥 빼면 4주 뒤에 돌아온다', () => {
    /*
     * 영구를 기본으로 두면 한 번 힘들었던 날의 기분이 프로그램에 영영
     * 남는다. 사람은 바뀐다.
     */
    const list = one();
    assert.equal(activeExclusions(list, plus(1)).length, 1);
    assert.equal(activeExclusions(list, plus(REVIEW_WEEKS * 7)).length, 0);
  });

  it('돌아올 때 슬그머니 돌아오지 않는다', () => {
    // 기간이 끝나면 "다시 여쭤볼 것" 목록에 올라온다.
    const due = dueForReview(one(), plus(REVIEW_WEEKS * 7));
    assert.equal(due.length, 1);
    assert.match(reviewQuestion(due[0]!, DEAD), /다시 해 보시겠어요/);
  });

  it('"계속 빼둘게요"는 4주를 더 준다 — 그리고 또 묻는다', () => {
    /*
     * 한 번 묻고 마는 쪽이 덜 귀찮겠지만, 그러면 화면이 "4주 뒤에 다시
     * 여쭤봅니다"라고 해 놓고 안 묻는 셈이 된다. 어깨는 8주째에 낫기도 한다.
     */
    const kept = keepExcluded(one(), DEAD.id, plus(28));
    assert.equal(dueForReview(kept, plus(29)).length, 0);
    assert.equal(dueForReview(kept, plus(28 + REVIEW_WEEKS * 7)).length, 1);
  });

  it('"다시는 묻지 마세요"를 고르면 다시는 안 묻는다', () => {
    // 계속 묻는 게 싫은 사람에게 길이 있어야, 계속 묻는 것이 정당해진다.
    const never = excludeForever(one(), DEAD.id);
    assert.equal(dueForReview(never, plus(3650)).length, 0);
    assert.equal(activeExclusions(never, plus(3650)).length, 1);
  });

  it('화면에 적은 약속과 실제가 같다', () => {
    /*
     * "4주 뒤에 다시 여쭤봅니다"라고 써 놓고 안 물으면 그건 거짓말이다.
     * 말과 동작이 갈라지면 그때부터 아무것도 안 믿게 된다.
     */
    const list = one();
    assert.match(describeExclusion(list[0]!, TODAY), /다시 여쭤봅니다/);
    assert.equal(dueForReview(list, plus(REVIEW_WEEKS * 7)).length, 1);

    const forever = excludeForever(list, DEAD.id);
    assert.match(describeExclusion(forever[0]!, TODAY), /계속 뺍니다/);
    assert.equal(dueForReview(forever, plus(3650)).length, 0);
  });
});

describe('빠진 자리를 채운다', () => {
  it('대체 종목으로 볼륨을 메운다', () => {
    /*
     * 그냥 빼기만 하면 그 부위 볼륨이 비고, 사용자는 왜 등이 안 크는지
     * 모르게 된다. 빼는 것은 허용하되 프로그램이 망가지지는 않게 한다.
     */
    const result = replacementFor(DEAD);
    assert.ok(result.substitutes.length > 0);
    assert.match(result.text, /대신/);
    assert.doesNotMatch(result.text, /undefined/);
  });

  it('이미 뺀 종목을 대체로 내놓지 않는다', () => {
    const first = replacementFor(DEAD);
    const banned = new Set([DEAD.id, ...first.substitutes.map((item) => item.id)]);
    const second = replacementFor(DEAD, { excluded: banned });
    for (const item of second.substitutes) assert.equal(banned.has(item.id), false);
  });

  it('없으면 없다고 말한다', () => {
    /*
     * 억지로 비슷하지도 않은 종목을 내놓으면 그때부터 아무도 이 목록을
     * 안 믿는다. 볼륨이 준다는 사실을 그대로 말하는 편이 낫다.
     */
    const result = replacementFor(DEAD, { pool: [DEAD] });
    assert.equal(result.substitutes.length, 0);
    assert.match(result.text, /줄어듭니다/);
  });

  it('조사를 규칙대로 붙인다', () => {
    // "데드리프트으로"가 화면에 뜨면 그 앱은 대충 만든 것으로 보인다.
    for (const exercise of EXERCISES.slice(0, 40)) {
      const text = replacementFor(exercise).text;
      assert.doesNotMatch(text, /트으로|스으로|[가-힣]이\(가\)|을\(를\)/, exercise.name);
    }
  });
});

describe('목록 다루기', () => {
  it('같은 종목을 두 번 빼면 덮어쓴다', () => {
    let list = addExclusion([], { exerciseId: DEAD.id, reason: 'dislike', today: TODAY });
    list = addExclusion(list, { exerciseId: DEAD.id, reason: 'pain', today: TODAY, joint: 'lowBack' });
    assert.equal(list.length, 1);
    assert.equal(list[0]?.reason, 'pain');
    assert.equal(list[0]?.joint, 'lowBack');
  });

  it('되돌릴 수 있다', () => {
    // 잘못 눌러서 종목이 사라지고 돌아오지 않으면 사용자는 앱을 못 믿는다.
    const list = removeExclusion(one(), DEAD.id);
    assert.equal(list.length, 0);
  });
});
