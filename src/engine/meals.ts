/**
 * 끼니 — 사람마다 다르게.
 *
 * 식단은 사람마다 다르다. 못 먹는 것이 다르고, 쓸 수 있는 돈이 다르고,
 * 평일 점심을 어디서 먹는지가 다르다. 한 장짜리 예시를 모두에게 보여
 * 주면 계란 알레르기인 사람은 그 카드를 통째로 버린다.
 *
 * 그래도 **칼로리는 정하지 않는다.** 공식으로 낸 하루 칼로리는 ±10~20%
 * 틀리고, 숫자를 받은 사람은 그보다 덜 먹으려 한다. 대신 저울이 말하는
 * 대로 **지금 먹는 양에서 얼마나 바꿀지**를 말한다 — "저녁 밥을 반
 * 공기로". 잘하는 트레이너가 실제로 하는 방식이다.
 */
import type { BodyGoal, BodyTrend } from './bodyTrend.ts';
import { PROTEIN_FOODS, type FoodTag, type ProteinFood } from './protein.ts';

/* ── 고르는 것 ─────────────────────────────────── */

/** 못 먹는 것. 채식은 고기·생선을 한 번에 거른다. */
export type FoodAvoid = 'egg' | 'dairy' | 'seafood' | 'pork' | 'beef' | 'vegetarian';

export const FOOD_AVOID_OPTIONS: readonly { id: FoodAvoid; label: string; hint?: string }[] = [
  { id: 'egg', label: '계란' },
  { id: 'dairy', label: '우유·유제품', hint: '유당불내증 포함' },
  { id: 'seafood', label: '해산물' },
  { id: 'pork', label: '돼지고기' },
  { id: 'beef', label: '소고기' },
  { id: 'vegetarian', label: '채식', hint: '고기·생선을 안 먹습니다 (계란·우유는 따로 고릅니다)' },
];

export type Budget = 'save' | 'normal' | 'free';

export const BUDGET_OPTIONS: readonly { id: Budget; label: string; hint: string }[] = [
  { id: 'save', label: '아끼기', hint: '계란·두부·닭가슴살처럼 단백질 값이 싼 것 위주' },
  { id: 'normal', label: '보통', hint: '싼 것과 보통인 것을 섞어서' },
  { id: 'free', label: '신경 안 씀', hint: '연어·소고기도 넣어서 다양하게' },
];

/**
 * 평일 점심을 어디서 먹는가.
 *
 * 직장인은 점심을 고르지 못한다. 회사 앞 식당이거나 구내식당이다. 그런
 * 사람에게 "돼지 목살 150g + 두부 반 모"를 보여 주는 건 쓸모가 없다 —
 * 필요한 건 **"사 먹을 때 무엇을 고르느냐"**다.
 */
export type LunchMode = 'cook' | 'cafeteria' | 'out';

export const LUNCH_OPTIONS: readonly { id: LunchMode; label: string; hint: string }[] = [
  { id: 'cook', label: '싸 가거나 집에서', hint: '재료로 보여 드립니다' },
  { id: 'cafeteria', label: '구내식당', hint: '메뉴를 못 고르니 담는 법을 알려 드립니다' },
  { id: 'out', label: '사 먹어요', hint: '회사 앞 식당·편의점에서 고르는 법' },
];

export interface DietPrefs {
  avoid: readonly FoodAvoid[];
  budget: Budget;
  /** 평일 점심 */
  lunch: LunchMode;
}

export const DEFAULT_DIET: DietPrefs = { avoid: [], budget: 'normal', lunch: 'cook' };

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

function food(name: string): ProteinFood {
  const found = PROTEIN_FOODS.find((item) => item.name === name);
  if (!found) throw new Error('음식표에 없는 음식: ' + name);
  return found;
}

function allowedFood(name: string, blocked: Set<FoodTag>): boolean {
  return !(food(name).tags ?? []).some((tag) => blocked.has(tag));
}

/* ── 집에서 먹는 끼니 ──────────────────────────── */

interface MealOption {
  main: string;
  /** 주재료 상한 — 한 끼에 닭가슴살 네 덩이는 먹는 게 아니라 버티는 것이다 */
  maxMain: number;
  sides: readonly (readonly [string, number])[];
}

/*
 * 순서가 곧 추천 순서다. 예산이 넉넉하면 앞에서부터, 아끼면 싼 순서로
 * 다시 세운다. 어떤 조합을 걸러도 끼니마다 콩·두부 쪽 하나는 남게 둔다 —
 * 계란·우유·고기를 다 못 먹는 사람에게도 빈 끼니가 나오면 안 된다.
 */
const BREAKFAST: readonly MealOption[] = [
  { main: '계란', maxMain: 4, sides: [['그릭요거트', 1], ['우유', 1]] },
  { main: '계란', maxMain: 4, sides: [['우유', 1]] },
  { main: '그릭요거트', maxMain: 2, sides: [['검은콩', 1]] },
  { main: '계란', maxMain: 4, sides: [['두유', 1]] },
  { main: '두부', maxMain: 2, sides: [['두유', 1]] },
];

const LUNCH_COOK: readonly MealOption[] = [
  { main: '돼지 목살', maxMain: 2, sides: [['밥', 1], ['두부', 1]] },
  { main: '고등어', maxMain: 2, sides: [['밥', 1], ['두부', 1]] },
  { main: '소고기', maxMain: 2, sides: [['밥', 1], ['두부', 1]] },
  { main: '돼지 앞다리', maxMain: 2, sides: [['밥', 1], ['계란', 1]] },
  { main: '닭다리살', maxMain: 2, sides: [['밥', 1], ['두부', 1]] },
  { main: '두부', maxMain: 3, sides: [['밥', 1], ['검은콩', 1]] },
];

const DINNER: readonly MealOption[] = [
  { main: '닭가슴살', maxMain: 2.5, sides: [['밥', 1], ['계란', 1]] },
  { main: '연어', maxMain: 2, sides: [['밥', 1], ['두부', 1]] },
  { main: '닭다리살', maxMain: 2, sides: [['밥', 1], ['두부', 1]] },
  { main: '참치캔', maxMain: 2, sides: [['밥', 1], ['두부', 1]] },
  { main: '소고기', maxMain: 2, sides: [['밥', 1], ['계란', 1]] },
  { main: '두부', maxMain: 3, sides: [['밥', 1], ['낫토', 1]] },
];

/** 간식은 양을 바꾸지 않는다. 세 끼로 모자란 날 채우는 자리다. */
const SNACKS: readonly (readonly (readonly [string, number])[])[] = [
  [['단백질 보충제', 1], ['우유', 1]],
  [['계란', 2], ['두유', 1]],
  [['그릭요거트', 1], ['우유', 1]],
  [['두유', 1], ['검은콩', 1]],
];

function optionAllowed(option: MealOption, blocked: Set<FoodTag>): boolean {
  return allowedFood(option.main, blocked) && option.sides.every(([name]) => allowedFood(name, blocked));
}

/** 이 조합이 비싼 편인가. 주재료를 두 배로 친다 — 값은 주재료가 정한다. */
function costOf(option: MealOption): number {
  const main = (food(option.main).cost ?? 2) * 2;
  const sides = option.sides.reduce((sum, [name]) => sum + (food(name).cost ?? 2), 0);
  return (main + sides) / (2 + option.sides.length);
}

/**
 * 예산에 맞춰 후보를 세운다.
 *
 * 아끼면 싼 것 둘 중에서 돌린다. 보통이면 비싼 것(3)을 빼고 셋 중에서.
 * 신경 안 쓰면 추천 순서 그대로 셋 중에서. **날마다 돌린다** — 매일 같은
 * 저녁을 보여 주면 사흘째부터 안 본다.
 */
function candidates(options: readonly MealOption[], blocked: Set<FoodTag>, budget: Budget): MealOption[] {
  const allowed = options.filter((option) => optionAllowed(option, blocked));
  if (budget === 'save') {
    return [...allowed].sort((a, b) => costOf(a) - costOf(b)).slice(0, 2);
  }
  if (budget === 'normal') {
    const cheapEnough = allowed.filter((option) => (food(option.main).cost ?? 2) <= 2);
    return (cheapEnough.length > 0 ? cheapEnough : allowed).slice(0, 3);
  }
  return allowed.slice(0, 3);
}

export interface MealItem {
  food: string;
  /** "1.5덩이", "150g", "3개" */
  amount: string;
  gram: number;
}

export interface MealIdea {
  meal: '아침' | '점심' | '저녁' | '간식';
  items: MealItem[];
  /** 이 끼니의 단백질(g) */
  gram: number;
  /** 한 줄 조언 — 주문 팁, 담는 법 */
  note?: string;
  /** 같은 자리에 올 수 있는 다른 메뉴 */
  options?: string[];
}

/** 몇 번 분량을 사람이 읽는 말로. 음식마다 세는 단위가 다르다. */
function amountOf(name: string, servings: number): string {
  const n = Math.round(servings * 2) / 2;
  switch (name) {
    case '계란': return `${n}개`;
    case '닭가슴살': return `${n}덩이`;
    case '돼지 목살':
    case '돼지 앞다리':
    case '닭다리살':
    case '연어':
    case '소고기': return `${Math.round(n * 100)}g`;
    case '두부': return n === 1 ? '반 모' : n === 2 ? '한 모' : `${n / 2}모`;
    case '밥': return n === 1 ? '한 공기' : `${n}공기`;
    case '우유':
    case '두유': return `${Math.round(n * 200)}ml`;
    case '그릭요거트': return `${n}개`;
    case '단백질 보충제': return `${n}스쿱`;
    case '고등어': return `${n}토막`;
    case '참치캔': return `${n}캔`;
    case '낫토': return `${n}팩`;
    case '검은콩': return n === 1 ? '한 줌' : `${n}줌`;
    default: return `${n}`;
  }
}

function item(name: string, servings: number): MealItem {
  return { food: name, amount: amountOf(name, servings), gram: Math.round(food(name).gram * servings) };
}

/** 주재료 양만 목표에 맞춘다. 0.5 단위 — "계란 2.7개"는 지킬 수 없는 말이다. */
function buildMeal(meal: MealIdea['meal'], option: MealOption, perMeal: number): MealIdea {
  const sides = option.sides.map(([name, servings]) => item(name, servings));
  const sideGram = sides.reduce((sum, one) => sum + one.gram, 0);
  const raw = (perMeal - sideGram) / food(option.main).gram;
  const servings = Math.min(option.maxMain, Math.max(1, Math.round(raw * 2) / 2));
  const items = [item(option.main, servings), ...sides];
  return { meal, items, gram: items.reduce((sum, one) => sum + one.gram, 0) };
}

/* ── 밖에서 먹는 점심 ──────────────────────────── */

interface LunchMenu {
  name: string;
  /** 한 그릇 단백질 어림(g) */
  gram: number;
  tags: readonly FoodTag[];
  cost: 1 | 2 | 3;
  /** 단백질을 더 얻는 주문법 */
  tip?: string;
  /** 감량 중일 때만 덧붙이는 말 */
  cutTip?: string;
}

/**
 * 회사 앞에서 실제로 고르는 메뉴.
 *
 * 숫자는 어림이다 — 식당마다 고기 양이 다르다. 정확히 재라는 표가
 * 아니라 **"이 중에서는 이게 낫다"**를 고르게 하려는 표다. 그래서
 * 단백질이 적은 메뉴(짜장면, 칼국수)는 아예 넣지 않았다.
 */
export const LUNCH_MENUS: readonly LunchMenu[] = [
  { name: '제육볶음 정식', gram: 28, tags: ['pork', 'grain'], cost: 1,
    tip: '고기 반찬을 먼저 드세요', cutTip: '공기밥은 반만 드셔도 됩니다' },
  { name: '돼지국밥', gram: 30, tags: ['pork', 'grain'], cost: 1,
    tip: '고기 추가가 되면 추가하세요 (+10g쯤)', cutTip: '밥을 말지 말고 따로 반 공기만' },
  { name: '고등어구이 백반', gram: 25, tags: ['seafood', 'grain'], cost: 1,
    tip: '계란말이가 있으면 같이' },
  { name: '닭갈비 정식', gram: 30, tags: ['chicken', 'grain'], cost: 2,
    cutTip: '볶음밥 추가는 빼세요' },
  { name: '설렁탕·곰탕', gram: 28, tags: ['beef', 'grain'], cost: 2,
    tip: '고기 추가(특)로 시키면 +10g쯤', cutTip: '밥은 반만 마세요' },
  { name: '쌀국수 (고기 추가)', gram: 25, tags: ['beef'], cost: 2 },
  { name: '편의점: 닭가슴살 + 삶은 계란 2개 + 우유', gram: 41, tags: ['chicken', 'egg', 'dairy'], cost: 1,
    tip: '삼각김밥 하나를 더해도 됩니다' },
  { name: '편의점: 두부바 + 삶은 계란 2개 + 두유', gram: 29, tags: ['soy', 'egg'], cost: 1 },
  { name: '샐러드 (닭가슴살 토핑 추가)', gram: 30, tags: ['chicken'], cost: 3,
    tip: '토핑 추가가 핵심입니다 — 잎채소만으로는 단백질이 없습니다' },
  { name: '샌드위치 (닭가슴살·햄 추가)', gram: 28, tags: ['chicken', 'pork', 'grain'], cost: 2 },
  { name: '순두부찌개 + 계란 추가', gram: 20, tags: ['soy', 'egg'], cost: 1,
    tip: '계란을 하나 더 넣어 달라고 하세요' },
  { name: '두부조림 백반', gram: 18, tags: ['soy', 'grain'], cost: 1 },
  { name: '돈까스', gram: 25, tags: ['pork', 'grain'], cost: 2,
    cutTip: '튀김이라 감량 중이면 다른 메뉴가 낫습니다' },
];

/** 오늘이 며칠째인가 — 날마다 다른 조합을 고르는 데만 쓴다. */
function dayNumber(date: string): number {
  const time = Date.parse(date + 'T00:00:00Z');
  return Number.isNaN(time) ? 0 : Math.floor(time / 86400000);
}

export function isWeekday(date: string): boolean {
  const time = Date.parse(date + 'T00:00:00Z');
  if (Number.isNaN(time)) return true;
  const day = new Date(time).getUTCDay();
  return day >= 1 && day <= 5;
}

/**
 * 사 먹는 점심 — 오늘 고를 메뉴 하나와 대안 둘.
 *
 * 한 끼 목표에 가까운 것부터 세우되, 감량 중이면 튀김을 뒤로 민다.
 * 아끼면 싼 메뉴를 앞에 둔다.
 */
function lunchOut(perMeal: number, blocked: Set<FoodTag>, budget: Budget, goal: BodyGoal, day: number): MealIdea | null {
  const allowed = LUNCH_MENUS.filter((menu) => !menu.tags.some((tag) => blocked.has(tag)));
  if (allowed.length === 0) return null;
  const score = (menu: LunchMenu) => {
    let value = Math.abs(menu.gram - perMeal);
    if (budget === 'save') value += (menu.cost - 1) * 8;
    if (budget === 'normal' && menu.cost === 3) value += 6;
    if (goal === 'cut' && menu.name === '돈까스') value += 15;
    return value;
  };
  const ranked = [...allowed].sort((a, b) => score(a) - score(b));
  const pool = ranked.slice(0, Math.min(4, ranked.length));
  const pick = pool[day % pool.length] as LunchMenu;
  const others = ranked.filter((menu) => menu !== pick).slice(0, 2).map((menu) => menu.name);
  const notes = [pick.tip, goal === 'cut' ? pick.cutTip : undefined].filter(Boolean);
  return {
    meal: '점심',
    items: [{ food: pick.name, amount: '', gram: pick.gram }],
    gram: pick.gram,
    note: notes.length > 0 ? notes.join(' · ') : undefined,
    options: others,
  };
}

/** 구내식당 — 메뉴는 못 고르니 담는 법만. */
const CAFETERIA_GRAM = 25;

function cafeteria(goal: BodyGoal): MealIdea {
  const tips = ['고기·생선·계란·두부 반찬부터 담기', '단백질 반찬이 하나뿐인 날은 그걸 두 번'];
  if (goal === 'cut') tips.push('밥은 반 공기');
  return {
    meal: '점심',
    items: [{ food: '구내식당', amount: '', gram: CAFETERIA_GRAM }],
    gram: CAFETERIA_GRAM,
    note: tips.join(' · '),
  };
}

/* ── 하루 ──────────────────────────────────────── */

export interface DayMealsInput {
  /** 한 끼 단백질 목표(g) */
  perMeal: number;
  prefs?: DietPrefs;
  /** 오늘 (YYYY-MM-DD) */
  date: string;
  goal: BodyGoal;
}

export interface DayMeals {
  weekday: boolean;
  meals: MealIdea[];
  /** 세 끼가 모자랄 때 하는 말 */
  shortfall: string | null;
}

export function planMeals(input: DayMealsInput): DayMeals {
  const prefs = input.prefs ?? DEFAULT_DIET;
  const blocked = blockedTags(prefs.avoid);
  const day = dayNumber(input.date);
  const weekday = isWeekday(input.date);
  const meals: MealIdea[] = [];
  if (!(input.perMeal > 0)) return { weekday, meals, shortfall: null };

  const pickFrom = (options: readonly MealOption[], avoidMain?: string) => {
    const pool = candidates(options, blocked, prefs.budget).filter((option) => option.main !== avoidMain);
    return pool.length > 0 ? pool[day % pool.length] : undefined;
  };

  const breakfast = pickFrom(BREAKFAST);
  if (breakfast) meals.push(buildMeal('아침', breakfast, input.perMeal));

  // 평일만 점심 방식을 따른다. 주말 점심은 집에서 먹는 사람이 대부분이다.
  let lunchMain: string | undefined;
  if (weekday && prefs.lunch === 'out') {
    const out = lunchOut(input.perMeal, blocked, prefs.budget, input.goal, day);
    if (out) meals.push(out);
  } else if (weekday && prefs.lunch === 'cafeteria') {
    meals.push(cafeteria(input.goal));
  } else {
    const lunch = pickFrom(LUNCH_COOK);
    if (lunch) {
      lunchMain = lunch.main;
      meals.push(buildMeal('점심', lunch, input.perMeal));
    }
  }

  // 점심과 같은 주재료를 저녁에 또 내지 않는다.
  const dinner = pickFrom(DINNER, lunchMain) ?? pickFrom(DINNER);
  if (dinner) meals.push(buildMeal('저녁', dinner, input.perMeal));

  const snack = SNACKS.find((items) => items.every(([name]) => allowedFood(name, blocked)));
  if (snack) {
    const items = snack.map(([name, servings]) => item(name, servings));
    meals.push({ meal: '간식', items, gram: items.reduce((sum, one) => sum + one.gram, 0) });
  }

  /*
   * 세 끼로 모자라는 만큼을 숫자로 말한다. 사 먹는 점심이나 구내식당은
   * 한 끼 목표에 못 미치는 날이 많은데, 그걸 말 안 하면 하루 목표가
   * 조용히 무너진다.
   */
  /*
   * 간식까지 넣고 센다. 간식은 이미 목록에 있으니 "간식으로 채우세요"라고
   * 하면 하나 더 먹으라는 말로 읽힌다. 간식까지 해도 모자랄 때만, 무엇을
   * 더하면 되는지 말한다.
   */
  const target = input.perMeal * 3;
  const total = meals.reduce((sum, one) => sum + one.gram, 0);
  const missing = target - total;
  const outside = weekday && prefs.lunch !== 'cook';
  const shortfall = missing >= 8
    ? `간식까지 해도 ${Math.round(missing / 5) * 5}g쯤 모자랍니다. ` +
      (outside ? '점심에 고기 추가나 계란 하나를 더하세요.' : '저녁 주재료를 반 덩이 늘리세요.')
    : null;

  return { weekday, meals, shortfall };
}

/** 예전 이름. 기본 설정·평일 기준으로 끼니를 낸다. */
export function mealIdeas(perMeal: number): MealIdea[] {
  return planMeals({ perMeal, date: '2026-01-07', goal: 'hold' }).meals;
}

/* ── 저울이 말하는 양 조정 ─────────────────────── */

export interface PortionAdvice {
  /** 더 먹으라는가, 덜 먹으라는가, 그대로인가 */
  direction: 'less' | 'more' | 'keep';
  text: string;
}

/**
 * 칼로리 숫자 대신 "지금 먹는 양에서 얼마나".
 *
 * 공식으로 낸 숫자는 그 사람의 몸을 모른다. 저울은 안다 — 2주 동안 그대로면
 * 지금 양이 유지량이다. 거기서 **밥 반 공기, 간식 하나** 단위로만 움직인다.
 * 단백질은 줄이지 않는다. 줄이는 건 늘 밥이나 간식이다.
 */
export function portionAdvice(trend: BodyTrend, goal: BodyGoal): PortionAdvice | null {
  const pace = trend.pace;
  if (!pace) return null;

  if (goal === 'cut') {
    if (pace === 'flat') return { direction: 'less', text: '2주째 그대로입니다. 저녁 밥을 반 공기로 줄여 보세요. 단백질은 그대로 둡니다.' };
    if (pace === 'fastDown') return { direction: 'more', text: '너무 빨리 빠집니다. 간식을 하나 더 드세요 — 근육을 지키는 쪽입니다.' };
    if (pace === 'slowUp' || pace === 'up') return { direction: 'less', text: '감량 중인데 늘고 있습니다. 간식을 하나 빼고 2주 지켜봅니다.' };
    return { direction: 'keep', text: '지금 먹는 양이 맞습니다. 그대로 갑니다.' };
  }

  if (goal === 'grow') {
    if (pace === 'up') return { direction: 'less', text: '너무 빨리 늘고 있습니다. 간식을 하나 빼 보세요.' };
    if (pace === 'slowUp') return { direction: 'keep', text: '근육으로 늘리기 좋은 속도입니다. 그대로 갑니다.' };
    return { direction: 'more', text: '늘지 않고 있습니다. 한 끼에 밥 반 공기를 더하거나 간식을 하나 더 드세요.' };
  }

  if (pace === 'down' || pace === 'fastDown') return { direction: 'more', text: '조금씩 빠지고 있습니다. 간식을 하나 더 드세요.' };
  if (pace === 'up' || pace === 'slowUp') return { direction: 'less', text: '조금씩 늘고 있습니다. 간식을 하나 빼 보세요.' };
  return { direction: 'keep', text: '잘 유지하고 있습니다. 그대로 갑니다.' };
}

/** 저장된 값을 믿을 수 있는 모양으로 고친다. 옛 버전이 남긴 이상한 값이 와도 앱이 죽지 않게. */
export function normalizeDiet(raw: unknown): DietPrefs {
  const value = (raw && typeof raw === 'object' ? raw : {}) as Partial<DietPrefs>;
  const avoidIds = FOOD_AVOID_OPTIONS.map((option) => option.id);
  return {
    avoid: Array.isArray(value.avoid) ? value.avoid.filter((id) => avoidIds.includes(id)) : [],
    budget: BUDGET_OPTIONS.some((option) => option.id === value.budget) ? value.budget as Budget : 'normal',
    lunch: LUNCH_OPTIONS.some((option) => option.id === value.lunch) ? value.lunch as LunchMode : 'cook',
  };
}
