/**
 * 돌아왔을 때.
 *
 * 사람들이 운동 앱을 지우는 순간은 대개 여기다. 다치거나, 여행을 가거나,
 * 일이 바빠서 몇 주 쉰다. 그러고 다시 열면 앱이 **쉬기 전 무게를 그대로**
 * 띄운다. 그걸 들다 실패하고, 실패하면 다음 주에 안 온다.
 *
 * 옆에 트레이너가 있으면 절대 안 생기는 일이다. "얼마나 쉬셨어요?"를
 * 묻고 무게를 내려 주니까. 그 한마디를 코드로 옮긴다.
 *
 * 숫자의 근거
 *
 * 근력은 생각보다 **덜** 빠진다. 근육 크기보다 신경이 먼저 돌아오기도
 * 하고, 한 번 키운 근육은 다시 키우는 것이 처음보다 훨씬 빠르다.
 * 그래서 여기서 내리는 폭은 "안전하게 많이"가 아니라 **"한두 주면 제자리로
 * 돌아올 만큼만"** 이다. 너무 내리면 그것대로 사람이 앱을 안 믿는다.
 *
 * 그리고 **왜 쉬었는지**를 묻는다. 바빠서 쉰 2주와 다쳐서 쉰 2주는 전혀
 * 다른 2주다. 종목을 뺄 때 이유를 먼저 묻는 것과 같은 이유다(exclusions.ts).
 */
import { withParticle } from './korean.ts';

/** 이만큼 안에 다시 오면 아무것도 안 바꾼다. */
export const FRESH_DAYS = 7;

export type LayoffReason = 'busy' | 'injury' | 'sick';

export const LAYOFF_REASONS: readonly { reason: LayoffReason; label: string; note: string }[] = [
  { reason: 'busy', label: '바빴어요', note: '몸은 멀쩡합니다. 무게만 조금 내렸다 올립니다.' },
  {
    reason: 'injury',
    label: '다쳤어요',
    note: '더 많이 내리고 더 천천히 올립니다. 아픈 곳도 같이 적어 주세요.',
  },
  { reason: 'sick', label: '아팠어요', note: '앓고 난 뒤에는 체력이 먼저 빠집니다. 세트를 더 줄입니다.' },
];

export interface ComebackInput {
  /** 마지막으로 운동한 날 (YYYY-MM-DD). 기록이 없으면 없음 */
  lastTrainedISO?: string;
  today: string;
  reason?: LayoffReason;
}

export interface ComebackPlan {
  gapDays: number;
  /** 조정이 필요한가 */
  needed: boolean;
  reason: LayoffReason;
  /** 몇 주에 걸쳐 원래대로 돌아오는가 */
  weeks: number;
  /** 첫 주 중량 배율 */
  startLoad: number;
  /** 첫 주에 줄일 세트 수 */
  startSetDrop: number;
  /** 화면에 그대로 쓸 제목 */
  title: string;
  /** 왜 그렇게 하는지 */
  note: string;
}

function daysBetween(fromISO: string, toISO: string): number {
  const from = Date.parse(fromISO + 'T00:00:00Z');
  const to = Date.parse(toISO + 'T00:00:00Z');
  if (Number.isNaN(from) || Number.isNaN(to)) return 0;
  return Math.max(0, Math.round((to - from) / 86400000));
}

/**
 * 공백 길이별 기준.
 *
 * 한 주까지는 손대지 않는다 — 쉬는 것은 프로그램 안에 이미 들어 있고,
 * 사흘 쉬었다고 무게를 내리면 그건 방해다.
 */
const BANDS: readonly { upTo: number; load: number; setDrop: number; weeks: number }[] = [
  { upTo: 13, load: 0.95, setDrop: 1, weeks: 1 },
  { upTo: 27, load: 0.9, setDrop: 1, weeks: 2 },
  { upTo: 55, load: 0.8, setDrop: 2, weeks: 3 },
  { upTo: 111, load: 0.7, setDrop: 2, weeks: 4 },
  { upTo: Infinity, load: 0.65, setDrop: 2, weeks: 4 },
];

/**
 * 이유에 따라 더 내린다.
 *
 * 다쳐서 쉰 사람은 같은 2주라도 다르다. 통증 게이트가 종목을 걸러 주지만,
 * 그건 "이 종목이 아픈가"를 보는 것이지 "쉬는 동안 얼마나 빠졌나"를 보는
 * 것이 아니다. 둘 다 필요하다.
 */
const REASON_ADJUST: Record<LayoffReason, { load: number; setDrop: number; weeks: number }> = {
  busy: { load: 0, setDrop: 0, weeks: 0 },
  injury: { load: -0.1, setDrop: 1, weeks: 1 },
  sick: { load: -0.05, setDrop: 1, weeks: 0 },
};

/** 아무리 오래 쉬어도 이 아래로는 안 내린다 — 그 아래는 운동이 아니다. */
export const LOAD_FLOOR = 0.5;

export function planComeback(input: ComebackInput): ComebackPlan {
  const reason = input.reason ?? 'busy';
  const gapDays = input.lastTrainedISO ? daysBetween(input.lastTrainedISO, input.today) : 0;

  if (!input.lastTrainedISO || gapDays <= FRESH_DAYS) {
    return {
      gapDays,
      needed: false,
      reason,
      weeks: 0,
      startLoad: 1,
      startSetDrop: 0,
      title: '',
      note: '',
    };
  }

  const band = BANDS.find((item) => gapDays <= item.upTo)!;
  const adjust = REASON_ADJUST[reason];

  const startLoad = Math.max(LOAD_FLOOR, Math.round((band.load + adjust.load) * 100) / 100);
  const startSetDrop = band.setDrop + adjust.setDrop;
  const weeks = band.weeks + adjust.weeks;

  return {
    gapDays,
    needed: true,
    reason,
    weeks,
    startLoad,
    startSetDrop,
    title: gapLabel(gapDays) + ' 만에 오셨습니다',
    note: noteFor(startLoad, weeks, reason),
  };
}

function gapLabel(days: number): string {
  if (days < 14) return `${days}일`;
  const weeks = Math.round(days / 7);
  if (weeks < 9) return `${weeks}주`;
  return `${Math.round(days / 30)}달`;
}

function noteFor(startLoad: number, weeks: number, reason: LayoffReason): string {
  const percent = Math.round(startLoad * 100);

  /*
   * 안심시키는 말을 먼저 한다. 돌아온 사람이 제일 두려워하는 것은
   * "다 날아갔겠지"이고, 그 생각이 들면 아예 안 온다. 실제로는 덜 빠진다.
   */
  const head = reason === 'injury'
    ? '다친 뒤에는 천천히 올리는 쪽이 빠릅니다.'
    : '근력은 생각보다 덜 빠집니다. 한 번 키운 근육은 다시 붙는 것도 빠릅니다.';

  const body = `무게를 ${percent}%에서 다시 쌓습니다. ` +
    (weeks === 1 ? '한 주면 제자리입니다.' : `${weeks}주면 제자리입니다.`);

  return `${head} ${body}`;
}

/**
 * 복귀 몇 주째인가에 따른 중량 배율.
 *
 * 첫 주가 제일 낮고, 마지막 주를 지나면 1이다. 사이는 고르게 올린다 —
 * 한 주에 20%씩 뛰면 그 주가 통째로 과부하가 된다.
 */
export function loadFactorAt(plan: ComebackPlan, weekIndex: number): number {
  if (!plan.needed || weekIndex >= plan.weeks) return 1;
  if (weekIndex <= 0) return plan.startLoad;

  const step = (1 - plan.startLoad) / plan.weeks;
  return Math.min(1, Math.round((plan.startLoad + step * weekIndex) * 100) / 100);
}

/** 복귀 몇 주째인가에 따라 줄일 세트 수. 세트는 중량보다 빨리 돌려준다. */
export function setDropAt(plan: ComebackPlan, weekIndex: number): number {
  if (!plan.needed || weekIndex >= plan.weeks) return 0;
  if (weekIndex <= 0) return plan.startSetDrop;
  return Math.max(0, plan.startSetDrop - weekIndex);
}

/**
 * 세트를 깎되 **한 세트는 남긴다.**
 *
 * 2세트짜리 고립 종목에서 2를 깎으면 0이 된다. 0세트짜리 종목이 목록에
 * 남아 있으면 그건 고장난 화면이고, 조용히 빼 버리면 "내 프로그램에서
 * 종목이 사라졌다"가 된다. 한 세트라도 하는 쪽이 둘 다보다 낫다.
 */
export function setsAfterDrop(planned: number, drop: number): number {
  return Math.max(1, planned - Math.max(0, drop));
}

/** 지금 몇 주째인지. 복귀를 시작한 날과 오늘로 센다. */
export function comebackWeek(startedISO: string, today: string): number {
  return Math.floor(daysBetween(startedISO, today) / 7);
}

/** 진행 중인 복귀를 한 줄로. */
export function comebackLine(plan: ComebackPlan, weekIndex: number): string {
  const factor = loadFactorAt(plan, weekIndex);
  if (factor >= 1) return '복귀를 마쳤습니다. 오늘부터 원래 무게입니다.';

  const percent = Math.round(factor * 100);
  const left = Math.max(1, plan.weeks - weekIndex);
  const drop = setDropAt(plan, weekIndex);

  return `복귀 ${weekIndex + 1}주차 · 무게 ${percent}%` +
    (drop > 0 ? ` · 종목마다 ${drop}세트 적게` : '') +
    ` · ${withParticle(String(left) + '주', '이/가')} 남았습니다`;
}
