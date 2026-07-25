/** 날짜 표기 헬퍼 — 프로토타입의 표기 형식을 그대로 따른다. */

const DAYS = ['일', '월', '화', '수', '목', '금', '토'];

const d2 = (n) => String(n).padStart(2, '0');

/** "5월 3일 토요일 · 오전 10:14" (홈 기록 카드) */
export function formatCardDate(iso) {
  const d = new Date(iso);
  const ampm = d.getHours() < 12 ? '오전' : '오후';
  const h12 = d.getHours() % 12 || 12;
  return `${d.getMonth() + 1}월 ${d.getDate()}일 ${DAYS[d.getDay()]}요일 · ${ampm} ${h12}:${d2(d.getMinutes())}`;
}

/** "5월 8일 토요일 AM 9:05" (5초 기록 / 장소 상세) */
export function formatRecordDate(iso) {
  const d = new Date(iso);
  const ampm = d.getHours() < 12 ? 'AM' : 'PM';
  const h12 = d.getHours() % 12 || 12;
  return `${d.getMonth() + 1}월 ${d.getDate()}일 ${DAYS[d.getDay()]}요일 ${ampm} ${h12}:${d2(d.getMinutes())}`;
}

/** "26.05.30 기록" (캐러셀 라벨 스티커) */
export function formatStickerDate(iso) {
  const d = new Date(iso);
  return `${String(d.getFullYear()).slice(2)}.${d2(d.getMonth() + 1)}.${d2(d.getDate())} 기록`;
}

/** "2024년 5월 3일 (토)" (기록 수정 날짜 칩) */
export function formatEditDate(iso) {
  const d = new Date(iso);
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 (${DAYS[d.getDay()]})`;
}

/** "AM 2:45" (기록 수정 시간 칩) */
export function formatEditTime(iso) {
  const d = new Date(iso);
  const ampm = d.getHours() < 12 ? 'AM' : 'PM';
  const h12 = d.getHours() % 12 || 12;
  return `${ampm} ${h12}:${d2(d.getMinutes())}`;
}

/** "5월" (월별 기록 섹션 제목) */
export function formatMonth(iso) {
  return `${new Date(iso).getMonth() + 1}월`;
}

/** "5월 3일 부터 함께했어요" / D+n */
export function formatSince(dateStr) {
  const d = new Date(dateStr);
  return `${d.getMonth() + 1}월 ${d.getDate()}일 부터 함께했어요`;
}

export function dDay(dateStr) {
  const start = new Date(dateStr);
  start.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.floor((today - start) / 86400000) + 1;
}

/**
 * 기록 날짜 → 계절 key (`tokens.js`의 SEASONS와 맞춘다).
 *
 * 한국의 계절은 기준이 둘이다. 기상청이 쓰는 **기상학적 3개월 묶음**
 * (3~5 봄 / 6~8 여름 / 9~11 가을 / 12·1·2 겨울)과, 입춘·입하·입추·입동을
 * 경계로 삼는 **24절기** 기준(기상학적 기준보다 한 달쯤 이르다)이다.
 * 체감과 맞고 날짜만으로 계산되는 전자를 쓴다.
 *
 * 겨울만 해를 넘어가므로(12 → 1·2월) 월을 12로 나눈 나머지로 묶는다.
 */
export function seasonFromDate(iso) {
  const month = new Date(iso).getMonth() + 1; // 1~12
  return ['winter', 'spring', 'summer', 'autumn'][Math.floor((month % 12) / 3)];
}
