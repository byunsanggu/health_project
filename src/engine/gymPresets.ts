import { EQUIPMENT_CATALOG } from './equipment.ts';

/**
 * 헬스장 유형.
 *
 * 기구 31개를 체크박스로 고르게 하면 초보자는 거기서 앱을 닫는다. 그런데
 * 현장에서 보면 한국 헬스장은 몇 가지 유형으로 거의 다 덮인다. 유형 하나만
 * 고르면 기구의 대부분이 채워지고, 사용자는 예외만 빼면 된다.
 *
 * 틀려도 괜찮게 설계했다 — 실제로 그 종목이 처방됐을 때 "이 기구 없어요"를
 * 누르면 그때 빠진다. 첫 화면에서 전부 맞출 필요가 없다.
 */
/**
 * 이 헬스장을 누가 볼 수 있는가.
 *
 * 선은 "상업 헬스장이냐"가 아니라 **"남의 집이냐"**다. 처음에는 아파트·회사
 * 헬스장을 홈짐과 같이 묶었는데, 그건 잘못 그은 선이었다. 같은 단지 주민
 * 둘이 각자 등록하면 기구 목록이 두 벌로 쪼개지고, 크라우드소싱이 제일
 * 필요한 곳에서 안 되는 셈이 된다 — 아파트 헬스장은 뭐가 있는지 밖에서
 * 알 길이 아예 없다.
 *
 *   public     — 누구나 갈 수 있는 곳. 검색에 나온다.
 *   restricted — 입주민·직원·투숙객만. 검색에 나오되 그렇게 표시하고 뒤로 민다.
 *   private    — 홈짐. **남의 집 주소다. 절대 안 나눈다.**
 */
export type GymVisibility = 'public' | 'restricted' | 'private';

export interface GymPreset {
  id: string;
  label: string;
  /** 어떤 곳인지 한 줄 — 사용자가 자기 헬스장을 알아볼 수 있어야 한다 */
  hint: string;
  equipmentIds: string[];
  visibility: GymVisibility;
}

const ALL = EQUIPMENT_CATALOG.map((item) => item.id);

/** 맨몸과 기본 벤치. 어디에나 있다. */
const BASE = ['floor', 'bench-flat'];

const FREE_WEIGHT = ['barbell-set', 'ez-bar', 'dumbbells', 'power-rack', 'bench-incline'];

const CORE_MACHINES = [
  'cable-station', 'lat-pulldown-machine', 'seated-row-machine',
  'chest-press-machine', 'leg-press-machine', 'leg-extension-machine', 'leg-curl-machine',
];

export const GYM_PRESETS: readonly GymPreset[] = [
  {
    id: 'unknown',
    label: '잘 모르겠어요',
    hint: '어떤 기구가 있는지 모를 때. 운동하면서 채웁니다',
    /*
     * 가장 흔한 것만 켜고 시작한다. 어느 헬스장에나 있는 것들이라 크게
     * 틀리지 않고, 틀린 건 실제로 그 종목이 나왔을 때 "없어요"로 빼면 된다.
     * 아무것도 모르는 사람에게 기구 31개를 보여주는 것보다 훨씬 낫다.
     */
    equipmentIds: [...BASE, ...FREE_WEIGHT, 'pull-up-bar', 'cable-station',
      'lat-pulldown-machine', 'leg-press-machine'],
    visibility: 'public',
  },
  {
    id: 'franchise',
    label: '대형 · 프랜차이즈',
    hint: '랙이 여러 대, 머신이 부위별로 다 있는 곳',
    // 대형은 사실상 전부 있다고 보는 게 맞다. 없는 건 쓰면서 빼면 된다.
    equipmentIds: [...ALL],
    visibility: 'public',
  },
  {
    id: 'neighborhood',
    label: '동네 헬스장',
    hint: '랙 한두 대, 머신은 주요 부위만',
    equipmentIds: [
      ...BASE, ...FREE_WEIGHT, ...CORE_MACHINES,
      'pull-up-bar', 'dip-station', 'smith-machine', 'pec-deck-machine',
      'shoulder-press-machine', 'calf-raise-machine', 'preacher-bench',
    ],
    visibility: 'public',
  },
  {
    id: 'crossfit',
    label: '크로스핏 박스',
    hint: '바벨과 랙 위주, 머신은 거의 없는 곳',
    equipmentIds: [
      ...BASE, 'barbell-set', 'dumbbells', 'power-rack', 'pull-up-bar',
      'dip-station', 'ab-wheel', 'landmine',
    ],
    visibility: 'public',
  },
  {
    id: 'residence',
    label: '아파트 · 회사 · 호텔',
    hint: '입주민·직원만 쓰는 곳. 같은 곳 다니는 사람끼리 기구 정보를 나눕니다',
    // 랙이 없는 경우가 많다. 덤벨과 머신 몇 대가 전부인 곳이 흔하다.
    equipmentIds: [
      ...BASE, 'dumbbells', 'bench-incline',
      'cable-station', 'lat-pulldown-machine', 'chest-press-machine',
      'leg-press-machine', 'leg-extension-machine', 'leg-curl-machine', 'smith-machine',
    ],
    /*
     * 나눈다. 아파트 헬스장에 뭐가 있는지는 밖에서 알 길이 없고, 그래서
     * 같은 단지 주민이 채워 준 목록이 제일 값어치가 크다.
     *
     * 다만 아무나 갈 수 있는 곳이 아니므로 검색에서 그렇게 표시하고 뒤로
     * 민다. "강남"을 친 사람에게 못 들어가는 단지 헬스장 쉰 곳이 먼저 뜨면
     * 그건 검색이 아니다.
     */
    visibility: 'restricted',
  },
  {
    id: 'home',
    label: '홈짐',
    hint: '집에 갖춘 장비. 가진 것만 고릅니다',
    equipmentIds: ['floor', 'dumbbells'],
    visibility: 'private',
  },
];

export function gymPreset(id: string): GymPreset | undefined {
  return GYM_PRESETS.find((preset) => preset.id === id);
}

/**
 * 프리셋의 기구 목록. 카탈로그에 없는 id는 걸러낸다.
 * 프리셋을 손대다 오타가 나도 조용히 잘못된 기구가 생기지 않게 한다.
 */
export function presetEquipment(id: string): string[] {
  const preset = gymPreset(id);
  if (!preset) return [];
  const known = new Set(ALL);
  return [...new Set(preset.equipmentIds)].filter((item) => known.has(item));
}
