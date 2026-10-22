/**
 * 먹은 것 적기 — 칼로리와 탄단지를 대신 계산한다.
 *
 * 원래는 단백질만 셌다. 매 끼 적는 일은 3주를 못 가기 때문이다. 그래도
 * 적고 싶은 사람은 있다 — 그리고 그 사람이 그만두는 이유는 대개 **적는 게
 * 귀찮아서**지 숫자가 싫어서가 아니다. 그래서 적는 비용을 최대한 깎는다:
 *
 *   · 말하듯 한 줄로 — "닭가슴살 100g, 밥 반 공기, 계란 2개"
 *   · 자주 먹는 건 한 번 눌러서 다시
 *   · 어제와 같은 끼니는 통째로 복사
 *
 * 숫자는 **어림**이다. 같은 김치찌개도 집마다 다르다. 식약처 식품영양성분
 * 자료와 흔히 쓰는 1인분 기준에 맞춘 대략값이라 ±10~20%는 틀린다 — 그래도
 * 매일 같은 표로 재면 "어제보다 많이 먹었나"는 정확하게 보인다. 그게 쓸모다.
 *
 * 칼로리 **목표**는 공식으로 찍지 않는다(meals.ts와 같은 이유). 대신 2주를
 * 적고 체중을 재면, 실제로 먹은 양과 체중 변화로 **그 사람의 유지 칼로리**를
 * 계산한다. 공식은 몸을 모르지만 기록은 안다.
 */

/* ── 음식표 ─────────────────────────────────────── */

export interface Nutrients {
  kcal: number;
  protein: number;
  fat: number;
  carbs: number;
}

export type FoodCategory =
  | 'grain' | 'protein' | 'dairy' | 'nuts' | 'fruit' | 'veg'
  | 'dish' | 'snack' | 'drink' | 'other';

export interface FoodItem {
  id: string;
  name: string;
  /** 다르게 부르는 이름 — 입력 해석과 검색에 쓴다 */
  aliases: readonly string[];
  /** 100g(마실 것은 100ml)당 */
  per100: Nutrients;
  /** 한 번에 먹는 양: 단위와 그 단위 1의 무게(g) · 아무 양도 안 적었을 때 몇 단위인지 */
  serving: { unit: string; grams: number; qty?: number };
  /** 그 밖에 쓰는 단위 → 1단위 무게(g) */
  units?: Readonly<Record<string, number>>;
  category: FoodCategory;
}

/** [kcal, 단백질, 지방, 탄수화물] — 100g(ml)당 */
type Per100 = readonly [number, number, number, number];

function food(
  id: string, name: string, aliases: readonly string[], per100: Per100,
  serving: [string, number, number?], category: FoodCategory,
  units?: Record<string, number>,
): FoodItem {
  return {
    id, name, aliases, category,
    per100: { kcal: per100[0], protein: per100[1], fat: per100[2], carbs: per100[3] },
    serving: { unit: serving[0], grams: serving[1], qty: serving[2] },
    units,
  };
}

/**
 * 한국에서 실제로 먹는 것 위주로.
 *
 * 외식 메뉴는 1인분 무게를 흔한 기준으로 잡았다(찌개 400g, 국밥 700g …).
 * 숫자를 고칠 때는 1인분 칼로리가 상식 범위인지(김치찌개 230kcal, 짜장면
 * 780kcal) 테스트가 같이 본다.
 */
export const FOODS: readonly FoodItem[] = [
  // ── 밥 · 주식
  food('rice', '쌀밥', ['밥', '흰밥', '흰쌀밥', '공기밥', '햇반', '즉석밥', '백미밥'], [145, 2.6, 0.3, 31.8], ['공기', 210], 'grain', { 그릇: 210 }),
  food('brown-rice', '현미밥', ['현미'], [150, 3.0, 1.0, 32], ['공기', 210], 'grain', { 그릇: 210 }),
  food('multigrain-rice', '잡곡밥', ['잡곡', '보리밥', '오곡밥', '귀리밥'], [148, 3.2, 0.7, 32], ['공기', 210], 'grain', { 그릇: 210 }),
  food('oatmeal', '오트밀', ['오트', '귀리', '오버나이트 오트밀', '퀘이커'], [380, 13, 6.5, 67], ['회', 40], 'grain', { 컵: 80, 숟가락: 10, 스푼: 10 }),
  food('bread', '식빵', ['토스트', '흰식빵'], [265, 9, 3.5, 49], ['장', 33], 'grain', { 쪽: 33 }),
  food('wholewheat-bread', '통밀빵', ['호밀빵', '통밀식빵'], [250, 12, 3.5, 43], ['장', 35], 'grain', { 쪽: 35 }),
  food('bagel', '베이글', [], [270, 10, 1.6, 53], ['개', 105], 'grain'),
  food('sweet-potato', '고구마', ['군고구마', '찐고구마', '밤고구마', '호박고구마'], [130, 1.4, 0.2, 30], ['개', 150], 'grain'),
  food('potato', '감자', ['찐감자', '삶은 감자'], [75, 2.0, 0.1, 17], ['개', 150], 'grain'),
  food('corn', '옥수수', ['찰옥수수', '찐옥수수'], [140, 4.5, 1.5, 29], ['개', 150], 'grain'),
  food('rice-cake', '가래떡', ['떡', '백설기', '절편'], [230, 4.0, 0.4, 51], ['개', 100], 'grain', { 줄: 100 }),
  food('ramen', '라면', ['봉지라면', '신라면', '진라면'], [425, 8.5, 13.5, 66], ['봉', 120], 'dish', { 개: 120, 봉지: 120 }),
  food('cup-ramen', '컵라면', ['사발면', '큰컵'], [436, 8, 17, 62], ['개', 86], 'dish', { 컵: 86 }),
  food('cereal', '시리얼', ['콘푸로스트', '콘프레이크', '씨리얼'], [380, 6, 1.5, 87], ['회', 30], 'grain', { 그릇: 30, 컵: 30 }),
  food('granola', '그래놀라', [], [450, 10, 16, 64], ['회', 40], 'grain', { 컵: 60 }),

  // ── 단백질
  food('chicken-breast', '닭가슴살', ['닭가슴살 스테이크', '훈제 닭가슴살', '닭가슴', '수비드 닭가슴살'], [115, 23, 1.5, 1], ['개', 100], 'protein', { 팩: 100, 덩이: 100, 조각: 100 }),
  food('chicken-sausage', '닭가슴살 소시지', ['닭가슴살소시지', '닭소시지'], [150, 18, 6, 6], ['개', 80], 'protein'),
  food('chicken-thigh', '닭다리살', ['닭다리', '닭정육', '닭다리살 구이'], [140, 19, 7, 0], ['g', 100], 'protein', { 개: 100, 조각: 100 }),
  food('egg', '계란', ['달걀', '삶은 계란', '삶은 달걀', '구운 계란', '맥반석 계란', '훈제란'], [143, 12.6, 9.5, 0.7], ['개', 50], 'protein', { 알: 50 }),
  food('fried-egg', '계란후라이', ['계란 프라이', '계란프라이', '달걀후라이', '달걀프라이', '후라이'], [196, 13.6, 15, 0.8], ['개', 46], 'protein', { 알: 46 }),
  food('egg-white', '계란 흰자', ['흰자', '난백', '달걀흰자', '계란흰자'], [52, 11, 0.2, 0.7], ['개', 33], 'protein', { 알: 33 }),
  food('tofu', '두부', ['부침두부', '찌개두부', '연두부'], [84, 8.5, 5, 2], ['모', 300, 0.5], 'protein', { 팩: 300 }),
  food('beef', '소고기', ['소고기 구이', '쇠고기'], [200, 20, 13, 0], ['g', 100], 'protein', { 인분: 200 }),
  food('beef-sirloin', '소고기 등심', ['등심', '채끝', '꽃등심', '차돌박이'], [250, 19, 19, 0], ['g', 100], 'protein', { 인분: 200 }),
  food('beef-lean', '소고기 살코기', ['우둔', '홍두깨', '소고기 우둔', '소고기 홍두깨', '장조림', '안심 스테이크'], [130, 22, 4, 0], ['g', 100], 'protein', { 인분: 200 }),
  food('pork-belly', '삼겹살', ['삼겹', '대패삼겹살', '오겹살', '대패'], [331, 17, 28.9, 0], ['인분', 200], 'protein'),
  food('pork-neck', '목살', ['돼지 목살', '목심', '돼지목살'], [200, 18, 14, 0], ['인분', 200], 'protein'),
  food('pork-lean', '돼지 안심', ['안심', '뒷다리', '돼지 뒷다리살', '뒷다리살', '등심 돈까스용'], [120, 22, 3, 0], ['g', 100], 'protein', { 인분: 200 }),
  food('pork-shoulder', '돼지 앞다리', ['앞다리살', '앞다리', '돼지앞다리'], [170, 20, 10, 0], ['g', 100], 'protein', { 인분: 200 }),
  food('duck', '훈제오리', ['오리고기', '오리'], [290, 17, 24, 2], ['인분', 150], 'protein'),
  food('salmon', '연어', ['연어회', '훈제연어', '연어 스테이크'], [200, 20, 13, 0], ['g', 100], 'protein', { 인분: 150 }),
  food('mackerel', '고등어', ['고등어구이', '고등어 구이'], [200, 20, 13, 0], ['토막', 100], 'protein', { 마리: 300 }),
  food('tuna-can', '참치캔', ['참치', '참치통조림', '동원참치', '참치 캔'], [130, 25, 3, 0], ['캔', 100], 'protein', { 개: 100 }),
  food('sashimi', '회', ['광어', '광어회', '우럭', '생선회', '흰살생선'], [100, 20, 2, 0], ['인분', 150], 'protein', { 접시: 150 }),
  food('shrimp', '새우', ['새우살', '칵테일새우'], [90, 19, 1, 0.5], ['g', 100], 'protein', { 마리: 15 }),
  food('squid', '오징어', ['오징어볶음'], [90, 18, 1.4, 1], ['g', 100], 'protein', { 마리: 250 }),

  // ── 유제품 · 보충
  food('milk', '우유', ['흰우유'], [65, 3.2, 3.6, 4.8], ['컵', 200], 'dairy', { 팩: 200, 잔: 200 }),
  food('low-fat-milk', '저지방우유', ['저지방 우유', '무지방우유', '무지방 우유'], [45, 3.3, 1, 5], ['컵', 200], 'dairy', { 팩: 200, 잔: 200 }),
  food('soy-milk', '두유', ['베지밀', '검은콩두유'], [60, 3.5, 2, 6.5], ['팩', 190], 'dairy', { 컵: 200, 잔: 200 }),
  food('greek-yogurt', '그릭요거트', ['그릭 요거트', '그릭요구르트', '그릭 요구르트'], [90, 10, 3.5, 5], ['개', 100], 'dairy', { 컵: 100 }),
  food('yogurt', '요거트', ['요구르트', '떠먹는 요거트', '플레인 요거트'], [100, 3.5, 2.5, 16], ['개', 85], 'dairy', { 컵: 85 }),
  food('cheese', '치즈', ['슬라이스 치즈', '체다치즈', '슬라이스치즈'], [300, 18, 23, 6], ['장', 18], 'dairy'),
  food('protein-powder', '단백질 보충제', ['보충제', '프로틴', '프로틴 쉐이크', '단백질 쉐이크', '웨이프로틴', '유청단백'], [400, 80, 5, 10], ['스쿱', 30], 'protein', { 회: 30, 잔: 30 }),
  food('protein-drink', '단백질 음료', ['프로틴 음료', '셀렉스', '하이뮨', '단백질음료'], [52, 8, 1, 3], ['병', 250], 'protein', { 개: 250, 팩: 250 }),
  food('protein-bar', '프로틴바', ['단백질바', '단백질 바', '프로틴 바'], [367, 33, 13, 37], ['개', 60], 'protein'),
  food('banana-milk', '바나나우유', ['바나나 우유'], [87, 2.9, 3, 12], ['개', 240], 'drink', { 병: 240 }),

  // ── 콩 · 견과
  food('black-beans', '검은콩', ['서리태', '콩'], [400, 36, 18, 30], ['줌', 30], 'nuts'),
  food('natto', '낫토', [], [200, 16.5, 10, 12], ['팩', 50], 'protein', { 개: 50 }),
  food('almonds', '아몬드', ['견과류', '견과', '하루견과', '호두', '캐슈넛'], [600, 21, 52, 20], ['줌', 25], 'nuts', { 봉: 25, 개: 1.2 }),
  food('peanut-butter', '땅콩버터', ['피넛버터'], [590, 25, 50, 20], ['큰술', 15], 'nuts', { 스푼: 15, 숟가락: 15 }),

  // ── 과일 · 채소
  food('banana', '바나나', [], [89, 1.1, 0.3, 23], ['개', 110], 'fruit'),
  food('apple', '사과', [], [52, 0.3, 0.2, 14], ['개', 200], 'fruit'),
  food('mandarin', '귤', ['감귤', '한라봉', '천혜향'], [45, 0.7, 0.1, 11], ['개', 80], 'fruit'),
  food('strawberry', '딸기', [], [34, 0.8, 0.2, 8], ['개', 15], 'fruit', { 접시: 150, 줌: 100 }),
  food('blueberry', '블루베리', [], [57, 0.7, 0.3, 14.5], ['줌', 50], 'fruit', { 컵: 150 }),
  food('cherry-tomato', '방울토마토', ['방토'], [18, 0.9, 0.2, 3.9], ['개', 15], 'fruit', { 줌: 100, 접시: 150 }),
  food('tomato', '토마토', [], [18, 0.9, 0.2, 3.9], ['개', 150], 'fruit'),
  food('salad', '샐러드', ['채소', '야채', '양상추', '생야채'], [20, 1.5, 0.2, 3.5], ['그릇', 100], 'veg', { 접시: 100 }),
  food('kimchi', '김치', ['배추김치', '깍두기', '총각김치'], [20, 1.5, 0.5, 3.5], ['접시', 50], 'veg'),
  food('namul', '나물 반찬', ['나물', '반찬', '시금치나물', '콩나물무침', '무생채'], [70, 3, 4, 6], ['접시', 50], 'veg'),
  food('laver', '김', ['조미김', '도시락김', '김자반'], [550, 30, 40, 20], ['봉', 4], 'veg', { 장: 2 }),
  food('dressing', '샐러드 드레싱', ['드레싱', '오리엔탈 드레싱', '발사믹', '참깨드레싱'], [300, 1, 28, 12], ['큰술', 15], 'other', { 스푼: 15 }),
  food('oil', '식용유', ['올리브유', '기름', '들기름', '참기름', '버터'], [884, 0, 100, 0], ['큰술', 13], 'other', { 스푼: 13, 티스푼: 4 }),
  food('honey', '꿀', ['올리고당', '시럽'], [304, 0.3, 0, 82], ['큰술', 21], 'other', { 스푼: 21, 티스푼: 7 }),

  // ── 한식 · 외식 (1인분)
  food('kimchi-stew', '김치찌개', ['김치 찌개', '참치김치찌개'], [58, 3.8, 3.3, 3], ['인분', 400], 'dish', { 그릇: 400 }),
  food('doenjang-stew', '된장찌개', ['된장 찌개', '차돌된장찌개'], [43, 3, 1.8, 3.5], ['인분', 400], 'dish', { 그릇: 400 }),
  food('soft-tofu-stew', '순두부찌개', ['순두부'], [65, 4.3, 4, 2.8], ['인분', 400], 'dish', { 그릇: 400 }),
  food('budae-stew', '부대찌개', [], [100, 5, 6, 6], ['인분', 500], 'dish', { 그릇: 500 }),
  food('kimchi-fried-rice', '김치볶음밥', ['볶음밥'], [171, 4, 5.1, 25.7], ['인분', 350], 'dish', { 그릇: 350, 접시: 350 }),
  food('bibimbap', '비빔밥', ['돌솥비빔밥'], [117, 4, 3, 19], ['그릇', 500], 'dish', { 인분: 500 }),
  food('jeyuk', '제육볶음', ['제육', '돼지불고기', '돼지 불고기'], [225, 15, 12.5, 10], ['인분', 200], 'dish', { 접시: 200 }),
  food('jeyuk-rice', '제육덮밥', [], [178, 6.7, 5.6, 24.4], ['그릇', 450], 'dish', { 인분: 450 }),
  food('bulgogi', '불고기', ['소불고기', '소 불고기'], [200, 15, 11, 9], ['인분', 200], 'dish', { 접시: 200 }),
  food('fried-chicken', '후라이드치킨', ['치킨', '후라이드', '프라이드치킨', '프라이드 치킨'], [290, 20, 18, 12], ['조각', 80], 'dish', { 마리: 900, 반마리: 450 }),
  food('sauced-chicken', '양념치킨', ['양념 치킨'], [300, 17, 17, 20], ['조각', 80], 'dish', { 마리: 900, 반마리: 450 }),
  food('dakgalbi', '닭갈비', [], [150, 14, 7, 8], ['인분', 300], 'dish'),
  food('jjimdak', '찜닭', [], [150, 12, 6, 12], ['인분', 400], 'dish'),
  food('samgyetang', '삼계탕', [], [90, 9, 5, 3], ['그릇', 1000], 'dish', { 인분: 1000 }),
  food('gukbap', '돼지국밥', ['국밥', '순대국밥', '순댓국', '순대국'], [100, 6, 3.5, 11], ['그릇', 700], 'dish', { 인분: 700 }),
  food('seolleongtang', '설렁탕', ['곰탕'], [50, 5, 2.5, 1.5], ['그릇', 600], 'dish', { 인분: 600 }),
  food('galbitang', '갈비탕', [], [65, 6, 4, 1], ['그릇', 700], 'dish', { 인분: 700 }),
  food('jjajangmyeon', '짜장면', ['자장면', '간짜장'], [120, 3.4, 3.8, 18], ['그릇', 650], 'dish', { 인분: 650 }),
  food('jjamppong', '짬뽕', [], [77, 3.5, 2.6, 10], ['그릇', 900], 'dish', { 인분: 900 }),
  food('tangsuyuk', '탕수육', [], [230, 9, 11, 24], ['인분', 200], 'dish', { 접시: 400 }),
  food('kalguksu', '칼국수', [], [85, 3, 1.5, 15], ['그릇', 700], 'dish', { 인분: 700 }),
  food('janchi-guksu', '잔치국수', ['국수', '멸치국수'], [72, 2.5, 0.8, 14], ['그릇', 600], 'dish', { 인분: 600 }),
  food('naengmyeon', '물냉면', ['냉면'], [69, 2.6, 1, 12.5], ['그릇', 800], 'dish', { 인분: 800 }),
  food('bibim-naengmyeon', '비빔냉면', [], [113, 3.6, 2.3, 20], ['그릇', 550], 'dish', { 인분: 550 }),
  food('tteokguk', '떡국', ['떡만둣국', '떡만두국'], [85, 3.5, 1.8, 14], ['그릇', 600], 'dish', { 인분: 600 }),
  food('porridge', '죽', ['전복죽', '야채죽', '호박죽'], [75, 2.5, 1.2, 13], ['그릇', 400], 'dish', { 인분: 400 }),
  food('donkatsu', '돈가스', ['돈까스', '돈카츠', '치즈돈까스'], [290, 15, 17, 20], ['인분', 230], 'dish', { 접시: 230, 개: 230 }),
  food('curry-rice', '카레라이스', ['카레', '카레밥'], [145, 3.5, 4, 23], ['그릇', 450], 'dish', { 인분: 450 }),
  food('gimbap', '김밥', ['야채김밥'], [182, 6, 5, 28], ['줄', 220], 'dish', { 개: 220 }),
  food('tuna-gimbap', '참치김밥', ['참치 김밥', '치즈김밥'], [200, 7.5, 8, 25], ['줄', 250], 'dish', { 개: 250 }),
  food('triangle-gimbap', '삼각김밥', ['주먹밥'], [190, 4.5, 5.5, 30], ['개', 110], 'dish'),
  food('lunchbox', '편의점 도시락', ['도시락'], [188, 6, 7, 26], ['개', 400], 'dish'),
  food('tteokbokki', '떡볶이', ['떡볶기', '라볶이'], [160, 3.5, 2.5, 32], ['인분', 300], 'dish', { 그릇: 300, 접시: 300 }),
  food('sundae', '순대', [], [190, 9, 5, 27], ['인분', 150], 'dish', { 접시: 150 }),
  food('dumplings', '만두', ['군만두', '찐만두', '물만두', '고기만두'], [220, 8, 9, 26], ['개', 35], 'dish', { 인분: 210, 접시: 210 }),
  food('rolled-omelet', '계란말이', ['계란찜', '달걀말이'], [150, 10, 11, 2], ['인분', 150], 'dish', { 접시: 150 }),
  food('seaweed-soup', '미역국', [], [25, 1.8, 1.3, 1.5], ['그릇', 300], 'dish'),
  food('bean-sprout-soup', '콩나물국', ['북엇국', '맑은국'], [12, 1.2, 0.4, 1], ['그릇', 300], 'dish'),
  food('doenjang-soup', '된장국', ['시래기국', '아욱국'], [25, 1.8, 0.8, 2.5], ['그릇', 300], 'dish'),
  food('jokbal', '족발', [], [250, 20, 18, 3], ['인분', 200], 'dish', { 접시: 400 }),
  food('bossam', '보쌈', ['수육'], [250, 20, 18, 1], ['인분', 200], 'dish', { 접시: 400 }),
  food('sushi', '초밥', ['스시'], [180, 7, 1.5, 34], ['개', 25], 'dish', { 인분: 250, 접시: 250 }),
  food('rice-noodle', '쌀국수', [], [75, 4, 1, 12], ['그릇', 600], 'dish', { 인분: 600 }),
  food('pasta-tomato', '토마토 파스타', ['파스타', '스파게티', '토마토파스타'], [157, 5.5, 4.5, 24], ['접시', 350], 'dish', { 인분: 350, 그릇: 350 }),
  food('pasta-cream', '크림 파스타', ['까르보나라', '크림파스타'], [214, 6, 11, 23], ['접시', 350], 'dish', { 인분: 350, 그릇: 350 }),
  food('chicken-salad', '닭가슴살 샐러드', ['닭가슴살샐러드', '샐러드 도시락'], [100, 9, 4, 6], ['개', 250], 'dish', { 그릇: 250 }),
  food('sandwich', '샌드위치', [], [233, 10, 11, 24], ['개', 150], 'dish'),
  food('burger', '햄버거', ['버거', '빅맥', '불고기버거'], [250, 13, 12, 25], ['개', 200], 'dish'),
  food('pizza', '피자', [], [250, 11, 10, 30], ['조각', 130], 'dish', { 판: 1040 }),
  food('fries', '감자튀김', ['프렌치프라이'], [290, 3.4, 15, 37], ['봉', 115], 'snack', { 인분: 115, 개: 115 }),
  food('spam', '스팸', ['햄', '런천미트'], [300, 13, 27, 3], ['조각', 50], 'protein', { 캔: 200 }),
  food('sausage', '소시지', ['비엔나', '비엔나소시지', '비엔나 소시지'], [280, 12, 24, 5], ['개', 10], 'protein'),

  // ── 간식
  food('sweet-bread', '빵', ['단팥빵', '소보로', '크림빵', '모닝빵', '크루아상', '소금빵'], [300, 7, 8, 50], ['개', 90], 'snack'),
  food('cake', '케이크', ['케익', '조각케이크'], [320, 5, 18, 35], ['조각', 100], 'snack'),
  food('donut', '도넛', ['도너츠', '도너츠'], [420, 5, 23, 49], ['개', 60], 'snack'),
  food('chips', '과자', ['스낵', '새우깡', '감자칩', '포카칩'], [500, 6, 25, 63], ['봉', 90], 'snack', { 봉지: 90, 개: 90 }),
  food('chocolate', '초콜릿', ['초코', '초코바'], [550, 6, 32, 57], ['개', 35], 'snack'),
  food('ice-cream', '아이스크림', ['아이스크림콘', '하드'], [230, 3.5, 11, 29], ['개', 100], 'snack'),

  // ── 마실 것 (100ml당)
  food('americano', '아메리카노', ['커피', '블랙커피', '아아', '뜨아', '아이스 아메리카노'], [3, 0.2, 0, 0.5], ['잔', 355], 'drink', { 컵: 355 }),
  food('latte', '카페라떼', ['라떼', '카페 라떼', '카푸치노', '바닐라라떼'], [50, 2.6, 2.6, 4], ['잔', 355], 'drink', { 컵: 355 }),
  food('soda', '콜라', ['탄산음료', '사이다', '환타'], [43, 0, 0, 10.6], ['캔', 355], 'drink', { 병: 500, 잔: 250 }),
  food('zero-soda', '제로콜라', ['제로 콜라', '콜라 제로', '제로사이다', '제로 사이다', '탄산수'], [0, 0, 0, 0], ['캔', 355], 'drink', { 병: 500, 잔: 250 }),
  food('orange-juice', '오렌지주스', ['주스', '오렌지 주스'], [45, 0.7, 0.2, 10.5], ['잔', 200], 'drink', { 컵: 200, 병: 300 }),
  food('sports-drink', '이온음료', ['포카리', '포카리스웨트', '게토레이', '파워에이드'], [25, 0, 0, 6.2], ['병', 500], 'drink', { 캔: 245, 잔: 250 }),
  food('beer', '맥주', ['생맥주'], [43, 0.4, 0, 3.6], ['잔', 500], 'drink', { 캔: 500, 병: 500 }),
  food('soju', '소주', [], [105, 0, 0, 1], ['병', 360], 'drink', { 잔: 50 }),
  food('makgeolli', '막걸리', [], [46, 1.5, 0.1, 2.5], ['병', 750], 'drink', { 잔: 200 }),
  food('wine', '와인', ['레드와인', '화이트와인'], [83, 0.1, 0, 2.6], ['잔', 150], 'drink', { 병: 750 }),
];

const FOOD_BY_ID = new Map(FOODS.map((item) => [item.id, item]));

export function foodById(id: string): FoodItem | undefined {
  return FOOD_BY_ID.get(id);
}

/* ── 계산 ───────────────────────────────────────── */

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/** 그 무게만큼의 영양. kcal은 정수, 나머지는 소수 한 자리. */
export function nutrientsFor(per100: Nutrients, grams: number): Nutrients {
  const k = Math.max(0, grams) / 100;
  return {
    kcal: Math.round(per100.kcal * k),
    protein: round1(per100.protein * k),
    fat: round1(per100.fat * k),
    carbs: round1(per100.carbs * k),
  };
}

export function addNutrients(list: readonly Nutrients[]): Nutrients {
  const sum = list.reduce(
    (acc, item) => ({
      kcal: acc.kcal + (item.kcal || 0),
      protein: acc.protein + (item.protein || 0),
      fat: acc.fat + (item.fat || 0),
      carbs: acc.carbs + (item.carbs || 0),
    }),
    { kcal: 0, protein: 0, fat: 0, carbs: 0 },
  );
  return { kcal: Math.round(sum.kcal), protein: round1(sum.protein), fat: round1(sum.fat), carbs: round1(sum.carbs) };
}

/**
 * 탄단지가 칼로리의 몇 %인가 (단백질·탄수 4kcal/g, 지방 9kcal/g).
 * 술처럼 셋으로 설명이 안 되는 칼로리는 비율에 넣지 않는다.
 */
export function macroShare(total: Nutrients): { protein: number; fat: number; carbs: number } {
  const p = total.protein * 4;
  const f = total.fat * 9;
  const c = total.carbs * 4;
  const sum = p + f + c;
  if (sum <= 0) return { protein: 0, fat: 0, carbs: 0 };
  const protein = Math.round((p / sum) * 100);
  const fat = Math.round((f / sum) * 100);
  return { protein, fat, carbs: Math.max(0, 100 - protein - fat) };
}

/* ── 말로 적은 것 읽기 ─────────────────────────── */

export type Meal = 'breakfast' | 'lunch' | 'dinner' | 'snack';

export const MEAL_LABELS: Record<Meal, string> = {
  breakfast: '아침',
  lunch: '점심',
  dinner: '저녁',
  snack: '간식',
};

/** 지금 시각이면 어느 끼니인가 — 입력 칸의 기본값. */
export function mealForHour(hour: number): Meal {
  if (hour >= 4 && hour < 10.5) return 'breakfast';
  if (hour >= 10.5 && hour < 15) return 'lunch';
  if (hour >= 15 && hour < 17) return 'snack';
  if (hour >= 17 && hour < 21.5) return 'dinner';
  return 'snack';
}

const MEAL_WORDS: readonly [RegExp, Meal][] = [
  [/아침/, 'breakfast'],
  [/점심|낮에/, 'lunch'],
  [/저녁/, 'dinner'],
  [/간식|야식|후식|디저트/, 'snack'],
];

const NUMBER_WORDS: Record<string, number> = {
  한: 1, 하나: 1, 두: 2, 둘: 2, 세: 3, 셋: 3, 석: 3, 네: 4, 넷: 4, 다섯: 5, 여섯: 6,
  일곱: 7, 여덟: 8, 아홉: 9, 열: 10,
};

/** 그램으로 바로 바꾸는 단위 */
const WEIGHT_UNITS: Record<string, number> = {
  g: 1, 그램: 1, kg: 1000, 키로: 1000, ml: 1, 밀리: 1, cc: 1, l: 1000, 리터: 1000,
};

/** 셀 때 쓰는 단위 — 음식마다 무게가 다르다 */
const COUNT_UNITS = [
  '반마리', '공기', '그릇', '인분', '접시', '봉지', '숟가락', '티스푼', '큰술', '스푼', '스쿱',
  '조각', '토막', '덩이', '마리', '개', '장', '줄', '팩', '봉', '캔', '병', '잔', '컵', '줌', '모', '알', '쪽', '판', '회',
];

const UNIT_PATTERN = '(' + [...Object.keys(WEIGHT_UNITS), ...COUNT_UNITS]
  .sort((a, b) => b.length - a.length)
  .map((unit) => unit.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  .join('|') + ')';

const QTY_PATTERN = '(\\d+(?:\\.\\d+)?(?:\\s*/\\s*\\d+)?|반|' + Object.keys(NUMBER_WORDS).sort((a, b) => b.length - a.length).join('|') + ')';

function parseQty(token: string): number | null {
  const text = token.replace(/\s+/g, '');
  if (text === '반') return 0.5;
  if (NUMBER_WORDS[text] !== undefined) return NUMBER_WORDS[text]!;
  const frac = /^(\d+)\/(\d+)$/.exec(text);
  if (frac) return Number(frac[2]) > 0 ? Number(frac[1]) / Number(frac[2]) : null;
  const num = Number(text);
  return Number.isFinite(num) && num > 0 ? num : null;
}

function squash(text: string): string {
  return text.toLowerCase().replace(/\s+/g, '');
}

/** 이 글 안에 들어 있는 음식 이름 중 가장 긴 것 — "닭가슴살 소시지"는 "닭가슴살"이 아니다. */
export function matchFood(text: string, foods: readonly FoodItem[] = FOODS): { food: FoodItem; matched: string } | null {
  const hay = squash(text);
  let best: { food: FoodItem; matched: string; length: number } | null = null;
  for (const item of foods) {
    for (const name of [item.name, ...item.aliases]) {
      const needle = squash(name);
      if (!needle || !hay.includes(needle)) continue;
      if (!best || needle.length > best.length) best = { food: item, matched: name, length: needle.length };
    }
  }
  return best ? { food: best.food, matched: best.matched } : null;
}

export interface ParsedFood {
  food: FoodItem;
  /** 먹은 무게(g · ml) */
  grams: number;
  qty: number;
  unit: string;
  /** "반 공기" · "150g" · "2개" */
  amount: string;
  nutrients: Nutrients;
  /** 사람이 적은 그대로 */
  text: string;
  /** 그 음식에 없는 단위를 1인분으로 봤는가 */
  guessedUnit?: boolean;
  /** 이 줄에서 끼니를 말했으면 */
  meal?: Meal;
}

export interface ParseResult {
  items: ParsedFood[];
  /** 음식표에서 못 찾은 조각 */
  unknown: string[];
}

/** "반 공기", "2개", "150g" */
export function amountLabel(qty: number, unit: string): string {
  if (unit === 'g' || unit === 'ml') return Math.round(qty) + unit;
  const shown = qty === 0.5 ? '반 ' : (Math.round(qty * 10) / 10) + '';
  return shown + unit;
}

/** 단위 1의 무게. 그 음식에 없는 단위면 1인분으로 본다. */
function unitGrams(food: FoodItem, unit: string): { grams: number; guessed: boolean } {
  if (WEIGHT_UNITS[unit] !== undefined) return { grams: WEIGHT_UNITS[unit]!, guessed: false };
  if (unit === food.serving.unit) return { grams: food.serving.grams, guessed: false };
  if (food.units && food.units[unit] !== undefined) return { grams: food.units[unit]!, guessed: false };
  return { grams: food.serving.unit === 'g' ? 100 : food.serving.grams, guessed: true };
}

/** 한 음식을 그 양만큼 — 단위가 없으면 그 음식의 1회 양. */
export function portion(food: FoodItem, qty?: number | null, unit?: string | null): ParsedFood {
  let useUnit = unit || food.serving.unit;
  let useQty = qty ?? (unit ? 1 : food.serving.qty ?? 1);
  // "닭다리살 100" 처럼 숫자만 크게 적으면 g으로 본다
  if (!unit && qty !== undefined && qty !== null && qty >= 20 && food.serving.unit !== 'g') useUnit = 'g';
  if (useUnit === 'g' && !unit && (qty === undefined || qty === null)) useQty = food.serving.grams;
  const { grams: per, guessed } = useUnit === 'g' ? { grams: 1, guessed: false } : unitGrams(food, useUnit);
  const unitLabel = WEIGHT_UNITS[useUnit] !== undefined ? (useUnit === 'ml' || useUnit === 'l' || useUnit === '리터' || useUnit === 'cc' || useUnit === '밀리' ? 'ml' : 'g') : useUnit;
  const grams = Math.min(5000, Math.max(1, useQty * per));
  const shownQty = WEIGHT_UNITS[useUnit] !== undefined ? grams : useQty;
  return {
    food,
    grams: Math.round(grams),
    qty: useQty,
    unit: unitLabel,
    amount: amountLabel(shownQty, unitLabel),
    nutrients: nutrientsFor(food.per100, grams),
    text: food.name,
    guessedUnit: guessed || undefined,
  };
}

/** 음식 이름 하나를 글자 사이 띄어쓰기를 무시하고 찾는 정규식 */
function nameRegex(name: string): RegExp {
  const chars = [...name.replace(/\s+/g, '')].map((ch) => ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(chars.join('\\s*'), 'gi');
}

interface Mention { food: FoodItem; start: number; end: number; length: number }

/**
 * 한 조각 안의 음식들을 자리와 함께 — 긴 이름부터, 겹치지 않게.
 * "밥 반 공기 김치 1접시"처럼 나누는 말 없이 이어 적어도 둘을 다 찾는다.
 */
function mentions(chunk: string, foods: readonly FoodItem[]): Mention[] {
  const found: Mention[] = [];
  for (const item of foods) {
    for (const name of [item.name, ...item.aliases]) {
      const length = name.replace(/\s+/g, '').length;
      if (!length) continue;
      for (const match of chunk.matchAll(nameRegex(name))) {
        found.push({ food: item, start: match.index!, end: match.index! + match[0].length, length });
      }
    }
  }
  found.sort((a, b) => b.length - a.length || a.start - b.start);
  const picked: Mention[] = [];
  for (const item of found) {
    if (picked.some((p) => item.start < p.end && p.start < item.end)) continue;
    picked.push(item);
  }
  return picked.sort((a, b) => a.start - b.start);
}

/** 양을 적은 글 조각에서 양 · 단위를 읽는다 */
function readAmount(text: string): { qty: number | null; unit: string | null } | null {
  const full = new RegExp(QTY_PATTERN + '\\s*' + UNIT_PATTERN + '(\\s*반)?', 'i').exec(text);
  if (full) return { qty: (parseQty(full[1]!) ?? 1) + (full[3] ? 0.5 : 0), unit: full[2]!.toLowerCase() };
  const halfUnit = new RegExp('(?:^|\\s)' + UNIT_PATTERN + '\\s*반(?:$|\\s)', 'i').exec(text);
  if (halfUnit) return { qty: 0.5, unit: halfUnit[1]!.toLowerCase() };
  const bare = new RegExp('(?:^|\\s)' + QTY_PATTERN + '(?:\\s|$)').exec(text + ' ');
  if (bare) return { qty: parseQty(bare[1]!), unit: null };
  return null;
}

/**
 * "점심에 김치찌개 1인분이랑 밥 반 공기, 계란 2개" → 음식 셋.
 *
 * 쉼표 · 더하기 · 줄바꿈 · "~랑 / ~하고 / 그리고"로 나누고, 한 조각 안에
 * 음식이 여럿이면 자리로 나눈다. 양은 그 음식 **뒤**에 적은 것("밥 반 공기")을
 * 읽고, 없으면 앞("1인분 김치찌개")을 본다. "와/과"로는 나누지 않는다 —
 * "사과"가 "사"와 "과"로 쪼개진다.
 */
export function parseFoodText(input: string, foods: readonly FoodItem[] = FOODS): ParseResult {
  const items: ParsedFood[] = [];
  const unknown: string[] = [];
  let meal: Meal | undefined;
  const chunks = String(input || '')
    .replace(/[，、;]/g, ',')
    .split(/[,+\n]|(?<!\d)\/(?!\d)|(?:이랑|랑|하고|그리고|및)(?=\s|$)/)
    .map((chunk) => chunk.trim())
    .filter(Boolean);

  for (const raw of chunks) {
    let chunk = raw;
    for (const [pattern, which] of MEAL_WORDS) {
      if (pattern.test(chunk)) {
        meal = which;
        chunk = chunk.replace(new RegExp(pattern.source + '(에|엔|으로|로|은|는)?', 'g'), ' ');
      }
    }
    chunk = chunk.replace(/\s+/g, ' ').trim();
    // 끼니 말만 있던 조각("점심에")은 넘어간다
    if (!chunk || /^(먹었|먹음|먹어|먹은|먹고)/.test(chunk)) continue;

    const found = mentions(chunk, foods);
    if (found.length === 0) {
      const clean = chunk.replace(/(을|를|도|만|먹었어|먹었다|먹음|먹고|먹은)$/g, '').trim();
      if (clean) unknown.push(clean);
      continue;
    }

    found.forEach((hit, i) => {
      const after = chunk.slice(hit.end, i + 1 < found.length ? found[i + 1]!.start : chunk.length);
      const before = i === 0 ? chunk.slice(0, hit.start) : '';
      const amount = readAmount(after) ?? (before.trim() ? readAmount(before) : null);
      const parsed = amount ? portion(hit.food, amount.qty, amount.unit) : portion(hit.food, null, null);
      parsed.text = found.length > 1 ? chunk.slice(i === 0 ? 0 : hit.start, i + 1 < found.length ? found[i + 1]!.start : chunk.length).trim() : raw;
      if (meal) parsed.meal = meal;
      items.push(parsed);
    });
  }
  return { items, unknown };
}

/** 이름으로 찾기 — 앞부분이 맞는 것 먼저, 짧은 이름 먼저. */
export function searchFoods(query: string, foods: readonly FoodItem[] = FOODS, limit = 8): FoodItem[] {
  const q = squash(query);
  if (!q) return [];
  const scored: { food: FoodItem; score: number }[] = [];
  for (const item of foods) {
    let score = 0;
    for (const name of [item.name, ...item.aliases]) {
      const n = squash(name);
      if (n === q) score = Math.max(score, 100);
      else if (n.startsWith(q)) score = Math.max(score, 60 - n.length / 10);
      else if (n.includes(q)) score = Math.max(score, 30 - n.length / 10);
      else if (q.includes(n) && n.length >= 2) score = Math.max(score, 20 + n.length);
    }
    if (score > 0) scored.push({ food: item, score });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, limit).map((entry) => entry.food);
}

/* ── 적은 것 ───────────────────────────────────── */

export interface FoodEntry {
  id: string;
  /** YYYY-MM-DD */
  date: string;
  meal: Meal;
  /** 음식표의 것이면 id, 직접 넣은 것이면 없음 */
  foodId?: string;
  name: string;
  grams: number;
  amount: string;
  /**
   * 적은 순간의 숫자를 그대로 둔다. 나중에 음식표를 고쳐도 지난 기록이
   * 저절로 바뀌면 "지난주보다 많이 먹었나"가 흔들린다.
   */
  kcal: number;
  protein: number;
  fat: number;
  carbs: number;
}

export function entryFromParsed(parsed: ParsedFood, date: string, meal: Meal, id: string): FoodEntry {
  return {
    id, date, meal: parsed.meal ?? meal,
    foodId: parsed.food.id,
    name: parsed.food.name,
    grams: parsed.grams,
    amount: parsed.amount,
    ...parsed.nutrients,
  };
}

/** 양만 바꾼다 — 음식표의 것이면 다시 계산, 직접 넣은 것이면 비례로. */
export function rescaleEntry(entry: FoodEntry, factor: number): FoodEntry {
  const f = Math.max(0.1, Math.min(20, factor));
  const food = entry.foodId ? foodById(entry.foodId) : undefined;
  const grams = Math.round(entry.grams * f);
  const nutrients = food
    ? nutrientsFor(food.per100, grams)
    : { kcal: Math.round(entry.kcal * f), protein: round1(entry.protein * f), fat: round1(entry.fat * f), carbs: round1(entry.carbs * f) };
  const unitMatch = /^(반 |[\d.]+)(.*)$/.exec(entry.amount);
  let amount = grams + 'g';
  if (unitMatch && unitMatch[2] && unitMatch[2] !== 'g' && unitMatch[2] !== 'ml') {
    const before = unitMatch[1] === '반 ' ? 0.5 : Number(unitMatch[1]);
    amount = amountLabel(Math.round(before * f * 10) / 10, unitMatch[2]);
  } else if (unitMatch && unitMatch[2] === 'ml') {
    amount = grams + 'ml';
  }
  return { ...entry, grams, amount, ...nutrients };
}

export function totalsFor(entries: readonly FoodEntry[]): Nutrients {
  return addNutrients(entries);
}

export function dayEntries(entries: readonly FoodEntry[], date: string): FoodEntry[] {
  return entries.filter((entry) => entry.date === date);
}

/** 끼니별로 — 아침 · 점심 · 저녁 · 간식 순서 */
export function byMeal(entries: readonly FoodEntry[]): { meal: Meal; entries: FoodEntry[]; total: Nutrients }[] {
  const order: Meal[] = ['breakfast', 'lunch', 'dinner', 'snack'];
  return order.map((meal) => {
    const list = entries.filter((entry) => entry.meal === meal);
    return { meal, entries: list, total: addNutrients(list) };
  });
}

/** 자주 · 최근 먹은 것 — 한 번에 다시 넣는 줄. 같은 음식은 마지막 양으로 하나만. */
export function recentFoods(entries: readonly FoodEntry[], limit = 8): FoodEntry[] {
  const seen = new Map<string, { entry: FoodEntry; count: number; last: string }>();
  for (const entry of entries) {
    const key = entry.foodId || 'custom:' + entry.name;
    const prev = seen.get(key);
    if (!prev) seen.set(key, { entry, count: 1, last: entry.date });
    else {
      prev.count += 1;
      if (entry.date >= prev.last) { prev.entry = entry; prev.last = entry.date; }
    }
  }
  return [...seen.values()]
    .sort((a, b) => (b.count - a.count) || (a.last < b.last ? 1 : a.last > b.last ? -1 : 0))
    .slice(0, limit)
    .map((item) => item.entry);
}

/* ── 몇 주 모이면 ─────────────────────────────── */

function dayNumber(date: string): number {
  return Math.round(Date.parse(date + 'T00:00:00Z') / 86400000);
}

/**
 * 하루를 "다 적은 날"로 볼 것인가.
 *
 * 아침만 적은 날을 평균에 넣으면 평균이 실제보다 한참 낮아진다. 두 끼
 * 이상 적었거나 1,000kcal를 넘긴 날만 센다.
 */
export function isFullDay(entries: readonly FoodEntry[]): boolean {
  const meals = new Set(entries.map((entry) => entry.meal).filter((meal) => meal !== 'snack'));
  const kcal = entries.reduce((sum, entry) => sum + entry.kcal, 0);
  return meals.size >= 2 || kcal >= 1000;
}

export interface IntakeAverage {
  days: number;
  kcal: number;
  protein: number;
}

/** 최근 n일 중 다 적은 날의 평균 */
export function intakeAverage(entries: readonly FoodEntry[], today: string, days = 7): IntakeAverage | null {
  const end = dayNumber(today);
  const byDate = new Map<string, FoodEntry[]>();
  for (const entry of entries) {
    const gap = end - dayNumber(entry.date);
    if (gap < 0 || gap >= days) continue;
    const list = byDate.get(entry.date) ?? [];
    list.push(entry);
    byDate.set(entry.date, list);
  }
  const full = [...byDate.values()].filter(isFullDay);
  if (full.length === 0) return null;
  const sum = full.reduce((acc, list) => {
    const t = addNutrients(list);
    return { kcal: acc.kcal + t.kcal, protein: acc.protein + t.protein };
  }, { kcal: 0, protein: 0 });
  return { days: full.length, kcal: Math.round(sum.kcal / full.length), protein: Math.round(sum.protein / full.length) };
}

export interface MaintenanceEstimate {
  /** 이만큼 먹으면 체중이 그대로일 하루 칼로리 */
  kcal: number;
  /** 계산에 쓴 다 적은 날 */
  days: number;
  /** 그 기간 주당 체중 변화(kg) */
  weeklyKg: number;
  /** 그 기간 하루 평균 섭취 */
  intakeKcal: number;
}

/** 체지방 1kg ≈ 7,700kcal */
export const KCAL_PER_KG = 7700;

/**
 * 내 유지 칼로리 — 먹은 양과 저울로.
 *
 * 2주 동안 하루 평균 2,400kcal를 먹었는데 체중이 주 0.3kg씩 빠졌다면,
 * 유지량은 2,400 + 0.3×7,700/7 ≈ 2,730kcal다. 공식(기초대사량 × 활동계수)은
 * 사람마다 ±300kcal를 틀리지만 이 계산은 그 사람의 몸으로 한 것이다.
 *
 * 다 적은 날 10일 이상, 체중을 잰 날 4일 이상(10일 넘게 걸쳐)이어야 낸다.
 * 모자라면 null — 어설픈 숫자보다 "조금 더 모이면 나온다"가 낫다.
 */
export function maintenanceEstimate(
  entries: readonly FoodEntry[],
  weights: readonly { date: string; kg: number }[],
  today: string,
  windowDays = 21,
): MaintenanceEstimate | null {
  const avg = intakeAverage(entries, today, windowDays);
  if (!avg || avg.days < 10) return null;
  const end = dayNumber(today);
  const points = weights
    .filter((point) => Number.isFinite(point.kg) && point.kg > 0)
    .map((point) => ({ x: dayNumber(point.date), y: point.kg }))
    .filter((point) => end - point.x >= 0 && end - point.x < windowDays);
  if (points.length < 4) return null;
  const span = Math.max(...points.map((p) => p.x)) - Math.min(...points.map((p) => p.x));
  if (span < 10) return null;
  // 최소제곱 기울기(kg/일)
  const n = points.length;
  const mx = points.reduce((s, p) => s + p.x, 0) / n;
  const my = points.reduce((s, p) => s + p.y, 0) / n;
  const sxx = points.reduce((s, p) => s + (p.x - mx) ** 2, 0);
  const sxy = points.reduce((s, p) => s + (p.x - mx) * (p.y - my), 0);
  const slope = sxx > 0 ? sxy / sxx : 0;
  const kcal = Math.round((avg.kcal - slope * KCAL_PER_KG) / 50) * 50;
  return { kcal, days: avg.days, weeklyKg: Math.round(slope * 7 * 100) / 100, intakeKcal: avg.kcal };
}

/**
 * 유지 칼로리를 알았을 때 목표대로 가려면 — 밥 공기로 말한다.
 * 감량은 주 0.5kg(하루 −500kcal ≈ 밥 1⅔공기)보다 빠르게 잡지 않는다.
 */
export function intakeGuide(estimate: MaintenanceEstimate, goal: 'cut' | 'hold' | 'grow'): string {
  const bowl = Math.round(FOOD_BY_ID.get('rice')!.per100.kcal * 2.1);
  if (goal === 'cut') {
    const target = Math.round((estimate.kcal - 400) / 50) * 50;
    return `감량이면 하루 ${target.toLocaleString('ko-KR')}kcal 근처 — 유지량에서 400kcal(밥 한 공기 ${bowl}kcal 남짓)만 덜.`;
  }
  if (goal === 'grow') {
    const target = Math.round((estimate.kcal + 250) / 50) * 50;
    return `근육을 붙이려면 하루 ${target.toLocaleString('ko-KR')}kcal 근처 — 유지량에서 250kcal(우유 한 컵 + 바나나 하나)만 더.`;
  }
  return `지금 몸을 유지하려면 하루 ${estimate.kcal.toLocaleString('ko-KR')}kcal 근처면 됩니다.`;
}

/** 저장된 기록을 믿을 수 있는 모양으로 — 옛 버전이 남긴 이상한 값에 앱이 죽지 않게. */
export function normalizeFoodLog(raw: unknown): FoodEntry[] {
  if (!Array.isArray(raw)) return [];
  const meals: readonly string[] = ['breakfast', 'lunch', 'dinner', 'snack'];
  const out: FoodEntry[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const e = item as Record<string, unknown>;
    if (typeof e.id !== 'string' || typeof e.date !== 'string' || typeof e.name !== 'string') continue;
    const num = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0);
    out.push({
      id: e.id,
      date: e.date.slice(0, 10),
      meal: (meals.includes(e.meal as string) ? e.meal : 'snack') as Meal,
      foodId: typeof e.foodId === 'string' ? e.foodId : undefined,
      name: e.name.slice(0, 40),
      grams: num(e.grams),
      amount: typeof e.amount === 'string' ? e.amount.slice(0, 20) : '',
      kcal: Math.round(num(e.kcal)),
      protein: num(e.protein),
      fat: num(e.fat),
      carbs: num(e.carbs),
    });
  }
  return out;
}
