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

  window.FitEquipmentArt = {
    /** 이 기구의 그림이 있는가. 없으면 호출한 쪽이 조용히 넘어간다. */
    has: function (id) { return Object.prototype.hasOwnProperty.call(ART, id); },

    /**
     * 그림 하나를 SVG 엘리먼트로 돌려준다.
     * 없으면 null — 그림이 없다고 목록이 비어 보이면 안 된다.
     */
    render: function (id, label) {
      if (!ART[id]) return null;
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
      svg.innerHTML = ART[id];
      return svg;
    },

    /** 그림이 있는 기구 수 — 콘텐츠 진척을 재는 데 쓴다. */
    coverage: function () { return Object.keys(ART).length; },
  };
})();
