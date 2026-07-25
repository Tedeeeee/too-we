import { palette, fonts } from '@/styles/tokens';
import { onboardingSvg, svgSize } from '@assets/svg';

/**
 * 온보딩1 타이틀 락업 — 장미 + "오늘,우리는" 워드마크.
 *
 * Figma에서 이 둘은 분리된 요소가 아니라 216×92.264 하나의 그룹(node 110:467)이다.
 * 아래 좌표는 Figma가 내보낸 figma/FigLogo.jsx의 내부 값 그대로다.
 * 장미는 `rose-head.svg`(90×93) — Figma 원본 벡터이며 회전까지 반영돼 있으므로
 * 다시 그리지 말 것(FigLogo.jsx 주석: "Do not redraw").
 */
const W = 216;
const H = 92.264;

export default function FigLogo({ left, top, style }) {
  return (
    <div
      style={{
        position: 'absolute',
        left,
        top,
        width: W,
        height: H,
        ...style,
      }}
    >
      <img
        src={onboardingSvg.roseHead}
        {...svgSize.roseHead}
        alt=""
        style={{ position: 'absolute', left: 0, top: 0, display: 'block' }}
      />
      <span
        style={{
          position: 'absolute',
          left: 80.442,
          top: 29.136,
          width: 125,
          height: 37,
          fontFamily: fonts.hand,
          fontSize: 40,
          lineHeight: '36.062px',
          letterSpacing: '0.070em',
          whiteSpace: 'nowrap',
          color: palette.text,
        }}
      >
        오늘,우리는
      </span>
    </div>
  );
}

/** 락업 실측 크기 — 화면에서 배치 계산할 때 참조 */
FigLogo.size = { width: W, height: H };
