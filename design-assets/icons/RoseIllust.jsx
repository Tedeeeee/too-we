import roseUrl from '../images/rose.webp';
import roseTightUrl from '../images/rose-tight.webp';

/**
 * 원본 디자인에서 복원한 장미 일러스트.
 * variant="full": 온보딩1 타이틀 옆 96×96 (여백 포함 원본 배치)
 * variant="tight": 홈 헤더 44×44 (꽉 찬 크롭)
 */
export default function RoseIllust({ size = 96, variant = 'full', style }) {
  return (
    <img
      src={variant === 'tight' ? roseTightUrl : roseUrl}
      alt=""
      draggable={false}
      style={{ width: size, height: size, display: 'block', objectFit: 'cover', ...style }}
    />
  );
}
