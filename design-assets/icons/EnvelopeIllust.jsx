/**
 * 온보딩2 편지봉투 일러스트.
 * 원본 PNG가 복원되지 않아, 복원된 장미/꽃다발과 같은
 * 플랫 스티커 스타일로 다시 그린 SVG.
 */
export default function EnvelopeIllust({ width = 140, height = 95, style }) {
  return (
    <svg viewBox="0 0 140 95" width={width} height={height} fill="none" style={{ display: 'block', ...style }}>
      <g transform="rotate(-2 70 50)">
        {/* 스티커 흰 테두리 */}
        <rect x="6" y="12" width="128" height="74" rx="10" fill="#FFFFFF" />
        {/* 봉투 몸통 */}
        <rect x="11" y="17" width="118" height="64" rx="6" fill="#FBF3E4" stroke="#E0CDAF" strokeWidth="2" />
        {/* 플랩 */}
        <path
          d="M12 20 L66 55 Q70 57.5 74 55 L128 20"
          stroke="#E0CDAF"
          strokeWidth="2"
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {/* 하트 씰 */}
        <path
          d="M70 47 C68 42.5 61.5 42.5 60.5 47.5 C59.8 51.5 65 55.5 70 59 C75 55.5 80.2 51.5 79.5 47.5 C78.5 42.5 72 42.5 70 47 Z"
          fill="#F3BCBC"
        />
        {/* 우표 자리 */}
        <rect x="103" y="24" width="17" height="14" rx="2" fill="#F1E5CE" stroke="#E0CDAF" strokeWidth="1.4" strokeDasharray="3 2.4" />
      </g>
    </svg>
  );
}
