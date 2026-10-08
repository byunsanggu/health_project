import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { EXERCISES } from '../exercises.ts';
import { SETUP_GUIDE, SETTING_MAX, cleanSetting, hasSetting, settingKey, settingPlaceholder, setupFor } from '../setupGuide.ts';

const byId = (id: string) => EXERCISES.find((item) => item.id === id)!;

describe('사용법', () => {
  it('모든 종목에 할 말이 있다', () => {
    for (const exercise of EXERCISES) {
      assert.ok(setupFor(exercise).length > 0, exercise.id);
    }
  });

  it('표의 열쇠는 전부 실제 종목이다 — 오타면 말이 영영 안 나온다', () => {
    const ids = new Set(EXERCISES.map((item) => item.id));
    for (const id of Object.keys(SETUP_GUIDE)) assert.ok(ids.has(id), id);
  });

  it('두세 마디를 넘지 않는다 — 기계 앞에서 귀로 듣는 말이다', () => {
    for (const [id, steps] of Object.entries(SETUP_GUIDE)) {
      assert.ok(steps.length >= 1 && steps.length <= 3, id);
      for (const step of steps) assert.ok(step.length <= 40, `${id}: ${step}`);
    }
  });

  it('진단처럼 들리는 말을 하지 않는다', () => {
    const all = Object.values(SETUP_GUIDE).flat().join(' ');
    assert.doesNotMatch(all, /디스크|진단|치료|병원|염증/);
  });

  it('어시스트 풀업은 숫자가 클수록 쉽다는 걸 말한다 — 처음 온 사람이 제일 헷갈리는 기계다', () => {
    assert.match(setupFor(byId('assisted-pull-up')).join(' '), /클수록 쉽/);
  });
});

describe('세팅 적어 두기', () => {
  it('머신 · 케이블 · 스미스와 랙 종목만 적는다', () => {
    assert.equal(hasSetting(byId('leg-press')), true);
    assert.equal(hasSetting(byId('lat-pulldown')), true);
    assert.equal(hasSetting(byId('smith-squat')), true);
    assert.equal(hasSetting(byId('back-squat')), true);
    assert.equal(hasSetting(byId('dumbbell-bench-press')), false);
    assert.equal(hasSetting(byId('push-up')), false);
  });

  it('빈칸 예시가 기구에 맞다', () => {
    assert.match(settingPlaceholder(byId('lat-pulldown')), /도르래/);
    assert.match(settingPlaceholder(byId('back-squat')), /랙/);
    assert.match(settingPlaceholder(byId('leg-press')), /시트/);
  });

  it('헬스장 · 종목 · 기계가 다르면 다른 세팅이다', () => {
    assert.notEqual(settingKey('g1', 'leg-press'), settingKey('g2', 'leg-press'));
    assert.notEqual(settingKey('g1', 'leg-press', 'a'), settingKey('g1', 'leg-press', 'b'));
    assert.equal(settingKey('g1', 'leg-press'), settingKey('g1', 'leg-press', 'a'));
  });

  it('공백을 정리하고 길면 자른다', () => {
    assert.equal(cleanSetting('  시트   4  '), '시트 4');
    assert.equal(cleanSetting('가'.repeat(50)).length, SETTING_MAX);
  });
});
