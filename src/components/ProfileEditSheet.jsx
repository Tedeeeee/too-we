import { useRef, useState } from 'react';
import { palette, fonts, shadows } from '@/styles/tokens';
import { uiSvg } from '@assets/svg';

/**
 * 내 정보 수정하기 모달 (Figma 208:1452 / 프로토타입 "내 정보 수정하기").
 * 마이페이지 위에 딤과 함께 덮는다 — 라우트가 아니라 오버레이인 이유는
 * 시안에서 뒤에 마이페이지가 그대로 깔려 있기 때문이다.
 *
 * 카드: 370×461 @(16, 146.571), radius 15.033, gap 24, padding 44px 20px
 */
export default function ProfileEditSheet({ name, onClose, onSave, onDisconnect }) {
  const [draft, setDraft] = useState(name);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const saveInFlightRef = useRef(false);
  const normalizedDraft = draft.trim();
  const canSave = normalizedDraft.length > 0 && Array.from(normalizedDraft).length <= 12;

  const handleSave = async () => {
    if (!canSave || saveInFlightRef.current) return;
    saveInFlightRef.current = true;
    setSaving(true);
    setSaveError(false);
    try {
      await onSave(normalizedDraft);
    } catch {
      setSaveError(true);
    } finally {
      saveInFlightRef.current = false;
      setSaving(false);
    }
  };

  const pill = (label, onClick, filled, disabled = false) => (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        height: 38,
        flexGrow: 1,
        borderRadius: 999,
        background: filled ? palette.olive : 'transparent',
        boxShadow: `inset 0 0 0 1px ${palette.olive}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '4px 32px',
        fontFamily: fonts.sans,
        fontSize: 16,
        fontWeight: 500,
        lineHeight: '30px',
        color: filled ? palette.onOliveAlt : palette.olive,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.65 : 1,
      }}
    >
      {label}
    </button>
  );

  return (
    <>
      <div
        aria-hidden="true"
        onClick={saving ? undefined : onClose}
        style={{ position: 'absolute', left: 0, top: 0, width: 402, height: 874, background: palette.dimModal, cursor: saving ? 'wait' : 'pointer' }}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="profile-edit-title"
        style={{
          position: 'absolute',
          left: 16,
          top: 146.571,
          width: 370,
          height: 461,
          borderRadius: 15.033,
          background: palette.cardAlt,
          boxShadow: `inset 0 0 0 0.835px ${palette.hairline}, ${shadows.card}`,
          display: 'flex',
          flexDirection: 'column',
          gap: 24,
          padding: '44px 20px',
          justifyContent: 'center',
          alignItems: 'center',
          boxSizing: 'border-box',
        }}
      >
        <div style={{ height: 25, display: 'flex', alignItems: 'center', justifyContent: 'center', alignSelf: 'stretch' }}>
          <span
            id="profile-edit-title"
            style={{
              fontFamily: fonts.hand,
              fontSize: 32,
              lineHeight: '24.196px',
              letterSpacing: '0.070em',
              whiteSpace: 'nowrap',
              color: palette.text,
            }}
          >
            내 정보 수정하기
          </span>
        </div>

        <div style={{ height: 277, display: 'flex', flexDirection: 'column', gap: 32, alignItems: 'center', alignSelf: 'stretch' }}>
          {/* 프로필 사진 + 카메라 배지 (배지가 사진 우하단에 24px 겹친다) */}
          <div style={{ width: 108, height: 100, display: 'flex', flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'flex-end' }}>
            <div
              role="img"
              aria-label={normalizedDraft ? `${normalizedDraft} 프로필` : '등록된 이름 없음'}
              style={{
                width: 100,
                height: 100,
                borderRadius: 999,
                background: palette.avatarCream,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontFamily: fonts.hand,
                fontSize: 56,
                color: palette.text,
                flexShrink: 0,
              }}
            >
              {Array.from(normalizedDraft)[0] || '?'}
            </div>
            <button
              type="button"
              aria-label="프로필 사진 변경은 아직 지원하지 않아요"
              disabled
              style={{
                width: 32,
                height: 32,
                marginLeft: -24,
                borderRadius: 999,
                background: palette.heroText,
                boxShadow: '0px 3px 10.100px 0px rgba(131,122,111,0.5)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
                cursor: 'not-allowed',
              }}
            >
              {/* camera.svg는 fill이 #6E665E로 시안 색과 같아 그대로 쓴다 */}
              <img src={uiSvg.camera} width={17} height={15} alt="" style={{ display: 'block' }} />
            </button>
          </div>

          <div style={{ height: 75, display: 'flex', flexDirection: 'column', gap: 8, alignSelf: 'stretch' }}>
            <div style={{ height: 27 }}>
              <span style={{ fontFamily: fonts.hand, fontSize: 24, lineHeight: '100%', color: palette.text }}>이름 수정</span>
            </div>
            <input
              value={draft}
              onChange={(e) => {
                setDraft(Array.from(e.target.value).slice(0, 12).join(''));
                setSaveError(false);
              }}
              disabled={saving}
              maxLength={12}
              aria-label="내 이름"
              style={{
                height: 40,
                borderRadius: 16,
                background: palette.white,
                boxShadow: `inset 0 0 0 1px ${palette.hairline}`,
                padding: '4px 16px',
                boxSizing: 'border-box',
                alignSelf: 'stretch',
                fontFamily: fonts.hand,
                fontSize: 32,
                lineHeight: '30px',
                color: palette.textMuted,
              }}
            />
          </div>

          <div style={{ height: 38, display: 'flex', flexDirection: 'row', gap: 8, alignSelf: 'stretch' }}>
            {pill('취소하기', onClose, false, saving)}
            {pill(saving ? '저장 중…' : saveError ? '다시 시도' : '수정하기', handleSave, true, !canSave || saving)}
          </div>
        </div>

        {saveError && (
          <p
            role="alert"
            style={{
              position: 'absolute',
              left: 24,
              top: 306,
              width: 322,
              margin: 0,
              textAlign: 'center',
              fontFamily: fonts.sans,
              fontSize: 12,
              lineHeight: 1.35,
              color: palette.textStrong,
              whiteSpace: 'nowrap',
            }}
          >
            이름을 저장하지 못했어요. 그대로 두었어요.
          </p>
        )}

        <button
          type="button"
          onClick={onDisconnect}
          disabled={saving}
          style={{
            fontFamily: fonts.hand,
            fontSize: 20,
            lineHeight: '100%',
            color: palette.textStrong,
            textDecoration: 'underline',
            cursor: saving ? 'not-allowed' : 'pointer',
            opacity: saving ? 0.65 : 1,
          }}
        >
          연결해제
        </button>
      </div>
    </>
  );
}
