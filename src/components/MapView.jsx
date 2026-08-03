import { useEffect, useRef, useState } from 'react';
import { palette, fonts } from '@/styles/tokens';
import { loadKakaoMapsSdk } from '@/data/kakao-maps';

const validCoordinate = (lat, lng) =>
  Number.isFinite(Number(lat))
  && Number.isFinite(Number(lng))
  && Number(lat) >= -90
  && Number(lat) <= 90
  && Number(lng) >= -180
  && Number(lng) <= 180;

const markerKey = (id) => `${typeof id}:${String(id)}`;

const normalizedMarkers = (markers) => {
  const unique = new Map();
  for (const marker of Array.isArray(markers) ? markers : []) {
    if (marker?.id === undefined || marker?.id === null) continue;
    if (!validCoordinate(marker.lat, marker.lng)) continue;
    const key = markerKey(marker.id);
    if (unique.has(key)) continue;
    unique.set(key, {
      ...marker,
      lat: Number(marker.lat),
      lng: Number(marker.lng),
    });
  }
  return [...unique.values()];
};

const removeMarker = (maps, entry) => {
  if (entry?.listener && typeof maps?.event?.removeListener === 'function') {
    maps.event.removeListener(entry.marker, 'click', entry.listener);
  }
  entry?.marker?.setMap?.(null);
};

/** Kakao 지도 렌더러. SDK 실패 시에도 목록 선택을 이어갈 수 있는 폴백을 남긴다. */
export default function MapView({
  center,
  markers = [],
  onMarkerClick,
  width = 402,
  height = 560,
  selectedId = null,
}) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const mapsRef = useRef(null);
  const markerEntriesRef = useRef(new Map());
  const onMarkerClickRef = useRef(onMarkerClick);
  const [mapState, setMapState] = useState('loading');
  const [readyVersion, setReadyVersion] = useState(0);

  useEffect(() => {
    onMarkerClickRef.current = onMarkerClick;
  }, [onMarkerClick]);

  useEffect(() => {
    let active = true;

    loadKakaoMapsSdk()
      .then((maps) => {
        if (!active) return;
        if (
          typeof maps?.Map !== 'function'
          || typeof maps?.Marker !== 'function'
          || typeof maps?.LatLng !== 'function'
          || typeof maps?.event?.addListener !== 'function'
          || !containerRef.current
          || !validCoordinate(center?.lat, center?.lng)
        ) {
          throw new Error('Kakao map renderer is unavailable');
        }

        const initialCenter = new maps.LatLng(Number(center.lat), Number(center.lng));
        mapRef.current = new maps.Map(containerRef.current, { center: initialCenter });
        mapsRef.current = maps;
        setMapState('ready');
        setReadyVersion((version) => version + 1);
      })
      .catch(() => {
        if (active) setMapState('failed');
      });

    return () => {
      active = false;
      const maps = mapsRef.current;
      for (const entry of markerEntriesRef.current.values()) removeMarker(maps, entry);
      markerEntriesRef.current.clear();
      mapsRef.current = null;
      mapRef.current = null;
    };
    // The map instance belongs to this mounted renderer. Prop updates are handled below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const maps = mapsRef.current;
    const map = mapRef.current;
    if (!maps || !map || !validCoordinate(center?.lat, center?.lng)) return;
    map.setCenter?.(new maps.LatLng(Number(center.lat), Number(center.lng)));
  }, [center?.lat, center?.lng, readyVersion]);

  useEffect(() => {
    const maps = mapsRef.current;
    const map = mapRef.current;
    if (!maps || !map) return;

    const nextMarkers = normalizedMarkers(markers);
    const nextKeys = new Set(nextMarkers.map((marker) => markerKey(marker.id)));
    const entries = markerEntriesRef.current;

    try {
      for (const [key, entry] of entries) {
        if (nextKeys.has(key)) continue;
        removeMarker(maps, entry);
        entries.delete(key);
      }

      for (const markerData of nextMarkers) {
        const key = markerKey(markerData.id);
        const position = new maps.LatLng(markerData.lat, markerData.lng);
        let entry = entries.get(key);

        if (!entry) {
          const marker = new maps.Marker({ map, position });
          const listener = () => onMarkerClickRef.current?.(markerData.id);
          maps.event.addListener(marker, 'click', listener);
          entry = { marker, listener, lat: markerData.lat, lng: markerData.lng };
          entries.set(key, entry);
        } else if (entry.lat !== markerData.lat || entry.lng !== markerData.lng) {
          entry.marker.setPosition?.(position);
          entry.lat = markerData.lat;
          entry.lng = markerData.lng;
        }

        const selected = selectedId !== null && markerKey(selectedId) === key;
        entry.marker.setZIndex?.(selected ? 2 : 1);
        entry.marker.setOpacity?.(selectedId === null || selected ? 1 : 0.72);
      }
    } catch {
      for (const entry of entries.values()) removeMarker(maps, entry);
      entries.clear();
      setMapState('failed');
    }
  }, [markers, readyVersion, selectedId]);

  const fallbackMarkers = normalizedMarkers(markers);

  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        width,
        height,
        overflow: 'hidden',
        background: palette.mapArea,
      }}
    >
      <div
        ref={containerRef}
        role="application"
        aria-label="장소 지도"
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
      />

      {mapState !== 'ready' && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: palette.mapArea,
            color: palette.mapLabel,
            fontFamily: fonts.hand,
            textAlign: 'center',
          }}
        >
          <div
            role="status"
            style={{ position: 'absolute', left: 24, right: 24, top: 180, fontSize: 20 }}
          >
            {mapState === 'failed'
              ? '지도를 불러오지 못했어요. 아래 장소 목록에서 선택할 수 있어요.'
              : '지도를 불러오고 있어요.'}
          </div>

          {mapState === 'failed' && (
            <div
              aria-label="지도 대신 선택할 장소"
              style={{
                position: 'absolute',
                left: 24,
                right: 24,
                top: 224,
                display: 'flex',
                justifyContent: 'center',
                gap: 8,
                flexWrap: 'wrap',
              }}
            >
              {fallbackMarkers.map((marker, index) => (
                <button
                  key={markerKey(marker.id)}
                  type="button"
                  aria-label={`${marker.name || `장소 ${index + 1}`} 선택`}
                  aria-pressed={selectedId !== null && markerKey(selectedId) === markerKey(marker.id)}
                  onClick={() => onMarkerClick?.(marker.id)}
                  style={{
                    padding: '6px 10px',
                    borderRadius: 999,
                    background: palette.white,
                    color: palette.text,
                    fontFamily: fonts.hand,
                    fontSize: 16,
                    cursor: onMarkerClick ? 'pointer' : 'default',
                  }}
                >
                  {marker.name || `장소 ${index + 1}`}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
