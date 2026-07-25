import { onboardingSvg, svgSize } from '@assets/svg';

const lineVariants = {
  long: { src: onboardingSvg.lineLong, size: svgSize.lineLong },
  short: { src: onboardingSvg.lineShort, size: svgSize.lineShort },
};

/** 외부 SVG 원본을 화면 상태에 맞는 색으로 보여주는 손그림 구분선 */
export default function HandDrawnLine({
  variant = 'long',
  color,
  width,
  height,
  style,
}) {
  const line = lineVariants[variant] ?? lineVariants.long;

  return (
    <span
      aria-hidden="true"
      style={{
        display: 'block',
        width: width ?? line.size.width,
        height: height ?? line.size.height,
        flexShrink: 0,
        background: color,
        WebkitMaskImage: `url("${line.src}")`,
        maskImage: `url("${line.src}")`,
        WebkitMaskRepeat: 'no-repeat',
        maskRepeat: 'no-repeat',
        WebkitMaskPosition: 'center',
        maskPosition: 'center',
        WebkitMaskSize: '100% 100%',
        maskSize: '100% 100%',
        ...style,
      }}
    />
  );
}
