import type { Exercise, MuscleGroup, SessionLog } from './types.ts';
import type { SessionTemplate } from './session.ts';
import { MUSCLE_LABELS_KO } from './muscles.ts';
import { withParticle } from './korean.ts';

/**
 * 오늘 어느 날을 할 것인가.
 *
 * 프로그램은 상체 A → 하체 A → 상체 B → 하체 B처럼 순환한다. 그런데
 * 현장에서는 순서대로 안 온다 — "오늘 상체 하고 싶다", "어제 못 와서
 * 하체가 밀렸다", "다리가 아직 뻐근하다"가 매주 있다.
 *
 * 순서를 강제하면 사용자는 앱을 무시하고 자기 마음대로 한다. 그러면
 * 기록이 안 남고, 기록이 없으면 볼륨 계산도 처방도 다 틀어진다.
 * 그래서 바꾸는 걸 막지 않는다. 대신 **무엇이 달라지는지 말한다.**
 *
 * 말해야 하는 건 하나다: 그 부위를 마지막으로 언제 했는가. 어제 하체를
 * 했는데 오늘 또 하체를 고르면, 그건 회복이 안 된 상태로 또 때리는
 * 것이다. 막을 일은 아니지만 모르고 하면 안 된다.
 */

/** 이 날이 주로 건드리는 근육. 기여도를 합쳐서 큰 것부터. */
export function templateMuscles(
  template: SessionTemplate,
  exerciseById: (id: string) => Exercise | undefined,
): MuscleGroup[] {
  const totals = new Map<MuscleGroup, number>();
  for (const slot of template.slots) {
    const exercise = exerciseById(slot.exerciseId);
    if (!exercise) continue;
    for (const [muscle, weight] of Object.entries(exercise.contribution)) {
      const key = muscle as MuscleGroup;
      totals.set(key, (totals.get(key) ?? 0) + (weight ?? 0));
    }
  }
  return [...totals.entries()]
    .filter(([, total]) => total >= 1)  // 스치는 정도는 그 날의 부위가 아니다
    .sort((a, b) => b[1] - a[1])
    .map(([muscle]) => muscle);
}

function daysBetween(from: string, to: string): number {
  const a = Date.parse(from + 'T00:00:00Z');
  const b = Date.parse(to + 'T00:00:00Z');
  if (Number.isNaN(a) || Number.isNaN(b)) return Number.POSITIVE_INFINITY;
  return Math.round((b - a) / 86400000);
}

/** 그 근육을 마지막으로 제대로 쓴 게 며칠 전인가. 기록이 없으면 무한대. */
export function daysSinceMuscle(
  muscle: MuscleGroup,
  sessions: readonly SessionLog[],
  today: string,
  exerciseById: (id: string) => Exercise | undefined,
): number {
  let best = Number.POSITIVE_INFINITY;
  for (const session of sessions) {
    const gap = daysBetween(session.date, today);
    if (gap < 0 || gap >= best) continue;
    const touched = session.sets.some((set) => {
      if (set.warmup) return false;
      const exercise = exerciseById(set.exerciseId);
      // 0.5 미만은 보조로 스친 것이다. 그걸로 "어제 했다"고 하면 안 된다.
      return Boolean(exercise && (exercise.contribution[muscle] ?? 0) >= 0.5);
    });
    if (touched) best = gap;
  }
  return best;
}

export type DayReadiness = 'fresh' | 'soon' | 'tired';

export interface DayOption {
  template: SessionTemplate;
  /** 프로그램상 오늘 할 차례인가 */
  scheduled: boolean;
  /** 이 날의 주요 부위 */
  muscles: MuscleGroup[];
  /** 주요 부위를 마지막으로 한 게 며칠 전인가 */
  daysSince: number;
  readiness: DayReadiness;
  /** 사용자에게 그대로 보여줄 한 줄 */
  note: string;
}

/**
 * 회복에 필요한 날.
 *
 * 부위 하나를 제대로 때리면 48시간쯤 걸린다는 게 일반적인 기준이다.
 * 하루 만에 또 하면 회복이 덜 된 상태로 하는 것이고, 그게 반복되면
 * 볼륨은 쌓이는데 성장은 안 나온다.
 *
 * 다만 이건 평균값이고 사람마다 다르다. 그래서 막지 않고 말만 한다 —
 * 실제 회복은 볼륨 게이지와 피로 신호가 따로 재고 있다.
 */
const RECOVERY_DAYS = 2;

export function assessDay(
  template: SessionTemplate,
  options: {
    scheduled: boolean;
    sessions: readonly SessionLog[];
    today: string;
    exerciseById: (id: string) => Exercise | undefined;
  },
): DayOption {
  const muscles = templateMuscles(template, options.exerciseById);

  /*
   * 그 날의 주요 부위 중 가장 최근에 한 것을 본다. 평균을 내면 안 된다 —
   * 하체 날에 종아리는 4일 전, 대퇴사두는 어제라면 문제가 되는 건
   * 대퇴사두다.
   */
  let daysSince = Number.POSITIVE_INFINITY;
  let hottest: MuscleGroup | undefined;
  for (const muscle of muscles.slice(0, 3)) {
    const gap = daysSinceMuscle(muscle, options.sessions, options.today, options.exerciseById);
    if (gap < daysSince) { daysSince = gap; hottest = muscle; }
  }

  let readiness: DayReadiness = 'fresh';
  if (daysSince < RECOVERY_DAYS) readiness = daysSince <= 0 ? 'tired' : 'soon';

  const label = hottest ? MUSCLE_LABELS_KO[hottest] : '';
  let note: string;
  if (!Number.isFinite(daysSince)) {
    note = '아직 기록이 없습니다.';
  } else if (daysSince <= 0) {
    note = `오늘 이미 ${withParticle(label, '을/를')} 했습니다. 같은 부위를 또 하면 회복이 안 됩니다.`;
  } else if (daysSince === 1) {
    note = `어제 ${withParticle(label, '을/를')} 했습니다. 하루로는 회복이 덜 됩니다 — 다른 날을 먼저 하는 게 낫습니다.`;
  } else {
    note = `${label} 마지막 ${daysSince}일 전. 회복됐습니다.`;
  }

  return { template, scheduled: options.scheduled, muscles, daysSince, readiness, note };
}

/**
 * 고를 수 있는 날 전부. 회복된 것이 위로 온다.
 *
 * 순서를 회복순으로 놓는 이유: 사용자가 "오늘 상체"라고 마음먹고 들어와도,
 * 목록 맨 위에 "어제 했습니다"가 붙어 있으면 한 번 더 생각한다. 정렬이
 * 곧 조언이다 — 경고 문구를 읽지 않는 사람에게도 전달된다.
 */
export function dayOptions(
  templates: readonly SessionTemplate[],
  options: {
    scheduledIndex: number;
    sessions: readonly SessionLog[];
    today: string;
    exerciseById: (id: string) => Exercise | undefined;
  },
): DayOption[] {
  const assessed = templates.map((template, index) =>
    assessDay(template, {
      scheduled: index === options.scheduledIndex,
      sessions: options.sessions,
      today: options.today,
      exerciseById: options.exerciseById,
    }),
  );

  const rank: Record<DayReadiness, number> = { fresh: 0, soon: 1, tired: 2 };
  return assessed.sort((a, b) => {
    if (rank[a.readiness] !== rank[b.readiness]) return rank[a.readiness] - rank[b.readiness];
    // 같은 조건이면 원래 차례가 위로 — 이유 없이 프로그램을 흔들지 않는다
    if (a.scheduled !== b.scheduled) return a.scheduled ? -1 : 1;
    return b.daysSince - a.daysSince;
  });
}

/** 순서를 바꿨을 때 건너뛴 날이 어떻게 되는지. */
export function skipNote(from: SessionTemplate, to: SessionTemplate): string {
  if (from.name === to.name) return '';
  return (
    `${withParticle(to.name, '을/를')} 먼저 합니다. ${withParticle(from.name, '은/는')} 없어지지 않고 ` +
    '다음 순서로 밀립니다 — 주간 볼륨은 한 주 전체로 계산하므로 순서가 바뀌어도 목표는 그대로입니다.'
  );
}
