import { useEffect, useMemo, useState } from 'react';
import { palette, fonts } from '@/styles/tokens';
import { flowerSvg, etcSvg } from '@assets/svg';
import Placeholder from './Placeholder';
import FlowerRating from './FlowerRating';
import { formatCardDate } from '@/data/format';

/** 홈 "n월의 기록" 목록 카드 (350×153) */
export default function RecordCard({ record, left = 26, top, onClick }) {
  const firstPhoto = useMemo(() => {
    const photos = Array.isArray(record.photos) ? record.photos : [];
    return photos.slice().sort((a, b) => {
      const aOrdinal = Number(a?.ordinal ?? a?.order);
      const bOrdinal = Number(b?.ordinal ?? b?.order);
      return (Number.isFinite(aOrdinal) ? aOrdinal : Number.POSITIVE_INFINITY)
        - (Number.isFinite(bOrdinal) ? bOrdinal : Number.POSITIVE_INFINITY);
    })[0] ?? null;
  }, [record.photos]);
  const photoUrl = [firstPhoto?.signedUrl, firstPhoto?.url]
    .find((url) => typeof url === 'string' && url.trim())?.trim();
  const [photoFailed, setPhotoFailed] = useState(false);

  useEffect(() => setPhotoFailed(false), [firstPhoto?.id, photoUrl]);

  return (
    <div
      onClick={onClick}
      style={{
        position: 'absolute',
        left,
        top,
        width: 350,
        height: 153,
        background: palette.card,
        borderRadius: 15,
        cursor: 'pointer',
      }}
    >
      {/*
        사진 업로드 전 썸네일 — scape.svg(92×92)에 하늘색 라운드 사각 배경
        (#C8E1F2, rx 10.857)이 이미 들어 있어 별도 background/radius가 필요 없다.
        104로 키우면 rx가 10.857 × 104/92 ≈ 12.3이라 카드 radius 12와 맞는다.
      */}
      {photoUrl && !photoFailed ? (
        <img
          data-record-photo
          src={photoUrl}
          width={104}
          height={104}
          alt={`${record.placeName} 사진`}
          onError={() => setPhotoFailed(true)}
          style={{
            position: 'absolute',
            left: 18,
            top: 18,
            display: 'block',
            borderRadius: 12,
            objectFit: 'cover',
          }}
        />
      ) : (
        <img
          data-record-photo-placeholder
          src={etcSvg.scape}
          width={104}
          height={104}
          alt=""
          style={{ position: 'absolute', left: 18, top: 18, display: 'block' }}
        />
      )}
      <div style={{ position: 'absolute', left: 128, top: 14, display: 'flex', flexDirection: 'row' }}>
        <div
          style={{
            padding: '2px 10px',
            background: palette.chipGreen,
            borderRadius: 999,
            fontFamily: fonts.hand,
            fontSize: 13.4,
            color: palette.text,
          }}
        >
          {record.category}
        </div>
      </div>
      <div
        style={{
          position: 'absolute',
          left: 128,
          top: 36,
          fontFamily: fonts.hand,
          fontSize: 23.4,
          color: palette.textStrong,
        }}
      >
        {record.placeName}
      </div>
      <FlowerRating
        value={record.rating}
        size={17}
        letterSpacing={4}
        style={{ position: 'absolute', left: 130, top: 68 }}
      />
      <div style={{ position: 'absolute', left: 128, top: 92, display: 'flex', flexDirection: 'row', gap: 6 }}>
        {record.tags.slice(0, 2).map((tag, i) => (
          <div
            key={i}
            style={{
              maxWidth: i === 0 ? 54 : undefined,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              padding: i === 0 ? '3px 10px' : '3px 8px',
              background: palette.bg,
              borderRadius: 999,
              fontFamily: fonts.hand,
              fontSize: 13.4,
              color: palette.textMuted,
            }}
          >
            {tag}
          </div>
        ))}
      </div>
      {/* 꽃갈피 */}
      <div
        style={{
          position: 'absolute',
          left: 262,
          top: 12,
          width: 70,
          height: 104,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {record.flower ? (
          <img
            src={flowerSvg[record.flower]}
            width={67}
            height={91}
            alt=""
            style={{ display: 'block', objectFit: 'contain' }}
          />
        ) : (
          <Placeholder label="꽃갈피" width={70} height={104} radius={10} />
        )}
      </div>
      <div
        style={{
          position: 'absolute',
          right: 16,
          bottom: 12,
          fontFamily: fonts.small,
          fontSize: 8.4,
          color: palette.textMuted,
        }}
      >
        {formatCardDate(record.date)}
      </div>
    </div>
  );
}
