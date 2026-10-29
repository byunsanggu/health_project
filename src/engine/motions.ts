/**
 * 종목별 시연 동작 — 어느 종목이 어떤 동작 · 기구로 보이는지, 어떤 실수를 동작으로 보여 줄 수 있는지.
 *
 * 예전에는 동작 패턴 10개로 묶어 그렸다. 그래서 고립 운동 41개가 전부 "팔꿈치 굽히기"였다
 * (레그 익스텐션도, 레터럴 레이즈도). 이제 종목마다 자기 동작과 기구가 있다.
 */
import type { Exercise } from './types.ts';
import type { Clip } from './motionKit.ts';
import * as L from './motionsLower.ts';
import * as U from './motionsUpper.ts';
import * as C from './motionsCore.ts';

interface Entry {
  make: (fault?: string) => Clip;
  /** 동작으로 보여 줄 수 있는 흔한 실수 (mistakes.ts의 id) */
  faults: readonly string[];
}

const entry = (make: (fault?: string) => Clip, faults: readonly string[] = []): Entry => ({ make, faults });

const MOTIONS: Record<string, Entry> = {
  // 스쿼트
  'back-squat': entry((f) => L.squat('back-squat', 'back', f), ['knee-cave', 'butt-wink', 'heels-up', 'hips-first']),
  'front-squat': entry((f) => L.squat('front-squat', 'front', f), ['elbows-drop', 'knee-cave', 'heels-up']),
  'goblet-squat': entry((f) => L.squat('goblet-squat', 'goblet', f), ['goblet-lean', 'knee-cave', 'heels-up']),
  'smith-squat': entry((f) => L.squat('smith-squat', 'smith', f), ['knee-cave', 'butt-wink', 'heels-up']),
  'hack-squat': entry((f) => L.machineSquat('hack-squat', 'hack', f), ['pad-off', 'knee-cave', 'knee-lock']),
  'v-squat': entry((f) => L.machineSquat('v-squat', 'vSquat', f), ['pad-off', 'knee-cave', 'knee-lock']),
  'pendulum-squat': entry((f) => L.machineSquat('pendulum-squat', 'pendulum', f), ['pad-off', 'knee-cave', 'knee-lock']),
  'belt-squat': entry((f) => L.machineSquat('belt-squat', 'belt', f), ['knee-cave', 'torso-lean', 'heels-up']),
  'leg-press': entry((f) => L.legPress('leg-press', false, f), ['butt-lift', 'knee-lock', 'knee-cave']),
  // 런지
  'bodyweight-reverse-lunge': entry((f) => L.lunge('bodyweight-reverse-lunge', 'reverse', f), ['knee-cave', 'torso-lean']),
  'walking-lunge': entry((f) => L.lunge('walking-lunge', 'walking', f), ['knee-cave', 'torso-lean', 'back-leg']),
  'bulgarian-split-squat': entry((f) => L.lunge('bulgarian-split-squat', 'split', f), ['knee-cave', 'back-leg', 'torso-lean']),
  'step-up': entry((f) => L.lunge('step-up', 'stepUp', f), ['back-leg', 'knee-cave']),
  // 힌지
  'conventional-deadlift': entry((f) => L.deadlift('conventional-deadlift', f), ['round-back', 'bar-away', 'hips-first', 'lean-back']),
  'sumo-deadlift': entry((f) => L.hinge('sumo-deadlift', 'sumo', f), ['round-back', 'knee-cave', 'hips-first']),
  'trap-bar-deadlift': entry((f) => L.hinge('trap-bar-deadlift', 'trap', f), ['round-back', 'hips-first', 'lean-back']),
  'romanian-deadlift': entry((f) => L.hinge('romanian-deadlift', 'rdl', f), ['squatting', 'round-back', 'bar-away', 'too-deep']),
  'stiff-leg-deadlift': entry((f) => L.hinge('stiff-leg-deadlift', 'stiff', f), ['round-back', 'too-deep', 'bar-away']),
  'dumbbell-romanian-deadlift': entry((f) => L.hinge('dumbbell-romanian-deadlift', 'dbRdl', f), ['squatting', 'round-back', 'bar-away', 'too-deep']),
  'good-morning': entry((f) => L.hinge('good-morning', 'goodMorning', f), ['round-back', 'too-deep']),
  'cable-pull-through': entry((f) => L.hinge('cable-pull-through', 'pullThrough', f), ['squatting', 'arms-lift']),
  'kettlebell-swing': entry((f) => L.hinge('kettlebell-swing', 'kbSwing', f), ['squat-swing', 'arms-lift', 'round-back']),
  'hip-thrust': entry((f) => L.hipThrust('hip-thrust', 'barbell', f), ['arch', 'chin-up']),
  'machine-hip-thrust': entry((f) => L.hipThrust('machine-hip-thrust', 'machine', f), ['arch', 'chin-up']),
  'glute-bridge': entry((f) => L.hipThrust('glute-bridge', 'bridge', f)),
  'back-extension': entry((f) => L.backExtension('back-extension', f), ['hyper', 'round-back']),
  'glute-ham-raise': entry((f) => L.gluteHamRaise('glute-ham-raise', f), ['hips-bend']),
  // 하체 기계
  'leg-extension': entry((f) => L.legExtension('leg-extension', f), ['hips-up', 'kick']),
  'lying-leg-curl': entry((f) => L.legCurl('lying-leg-curl', true, f), ['hips-up', 'drop']),
  'seated-leg-curl': entry((f) => L.legCurl('seated-leg-curl', false, f), ['hips-up', 'drop']),
  'standing-calf-raise': entry((f) => L.calfRaise('standing-calf-raise', 'standing', f), ['short-range', 'bounce']),
  'seated-calf-raise': entry((f) => L.calfRaise('seated-calf-raise', 'seated', f), ['short-range', 'bounce']),
  'dumbbell-calf-raise': entry((f) => L.calfRaise('dumbbell-calf-raise', 'dumbbell', f), ['short-range', 'bounce']),
  'leg-press-calf-raise': entry((f) => L.legPress('leg-press-calf-raise', true, f), ['short-range', 'bounce']),
  'machine-hip-abduction': entry((f) => L.hipMachine('machine-hip-abduction', true, f), ['swing']),
  'machine-hip-adduction': entry((f) => L.hipMachine('machine-hip-adduction', false, f), ['swing']),
  'machine-glute-kickback': entry((f) => L.gluteKickback('machine-glute-kickback', f), ['arch']),
  // 가슴 밀기
  'barbell-bench-press': entry((f) => U.press('barbell-bench-press', { implement: 'barbell' }, f), ['shoulders-up', 'butt-off', 'elbow-flare', 'bounce']),
  'dumbbell-bench-press': entry((f) => U.press('dumbbell-bench-press', { implement: 'dumbbell' }, f), ['shoulders-up', 'elbow-flare', 'butt-off']),
  'incline-barbell-press': entry((f) => U.press('incline-barbell-press', { implement: 'barbell', incline: 30 }, f), ['shoulders-up', 'elbow-flare', 'butt-off']),
  'incline-dumbbell-press': entry((f) => U.press('incline-dumbbell-press', { implement: 'dumbbell', incline: 30 }, f), ['shoulders-up', 'elbow-flare', 'butt-off']),
  'decline-barbell-press': entry((f) => U.press('decline-barbell-press', { implement: 'barbell', incline: -15 }, f), ['elbow-flare', 'bounce']),
  'smith-bench-press': entry((f) => U.press('smith-bench-press', { implement: 'smith' }, f), ['shoulders-up', 'elbow-flare', 'butt-off']),
  'close-grip-bench-press': entry((f) => U.press('close-grip-bench-press', { implement: 'barbell', close: true }, f), ['elbow-flare']),
  'floor-press': entry((f) => U.press('floor-press', { implement: 'barbell', floor: true }, f), ['elbow-flare']),
  'dumbbell-floor-press': entry((f) => U.press('dumbbell-floor-press', { implement: 'dumbbell', floor: true }, f), ['elbow-flare', 'bounce']),
  'machine-chest-press': entry((f) => U.machinePress('machine-chest-press', false, f), ['shoulders-roll', 'seat', 'elbow-flare']),
  'machine-incline-chest-press': entry((f) => U.machinePress('machine-incline-chest-press', true, f), ['shoulders-roll', 'seat']),
  'push-up': entry((f) => U.pushUp('push-up', f), ['hips-sag', 'elbow-flare']),
  'chest-dip': entry((f) => U.dip('chest-dip', 'chest', f), ['too-deep', 'shoulders-up']),
  // 어깨 밀기 · 삼두 딥스
  'barbell-overhead-press': entry((f) => U.overheadPress('barbell-overhead-press', 'barbell', f), ['arch', 'bar-forward']),
  'seated-dumbbell-press': entry((f) => U.overheadPress('seated-dumbbell-press', 'dbSeated', f), ['arch', 'half-rep']),
  'standing-dumbbell-press': entry((f) => U.overheadPress('standing-dumbbell-press', 'dbStanding', f), ['arch', 'half-rep']),
  'arnold-press': entry((f) => U.overheadPress('arnold-press', 'arnold', f), ['arch', 'half-rep']),
  'machine-shoulder-press': entry((f) => U.overheadPress('machine-shoulder-press', 'machine', f), ['arch', 'half-rep']),
  'landmine-press': entry((f) => U.landminePress('landmine-press', f), ['arch']),
  'pike-push-up': entry((f) => U.pikePushUp('pike-push-up', f), ['half-rep']),
  'triceps-dip': entry((f) => U.dip('triceps-dip', 'triceps', f), ['lean', 'too-deep']),
  'machine-triceps-dip': entry((f) => U.dip('machine-triceps-dip', 'machine', f), ['lean', 'shoulders-up']),
  // 로우
  'barbell-row': entry((f) => U.row('barbell-row', 'barbell', f), ['stand-up', 'round-back', 'elbow-path']),
  'pendlay-row': entry((f) => U.row('pendlay-row', 'pendlay', f), ['round-back', 'stand-up']),
  'dumbbell-bent-over-row': entry((f) => U.row('dumbbell-bent-over-row', 'dbBent', f), ['stand-up', 'round-back', 'shoulders-up']),
  'one-arm-dumbbell-row': entry((f) => U.row('one-arm-dumbbell-row', 'oneArm', f), ['twist', 'shoulders-up']),
  't-bar-row': entry((f) => U.row('t-bar-row', 'tBar', f), ['stand-up', 'round-back', 'elbow-path']),
  'chest-supported-row': entry((f) => U.row('chest-supported-row', 'chestSupported', f), ['chest-off', 'shoulders-up']),
  'machine-high-row': entry((f) => U.row('machine-high-row', 'machineHigh', f), ['chest-off', 'shoulders-up']),
  'seated-cable-row': entry((f) => U.row('seated-cable-row', 'cableSeated', f), ['rocking', 'shoulders-up', 'arms']),
  'inverted-row': entry((f) => U.row('inverted-row', 'inverted', f), ['hips-sag', 'shoulders-up']),
  // 풀업 · 풀다운
  'pull-up': entry((f) => U.verticalPull('pull-up', 'pullUp', f), ['kip', 'half-rep', 'shoulders-up']),
  'chin-up': entry((f) => U.verticalPull('chin-up', 'chinUp', f), ['kip', 'half-rep', 'shoulders-up']),
  'assisted-pull-up': entry((f) => U.verticalPull('assisted-pull-up', 'assisted', f), ['half-rep', 'shoulders-up']),
  'lat-pulldown': entry((f) => U.verticalPull('lat-pulldown', 'latPulldown', f), ['lean-back', 'arms', 'shoulders-up']),
  'neutral-grip-pulldown': entry((f) => U.verticalPull('neutral-grip-pulldown', 'neutralPulldown', f), ['lean-back', 'arms', 'shoulders-up']),
  'straight-arm-pulldown': entry((f) => U.straightArmPulldown('straight-arm-pulldown', f), ['bend', 'shoulders-up']),
  // 가슴 · 어깨 고립
  'cable-fly': entry((f) => U.fly('cable-fly', 'cable', f), ['arm-angle', 'shoulders-up']),
  'low-to-high-cable-fly': entry((f) => U.fly('low-to-high-cable-fly', 'lowToHigh', f), ['arm-angle', 'shoulders-up']),
  'pec-deck': entry((f) => U.fly('pec-deck', 'pecDeck', f), ['shoulders-up', 'arm-angle']),
  'lateral-raise': entry((f) => U.raise('lateral-raise', 'lateral', f), ['shrug', 'swing', 'too-high']),
  'cable-lateral-raise': entry((f) => U.raise('cable-lateral-raise', 'cableLateral', f), ['shrug', 'swing']),
  'machine-lateral-raise': entry((f) => U.raise('machine-lateral-raise', 'machineLateral', f), ['shrug', 'too-high']),
  'front-raise': entry((f) => U.raise('front-raise', 'front', f), ['swing', 'too-high']),
  'face-pull': entry((f) => U.facePull('face-pull', f), ['too-low', 'traps']),
  'reverse-pec-deck': entry((f) => U.rearDelt('reverse-pec-deck', 'machine', f), ['traps', 'shrug']),
  'machine-rear-delt-raise': entry((f) => U.rearDelt('machine-rear-delt-raise', 'machine', f), ['traps', 'shrug']),
  'cable-rear-delt-fly': entry((f) => U.rearDelt('cable-rear-delt-fly', 'cable', f), ['traps', 'swing']),
  'dumbbell-rear-delt-fly': entry((f) => U.rearDelt('dumbbell-rear-delt-fly', 'dumbbell', f), ['traps', 'swing']),
  'barbell-shrug': entry((f) => U.shrug('barbell-shrug', true, f), ['roll']),
  'dumbbell-shrug': entry((f) => U.shrug('dumbbell-shrug', false, f), ['roll']),
  // 팔
  'barbell-curl': entry((f) => U.curl('barbell-curl', 'barbell', f), ['swing', 'drop', 'elbow-forward']),
  'cable-curl': entry((f) => U.curl('cable-curl', 'cable', f), ['swing', 'elbow-forward']),
  'hammer-curl': entry((f) => U.curl('hammer-curl', 'hammer', f), ['swing', 'drop']),
  'incline-dumbbell-curl': entry((f) => U.curl('incline-dumbbell-curl', 'incline', f), ['elbow-forward', 'drop']),
  'preacher-curl': entry((f) => U.curl('preacher-curl', 'preacher', f), ['bottom-bounce', 'drop']),
  'machine-preacher-curl': entry((f) => U.curl('machine-preacher-curl', 'machinePreacher', f), ['bottom-bounce', 'drop']),
  'concentration-curl': entry((f) => U.curl('concentration-curl', 'concentration', f), ['drop']),
  'wrist-curl': entry((f) => U.wristCurl('wrist-curl', f), ['drop']),
  'triceps-pushdown': entry((f) => U.triceps('triceps-pushdown', 'pushdown', f), ['elbow-move', 'lean']),
  'overhead-cable-extension': entry((f) => U.triceps('overhead-cable-extension', 'overheadCable', f), ['elbow-flare', 'arch']),
  'skull-crusher': entry((f) => U.triceps('skull-crusher', 'skull', f), ['elbow-flare', 'drop']),
  'triceps-kickback': entry((f) => U.triceps('triceps-kickback', 'kickback', f), ['elbow-move', 'drop']),
  'dumbbell-overhead-extension': entry((f) => U.triceps('dumbbell-overhead-extension', 'dbOverhead', f), ['elbow-flare', 'arch']),
  'machine-triceps-extension': entry((f) => U.triceps('machine-triceps-extension', 'machine', f), ['elbow-move', 'elbow-flare']),
  // 코어
  'reverse-crunch': entry((f) => C.crunch('reverse-crunch', 'reverse', f), ['legs-only', 'swing']),
  'cable-crunch': entry((f) => C.crunch('cable-crunch', 'cable', f), ['hips', 'neck']),
  'machine-crunch': entry((f) => C.crunch('machine-crunch', 'machine', f), ['neck', 'hips']),
  'decline-sit-up': entry((f) => C.crunch('decline-sit-up', 'declineSitUp', f), ['neck']),
  'hanging-leg-raise': entry((f) => C.legRaise('hanging-leg-raise', false, f), ['swing', 'legs-only']),
  'captains-chair-knee-raise': entry((f) => C.legRaise('captains-chair-knee-raise', true, f), ['legs-only', 'swing']),
  'plank': entry((f) => C.holdPose('plank', false, f), ['hips-sag', 'hips-high']),
  'side-plank': entry((f) => C.holdPose('side-plank', true, f), ['hips-drop']),
  'ab-wheel-rollout': entry((f) => C.abWheel('ab-wheel-rollout', f), ['hips-sag']),
  'dead-bug': entry((f) => C.deadBug('dead-bug', f), ['back-arch']),
  'torso-rotation': entry((f) => C.torsoRotation('torso-rotation', f), ['swing']),
  'farmers-walk': entry((f) => C.farmersWalk('farmers-walk', f), ['lean']),
};

/** 시연 동작이 있는 종목 id */
export function motionIds(): string[] {
  return Object.keys(MOTIONS);
}

/**
 * 종목의 시연 동작. fault를 주면 그 실수를 하는 동작 — 그 종목이 못 보여 주는 실수면 null.
 */
export function motionFor(exercise: Pick<Exercise, 'id'>, fault?: string): Clip | null {
  const found = MOTIONS[exercise.id];
  if (!found) return null;
  if (fault && !found.faults.includes(fault)) return null;
  return found.make(fault);
}

/** 동작으로 보여 줄 수 있는 실수 id */
export function faultsFor(exercise: Pick<Exercise, 'id'>): readonly string[] {
  return MOTIONS[exercise.id]?.faults ?? [];
}
