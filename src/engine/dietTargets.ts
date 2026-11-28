/**
 * 하루 목표 — 칼로리 하나, 단백질 하나.
 *
 * 처음 온 사람이 식단 탭에서 가장 먼저 묻는 것은 "그래서 오늘 얼마나 먹어요?"다. 먹은 것을
 * 적으면 "2,081kcal"가 나오는데, 기준이 없으면 그 숫자는 많은지 적은지 알 수 없다. 그렇다고
 * 키 · 나이 · 활동량을 물어 공식을 돌릴 수는 없다 — 그 셋은 동의받은 항목이 아니다(consent.ts:
 * 식단 기록 동의는 "먹은 음식과 양, 끼니"로 칼로리를 계산하고 "체중 변화와 맞춰 내 유지 칼로리"를
 * 내는 데까지다. 성별은 운동 계획에만 쓰기로 받았다).
 *
 * 그래서 **체중 하나로** 어림하고, 저울과 기록이 모이면 그 사람 몸에 맞춰 고친다.
 *
 *   1. 처음: 체중으로 어림한 유지 칼로리 ± 목표(감량은 주에 체중의 0.5%쯤, 늘리기는 조금 더)
 *   2. 2주 뒤: 체중이 목표대로 안 움직이면 한 번에 150kcal씩(밥 반 공기) 고친다
 *   3. 3주쯤 적고 재면: 먹은 양과 체중 변화로 낸 "내 유지 칼로리"로 바꾼다(foodLog.ts)
 *
 * 그리고 바닥을 둔다. 감량 목표는 하루 1,200kcal(큰 사람은 체중 × 20) 아래로 내려가지 않고,
 * 처음에는 500kcal보다 크게 빼지 않으며, 저울을 보고 고친 뒤에도 주에 체중의 1%(하루 체중 × 11kcal,
 * 많아야 750kcal)를 넘게 빼지 않는다. 숫자가 바닥에 닿으면 더 줄이라고 하지 않고 걷기를 말한다.
 */
import type { BodyGoal, BodyTrend } from './bodyTrend.ts';
import {
  foodById, intakeAverage, isFullDay, minDailyKcal, nutrientsFor,
  type FoodEntry, type MaintenanceEstimate,
} from './foodLog.ts';
import { planMeals, type DayMeals, type DietPrefs, type FoodAvoid, type MealIdea } from './meals.ts';
import { proteinTargetG, type FoodTag } from './protein.ts';

function round50(value: number): number {
  return Math.round(value / 50) * 50;
}

function round5(value: number): number {
  return Math.round(value / 5) * 5;
}

function kcalText(value: number): string {
  return Math.round(value).toLocaleString('ko-KR') + 'kcal';
}

/* ── 체중으로 어림하기 ──────────────────────────── */

/**
 * 체중만으로 어림한 유지 칼로리(하루 kcal).
 *
 * 22 × 체중 + 650 — 키 · 나이 · 성별을 모를 때 남녀 가운데쯤에 맞춘 직선이다. 주 3~4번 운동하는
 * 사람 기준으로 50kg ≈ 1,750, 60kg ≈ 1,950, 70kg ≈ 2,200, 90kg ≈ 2,650. 사람마다 ±10~15%
 * 틀리지만 2주 뒤 저울이 바로잡는다. 120kg 위로는 늘리지 않는다 — 체지방은 근육만큼 칼로리를 쓰지 않는다.
 */
export function startingMaintenance(bodyweightKg: number): number {
  if (!Number.isFinite(bodyweightKg) || bodyweightKg <= 0) return 0;
  return round50(22 * Math.min(bodyweightKg, 120) + 650);
}

/**
 * 목표에 따라 유지량에서 얼마나 빼고 더하는가.
 *
 * 감량: 주에 체중의 0.5%가 빠지는 만큼(체중 × 5.5kcal/일, 7,700kcal = 1kg) — 250~500kcal 사이로.
 *   빠를수록 근육이 같이 빠지고 오래 못 간다. 가벼운 사람(50kg 아래)은 250kcal로 작게 잡는다.
 * 늘리기: 체중 × 3kcal, 200~300kcal 사이. 그보다 많이 먹으면 늘어나는 것의 절반이 지방이다.
 */
export function goalOffset(bodyweightKg: number, goal: BodyGoal): number {
  if (!Number.isFinite(bodyweightKg) || bodyweightKg <= 0) return 0;
  if (goal === 'cut') return -Math.min(500, Math.max(250, round50(bodyweightKg * 5.5)));
  if (goal === 'grow') return Math.min(300, Math.max(200, round50(bodyweightKg * 3)));
  return 0;
}

/**
 * 저울이 목표대로 안 움직일 때 한 번에 고치는 양. 체중으로 어림한 목표에만 쓴다 —
 * 먹은 양과 체중으로 낸 유지 칼로리에는 이미 저울이 들어 있다.
 */
export function trendAdjust(trend: BodyTrend | null | undefined, goal: BodyGoal): number {
  const pace = trend?.pace;
  if (!pace) return 0;
  if (goal === 'cut') {
    if (pace === 'fastDown') return 200;
    if (pace === 'flat' || pace === 'slowUp' || pace === 'up') return -150;
    return 0;
  }
  if (goal === 'grow') {
    if (pace === 'up') return -150;
    if (pace === 'slowUp') return 0;
    return 150;
  }
  if (pace === 'down' || pace === 'fastDown') return 150;
  if (pace === 'slowUp' || pace === 'up') return -150;
  return 0;
}

/* ── 하루 목표 ──────────────────────────────────── */

export type TargetSource = 'weight' | 'log';

export interface DailyTargets {
  /** 하루 칼로리 목표(50 단위) */
  kcal: number;
  /** 단백질(g) — protein.ts와 같은 숫자 */
  protein: number;
  /** 탄수화물(g) — 칼로리에서 단백질 · 지방을 빼고 남은 것 */
  carbs: number;
  /** 지방(g) — 칼로리의 25%, 최소 체중 × 0.6g */
  fat: number;
  /** 기준이 된 유지 칼로리 */
  maintenance: number;
  /** 체중으로 어림했는가, 먹은 양과 체중으로 계산했는가 */
  source: TargetSource;
  /** 목표 때문에 뺀 · 더한 양 */
  offset: number;
  /** 저울을 보고 고친 양(체중 어림일 때만) */
  adjust: number;
  /** 바닥 */
  floor: number;
  /** 바닥에 걸려서 올렸는가 */
  floored: boolean;
  /** 적은 양이 실제보다 적어 보이는가(먹은 양으로 낸 유지량이 체중 어림의 80%도 안 된다) */
  underLogged: boolean;
  /** "자세히"에 쓰는 설명 — 두세 줄 */
  why: string[];
}

export interface TargetInput {
  bodyweightKg: number;
  goal: BodyGoal;
  /** 먹은 양과 체중으로 낸 유지 칼로리(foodLog.maintenanceEstimate). 없으면 체중으로 어림한다 */
  estimate?: MaintenanceEstimate | null;
  /** 체중 추세 — 체중 어림일 때 목표를 고치는 데 쓴다 */
  trend?: BodyTrend | null;
}

export function dailyTargets(input: TargetInput): DailyTargets | null {
  const kg = input.bodyweightKg;
  if (!Number.isFinite(kg) || kg <= 0) return null;
  const goal = input.goal;
  const guess = startingMaintenance(kg);
  const estimate = input.estimate && input.estimate.kcal > 0 ? input.estimate : null;
  const source: TargetSource = estimate ? 'log' : 'weight';
  const maintenance = estimate ? estimate.kcal : guess;
  const offset = goalOffset(kg, goal);
  let adjust = source === 'weight' ? trendAdjust(input.trend, goal) : 0;
  // 고친 뒤에도 주에 체중의 1%보다 빠르게 빼는 숫자는 내지 않는다
  const maxCut = Math.min(750, round50(Math.min(kg, 120) * 11));
  if (offset + adjust < -maxCut) adjust = Math.min(0, -maxCut - offset);
  const floor = minDailyKcal(kg);
  const raw = round50(maintenance + offset + adjust);
  const kcal = Math.max(floor, raw);
  const floored = raw < floor;

  const protein = proteinTargetG(kg, goal);
  const fat = round5(Math.max(0.6 * Math.min(kg, 100), (kcal * 0.25) / 9));
  const carbs = Math.max(0, round5((kcal - protein * 4 - fat * 9) / 4));

  const why: string[] = [];
  const offsetWords = goal === 'cut'
    ? `${-offset}kcal 덜 — 일주일에 체중의 0.5%쯤 빠지는 속도입니다.`
    : goal === 'grow'
      ? `${offset}kcal 더 — 근육이 붙는 만큼만 더합니다.`
      : '그대로 — 지금 몸을 지킵니다.';
  why.push(source === 'log'
    ? `${estimate!.days}일 먹은 양과 체중 변화로 계산한 내 유지 칼로리 ${kcalText(maintenance)}에서 ${offsetWords}`
    : `체중 ${Math.round(kg * 10) / 10}kg으로 어림한 유지 칼로리 ${kcalText(maintenance)}에서 ${offsetWords}`);
  if (adjust !== 0) {
    const size = Math.abs(adjust);
    const reason = goal === 'cut'
      ? (adjust < 0 ? '체중이 2주째 그대로이거나 늘어서' : '너무 빨리 빠져서')
      : goal === 'grow'
        ? (adjust < 0 ? '너무 빨리 늘어서' : '체중이 늘지 않아서')
        : (adjust < 0 ? '조금씩 늘고 있어서' : '조금씩 빠지고 있어서');
    why.push(adjust < 0
      ? `${reason} ${size}kcal 낮췄습니다(밥 반 공기쯤).`
      : `${reason} ${size}kcal 올렸습니다.`);
  }
  if (floored) why.push(`건강하게 빼려면 하루 ${kcalText(floor)} 아래로는 잡지 않습니다.`);
  if (goal === 'cut' && kg < 50) why.push('체중이 가벼운 편이라 감량 폭을 작게 잡았습니다. 빼기보다 근육을 붙이는 쪽이 몸매에 더 큰 차이를 냅니다.');
  if (source === 'weight') why.push('키 · 나이를 묻지 않고 체중으로 어림한 숫자라 ±10% 틀릴 수 있습니다. 3주쯤 적고 재면 내 몸에 맞춰 다시 계산합니다.');
  const underLogged = source === 'log' && maintenance < guess * 0.8;
  if (underLogged) why.push('적은 양이 실제보다 적어 보입니다. 소스 · 음료 · 간식까지 적으면 더 맞습니다.');

  return { kcal, protein, carbs, fat, maintenance, source, offset, adjust, floor, floored, underLogged, why };
}

/* ── 오늘 막대에 쓰는 말 ─────────────────────────── */

/**
 * 칼로리 막대 옆 한마디. 넘어도 빨간 말을 쓰지 않는다 — 하루 넘긴 것은 한 주 평균에서 묻힌다.
 * 혼나려고 적는 사람은 없고, 혼나면 적는 것을 그만둔다.
 */
export function kcalLeftText(eaten: number, target: number): string {
  if (!(target > 0)) return '';
  const left = Math.round(target - eaten);
  if (left > 0) return `${left.toLocaleString('ko-KR')}kcal 남음`;
  if (left > -150) return '목표만큼 드셨습니다';
  return `${(-left).toLocaleString('ko-KR')}kcal 더 — 괜찮습니다, 한 주 평균으로 봅니다`;
}

/* ── 운동하는 날 · 쉬는 날 ───────────────────────── */

/** train: 운동할 날(아직 안 함) · trained: 오늘 운동함 · rest: 쉬는 날 */
export type DayKind = 'train' | 'trained' | 'rest';

/**
 * 날마다 목표를 바꾸지 않는다. 운동한 날 더 먹고 쉬는 날 덜 먹는 계산은 처음 하는 사람에게
 * 지킬 숫자만 늘린다 — 몸이 보는 것은 한 주 평균이다. 대신 **언제** 먹을지를 한 줄로 말한다.
 */
export function dayTip(kind: DayKind, goal: BodyGoal): { label: string; text: string } {
  if (kind === 'rest') {
    return { label: '쉬는 날', text: '목표는 운동하는 날과 같습니다. 근육은 쉬는 동안 자라서 단백질은 오늘도 채웁니다.' };
  }
  if (kind === 'trained') {
    return {
      label: '운동한 날',
      text: goal === 'grow'
        ? '운동 뒤 끼니를 든든히 드세요 — 밥과 단백질을 같이. 목표는 쉬는 날과 같습니다.'
        : '다음 끼니에 단백질을 챙기세요. 목표는 쉬는 날과 같습니다.',
    };
  }
  return {
    label: '운동하는 날',
    text: goal === 'cut'
      ? '운동 전에 굶지 마세요 — 1~2시간 전에 바나나나 밥 조금이면 됩니다. 끝나면 단백질이 든 끼니를.'
      : '운동 1~2시간 전에 밥이나 바나나를 조금, 끝나면 단백질이 든 끼니를 드세요.',
  };
}

/* ── 한 주 점검 ─────────────────────────────────── */

export interface WeeklyCheckIn {
  /** 최근 7일 중 다 적은 날(두 끼 이상 또는 1,000kcal 넘게) */
  days: number;
  avgKcal: number | null;
  avgProtein: number | null;
  /** 바닥보다 적게 먹은 날(다 적은 날만 센다) */
  lowDays: number;
  /** "지난 7일 평균 1,850kcal · 단백질 120g" */
  summary: string | null;
  /** 이번 주에 할 것 한 줄 */
  advice: string;
  tone: 'keep' | 'less' | 'more' | 'wait';
  /** 너무 적게 먹은 날이 있으면 한 줄 */
  care: string | null;
  /** 단백질이 많이 모자라면 한 줄 */
  protein: string | null;
}

export interface CheckInInput {
  entries: readonly FoodEntry[];
  today: string;
  targets: DailyTargets;
  goal: BodyGoal;
  trend?: BodyTrend | null;
}

function dayNumber(date: string): number {
  return Math.round(Date.parse(date + 'T00:00:00Z') / 86400000);
}

/**
 * 한 주 점검 — 먹은 양 · 체중 추세 · 목표를 한 줄로 묶는다.
 *
 * 체중 추세(bodyTrend)는 2주를 봐야 속도를 말한다. 그래서 "2주째 그대로면 150kcal 덜, 아니면
 * 하루 3,000보 더"처럼 **한 번에 한 가지, 작게** 말한다. 바닥에 닿으면 덜 먹으라는 말을 하지 않는다.
 */
export function weeklyCheckIn(input: CheckInInput): WeeklyCheckIn {
  const { targets, goal } = input;
  const avg = intakeAverage(input.entries, input.today, 7);
  const days = avg?.days ?? 0;

  const end = dayNumber(input.today);
  const byDate = new Map<string, FoodEntry[]>();
  for (const entry of input.entries) {
    const gap = end - dayNumber(entry.date);
    if (gap < 0 || gap >= 7) continue;
    const list = byDate.get(entry.date) ?? [];
    list.push(entry);
    byDate.set(entry.date, list);
  }
  // 오늘은 아직 안 끝났다 — 저녁 전에 "적게 먹은 날"로 세지 않는다
  const lowDays = [...byDate.entries()].filter(([date, list]) => date !== input.today && isFullDay(list)
    && list.reduce((sum, entry) => sum + entry.kcal, 0) < targets.floor).length;

  const summary = avg && days >= 1
    ? `지난 7일 평균 ${kcalText(avg.kcal)} · 단백질 ${avg.protein}g (다 적은 ${days}일)`
    : null;
  const care = lowDays >= 2
    ? `${kcalText(targets.floor)}보다 적게 드신 날이 ${lowDays}일입니다. 너무 적게 먹으면 근육이 먼저 빠지고 오래 못 갑니다 — 끼니를 거르지 마세요.`
    : null;
  const proteinGap = avg && days >= 3 ? targets.protein - avg.protein : 0;
  const protein = proteinGap >= Math.max(15, targets.protein * 0.2)
    ? `단백질이 평균 ${Math.round(proteinGap)}g 모자랍니다. 끼니마다 손바닥만 한 고기 · 생선 · 두부 · 계란을 하나씩 더하세요.`
    : null;

  const result = (tone: WeeklyCheckIn['tone'], advice: string): WeeklyCheckIn => ({
    days, avgKcal: avg ? avg.kcal : null, avgProtein: avg ? avg.protein : null,
    lowDays, summary, advice, tone, care, protein,
  });

  const pace = input.trend?.pace ?? null;

  // 너무 빨리 빠지는 것이 무엇보다 먼저다
  if (pace === 'fastDown' && goal !== 'grow') {
    return result('more', targets.source === 'weight' && targets.adjust > 0
      ? `너무 빨리 빠지고 있어 목표를 ${targets.adjust}kcal 올렸습니다. 근육을 지키는 쪽입니다.`
      : '너무 빨리 빠지고 있습니다. 하루 200kcal쯤 더 드세요 — 근육을 지키는 쪽입니다.');
  }

  if (targets.source === 'log') {
    if (days < 3) return result('wait', `${3 - days}일만 더 두 끼 이상 적으면 목표와 비교해 드립니다.`);
    const diff = (avg?.kcal ?? 0) - targets.kcal;
    if (Math.abs(diff) <= 150) return result('keep', '목표 근처로 잘 드시고 있습니다. 이대로 갑니다.');
    if (diff > 0) {
      if (goal === 'grow') return result('keep', '넉넉히 드시고 있습니다. 체중이 너무 빨리 늘면 그때 줄입니다.');
      return result('less', `평균이 목표보다 ${kcalText(round50(diff))} 많습니다. 음료나 간식 하나를 줄이면 맞습니다.`);
    }
    if (goal === 'grow') return result('more', `목표보다 ${kcalText(round50(-diff))} 적게 드십니다. 간식으로 우유 한 컵과 바나나를 더하세요.`);
    return result('more', `목표보다 ${kcalText(round50(-diff))} 적게 드십니다. 너무 적게 먹으면 오래 못 갑니다 — 목표만큼은 드세요.`);
  }

  // 체중으로 어림한 목표 — 저울이 2주 쌓여야 맞는지 안다
  if (!pace) {
    return result('wait', days < 3
      ? '두 끼 이상 적은 날이 3일, 체중이 2주쯤 모이면 먹는 양이 맞는지 점검해 드립니다.'
      : '체중을 2주쯤 재면 이 목표가 맞는지 알려 드립니다. 아침에 한 번이면 됩니다.');
  }

  if (goal === 'cut') {
    if (pace === 'flat') {
      return result('less', targets.floored
        ? '2주째 체중이 그대로지만 더 줄이지 않습니다. 하루 3,000보를 더 걸어 보세요.'
        : '2주째 체중이 그대로라 목표를 150kcal 낮췄습니다(밥 반 공기쯤). 대신 하루 3,000보를 더 걸어도 됩니다.');
    }
    if (pace === 'slowUp' || pace === 'up') {
      return result('less', targets.floored
        ? '감량 중인데 늘고 있습니다. 적지 않은 음료 · 간식이 있는지 보고, 걷기를 늘려 보세요.'
        : '감량 중인데 늘고 있어 목표를 150kcal 낮췄습니다. 적지 않은 음료 · 간식이 있는지도 봐 주세요.');
    }
    return result('keep', pace === 'slowDown'
      ? '느리지만 맞는 방향입니다. 이대로 갑니다 — 느린 쪽이 근육을 지킵니다.'
      : '좋은 속도로 빠지고 있습니다. 지금처럼 갑니다.');
  }

  if (goal === 'grow') {
    if (pace === 'slowUp') return result('keep', '근육으로 늘리기 좋은 속도입니다. 지금처럼 갑니다.');
    if (pace === 'up') return result('less', '너무 빨리 늘어 목표를 150kcal 낮췄습니다. 늘어나는 것의 절반이 지방이 되는 속도입니다.');
    return result('more', '체중이 늘지 않아 목표를 150kcal 올렸습니다 — 우유 한 컵쯤입니다.');
  }

  if (pace === 'down') return result('more', '조금씩 빠지고 있어 목표를 150kcal 올렸습니다.');
  if (pace === 'slowUp' || pace === 'up') return result('less', '조금씩 늘고 있어 목표를 150kcal 낮췄습니다.');
  return result('keep', '잘 유지하고 있습니다. 지금처럼 갑니다.');
}

/* ── 끼니 예시를 칼로리 목표에 맞추기 ─────────────── */

/** 끼니 예시(meals.ts)의 음식 → 음식표 id와 한 번 분량(g). 칼로리를 셀 때만 쓴다 */
const MEAL_FOOD: Readonly<Record<string, readonly [string, number]>> = {
  '계란': ['egg', 50],
  '그릭요거트': ['greek-yogurt', 100],
  '우유': ['milk', 200],
  '두유': ['soy-milk', 200],
  '돼지 목살': ['pork-neck', 100],
  '돼지 앞다리': ['pork-shoulder', 100],
  '소고기': ['beef', 100],
  '닭가슴살': ['chicken-breast', 100],
  '닭다리살': ['chicken-thigh', 100],
  '연어': ['salmon', 100],
  '고등어': ['mackerel', 100],
  '참치캔': ['tuna-can', 100],
  '두부': ['tofu', 150],
  '낫토': ['natto', 50],
  '검은콩': ['black-beans', 30],
  '밥': ['rice', 210],
  '단백질 보충제': ['protein-powder', 30],
};

/** 사 먹는 점심 · 구내식당 한 끼 어림 — 백반 · 국밥 한 그릇이 대개 이쯤이다 */
export const OUTSIDE_MEAL_KCAL = 700;

/** 끼니 예시 한 끼의 칼로리 어림 */
export function mealKcal(idea: MealIdea): number {
  let total = 0;
  let known = false;
  for (const item of idea.items) {
    const ref = MEAL_FOOD[item.food];
    const food = ref ? foodById(ref[0]) : undefined;
    if (!ref || !food || typeof item.servings !== 'number') continue;
    known = true;
    total += nutrientsFor(food.per100, ref[1] * item.servings).kcal;
  }
  return known ? Math.round(total) : OUTSIDE_MEAL_KCAL;
}

export interface FittedMeals {
  day: DayMeals;
  /** 고른 밥 공기 수 */
  rice: number;
  /** 끼니별 칼로리(day.meals와 같은 순서) */
  kcal: number[];
  total: number;
  /** 밥을 늘려도 목표에 한참 못 미치면 한 줄 */
  note: string | null;
}

/**
 * 끼니 예시를 하루 칼로리 목표에 맞춘다 — 단백질 주재료는 그대로, 밥만 반 공기 단위로.
 *
 * 줄이는 것은 늘 밥이다(단백질은 줄이지 않는다 · meals.ts의 portionAdvice와 같은 원칙).
 * 밥은 반 공기에서 감량은 한 공기, 유지는 한 공기 반, 늘리기는 두 공기까지. 그래도 모자라면 간식으로
 * 채우라고 말한다.
 */
export function fitMealsToTarget(input: {
  perMeal: number; prefs?: DietPrefs; date: string; goal: BodyGoal; kcal: number;
}): FittedMeals {
  let best: FittedMeals | null = null;
  // 감량 중에 "밥 한 공기 반"을 보여 주면 그 카드는 안 믿는다. 감량은 한 공기까지, 두 공기는 늘릴 때만
  const options = input.goal === 'cut' ? [0.5, 1] : input.goal === 'grow' ? [0.5, 1, 1.5, 2] : [0.5, 1, 1.5];
  for (const rice of options) {
    const day = planMeals({ perMeal: input.perMeal, prefs: input.prefs, date: input.date, goal: input.goal, rice });
    const kcal = day.meals.map(mealKcal);
    const total = kcal.reduce((sum, value) => sum + value, 0);
    const fitted: FittedMeals = { day, rice, kcal, total, note: null };
    if (!best || Math.abs(total - input.kcal) < Math.abs(best.total - input.kcal)) best = fitted;
  }
  const result = best!;
  const short = input.kcal - result.total;
  if (input.goal === 'cut') {
    // 감량 중에는 모자라는 것을 채우라고 다그치지 않는다 — 다만 굶으라는 말로 읽히지 않게, 간식도 목표 안이라고 말한다
    if (short >= 400 && result.day.meals.length > 0) {
      result.note = `이대로면 목표보다 ${kcalText(round50(short))}쯤 적습니다. 배고프면 간식을 한 번 더 드셔도 목표 안입니다.`;
    }
  } else if (short >= 250 && result.day.meals.length > 0) {
    result.note = `이대로면 목표보다 ${kcalText(round50(short))}쯤 적습니다. ` + (short >= 500
      ? '간식을 하루 두 번 드세요 — 바나나와 우유 한 컵, 견과 한 줌, 고구마 하나 같은 것으로.'
      : '간식으로 바나나와 우유 한 컵, 견과 한 줌을 더하세요.');
  }
  return result;
}

/* ── 바꿔 먹기 ──────────────────────────────────── */

interface Swap {
  /** 이 음식들을 자주 먹으면 꺼낸다 */
  from: readonly string[];
  text: string;
  /** 제안에 들어간 재료 — 못 먹는 것이면 건너뛴다 */
  needs?: readonly FoodTag[];
  /** 이것을 못 먹을 때만 꺼내는 대안(우유 대신 두유) */
  onlyIf?: FoodTag;
}

/*
 * 혼내지 않는다. "먹지 마세요"가 아니라 **같은 자리에 올 수 있는 다른 것**을 말한다.
 * 한 줄에 하나, 사 먹을 수 있는 것으로.
 */
const CUT_SWAPS: readonly Swap[] = [
  { from: ['ramen', 'cup-ramen', 'buldak', 'jjapaghetti'], text: '라면 대신 삼각김밥 하나와 삶은 계란 2개', needs: ['egg'] },
  { from: ['jeyuk-rice', 'jeyuk', 'bulgogi-rice'], text: '덮밥은 정식으로 시키고 밥은 반 공기만', needs: [] },
  { from: ['fried-chicken', 'sauced-chicken', 'dakgangjeong'], text: '치킨은 양념보다 후라이드나 구운 치킨, 반 마리까지', needs: ['chicken'] },
  { from: ['pork-belly', 'gopchang', 'makchang'], text: '삼겹살 대신 목살이나 앞다리살, 쌈 채소는 넉넉히', needs: ['pork'] },
  { from: ['latte', 'mocha', 'bubble-tea', 'flavored-milk', 'banana-milk', 'mix-coffee'], text: '달달한 커피 대신 아메리카노, 라떼라면 작은 걸로', needs: [] },
  { from: ['soda', 'iced-tea', 'orange-juice', 'sports-drink', 'energy-drink', 'energy-drink-large', 'sikhye', 'smoothie'], text: '콜라 · 주스 대신 제로 음료나 탄산수', needs: [] },
  { from: ['beer', 'soju', 'somaek', 'makgeolli', 'wine', 'highball'], text: '술은 한 번에 두 잔까지, 안주는 두부김치나 회처럼 단백질로', needs: [] },
  { from: ['tteokbokki', 'sundae', 'fish-cake', 'jeon'], text: '떡볶이는 반 인분에 삶은 계란 하나 더', needs: ['egg'] },
  { from: ['sweet-bread', 'cake', 'donut', 'chips', 'chocolate', 'croffle', 'macaron', 'fat-macaron', 'ice-cream', 'hotteok', 'bungeoppang', 'yakgwa', 'jelly', 'tanghulu'], text: '빵 · 과자 대신 바나나나 그릭요거트', needs: [] },
  { from: ['jjajangmyeon', 'jjamppong', 'tangsuyuk', 'guobaorou'], text: '짜장면은 곱빼기 말고 보통으로, 탕수육은 몇 조각만', needs: [] },
  { from: ['donkatsu', 'burger', 'pizza', 'fries'], text: '돈가스 · 버거 대신 생선구이 백반이나 제육 정식', needs: ['seafood'] },
  { from: ['kimchi-fried-rice', 'omurice', 'curry-rice', 'cup-rice', 'lunchbox'], text: '볶음밥 · 컵밥 대신 닭가슴살 볶음밥이나 김밥 한 줄', needs: ['chicken'] },
];

const CUT_GENERIC: readonly Swap[] = [
  { from: [], text: '점심: 제육덮밥 대신 제육 정식에 밥 반 공기', needs: ['pork'] },
  { from: [], text: '간식: 과자 대신 바나나나 그릭요거트', needs: [] },
  { from: [], text: '음료: 라떼 대신 아메리카노', needs: [] },
  { from: [], text: '점심: 사 먹을 땐 국밥 · 백반처럼 고기나 생선이 보이는 메뉴', needs: [] },
];

const GROW_GENERIC: readonly Swap[] = [
  { from: [], text: '간식: 우유 한 컵과 바나나를 하루 한 번 더', needs: ['dairy'] },
  { from: [], text: '간식: 두유 한 팩과 바나나를 하루 한 번 더', needs: ['soy'], onlyIf: 'dairy' },
  { from: [], text: '저녁: 밥을 한 공기 반으로', needs: [] },
  { from: [], text: '아침: 거르지 말고 계란 2개와 밥 반 공기', needs: ['egg'] },
  { from: [], text: '아침: 거르지 말고 두부 반 모와 밥 반 공기', needs: ['soy'], onlyIf: 'egg' },
];

const HOLD_GENERIC: readonly Swap[] = [
  { from: [], text: '한 끼에 고기 · 생선 · 두부 하나, 밥 한 공기, 채소 한 접시', needs: [] },
  { from: [], text: '간식은 과일이나 요거트로', needs: [] },
  { from: [], text: '술 마신 다음 날은 국물보다 단백질 위주로', needs: [] },
];

function blockedTags(avoid: readonly FoodAvoid[]): Set<FoodTag> {
  const tags = new Set<FoodTag>();
  for (const item of avoid) {
    if (item === 'vegetarian') {
      tags.add('pork'); tags.add('beef'); tags.add('chicken'); tags.add('seafood');
    } else {
      tags.add(item);
    }
  }
  return tags;
}

/**
 * 목표에 맞는 바꿔 먹기 두 줄.
 *
 * 최근 2주에 두 번 넘게 적은 음식이 있으면 그것부터(감량 · 유지일 때) — 남의 식단이 아니라
 * 내가 실제로 먹는 것을 말해야 쓴다. 없으면 목표별 흔한 것으로 채운다.
 */
export function swapIdeas(input: {
  entries?: readonly FoodEntry[]; goal: BodyGoal; today: string; avoid?: readonly FoodAvoid[]; limit?: number;
}): string[] {
  const limit = input.limit ?? 2;
  const blocked = blockedTags(input.avoid ?? []);
  const ok = (swap: Swap) => !(swap.needs ?? []).some((tag) => blocked.has(tag))
    && (!swap.onlyIf || blocked.has(swap.onlyIf));
  const out: string[] = [];

  if (input.goal !== 'grow' && input.entries && input.entries.length) {
    const end = dayNumber(input.today);
    const count = new Map<string, number>();
    for (const entry of input.entries) {
      const gap = end - dayNumber(entry.date);
      if (gap < 0 || gap >= 14 || !entry.foodId) continue;
      count.set(entry.foodId, (count.get(entry.foodId) ?? 0) + 1);
    }
    const ranked = CUT_SWAPS
      .map((swap) => ({ swap, score: swap.from.reduce((sum, id) => sum + (count.get(id) ?? 0), 0) }))
      .filter((row) => row.score >= 2 && ok(row.swap))
      .sort((a, b) => b.score - a.score);
    for (const row of ranked) {
      if (out.length >= limit) break;
      out.push(row.swap.text);
    }
  }

  const generic = input.goal === 'cut' ? CUT_GENERIC : input.goal === 'grow' ? GROW_GENERIC : HOLD_GENERIC;
  for (const swap of generic) {
    if (out.length >= limit) break;
    if (ok(swap) && !out.includes(swap.text)) out.push(swap.text);
  }
  return out;
}

/* ── 처음 적는 사람에게 ──────────────────────────── */

/**
 * 아직 적은 것이 없을 때 보여 주는 칩 — 끼니마다 흔한 것 여섯.
 *
 * "자주 먹는 것"은 적은 것이 쌓여야 생긴다. 첫날은 빈 칸이라 첫 기록이 가장 느리다 — 그 첫 기록을
 * 한 번 누르는 것으로 만든다. 글은 parseFoodText가 읽는 그대로의 말이다.
 */
const STARTERS: Readonly<Record<'breakfast' | 'lunch' | 'dinner' | 'snack', readonly string[]>> = {
  breakfast: ['계란 2개', '바나나 1개', '그릭요거트 1개', '식빵 2장', '고구마 1개', '아메리카노 1잔'],
  lunch: ['쌀밥 1공기', '김치찌개 1인분', '제육볶음 1인분', '김밥 1줄', '닭가슴살 1개', '편의점 샐러드 1개'],
  dinner: ['쌀밥 1공기', '된장찌개 1인분', '닭가슴살 1개', '계란 2개', '삼겹살 1인분', '김치 1접시'],
  snack: ['바나나 1개', '삶은 계란 2개', '단백질 음료 1병', '그릭요거트 1개', '아메리카노 1잔', '아몬드 1줌'],
};

export function starterFoods(meal: 'breakfast' | 'lunch' | 'dinner' | 'snack'): readonly string[] {
  return STARTERS[meal] ?? STARTERS.snack;
}
