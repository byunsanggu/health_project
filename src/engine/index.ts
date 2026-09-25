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
export * from './personalization.ts';
export * from './styles.ts';
export * from './intensity.ts';
export * from './conditioning.ts';
export * from './consent.ts';
export * from './exercises.ts';
export * from './demos.ts';
export * from './volume.ts';
export * from './frequency.ts';
export * from './rirCalibration.ts';
export * from './progress.ts';
export * from './summary.ts';
export * from './storage.ts';
export * from './load.ts';
export * from './repmax.ts';
export * from './readiness.ts';
export * from './mesocycle.ts';
export * from './pain.ts';
export * from './gym.ts';
export * from './equipment.ts';
export * from './goals.ts';
export * from './dayChoice.ts';
export * from './comparison.ts';
export * from './reorder.ts';
export * from './streak.ts';
export * from './superset.ts';
export * from './tempo.ts';
export * from './weeklyReport.ts';
export * from './wodLog.ts';
export * from './gymIdentity.ts';
export * from './gymPresets.ts';
export * from './gymWeight.ts';
export * from './gyms.ts';
export * from './strength.ts';
export * from './session.ts';
export * from './schedule.ts';
export * from './rest.ts';
export * from './warmup.ts';
export * from './autoregulation.ts';
export * from './timeBudget.ts';
export * from './occupancy.ts';
export * from './onboarding.ts';
