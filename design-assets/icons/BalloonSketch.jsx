/**
 * 홈 캐러셀 카드의 점선 풍선 스케치.
 * 원본(디자인 PNG)의 베이지 점선 하트풍선을 SVG로 재구성한 것.
 */
export default function BalloonSketch({ width = 100, height = 120, style }) {
  return (
    <svg viewBox="0 0 100 120" width={width} height={height} fill="none" style={{ display: 'block', ...style }}>
      <path
        d="M50 16 C42 5 20 6 12 24 C4 42 18 66 48 86 C50 87.5 50 87.5 52 86 C82 66 96 42 88 24 C80 6 58 5 50 16 Z"
        fill="#FBF6EC"
        stroke="#D8C5A8"
        strokeWidth="2.4"
        strokeDasharray="6 6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M50 88 q-7 8 0 14 q7 6 -2 13"
        stroke="#D8C5A8"
        strokeWidth="2.2"
        strokeDasharray="5 5"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}
