import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

describe('실패까지 가는 기법 — 동작 종류로도 막는다', () => {
  it('덤벨 루마니안 · 트랩바 · 케틀벨 스윙 · 불가리안에는 드롭세트 · 레스트포즈 · AMRAP을 붙이지 않는다', async () => {
    const { availableTechniques } = await import('../intensity.ts');
    const { exerciseById } = await import('../exercises.ts');
    for (const id of ['dumbbell-romanian-deadlift', 'trap-bar-deadlift', 'kettlebell-swing', 'bulgarian-split-squat', 'goblet-squat']) {
      const exercise = exerciseById(id)!;
      const list = availableTechniques({ exercise, level: 'advanced', style: 'hypertrophy', isLastSet: true });
      for (const tech of ['dropSet', 'restPause', 'amrapFinisher']) {
        assert.equal(list.find((item) => item.technique.id === tech)!.allowed, false, `${id} ${tech}`);
      }
    }
    // 머신 힙 쓰러스트 · 레그 익스텐션처럼 지쳐도 위험이 적은 종목은 이 이유로 막지 않는다
    for (const id of ['machine-hip-thrust', 'leg-extension']) {
      const list = availableTechniques({ exercise: exerciseById(id)!, level: 'advanced', style: 'hypertrophy', isLastSet: true });
      assert.ok(list.every((item) => !(item.reason || '').startsWith('지쳐서 자세가 무너지면')), id);
    }
  });
});
