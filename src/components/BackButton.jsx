import { useNavigate } from 'react-router-dom';
import { palette } from '@/styles/tokens';
import { uiSvg } from '@assets/svg';
import MaskIcon from './MaskIcon';

/**
 * ‹ 뒤로가기 (기본: 히스토리 back)
 * 기본은 절대 배치지만, style로 position을 덮어써서 flex 흐름에도 넣을 수 있다
 * (마이페이지·가고싶은곳 헤더가 flex 행이다).
 */
export default function BackButton({ left = 16, top = 82, color = palette.text, onClick, style }) {
  const navigate = useNavigate();
  return (
    <button
      onClick={onClick || (() => navigate(-1))}
      aria-label="뒤로"
      style={{
        position: 'absolute',
        left,
        top,
        width: 32,
        height: 32,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        ...style,
      }}
    >
      {/* expandLeft.svg는 #33363F로 구워져 있어 mask로 색을 입힌다 */}
      <MaskIcon src={uiSvg.expandLeft} color={color} size={24} />
    </button>
  );
}
