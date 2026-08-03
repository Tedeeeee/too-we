/**
 * 화면이 사용하는 안정적인 Promise API.
 *
 * 영속 데이터는 Supabase 저장소에 위임하고, 설정은 클라이언트가 실제 호출되는 시점에
 * 읽는다. 따라서 테스트는 네트워크 없이 Supabase 클라이언트 대역을 주입할 수 있다.
 */
import { createRepositories } from './repositories';
import { getSupabaseClient } from './supabase';

// 저장소 경계는 공유하되 Supabase 클라이언트는 실제 데이터 호출 전까지 만들지 않는다.
// 공유 session.pending이 첫 화면의 병렬 조회를 하나의 익명 로그인으로 합친다.
const repositories = createRepositories({ getClient: getSupabaseClient });

export const getCouple = (...args) => repositories.couples.getCouple(...args);
export const createCouple = (...args) => repositories.couples.createCouple(...args);
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
