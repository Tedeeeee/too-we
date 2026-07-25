import roseUrl from '../images/rose.webp';

/**
 * 온보딩3 "장미·연필" 일러스트 (300×158).
 * 복원된 원본 장미(rose.webp) + 원본 스타일로 다시 그린 SVG 연필의 합성.
 */
export default function WritingIllust({ width = 300, height = 158, style }) {
  return (
    <div style={{ position: 'relative', width, height, overflow: 'hidden', borderRadius: 24, ...style }}>
      {/* 원본 화면의 크림→옅은 노랑 그라데이션 배경 */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: 'linear-gradient(115deg, #F3EEE4 0%, #F6EFDD 55%, #F5ECCF 100%)',
        }}
      />
      <img
        src={roseUrl}
        alt=""
        draggable={false}
        style={{ position: 'absolute', left: 26, bottom: -6, width: 118, height: 118, transform: 'rotate(-8deg)' }}
      />
      {/* 연필 (원본: 노랑 몸통 + 핑크 지우개, 대각선) */}
      <svg
        viewBox="0 0 40 130"
        width={44}
        height={143}
        fill="none"
        style={{ position: 'absolute', right: 44, top: -10, transform: 'rotate(36deg)' }}
      >
        <rect x="7" y="22" width="26" height="76" fill="#F6C844" />
        <path d="M14 26 q2 34 0 68 M26 26 q-2 34 0 68" stroke="#3A342C" strokeWidth="1.6" strokeLinecap="round" />
        <rect x="7" y="14" width="26" height="9" fill="#CFCFCF" />
        <path d="M9 14 q11 -12 22 0 z" fill="#F5C3CA" />
        <path d="M7 98 L20 126 L33 98 Z" fill="#EAD9B0" />
        <path d="M16 117 L20 126 L24 117 Z" fill="#3A342C" />
      </svg>
      {/* 손글씨 낙서 라인 */}
      <svg viewBox="0 0 120 40" width={120} height={40} fill="none" style={{ position: 'absolute', left: 150, bottom: 22 }}>
        <path
          d="M4 26 q14 -14 28 0 q14 14 28 0 q14 -14 28 0"
          stroke="#D8C5A8"
          strokeWidth="2.4"
          strokeDasharray="6 5"
          strokeLinecap="round"
        />
        <path
          d="M104 10 C103 7 99.5 7 99 10 C98.6 12.5 101.5 14.5 104 16.5 C106.5 14.5 109.4 12.5 109 10 C108.5 7 105 7 104 10 Z"
          fill="#F3BCBC"
        />
      </svg>
    </div>
  );
}
