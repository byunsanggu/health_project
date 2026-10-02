/*
 * MachineId·FIRST_MACHINE·machineOf는 gymWeight.ts에 있다.
 *
 * 여기 두면 gymWeight ↔ machine 순환 참조가 된다 — 중량 이력을 고르는
 * 쪽(weightHistoryFor)이 기계를 읽어야 하고, 기계 쪽은 "이 종목이 기계냐"를
 * 물어야 하기 때문이다. 더 아래에 있는 쪽에 둔다.
 */
import { FIRST_MACHINE, isGymSpecific, machineOf, type MachineId } from './gymWeight.ts';
import { withParticle } from './korean.ts';
import type { Exercise, SessionLog, SetLog } from './types.ts';

/**
 * 같은 헬스장, 같은 종목, 다른 기계.
 *
 * 체스트프레스가 해머스트렝스랑 셀렉토라이즈드 두 대 있는 헬스장은 흔하다.
 * 지금까지는 헬스장으로만 이력을 나눴기 때문에 두 기계의 기록이 한 줄로
 * 섞였다. 80kg과 140kg이 번갈아 들어오면 중량 처방이 망가진다 — 지난번이
 * 140이면 다음은 142.5를 주는데, 오늘 선 기계는 80짜리다.
 *
 * 기계마다 이름을 붙이게 하지 않는다. 등록 화면에서 "기계 목록을 적으세요"를
 * 만나면 사람들은 거기서 앱을 닫는다. 대신 **실제로 어긋났을 때 한 번만
 * 물어본다.** 문제가 안 생기는 사람은 이 기능의 존재도 모른다.
 */

/** 처방과 실제가 이만큼 벌어지면 다른 기계를 의심한다. */
export const SPLIT_GAP = 0.25;

/**
 * 비율만 보면 가벼운 종목에서 계속 묻게 된다.
 *
 * 케이블 레터럴레이즈 7kg → 10kg은 43%지만 3kg 차이다. 그건 기계가 달라서가
 * 아니라 그냥 올린 것이다.
 */
export const SPLIT_MIN_KG = 5;

/** 다음 기계 열쇠. a, b, c… */
export function nextMachineId(used: readonly MachineId[]): MachineId {
  const taken = new Set(used);
  for (let i = 0; i < 26; i += 1) {
    const id = String.fromCharCode(97 + i);
    if (!taken.has(id)) return id;
  }
  return `m${used.length + 1}`;
}

/* ── 어떤 기계를 써 왔는가 ─────────────────────── */

export interface MachineSeen {
  id: MachineId;
  /** 최근 본세트 무게. 사용자가 기계를 알아보는 단서다 */
  lastKg: number | null;
  /** 마지막으로 쓴 날 (YYYY-MM-DD) */
  lastDate: string | null;
  /** 이 기계로 한 세션 수 */
  sessions: number;
}

/**
 * 이 헬스장에서 이 종목에 써 온 기계들.
 *
 * 헬스장을 모르면 빈 배열이다. 나눌 근거가 없는데 나눠 보여주면
 * 거짓말이 된다.
 */
export function machinesFor(
  sessions: readonly SessionLog[],
  exerciseId: string,
  gymId?: string,
): MachineSeen[] {
  if (!gymId) return [];

  const found = new Map<MachineId, MachineSeen>();

  for (const session of sessions) {
    if (session.gymId !== gymId) continue;
    const perMachine = new Map<MachineId, SetLog[]>();

    for (const set of session.sets) {
      if (set.exerciseId !== exerciseId || set.warmup) continue;
      const id = machineOf(set);
      const list = perMachine.get(id) ?? [];
      list.push(set);
      perMachine.set(id, list);
    }

    for (const [id, sets] of perMachine) {
      const top = sets.reduce((best, set) => (set.weightKg > best.weightKg ? set : best));
      const previous = found.get(id);
      // 세션은 날짜순이라고 보장할 수 없다. 날짜로 비교해서 최신을 남긴다.
      const newer = !previous || !previous.lastDate || session.date >= previous.lastDate;
      found.set(id, {
        id,
        lastKg: newer ? top.weightKg : previous!.lastKg,
        lastDate: newer ? session.date : previous!.lastDate,
        sessions: (previous?.sessions ?? 0) + 1,
      });
    }
  }

  return [...found.values()].sort((a, b) => (a.id < b.id ? -1 : 1));
}

/**
 * 기록에서 찾은 기계 + 안다고 적어 둔 기계.
 *
 * 기계를 나눴다는 것은 **그 헬스장에 대한 사실**이지 오늘 세트에 대한
 * 사실이 아니다. 기록에서만 뽑으면, 나눈 당일에 다시 원래 기계로
 * 돌려놓는 순간 새 기계가 흔적도 없이 사라진다 — 나눠 달라고 한 사람이
 * 보기에는 그냥 없어진 것이다.
 *
 * 그래서 한 번 나눈 기계는 세트가 하나도 없어도 목록에 남는다.
 */
export function mergeKnownMachines(
  seen: readonly MachineSeen[],
  known: readonly MachineId[],
): MachineSeen[] {
  const out = [...seen];
  for (const id of known) {
    if (out.some((item) => item.id === id)) continue;
    out.push({ id, lastKg: null, lastDate: null, sessions: 0 });
  }
  return out.sort((a, b) => (a.id < b.id ? -1 : 1));
}

/**
 * 기계 이름.
 *
 * "A 기계 / B 기계"는 아무 뜻이 없다. 사람은 기계를 무게로 기억한다 —
 * "아, 100 꽂던 그거." 그래서 최근 무게를 그대로 이름으로 쓴다.
 *
 * 그리고 이 이름은 갈라진 이유가 무게 차이이기 때문에 **구조적으로
 * 서로 다를 수밖에 없다.** 따로 지어 줄 필요가 없다.
 */
export function machineLabel(seen: MachineSeen): string {
  if (seen.lastKg === null) return '처음 쓰는 기계';
  const kg = Math.round(seen.lastKg * 10) / 10;
  return `${kg}kg 쓰던 것`;
}

/* ── 물어볼 때 ─────────────────────────────────── */

export interface SplitAskInput {
  exercise: Exercise;
  /** 지금 있는 헬스장. 모르면 묻지 않는다 */
  gymId?: string;
  /** 처방했던 무게 */
  plannedKg: number | null;
  /** 실제로 적은 무게 */
  loggedKg: number;
  warmup?: boolean;
  /** 처방 자체가 추정이었는가. 추정은 원래 틀리므로 묻지 않는다 */
  estimated?: boolean;
  /** 이 종목에 대해 이미 "같은 기계예요"라고 답했는가 */
  dismissed?: boolean;
  /** 오늘 이미 기계를 골랐는가 */
  picked?: boolean;
}

/** 처방과 실제가 얼마나 벌어졌는가. 0.25면 25%. */
export function splitGap(plannedKg: number, loggedKg: number): number {
  if (plannedKg <= 0) return 0;
  return Math.abs(loggedKg - plannedKg) / plannedKg;
}

/**
 * 물어볼까.
 *
 * 안 묻는 쪽에 무게를 둔다. 잘못 물으면 매 세트가 설문이 되고, 그러면
 * 사람들은 읽지 않고 아무거나 누른다 — 그때부터 이 기능은 기록을 망치는
 * 쪽으로 돈다.
 */
export function shouldAskSplit(input: SplitAskInput): boolean {
  if (input.warmup) return false;
  if (input.dismissed || input.picked) return false;
  // 바벨 100kg은 어디서나 100kg이다. 기계가 아닌 종목은 나눌 것이 없다.
  if (!isGymSpecific(input.exercise)) return false;
  if (!input.gymId) return false;
  // 첫 수행의 추정값과 비교해서 "다른 기계"라고 하면 그건 그냥 추정이 틀린 것이다.
  if (input.estimated) return false;
  if (input.plannedKg === null || input.plannedKg <= 0) return false;
  if (input.loggedKg <= 0) return false;

  if (Math.abs(input.loggedKg - input.plannedKg) < SPLIT_MIN_KG) return false;
  return splitGap(input.plannedKg, input.loggedKg) >= SPLIT_GAP;
}

/**
 * 물어보는 말.
 *
 * 틀렸다고 하지 않는다. 사용자가 적은 무게는 사용자가 실제로 든 무게다 —
 * 앱이 의심할 것은 사용자가 아니라 자기 처방이다.
 */
export function splitQuestion(
  exerciseName: string,
  plannedKg: number,
  loggedKg: number,
): string {
  const planned = Math.round(plannedKg * 10) / 10;
  const logged = Math.round(loggedKg * 10) / 10;
  // "랫풀다운는"이 되면 안 된다. 받침을 보고 고른다.
  return `${withParticle(exerciseName, '은/는')} ${planned}kg으로 하시던 건데 ` +
    `${logged}kg을 적으셨습니다. 다른 기계인가요?`;
}
