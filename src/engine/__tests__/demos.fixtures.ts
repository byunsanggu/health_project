import type { MovementPattern } from '../types.ts';

/** 동작 패턴 전체 — 새 패턴이 늘면 여기에 더한다. */
export const MOVEMENT_PATTERNS_OR_EMPTY: MovementPattern[] = [
  'horizontalPush',
  'verticalPush',
  'horizontalPull',
  'verticalPull',
  'squat',
  'hinge',
  'lunge',
  'isolation',
  'carry',
  'core',
];
