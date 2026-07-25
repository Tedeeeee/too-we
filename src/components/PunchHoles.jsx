import { palette } from '@/styles/tokens';

/** 다이어리 펀치홀 장식 (세로/가로) */
export default function PunchHoles({
  count = 5,
  size = 18,
  gap = 28,
  color = palette.beige,
  vertical = false,
  style,
}) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: vertical ? 'column' : 'row',
        justifyContent: vertical ? 'flex-start' : 'center',
        gap,
        ...style,
      }}
    >
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} style={{ width: size, height: size, borderRadius: '50%', background: color }} />
      ))}
    </div>
  );
}
