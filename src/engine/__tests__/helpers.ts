import { buildExerciseIndex } from '../exercises.ts';
import type { SessionLog, SetLog } from '../types.ts';

export const index = buildExerciseIndex();

/** 같은 세트를 n번 반복한 로그를 만든다. */
export function sets(
  exerciseId: string,
  count: number,
  set: Omit<SetLog, 'exerciseId'>,
): SetLog[] {
  return Array.from({ length: count }, () => ({ exerciseId, ...set }));
}

export function session(date: string, ...setGroups: SetLog[][]): SessionLog {
  return { date, sets: setGroups.flat() };
}
