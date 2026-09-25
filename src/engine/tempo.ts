import type { RepRange } from './load.ts';

/**
 * 템포와 음성 카운트.
 *
 * 혼자 운동하면 두 가지가 무너진다. 하나는 속도 — 힘들어지면 저절로
 * 빨라지고, 빨라지면 반동이 붙어서 같은 10회가 다른 10회가 된다. 다른
 * 하나는 수 — 여덟인지 아홉인지 헷갈리면 거기서 세트를 끝낸다.
 *
 * 옆에서 세어 주는 사람이 있으면 둘 다 해결된다. 그게 트레이너가 하는
 * 일의 절반이고, 이 모듈이 그 절반을 대신한다.
 *
 * **다만 앱은 관장님이 실제로 몇 개를 했는지 모른다.** 카메라도 센서도
 * 없다. 그래서 여기서 나오는 건 "기록"이 아니라 "박자"다. 박자를 주고,
 * 멈춘 자리까지를 기록으로 제안한다 — 그 이상을 아는 척하면 거짓말이다.
 */

/**
 * 템포 표기. 현장에서 쓰는 네 자리 그대로다.
 *
 * `3-1-1-0` = 3초에 내리고 · 아래에서 1초 멈추고 · 1초에 올리고 · 위에서 0초.
 * 첫 자리가 내리는 구간(신장성)인 것이 표준이다.
 */
export interface Tempo {
  /** 내리는 구간 — 근비대에서 제일 중요한 자리 */
  eccentric: number;
  /** 아래에서 멈춤 */
  bottom: number;
  /** 올리는 구간 */
  concentric: number;
  /** 위에서 멈춤 */
  top: number;
}

export const DEFAULT_TEMPO: Tempo = { eccentric: 2, bottom: 0, concentric: 1, top: 0 };

export const TEMPO_PRESETS: readonly {
  id: string;
  label: string;
  tempo: Tempo;
  note: string;
}[] = [
  {
    id: 'standard',
    label: '기본',
    tempo: DEFAULT_TEMPO,
    note: '2초에 내리고 1초에 올립니다 · 대부분의 날',
  },
  {
    id: 'control',
    label: '천천히',
    tempo: { eccentric: 3, bottom: 1, concentric: 1, top: 0 },
    note: '내리는 구간을 길게 · 자세가 무너질 때, 가벼운 날',
  },
  {
    id: 'power',
    label: '폭발적으로',
    tempo: { eccentric: 2, bottom: 0, concentric: 1, top: 0 },
    note: '올릴 때 최대한 빠르게 — 초는 같지만 의도가 다릅니다',
  },
  {
    id: 'pause',
    label: '멈췄다',
    tempo: { eccentric: 2, bottom: 2, concentric: 1, top: 0 },
    note: '아래에서 2초 멈춤 · 반동을 없애고 약점 구간을 칩니다',
  },
];

/** `2-0-1-0` 처럼 현장 표기로. */
export function tempoLabel(tempo: Tempo): string {
  return [tempo.eccentric, tempo.bottom, tempo.concentric, tempo.top].join('-');
}

/** 반복 하나에 걸리는 시간. */
export function repSeconds(tempo: Tempo): number {
  return tempo.eccentric + tempo.bottom + tempo.concentric + tempo.top;
}

/**
 * 세는 말.
 *
 * 한국에서 반복을 셀 때는 "일, 이, 삼"이 아니라 "하나, 둘, 셋"이다.
 * 숫자를 그대로 읽히면 기계가 "팔"이라고 읽어서 여덟인지 8인지 모르게
 * 된다. 스물까지는 고유어로 쓰고 그 위는 숫자로 간다 — 스물을 넘기면
 * 고유어가 오히려 길어서 박자를 놓친다.
 */
const NATIVE = [
  '', '하나', '둘', '셋', '넷', '다섯', '여섯', '일곱', '여덟', '아홉', '열',
  '열하나', '열둘', '열셋', '열넷', '열다섯', '열여섯', '열일곱', '열여덟', '열아홉', '스물',
];

export function koreanCount(n: number): string {
  const safe = Math.max(1, Math.round(n));
  return NATIVE[safe] ?? String(safe);
}

export interface Cue {
  /** 세트 시작으로부터 몇 밀리초 뒤에 말하는가 */
  atMs: number;
  /** 읽어 줄 말 */
  say: string;
  /** 이 시점까지 끝낸 반복 수. 시작 신호는 0. */
  rep: number;
}

export interface CueInput {
  repRange: RepRange;
  tempo?: Tempo;
  /** "시작"을 말하고 실제로 움직이기까지 주는 시간 */
  leadInSeconds?: number;
}

/**
 * 세트 하나를 세는 대본.
 *
 * 말이 많으면 안 된다. 세트 중에 설명을 늘어놓는 트레이너는 없다 —
 * 숫자를 세고, 목표에 닿았을 때와 마지막에만 한마디 붙인다.
 */
export function buildCues(input: CueInput): Cue[] {
  const tempo = input.tempo ?? DEFAULT_TEMPO;
  const lead = Math.max(0, input.leadInSeconds ?? 3);
  const per = repSeconds(tempo);
  const max = Math.max(1, Math.round(input.repRange.max));
  const min = Math.max(1, Math.min(max, Math.round(input.repRange.min)));

  const cues: Cue[] = [{ atMs: 0, say: '시작', rep: 0 }];

  for (let rep = 1; rep <= max; rep += 1) {
    let say = koreanCount(rep);

    /*
     * 목표 구간에 들어온 순간은 알려 줘야 한다. 6~10회에서 6개를 한 뒤
     * 멈추는 것과 모르고 멈추는 것은 다른 일이다.
     */
    if (rep === min && min < max) say += ', 목표';
    // 마지막 하나 전에 알려 준다. 알고 들어가는 마지막과 모르고 맞는 마지막은 다르다.
    else if (rep === max - 1 && max > 1) say += ', 하나 남았습니다';
    else if (rep === max) say += ', 끝';

    cues.push({ atMs: Math.round((lead + per * rep) * 1000), say, rep });
  }

  return cues;
}

/** 세트 하나에 걸리는 시간 — 시간 예산과 맞춰 보기 위한 값. */
export function setSeconds(input: CueInput): number {
  const tempo = input.tempo ?? DEFAULT_TEMPO;
  const lead = Math.max(0, input.leadInSeconds ?? 3);
  return lead + repSeconds(tempo) * Math.max(1, Math.round(input.repRange.max));
}

/**
 * 도중에 멈췄을 때 몇 개로 기록할 것인가.
 *
 * 앱은 실제 반복을 못 본다. 박자를 따라갔다면 흘러간 시간이 곧 반복
 * 수이므로 그걸 제안하되, 고쳐 칠 수 있게 두는 것이 전제다.
 */
export function repsAt(elapsedMs: number, input: CueInput): number {
  const tempo = input.tempo ?? DEFAULT_TEMPO;
  const lead = Math.max(0, input.leadInSeconds ?? 3);
  const per = repSeconds(tempo);
  if (per <= 0) return 0;
  const done = Math.floor((elapsedMs / 1000 - lead) / per);
  return Math.max(0, Math.min(Math.round(input.repRange.max), done));
}
