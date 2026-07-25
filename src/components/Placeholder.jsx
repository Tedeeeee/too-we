import { palette, fonts } from '@/styles/tokens';

/**
 * 이미지 업로드 전 자리 표시 컴포넌트.
 * 계절 히어로 이미지·사용자 사진(기록 사진, 프로필)이 사용하는 슬롯 —
 * 업로드 기능이 붙기 전까지 유지한다.
 */
export default function Placeholder({ label, width, height, radius = 0, circle = false, style }) {
  return (
    <div
      style={{
        position: 'relative',
        width,
        height,
        borderRadius: circle ? '50%' : radius,
        background: 'rgba(228, 210, 186, 0.35)',
        overflow: 'hidden',
        ...style,
      }}
    >
      <div
        style={{
          position: 'absolute',
          inset: 7,
          borderRadius: circle ? '50%' : Math.max(0, radius - 5),
          border: '1.5px dashed rgba(183, 163, 136, 0.55)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {label && (
          <span style={{ fontFamily: fonts.hand, fontSize: 14, color: palette.mapLabel }}>{label}</span>
        )}
      </div>
    </div>
  );
}
