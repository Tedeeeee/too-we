/**
 * mock 픽스처 — 백엔드 연동 전 초기 데이터.
 * 데모 내용은 Claude Design 프로토타입의 화면 텍스트와 동일하게 맞춰져 있다.
 */

/** 꽃갈피 도감 (프로토타입 flowerDefs 그대로) */
export const FLOWERS = [
  { key: 'rose', name: '장미', meaning: '사랑, 아름다움', color: '#B4394B' },
  { key: 'marigold', name: '금잔화', meaning: '변치 않는 사랑', color: '#E8A33D' },
  { key: 'calla', name: '카라', meaning: '아름다운 사랑', color: '#E9E36B' },
  { key: 'clover', name: '네잎클로버', meaning: '행운, 약속', color: '#8FA86B' },
  { key: 'forgetmenot', name: '물망초', meaning: '나를 잊지 마세요', color: '#A9CBEF' },
  { key: 'lilac', name: '라일락', meaning: '첫사랑의 추억', color: '#9667BF' },
  { key: 'jasmine', name: '재스민', meaning: '순수한 사랑', color: '#E4D2BA' },
];

export const flowerByKey = (key) => FLOWERS.find((f) => f.key === key) || null;

/** 초대 코드 화면에 보여줄 초대한 사람 이름 (mock — 실서비스: 코드 조회 API) */
export const DEMO_INVITER = '지은';

const DEMO_MEMO =
  '케이크 진짜 맛있었고, 햇살이 좋아서 창가자리 기억이 오래 남았다. 다음에도 다시 오자.';

/** 초기 DB 스냅샷 — api.js가 이걸 복제해 in-memory DB로 사용 */
export const initialDb = {
  couple: {
    connected: false, // 온보딩 완료 전
    onboarded: false,
    inviteCode: '482195',
    startDate: '2026-05-03',
    // 프로토타입 데모 멤버. me = 본인, partner = 상대
    me: { id: 'me', name: '지은', initial: '지', color: '#E4D2BA' },
    partner: { id: 'partner', name: '태식', initial: '홍', color: '#F3BCBC' },
  },

  /** 지도 "주변 장소" 목록 (프로토타입은 동일 장소 3줄) */
  places: [
    { id: 'p1', name: '성수동 블루보틀', category: '카페', address: '서울 성동구 연무장길 7', walk: '도보 4분', lat: 37.5443, lng: 127.0557 },
    { id: 'p2', name: '성수동 블루보틀', category: '카페', address: '서울 성동구 연무장길 7', walk: '도보 4분', lat: 37.5443, lng: 127.0557 },
    { id: 'p3', name: '성수동 블루보틀', category: '카페', address: '서울 성동구 연무장길 7', walk: '도보 4분', lat: 37.5443, lng: 127.0557 },
  ],

  /**
   * 기록(record): 한 장소·한 날의 커플 기록.
   * entries = 멤버별 한 줄(메모) — 두 명 모두 쓰면 완성.
   */
  records: [
    {
      id: 'r1',
      placeId: 'p1',
      placeName: '성수동 블루보틀',
      category: '카페',
      date: '2026-05-03T10:14:00',
      rating: 3,
      flower: 'rose',
      tags: ['# 주차는 어려웠지만, 결국 좋았다. 사진찍기 좋은 곳을 저장', '# 사진 굿'],
      // 사진 페이저 데모용 자리표시자 — 업로드 기능이 붙으면 실제 URL이 들어간다
      photos: [{ id: 'ph1' }, { id: 'ph2' }, { id: 'ph3' }],
      entries: [
        { memberId: 'me', text: DEMO_MEMO, rating: 3 },
        { memberId: 'partner', text: DEMO_MEMO, rating: 3 },
      ],
    },
    {
      id: 'r2',
      placeId: 'p1',
      placeName: '성수동 블루보틀',
      category: '카페',
      date: '2026-05-03T10:14:00',
      rating: 3,
      flower: 'lilac',
      tags: ['# 주차는 어려웠지만, 결국 좋았다. 사진찍기 좋은 곳을 저장', '# 사진 굿'],
      photos: [],
      entries: [
        { memberId: 'me', text: DEMO_MEMO, rating: 3 },
        { memberId: 'partner', text: DEMO_MEMO, rating: 3 },
      ],
    },
    /*
     * 계절 디자인 검토용 예시 — 장소 상세 배경은 기록 날짜의 월로 정해진다
     * (3~5 봄 / 6~8 여름 / 9~11 가을 / 12·1·2 겨울). 위 r1·r2가 5월(봄)이므로
     * 아래 셋으로 여름·가을·겨울을 채워 네 계절을 모두 볼 수 있게 했다.
     */
    {
      id: 'r10',
      placeId: 'p1',
      placeName: '뚝섬 한강공원',
      category: '공원',
      date: '2026-07-04T18:40:00', // 7월 → 여름 (#F0F9FF)
      rating: 4,
      flower: 'marigold',
      tags: ['# 노을이 진짜였다', '# 자리 넓어서 좋음'],
      photos: [{ id: 'ph10' }, { id: 'ph11' }],
      entries: [
        { memberId: 'me', text: '바람 시원하고 노을이 오래 남았다. 돗자리 하나 더 챙겨오자.', rating: 4 },
        { memberId: 'partner', text: '해 질 때까지 앉아 있었던 게 제일 좋았어.', rating: 4 },
      ],
    },
    {
      id: 'r11',
      placeId: 'p1',
      placeName: '서울숲 카페거리',
      category: '카페',
      date: '2025-10-19T15:20:00', // 10월 → 가을 (#ECE4D9)
      rating: 5,
      flower: 'lilac',
      tags: ['# 낙엽 밟는 소리', '# 창가 자리 추천'],
      photos: [],
      entries: [
        { memberId: 'me', text: '단풍이 딱 좋을 때 왔다. 사진이 다 잘 나왔어.', rating: 5 },
        { memberId: 'partner', text: '커피보다 산책이 더 기억에 남는 날.', rating: 5 },
      ],
    },
    {
      id: 'r12',
      placeId: 'p1',
      placeName: '어라운드 성수',
      category: '카페',
      date: '2026-01-17T13:05:00', // 1월 → 겨울 (#FFFFFF)
      rating: 3,
      flower: 'jasmine',
      tags: ['# 창밖에 눈'],
      photos: [{ id: 'ph12' }],
      entries: [
        { memberId: 'me', text: '눈 오는 걸 창가에서 한참 봤다. 손이 시려서 붙어 앉았지.', rating: 3 },
        { memberId: 'partner', text: '따뜻한 거 마시면서 눈 구경한 게 다였는데 좋았어.', rating: 3 },
      ],
    },
    {
      // 홈 캐러셀 1번 카드: 상대는 썼고 나는 아직 → "짝궁이 당신의 답을 기다리고 있어요!"
      id: 'r3',
      placeId: 'p1',
      placeName: '성수동 블루보틀',
      category: '카페',
      date: '2026-05-30T09:05:00',
      rating: 0,
      flower: null,
      tags: [],
      photos: [],
      entries: [{ memberId: 'partner', text: DEMO_MEMO, rating: 3 }],
    },
  ],

  /** 가고 싶은 곳 — 카드에 카테고리 칩과 "누가 담았는지"가 함께 나온다 */
  wishlist: [
    { id: 'w1', name: '어라운드 성수', category: '카페', pickedBy: '지은' },
    { id: 'w2', name: '뚝섬 한강공원', category: '공원', pickedBy: '태식' },
    { id: 'w3', name: '서울숲 카페거리', category: '카페', pickedBy: '지은' },
  ],

  settings: {
    recordAlert: '도보 4분', // 프로토타입 표기 그대로
  },

  /** 상대가 아직 안 쓴 기록을 저장하면 데모용으로 붙는 상대 한 줄 (프로토타입 상세화면 재현) */
  demoPartnerReply: { text: DEMO_MEMO, rating: 3 },
};
