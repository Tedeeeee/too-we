import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { palette, fonts, shadows } from '@/styles/tokens';
import { uiSvg } from '@assets/svg';
import Screen from '@/components/Screen';
import MaskIcon from '@/components/MaskIcon';
import BackButton from '@/components/BackButton';
import * as api from '@/data/api';

/**
 * 가고 싶은 곳 (2026-07-25 신규 — Figma 208:1552 / 프로토타입 "가고 싶은 곳").
 *
 * 이전에는 마이페이지 설정의 개수 행(`가고 싶은 곳 3곳 ›`)뿐이었다.
 * 카드 370×87.923, radius 15.033, 썸네일 40×40, 카테고리 칩, "N Pick!",
 * 우측 올리브 "기록" 버튼 — 좌표는 시안의 flex 값 그대로.
 */
export default function Wishlist() {
  const navigate = useNavigate();
  const [items, setItems] = useState([]);

  useEffect(() => {
    api.getWishlist().then(setItems);
  }, []);

  return (
    <Screen bg={palette.bgAlt}>
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: 75,
          width: 402,
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
          alignItems: 'center',
          boxSizing: 'border-box',
        }}
      >
        {/* 헤더 */}
        <div
          style={{
            height: 52,
            display: 'flex',
            flexDirection: 'row',
            gap: 10,
            padding: '5px 16px',
            alignItems: 'center',
            boxSizing: 'border-box',
            alignSelf: 'stretch',
          }}
        >
          <BackButton left={0} top={0} style={{ position: 'relative', flexShrink: 0 }} />
          <span style={{ fontFamily: fonts.hand, fontSize: 24, lineHeight: '100%', color: palette.text }}>가고 싶은 곳</span>
        </div>

        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
            padding: '5px 16px',
            alignItems: 'flex-start',
            boxSizing: 'border-box',
            alignSelf: 'stretch',
          }}
        >
          <div style={{ height: 23, alignSelf: 'stretch' }}>
            <span style={{ fontFamily: fonts.hand, fontSize: 20, lineHeight: '100%', color: palette.text }}>다음엔 여기 어때?</span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignSelf: 'stretch' }}>
            {items.map((w) => (
              <div
                key={w.id}
                style={{
                  height: 87.923,
                  borderRadius: 15.033,
                  background: palette.card,
                  boxShadow: `inset 0 0 0 0.835px ${palette.hairline}, ${shadows.card}`,
                  display: 'flex',
                  flexDirection: 'row',
                  gap: 13.363,
                  padding: 16.703,
                  alignItems: 'flex-start',
                  boxSizing: 'border-box',
                  alignSelf: 'stretch',
                }}
              >
                {/* 사진 자리 */}
                <div style={{ width: 40, height: 40, borderRadius: 4.727, background: palette.photoFill, flexShrink: 0 }} />
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-start', flexGrow: 1, minWidth: 0 }}>
                  <span
                    style={{
                      borderRadius: 1.67,
                      background: palette.chipWish,
                      padding: '1px 6.681px',
                      fontFamily: fonts.hand,
                      fontSize: 16,
                      lineHeight: '100%',
                      letterSpacing: '-0.010em',
                      whiteSpace: 'nowrap',
                      color: palette.text,
                    }}
                  >
                    {w.category}
                  </span>
                  <span style={{ fontFamily: fonts.hand, fontSize: 20, lineHeight: '18.374px', whiteSpace: 'nowrap', color: palette.textStrong }}>
                    {w.name}
                  </span>
                  <span
                    style={{
                      fontFamily: fonts.hand,
                      fontSize: 20,
                      lineHeight: '100%',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      maxWidth: '100%',
                      color: palette.textSubtle,
                    }}
                  >
                    {w.pickedBy} Pick!
                  </span>
                </div>
                <button
                  onClick={() => navigate('/record', { state: { wishlistId: w.id } })}
                  style={{
                    height: 30,
                    borderRadius: 999,
                    background: palette.olive,
                    boxShadow: `inset 0 0 0 1px ${palette.olive}`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: '0 32px',
                    boxSizing: 'border-box',
                    fontFamily: fonts.sans,
                    fontSize: 16,
                    fontWeight: 500,
                    lineHeight: '30px',
                    whiteSpace: 'nowrap',
                    color: palette.onOliveAlt,
                    flexShrink: 0,
                    cursor: 'pointer',
                  }}
                >
                  기록
                </button>
              </div>
            ))}
          </div>

          {/* 가고 싶은 곳 더하기 — 외곽선 버튼.
              프로토타입은 "장소 추가"로 적었지만 Figma 원본(208:1552)이 이 문구다. */}
          <button
            onClick={() => navigate('/map')}
            style={{
              height: 54,
              borderRadius: 999,
              boxShadow: `inset 0 0 0 1px ${palette.olive}`,
              display: 'flex',
              flexDirection: 'row',
              gap: 10,
              padding: '12px 32px',
              justifyContent: 'center',
              alignItems: 'center',
              boxSizing: 'border-box',
              alignSelf: 'stretch',
              fontFamily: fonts.sans,
              fontSize: 16,
              fontWeight: 500,
              lineHeight: '30px',
              color: palette.olive,
              cursor: 'pointer',
            }}
          >
            <MaskIcon src={uiSvg.plusSketch} color={palette.olive} size={24} />
            가고 싶은 곳 더하기
          </button>
        </div>
      </div>
    </Screen>
  );
}
