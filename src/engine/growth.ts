import { withParticle } from './korean.ts';
import { MUSCLE_GROUPS, MUSCLE_LABELS_KO } from './muscles.ts';
import { addDays, aggregateVolume, sessionsInWeek, type VolumeOptions } from './volume.ts';
import { planWeekSets, templateWeekLogs } from './weekSets.ts';
import type { WeeklyPlan } from './mesocycle.ts';
import type { SessionTemplate } from './session.ts';
import type { Exercise, LandmarksByMuscle, MuscleGroup, SessionLog, TrainingLevel, VolumeLandmark } from './types.ts';

/**
 * 근성장 체크 — "이대로 하면 근육이 크는가"를 부위마다 한 줄로.
 *
 * 앱은 처음부터 부위별 최소 · 적정 · 한계 세트(MEV · MAV · MRV)로 처방했지만, 그걸
 * 화면에 말하지 않아서 "운동량이 충분한지 모르겠다"는 말을 들었다. 여기서는 이번 주
 * 계획(다 했을 때의 유효 세트)을 기준선과 맞대어 본다.
 *
 * 볼륨 탭 · 처방과 같은 셈을 쓴다(aggregateVolume) — 보조로 쓴 근육은 기여한 만큼만.
 * 앞어깨 · 전완 · 복근은 다른 종목에서 저절로 채워지는 부위라 판정에서 뺀다(처음 설정의
 * 안내와 같은 규칙). 최소선의 85%까지는 "충분"으로 본다 — 반올림 차이로 모자라다고 하면
 * 프로그램이 틀린 것처럼 읽힌다.
 */

export type GrowthVerdict = 'short' | 'good' | 'high';

export interface GrowthLine {
  muscle: MuscleGroup;
  label: string;
  /** 이번 주 계획을 다 했을 때의 유효 세트 */
  planned: number;
  /** 이번 주 지금까지 한 유효 세트 */
  done: number;
  landmark: VolumeLandmark;
  verdict: GrowthVerdict;
}

export interface GrowthCheck {
  lines: GrowthLine[];
  /** 충분(good · high) 부위 수 / 판정한 부위 수 */
  enough: number;
  total: number;
  /** 한 줄 결론 */
  headline: string;
  /** 왜 모자란지 · 어떻게 되는지 — 모자란 게 없으면 없다 */
  note: string | null;
}

/** 판정에서 빼는 부위 — 다른 종목에서 저절로 채워지거나 따로 안 해도 되는 곳 */
export const GROWTH_QUIET: ReadonlySet<MuscleGroup> = new Set<MuscleGroup>(['frontDelt', 'forearms', 'abs']);
/** 최소선의 이만큼까지는 충분으로 본다 */
export const GROWTH_TOLERANCE = 0.85;

export interface PlannedWeekInput {
  templates: readonly SessionTemplate[];
  plan: WeeklyPlan;
  index: ReadonlyMap<string, Exercise>;
  landmarks: LandmarksByMuscle;
  history: readonly SessionLog[];
  level?: TrainingLevel;
}

/** 이번 주 계획을 다 했을 때의 기록 — 오늘 화면이 세트를 정하는 것(planWeekSets)과 같은 셈. */
export function plannedWeekLogs(input: PlannedWeekInput): SessionLog[] {
  const lastWeek = input.plan.weekStart ? sessionsInWeek(input.history, addDays(input.plan.weekStart, -1)) : [];
  const sets = planWeekSets({
    templates: input.templates, plan: input.plan, index: input.index, landmarks: input.landmarks, lastWeek, level: input.level,
  });
  return templateWeekLogs(input.templates, sets);
}

export interface GrowthInput {
  planned: readonly SessionLog[];
  done: readonly SessionLog[];
  landmarks: LandmarksByMuscle;
  index: ReadonlyMap<string, Exercise>;
  /** 덜어내는 주 — 일부러 적게 하는 주라 모자라다고 하지 않는다 */
  deload?: boolean;
  volumeOptions?: VolumeOptions;
}

const round1 = (value: number) => Math.round(value * 10) / 10;

export function growthCheck(input: GrowthInput): GrowthCheck {
  const planned = aggregateVolume(input.planned, input.index, input.volumeOptions);
  const done = aggregateVolume(input.done, input.index, input.volumeOptions);
  const lines: GrowthLine[] = [];
  for (const muscle of MUSCLE_GROUPS) {
    const landmark = input.landmarks[muscle];
    if (GROWTH_QUIET.has(muscle) || landmark.mev <= 0) continue;
    const sets = round1(planned[muscle].effectiveSets);
    const verdict: GrowthVerdict = sets < landmark.mev * GROWTH_TOLERANCE ? 'short' : sets > landmark.mrv ? 'high' : 'good';
    lines.push({ muscle, label: MUSCLE_LABELS_KO[muscle], planned: sets, done: round1(done[muscle].effectiveSets), landmark, verdict });
  }
  const short = lines.filter((line) => line.verdict === 'short');
  const high = lines.filter((line) => line.verdict === 'high');
  const enough = lines.length - short.length;

  if (input.deload) {
    return {
      lines, enough, total: lines.length,
      headline: '이번 주는 덜어내는 주 — 일부러 적게 해서 회복합니다',
      note: '쌓인 피로를 빼야 다음 주부터 다시 늘릴 수 있습니다. 근육은 쉬는 동안 큽니다.',
    };
  }
  const named = (list: GrowthLine[]) => list.slice(0, 3).map((line) => line.label).join(' · ') + (list.length > 3 ? ` 외 ${list.length - 3}곳` : '');
  const headline = short.length === 0
    ? `계획대로 하면 ${lines.length}개 부위 모두 근성장 기준을 넘습니다`
    : `계획대로 하면 ${lines.length}개 부위 중 ${enough}곳이 근성장 기준을 넘습니다`;
  const notes: string[] = [];
  if (short.length) notes.push(`${withParticle(named(short), '은/는')} 아직 최소선 아래입니다. 주마다 세트를 늘려 채웁니다.`);
  if (high.length) notes.push(`${withParticle(named(high), '은/는')} 회복 한계보다 많습니다. 다음 주에 줄입니다.`);
  return { lines, enough, total: lines.length, headline, note: notes.length ? notes.join(' ') : null };
}
