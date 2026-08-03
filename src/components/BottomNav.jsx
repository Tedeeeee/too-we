import { palette, shadows, gradients } from '@/styles/tokens';
import { uiSvg } from '@assets/svg';
import MaskIcon from './MaskIcon';

/**
 * 하단 네비게이션 (2026-07-25 시안 — 프로토타입 "nav.bottom-nav (fig 최신)").
 *
 * 이전 버전과 달라진 점:
 *  - 알약 199×50 @(102,793) → 228×50 @(87,793), 2단 그림자 추가
 *  - "홈"/"지도" 텍스트 라벨 제거, 아이콘이 16 → 24px
 *  - FAB에 그림자 추가 (위치는 (174,781) → (175,781)로 1px만 이동)
 *  - 초록 워시가 네비 컨테이너 자체의 배경 (전에는 Home의 별도 220px div,
 *    색도 rgba(199,212,140,.55) → #E9F0CB로 바뀌었다)
 *
 * 좌표는 전부 flex에서 파생된다. 컨테이너 402×114 @top 761, padding 32px 0,
 * align-items flex-end → 알약 바닥 843 = top 793, 가운데 정렬로 left 87.
 * 알약 padding 10px 26px → 콘텐츠 박스 x 113~289(176), y 803~833.
 * 24 + 38 + 52 + 38 + 24 = 176이라 gap 38이 딱 맞는다.
 * FAB은 슬롯(y 803 시작) 기준 top:-22 → 781. 실측으로 확인함.
 *
 * 아이콘은 mask-image로 칠한다. 에셋 SVG에 색이 구워져 있어(`fill="black"`,
 * `#837A6F` 등) <img>로는 시안 색을 낼 수 없기 때문 — 마스크로 쓰면 모양만 가져오고
 * 색은 background로 지정할 수 있다.
 */
const ICON = 24;

export default function BottomNav({ onAdd, onMap, onHome }) {
  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        top: 761,
        width: 402,
        height: 114,
        background: gradients.navWash,
        display: 'flex',
        flexDirection: 'row',
        padding: '32px 0',
        justifyContent: 'center',
        alignItems: 'flex-end',
        boxSizing: 'border-box',
      }}
    >
      <div
        style={{
          position: 'relative',
          width: 228,
          height: 50,
          borderRadius: 999,
          background: palette.white,
          boxShadow: shadows.nav,
          display: 'flex',
          flexDirection: 'row',
          gap: 38,
          padding: '10px 26px',
          alignItems: 'center',
          boxSizing: 'border-box',
        }}
      >
        <button onClick={onHome} aria-label="홈" style={{ flexShrink: 0, cursor: 'pointer', display: 'flex' }}>
          <MaskIcon size={ICON} src={uiSvg.homeSketch} color={palette.textStrong} />
        </button>

        {/* 가운데 52px 슬롯 — FAB이 알약 위로 22px 튀어나온다 */}
        <div style={{ position: 'relative', width: 52, flexShrink: 0, alignSelf: 'stretch' }}>
          <button
            onClick={onAdd}
            aria-label="새 기록"
            style={{
              position: 'absolute',
              left: 0,
              top: -22,
              width: 52,
              height: 52,
              borderRadius: 26,
              background: palette.olive,
              boxShadow: shadows.fab,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
            }}
          >
            <MaskIcon size={ICON} src={uiSvg.plusSketch} color={palette.onOliveAlt} />
          </button>
        </div>

        <button onClick={onMap} aria-label="지도" style={{ flexShrink: 0, cursor: 'pointer', display: 'flex' }}>
          <MaskIcon size={ICON} src={uiSvg.mapSketch} color={palette.textMuted} />
        </button>
      </div>
    </div>
  );
}
