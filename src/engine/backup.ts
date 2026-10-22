import { EXERCISES } from './exercises.ts';
import { normalizeFoodLog, type FoodEntry } from './foodLog.ts';
import { TRAINING_STYLES } from './styles.ts';
import type { ConsentId } from './consent.ts';
import type { GymBook, GymEntry } from './gyms.ts';
import type { OnboardingAnswers, TrainingProgram } from './onboarding.ts';
import type { LifterProfile } from './strength.ts';
import type { CardioEntry, CheckIn, Joint, PainReport, SessionLog, SetLog, TrainingLevel } from './types.ts';

/**
 * 백업 파일.
 *
 * "내 데이터 내려받기"로 받은 JSON을 다시 들여온다. 서버 계정 없이 폰을 바꾸거나
 * 저장소를 지운 사람이 기록을 되찾는 길이다 — 내려받기만 있고 불러오기가 없으면
 * 그 파일은 읽을 수만 있는 영수증이다.
 *
 * 파일은 믿지 않는다. 예전 판 앱이 쓴 것일 수도, 손으로 고친 것일 수도 있다.
 * 모양이 틀린 기록은 하나씩 버리고 몇 개를 버렸는지 센다. 통째로 거절하는 건
 * 우리 파일이 아니거나 읽을 수 없는 파일일 때뿐이다.
 */

export const BACKUP_APP = '볼륨 코치';

/** 파일 형식. 칸을 바꾸면 올린다 — 더 새 형식은 읽지 않는다(모르는 칸을 잘못 읽느니 묻는다). */
export const BACKUP_FORMAT = 2;

/**
 * 백업에 싣는 설정 — 사람이 고른 것과 쌓인 것.
 *
 * 오늘 하던 운동(세트 · 순서 · 어디까지 했는지) 같은 하루치는 싣지 않는다. 다른 날
 * 불러오면 틀린 값이다. 친구 코드 · 동기화 시각처럼 이 폰 · 이 계정에 묶인 것도 뺀다.
 */
export const BACKUP_SETTING_KEYS: readonly string[] = [
  'style', 'blockHistory', 'block', 'startedOn', 'promise', 'timeBudget', 'coach',
  'restBand', 'restOverrides', 'restAlerts', 'voiceOn', 'voiceRate', 'autoCount', 'nudgeOn',
  'tempo', 'tempoByExercise', 'tempoVersion', 'machineSettings', 'machineKnown', 'machinePound',
  'mistakeFlags', 'diet',
];

export interface Backup {
  /** 내보낸 날 (YYYY-MM-DD). 모르면 null */
  exportedAt: string | null;
  format: number;
  /** 설문 답. 모양이 틀리면 null — 그러면 설문을 다시 한다 */
  answers: OnboardingAnswers | null;
  /** 프로그램. 지금 앱에 없는 종목이 있거나 모양이 틀리면 null — 설문 답으로 다시 짠다 */
  program: TrainingProgram | null;
  lifter: LifterProfile | null;
  gymBook: GymBook | null;
  sessions: SessionLog[];
  checkIns: CheckIn[];
  foodLog: FoodEntry[];
  /** BACKUP_SETTING_KEYS 중 모양이 맞는 것만 */
  settings: Record<string, unknown>;
  /** 모양이 틀려 버린 것 */
  dropped: { sessions: number; sets: number; checkIns: number };
}

export type BackupResult = { ok: true; backup: Backup } | { ok: false; reason: string };

/* ── 모양 검사 ─────────────────────────────────────────── */

type Plain = Record<string, unknown>;

const LEVELS: readonly TrainingLevel[] = ['beginner', 'intermediate', 'advanced', 'expert'];
const GOALS: readonly string[] = ['hypertrophy', 'strength', 'fatLoss', 'general'];
const SEXES: readonly string[] = ['male', 'female', 'unspecified'];
const JOINTS: readonly Joint[] = ['neck', 'shoulder', 'elbow', 'wrist', 'lowBack', 'hip', 'knee', 'ankle'];
const COACH_MODES: readonly string[] = ['pt', 'solo'];
const COACH_STYLE_IDS: readonly string[] = ['calm', 'fired', 'data'];
const EXERCISE_IDS = new Set(EXERCISES.map((exercise) => exercise.id));

function isPlain(value: unknown): value is Plain {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isNumber(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}

function isInteger(value: unknown, min: number, max: number): value is number {
  return isNumber(value, min, max) && Number.isInteger(value);
}

function isText(value: unknown, max = 200): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max;
}

function isTexts(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

/** 실제로 있는 날짜인가 — "2026-02-30"은 Date.parse가 3월 2일로 넘긴다. */
export function isCalendarDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const time = Date.parse(value + 'T00:00:00Z');
  return !Number.isNaN(time) && new Date(time).toISOString().slice(0, 10) === value;
}

function readSet(raw: unknown): SetLog | null {
  if (!isPlain(raw)) return null;
  if (!isText(raw.exerciseId, 80)) return null;
  if (!isNumber(raw.weightKg, 0, 1000) || !isNumber(raw.reps, 0, 500) || !isNumber(raw.rir, 0, 10)) return null;
  const set: SetLog = { exerciseId: raw.exerciseId, weightKg: raw.weightKg, reps: Math.round(raw.reps), rir: raw.rir };
  if (raw.warmup === true) set.warmup = true;
  if (isText(raw.machine, 80)) set.machine = raw.machine;
  return set;
}

function readCardio(raw: unknown): CardioEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((item): item is CardioEntry =>
    isPlain(item) && isText(item.exerciseId, 80) && isNumber(item.minutes, 0, 1440) && typeof item.zone === 'string');
}

function readSession(raw: unknown, dropped: Backup['dropped']): SessionLog | null {
  if (!isPlain(raw) || raw.deleted === true || !isCalendarDate(raw.date) || !Array.isArray(raw.sets)) return null;
  const sets: SetLog[] = [];
  for (const item of raw.sets) {
    const set = readSet(item);
    if (set) sets.push(set);
    else dropped.sets += 1;
  }
  const cardio = readCardio(raw.cardio);
  const wod = Array.isArray(raw.wod) ? raw.wod.filter(isPlain) : [];
  // 남은 것이 없으면 운동한 날이 아니다
  if (sets.length === 0 && cardio.length === 0 && wod.length === 0) return null;
  const session: SessionLog = { date: raw.date, sets };
  if (isText(raw.id, 120)) session.id = raw.id;
  if (isText(raw.gymId, 120)) session.gymId = raw.gymId;
  if (cardio.length > 0) session.cardio = cardio;
  if (wod.length > 0) session.wod = wod;
  return session;
}

function readPain(raw: unknown): PainReport[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item) => isPlain(item) && JOINTS.includes(item.joint as Joint) && isNumber(item.score, 0, 10))
    .map((item) => ({ joint: (item as Plain).joint as Joint, score: (item as Plain).score as number }));
}

function readCheckIn(raw: unknown): CheckIn | null {
  if (!isPlain(raw) || raw.deleted === true || !isCalendarDate(raw.date)) return null;
  const entry: CheckIn = { date: raw.date };
  if (isText(raw.id, 120)) entry.id = raw.id;
  if (isNumber(raw.bodyweightKg, 20, 400)) entry.bodyweightKg = raw.bodyweightKg;
  if (typeof raw.proteinHit === 'boolean') entry.proteinHit = raw.proteinHit;
  if (isNumber(raw.sleepHours, 0, 24)) entry.sleepHours = raw.sleepHours;
  if (isNumber(raw.soreness, 0, 10)) entry.soreness = raw.soreness;
  if (isNumber(raw.stress, 0, 10)) entry.stress = raw.stress;
  if (isNumber(raw.motivation, 0, 10)) entry.motivation = raw.motivation;
  const pain = readPain(raw.pain);
  if (pain.length > 0) entry.pain = pain;
  return entry;
}

function readAnswers(raw: unknown): OnboardingAnswers | null {
  if (!isPlain(raw)) return null;
  if (!LEVELS.includes(raw.selfReportedLevel as TrainingLevel)) return null;
  if (!isNumber(raw.bodyweightKg, 20, 400) || !isInteger(raw.daysPerWeek, 1, 7)) return null;
  if (!Array.isArray(raw.goals) || raw.goals.length === 0 || !raw.goals.every((goal) => GOALS.includes(goal as string))) return null;
  const gym = raw.gym;
  if (!isPlain(gym) || !isTexts(gym.equipmentIds)) return null;

  const answers: OnboardingAnswers = {
    selfReportedLevel: raw.selfReportedLevel as TrainingLevel,
    bodyweightKg: raw.bodyweightKg,
    daysPerWeek: raw.daysPerWeek,
    goals: raw.goals as OnboardingAnswers['goals'],
    gym: {
      equipmentIds: gym.equipmentIds.slice(),
      ...(isPlain(gym.measurements) ? { measurements: gym.measurements as never } : {}),
      ...(Array.isArray(gym.plates) && gym.plates.every((plate) => isNumber(plate, 0, 100)) ? { plates: gym.plates as number[] } : {}),
    },
  };
  if (isNumber(raw.monthsTraining, 0, 1200)) answers.monthsTraining = raw.monthsTraining;
  if (SEXES.includes(raw.sex as string)) answers.sex = raw.sex as OnboardingAnswers['sex'];
  const pain = readPain(raw.pain);
  if (pain.length > 0) answers.pain = pain;
  if (isTexts(raw.priorities)) answers.priorities = raw.priorities.slice(0, 2) as OnboardingAnswers['priorities'];
  if (isPlain(raw.mainLifts) && Object.values(raw.mainLifts).every((id) => typeof id === 'string' && EXERCISE_IDS.has(id))) {
    answers.mainLifts = { ...(raw.mainLifts as OnboardingAnswers['mainLifts']) };
  }
  return answers;
}

/**
 * 프로그램은 지금 앱의 종목으로만 짜여 있어야 한다. 예전 판에 있다가 빠진 종목이
 * 하나라도 있으면 그 날 세션을 못 만든다 — 그럴 땐 버리고 설문 답으로 다시 짠다.
 */
function readProgram(raw: unknown): TrainingProgram | null {
  if (!isPlain(raw) || typeof raw.name !== 'string' || !isInteger(raw.daysPerWeek, 1, 7)) return null;
  if (!Array.isArray(raw.templates) || raw.templates.length === 0) return null;
  const templatesOk = raw.templates.every((template) =>
    isPlain(template) && typeof template.name === 'string' &&
    (template.setCap === undefined || isNumber(template.setCap, 1, 100)) &&
    Array.isArray(template.slots) && template.slots.length > 0 &&
    template.slots.every((slot) =>
      isPlain(slot) && typeof slot.exerciseId === 'string' && EXERCISE_IDS.has(slot.exerciseId) &&
      isInteger(slot.sets, 1, 20) && isPlain(slot.repRange) &&
      isInteger(slot.repRange.min, 1, 100) && isInteger(slot.repRange.max, 1, 100) &&
      (slot.repRange.min as number) <= (slot.repRange.max as number)));
  if (!templatesOk) return null;
  if (!isPlain(raw.weeklyTargets) || !Object.values(raw.weeklyTargets).every((value) => isNumber(value, 0, 100))) return null;
  return raw as unknown as TrainingProgram;
}

function readLifter(raw: unknown): LifterProfile | null {
  if (!isPlain(raw) || !isNumber(raw.bodyweightKg, 20, 400) || !LEVELS.includes(raw.level as TrainingLevel)) return null;
  const lifter: LifterProfile = { bodyweightKg: raw.bodyweightKg, level: raw.level as TrainingLevel };
  if (SEXES.includes(raw.sex as string)) lifter.sex = raw.sex as LifterProfile['sex'];
  return lifter;
}

function readGymBook(raw: unknown): GymBook | null {
  if (!isPlain(raw) || !Array.isArray(raw.gyms)) return null;
  // 헬스장은 여러 길(검색 · 직접 등록 · 예시)로 들어와 칸이 제각각이다. 뼈대만 본다.
  const gyms = raw.gyms.filter((gym): gym is GymEntry =>
    isPlain(gym) && isText(gym.id, 120) && typeof gym.name === 'string' && isTexts(gym.equipmentIds));
  if (gyms.length === 0) return null;
  const activeId = gyms.some((gym) => gym.id === raw.activeId) ? (raw.activeId as string) : gyms[0]!.id;
  return { gyms, activeId };
}

function isBlock(value: unknown): boolean {
  if (!isPlain(value)) return false;
  if (!isInteger(value.number, 1, 1000) || !isCalendarDate(value.startedOn) || !isCalendarDate(value.firstStartedOn)) return false;
  if (!LEVELS.includes(value.level as TrainingLevel) || !isNumber(value.monthsAtStart, 0, 1200)) return false;
  const transition = value.transition;
  if (transition != null && !(isPlain(transition) && LEVELS.includes(transition.to as TrainingLevel) && isInteger(transition.step, 0, 10))) return false;
  if (value.technicalIntroduced != null && !isTexts(value.technicalIntroduced)) return false;
  return value.deloadOn == null || isCalendarDate(value.deloadOn);
}

const SETTING_CHECKS: Record<string, (value: unknown) => boolean> = {
  style: (value) => TRAINING_STYLES.includes(value as never),
  blockHistory: (value) => isTexts(value) && value.every((style) => TRAINING_STYLES.includes(style as never)),
  block: isBlock,
  startedOn: isCalendarDate,
  promise: (value) => Array.isArray(value) &&
    value.every((slot) => isPlain(slot) && isInteger(slot.weekday, 0, 6) && isNumber(slot.minutes, 1, 600)),
  timeBudget: (value) => isNumber(value, 5, 600),
  coach: (value) => isPlain(value) && COACH_MODES.includes(value.mode as string) && COACH_STYLE_IDS.includes(value.style as string),
  restBand: (value) => isPlain(value) && isNumber(value.minSeconds, 0, 3600) && isNumber(value.maxSeconds, 0, 3600) &&
    (value.minSeconds as number) <= (value.maxSeconds as number),
  restOverrides: (value) => isPlain(value) && Object.values(value).every((seconds) => isNumber(seconds, 0, 3600)),
  restAlerts: (value) => typeof value === 'boolean',
  voiceOn: (value) => typeof value === 'boolean',
  voiceRate: (value) => isNumber(value, 0.5, 2),
  autoCount: (value) => typeof value === 'boolean',
  nudgeOn: (value) => typeof value === 'boolean',
  tempo: isPlain,
  tempoByExercise: (value) => isPlain(value) && Object.values(value).every(isPlain),
  tempoVersion: (value) => isInteger(value, 1, 1000),
  machineSettings: (value) => isPlain(value) && Object.values(value).every((text) => typeof text === 'string'),
  machineKnown: (value) => isPlain(value) && Object.values(value).every(isTexts),
  machinePound: (value) => isPlain(value) && Object.values(value).every((flag) => typeof flag === 'boolean'),
  mistakeFlags: (value) => isPlain(value) && Object.values(value).every(isTexts),
  // 앱이 normalizeDiet로 다시 고른다
  diet: isPlain,
};

function readSettings(raw: unknown): Record<string, unknown> {
  if (!isPlain(raw)) return {};
  const out: Record<string, unknown> = {};
  for (const key of BACKUP_SETTING_KEYS) {
    const check = SETTING_CHECKS[key];
    if (raw[key] !== undefined && raw[key] !== null && check && check(raw[key])) out[key] = raw[key];
  }
  return out;
}

/* ── 읽기 ──────────────────────────────────────────────── */

export function readBackup(text: string): BackupResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, reason: '파일을 읽을 수 없습니다. "내 데이터 내려받기"로 받은 JSON 파일인지 확인해 주세요.' };
  }
  const notOurs: BackupResult = { ok: false, reason: '볼륨 코치에서 내려받은 백업 파일이 아닙니다.' };
  if (!isPlain(raw)) return notOurs;
  if (!Array.isArray(raw['운동기록']) && !isPlain(raw['설문']) && !isPlain(raw['프로그램'])) return notOurs;

  // 형식 칸이 없으면 첫 형식(설정 · 형식 칸이 생기기 전)이다
  const format = raw['형식'] === undefined ? 1 : raw['형식'];
  if (!isInteger(format, 1, 1000)) return notOurs;
  if (format > BACKUP_FORMAT) {
    return { ok: false, reason: '더 새 판 앱에서 만든 파일입니다. 앱을 새로 고친 뒤 다시 불러와 주세요.' };
  }

  const dropped = { sessions: 0, sets: 0, checkIns: 0 };

  // 같은 날이 두 번 있으면 본세트가 더 많은 쪽을 둔다 — 하루는 기록 하나다
  const byDate = new Map<string, SessionLog>();
  for (const item of Array.isArray(raw['운동기록']) ? raw['운동기록'] : []) {
    const session = readSession(item, dropped);
    if (!session) {
      dropped.sessions += 1;
      continue;
    }
    const seen = byDate.get(session.date);
    if (!seen || workingSets(session) > workingSets(seen)) byDate.set(session.date, session);
  }
  const sessions = [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  const checkInsByDate = new Map<string, CheckIn>();
  for (const item of Array.isArray(raw['체크인']) ? raw['체크인'] : []) {
    const entry = readCheckIn(item);
    if (entry) checkInsByDate.set(entry.date, entry);
    else dropped.checkIns += 1;
  }

  const gyms = isPlain(raw['헬스장']) ? raw['헬스장'] : {};
  const exported = typeof raw['내보낸시각'] === 'string' ? raw['내보낸시각'].slice(0, 10) : null;

  return {
    ok: true,
    backup: {
      exportedAt: isCalendarDate(exported) ? exported : null,
      format,
      answers: readAnswers(raw['설문']),
      program: readProgram(raw['프로그램']),
      lifter: readLifter(raw['신체']),
      gymBook: readGymBook(gyms['목록']),
      sessions,
      checkIns: [...checkInsByDate.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)),
      foodLog: normalizeFoodLog(raw['식단기록']).filter((entry) => isCalendarDate(entry.date)),
      settings: readSettings(raw['설정']),
      dropped,
    },
  };
}

function workingSets(session: SessionLog): number {
  return session.sets.filter((set) => !set.warmup && set.reps > 0).length;
}

/* ── 동의 ──────────────────────────────────────────────── */

/**
 * 지금 이 폰에서 받은 동의만큼만 들인다.
 *
 * 파일 안의 동의 기록은 쓰지 않는다 — 그건 예전에 그 폰에서 한 동의다. 통증 기록에
 * 동의하지 않았으면 통증 점수를 빼고, 식단 기록에 동의하지 않았으면 식단을 뺀다.
 * 동의 없이 민감정보를 들여놓으면, 내려받기 파일 하나로 동의를 건너뛰는 길이 된다.
 */
export function backupWithConsent(
  backup: Backup,
  given: readonly ConsentId[],
): { backup: Backup; removed: { pains: number; food: number } } {
  const painOk = given.includes('painData');
  const foodOk = given.includes('dietLog');
  let pains = 0;
  const checkIns = backup.checkIns.map((entry) => {
    if (painOk || !entry.pain) return entry;
    pains += 1;
    const { pain: _pain, ...rest } = entry;
    return rest;
  });
  let answers = backup.answers;
  if (!painOk && answers?.pain) {
    const { pain: _pain, ...rest } = answers;
    answers = rest;
  }
  return {
    backup: { ...backup, answers, checkIns, foodLog: foodOk ? backup.foodLog : [] },
    removed: { pains, food: foodOk ? 0 : backup.foodLog.length },
  };
}

/* ── 합치기 ────────────────────────────────────────────── */

export interface BackupMerge {
  /** 새로 넣을 것 */
  sessions: SessionLog[];
  checkIns: CheckIn[];
  foodLog: FoodEntry[];
  /** 이 폰에 같은 날 · 같은 줄이 있어서 이 폰 것을 둔 수 */
  kept: { sessions: number; checkIns: number; food: number };
}

/**
 * 이 폰의 기록과 합친다 — 빠진 날만 채운다.
 *
 * 같은 날이 이 폰에도 있으면 이 폰 것을 둔다. 불러오기가 이 폰에서 방금 한 운동을
 * 덮어쓰면, 백업을 불러온 사람이 오늘 기록을 잃는다. 내일 이후 날짜(시계가 틀린
 * 폰에서 온 것)는 들이지 않는다.
 */
export function mergeBackup(
  local: { sessions: readonly SessionLog[]; checkIns: readonly CheckIn[]; foodLog: readonly FoodEntry[] },
  backup: Backup,
  today: string,
): BackupMerge {
  const sessionDays = new Set(local.sessions.filter((item) => !item.deleted).map((item) => item.date));
  const checkInDays = new Set(local.checkIns.filter((item) => !item.deleted).map((item) => item.date));
  const foodIds = new Set(local.foodLog.map((entry) => entry.id));
  const kept = { sessions: 0, checkIns: 0, food: 0 };

  const sessions = backup.sessions.filter((session) => {
    if (session.date > today) return false;
    if (sessionDays.has(session.date)) {
      kept.sessions += 1;
      return false;
    }
    return true;
  });
  const checkIns = backup.checkIns.filter((entry) => {
    if (entry.date > today) return false;
    if (checkInDays.has(entry.date)) {
      kept.checkIns += 1;
      return false;
    }
    return true;
  });
  const foodLog = backup.foodLog.filter((entry) => {
    if (entry.date > today) return false;
    if (foodIds.has(entry.id)) {
      kept.food += 1;
      return false;
    }
    return true;
  });
  return { sessions, checkIns, foodLog, kept };
}

/* ── 보여 주기 ─────────────────────────────────────────── */

export interface BackupSummary {
  exportedAt: string | null;
  /** 운동한 날 */
  days: number;
  first: string | null;
  last: string | null;
  /** 본세트 수 */
  sets: number;
  checkIns: number;
  /** 체중을 적은 날 */
  weights: number;
  /** 통증을 적은 날 */
  pains: number;
  food: number;
  /** 설문 · 프로그램이 온전히 들어 있나 — 있으면 설문 없이 이어 한다 */
  program: boolean;
  /** 모양이 틀려 뺀 세트 · 날 */
  dropped: number;
}

export function backupSummary(backup: Backup): BackupSummary {
  const dates = backup.sessions.map((session) => session.date);
  return {
    exportedAt: backup.exportedAt,
    days: backup.sessions.length,
    first: dates[0] ?? null,
    last: dates[dates.length - 1] ?? null,
    sets: backup.sessions.reduce((sum, session) => sum + workingSets(session), 0),
    checkIns: backup.checkIns.length,
    weights: backup.checkIns.filter((entry) => entry.bodyweightKg !== undefined).length,
    pains: backup.checkIns.filter((entry) => (entry.pain ?? []).some((item) => item.score > 0)).length,
    food: backup.foodLog.length,
    program: Boolean(backup.answers),
    dropped: backup.dropped.sessions + backup.dropped.sets + backup.dropped.checkIns,
  };
}

/** 이 백업으로 시작한 날 — 저장된 시작일, 없으면 가장 이른 운동 날. */
export function backupStartDate(backup: Backup): string | null {
  const saved = backup.settings.startedOn;
  const first = backup.sessions[0]?.date ?? null;
  if (typeof saved === 'string' && (!first || saved <= first)) return saved;
  return first;
}
