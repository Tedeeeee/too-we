import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { palette, fonts } from '@/styles/tokens';
import Screen from '@/components/Screen';
import MaskIcon from '@/components/MaskIcon';
import BackButton from '@/components/BackButton';
import MapView from '@/components/MapView';
import HandDrawnLine from '@/components/HandDrawnLine';
import { uiSvg } from '@assets/svg';
import { useApp } from '@/data/store';
import * as api from '@/data/api';

/** 지도(장소 선택) — 주변 장소를 골라 5초 기록으로 이동 */
export default function MapSelect() {
  const navigate = useNavigate();
  const { records } = useApp();
  const [places, setPlaces] = useState([]);

  useEffect(() => {
    api.getNearbyPlaces().then(setPlaces);
  }, []);

  // 상단 메모 칩: 최근 기록의 첫 태그 문구
  const memoChips = useMemo(() => {
    const texts = records
      .flatMap((r) => r.tags)
      .map((t) => t.replace(/^#\s*/, ''))
      .slice(0, 2);
    while (texts.length < 2 && texts.length > 0) texts.push(texts[0]);
    return texts;
  }, [records]);

  const rowTops = [62, 141, 219];
  const rowHeights = [78, 77, 77];

  const selectPlace = (place) =>
    navigate('/record', {
      state: { placeId: place.id, placeName: place.name, category: place.category },
    });

  return (
    <Screen>
      <MapView
        center={{ lat: 37.5443, lng: 127.0557 }}
        markers={places.map((p) => ({ id: p.id, lat: p.lat, lng: p.lng }))}
        width={402}
        height={560}
      />
      <BackButton left={16} top={68} />
      <div
        style={{
          position: 'absolute',
          left: 58,
          top: 64,
          width: 328,
          height: 40,
          background: palette.white,
          borderRadius: 999,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-end',
          padding: '0 16px',
          boxSizing: 'border-box',
        }}
      >
        <MaskIcon src={uiSvg.search} color={palette.text} size={20} />
      </div>
      <div style={{ position: 'absolute', left: 47, top: 115, display: 'flex', flexDirection: 'row', gap: 12 }}>
        {memoChips.map((text, i) => (
          <div
            key={i}
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
      {/* 주변 장소 바텀시트 */}
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: 522,
          width: 402,
          height: 352,
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
          주변 장소
        </div>
        {places.slice(0, 3).map((place, i) => (
          <div key={place.id}>
            <div style={{ position: 'absolute', left: 20, top: rowTops[i] + 10, fontFamily: fonts.hand, fontSize: 24, color: palette.textStrong }}>
              {place.name}
            </div>
            <div style={{ position: 'absolute', left: 20, top: rowTops[i] + 42, fontFamily: fonts.hand, fontSize: 20, color: palette.textMuted }}>
              {place.category} · {place.address}
            </div>
            <div style={{ position: 'absolute', left: 322, top: rowTops[i] + 26, fontFamily: fonts.hand, fontSize: 20, color: palette.textMuted }}>
              {place.walk}
            </div>
            <HandDrawnLine
              color={palette.beige}
              width={362}
              height={12}
              style={{
                position: 'absolute',
                left: 20,
                top: rowTops[i] + rowHeights[i] - 6,
              }}
            />
            <div
              onClick={() => selectPlace(place)}
              style={{ position: 'absolute', left: 0, top: rowTops[i], width: 402, height: rowHeights[i], cursor: 'pointer' }}
            />
          </div>
        ))}
      </div>
    </Screen>
  );
}
