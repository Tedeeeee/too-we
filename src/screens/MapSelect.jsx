import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { palette, fonts } from '@/styles/tokens';
import Screen from '@/components/Screen';
import MaskIcon from '@/components/MaskIcon';
import BackButton from '@/components/BackButton';
import MapView from '@/components/MapView';
import HandDrawnLine from '@/components/HandDrawnLine';
import { uiSvg } from '@assets/svg';
import { useApp } from '@/data/store';
import * as api from '@/data/api';

const DEFAULT_CENTER = { lat: 37.5443, lng: 127.0557 };
/**
 * 지도 위에 겹치는 요소들의 z-index. MapView가 지도(와 SDK가 심는 pane 전부)를
 * z-index 0 한 층에 격리하므로, 지도와 겹치는 오버레이는 모두 그 바로 위 한 층에 둔다.
 * 같은 값이라 오버레이끼리는 지금처럼 DOM 순서대로 쌓인다.
 */
const OVERLAY_Z_INDEX = 1;
const GEOLOCATION_OPTIONS = {
  enableHighAccuracy: false,
  timeout: 8_000,
  maximumAge: 300_000,
};

const validLocation = (lat, lng) =>
  Number.isFinite(Number(lat))
  && Number.isFinite(Number(lng))
  && Number(lat) >= -90
  && Number(lat) <= 90
  && Number(lng) >= -180
  && Number(lng) <= 180;

const locationErrorMessage = (error) => {
  if (error?.code === 1) return '위치 권한 없이도 장소를 검색하고 선택할 수 있어요.';
  if (error?.code === 3) return '현재 위치 확인이 늦어지고 있어요. 키워드로 검색해 주세요.';
  return '현재 위치를 확인할 수 없어요. 키워드로 검색해 주세요.';
};

const PLACE_SNAPSHOT_KEYS = [
  'id',
  'providerId',
  'provider_id',
  'provider',
  'name',
  'category',
  'address',
  'roadAddress',
  'road_address',
  'phone',
  'url',
  'lat',
  'lng',
  'walk',
];

const freezePlaceSnapshot = (place) => {
  if (!place || typeof place !== 'object' || Array.isArray(place)) return place;
  const snapshot = {};
  PLACE_SNAPSHOT_KEYS.forEach((key) => {
    if (Object.hasOwn(place, key)) snapshot[key] = place[key];
  });
  return Object.freeze(snapshot);
};

const freezeEditDraft = (draft, placeOverride) => {
  if (!draft || typeof draft !== 'object') return null;
  const place = freezePlaceSnapshot(placeOverride || draft.place);
  const tags = Object.freeze(Array.isArray(draft.tags) ? draft.tags.slice() : []);
  return Object.freeze({
    place: place && typeof place === 'object' ? Object.freeze(place) : place,
    date: draft.date,
    time: draft.time,
    flower: draft.flower ?? null,
    tags,
    text: draft.text,
    rating: draft.rating,
  });
};

/** 지도(장소 선택) — 키워드 검색 결과를 지도와 연결하고 진입 intent를 지킨다. */
export default function MapSelect() {
  const navigate = useNavigate();
  const routeLocation = useLocation();
  const { records } = useApp();
  const [keyword, setKeyword] = useState('');
  const [places, setPlaces] = useState([]);
  const [selectedPlaceId, setSelectedPlaceId] = useState(null);
  const [searchState, setSearchState] = useState('idle');
  const [userLocation, setUserLocation] = useState(null);
  const [locationMessage, setLocationMessage] = useState('현재 위치를 확인하고 있어요.');
  const requestSequenceRef = useRef(0);
  const inFlightSearchesRef = useRef(new Map());
  const lastSubmittedKeywordRef = useRef('');
  const mountedRef = useRef(true);
  const geolocationRequestedRef = useRef(false);

  const isNewRecordIntent = routeLocation.state?.intent === 'new-record';
  const editRecordId = routeLocation.state?.intent === 'edit-record-place'
    && typeof routeLocation.state?.recordId === 'string'
    ? routeLocation.state.recordId
    : null;
  const editDraft = editRecordId ? freezeEditDraft(routeLocation.state?.draft) : null;
  const isWishlistAddIntent = routeLocation.state?.intent === 'wishlist-add';
  const wishlistEditId = routeLocation.state?.intent === 'wishlist-edit'
    && typeof routeLocation.state?.wishlistId === 'string'
    && routeLocation.state.wishlistId.trim()
    ? routeLocation.state.wishlistId.trim()
    : null;
  const isWishlistIntent = isWishlistAddIntent || Boolean(wishlistEditId);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestSequenceRef.current += 1;
    };
  }, []);

  useEffect(() => {
    if (geolocationRequestedRef.current) return undefined;
    geolocationRequestedRef.current = true;
    const geolocation = globalThis.navigator?.geolocation;

    if (typeof geolocation?.getCurrentPosition !== 'function') {
      setLocationMessage('현재 위치를 확인할 수 없어요. 키워드로 검색해 주세요.');
      return undefined;
    }

    try {
      geolocation.getCurrentPosition(
        (position) => {
          if (!mountedRef.current) return;
          const lat = position?.coords?.latitude;
          const lng = position?.coords?.longitude;
          if (!validLocation(lat, lng)) {
            setLocationMessage('현재 위치를 확인할 수 없어요. 키워드로 검색해 주세요.');
            return;
          }
          setUserLocation({ lat: Number(lat), lng: Number(lng) });
          setLocationMessage('현재 위치를 반영했어요.');
        },
        (error) => {
          if (mountedRef.current) setLocationMessage(locationErrorMessage(error));
        },
        GEOLOCATION_OPTIONS,
      );
    } catch {
      setLocationMessage('현재 위치를 확인할 수 없어요. 키워드로 검색해 주세요.');
    }
    return undefined;
  }, []);

  // 상단 메모 칩: 최근 기록의 첫 태그 문구
  const memoChips = useMemo(() => {
    const texts = (Array.isArray(records) ? records : [])
      .flatMap((record) => (Array.isArray(record?.tags) ? record.tags : []))
      .map((tag) => String(tag).replace(/^#\s*/, ''))
      .slice(0, 2);
    while (texts.length < 2 && texts.length > 0) texts.push(texts[0]);
    return texts;
  }, [records]);

  const visiblePlaces = places.slice(0, 3);
  const selectedPlace = visiblePlaces.find((place) => place.id === selectedPlaceId);
  const mapCenter = selectedPlace && validLocation(selectedPlace.lat, selectedPlace.lng)
    ? { lat: Number(selectedPlace.lat), lng: Number(selectedPlace.lng) }
    : userLocation || DEFAULT_CENTER;

  const searchPlaces = async (rawKeyword) => {
    const trimmedKeyword = String(rawKeyword ?? '').trim();
    if (!trimmedKeyword) {
      requestSequenceRef.current += 1;
      setSearchState('validation');
      return;
    }

    const query = {
      keyword: trimmedKeyword,
      ...(userLocation ? { lat: userLocation.lat, lng: userLocation.lng } : {}),
    };
    const requestKey = JSON.stringify(query);
    const inFlightSearch = inFlightSearchesRef.current.get(requestKey);
    if (inFlightSearch) {
      if (inFlightSearch.requestId === requestSequenceRef.current) return;

      const requestId = requestSequenceRef.current + 1;
      requestSequenceRef.current = requestId;
      inFlightSearch.requestId = requestId;
      lastSubmittedKeywordRef.current = trimmedKeyword;
      setSearchState('loading');
      return;
    }

    const requestId = requestSequenceRef.current + 1;
    requestSequenceRef.current = requestId;
    const requestState = { requestId };
    inFlightSearchesRef.current.set(requestKey, requestState);
    lastSubmittedKeywordRef.current = trimmedKeyword;
    setSearchState('loading');

    try {
      const result = await api.getNearbyPlaces(query);
      if (!mountedRef.current || requestSequenceRef.current !== requestState.requestId) return;
      const nextPlaces = Array.isArray(result)
        ? result.filter((place) => place && place.id !== undefined && place.id !== null)
        : [];
      setPlaces(nextPlaces);
      setSelectedPlaceId(null);
      setSearchState(nextPlaces.length ? 'success' : 'empty');
    } catch {
      if (!mountedRef.current || requestSequenceRef.current !== requestState.requestId) return;
      setSearchState('error');
    } finally {
      if (inFlightSearchesRef.current.get(requestKey) === requestState) {
        inFlightSearchesRef.current.delete(requestKey);
      }
    }
  };

  const submitSearch = (event) => {
    event.preventDefault();
    searchPlaces(keyword);
  };

  const selectPlace = (place) => {
    if (!place) return;
    setSelectedPlaceId(place.id);
    const snapshot = freezePlaceSnapshot(place);
    if (editRecordId) {
      const returnedDraft = freezeEditDraft(editDraft, snapshot);
      navigate(`/place/${editRecordId}/edit`, {
        replace: true,
        state: returnedDraft
          ? Object.freeze({ draft: returnedDraft })
          : Object.freeze({ place: snapshot }),
      });
      return;
    }
    if (isWishlistAddIntent) {
      navigate('/mypage/wishlist', {
        replace: true,
        state: Object.freeze({ intent: 'wishlist-add', place: snapshot }),
      });
      return;
    }
    if (wishlistEditId) {
      navigate('/mypage/wishlist', {
        replace: true,
        state: Object.freeze({
          intent: 'wishlist-edit',
          wishlistId: wishlistEditId,
          place: snapshot,
        }),
      });
      return;
    }
    if (!isNewRecordIntent) return;

    navigate('/record', {
      state: Object.freeze({
        place: snapshot,
        placeId: snapshot.id,
        name: snapshot.name,
        placeName: snapshot.name,
        category: snapshot.category,
      }),
    });
  };

  const selectMarker = (placeId) => {
    const place = visiblePlaces.find((candidate) => candidate.id === placeId);
    if (place) selectPlace(place);
  };

  const rowTops = [62, 141, 219];
  const rowHeights = [78, 77, 77];

  return (
    <Screen>
      <MapView
        center={mapCenter}
        markers={visiblePlaces.map((place) => ({
          id: place.id,
          name: place.name,
          lat: place.lat,
          lng: place.lng,
        }))}
        selectedId={selectedPlaceId}
        onMarkerClick={selectMarker}
        width={402}
        height={560}
      />
      <BackButton
        left={16}
        top={68}
        style={{ zIndex: OVERLAY_Z_INDEX }}
        onClick={isWishlistIntent
          ? () => navigate('/mypage/wishlist', { replace: true })
          : editRecordId && editDraft
            ? () => navigate(`/place/${editRecordId}/edit`, {
                replace: true,
                state: Object.freeze({ draft: freezeEditDraft(editDraft) }),
              })
            : undefined}
      />

      <form
        onSubmit={submitSearch}
        role="search"
        style={{
          position: 'absolute',
          left: 58,
          top: 64,
          width: 328,
          height: 40,
          zIndex: OVERLAY_Z_INDEX,
          background: palette.white,
          borderRadius: 999,
          display: 'flex',
          alignItems: 'center',
          padding: '0 8px 0 16px',
          boxSizing: 'border-box',
          gap: 8,
        }}
      >
        <label
          htmlFor="map-place-search"
          style={{
            position: 'absolute',
            width: 1,
            height: 1,
            padding: 0,
            margin: -1,
            overflow: 'hidden',
            clip: 'rect(0, 0, 0, 0)',
            whiteSpace: 'nowrap',
            border: 0,
          }}
        >
          장소 검색어
        </label>
        <input
          id="map-place-search"
          type="search"
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
          placeholder="장소를 검색해 주세요"
          autoComplete="off"
          style={{
            flex: 1,
            minWidth: 0,
            border: 0,
            outline: 0,
            background: 'transparent',
            color: palette.text,
            fontFamily: fonts.hand,
            fontSize: 20,
          }}
        />
        <button
          type="submit"
          aria-label="장소 검색"
          style={{
            width: 32,
            height: 32,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            flexShrink: 0,
          }}
        >
          <MaskIcon src={uiSvg.search} color={palette.text} size={20} />
        </button>
      </form>

      <div
        role="status"
        aria-label="위치 상태"
        style={{
          position: 'absolute',
          left: 58,
          top: 158,
          maxWidth: 310,
          zIndex: OVERLAY_Z_INDEX,
          padding: '3px 10px',
          borderRadius: 999,
          background: 'rgba(255,252,244,0.9)',
          color: palette.textMuted,
          fontFamily: fonts.hand,
          fontSize: 15,
        }}
      >
        {locationMessage}
      </div>

      <div style={{ position: 'absolute', left: 47, top: 115, zIndex: OVERLAY_Z_INDEX, display: 'flex', flexDirection: 'row', gap: 12 }}>
        {memoChips.map((text, index) => (
          <div
            key={`${text}-${index}`}
            style={{
              display: 'flex',
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6,
              padding: '5px 14px',
              background: 'rgba(255,252,244,0.95)',
              borderRadius: 999,
            }}
          >
            <img
              src={uiSvg.time}
              width={16}
              height={16}
              alt=""
              style={{ display: 'block', opacity: 0.58 }}
            />
            <span
              style={{
                maxWidth: 96,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                fontFamily: fonts.hand,
                fontSize: 20,
                color: palette.textMuted,
              }}
            >
              {text}
            </span>
          </div>
        ))}
      </div>

      {/* 검색 결과 바텀시트 */}
      <div
        aria-busy={searchState === 'loading'}
        style={{
          position: 'absolute',
          left: 0,
          top: 522,
          width: 402,
          height: 352,
          zIndex: OVERLAY_Z_INDEX,
          background: palette.sheet,
          borderRadius: '24px 24px 0 0',
        }}
      >
        <div
          style={{
            position: 'absolute',
            left: 170,
            top: 10,
            width: 62,
            height: 6,
            background: palette.sheetHandle,
            borderRadius: 9999,
          }}
        />
        <div style={{ position: 'absolute', left: 16, top: 36, fontFamily: fonts.hand, fontSize: 16, color: palette.textMuted }}>
          {searchState === 'idle' ? '주변 장소' : '검색 결과'}
        </div>

        {searchState === 'idle' && (
          <div style={{ position: 'absolute', left: 20, top: 78, fontFamily: fonts.hand, fontSize: 20, color: palette.textMuted }}>
            키워드로 장소를 찾아보세요.
          </div>
        )}
        {searchState === 'validation' && (
          <div role="status" aria-label="검색 상태" style={{ position: 'absolute', left: 20, top: 78, fontFamily: fonts.hand, fontSize: 20, color: palette.textMuted }}>
            검색어를 입력해 주세요.
          </div>
        )}
        {searchState === 'loading' && (
          <div role="status" aria-label="검색 상태" style={{ position: 'absolute', left: 20, top: 78, fontFamily: fonts.hand, fontSize: 20, color: palette.textMuted }}>
            장소를 찾고 있어요…
          </div>
        )}
        {searchState === 'empty' && (
          <div role="status" aria-label="검색 상태" style={{ position: 'absolute', left: 20, top: 78, fontFamily: fonts.hand, fontSize: 20, color: palette.textMuted }}>
            검색 결과가 없어요. 다른 키워드로 찾아보세요.
          </div>
        )}
        {searchState === 'error' && (
          <div
            role="alert"
            style={{
              position: 'absolute',
              left: 20,
              right: 20,
              top: 70,
              fontFamily: fonts.hand,
              fontSize: 20,
              color: palette.text,
            }}
          >
            <div>장소를 불러오지 못했어요. 다시 시도해 주세요.</div>
            <button
              type="button"
              aria-label="검색 다시 시도"
              onClick={() => searchPlaces(lastSubmittedKeywordRef.current)}
              style={{
                marginTop: 12,
                padding: '7px 14px',
                borderRadius: 999,
                background: palette.card,
                color: palette.olive,
                fontFamily: fonts.sans,
                fontSize: 14,
                cursor: 'pointer',
              }}
            >
              다시 시도
            </button>
          </div>
        )}

        {searchState === 'success' && visiblePlaces.map((place, index) => {
          const selected = place.id === selectedPlaceId;
          return (
            <button
              key={place.id}
              type="button"
              aria-label={`${place.name} 결과 선택`}
              aria-pressed={selected}
              onClick={() => selectPlace(place)}
              style={{
                position: 'absolute',
                left: 0,
                top: rowTops[index],
                width: 402,
                height: rowHeights[index],
                border: 0,
                background: selected ? 'rgba(233,237,220,0.75)' : 'transparent',
                textAlign: 'left',
                cursor: 'pointer',
              }}
            >
              <span style={{ position: 'absolute', left: 20, top: 10, fontFamily: fonts.hand, fontSize: 24, color: palette.textStrong }}>
                {place.name}
              </span>
              <span
                style={{
                  position: 'absolute',
                  left: 20,
                  top: 42,
                  width: 285,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  fontFamily: fonts.hand,
                  fontSize: 20,
                  color: palette.textMuted,
                }}
              >
                {[place.category, place.address].filter(Boolean).join(' · ')}
              </span>
              {place.walk && (
                <span style={{ position: 'absolute', right: 20, top: 26, fontFamily: fonts.hand, fontSize: 20, color: palette.textMuted }}>
                  {place.walk}
                </span>
              )}
              <HandDrawnLine
                color={palette.beige}
                width={362}
                height={12}
                style={{
                  position: 'absolute',
                  left: 20,
                  top: rowHeights[index] - 6,
                }}
              />
            </button>
          );
        })}
      </div>
    </Screen>
  );
}
