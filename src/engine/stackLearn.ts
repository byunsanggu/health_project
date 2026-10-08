import { FIRST_MACHINE, isGymSpecific, machineOf } from './gymWeight.ts';
import type { StackLoading } from './gym.ts';
import type { Exercise, SessionLog } from './types.ts';

/**
 * 기계마다 다른 스택 간격 — 적은 무게에서 알아낸다.
 *
 * 지금까지는 헬스장 전체에 스택 명세 하나를 썼다(최소 5 · 간격 5 · 최대 100).
 * 그런데 헬스장에 기계가 스무 대면 스무 개가 다 다르다. 랫풀다운은 5kg,
 * 케이블은 2.5kg, 수입 기계는 7kg 간격인 데가 흔하다.
 *
 * 그래서 매일 세 가지가 어긋난다. ± 버튼이 틀린 칸으로 움직이고, 못 만드는
 * 무게를 처방하고, 100kg에서 잘린다.
 *
 * **스무 개를 입력받는 화면을 만들면 안 된다.** 거기서 앱을 닫는다.
 *
 * 대신 적은 무게에서 읽는다. 사용자가 적은 숫자는 전부 **그 기계가 실제로
 * 만들 수 있었던 무게**다. 차이들의 최대공약수가 간격이다.
 */

/** 믿을 만한 간격의 범위. 이 밖은 잘못 적은 숫자로 본다. */
export const MIN_STEP = 0.5;
export const MAX_STEP = 25;

/**
 * 지금 가정보다 **거친** 간격을 받아들이는 데 필요한 관찰 수.
 *
 * 더 촘촘한 간격은 하나만 봐도 믿는다 — 2.5kg 차이를 실제로 봤다면
 * 그 기계는 2.5kg을 만들 수 있다는 뜻이고, 그건 증명된 사실이다.
 *
 * 거친 쪽은 다르다. 50·60·70만 적은 사람을 보고 "이 기계는 10kg 간격"이라고
 * 하면 틀릴 수 있다 — 그냥 한 판씩 올렸을 뿐일 수도 있다. 추측이라서 더
 * 많은 근거가 필요하다.
 */
export const COARSE_SAMPLES = 3;

/** 0.25kg 격자. 소수 계산으로 최대공약수를 구하면 끝이 안 난다. */
const GRID = 4;

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

export interface StepGuess {
  /**
   * 간격. **하나만 봤으면 알 수 없다(null).**
   *
   * 범위와 간격은 서로 다른 물음이다. 120kg을 한 번 들었다는 사실은
   * "이 기계는 120까지 간다"를 증명하지만 간격은 아무것도 말해 주지
   * 않는다. 그 하나 때문에 범위까지 못 넓히면, 120을 든 사람에게 계속
   * 102.5를 처방하게 된다 — 자기가 한 일을 부정당하는 것이다.
   */
  stepKg: number | null;
  /** 서로 다른 무게를 몇 개 봤는가 */
  samples: number;
  /** 본 것 중 가장 가벼운 것과 무거운 것 */
  lightestKg: number;
  heaviestKg: number;
}

/**
 * 이 기계에서 적은 본세트 무게들.
 *
 * 워밍업은 뺀다 — 램프는 처방이 만든 숫자라 기계가 만들 수 있는 값인지와
 * 상관이 없다. 그걸 섞으면 있지도 않은 간격이 나온다.
 */
export function observedWeights(
  sessions: readonly SessionLog[],
  exerciseId: string,
  gymId?: string,
  machine?: string,
): number[] {
  const want = machine || FIRST_MACHINE;
  const seen = new Set<number>();

  for (const session of sessions) {
    if (gymId && session.gymId !== gymId) continue;
    for (const set of session.sets) {
      if (set.exerciseId !== exerciseId || set.warmup) continue;
      if (machineOf(set) !== want) continue;
      if (!(set.weightKg > 0)) continue;
      seen.add(Math.round(set.weightKg * GRID));
    }
  }

  return [...seen].sort((a, b) => a - b).map((units) => units / GRID);
}

/**
 * 간격 읽기.
 *
 * 돌려주는 값은 **참 간격의 배수**다. 관찰한 무게들은 전부 만들 수 있는
 * 값이므로 그 차이는 참 간격의 배수고, 최대공약수도 그렇다. 그래서 틀릴
 * 때는 늘 **거친 쪽으로** 틀린다 — 없는 무게를 지어내는 쪽으로는 틀리지
 * 않는다. 둘 중에는 이쪽이 덜 나쁘다.
 */
export function guessStep(weights: readonly number[]): StepGuess | null {
  const units = [...new Set(weights.map((kg) => Math.round(kg * GRID)))].sort((a, b) => a - b);
  if (units.length === 0) return null;

  const range = {
    samples: units.length,
    lightestKg: units[0]! / GRID,
    heaviestKg: units[units.length - 1]! / GRID,
  };
  if (units.length < 2) return { ...range, stepKg: null };

  let step = 0;
  for (let i = 1; i < units.length; i += 1) step = gcd(step, units[i]! - units[i - 1]!);

  const stepKg = step / GRID;
  // 말이 안 되는 간격이면 간격만 버리고 범위는 쓴다.
  if (!(stepKg >= MIN_STEP) || stepKg > MAX_STEP) return { ...range, stepKg: null };

  return { ...range, stepKg };
}

/**
 * 알아낸 것을 명세에 반영한다.
 *
 * 두 가지를 따로 본다.
 *
 *   **간격** — 더 촘촘하면 바로 받는다(관찰로 증명됐다). 더 거칠면
 *   COARSE_SAMPLES만큼 봐야 받는다(추측이다).
 *
 *   **위아래 끝** — 본 무게가 명세 밖이면 넓힌다. 이건 늘 받는다. 실제로
 *   그 무게로 운동한 기록이 있는데 "그 기계는 거기까지 안 올라간다"고
 *   말하는 것은 사용자에게 자기가 한 일을 부정하는 것이다.
 */
export function learnStack(base: StackLoading, guess: StepGuess | null): StackLoading {
  if (!guess) return base;

  const finer = guess.stepKg !== null && guess.stepKg < base.stepKg;
  const learned = guess.stepKg !== null && (finer || guess.samples >= COARSE_SAMPLES);
  const stepKg = learned ? guess.stepKg! : base.stepKg;

  const floor = Math.min(base.minKg, guess.lightestKg);
  const maxKg = Math.max(base.maxKg, guess.heaviestKg);

  /*
   * 격자를 관찰값에 꿰어 맞춘다.
   *
   * 이게 없으면 끝만 넓히고 정작 그 무게는 못 만든다. 7kg 기계에서 49를
   * 봤는데 격자가 5·12·19…면 49가 목록에 없다. 사용자가 **실제로 든**
   * 무게를 "그 기계는 그거 못 만든다"고 하는 셈이다.
   *
   * 최대공약수로 구한 간격이라 관찰값끼리는 서로 간격의 배수만큼 떨어져
   * 있다. 그래서 하나만 꿰면 전부 꿰인다.
   *
   * 간격을 못 배웠으면 꿰지 않는다. 한 번 본 값 하나 때문에 격자 전체를
   * 옮기는 것은 근거에 비해 과하다 — 범위만 넓히고 만다.
   */
  const offset = learned ? ((guess.lightestKg - floor) % stepKg + stepKg) % stepKg : 0;
  const minKg = learned ? floor + offset : floor;

  /*
   * 보조추는 **격자에 맞을 때만** 남긴다.
   *
   * 5kg 간격에 2.5kg 보조추는 5·7.5·10…을 만든다. 고른 격자라 괜찮고,
   * 오히려 이게 있어야 고립 운동을 2.5kg씩 올릴 수 있다. 5kg씩 뛰면
   * 너무 크다.
   *
   * 7kg 간격에 2.5kg 보조추는 7·9.5·14·16.5…가 된다. 들쭉날쭉하고,
   * 그 기계가 저런 무게를 만든다는 근거도 없다. 그건 버린다.
   *
   * 안 쓴 보조추를 남기는 쪽이 있는 보조추를 버리는 쪽보다 낫다 —
   * 앞은 한 번 반올림하면 끝이고, 뒤는 진행이 영영 거칠어진다.
   */
  const addOnKg = (base.addOnKg ?? []).filter((addOn) => {
    const units = Math.round(addOn * GRID);
    const stepUnits = Math.round(stepKg * GRID);
    return units > 0 && stepUnits % units === 0;
  });

  const sameAddOns = addOnKg.length === (base.addOnKg ?? []).length;
  if (stepKg === base.stepKg && minKg === base.minKg && maxKg === base.maxKg && sameAddOns) {
    return base;
  }

  return { ...base, minKg, stepKg, maxKg, addOnKg };
}

/** 이 종목에 간격 읽기를 적용할 수 있는가. 바벨·덤벨은 간격이 이미 분명하다. */
export function learnable(exercise: Exercise): boolean {
  return isGymSpecific(exercise);
}
