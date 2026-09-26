/**
 * 집단 신호 — 같은 헬스장 사람들이 무엇을 빼는가.
 *
 * 한 사람이 바벨 로우를 뺀 건 취향이다. **그 헬스장 사람 열 중 여섯이
 * 뺐으면 그건 그 헬스장 이야기다** — 바가 휘었거나, 자리가 좁아서 등을
 * 못 펴거나, 바닥이 미끄럽거나.
 *
 * 규칙 세 가지를 지킨다.
 *
 *   1. **자동으로 안 뺀다.** 남들이 싫어한다고 내 프로그램에서 종목이
 *      사라지면, 그건 내 프로그램이 아니다. 보여주기만 한다.
 *
 *   2. **아파서 뺀 것은 안 센다.** 건강 정보다. 익명으로 모아도
 *      "이 헬스장 사람들이 허리가 아프다"는 말이 만들어지는데, 그건
 *      우리가 만들어도 되는 말이 아니다.
 *
 *   3. **사람이 적으면 말하지 않는다.** 둘 중 둘이 뺐다고 100%라고
 *      말하면 그 숫자는 거짓말이다.
 */
import { withParticle } from './korean.ts';
import type { Exercise } from './types.ts';

/**
 * 몇 명부터 말할 것인가.
 *
 * 다섯이다. 그보다 적으면 한 사람이 바뀔 때마다 비율이 20%씩 튄다.
 * 트레이너가 "요즘 회원들이" 라고 말할 때 머릿속에 있는 최소 인원이기도 하다.
 */
export const MIN_PEOPLE = 5;

/**
 * 얼마나 많이 빼야 신호인가.
 *
 * 절반이다. 그 아래는 취향이 갈리는 정상 범위다 — 어느 헬스장에서든
 * 데드리프트를 싫어하는 사람은 서넛 중 하나쯤 있다.
 */
export const SIGNAL_RATE = 0.5;

/** 한 사람이 한 종목을 뺐다는 사실. 누가 뺐는지는 여기 없다. */
export interface SkipReport {
  exerciseId: string;
  /** 'pain'은 아예 넘어오면 안 된다 — 넘어와도 여기서 버린다. */
  reason: 'noEquipment' | 'dislike' | 'pain';
}

export interface CrowdInput {
  /** 이 헬스장에서 모인 것 */
  reports: readonly SkipReport[];
  /** 이 헬스장을 등록한 사람 수 */
  people: number;
  index: ReadonlyMap<string, Exercise>;
}

export type SignalKind = 'equipment' | 'dislike';

export interface CrowdSignal {
  exerciseId: string;
  name: string;
  kind: SignalKind;
  /** 뺀 사람 수 */
  count: number;
  /** 전체 대비 비율 (0~1) */
  rate: number;
  text: string;
}

/**
 * 신호를 뽑는다.
 *
 * 기구가 없어서 뺀 것과 그냥 싫어서 뺀 것을 나눠 센다. 뜻이 완전히 다르기
 * 때문이다 — 앞엣것은 헬스장에 기구가 없다는 사실이고, 뒤엣것은 뭔가
 * 불편하다는 짐작이다. 합쳐서 "60%가 뺐습니다"라고 하면 관장이 기구를
 * 사야 하는지 바닥을 고쳐야 하는지 알 수 없다.
 */
export function crowdSignals(input: CrowdInput): CrowdSignal[] {
  if (input.people < MIN_PEOPLE) return [];

  const tally = new Map<string, { equipment: number; dislike: number }>();

  for (const report of input.reports) {
    // 건강 정보는 세지 않는다. 들어와도 버린다.
    if (report.reason === 'pain') continue;

    const entry = tally.get(report.exerciseId) ?? { equipment: 0, dislike: 0 };
    if (report.reason === 'noEquipment') entry.equipment += 1;
    else entry.dislike += 1;
    tally.set(report.exerciseId, entry);
  }

  const signals: CrowdSignal[] = [];

  for (const [exerciseId, counts] of tally) {
    const exercise = input.index.get(exerciseId);
    if (!exercise) continue;

    for (const kind of ['equipment', 'dislike'] as const) {
      const count = kind === 'equipment' ? counts.equipment : counts.dislike;
      const rate = count / input.people;
      if (rate < SIGNAL_RATE) continue;

      signals.push({
        exerciseId,
        name: exercise.name,
        kind,
        count,
        rate: Math.round(rate * 100) / 100,
        text: signalText(exercise, kind, count, input.people),
      });
    }
  }

  return signals.sort((a, b) => b.rate - a.rate || a.name.localeCompare(b.name));
}

/**
 * 뭐라고 말할 것인가.
 *
 * 원인을 단정하지 않는다. "바가 휘었습니다"가 아니라 "확인해 볼 만합니다"다.
 * 우리가 아는 건 사람들이 뺐다는 사실뿐이고, 이유는 가 봐야 안다.
 */
function signalText(
  exercise: Exercise,
  kind: SignalKind,
  count: number,
  people: number,
): string {
  const named = withParticle(exercise.name, '을/를');
  if (kind === 'equipment') {
    return `${people}명 중 ${count}명이 ${named} "기구가 없다"로 뺐습니다. ` +
      '기구 목록이 실제와 다를 수 있습니다.';
  }
  return `${people}명 중 ${count}명이 ${named} 뺐습니다. ` +
    '자리가 좁거나 기구 상태가 안 좋은 경우가 많습니다 — 한 번 보실 만합니다.';
}

/**
 * 나한테 보여줄 한 줄.
 *
 * 관장에게 보이는 말과 회원에게 보이는 말이 달라야 한다. 회원에게
 * "여기 사람들이 이 종목을 싫어합니다"라고 하면, 그건 하지 말라는 말로
 * 읽힌다. 우리는 그런 말을 할 자격이 없다 — 그 사람은 그 종목이 필요할 수 있다.
 */
export function memberNote(signal: CrowdSignal): string | undefined {
  if (signal.kind !== 'equipment') return undefined;
  return `여기 다니는 분들 중 ${signal.count}명이 이 종목 기구가 없다고 했습니다. ` +
    '가서 없으면 "이 기구 없어요"를 눌러 주세요.';
}
