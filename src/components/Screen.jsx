import { palette } from '@/styles/tokens';

/**
 * 402×874 화면 컨테이너. 프로토타입의 section과 동일하게
 * 자식들은 절대 좌표로 배치한다. (상단 59px safe area는 각 화면
 * 레이아웃 좌표에 이미 반영되어 있음)
 */
export default function Screen({ bg = palette.bg, style, children }) {
  return (
    <section
      style={{
        position: 'absolute',
        inset: 0,
        width: 402,
        height: 874,
        background: bg,
        overflow: 'hidden',
        ...style,
      }}
    >
      {children}
    </section>
  );
}
