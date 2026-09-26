import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  describeSearchFailure,
  distanceLabel,
  failureFromStatus,
  looksLikeKakaoKey,
  normalizePlaces,
  parsePlaceQuery,
  placeKind,
  placeLine,
  placeToDraft,
  rankPlaces,
  type RawPlace,
} from '../placeSearch.ts';

const doc = (over: RawPlace): RawPlace => ({
  id: '1',
  place_name: '이름',
  category_name: '스포츠,레저 > 스포츠시설 > 헬스클럽',
  road_address_name: '경기 성남시 분당구 정자일로 1',
  x: '127.108',
  y: '37.366',
  ...over,
});

describe('무엇을 보낼 것인가', () => {
  it('지역만 치면 헬스장을 붙인다', () => {
    /*
     * "경기도"를 그대로 보내면 도청이 나온다. 사용자가 원한 건 경기도에
     * 있는 헬스장이지 경기도 그 자체가 아니다.
     */
    const parsed = parsePlaceQuery('경기도');
    assert.equal(parsed.query, '경기도 헬스장');
    assert.equal(parsed.appendedGymWord, true);
  });

  it('줄여 쓴 지역도 같게 본다', () => {
    // "경기"와 "경기도"가 다르게 동작하면 그건 그냥 버그로 보인다.
    assert.equal(parsePlaceQuery('경기').query, '경기 헬스장');
    assert.equal(parsePlaceQuery('충남').query, '충남 헬스장');
  });

  it('시·군·구·동·역도 지역으로 본다', () => {
    for (const word of ['성남시', '분당구', '정자동', '양평군', '강남역']) {
      assert.equal(parsePlaceQuery(word).appendedGymWord, true, word);
    }
  });

  it('상호에는 붙이지 않는다', () => {
    /*
     * "스포애니 헬스장"으로 보내면 오히려 지점이 안 잡힌다. 상호는 이미
     * 충분히 좁은 말이라 건드릴 이유가 없다.
     */
    const parsed = parsePlaceQuery('스포애니');
    assert.equal(parsed.query, '스포애니');
    assert.equal(parsed.appendedGymWord, false);
  });

  it('이미 종류가 들어 있으면 두 번 붙이지 않는다', () => {
    assert.equal(parsePlaceQuery('경기도 헬스장').query, '경기도 헬스장');
    assert.equal(parsePlaceQuery('분당 크로스핏').query, '분당 크로스핏');
    assert.equal(parsePlaceQuery('gangnam gym').query, 'gangnam gym');
  });

  it('한 글자로는 보내지 않는다', () => {
    // 한 글자를 보내면 전국이 쏟아지고, 한도만 깎인다.
    assert.equal(parsePlaceQuery('ㄱ').searchable, false);
    assert.equal(parsePlaceQuery('   ').searchable, false);
  });
});

describe('무엇이 돌아왔는가', () => {
  it('요가·필라테스를 빼지 않고 뒤로 민다', () => {
    /*
     * 거기 다니는 사람이 실제로 있다. 목록에서 지우면 그 사람은 등록을
     * 못 한다. 다만 헬스장을 찾는 사람이 대부분이므로 순서는 뒤다.
     */
    const places = rankPlaces(normalizePlaces([
      doc({ id: 'y', place_name: '요가원', category_name: '스포츠,레저 > 요가', distance: '10' }),
      doc({ id: 'g', place_name: '헬스클럽', distance: '900' }),
    ]));
    assert.deepEqual(places.map((p) => p.name), ['헬스클럽', '요가원']);
  });

  it('같은 종류 안에서는 가까운 순이다', () => {
    const places = rankPlaces(normalizePlaces([
      doc({ id: 'a', place_name: '먼 헬스', distance: '2000' }),
      doc({ id: 'b', place_name: '가까운 헬스', distance: '120' }),
    ]));
    assert.deepEqual(places.map((p) => p.name), ['가까운 헬스', '먼 헬스']);
  });

  it('거리를 모르면 제공자가 준 순서를 지킨다', () => {
    // 모르는 것을 0으로 채우면 아무 데나 1등이 된다.
    const places = rankPlaces(normalizePlaces([
      doc({ id: 'a', place_name: '첫째', distance: undefined }),
      doc({ id: 'b', place_name: '둘째', distance: undefined }),
    ]));
    assert.deepEqual(places.map((p) => p.name), ['첫째', '둘째']);
    assert.equal(places[0]?.distanceM, undefined);
  });

  it('거리를 아는 쪽을 모르는 쪽보다 앞에 둔다', () => {
    const places = rankPlaces(normalizePlaces([
      doc({ id: 'a', place_name: '모름', x: undefined, y: undefined, distance: undefined }),
      doc({ id: 'b', place_name: '앎', distance: '500' }),
    ]));
    assert.equal(places[0]?.name, '앎');
  });

  it('좌표만 있으면 우리가 잰다', () => {
    const [place] = normalizePlaces(
      [doc({ distance: undefined, x: '127.108', y: '37.366' })],
      { near: { lat: 37.366, lng: 127.10 } },
    );
    assert.ok(place && place.distanceM !== undefined && place.distanceM > 400 && place.distanceM < 900,
      `쟀는데 ${place?.distanceM}m`);
  });

  it('이름이 없는 줄은 버린다', () => {
    // 빈 줄이 뜨면 사용자는 누를 수가 없다.
    assert.equal(normalizePlaces([doc({ place_name: '' }), doc({ place_name: '  ' })]).length, 0);
  });

  it('같은 이름 같은 주소는 한 번만 보여준다', () => {
    const places = normalizePlaces([
      doc({ id: '1', place_name: '정자헬스' }),
      doc({ id: '2', place_name: '정자 헬스' }), // 띄어쓰기만 다르다
    ]);
    assert.equal(places.length, 1);
  });

  it('주소가 같아도 이름이 다르면 다른 곳이다', () => {
    /*
     * 한 건물에 층만 다른 두 헬스장이 흔하다. 과병합은 없는 기구로
     * 처방이 나가게 만들고, 그건 미병합보다 나쁘다.
     */
    const places = normalizePlaces([
      doc({ id: '1', place_name: '3층 헬스' }),
      doc({ id: '2', place_name: '5층 헬스' }),
    ]);
    assert.equal(places.length, 2);
  });

  it('도로명이 없으면 지번을 쓴다', () => {
    const [place] = normalizePlaces([doc({
      road_address_name: '', address_name: '경기 성남시 분당구 정자동 178',
    })]);
    assert.equal(place?.address, '경기 성남시 분당구 정자동 178');
  });
});

describe('종류 읽기', () => {
  it('긴 말부터 본다', () => {
    // '크로스핏'을 '핏'으로 잘라 읽으면 전부 기타가 된다.
    assert.equal(placeKind('스포츠,레저 > 스포츠시설 > 크로스핏'), 'crossfit');
    assert.equal(placeKind('스포츠,레저 > 스포츠시설 > 헬스클럽'), 'gym');
    assert.equal(placeKind('스포츠,레저 > 필라테스'), 'pilates');
    assert.equal(placeKind(undefined), 'other');
  });
});

describe('화면에 뜨는 줄', () => {
  it('1km가 안 되면 m로 말한다', () => {
    assert.equal(distanceLabel(320), '320m');
    assert.equal(distanceLabel(1500), '1.5km');
    assert.equal(distanceLabel(2340), '2.3km');
    assert.equal(distanceLabel(undefined), undefined);
  });

  it('거리를 모르면 거리 자리를 비운다', () => {
    // "0km"라고 쓰면 바로 앞이라는 뜻이 된다. 모르는 것은 말하지 않는다.
    const [place] = normalizePlaces([doc({ distance: undefined, x: undefined, y: undefined })]);
    assert.ok(place);
    assert.doesNotMatch(placeLine(place), /km|m ·/);
    assert.match(placeLine(place), /^헬스장 · 경기/);
  });
});

describe('등록으로 넘기기', () => {
  it('층은 비워 두고 사람에게 묻는다', () => {
    /*
     * 검색은 층을 모른다. 모르는 것을 채워 넣으면 같은 건물 3층과 5층이
     * 한 곳으로 합쳐진다. 그 사람은 지금 그 건물 앞에 있으니 물으면 된다.
     */
    const [place] = normalizePlaces([doc({ place_name: '정자헬스' })]);
    assert.ok(place);
    const draft = placeToDraft(place);
    assert.equal(draft.address, '경기 성남시 분당구 정자일로 1');
    assert.equal(draft.name, '정자헬스');
    assert.deepEqual(draft.location, { lat: 37.366, lng: 127.108 });
  });

  it('층을 받으면 주소 뒤에 붙인다', () => {
    // registerGym이 주소에서 층을 읽어 같은 건물 다른 층을 가른다.
    const [place] = normalizePlaces([doc({})]);
    assert.ok(place);
    assert.match(placeToDraft(place, ' 3층 ').address, /정자일로 1 3층$/);
  });
});

describe('안 될 때', () => {
  it('왜 안 되는지를 구분해서 말한다', () => {
    /*
     * 키가 틀린 것과 지하라서 안 터지는 것은 사용자가 할 일이 완전히
     * 다르다. 둘 다 "검색 실패"로 뭉뚱그리면 둘 다 고장이 된다.
     */
    assert.equal(failureFromStatus(401), 'badKey');
    assert.equal(failureFromStatus(403), 'forbidden');
    assert.equal(failureFromStatus(429), 'quota');
    assert.equal(failureFromStatus(500), 'server');

    const seen = new Set<string>();
    for (const kind of ['noKey', 'badKey', 'forbidden', 'quota', 'network', 'server'] as const) {
      const text = describeSearchFailure(kind);
      assert.ok(text.length > 0);
      assert.equal(seen.has(text), false, `${kind}가 다른 것과 같은 말을 한다`);
      seen.add(text);
    }
  });

  it('연결이 안 될 때 등록을 포기시키지 않는다', () => {
    // 헬스장 지하에서 검색이 안 되는 건 흔한 일이고, 앱이 죽은 건 아니다.
    assert.match(describeSearchFailure('network'), /밖에서|다시/);
  });

  it('키 모양을 본다', () => {
    // 사람들은 보통 JavaScript 키나 네이티브 앱 키를 잘못 가져온다.
    assert.equal(looksLikeKakaoKey('0123456789abcdef0123456789abcdef'), true);
    assert.equal(looksLikeKakaoKey(' 0123456789ABCDEF0123456789ABCDEF '), true);
    assert.equal(looksLikeKakaoKey('too-short'), false);
    assert.equal(looksLikeKakaoKey('sb_publishable_abcdefghijklmnop'), false);
  });
});
