/**
 * 봄 시즌 장식 반짝이.
 * ⚠️ README 규칙: 반드시 React.lazy로 import (초기 번들 제외).
 */
export default function SpringStar({ size = 22, color = '#F3BCBC', style }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" style={{ display: 'block', ...style }}>
      <path
        d="M12 2 C13.2 8 16 10.8 22 12 C16 13.2 13.2 16 12 22 C10.8 16 8 13.2 2 12 C8 10.8 10.8 8 12 2 Z"
        fill={color}
      />
      <circle cx="19.4" cy="4.6" r="1.6" fill="#E8C34A" />
    </svg>
  );
}
