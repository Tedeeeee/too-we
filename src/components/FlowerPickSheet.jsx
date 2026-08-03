import { palette, fonts } from '@/styles/tokens';
import { flowerSvg, svgSize } from '@assets/svg';
import { FLOWERS } from '@/data/fixtures';

/**
 * 꽃갈피 선택 바텀시트.
 * selected(state)로 활성 카드가 전환되고, 같은 카드를 다시 탭하면 해제된다.
 */
export default function FlowerPickSheet({
  selected,
  onSelect,
  onConfirm,
  saving = false,
  error = '',
}) {
  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        top: 88,
        width: 402,
        height: 786,
        background: palette.sheet,
        borderRadius: '24px 24px 0 0',
        overflow: 'hidden',
      }}
    >
      <div className="sheet-scroll" style={{ position: 'absolute', left: 0, top: 0, width: 402, height: 786, overflowY: 'auto' }}>
        <div style={{ position: 'relative', width: 402, height: 920 }}>
          <div
            style={{
              position: 'absolute',
              left: 170,
              top: 8,
              width: 62,
              height: 6,
              background: palette.sheetHandle,
              borderRadius: 9999,
            }}
          />
          <div style={{ position: 'absolute', left: 16, top: 36, fontFamily: fonts.hand, fontSize: 16, color: palette.textMuted }}>
            꽃갈피 선택하기
          </div>
          <div
            style={{
              position: 'absolute',
              left: 16,
              top: 66,
              width: 370,
              display: 'grid',
              gridTemplateColumns: '173px 173px',
              gap: 24,
            }}
          >
            {FLOWERS.map((f) => {
              const active = selected === f.key;
              return (
                <button
                  key={f.key}
                  type="button"
                  aria-label={`${f.name} 꽃갈피`}
                  aria-pressed={active}
                  disabled={saving}
                  onClick={() => onSelect(active ? null : f.key)}
                  style={{
                    width: 173,
                    height: 176,
                    borderRadius: 16,
                    background: active ? palette.pickSelectedBg : 'transparent',
                    border: active ? `1.5px solid ${palette.olive}` : '1.5px solid transparent',
                    boxSizing: 'border-box',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    paddingTop: 16,
                    cursor: 'pointer',
                  }}
                >
                  <div style={{ fontFamily: fonts.hand, fontSize: 24, color: palette.textStrong }}>{f.name}</div>
                  <div style={{ fontFamily: fonts.hand, fontSize: 20, color: palette.textMuted, marginTop: 5 }}>{f.meaning}</div>
                  <img
                    src={flowerSvg[f.key]}
                    {...svgSize[f.key]}
                    alt=""
                    style={{
                      display: 'block',
                      marginTop: 4,
                      objectFit: 'contain',
                    }}
                  />
                </button>
              );
            })}
          </div>
        </div>
      </div>
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: 722,
          width: 402,
          height: 64,
          background: 'linear-gradient(180deg, rgba(251,251,251,0) 0%, rgba(251,251,251,0.9) 40%)',
          pointerEvents: 'none',
        }}
      />
      <button
        onClick={onConfirm}
        disabled={saving}
        style={{
          position: 'absolute',
          left: 16,
          top: 726,
          width: 370,
          height: 54,
          background: saving ? palette.disabled : palette.olive,
          borderRadius: 999,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: fonts.sans,
          fontSize: 20,
          fontWeight: 500,
          color: palette.onOliveAlt,
          cursor: saving ? 'wait' : 'pointer',
        }}
      >
        {saving ? '저장 중…' : error ? '다시 시도' : '선택하기'}
      </button>
      {saving && (
        <p
          role="status"
          aria-live="polite"
          aria-busy="true"
          style={{
            position: 'absolute',
            left: 16,
            top: 700,
            width: 370,
            margin: 0,
            textAlign: 'center',
            fontFamily: fonts.hand,
            fontSize: 14,
            color: palette.textMuted,
          }}
        >
          꽃갈피를 저장하고 있어요…
        </p>
      )}
      {error && (
        <div
          role="alert"
          style={{
            position: 'absolute',
            left: 16,
            top: 700,
            width: 370,
            textAlign: 'center',
            fontFamily: fonts.hand,
            fontSize: 14,
            color: palette.textMuted,
          }}
        >
          {error}
        </div>
      )}
    </div>
  );
}
