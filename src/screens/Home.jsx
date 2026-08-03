import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { palette, fonts } from '@/styles/tokens';
import { RoseIllust } from '@assets/icons';
import { etcSvg, onboardingSvg, uiSvg, svgSize } from '@assets/svg';
import Screen from '@/components/Screen';
import MaskIcon from '@/components/MaskIcon';
import RecordCard from '@/components/RecordCard';
import BottomNav from '@/components/BottomNav';
import { useApp } from '@/data/store';
import { formatMonth, formatStickerDate } from '@/data/format';

const GROUP_HEADER_H = 49; // 월 헤더 아래 첫 카드까지
const CARD_STEP = 165; // 카드 153 + 간격 12
const GROUP_GAP = 24; // 월 그룹 사이

/** 홈(main) — 기록 카드 캐러셀 + 월별 기록 */
export default function Home() {
  const navigate = useNavigate();
  const app = useApp();
  const couple = {
    me: app.couple?.me ?? {},
    partner: app.couple?.partner ?? {},
  };
  const records = app.records;
  const [carouselIdx, setCarouselIdx] = useState(0);
  const safeRecords = Array.isArray(records) ? records : [];

  // 캐러셀: 내 한 줄이 아직 없는(진행 중) 기록 카드들 + 마지막 빈 카드
  const pendingRecords = useMemo(
    () => safeRecords.filter((record) => record?.pending === true),
    [safeRecords],
  );
  const dotCount = pendingRecords.length + 1;

  // 월별 기록: 완성된 기록을 최신 달 기준으로 묶는다
  const completeRecords = useMemo(
    () =>
      safeRecords
        .filter((record) => record?.pending === false)
        .sort((a, b) => new Date(b.date) - new Date(a.date)),
    [safeRecords],
  );
  /**
   * 월별 그룹. completeRecords가 최신순이라 그룹도 최신순으로 나온다.
   * 연도를 키에 포함해야 2025-10과 2026-10이 한 그룹으로 섞이지 않는다.
   */
  const monthGroups = useMemo(() => {
    const map = new Map();
    for (const r of completeRecords) {
      const d = new Date(r.date);
      const key = `${d.getFullYear()}-${d.getMonth()}`;
      if (!map.has(key)) map.set(key, { key, label: formatMonth(r.date), records: [] });
      map.get(key).records.push(r);
    }
    return [...map.values()];
  }, [completeRecords]);

  // 그룹별 y 오프셋 계산 (RecordCard가 절대 배치라 좌표를 직접 쌓는다)
  let cursorY = 0;
  const laidOutGroups = monthGroups.map((g) => {
    const top = cursorY;
    cursorY += GROUP_HEADER_H + g.records.length * CARD_STEP + GROUP_GAP;
    return { ...g, top };
  });
  // 마지막 카드가 하단 네비(top 761)에 가리지 않도록 여유를 둔다
  const listHeight = cursorY + 120;

  const onCarouselScroll = (e) => {
    const i = Math.round(e.target.scrollLeft / 360);
    if (i !== carouselIdx) setCarouselIdx(i);
  };

  return (
    <Screen>
      {/* 헤더 */}
      <div data-home-logo style={{ position: 'absolute', left: 34, top: 9, width: 44, height: 44 }}>
        <RoseIllust variant="tight" size={44} />
      </div>
      <div data-home-title style={{ position: 'absolute', left: 78, top: 33, fontFamily: fonts.hand, fontSize: 28, color: palette.text }}>
        오늘,우리는
      </div>
      <div
        onClick={() => navigate('/mypage')}
        style={{
          position: 'absolute',
          left: 336,
          top: 26,
          width: 30,
          height: 30,
          borderRadius: '50%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: fonts.hand,
          fontSize: 20,
          color: palette.text,
          cursor: 'pointer',
        }}
      >
        <div
          aria-hidden="true"
          style={{
            position: 'absolute',
            inset: 0,
            background: couple.me.color ?? palette.beige,
            WebkitMaskImage: `url("${uiSvg.profile}")`,
            maskImage: `url("${uiSvg.profile}")`,
            WebkitMaskRepeat: 'no-repeat',
            maskRepeat: 'no-repeat',
            WebkitMaskPosition: 'center',
            maskPosition: 'center',
            WebkitMaskSize: 'contain',
            maskSize: 'contain',
            clipPath: 'circle(50%)',
          }}
        />
        <span style={{ position: 'relative', zIndex: 1 }}>{couple.me.initial}</span>
      </div>
      <div
        onClick={() => navigate('/mypage')}
        style={{
          position: 'absolute',
          left: 354,
          top: 28,
          width: 30,
          height: 30,
          borderRadius: '50%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: fonts.hand,
          fontSize: 20,
          color: palette.text,
          cursor: 'pointer',
        }}
      >
        <div
          aria-hidden="true"
          style={{
            position: 'absolute',
            inset: 0,
            background: couple.partner.color ?? palette.beige,
            WebkitMaskImage: `url("${uiSvg.profile}")`,
            maskImage: `url("${uiSvg.profile}")`,
            WebkitMaskRepeat: 'no-repeat',
            maskRepeat: 'no-repeat',
            WebkitMaskPosition: 'center',
            maskPosition: 'center',
            WebkitMaskSize: 'contain',
            maskSize: 'contain',
            clipPath: 'circle(50%)',
          }}
        />
        <span style={{ position: 'relative', zIndex: 1 }}>{couple.partner.initial}</span>
      </div>
      {/* 기록 카드 캐러셀 */}
      <div
        data-pending-carousel
        className="pt-carousel"
        onScroll={onCarouselScroll}
        style={{
          position: 'absolute',
          left: 0,
          top: 80,
          width: 402,
          height: 228,
          display: 'flex',
          flexDirection: 'row',
          gap: 12,
          padding: '0 18px 0 24px',
          boxSizing: 'border-box',
          overflowX: 'auto',
          overflowY: 'hidden',
          scrollSnapType: 'x mandatory',
          scrollPaddingLeft: 24,
          scrollBehavior: 'smooth',
        }}
      >
        {pendingRecords.map((rec) => {
          return (
            <div
              data-pending-card
              key={rec.id}
              style={{
                position: 'relative',
                width: 348,
                height: 228,
                flexShrink: 0,
                scrollSnapAlign: 'start',
              }}
            >
              <img
                src={onboardingSvg.note2b}
                width={382}
                height={242}
                alt=""
                style={{
                  position: 'absolute',
                  left: -17,
                  top: -8,
                  display: 'block',
                  objectFit: 'fill',
                  transform: 'scaleX(1.22)',
                  transformOrigin: 'center',
                  pointerEvents: 'none',
                }}
              />
              <div
                data-record-sticker
                style={{
                  position: 'absolute',
                  left: 44,
                  top: 26,
                  width: 80,
                  height: 37,
                  pointerEvents: 'none',
                }}
              >
                <img
                  src={etcSvg.sticker}
                  width={80}
                  height={37}
                  alt=""
                  style={{ position: 'absolute', inset: 0, display: 'block' }}
                />
                <span
                  style={{
                    position: 'absolute',
                    left: 2,
                    top: 5,
                    width: 76,
                    height: 25,
                    background: '#F7CEC6',
                    transform: 'rotate(-8.97591deg)',
                    transformOrigin: 'center',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    whiteSpace: 'nowrap',
                    fontFamily: fonts.hand,
                    fontSize: 11,
                    letterSpacing: 0.3,
                    color: palette.textMuted,
                  }}
                >
                  {formatStickerDate(rec.date)}
                </span>
              </div>
              <div style={{ position: 'absolute', left: 43, top: 66, fontFamily: fonts.hand, fontSize: 32, color: palette.textStrong }}>
                {rec.placeName}
              </div>
              <div style={{ position: 'absolute', left: 43, top: 100, fontFamily: fonts.hand, fontSize: 24, color: palette.textMuted }}>
                오늘의 꽃갈피를 남겨주세요
              </div>
              <img
                src={etcSvg.flowerBlank}
                width={92}
                height={124}
                alt=""
                style={{ position: 'absolute', left: 232, top: 16, display: 'block', pointerEvents: 'none' }}
              />
              <button
                data-home-cta
                onClick={() => navigate('/record', { state: { recordId: rec.id } })}
                style={{
                  position: 'absolute',
                  left: 41,
                  top: 152,
                  width: 280,
                  height: 36,
                  background: palette.olive,
                  borderRadius: 999,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                  fontFamily: fonts.hand,
                  fontSize: 24,
                  fontWeight: 400,
                  lineHeight: 1,
                  color: palette.onOlive,
                  cursor: 'pointer',
                }}
              >
                <img
                  src={etcSvg.pencil}
                  width={22}
                  height={22}
                  alt=""
                  style={{ display: 'block', filter: 'invert(1)', pointerEvents: 'none' }}
                />
                꽃갈피를 남겨주세요
              </button>
            </div>
          );
        })}
        {/* 빈 카드는 시각적 안내만 제공하며 새 기록은 아래 + 버튼에서 시작한다. */}
        <div
          data-pending-card
          style={{
            position: 'relative',
            width: 348,
            height: 228,
            flexShrink: 0,
            scrollSnapAlign: 'start',
          }}
        >
          <img
            src={onboardingSvg.note2b}
            width={382}
            height={242}
            alt=""
            style={{
              position: 'absolute',
              left: -17,
              top: -8,
              display: 'block',
              objectFit: 'fill',
              transform: 'scaleX(1.22)',
              transformOrigin: 'center',
              pointerEvents: 'none',
            }}
          />
          <div
            style={{
              position: 'absolute',
              left: 146,
              top: 42,
              width: 56,
              height: 56,
              borderRadius: '50%',
              border: `1.5px dashed ${palette.textMuted}`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxSizing: 'border-box',
            }}
          >
            <MaskIcon src={uiSvg.plusSketch} color={palette.textMuted} size={26} />
          </div>
          <div
            style={{
              position: 'absolute',
              left: 0,
              top: 112,
              width: 348,
              textAlign: 'center',
              fontFamily: fonts.hand,
              fontSize: 24,
              color: palette.textMuted,
            }}
          >
            오늘의 꽃갈피를 남겨주세요
          </div>
          <div
            style={{
              position: 'absolute',
              left: 0,
              top: 146,
              width: 348,
              textAlign: 'center',
              fontFamily: fonts.hand,
              fontSize: 16,
              color: palette.textMuted,
            }}
          >
            아래 + 버튼으로 새 기록을 시작해요
          </div>
        </div>
      </div>

      {/* 캐러셀 도트 */}
      <div
        data-home-carousel-dots
        style={{
          position: 'absolute',
          left: 0,
          top: 320,
          width: 402,
          display: 'flex',
          flexDirection: 'row',
          justifyContent: 'center',
          gap: 6,
        }}
      >
        {Array.from({ length: dotCount }).map((_, i) => (
          <div
            key={i}
            style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: i === carouselIdx ? palette.olive : palette.beige,
              transition: 'background 0.2s ease',
            }}
          />
        ))}
      </div>

      {/*
        월별 기록 — 계절 디자인을 검토할 수 있게 모든 달을 보여주고 스크롤한다.
        (시안은 최신 달 2장만 노출한다. 카드 컴포넌트 자체는 손대지 않았다.)
        헤더 아래 첫 카드까지 49, 카드 간격 165(카드 153 + 12), 그룹 간 24.
      */}
      {monthGroups.length > 0 && (
        <div
          data-home-month-list
          className="sheet-scroll"
          style={{ position: 'absolute', left: 0, top: 336, width: 402, height: 538, overflowY: 'auto' }}
        >
          <div style={{ position: 'relative', width: 402, height: listHeight }}>
            {laidOutGroups.map((g, gi) => (
              <div key={g.key}>
                {/*
                  컬러 캘린더 (schedule-color.svg, 32×32). 자체 하늘색 본체(#C8E2F2)를
                  갖고 있어 이전의 palette.monthIcon 파란 사각 배경은 걷어냈다.
                */}
                <img
                  src={etcSvg.scheduleColor}
                  {...svgSize.scheduleColor}
                  alt=""
                  style={{ position: 'absolute', left: 26, top: g.top + 1, display: 'block' }}
                />
                <div
                  style={{
                    position: 'absolute',
                    left: 70,
                    top: g.top + 5,
                    fontFamily: fonts.hand,
                    fontSize: 28,
                    color: palette.text,
                  }}
                >
                  {g.label}의 기록
                </div>
                {gi === 0 && (
                  <div
                    style={{
                      position: 'absolute',
                      left: 22,
                      top: g.top + 11,
                      width: 358,
                      textAlign: 'right',
                      fontFamily: fonts.hand,
                      fontSize: 20,
                      color: palette.textMuted,
                      cursor: 'pointer',
                    }}
                  >
                    전체보기 &gt;
                  </div>
                )}
                {g.records.map((rec, i) => (
                  <RecordCard
                    key={rec.id}
                    record={rec}
                    top={g.top + GROUP_HEADER_H + i * CARD_STEP}
                    onClick={() => navigate(`/place/${rec.id}`)}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 하단 네비 — 초록 워시는 BottomNav 컨테이너가 직접 깐다(시안 구조) */}
      <BottomNav
        onAdd={() => navigate('/map', { state: { intent: 'new-record' } })}
        onMap={() => navigate('/map')}
        onHome={() => navigate('/')}
      />
    </Screen>
  );
}
