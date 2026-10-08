/**
 * 파운드 표기 기계.
 *
 * 수입 기계는 스택에 파운드가 찍혀 있다. 거기 "90"이 보인다고 90을 적으면
 * 앱에는 90kg이 들어간다 — **실제의 2.2배다.** 그 종목의 주간 볼륨도,
 * 추정 1RM도, 다른 종목과의 비교도 전부 틀어진다.
 *
 * 기록은 늘 kg으로 남긴다. 화면과 입력만 파운드로 바꾼다 — 사용자는
 * 기계에 적힌 숫자를 그대로 보고 그대로 치면 된다.
 */

/** 1파운드 = 0.45359237kg. 정의값이라 반올림하지 않는다. */
export const KG_PER_LB = 0.45359237;

/**
 * 기록에 남기는 자리수.
 *
 * 0.1kg까지 남긴다. 파운드를 변환하면 끝이 길어지는데(45lb = 20.4117kg)
 * 그대로 두면 화면에 20.4117이 뜬다. 자르되, 되돌렸을 때 원래 파운드
 * 값이 나올 만큼은 남긴다.
 */
const KG_PLACES = 1;

/** 파운드 기계의 스택은 보통 5 또는 10파운드 단위다. */
export const LB_STEP = 5;

function round(value: number, places: number): number {
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
}

export function lbToKg(lb: number): number {
  return round(lb * KG_PER_LB, KG_PLACES);
}

/**
 * kg을 파운드로.
 *
 * 0.5파운드까지만 보여준다. 기계에 찍힌 숫자는 정수인데 44.97 같은 값을
 * 띄우면 사용자가 자기가 본 것과 다르다고 느낀다.
 */
export function kgToLb(kg: number): number {
  return round(kg / KG_PER_LB, 1) === Math.round(kg / KG_PER_LB)
    ? Math.round(kg / KG_PER_LB)
    : round(kg / KG_PER_LB * 2, 0) / 2;
}

/** 파운드 격자에 맞춘다. 스택은 5파운드씩 움직인다. */
export function snapLb(lb: number, step: number = LB_STEP): number {
  if (!(step > 0)) return Math.round(lb);
  return Math.round(lb / step) * step;
}

/**
 * 파운드 쪽에서 한 칸 움직인다.
 *
 * kg 격자로 움직인 뒤 파운드로 보여주면 45 → 54.9처럼 어긋난 숫자가
 * 나온다. 파운드 기계에서는 파운드로 세어야 기계에 찍힌 숫자와 맞는다.
 */
export function stepLbFromKg(kg: number, direction: number, step: number = LB_STEP): number {
  const next = snapLb(kgToLb(kg), step) + direction * step;
  return lbToKg(Math.max(step, next));
}

/** 화면에 쓸 한 줄. 단위까지 붙여 준다. */
export function weightLabelIn(kg: number, pounds: boolean): string {
  if (!pounds) {
    const value = round(kg, KG_PLACES);
    return (Number.isInteger(value) ? String(value) : value.toFixed(1)) + 'kg';
  }
  const lb = kgToLb(kg);
  return (Number.isInteger(lb) ? String(lb) : lb.toFixed(1)) + 'lb';
}
