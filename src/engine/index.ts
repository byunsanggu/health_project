/**
 * 적응형 볼륨 주기화 트레이닝 엔진.
 *
 * 한 바퀴:
 *   세트 기록(RIR 포함) → aggregateVolume → assessFatigue → planNextWeek → buildSession
 *
 * 모든 함수는 순수 함수다. 저장소/네트워크/UI 의존성이 없어 앱·서버·테스트에서 동일하게 쓴다.
 */
export * from './types.ts';
export * from './korean.ts';
export * from './muscles.ts';
export * from './levels.ts';
export * from './exercises.ts';
export * from './volume.ts';
export * from './frequency.ts';
export * from './load.ts';
export * from './readiness.ts';
export * from './mesocycle.ts';
export * from './pain.ts';
export * from './gym.ts';
export * from './equipment.ts';
export * from './strength.ts';
export * from './session.ts';
export * from './onboarding.ts';
