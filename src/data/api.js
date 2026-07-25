/**
 * 데이터 접근 레이어 (mock).
 *
 * 화면/스토어는 반드시 이 모듈의 함수만 호출한다.
 * 실제 백엔드가 생기면 이 파일의 함수 내부를 fetch 호출로 바꾸면 되고,
 * 시그니처(입출력)는 그대로 유지한다. 모든 함수는 Promise를 반환한다.
 */
import { initialDb } from './fixtures';

// in-memory mock DB (새로고침 시 초기화)
let db = structuredClone(initialDb);
let seq = 100;

const clone = (v) => structuredClone(v);
const delay = (v, ms = 0) => new Promise((res) => setTimeout(() => res(v), ms));

/* ---------- couple / onboarding ---------- */

export async function getCouple() {
  return delay(clone(db.couple));
}

/** "시작하기" 갈래 — 새 커플 생성, 내 초대코드 발급 */
export async function createCouple() {
  db.couple.connected = false;
  return delay(clone(db.couple));
}

/** "초대코드를 받았어요" 갈래 — 코드로 상대와 연결 */
export async function connectWithCode(code) {
  if (!/^\d{6}$/.test(code)) throw new Error('초대코드는 숫자 6자리예요.');
  // mock: 어떤 6자리든 데모 커플(지은)과 연결됨
  db.couple.connected = true;
  db.couple.partner = { id: 'partner', name: '지은', initial: '지', color: '#F3BCBC' };
  db.couple.me = { ...db.couple.me, name: '', initial: '' };
  return delay(clone(db.couple));
}

export async function setMyName(name) {
  db.couple.me = { ...db.couple.me, name, initial: name.slice(0, 1) };
  return delay(clone(db.couple));
}

export async function completeOnboarding() {
  db.couple.onboarded = true;
  db.couple.connected = true;
  return delay(clone(db.couple));
}

/* ---------- places ---------- */

/** 지도 화면 "주변 장소" (실서비스: 좌표 기반 검색 API로 교체) */
export async function getNearbyPlaces() {
  return delay(clone(db.places));
}

export async function getPlace(placeId) {
  return delay(clone(db.places.find((p) => p.id === placeId) || null));
}

/* ---------- records ---------- */

export async function getRecords() {
  return delay(clone(db.records));
}

export async function getRecord(id) {
  return delay(clone(db.records.find((r) => r.id === id) || null));
}

/**
 * 데모용 — 홈 캐러셀의 "짝궁이 당신의 답을 기다리고 있어요" 카드를 보충한다.
 *
 * 캐러셀은 `내 한 줄이 아직 없는 기록`만 보여주는데, 픽스처에 그런 기록이 `r3`
 * 하나뿐이라 거기에 한 줄을 쓰면 홈 상단 카드가 사라져 버렸다. 시안은 이 상태를
 * 홈의 기본 화면(`상대 기다리는 화면`)으로 두므로, 데모에서는 비지 않게 유지한다.
 *
 * mock 전용 동작이다 — 실제 백엔드로 바꿀 때 이 함수는 같이 사라진다.
 */
function replenishPendingRecord() {
  const pending = db.records.filter((r) => !r.entries.some((e) => e.memberId === 'me'));
  if (pending.length) return;

  const place = db.places[0];
  db.records.push({
    id: `r${seq++}`,
    placeId: place.id,
    placeName: place.name,
    category: place.category,
    date: new Date().toISOString(),
    rating: 0,
    flower: null,
    tags: [],
    photos: [],
    entries: [{ memberId: 'partner', ...db.demoPartnerReply }],
  });
}

/**
 * 5초 기록 저장.
 * - recordId가 있으면(짝궁이 먼저 쓴 기록) 내 한 줄을 붙인다.
 * - placeId만 있으면 새 기록을 만든다. (데모: 상대 한 줄이 함께 생성돼
 *   프로토타입의 장소 상세 화면처럼 메모 2개가 보인다)
 */
export async function saveFiveSecondRecord({ recordId, placeId, text, rating, date }) {
  const myEntry = { memberId: 'me', text: text || '', rating: rating || 0 };

  if (recordId) {
    const rec = db.records.find((r) => r.id === recordId);
    if (!rec) throw new Error('기록을 찾을 수 없어요.');
    rec.entries = [myEntry, ...rec.entries.filter((e) => e.memberId !== 'me')];
    rec.rating = rating || rec.rating;
    replenishPendingRecord();
    return delay(clone(rec));
  }

  const place = db.places.find((p) => p.id === placeId) || db.places[0];
  const rec = {
    id: `r${seq++}`,
    placeId: place.id,
    placeName: place.name,
    category: place.category,
    date: date || new Date().toISOString(),
    rating: rating || 0,
    flower: null,
    tags: [],
    photos: [],
    entries: [myEntry, { memberId: 'partner', ...db.demoPartnerReply }],
  };
  db.records.push(rec);
  return delay(clone(rec));
}

/** 꽃갈피 선택 확정 */
export async function setRecordFlower(recordId, flowerKey) {
  const rec = db.records.find((r) => r.id === recordId);
  if (!rec) throw new Error('기록을 찾을 수 없어요.');
  rec.flower = flowerKey;
  return delay(clone(rec));
}

/** 기록 수정 화면 저장 */
export async function updateRecord(recordId, patch) {
  const rec = db.records.find((r) => r.id === recordId);
  if (!rec) throw new Error('기록을 찾을 수 없어요.');
  Object.assign(rec, patch);
  if (patch.text !== undefined) {
    const mine = rec.entries.find((e) => e.memberId === 'me');
    if (mine) mine.text = patch.text;
    else rec.entries.unshift({ memberId: 'me', text: patch.text, rating: rec.rating });
  }
  return delay(clone(rec));
}

/* ---------- mypage ---------- */

export async function getWishlist() {
  return delay(clone(db.wishlist));
}

export async function getSettings() {
  return delay(clone(db.settings));
}

/** 테스트/데모용 초기화 */
export function __resetDb() {
  db = structuredClone(initialDb);
}
