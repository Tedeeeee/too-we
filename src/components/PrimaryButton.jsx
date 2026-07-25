import { palette, fonts } from '@/styles/tokens';

/** 올리브 알약 CTA 버튼 (절대 배치) */
export default function PrimaryButton({
  label,
  onClick,
  left = 16,
  top,
  width = 370,
  height = 54,
  disabled = false,
  textColor = palette.onOlive,
  style,
}) {
  return (
    <button
      onClick={onClick}
      style={{
        position: 'absolute',
        left,
        top,
        width,
        height,
        background: disabled ? palette.disabled : palette.olive,
        borderRadius: 999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: fonts.sans,
        fontSize: 20,
        fontWeight: 500,
        color: textColor,
        cursor: 'pointer',
        ...style,
      }}
    >
      {label}
    </button>
  );
}
