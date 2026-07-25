import { palette, fonts } from '@/styles/tokens';

/**
 * MapView — 지도 SDK 어댑터 (현재: 플레이스홀더).
 *
 * 카카오맵/네이버맵으로 교체할 때 이 컴포넌트 "내부 구현만" 바꾼다.
 * 인터페이스(props)는 유지:
 *   - center:   { lat, lng }        지도 중심
 *   - markers:  [{ id, lat, lng }]  표시할 핀 목록
 *   - onMarkerClick(id)             핀 탭 콜백
 *   - width/height                  렌더 영역(px)
 *
 * 플레이스홀더는 프로토타입의 "지도 영역" 화면을 그대로 그린다
 * (베이지 영역 + 보라색 현재 위치 핀). markers 좌표는 아직 사용하지 않는다.
 */
export default function MapView({ center, markers = [], onMarkerClick, width = 402, height = 560 }) {
  void center;
  void markers;
  return (
    <div style={{ position: 'absolute', left: 0, top: 0, width, height, background: palette.mapArea }}>
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: 180,
          width,
          textAlign: 'center',
          fontFamily: fonts.hand,
          fontSize: 20,
          color: palette.mapLabel,
        }}
      >
        지도 영역
      </div>
      {/* 현재 위치(선택 지점) 핀 — SDK 교체 시 markers 렌더로 대체 */}
      <div
        onClick={onMarkerClick ? () => onMarkerClick(markers[0]?.id) : undefined}
        style={{ position: 'absolute', left: 245, top: 244, width: 56, height: 56 }}
      >
        <div style={{ position: 'absolute', left: 0, top: 0, width: 56, height: 56, borderRadius: '50%', background: palette.white }} />
        <div
          style={{
            position: 'absolute',
            left: 20,
            top: 46,
            width: 16,
            height: 16,
            background: palette.white,
            transform: 'rotate(45deg)',
            borderRadius: 3,
          }}
        />
        <div
          style={{
            position: 'absolute',
            left: 6,
            top: 6,
            width: 44,
            height: 44,
            borderRadius: '50%',
            background: palette.purple,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontFamily: fonts.sans,
            fontSize: 24,
            color: palette.white,
            lineHeight: 1,
          }}
        >
          ⊕
        </div>
      </div>
    </div>
  );
}
