/**
 * 꽃갈피 압화 일러스트 — flower prop으로 7종 렌더.
 * (홈 기록 카드 70×104, 장소 상세 북마크 76×96 슬롯에 사용)
 * 색상은 디자인의 꽃갈피 팔레트(프로토타입 flowerDefs)와 동일.
 */
const FLOWER_STYLES = {
  rose: { petal: '#B4394B', center: '#8E2A3A', leaf: '#8FA86B' },
  marigold: { petal: '#E8A33D', center: '#C77F1F', leaf: '#8FA86B' },
  calla: { petal: '#E9E36B', center: '#D9C93F', leaf: '#93A25B' },
  clover: { petal: '#8FA86B', center: '#71894C', leaf: '#8FA86B' },
  forgetmenot: { petal: '#A9CBEF', center: '#E9E36B', leaf: '#93A25B' },
  lilac: { petal: '#9667BF', center: '#7A4FA3', leaf: '#8FA86B' },
  jasmine: { petal: '#F2E8D5', center: '#E8C34A', leaf: '#93A25B' },
};

export default function PressedFlower({ flower = 'rose', width = 70, height = 104, style }) {
  const c = FLOWER_STYLES[flower] || FLOWER_STYLES.rose;
  const petals = flower === 'clover' ? 4 : 5;
  return (
    <svg viewBox="0 0 70 104" width={width} height={height} fill="none" style={{ display: 'block', ...style }}>
      {/* 줄기 */}
      <path d="M35 44 C33 62 37 78 34 96" stroke="#7A8A4A" strokeWidth="2.6" strokeLinecap="round" />
      {/* 잎 */}
      <path d="M34.5 66 C26 62 22 68 20 75 C28 76 33 72 34.5 66 Z" fill={c.leaf} opacity="0.9" />
      <path d="M35 80 C43 76 48 81 50 88 C42 89 36.5 86 35 80 Z" fill={c.leaf} opacity="0.75" />
      {/* 꽃잎 (압화 느낌으로 납작한 타원) */}
      <g transform="translate(35 28)">
        {Array.from({ length: petals }).map((_, i) => (
          <ellipse
            key={i}
            cx="0"
            cy="-13"
            rx="8.5"
            ry="14"
            fill={c.petal}
            opacity={i % 2 ? 0.88 : 1}
            transform={`rotate(${(360 / petals) * i + (flower === 'clover' ? 45 : 0)})`}
          />
        ))}
        <circle r="6.5" fill={c.center} />
      </g>
      {/* 흩어진 꽃잎 */}
      <ellipse cx="14" cy="52" rx="3.4" ry="5" fill={c.petal} opacity="0.55" transform="rotate(-24 14 52)" />
      <ellipse cx="56" cy="60" rx="3" ry="4.4" fill={c.petal} opacity="0.45" transform="rotate(30 56 60)" />
    </svg>
  );
}
