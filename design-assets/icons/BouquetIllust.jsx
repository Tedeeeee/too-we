import bouquetUrl from '../images/bouquet.webp';

/** 원본 디자인에서 복원한 꽃다발 일러스트 (온보딩4 초대 카드) */
export default function BouquetIllust({ width = 110, height = 112, style }) {
  return (
    <img
      src={bouquetUrl}
      alt=""
      draggable={false}
      style={{ width, height, display: 'block', objectFit: 'cover', ...style }}
    />
  );
}
