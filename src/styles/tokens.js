/**
 * 디자인 토큰 — "오늘,우리는" (Claude Design 프로토타입 기준)
 * 색/폰트는 여기에서만 정의하고, 컴포넌트는 이 모듈(또는 App이 주입하는
 * CSS 변수 --c-*)을 참조한다. 하드코딩 금지.
 */

export const palette = {
  // 바탕
  bg: '#F1EAE0', // 화면 기본 크림 배경
  stage: '#E9E2D5', // 폰 프레임 바깥(스테이지) 배경
  card: '#FFFCF4', // 카드/입력 크림 화이트
  sheet: '#FBFBFB', // 바텀시트 배경
  white: '#FFFFFF',

  // 텍스트
  textStrong: '#121D0D', // 제목 강조
  text: '#6E665E', // 본문 웜그레이
  textMuted: '#9A9088', // 보조 웜그레이
  textFaint: '#DBD0C2', // 플레이스홀더/비활성
  onOlive: '#FFFDF8', // 올리브 버튼 위 텍스트
  onOliveAlt: '#FFFCF4',
  heroText: '#FAF6F1', // 히어로 이미지 위 텍스트
  heroSub: '#ECE4D9',

  // 포인트
  pink: '#F3BCBC',
  beige: '#E4D2BA',
  olive: '#64741D',
  oliveHover: '#4F5C17',
  oliveBright: '#86A722',
  oliveSoft: '#B7C186',
  purple: '#9667BF',

  // 파생/부분 사용
  chipGreen: '#CBD3A4', // 카테고리 칩
  chipName: '#C3CD96', // 메모 작성자 칩
  chipDday: '#DCE5C8', // D+n 칩
  pickSelectedBg: '#E9EDDC', // 꽃갈피 카드 선택 배경
  disabled: '#DBD0C2', // 비활성 버튼
  navActive: '#18231D', // 하단 탭 활성
  monthIcon: '#C9DDF2', // (미사용) "n월의 기록" 아이콘 배경 — schedule-color.svg로 대체됨
  sheetHandle: '#D9D9D9',
  dim: 'rgba(51,48,43,0.55)',
  mapArea: '#E4D2BA', // 지도 플레이스홀더 영역
  mapLabel: '#B7A388',
  avatarCream: '#ECE1C6',

  // 마이페이지 / 가고 싶은 곳 (2026-07-25 시안)
  bgAlt: '#F8F3E6', // 마이페이지·가고싶은곳·지도 배경 (기본 bg보다 밝음)
  cardAlt: '#FFFDF8', // 설정 행·모달 카드
  hairline: '#F4EFE0', // 카드 inset 테두리
  textSubtle: '#837A6F', // 셰브론·보조 텍스트
  textDisabled: '#B0B0B0', // 커플 연결해제
  chipWish: '#BEC79A', // 가고 싶은 곳 카테고리 칩
  heart: '#B44350', // 커플 카드 하트
  dimModal: 'rgba(51,48,43,0.45)', // 내 정보 수정 모달 딤
  photoFill: 'linear-gradient(150deg, #7198CF 0%, #C7E4F6 100%)', // 사진 자리
};

/** 그림자 — 시안의 2단 카드 섀도우 / 1단 행 섀도우 / 하단 네비 */
export const shadows = {
  card: '0px 0.835px 1.670px 0px rgba(60,40,30,0.05), 0px 5.011px 15.033px 0px rgba(60,40,30,0.04)',
  row: '0px 0.835px 1.670px 0px rgba(60,40,30,0.05)',
  nav: '0px 2px 8px 0px rgba(60,40,30,0.08), 0px 10px 30px 0px rgba(60,40,30,0.07)',
  fab: '0px 4px 12px 0px rgb(170,176,167)',
};

export const fonts = {
  hand: "'GangwonEduHyeonokT', 'Noto Sans KR', sans-serif", // 메인(손글씨) — 눈누 웹폰트
  sans: "'Noto Sans KR', sans-serif", // 버튼/시스템 텍스트
  small: "'Pretendard', 'Noto Sans KR', sans-serif", // 카드 날짜 등 초소형
};

/**
 * 온보딩 배경 — 크림 바탕 + 우상단 노란 글로우 + 좌하단 초록 틴트.
 * Figma 온보딩 4화면 공통 배경(원본값). 단색 palette.bg만 깔면 안 된다.
 */
export const gradients = {
  onboarding: [
    'radial-gradient(55.6% 79.84% at 94.42% 12.29%, rgba(255,244,172,0.40) 0%, rgba(243,249,255,0.40) 100%)',
    'radial-gradient(41.89% 45.6% at 18.79% 78.32%, rgba(134,167,34,0.20) 0%, rgba(243,249,255,0.20) 100%)',
    palette.bg,
  ].join(', '),

  /**
   * 하단 네비의 초록 워시. 0deg = 아래에서 위로 — 아래 54%까지 #E9F0CB로 차 있고
   * 92.46%에서 투명해진다. 네비 컨테이너(402×114 @ top 761) 자체의 배경이다.
   */
  navWash: 'linear-gradient(0deg, rgb(233,240,203) 54.03%, rgba(233,240,203,0) 92.46%)',
};

/** 장소 상세 계절 테마 — PlaceDetail의 season prop 순서 */
export const SEASONS = [
  { key: 'spring', bg: '#F3E7E2', flower: '#F3BCBC' },
  { key: 'summer', bg: '#F0F9FF', flower: '#E8C34A' },
  { key: 'autumn', bg: '#ECE4D9', flower: '#B18FD6' },
  { key: 'winter', bg: '#FFFFFF', flower: '#D25C5C' },
];

/** 화면 규격 (402×874 모바일 기준, 상단 59px safe area) */
export const layout = {
  width: 402,
  height: 874,
  safeTop: 59,
};

/** App 루트에 주입되는 CSS 변수 맵 — index.css는 var(--c-*)만 참조 */
export const cssVars = {
  '--c-bg': palette.bg,
  '--c-stage': palette.stage,
  '--c-card': palette.card,
  '--c-text': palette.text,
  '--c-text-strong': palette.textStrong,
  '--c-text-muted': palette.textMuted,
  '--c-olive': palette.olive,
  '--c-olive-hover': palette.oliveHover,
  '--font-hand': fonts.hand,
  '--font-sans': fonts.sans,
};
