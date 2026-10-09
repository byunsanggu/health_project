/**
 * 확인된 헬스장 — 그 헬스장 사람이 직접 알려준 기구 목록.
 *
 * 크라우드소싱은 첫 사람이 없으면 시작이 안 된다. 트레이너나 관장이
 * 기구 목록을 직접 준 곳은 앱에 넣어 둔다 — 그 헬스장 회원은 등록하자마자
 * 기구가 다 채워져 있다.
 *
 * 좌표는 넣지 않는다. 지도 서비스마다 좌표가 몇 미터씩 다르고, 그 차이로
 * 같은 곳을 못 알아보면 넣어 둔 의미가 없다. 대신 **이름(브랜드+지점)과
 * 도로명 주소가 둘 다** 맞아야 같은 곳으로 본다. 하나만 보면 "여성전용
 * 바우짐"이 "바우짐 북수원점"의 기구를 받아 간다.
 */
import { normalizeGymName } from './gymIdentity.ts';

export interface KnownGym {
  name: string;
  /** 도로명 + 건물번호. 검색이 준 주소에 이 글자가 들어 있어야 한다 */
  road: string;
  equipmentIds: readonly string[];
  /** 누가 알려줬는가 */
  source: string;
  verifiedAt: string;
}

export const KNOWN_GYMS: readonly KnownGym[] = [
  {
    name: '바우짐 북수원점',
    road: '경수대로 910',
    /*
     * 그 헬스장 트레이너가 적어 준 목록 그대로다(2026-10). 매트·플랫 벤치·
     * 랫풀다운·풀업바·딥스바는 목록에 없었다 — 있으면 앱에서 켜면 된다.
     */
    equipmentIds: [
      'dumbbells', 'barbell-set', 'ez-bar', 'power-rack', 'bench-incline', 'preacher-bench',
      'cable-station', 'seated-row-machine', 'smith-machine', 't-bar-row-machine',
      'rear-delt-machine', 'high-row-machine', 'leg-press-machine', 'hack-squat-machine',
      'v-squat-machine', 'assisted-pull-up-machine', 'chest-supported-row-machine',
      'pec-deck-machine', 'chest-press-machine', 'incline-chest-press-machine',
      'shoulder-press-machine', 'leg-curl-machine', 'leg-extension-machine',
      'calf-raise-machine', 'dip-machine', 'preacher-curl-machine', 'foam-roller',
    ],
    source: '헬스장 트레이너',
    verifiedAt: '2026-10-09',
  },
];

function squash(text: string): string {
  return (text ?? '').replace(/\s+/g, '');
}

/** 검색으로 고른 곳이 확인된 헬스장인가. 이름과 도로명이 둘 다 맞아야 한다. */
export function knownGymFor(place: { name: string; address?: string }): KnownGym | null {
  const name = normalizeGymName(place.name);
  const address = squash(place.address ?? '');
  for (const gym of KNOWN_GYMS) {
    const known = normalizeGymName(gym.name);
    if (name.brand !== known.brand) continue;
    if ((name.branch ?? '') !== (known.branch ?? '')) continue;
    if (!address.includes(squash(gym.road))) continue;
    return gym;
  }
  return null;
}
