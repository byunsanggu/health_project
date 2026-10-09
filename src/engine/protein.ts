/**
 * 단백질.
 *
 * 식단표를 만들지 않는 이유는 분명하다. **매 끼 적는 일은 아무도 3주를
 * 못 간다.** 운동은 주 3회 30분인데 밥은 하루 세 번 365일이다. 사진,
 * 바코드, 자동 인식 다 나왔는데도 식단 기록 앱의 이탈률은 그대로다.
 * 그리고 칼로리 목표를 숫자로 찍어 주는 일은 영양사의 영역이다.
 *
 * 그래서 하나만 센다 — **단백질.** 감량기에 근육을 지키는 변수는 사실상
 * 이것 하나이고, 적는 비용이 거의 없다. 끼니마다 적는 게 아니라
 * **하루 끝에 채웠나 한 번** 누르면 끝이다.
 *
 * 그리고 '못 지킨 날'을 혼내지 않는다. 주 7일 중 나흘만 채워도 안 세던
 * 때보다 낫다. 완벽을 요구하면 한 번 어긴 날 앱을 지운다.
 */
import { withParticle } from './korean.ts';
import type { CheckIn } from './types.ts';
import type { TrainingGoal } from './goals.ts';
import type { BodyGoal } from './bodyTrend.ts';

/**
 * 체중 1kg당 몇 g인가.
 *
 * 연구들이 모이는 구간은 1.6~2.2g/kg다. 그 안에서 적자일수록 위를
 * 쓴다 — 먹는 양이 줄면 몸이 단백질을 에너지로 돌려 쓰기 때문에,
 * 감량기에 유지기와 같은 양을 먹으면 근육이 먼저 나간다.
 */
export const PROTEIN_PER_KG: Record<BodyGoal, number> = {
  cut: 2.0,
  hold: 1.6,
  grow: 1.8,
};

/** 목표 조합에서 체중을 어느 쪽으로 가져가는지 읽는다. */
export function bodyGoalOf(goals: readonly TrainingGoal[]): BodyGoal {
  if (goals.includes('fatLoss')) return 'cut';
  if (goals.includes('hypertrophy') || goals.includes('strength')) return 'grow';
  return 'hold';
}

/**
 * 하루 목표 g.
 *
 * 5g 단위로 끊는다. "155g"은 지킬 수 있는 숫자이지만 "156.4g"은
 * 지키라는 말이 아니라 재라는 말이다.
 */
export function proteinTargetG(bodyweightKg: number, goal: BodyGoal): number {
  if (!Number.isFinite(bodyweightKg) || bodyweightKg <= 0) return 0;
  /*
   * 아주 무거운 사람에게 체중 비례를 그대로 적용하면 먹을 수 없는
   * 양이 나온다. 체지방은 단백질을 요구하지 않으므로 위를 막는다.
   */
  const raw = Math.min(bodyweightKg, 110) * PROTEIN_PER_KG[goal];
  return Math.round(raw / 5) * 5;
}

/* ── 감 잡기 ───────────────────────────────────── */

/**
 * 못 먹는 이유로 거르는 꼬리표.
 *
 * 채식은 따로 두지 않는다 — 고기·생선 꼬리표를 다 거르면 그게 채식이다.
 */
export type FoodTag = 'egg' | 'dairy' | 'seafood' | 'pork' | 'beef' | 'chicken' | 'soy' | 'grain';

export interface ProteinFood {
  name: string;
  /** 한 번에 먹는 양 */
  serving: string;
  /** 그만큼에 들어 있는 단백질(g) */
  gram: number;
  tags?: readonly FoodTag[];
  /**
   * 단백질 g당 값이 싼 편인가 (1 싸다 · 2 보통 · 3 비싸다).
   *
   * 원 단위로 적지 않는다. 물가는 매달 바뀌어서 "100g 1,200원"이라고
   * 적어 두면 반년 뒤엔 틀린 숫자다. 서로 비교한 순서는 잘 안 바뀐다.
   */
  cost?: 1 | 2 | 3;
}

/**
 * 한국에서 실제로 먹는 것들로만.
 *
 * 숫자는 어림이다 — 부위·조리법마다 다르다. 정확히 재라는 표가 아니라
 * **"닭가슴살 한 덩이가 23g이구나"** 하는 감을 주려는 표다. 그 감이
 * 생기면 그날부터 앱 없이도 맞춘다.
 */
export const PROTEIN_FOODS: readonly ProteinFood[] = [
  // 앞의 둘은 proteinHint가 순서로 꺼내 쓴다. 자리를 바꾸지 않는다.
  { name: '닭가슴살', serving: '100g 한 덩이', gram: 23, tags: ['chicken'], cost: 1 },
  { name: '계란', serving: '1개', gram: 6, tags: ['egg'], cost: 1 },
  { name: '소고기', serving: '100g', gram: 21, tags: ['beef'], cost: 3 },
  { name: '돼지 목살', serving: '100g', gram: 20, tags: ['pork'], cost: 2 },
  { name: '고등어', serving: '한 토막', gram: 20, tags: ['seafood'], cost: 2 },
  { name: '참치캔', serving: '작은 캔 1개', gram: 25, tags: ['seafood'], cost: 1 },
  { name: '두부', serving: '반 모', gram: 12, tags: ['soy'], cost: 1 },
  { name: '우유', serving: '200ml', gram: 6, tags: ['dairy'], cost: 1 },
  { name: '그릭요거트', serving: '1개', gram: 10, tags: ['dairy'], cost: 2 },
  // 유청 단백질 기준이다. 식물성 보충제도 있지만 흔한 쪽으로 거른다.
  { name: '단백질 보충제', serving: '1스쿱', gram: 24, tags: ['dairy'], cost: 2 },
  { name: '검은콩', serving: '한 줌', gram: 12, tags: ['soy'], cost: 1 },
  { name: '밥', serving: '한 공기', gram: 6, tags: ['grain'], cost: 1 },
  { name: '두유', serving: '200ml', gram: 7, tags: ['soy'], cost: 1 },
  { name: '돼지 앞다리', serving: '100g', gram: 20, tags: ['pork'], cost: 1 },
  { name: '닭다리살', serving: '100g', gram: 19, tags: ['chicken'], cost: 1 },
  { name: '연어', serving: '100g', gram: 22, tags: ['seafood'], cost: 3 },
  { name: '낫토', serving: '1팩', gram: 8, tags: ['soy'], cost: 1 },
];

/**
 * 목표를 하루치 그림으로 바꾼다.
 *
 * 숫자만 주면 "150g이 대체 얼만데"에서 멈춘다. 끼니로 쪼개 보여 주면
 * 그날 저녁에 바로 쓴다.
 */
export function proteinHint(targetG: number): string {
  if (targetG <= 0) return '';
  /*
   * "닭가슴살 일곱 덩이"로 환산해 보여 주면 안 된다. 그 그림은 하루를
   * 통째로 닭으로 때우라는 말로 읽히고, 보는 순간 포기한다. 한 끼에
   * 얼마인지로 말해야 오늘 저녁에 쓸 수 있다.
   */
  const meal = perMealG(targetG);
  const chicken = PROTEIN_FOODS[0] as ProteinFood;
  const egg = PROTEIN_FOODS[1] as ProteinFood;
  return (
    `하루 ${targetG}g — 세 끼에 ${meal}g씩입니다. ` +
    `닭가슴살 ${withParticle(chicken.serving, '이/가')} ${chicken.gram}g, ` +
    `계란 ${withParticle(egg.serving, '이/가')} ${egg.gram}g입니다.`
  );
}

/** 한 끼에 얼마쯤 담아야 하는가. 끼니 수로 나눠 5g 단위로 끊는다. */
export function perMealG(targetG: number, meals = 3): number {
  if (targetG <= 0 || meals <= 0) return 0;
  return Math.round(targetG / meals / 5) * 5;
}

/* ── 지킨 날 ───────────────────────────────────── */

export interface ProteinWeek {
  /** 최근 7일 중 채운 날 */
  hits: number;
  /** 최근 7일 중 답한 날 */
  answered: number;
  /** 오늘 이미 답했는가 */
  answeredToday: boolean;
  /** 오늘 채웠다고 했는가 */
  hitToday: boolean;
  /** 화면에 그대로 쓸 한 줄 */
  message: string;
}

/**
 * 나흘.
 *
 * 7일 전부를 기준으로 삼으면 한 번 어긴 주가 실패한 주가 된다. 주
 * 나흘이면 평균이 목표 근처로 올라오고, 그게 몸이 보는 전부다.
 */
export const ENOUGH_DAYS = 4;

function dayDiff(from: string, to: string): number {
  const a = Date.parse(from + 'T00:00:00Z');
  const b = Date.parse(to + 'T00:00:00Z');
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((b - a) / 86400000);
}

export function proteinWeek(checkIns: readonly CheckIn[], today: string): ProteinWeek {
  const recent = checkIns.filter((entry) => {
    if (!entry || typeof entry.proteinHit !== 'boolean') return false;
    const gap = dayDiff(entry.date, today);
    return gap >= 0 && gap < 7;
  });

  // 같은 날이 여럿이면 나중 것만 센다.
  const byDate = new Map<string, boolean>();
  for (const entry of recent) byDate.set(entry.date.slice(0, 10), entry.proteinHit === true);

  const answered = byDate.size;
  const hits = [...byDate.values()].filter(Boolean).length;
  const todayAnswer = byDate.get(today);

  return {
    hits,
    answered,
    answeredToday: todayAnswer !== undefined,
    hitToday: todayAnswer === true,
    message: weekMessage(hits, answered),
  };
}

function weekMessage(hits: number, answered: number): string {
  if (answered === 0) return '하루 끝에 채웠는지만 눌러 두면 한 주 뒤에 보입니다.';
  if (hits === 0) return `${answered}일 중 아직 채운 날이 없습니다. 한 끼만 바꿔도 달라집니다.`;
  if (hits >= ENOUGH_DAYS) {
    return hits >= 7
      ? '이번 주 일곱 날 전부 채웠습니다. 이 정도면 감량기에 근육이 버팁니다.'
      : `이번 주 ${hits}일 채웠습니다. 나흘 넘으면 충분합니다.`;
  }
  const left = ENOUGH_DAYS - hits;
  return `이번 주 ${hits}일 채웠습니다. ${left}일만 더 채우면 몸이 아는 수준입니다.`;
}

/**
 * 감량 중인데 단백질이 모자란 경우.
 *
 * 이 둘이 겹칠 때가 근손실이 실제로 일어나는 자리다. 따로 보면
 * 둘 다 대수롭지 않아 보이기 때문에 **겹칠 때만** 말한다.
 */
export function proteinRisk(week: ProteinWeek, goal: BodyGoal, losing: boolean): string | null {
  if (goal !== 'cut' || !losing) return null;
  if (week.answered < 3) return null;
  /*
   * 비율로 본다. "나흘 못 채웠다"로 잡으면 나흘 중 사흘 채운 주에도
   * 경고가 뜬다 — 잘하고 있는 사람에게 뜨는 경고는 다음부터 안 읽힌다.
   */
  if (week.hits * 2 >= week.answered) return null;
  return (
    '체중은 빠지는데 단백질이 모자란 주입니다. 이 조합이 근육을 깎습니다 — ' +
    '먹는 양을 줄이기 전에 단백질부터 채우세요.'
  );
}
