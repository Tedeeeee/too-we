/**
 * 화면이 사용하는 안정적인 Promise API.
 *
 * 영속 데이터는 Supabase 저장소에 위임하고, 장소 검색은 Kakao 어댑터에 위임한다.
 * 두 외부 설정은 실제 기능이 호출되는 시점에만 읽으므로 모듈 로딩은 네트워크나
 * 환경변수 유무에 의존하지 않는다.
 */
import { createRepositories } from './repositories';
import { getSupabaseClient } from './supabase';

// 저장소 경계와 장소 스냅샷 캐시는 route 전환 동안 공유한다. Supabase 클라이언트와
// Kakao SDK는 실제 데이터 호출 전까지 만들지 않으며, 공유 session.pending은 첫 화면의
// 병렬 조회를 하나의 익명 로그인으로 합친다.
const repositories = createRepositories({ getClient: getSupabaseClient });

export const getCouple = (...args) => repositories.couples.getCouple(...args);
export const createCouple = (...args) => repositories.couples.createCouple(...args);
export const reissueCoupleInvite = (...args) => repositories.couples.reissueCoupleInvite(...args);
export const connectWithCode = (...args) => repositories.couples.connectWithCode(...args);
export const setMyName = (...args) => repositories.couples.setMyName(...args);
export const completeOnboarding = (...args) => repositories.couples.completeOnboarding(...args);

export const getNearbyPlaces = (...args) => repositories.places.getNearbyPlaces(...args);
export const getPlace = (...args) => repositories.places.getPlace(...args);

export const getRecords = (...args) => repositories.visits.getRecords(...args);
export const getRecord = (...args) => repositories.visits.getRecord(...args);
export const saveFiveSecondRecord = (...args) => repositories.visits.saveFiveSecondRecord(...args);
export const setRecordFlower = (...args) => repositories.visits.setRecordFlower(...args);
export const updateRecord = (...args) => repositories.visits.updateRecord(...args);

export const getWishlist = (...args) => repositories.wishlist.getWishlist(...args);
export const getSettings = (...args) => repositories.settings.getSettings(...args);
