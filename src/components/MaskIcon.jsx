/**
 * SVG를 mask로 써서 임의 색으로 칠하는 아이콘.
 *
 * `design-assets/svg/ui`의 아이콘들은 색이 파일에 구워져 있어(`fill="black"`,
 * `#33363F`, `fill="white"` 등) `<img>`로는 시안 색을 낼 수 없다. mask로 쓰면
 * 모양만 가져오고 색은 background로 지정할 수 있다.
 *
 * 색이 이미 맞는 에셋(`cancelCircle`·`cancel`·`plusSketch`는 `#9A9088`,
 * `camera`는 `#6E665E`)은 이 컴포넌트 대신 그냥 `<img>`를 쓰면 된다.
 */
export default function MaskIcon({ src, color, size = 24, width, height, style }) {
  return (
    <span
      aria-hidden="true"
      style={{
        display: 'block',
        width: width ?? size,
        height: height ?? size,
        background: color,
        WebkitMaskImage: `url("${src}")`,
        maskImage: `url("${src}")`,
        WebkitMaskRepeat: 'no-repeat',
        maskRepeat: 'no-repeat',
        WebkitMaskPosition: 'center',
        maskPosition: 'center',
        WebkitMaskSize: 'contain',
        maskSize: 'contain',
        flexShrink: 0,
        ...style,
      }}
    />
  );
}
