import { palette } from '@/styles/tokens';
import { etcSvg } from '@assets/svg';
import MaskIcon from './MaskIcon';

/**
 * 꽃 별점. onChange를 주면 탭으로 선택 가능.
 *
 * 이전에는 `✿` 글리프를 letter-spacing으로 벌려 놨는데, 폰트에 있는 문자라
 * 기기·브라우저마다 모양이 달라졌다. `rating-flower.svg`(24×24, 꽃잎 5 + 중심)로
 * 교체했다. 에셋이 `fill="black"`이라 활성/비활성 두 색을 내려면 mask가 필요하다.
 *
 * `letterSpacing` prop은 이름을 유지하되 실제로는 flex `gap`으로 들어간다.
 * **flex라서 `textAlign`으로는 정렬되지 않는다** — 가운데 정렬이 필요하면
 * 호출부에서 `justifyContent: 'center'`를 줄 것.
 */
export default function FlowerRating({
  value = 0,
  max = 5,
  size = 17,
  letterSpacing = 4,
  activeColor = palette.pink,
  inactiveColor = palette.beige,
  onChange,
  style,
}) {
  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: letterSpacing,
        lineHeight: 1,
        whiteSpace: 'nowrap',
        ...style,
      }}
    >
      {Array.from({ length: max }).map((_, i) => (
        <span
          key={i}
          onClick={onChange ? () => onChange(i + 1) : undefined}
          style={{
            display: 'block',
            cursor: onChange ? 'pointer' : 'default',
          }}
        >
          <MaskIcon
            src={etcSvg.ratingFlower}
            size={size}
            color={i < value ? activeColor : inactiveColor}
          />
        </span>
      ))}
    </div>
  );
}
