import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { applyOrder, isDefaultOrder, moveItem, reviewOrder } from '../reorder.ts';
import { EXERCISES } from '../exercises.ts';
import type { Exercise } from '../types.ts';

const by = (id: string) => EXERCISES.find((exercise) => exercise.id === id) as Exercise;
const order = (...ids: string[]) => ids.map(by).filter(Boolean);

describe('한 칸 옮기기', () => {
  it('원본을 건드리지 않는다', () => {
    const source = ['a', 'b', 'c'];
    moveItem(source, 0, 2);
    assert.deepEqual(source, ['a', 'b', 'c']);
  });

  it('아래로 옮긴다', () => {
    assert.deepEqual(moveItem(['a', 'b', 'c', 'd'], 0, 2), ['b', 'c', 'a', 'd']);
  });

  it('위로 옮긴다', () => {
    assert.deepEqual(moveItem(['a', 'b', 'c', 'd'], 3, 0), ['d', 'a', 'b', 'c']);
  });

  it('범위를 벗어나도 무너지지 않는다', () => {
    // 버튼을 연타하면 끝에서 한 번 더 눌린다. 그대로 두면 된다.
    assert.deepEqual(moveItem(['a', 'b'], 1, 9), ['a', 'b']);
    assert.deepEqual(moveItem(['a', 'b'], 0, -5), ['a', 'b']);
    assert.deepEqual(moveItem(['a', 'b'], 7, 0), ['a', 'b']);
  });
});

describe('순서 판정', () => {
  it('프로그램이 짜 준 기본 순서는 걸리지 않는다', () => {
    /*
     * 이게 제일 중요하다. 앱이 자기 처방에 경고를 띄우면 그 경고는
     * 그때부터 배경 소음이고, 정작 위험할 때 아무도 안 읽는다.
     */
    assert.deepEqual(
      reviewOrder(order('conventional-deadlift', 'front-squat', 'stiff-leg-deadlift', 'leg-press-calf-raise')),
      [],
    );
    assert.deepEqual(
      reviewOrder(order('barbell-bench-press', 'pull-up', 'cable-fly', 'barbell-curl', 'triceps-pushdown')),
      [],
    );
  });

  it('무거운 복합이 여러 개 이어져도 걸리지 않는다', () => {
    // 하체 날은 원래 그렇다. 순번만 보고 경고하면 안 된다.
    assert.deepEqual(reviewOrder(order('conventional-deadlift', 'back-squat', 'stiff-leg-deadlift')), []);
  });

  it('고립 뒤에 허리 부하 큰 복합이 오면 경고한다', () => {
    const issues = reviewOrder(order('barbell-curl', 'conventional-deadlift'));
    assert.equal(issues.length, 1);
    assert.equal(issues[0]!.kind, 'lateHeavy');
    assert.equal(issues[0]!.severity, 'warn');
    assert.equal(issues[0]!.exerciseId, 'conventional-deadlift');
  });

  it('허리가 안 실리는 종목은 고립 뒤에 와도 경고하지 않는다', () => {
    /*
     * 케이블 플라이 다음 벤치프레스는 선피로라는 정상적인 기법이다.
     * 가슴이 지치면 드는 무게가 줄 뿐 다치지 않는다. 허리가 지친
     * 데드리프트와는 다르다.
     */
    const issues = reviewOrder(order('cable-fly', 'barbell-bench-press'));
    assert.equal(issues.every((issue) => issue.severity === 'note'), true);
  });

  it('같은 부위 선피로는 참고로만 알린다', () => {
    const issues = reviewOrder(order('cable-fly', 'barbell-bench-press'));
    const note = issues.find((issue) => issue.kind === 'preExhaust');
    assert.ok(note);
    assert.match(note!.text, /선피로/);
    assert.match(note!.text, /의도한 것이면/);
  });

  it('같은 짝을 두 번 말하지 않는다', () => {
    // 위험하다고 말했으면 선피로 참고는 생략한다.
    const issues = reviewOrder(order('barbell-curl', 'conventional-deadlift'));
    const ids = issues.map((issue) => issue.exerciseId);
    assert.equal(new Set(ids).size, ids.length);
  });

  it('한 부위에 한 번만 말한다', () => {
    const issues = reviewOrder(order('cable-fly', 'barbell-bench-press', 'incline-barbell-press'));
    const notes = issues.filter((issue) => issue.kind === 'preExhaust');
    assert.equal(notes.length, 1);
  });

  it('조사가 부위 이름에 맞는다', () => {
    const issues = reviewOrder(order('cable-fly', 'barbell-bench-press'));
    // "가슴을" — 받침 있는 이름
    assert.match(issues.find((i) => i.kind === 'preExhaust')!.text, /가슴을/);
  });
});

describe('저장한 순서 적용', () => {
  const id = (item: { id: string }) => item.id;

  it('저장한 순서대로 놓는다', () => {
    const items = [{ id: 'b' }, { id: 'c' }, { id: 'a' }];
    assert.deepEqual(applyOrder(items, ['a', 'b', 'c'], id).map(id), ['a', 'b', 'c']);
  });

  it('순서가 없으면 그대로 둔다', () => {
    const items = [{ id: 'b' }, { id: 'a' }];
    assert.deepEqual(applyOrder(items, null, id).map(id), ['b', 'a']);
    assert.deepEqual(applyOrder(items, [], id).map(id), ['b', 'a']);
  });

  it('새로 생긴 종목은 뒤에 붙인다', () => {
    /*
     * 통증이 생기거나 기구를 끄면 종목이 교체된다. 순서를 한 번 바꿨다고
     * 이후의 교체가 막히면 안 된다.
     */
    const items = [{ id: 'b' }, { id: 'x' }, { id: 'a' }];
    assert.deepEqual(applyOrder(items, ['a', 'b', 'c'], id).map(id), ['a', 'b', 'x']);
  });

  it('사라진 종목은 무시한다', () => {
    const items = [{ id: 'c' }, { id: 'a' }];
    assert.deepEqual(applyOrder(items, ['a', 'b', 'c'], id).map(id), ['a', 'c']);
  });

  it('원본을 건드리지 않는다', () => {
    const items = [{ id: 'b' }, { id: 'a' }];
    applyOrder(items, ['a', 'b'], id);
    assert.deepEqual(items.map(id), ['b', 'a']);
  });

  it('기본 순서인지 안다', () => {
    assert.equal(isDefaultOrder(['a', 'b'], ['a', 'b']), true);
    assert.equal(isDefaultOrder(['b', 'a'], ['a', 'b']), false);
    assert.equal(isDefaultOrder(['a'], ['a', 'b']), false);
  });
});
