import { lazy, Suspense } from 'react';
import { palette, fonts, SEASONS } from '@/styles/tokens';
import { etcSvg, flowerSvg, uiSvg } from '@assets/svg';
import Placeholder from './Placeholder';
import FlowerRating from './FlowerRating';
import MaskIcon from './MaskIcon';
import { formatRecordDate } from '@/data/format';

// README 규칙: SpringStar는 lazy import (장식 요소, 초기 번들 제외)
const SpringStar = lazy(() => import('@assets/icons/SpringStar'));

/**
 * 장소 상세 — season prop(spring/summer/autumn/winter)에 따라 배경·꽃 색이 바뀐다.
 * 계절은 호출부에서 기록 날짜의 월로 계산해 넘긴다(순환 버튼 없음).
 *
 * 히어로 상단의 `n/m`과 오른쪽 화살표는 **사진 페이저**다. 이전에는 이 자리가
 * 계절 순환(`1/4`)에 쓰였는데 시안은 `1/5` — 사진 5장을 넘기는 UI였다.
 */
export default function PlaceDetail({
  record,
  couple,
  season = 'spring',
  photoIndex = 0,
  photoCount = 0,
  onBack,
  onNextPhoto,
  onOpenPick,
  onOpenEdit,
}) {
  const theme = SEASONS.find((s) => s.key === season) || SEASONS[0];
  const myEntry = record.entries.find((e) => e.memberId === 'me');
  const partnerEntry = record.entries.find((e) => e.memberId === 'partner');

  const memoCard = (entry, left, top) => (
    <div
      style={{
        position: 'absolute',
        left,
        top,
        width: 277,
        height: 202,
        boxSizing: 'border-box',
      }}
    >
      <img
        src={etcSvg.memoNote}
        width={277}
        height={202}
        alt=""
        style={{
          position: 'absolute',
          inset: 0,
          display: 'block',
          filter: 'drop-shadow(0 2px 3px rgba(90, 70, 45, 0.08))',
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: 20,
          top: 44,
          padding: '2px 8px',
          background: palette.chipName,
          borderRadius: 4,
          fontFamily: fonts.hand,
          fontSize: 16,
          color: palette.text,
        }}
      >
        {entry.member.name}
      </div>
      <FlowerRating
        value={entry.rating}
        size={14}
        letterSpacing={4}
        activeColor={theme.flower}
        style={{ position: 'absolute', right: 16, top: 48 }}
      />
      <div
        style={{
          position: 'absolute',
          left: 20,
          top: 84,
          width: 237,
          fontFamily: fonts.hand,
          fontSize: 24,
          color: palette.textMuted,
          lineHeight: 1.5,
        }}
      >
        {entry.text}
      </div>
    </div>
  );

  const avatar = (member, left, top) => (
    <div
      style={{
        position: 'absolute',
        left,
        top,
        width: 48,
        height: 48,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: fonts.hand,
        fontSize: 28,
        color: palette.text,
      }}
    >
      <MaskIcon
        src={uiSvg.profile}
        color={member.color || palette.avatarCream}
        size={48}
        style={{ position: 'absolute', inset: 0 }}
      />
      <span style={{ position: 'relative', zIndex: 1 }}>{member.initial}</span>
    </div>
  );

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        background: theme.bg,
        transition: 'background-color 0.4s ease',
      }}
    >
      {/* 계절 히어로 이미지 — 업로드 전 placeholder */}
      <div style={{ position: 'absolute', left: 0, top: 0, width: 402, height: 280 }}>
        <Placeholder
          label={photoCount > 1 ? `장소 사진 ${photoIndex + 1}` : '장소 사진'}
          width={402}
          height={280}
        />
        {season === 'spring' && (
          <Suspense fallback={null}>
            <SpringStar size={22} style={{ position: 'absolute', right: 22, top: 96, opacity: 0.9 }} />
            <SpringStar size={13} color="#E8C34A" style={{ position: 'absolute', right: 50, top: 118, opacity: 0.8 }} />
          </Suspense>
        )}
      </div>
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: 120,
          width: 402,
          height: 160,
          background: 'linear-gradient(180deg, rgba(60,50,40,0) 0%, rgba(60,50,40,0.45) 100%)',
          pointerEvents: 'none',
        }}
      />
      {/* 상단 내비게이션 */}
      <button
        onClick={onBack}
        aria-label="뒤로"
        style={{
          position: 'absolute',
          left: 16,
          top: 66,
          width: 32,
          height: 32,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: fonts.sans,
          fontSize: 24,
          color: palette.heroText,
          lineHeight: 1,
          cursor: 'pointer',
        }}
      >
        <MaskIcon src={uiSvg.arrowLeft} color={palette.heroText} size={24} />
      </button>
      <div
        style={{
          position: 'absolute',
          left: 58,
          top: 71,
          width: 286,
          textAlign: 'center',
          fontFamily: fonts.hand,
          fontSize: 20,
          color: palette.heroSub,
        }}
      >
        {photoCount > 1 ? `${photoIndex + 1}/${photoCount}` : ''}
      </div>
      {onNextPhoto && (
      <button
        onClick={onNextPhoto}
        aria-label="다음 사진"
        style={{
          position: 'absolute',
          left: 354,
          top: 66,
          width: 32,
          height: 32,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: fonts.sans,
          fontSize: 24,
          color: palette.heroText,
          lineHeight: 1,
          cursor: 'pointer',
        }}
      >
        <MaskIcon src={uiSvg.arrowRight} color={palette.heroText} size={24} />
      </button>
      )}
      {/* 히어로 카피 */}
      <div style={{ position: 'absolute', left: 22, top: 172, display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <span style={{ fontFamily: fonts.hand, fontSize: 32, color: palette.heroText }}>{record.placeName}</span>
        <button
          type="button"
          onClick={onOpenEdit}
          aria-label="장소 이름 수정"
          style={{
            width: 24,
            height: 24,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
          }}
        >
          <MaskIcon src={etcSvg.pencil} color={palette.heroText} size={20} />
        </button>
      </div>
      <div style={{ position: 'absolute', left: 22, top: 211, fontFamily: fonts.hand, fontSize: 20, color: palette.heroSub }}>
        {formatRecordDate(record.date)}
      </div>
      <FlowerRating
        value={record.rating}
        size={18}
        letterSpacing={6}
        activeColor={theme.flower}
        style={{ position: 'absolute', left: 22, top: 240 }}
      />
      {/* 꽃갈피 북마크 */}
      <div
        style={{
          position: 'absolute',
          left: 290,
          top: 126,
          width: 76,
          height: 112,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {record.flower && flowerSvg[record.flower] ? (
          <img
            src={flowerSvg[record.flower]}
            width={72}
            height={98}
            alt=""
            style={{ display: 'block', objectFit: 'contain' }}
          />
        ) : (
          <img
            src={etcSvg.flowerBlank}
            width={72}
            height={98}
            alt=""
            style={{ display: 'block', objectFit: 'contain' }}
          />
        )}
      </div>
      <div
        onClick={onOpenPick}
        style={{
          position: 'absolute',
          left: 280,
          top: 250,
          width: 100,
          textAlign: 'center',
          fontFamily: fonts.hand,
          fontSize: 20,
          color: palette.heroSub,
          cursor: 'pointer',
        }}
      >
        꽃갈피 추가
      </div>
      {/* 태그 */}
      <div style={{ position: 'absolute', left: 22, top: 296, display: 'flex', flexDirection: 'row', gap: 12 }}>
        {record.tags.slice(0, 1).map((tag, i) => (
          <div
            key={i}
            style={{
              display: 'block',
              padding: '6px 16px',
              background: palette.card,
              borderRadius: 999,
              fontFamily: fonts.hand,
              fontSize: 20,
              color: palette.textMuted,
              maxWidth: 200,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {tag}
          </div>
        ))}
        <div
          style={{
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
            padding: '6px 16px',
            background: palette.card,
            borderRadius: 999,
            cursor: 'pointer',
          }}
        >
          <MaskIcon src={uiSvg.plusSketch} color={palette.textMuted} size={16} />
          <span style={{ fontFamily: fonts.hand, fontSize: 20, color: palette.textMuted }}>태그 추가</span>
        </div>
      </div>
      {/* 메모(한 줄) 카드 */}
      {myEntry && (
        <>
          {avatar(couple.me, 26, 351)}
          {memoCard({ ...myEntry, member: couple.me }, 98, 351)}
        </>
      )}
      {partnerEntry && (
        <>
          {memoCard({ ...partnerEntry, member: couple.partner }, 26, 563)}
          {avatar(couple.partner, 328, 563)}
        </>
      )}
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: 816,
          width: 402,
          textAlign: 'center',
          fontFamily: fonts.hand,
          fontSize: 14,
          color: palette.textMuted,
        }}
      >
        {record.placeName} · 함께한 기록
      </div>
    </div>
  );
}
