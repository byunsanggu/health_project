import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { EXERCISES } from '../exercises.ts';

/*
 * 촬영본 목록은 사람이 손으로 적는다 — 파일을 넣고 id를 한 줄 추가하는
 * 방식이다. 그래서 오타가 나기 쉽고, 오타가 나면 조용히 아무 일도 일어나지
 * 않는다. 영상을 찍어 넣었는데 화면에 애니메이션이 계속 나오면 원인을
 * 찾는 데 한참 걸린다.
 */
const source = readFileSync(new URL('../../../prototype/demoClips.js', import.meta.url), 'utf8');

interface ClipModule {
  has(id: string): boolean;
  hasMistake(id: string): boolean;
  src(id: string): string | null;
  mistakeSrc(id: string): string | null;
  list(): string[];
  count(): number;
}

function loadClips(): ClipModule {
  const sandbox: { window: Record<string, unknown> } = { window: {} };
  vm.runInNewContext(source, sandbox);
  return sandbox.window.FitDemoClips as ClipModule;
}

describe('촬영본 목록', () => {
  test('적힌 id가 전부 실재하는 종목이다', () => {
    const clips = loadClips();
    const known = new Set(EXERCISES.map((exercise) => exercise.id));
    const unknown = [...clips.list()].filter((id) => !known.has(id));
    assert.deepEqual(unknown, [], `없는 종목 id: ${unknown.join(', ')}`);
  });

  test('아직 안 찍은 종목은 조용히 넘어간다', () => {
    // 빈 목록으로 시작하므로, 없는 id를 물어도 던지지 않아야 한다.
    const clips = loadClips();
    assert.equal(clips.has('back-squat'), clips.list().includes('back-squat'));
    assert.equal(clips.src('존재하지-않는-종목'), null);
    assert.equal(clips.mistakeSrc('존재하지-않는-종목'), null);
    assert.equal(clips.hasMistake('존재하지-않는-종목'), false);
  });

  test('파일 이름 규칙이 문서와 같다', () => {
    /*
     * 가이드에는 demo/<id>.mp4 와 demo/<id>--mistake.mp4 로 적혀 있다.
     * 코드가 다른 이름을 만들면 찍어 넣은 파일이 404가 난다.
     */
    const sandbox: { window: Record<string, unknown> } = { window: {} };
    vm.runInNewContext(
      source.replace('var CLIPS = [];', "var CLIPS = [{ id: 'back-squat', mistake: true }];"),
      sandbox,
    );
    const clips = sandbox.window.FitDemoClips as ClipModule;
    assert.equal(clips.src('back-squat'), 'demo/back-squat.mp4');
    assert.equal(clips.mistakeSrc('back-squat'), 'demo/back-squat--mistake.mp4');
    assert.equal(clips.count(), 1);
  });

  test('실수 컷이 없으면 실수 주소를 주지 않는다', () => {
    // 없는 파일을 가리키면 전환 버튼을 눌렀을 때 화면이 까맣게 된다.
    const sandbox: { window: Record<string, unknown> } = { window: {} };
    vm.runInNewContext(
      source.replace('var CLIPS = [];', "var CLIPS = [{ id: 'back-squat', mistake: false }];"),
      sandbox,
    );
    const clips = sandbox.window.FitDemoClips as ClipModule;
    assert.equal(clips.hasMistake('back-squat'), false);
    assert.equal(clips.mistakeSrc('back-squat'), null);
  });
});
