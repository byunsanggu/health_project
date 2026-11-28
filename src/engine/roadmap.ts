import { blockStatus, TECHNICAL_ORDER, type TrainingBlock } from './blocks.ts';
import { exerciseById, isTimed } from './exercises.ts';
import { planGoals, type TrainingGoal } from './goals.ts';
import { withParticle } from './korean.ts';
import { LEVEL_LABELS_KO } from './levels.ts';
import type { SessionTemplate } from './session.ts';
import type { TrainingStyle } from './styles.ts';
import type { SessionLog } from './types.ts';

/**
 * 내 프로그램 — 지금 몇 번째 과정의 몇째 주인지, 이 과정이 무엇을 하는지, 다음에 무엇이 바뀌는지.
 *
 * 엔진은 과정(블록)을 몇 주씩 묶어 세트를 늘리고, 마지막에 한 주 덜어내고, 다음 과정에 보조 종목을 바꾼다. 그런데
 * 화면에는 "3주차" 한 단어뿐이라, 사용자는 이게 계획인지 그냥 날짜인지 몰랐다. "체계적으로 하고 있다"는 느낌은
 * 지금 어디에 있고 다음에 뭐가 오는지가 보일 때 생긴다.
 *
 * 말은 쉽게 — 블록 · 메조사이클 · 디로드 같은 말 대신 과정 · 쌓는 주 · 가볍게 하는 주.
 */

export type RoadmapWeekKind = 'start' | 'build' | 'check' | 'deload';

export interface RoadmapWeek {
  week: number;
  kind: RoadmapWeekKind;
  /** 칸 아래 짧은 이름 */
  label: string;
  done: boolean;
  current: boolean;
}

export interface ProgramRoadmap {
  /** "2번째 과정 · 근육 키우기" */
  title: string;
  /** 이 과정이 하는 일 한 줄 */
  purpose: string;
  /** 지금 몇째 주 / 모두 몇 주(가볍게 하는 주 포함) */
  week: number;
  totalWeeks: number;
  weeks: RoadmapWeek[];
  /** 이번 주가 무엇을 하는 주인지 */
  now: string;
  /** 다음에 무엇이 바뀌는지 */
  next: string;
  /** 이번 과정에서 늘어난 메인 종목 — "벤치프레스 60kg × 8회 → 62.5kg × 8회" */
  gains: string[];
}

export interface RoadmapInput {
  block: TrainingBlock;
  today: string;
  goals: readonly TrainingGoal[];
  style: TrainingStyle;
  /** 내 루틴(직접 짠 루틴)인가 — 다음 과정에도 종목이 그대로다 */
  custom?: boolean;
  /** 지금 프로그램 — 메인 종목을 찾는다 */
  templates: readonly SessionTemplate[];
  history: readonly SessionLog[];
  /** 그 헬스장에서 할 수 있는 종목 — 다음에 배울 바벨 종목을 고를 때 */
  availableIds?: Iterable<string>;
}

const STYLE_TITLES: Record<TrainingStyle, string> = {
  hypertrophy: '근육 키우기',
  strength: '근력',
  density: '빡세게',
  peak: '한계 돌파',
  conditioning: '체력',
};

function purposeFor(input: RoadmapInput): { title: string; purpose: string } {
  const plan = planGoals(input.goals);
  const first = input.block.number === 1 && input.block.level === 'beginner';
  if (input.custom) return { title: '내 루틴', purpose: '내 루틴 그대로 하면서 무게와 횟수만 기록을 보고 올립니다.' };
  switch (input.style) {
    case 'strength':
      return { title: '근력', purpose: '적은 횟수로 무겁게 들어 드는 무게 자체를 올립니다. 세트는 적고 쉬는 시간은 깁니다.' };
    case 'peak':
      return { title: '한계 돌파', purpose: '세트를 줄이고 무게를 올려 지금 들 수 있는 최고 무게를 확인합니다.' };
    case 'density':
      return { title: '빡세게', purpose: '쉬는 시간을 줄이고 세트를 늘려 짧게 몰아서 합니다.' };
    case 'conditioning':
      return { title: '체력', purpose: '짧은 휴식으로 여러 번 반복해 숨차는 힘을 올립니다.' };
    default:
      break;
  }
  if (plan.conditioning) return { title: '체력 기르기', purpose: '근력 운동은 큰 운동 위주로 짧게, 뒤에 붙는 마무리 운동으로 체력을 올립니다.' };
  if (plan.goals.length === 1 && plan.primary === 'general') {
    return { title: '건강 유지', purpose: '무리 없는 무게로 전신을 고르게 써서 지금 몸을 지킵니다.' };
  }
  if (plan.cutting) {
    return {
      title: plan.goals.includes('strength') ? '근력 지키며 감량' : '다이어트',
      purpose: '적게 먹는 동안 무게를 낮추지 않고 그대로 들어 근육을 지킵니다. 세트는 중간까지만 늘립니다.',
    };
  }
  if (first) return { title: STYLE_TITLES[input.style], purpose: '자세를 익히면서 가벼운 무게부터 주마다 조금씩 늘립니다.' };
  if (plan.goals.includes('strength')) return { title: '근력', purpose: '자세를 다지면서 메인 종목 무게를 꾸준히 올립니다.' };
  return { title: '근육 키우기', purpose: '알맞은 횟수로 하면서 부위마다 세트를 주마다 조금씩 늘려 근육을 키웁니다.' };
}

function weekKind(week: number, accumulation: number): RoadmapWeekKind {
  if (week > accumulation) return 'deload';
  if (week === 1) return 'start';
  if (week === accumulation) return 'check';
  return 'build';
}

const WEEK_LABELS: Record<RoadmapWeekKind, string> = {
  start: '시작',
  build: '쌓기',
  check: '기록 확인',
  deload: '가볍게',
};

/** 이번 과정에서 처음 한 날과 가장 잘한 날 — 메인 종목만, 무게를 싣는 것만. */
function gainsIn(input: RoadmapInput): string[] {
  const mains = new Set<string>();
  for (const template of input.templates) {
    for (const slot of template.slots) if (slot.role === 'primary') mains.add(slot.exerciseId);
  }
  const lines: { text: string; ratio: number }[] = [];
  for (const id of mains) {
    const exercise = exerciseById(id);
    if (!exercise || isTimed(exercise)) continue;
    type Top = { date: string; weightKg: number; reps: number; score: number };
    let first: Top | null = null as Top | null;
    let best: Top | null = null as Top | null;
    for (const session of input.history) {
      if (session.date < input.block.startedOn || session.date >= input.today) continue;
      for (const set of session.sets) {
        if (set.exerciseId !== id || set.warmup || set.top || set.reps <= 0 || set.weightKg <= 0) continue;
        const item = { date: session.date, weightKg: set.weightKg, reps: set.reps, score: set.weightKg * (1 + set.reps / 30) };
        if (!first || item.date < first.date || (item.date === first.date && item.score > first.score)) first = item;
        if (!best || item.score > best.score) best = item;
      }
    }
    if (!first || !best || best.date === first.date) continue;
    const ratio = best.score / first.score;
    if (ratio < 1.01) continue;
    lines.push({
      text: `${exercise.name} ${first.weightKg}kg × ${first.reps}회 → ${best.weightKg}kg × ${best.reps}회`,
      ratio,
    });
  }
  return lines.sort((a, b) => b.ratio - a.ratio).slice(0, 3).map((line) => line.text);
}

function nextFor(input: RoadmapInput, accumulation: number, deload: boolean): string {
  const { block } = input;
  const nextNumber = block.number + 1;
  const parts: string[] = [];
  if (deload) {
    parts.push(`다음 주부터 ${nextNumber}번째 과정입니다.`);
  } else {
    parts.push(`${accumulation}주를 마치면 한 주 가볍게 하고 ${nextNumber}번째 과정으로 넘어갑니다.`);
  }
  if (input.custom) {
    parts.push('내 루틴은 다음 과정에도 종목이 그대로입니다.');
    return parts.join(' ');
  }
  parts.push('메인 종목은 그대로 두고, 보조 운동 몇 개를 비슷한 다른 운동으로 바꿉니다.');
  if (block.transition) {
    parts.push(`꾸준히 하면 ${LEVEL_LABELS_KO[block.transition.to]} 운동량으로 마저 올라갑니다.`);
  } else if (block.level === 'beginner') {
    const available = input.availableIds ? new Set(input.availableIds) : null;
    const pending = TECHNICAL_ORDER.find((id) => (!available || available.has(id)) && !(block.technicalIntroduced ?? []).includes(id));
    const name = pending ? exerciseById(pending)?.name : undefined;
    parts.push(name
      ? `꾸준히 나오고 기록이 오르면 운동량이 한 단계 올라가고 ${withParticle(name, '을/를')} 새로 배웁니다.`
      : '꾸준히 나오고 기록이 오르면 운동량이 한 단계 올라갑니다.');
  }
  return parts.join(' ');
}

function nowFor(kind: RoadmapWeekKind, week: number, block: TrainingBlock): string {
  switch (kind) {
    case 'start':
      if (block.number === 1 && block.level === 'beginner') {
        return `${week}주차 — 자세를 익히는 주입니다. 무게는 가볍게, 세트마다 힘을 넉넉히 남깁니다.`;
      }
      return block.number === 1
        ? `${week}주차 — 기준을 잡는 주입니다. 맞는 무게를 찾으면서 세트마다 힘을 조금 넉넉히 남깁니다.`
        : `${week}주차 — 다시 시작하는 주입니다. 세트를 처음 양으로 되돌리고 힘을 조금 넉넉히 남깁니다.`;
    case 'build':
      return `${week}주차 — 쌓는 주입니다. 부위마다 세트를 조금씩 늘리고, 남기는 힘을 조금씩 줄입니다.`;
    case 'check':
      return `${week}주차 — 이번 과정에서 가장 힘든 주입니다. 처음보다 얼마나 늘었는지 기록을 확인합니다.`;
    case 'deload':
      return '가볍게 하는 주입니다. 세트를 절반으로 줄여 쌓인 피로를 빼고, 다음 과정을 준비합니다.';
  }
}

/** 지금 프로그램이 어디쯤인지 — 화면에 그대로 쓸 말과 주마다 칸. */
export function programRoadmap(input: RoadmapInput): ProgramRoadmap {
  const status = blockStatus(input.block, input.today);
  const accumulation = status.accumulationWeeks;
  // 피로가 먼저 쌓여 일찍 가볍게 하는 주에 들어갔으면 그 주가 마지막 칸이다
  const early = status.stage === 'deload' && status.weekInBlock <= accumulation;
  const total = early ? status.weekInBlock : accumulation + 1;
  const week = Math.min(Math.max(1, status.weekInBlock), total);
  const deload = status.stage === 'deload' || status.stage === 'done';
  const weeks: RoadmapWeek[] = Array.from({ length: total }, (_, i) => {
    const n = i + 1;
    const kind = early && n === total ? 'deload' : weekKind(n, accumulation);
    return { week: n, kind, label: WEEK_LABELS[kind], done: n < week, current: n === week };
  });
  const current = weeks[week - 1]!;
  const { title, purpose } = purposeFor(input);
  const round = input.block.number === 1 ? '첫' : `${input.block.number}번째`;
  return {
    title: `${round} 과정 · ${title}`,
    purpose,
    week,
    totalWeeks: total,
    weeks,
    now: nowFor(current.kind, week, input.block),
    next: nextFor(input, accumulation, deload),
    gains: gainsIn(input),
  };
}
