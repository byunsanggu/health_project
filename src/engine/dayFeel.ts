/**
 * 오늘 컨디션 — 사람이 직접 정한다.
 *
 * 화면의 컨디션 %는 지난 기록(수행력 · 근육통 · 잠 · 블록 주차)으로 낸 피로 점수다.
 * 기록은 어제까지를 안다. 오늘 아침 잠을 설쳤는지, 회사 일로 지쳤는지는 모른다 —
 * 그건 본인이 제일 잘 안다. 그래서 고르게 두고, 고른 것이 기록보다 먼저다.
 *
 *   좋아요 — 계획대로. 기록이 낮게 나와도 "무리하지 마세요"를 앞세우지 않는다.
 *   보통   — 고르지 않은 것과 같다. 기록으로 본 컨디션을 쓴다.
 *   별로예요 — 종목마다 한 세트 덜, 무게 조금(5%) 덜, 주 1회 무거운 세트는 오늘 건너뛴다.
 *
 * 이 값은 이 폰에만 둔다(하루짜리 · 건강에 관한 정보). 친구 · 헬스장 표에는 절대 안 간다.
 */
import { LOW_CONDITION } from './coach.ts';

export type DayFeel = 'good' | 'ok' | 'low';

export const DAY_FEELS: readonly { id: DayFeel; label: string; hint: string }[] = [
  { id: 'good', label: '좋아요', hint: '계획대로 합니다.' },
  { id: 'ok', label: '보통', hint: '기록으로 본 컨디션대로 합니다.' },
  { id: 'low', label: '별로예요', hint: '종목마다 한 세트 덜, 무게는 조금 가볍게. 무거운 세트는 오늘 건너뜁니다.' },
];

/** 별로인 날 무게 비율 — 반복은 그대로 두고 여유를 한두 개 더 남기는 정도. */
export const LOW_FEEL_LOAD = 0.95;
/** 별로인 날에도 종목마다 이만큼은 한다 — 한 세트짜리 종목은 운동이 아니라 인사다. */
export const LOW_FEEL_MIN_SETS = 2;

export function dayFeelLabel(feel: DayFeel): string {
  return DAY_FEELS.find((item) => item.id === feel)?.label ?? '';
}

/**
 * 판단에 쓸 컨디션 %. 화면에는 고른 말을 그대로 보이고, 코치 말 · "끝까지 밀지 않는 날"은 이 값으로 정한다.
 * 별로 → 기록과 상관없이 낮은 날, 좋아요 → 기록이 낮아도 낮은 날로 보지 않는다.
 */
export function effectiveCondition(feel: DayFeel | null | undefined, recorded: number): number {
  if (feel === 'low') return Math.min(recorded, LOW_CONDITION - 10);
  if (feel === 'good') return Math.max(recorded, LOW_CONDITION);
  return recorded;
}

interface FeelSet { weightKg: number | null; top?: boolean }
interface FeelItem<S extends FeelSet> { sets: readonly S[] }

/**
 * 별로인 날의 세션. 무거운 세트(top)를 빼고, 한 세트를 덜고, 무게를 내린다.
 *
 * `round`는 끼울 수 있는 무게로 **내려** 맞추는 함수다 — 87.3kg을 적어 두면 그걸 맞추느라 시간을 버린다.
 * `doneCount`는 이미 끝낸 세트 수다. 운동 중에 바꿔도 한 세트는 지우지 않는다.
 */
export function lightenForLowDay<S extends FeelSet, T extends FeelItem<S>>(
  items: readonly T[],
  round: (kg: number, item: T) => number,
  doneCount: (item: T) => number = () => 0,
): T[] {
  return items.map((item) => {
    const working = item.sets.filter((set) => !set.top);
    const keep = Math.max(
      Math.min(working.length, LOW_FEEL_MIN_SETS),
      working.length - 1,
      Math.min(working.length, doneCount(item)),
    );
    return {
      ...item,
      sets: working.slice(0, keep).map((set) => (set.weightKg == null ? set : { ...set, weightKg: round(set.weightKg * LOW_FEEL_LOAD, item) })),
    };
  });
}
