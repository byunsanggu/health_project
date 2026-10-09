/**
 * 기구 그림.
 *
 * 사진을 쓰지 않는 이유가 세 가지 있다.
 *
 *   1. 저작권. 웹에서 긁어오면 안 되고, 스톡은 기구 한 대에 몇 달러씩 든다.
 *      31개를 사면 돈도 돈이지만 재라이선스 관리가 따라붙는다.
 *   2. 헬스장마다 색과 브랜드가 다르다. 사진 한 장은 그중 하나만 보여주는데,
 *      사용자 눈앞의 기구는 색이 다르다. 오히려 헷갈린다.
 *   3. 알아보는 데 필요한 건 실루엣이다. 선화가 사진보다 잘 통한다.
 *
 * 그래서 선화로 직접 그린다. currentColor를 쓰므로 다크 모드가 자동으로
 * 따라오고, 확대해도 깨지지 않고, 한 개가 1KB도 안 된다.
 *
 * 나중에 실제 촬영본이나 라이선스 사진으로 바꾸고 싶으면 이 표의 값만
 * <img>로 갈아끼우면 된다 — 부르는 쪽은 그대로다.
 */
(function () {
  'use strict';

  /* 모두 64×48 좌표계. 선은 currentColor, 굵기는 CSS에서 준다. */
  var ART = {
    floor:
      '<rect x="8" y="16" width="48" height="24" rx="3"/>' +
      '<line x1="8" y1="28" x2="56" y2="28" opacity=".45"/>',

    'barbell-set':
      // 긴 봉 하나에 양쪽 원판 — 큰 것 안쪽, 작은 것 바깥쪽
      '<line x1="12" y1="24" x2="52" y2="24"/>' +
      '<rect x="6" y="13" width="5" height="22" rx="1.5"/>' +
      '<rect x="12" y="17" width="4" height="14" rx="1.2"/>' +
      '<rect x="53" y="13" width="5" height="22" rx="1.5"/>' +
      '<rect x="48" y="17" width="4" height="14" rx="1.2"/>',

    'ez-bar':
      // 가운데가 W자로 굽은 짧은 봉
      '<path d="M14 24 h7 l4 -6 l5 12 l5 -12 l4 6 h7"/>' +
      '<rect x="8" y="18" width="4" height="12" rx="1.2"/>' +
      '<rect x="52" y="18" width="4" height="12" rx="1.2"/>',

    dumbbells:
      '<line x1="25" y1="24" x2="39" y2="24"/>' +
      '<rect x="13" y="14" width="12" height="20" rx="2.5"/>' +
      '<rect x="39" y="14" width="12" height="20" rx="2.5"/>',

    'power-rack':
      // 사람이 들어가는 네모 프레임. 기둥의 구멍이 특징이다.
      '<path d="M14 42 V9 H50 V42"/>' +
      '<circle cx="14" cy="17" r="1.2"/><circle cx="14" cy="23" r="1.2"/>' +
      '<circle cx="14" cy="29" r="1.2"/><circle cx="50" cy="17" r="1.2"/>' +
      '<circle cx="50" cy="23" r="1.2"/><circle cx="50" cy="29" r="1.2"/>' +
      '<path d="M14 23 h6 M50 23 h-6"/>',

    'bench-flat':
      // 평평한 패드 + 다리. 인클라인과 나란히 두면 차이가 바로 보인다.
      '<rect x="10" y="20" width="44" height="6" rx="2.5"/>' +
      '<path d="M16 26 V40 M48 26 V40"/>' +
      '<path d="M10 40 h12 M42 40 h12"/>',

    'bench-incline':
      // 등받이가 세워진 벤치
      '<rect x="12" y="27" width="22" height="5.5" rx="2.5"/>' +
      '<path d="M33 32 L49 14 l5 4 L38 36 Z"/>' +
      '<path d="M18 33 V41 M46 30 V41"/>' +
      '<path d="M12 41 h12 M40 41 h12"/>',

    'pull-up-bar':
      '<path d="M8 10 h48"/>' +
      '<path d="M12 10 V18 M52 10 V18"/>' +
      '<path d="M12 18 h10 M42 18 h10" opacity=".45"/>',

    'cable-station':
      // 기둥 + 도르래 + 줄 + 손잡이, 그리고 핀 꽂는 추 더미
      '<path d="M14 42 V10 h18"/>' +
      '<circle cx="32" cy="13" r="3"/>' +
      '<path d="M32 16 V27"/>' +
      '<path d="M26 27 h12"/>' +
      '<rect x="10" y="22" width="9" height="16" rx="1.5"/>' +
      '<path d="M10 26 h9 M10 30 h9 M10 34 h9" opacity=".45"/>',

    'lat-pulldown-machine':
      // 앉아서 머리 위 긴 바를 당긴다
      '<path d="M14 42 V10 h22"/>' +
      '<path d="M36 12 V17"/>' +
      '<path d="M24 17 h24"/>' +
      '<rect x="30" y="29" width="18" height="5" rx="2"/>' +
      '<path d="M39 34 V42"/>' +
      '<rect x="10" y="22" width="9" height="16" rx="1.5"/>',

    'leg-press-machine':
      // 비스듬한 레일에 발판. 각도가 이 기구의 얼굴이다.
      '<rect x="10" y="30" width="20" height="6" rx="2.5"/>' +
      '<path d="M29 32 L42 18"/>' +
      '<path d="M37 12 l9 8 -6 7 -9 -8 Z"/>' +
      '<path d="M16 36 V42 M26 36 V42"/>',

    'smith-machine':
      // 바가 레일을 따라서만 움직인다
      '<path d="M16 42 V8 M48 42 V8"/>' +
      '<line x1="10" y1="24" x2="54" y2="24"/>' +
      '<rect x="7" y="18" width="4" height="12" rx="1.2"/>' +
      '<rect x="53" y="18" width="4" height="12" rx="1.2"/>' +
      '<path d="M16 16 h4 M48 16 h-4" opacity=".45"/>',

    'pec-deck-machine':
      // 앉아서 가슴 높이의 세로 패드를 안으로 모은다
      '<rect x="25" y="30" width="14" height="5" rx="2"/>' +
      '<path d="M32 30 V16"/>' +
      '<path d="M32 35 V42"/><path d="M24 42 h16"/>' +
      '<path d="M28 19 h-12 M36 19 h12"/>' +
      '<rect x="10" y="13" width="5" height="13" rx="2"/>' +
      '<rect x="49" y="13" width="5" height="13" rx="2"/>',

    'leg-curl-machine':
      // 엎드리거나 앉아서 발목 뒤 롤러를 걸고 무릎을 접는다
      '<rect x="12" y="24" width="26" height="6" rx="2.5"/>' +
      '<path d="M38 27 L48 33"/>' +
      '<circle cx="50" cy="34" r="4"/>' +
      '<path d="M18 30 V42 M32 30 V42"/>',

    'leg-extension-machine':
      // 앉아서 발목 앞 롤러를 걸고 무릎을 편다
      '<rect x="14" y="28" width="16" height="5" rx="2"/>' +
      '<path d="M21 28 V15"/>' +
      '<path d="M30 30 L44 30"/>' +
      '<circle cx="47" cy="30" r="4"/>' +
      '<path d="M21 33 V42"/><path d="M14 42 h14"/>',

    'incline-chest-press-machine':
      // 등판이 뒤로 누워 있고 손잡이가 비스듬히 위로 나간다
      '<rect x="24" y="14" width="5" height="20" rx="2" transform="rotate(20 26 24)"/>' +
      '<rect x="20" y="33" width="16" height="5" rx="2"/>' +
      '<path d="M28 38 V43"/><path d="M20 43 h16"/>' +
      '<path d="M32 22 L48 13"/>' +
      '<path d="M48 9 V17"/>',

    'high-row-machine':
      // 앉아서 머리 위 손잡이를 비스듬히 끌어내린다. 원판 꽂는 뿔이 보인다
      '<rect x="20" y="32" width="14" height="5" rx="2"/>' +
      '<path d="M27 37 V43"/><path d="M19 43 h16"/>' +
      '<rect x="32" y="26" width="9" height="4" rx="2"/>' +
      '<path d="M50 43 V8 H36"/>' +
      '<path d="M36 8 L28 16"/><path d="M24 15 h8"/>' +
      '<circle cx="50" cy="22" r="4"/>',

    'rear-delt-machine':
      // 가슴 패드에 기대어 팔을 양옆 뒤로 벌린다
      '<rect x="29" y="12" width="6" height="16" rx="2"/>' +
      '<rect x="24" y="31" width="16" height="5" rx="2"/>' +
      '<path d="M32 36 V43"/><path d="M24 43 h16"/>' +
      '<path d="M29 18 L14 14 M35 18 L50 14"/>' +
      '<path d="M14 10 V18 M50 10 V18"/>',

    'v-squat-machine':
      // 비스듬한 레일, V자 어깨 패드, 원판 뿔. 핵 스쿼트와 달리 기계를 마주 본다
      '<path d="M12 40 L42 12"/>' +
      '<path d="M34 14 L41 22 L48 14"/>' +
      '<circle cx="43" cy="29" r="4"/>' +
      '<rect x="8" y="38" width="16" height="5" rx="1.5"/>' +
      '<path d="M6 45 h32" opacity=".45"/>',

    'dip-machine':
      // 앉아서 몸 옆의 손잡이를 아래로 밀어 내린다
      '<rect x="22" y="30" width="16" height="5" rx="2"/>' +
      '<rect x="22" y="12" width="5" height="18" rx="2"/>' +
      '<path d="M30 35 V43"/><path d="M22 43 h16"/>' +
      '<path d="M27 22 L46 30"/>' +
      '<path d="M44 30 h7"/>',

    'preacher-curl-machine':
      // 비스듬한 팔 패드와 호를 그리며 올라오는 손잡이
      '<path d="M18 30 L34 20 l4 6 -16 10 Z"/>' +
      '<path d="M38 22 a10 10 0 0 1 8 -10"/>' +
      '<path d="M43 9 h6"/>' +
      '<rect x="14" y="36" width="16" height="5" rx="2"/>' +
      '<path d="M22 41 V44"/><path d="M14 44 h16"/>',

    'foam-roller':
      // 굵은 원통. 옆면 무늬로 스펀지인 걸 보인다
      '<rect x="12" y="18" width="40" height="14" rx="7"/>' +
      '<ellipse cx="19" cy="25" rx="3" ry="7"/>' +
      '<path d="M29 18 V32 M37 18 V32 M45 18 V32" opacity=".45"/>',

    'chest-press-machine':
      '<rect x="24" y="28" width="14" height="5" rx="2"/>' +
      '<path d="M31 28 V14"/>' +
      '<path d="M28 18 h-10 M34 18 h10"/>' +
      '<path d="M16 15 V21 M46 15 V21"/>' +
      '<path d="M31 33 V42"/><path d="M23 42 h16"/>',

    'dip-station':
      // 어깨너비 평행봉 두 개
      '<path d="M16 18 h14 M34 18 h14"/>' +
      '<path d="M20 18 V40 M44 18 V40"/>' +
      '<path d="M14 40 h12 M38 40 h12"/>',

    'preacher-bench':
      // 팔을 비스듬한 패드에 얹는다
      '<path d="M18 34 L34 20 l6 5 -16 14 Z"/>' +
      '<rect x="14" y="36" width="16" height="5" rx="2"/>' +
      '<path d="M38 25 V41"/><path d="M32 41 h12"/>',

    'ab-wheel':
      '<circle cx="32" cy="28" r="10"/>' +
      '<circle cx="32" cy="28" r="2.5"/>' +
      '<path d="M22 28 h-8 M42 28 h8"/>' +
      '<path d="M14 24 V32 M50 24 V32"/>',

    landmine:
      // 봉 한쪽을 바닥 소켓에 꽂고 비스듬히 든다
      '<rect x="7" y="35" width="10" height="6" rx="1.5"/>' +
      '<path d="M14 37 L46 16"/>' +
      '<rect x="44" y="9" width="4" height="14" rx="1.2" transform="rotate(-33 46 16)"/>' +
      '<path d="M6 44 h50" opacity=".45"/>',

    'seated-row-machine':
      // 앉아서 손잡이를 몸쪽으로 당긴다 — 줄이 가슴 높이로 수평이다
      '<rect x="8" y="20" width="9" height="18" rx="1.5"/>' +
      '<path d="M8 25 h9 M8 30 h9 M8 35 h9" opacity=".45"/>' +
      '<path d="M17 26 h17"/>' +
      '<path d="M34 22 V30"/>' +
      '<rect x="39" y="29" width="15" height="5" rx="2"/>' +
      '<path d="M54 31 V19"/>' +
      '<path d="M45 34 V42"/><path d="M39 42 h12"/>',

    'shoulder-press-machine':
      // 앉아서 머리 위로 민다 — 손잡이가 등받이보다 높다
      '<rect x="23" y="33" width="17" height="5" rx="2"/>' +
      '<path d="M40 35 V21"/>' +
      '<path d="M31 38 V44"/><path d="M24 44 h14"/>' +
      '<path d="M26 22 h28"/>' +
      '<path d="M27 22 V10 M53 22 V10"/>' +
      '<path d="M23 10 h8 M49 10 h8"/>',

    'chest-supported-row-machine':
      // 비스듬한 패드에 가슴을 대고 당긴다 — 허리가 편하다
      '<path d="M16 40 L34 17 l6 5 -18 23 Z"/>' +
      '<path d="M44 18 V36"/>' +
      '<path d="M44 23 h8 M44 31 h8"/>' +
      '<path d="M26 32 V44"/><path d="M18 44 h16"/>',

    'hack-squat-machine':
      // 비스듬한 등판을 지고 선 채로 앉았다 일어난다. 발판이 바닥에 있다
      '<path d="M15 39 L44 10"/>' +
      '<path d="M25 37 L38 24 l5 5 -13 13 Z"/>' +
      '<circle cx="45" cy="12" r="3"/>' +
      '<rect x="8" y="37" width="16" height="5" rx="1.5"/>' +
      '<path d="M6 45 h32" opacity=".45"/>',

    'calf-raise-machine':
      // 서서 어깨로 밀고 발끝만 올린다
      '<path d="M20 40 V13 M44 40 V13"/>' +
      '<path d="M20 13 h24"/>' +
      '<rect x="20" y="18" width="10" height="5" rx="2"/>' +
      '<rect x="34" y="18" width="10" height="5" rx="2"/>' +
      '<rect x="24" y="33" width="16" height="6" rx="1.5"/>' +
      '<path d="M12 44 h40" opacity=".45"/>',

    'seated-calf-machine':
      // 앉아서 무릎 위 패드를 지고 발끝을 올린다
      '<rect x="12" y="26" width="16" height="5" rx="2"/>' +
      '<path d="M12 28 V17"/>' +
      '<rect x="34" y="20" width="14" height="5" rx="2"/>' +
      '<path d="M41 25 V30"/>' +
      '<rect x="36" y="37" width="14" height="4" rx="1.5"/>' +
      '<path d="M20 31 V42"/><path d="M14 42 h12"/>',

    't-bar-row-machine':
      // 발판 위에 서서 비스듬한 봉을 당긴다
      '<path d="M10 43 h44"/>' +
      '<circle cx="15" cy="41" r="2"/>' +
      '<path d="M16 40 L46 17"/>' +
      '<rect x="44" y="10" width="4" height="14" rx="1.2" transform="rotate(-38 46 17)"/>' +
      '<rect x="23" y="26" width="12" height="5" rx="2" transform="rotate(-38 29 28)"/>' +
      '<path d="M22 36 h9"/>',

    'assisted-pull-up-machine':
      // 풀업인데 무릎 패드가 몸을 밀어 올려 준다
      '<path d="M14 44 V10 h36 V44"/>' +
      '<path d="M20 10 V16 M44 10 V16"/>' +
      '<rect x="15" y="18" width="9" height="15" rx="1.5"/>' +
      '<path d="M15 23 h9 M15 28 h9" opacity=".45"/>' +
      '<rect x="28" y="27" width="16" height="5" rx="2"/>' +
      '<path d="M36 32 V40"/>',

    'lateral-raise-machine':
      // 앉아서 팔꿈치 패드를 양옆으로 들어 올린다
      '<rect x="24" y="30" width="16" height="5" rx="2"/>' +
      '<path d="M32 30 V21"/>' +
      '<path d="M32 35 V42"/><path d="M25 42 h14"/>' +
      '<path d="M29 28 L17 20 M35 28 L47 20"/>' +
      '<rect x="9" y="14" width="10" height="5" rx="2" transform="rotate(33 14 16)"/>' +
      '<rect x="45" y="14" width="10" height="5" rx="2" transform="rotate(-33 50 16)"/>',

    'hip-thrust-machine':
      // 등을 낮은 패드에 대고 골반 위 패드를 밀어 올린다
      '<rect x="9" y="21" width="8" height="15" rx="2"/>' +
      '<path d="M17 33 h22"/>' +
      '<rect x="25" y="19" width="15" height="5" rx="2"/>' +
      '<path d="M32 24 V31"/>' +
      '<rect x="44" y="25" width="6" height="15" rx="2"/>' +
      '<path d="M7 43 h48" opacity=".45"/>',

    'back-extension-bench':
      // 허벅지를 받치고 상체를 숙였다 편다. 발목 롤러 두 개가 특징이다
      '<path d="M22 40 L38 23"/>' +
      '<rect x="30" y="16" width="16" height="6" rx="2" transform="rotate(-42 38 19)"/>' +
      '<circle cx="17" cy="35" r="3.5"/><circle cx="17" cy="43" r="3.5"/>' +
      '<path d="M29 32 V45"/><path d="M22 45 h14"/>',
  };

  /*
   * 유산소 그림.
   *
   * 기구 표와 따로 둔다. 키가 기구 id가 아니라 **유산소 종목 id**라서,
   * 한 표에 섞으면 언젠가 같은 이름이 겹쳤을 때 엉뚱한 그림이 조용히
   * 나온다 — 빈칸은 눈에 띄지만 틀린 그림은 안 띈다.
   *
   * 그릴 때 신경 쓴 것은 **옆엣것과 구별되는가** 하나다. 트레드밀 두
   * 종목은 같은 기계라서, 걷기는 앞을 들어 경사를 주고 달리기는 평평하게
   * 두고 속도선을 붙였다. 목록에서 위아래로 붙어 나오기 때문이다.
   */
  var CARDIO_ART = {
    'treadmill-walk':
      // 앞이 들린 데크 — 경사가 이 종목의 전부다
      '<path d="M12 36 L46 24"/>' +
      '<path d="M12 41 L46 29"/>' +
      '<path d="M12 36 V41 M46 24 V29"/>' +
      '<path d="M44 25 V15"/>' +
      '<rect x="36" y="8" width="16" height="7" rx="2"/>' +
      '<path d="M16 41 V44 M42 31 V44"/>',

    'treadmill-run':
      // 같은 기계, 평평하게. 속도선으로 걷기와 갈린다
      '<rect x="12" y="30" width="34" height="5" rx="2"/>' +
      '<path d="M44 30 V15"/>' +
      '<rect x="36" y="8" width="16" height="7" rx="2"/>' +
      '<path d="M16 35 V44 M42 35 V44"/>' +
      '<path d="M2 28 h8 M4 34 h6"/>',

    bike:
      // 앞 기둥에 걸린 큰 플라이휠 — 실내 자전거는 이 바퀴로 알아본다
      '<path d="M6 43 h18 M38 43 h18"/>' +
      '<path d="M15 41 V13 M8 13 h14"/>' +
      '<circle cx="25" cy="31" r="8"/>' +
      '<path d="M15 19 L47 26"/>' +
      '<path d="M47 41 V21"/>' +
      '<rect x="40" y="16" width="14" height="5" rx="2"/>' +
      '<path d="M15 36 H47"/>' +
      '<circle cx="36" cy="36" r="3.5"/>',

    elliptical:
      // 옆에서 본 모습. 뒤 구동휠에서 앞으로 길게 뻗은 발판 암이 특징이다
      '<circle cx="49" cy="26" r="7"/>' +
      '<path d="M49 33 V42 M42 42 h14"/>' +
      '<path d="M14 42 h14"/>' +
      '<path d="M21 42 V13"/>' +
      '<rect x="13" y="6" width="16" height="7" rx="2"/>' +
      '<path d="M21 17 L33 28"/>' +
      '<path d="M49 26 L13 35"/>' +
      '<rect x="9" y="33" width="12" height="4" rx="1.5"/>',

    row:
      // 긴 레일 위를 미끄러지는 시트 — 이게 로잉을 로잉으로 보이게 한다
      '<path d="M14 36 H54"/>' +
      '<path d="M19 36 V42 M50 36 V42"/>' +
      '<rect x="31" y="29" width="13" height="5" rx="2"/>' +
      '<path d="M37 34 V36"/>' +
      '<circle cx="15" cy="25" r="7"/>' +
      '<path d="M15 32 V42 M10 42 h10"/>' +
      '<path d="M22 25 H36"/>' +
      '<path d="M36 20 V30"/>',

    stair:
      // 올라가는 계단과 손잡이
      '<path d="M7 42 h9 v-6 h9 v-6 h9 v-6 h9 v-6 h9"/>' +
      '<path d="M11 32 L52 12"/>' +
      '<path d="M11 32 V42 M52 12 V18"/>',

    'outdoor-run':
      // 기계가 없는 유일한 종목. 기구 대신 **장소**를 그린다
      '<path d="M15 44 L28 15 M49 44 L36 15"/>' +
      '<path d="M32 19 v4 M31 28 v5 M30 37 v6"/>' +
      '<circle cx="51" cy="13" r="5"/>',

    'jump-rope':
      // 손잡이 둘과 아래로 늘어진 줄
      '<rect x="8" y="10" width="5" height="13" rx="2.5"/>' +
      '<rect x="51" y="10" width="5" height="13" rx="2.5"/>' +
      '<path d="M13 21 Q 32 46 51 21"/>',

    swim:
      // 레인이 보이는 물. 기구가 아니라 장소로 알아본다
      '<rect x="7" y="13" width="50" height="28" rx="3"/>' +
      '<path d="M12 24 q5 -4 10 0 t10 0 t10 0 t10 0"/>' +
      '<path d="M12 33 q5 -4 10 0 t10 0 t10 0 t10 0"/>',
  };

  /** 표 하나를 SVG로. 부르는 쪽이 어느 표인지 골라 넘긴다. */
  function draw(table, id, label) {
    if (!table[id]) return null;
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 64 48');
    svg.setAttribute('class', 'equip-art');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', label || '');
    svg.innerHTML = table[id];
    return svg;
  }

  window.FitEquipmentArt = {
    /** 이 기구의 그림이 있는가. 없으면 호출한 쪽이 조용히 넘어간다. */
    has: function (id) { return Object.prototype.hasOwnProperty.call(ART, id); },

    /**
     * 그림 하나를 SVG 엘리먼트로 돌려준다.
     * 없으면 null — 그림이 없다고 목록이 비어 보이면 안 된다.
     */
    render: function (id, label) { return draw(ART, id, label); },

    /** 유산소 종목 그림. 기구 id와 같은 이름을 써도 서로 안 섞인다. */
    hasCardio: function (id) { return Object.prototype.hasOwnProperty.call(CARDIO_ART, id); },
    renderCardio: function (id, label) { return draw(CARDIO_ART, id, label); },

    /** 그림이 있는 기구 수 — 콘텐츠 진척을 재는 데 쓴다. */
    coverage: function () { return Object.keys(ART).length; },
    cardioCoverage: function () { return Object.keys(CARDIO_ART).length; },
  };
})();
