import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { palette, fonts } from '@/styles/tokens';
import { uiSvg } from '@assets/svg';
import Screen from '@/components/Screen';
import MaskIcon from '@/components/MaskIcon';
import BackButton from '@/components/BackButton';
import ProfileEditSheet from '@/components/ProfileEditSheet';
import { useApp } from '@/data/store';
import * as api from '@/data/api';
import { dDay } from '@/data/format';

function DisconnectDialog({ step, pending, failed, onCancel, onContinue, onConfirm }) {
  const second = step === 'second';
  const titleId = second ? 'disconnect-delete-title' : 'disconnect-access-title';

  return (
    <>
      <div
        aria-hidden="true"
        onClick={pending ? undefined : onCancel}
        style={{
          position: 'absolute',
          inset: 0,
          background: palette.dimModal,
        }}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        style={{
          position: 'absolute',
          left: 24,
          top: 254,
          width: 354,
          minHeight: 282,
          padding: '30px 24px 24px',
          borderRadius: 18,
          background: palette.cardAlt,
          boxSizing: 'border-box',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'stretch',
          gap: 18,
          color: palette.text,
        }}
      >
        <h2
          id={titleId}
          style={{
            margin: 0,
            textAlign: 'center',
            fontFamily: fonts.hand,
            fontSize: 28,
            fontWeight: 400,
            lineHeight: 1.25,
            color: palette.textStrong,
          }}
        >
          {second ? '커플 데이터 영구 삭제 확인' : '커플 연결 해제 확인'}
        </h2>
        {second ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <p style={{ margin: 0, textAlign: 'center', fontFamily: fonts.sans, fontSize: 15, lineHeight: 1.55 }}>
              연결 해제가 완료되면 사진을 포함한 커플 데이터가 24시간 안에 영구 삭제돼요.
            </p>
            <p style={{ margin: 0, textAlign: 'center', fontFamily: fonts.sans, fontSize: 15, lineHeight: 1.55, color: palette.textStrong }}>
              삭제된 데이터는 복구할 수 없어요.
            </p>
            {failed && (
              <p
                role="alert"
                style={{ margin: '4px 0 0', textAlign: 'center', fontFamily: fonts.sans, fontSize: 14, lineHeight: 1.45, color: palette.textStrong }}
              >
                연결을 해제하지 못했어요. 현재 연결과 데이터는 그대로예요.
              </p>
            )}
          </div>
        ) : (
          <p style={{ margin: 0, textAlign: 'center', fontFamily: fonts.sans, fontSize: 15, lineHeight: 1.55 }}>
            연결을 해제하면 두 사람 모두 이 커플의 기록과 가고 싶은 곳에 즉시 접근할 수 없어요.
          </p>
        )}
        <div style={{ display: 'flex', gap: 8, marginTop: 'auto' }}>
          <button
            type="button"
            onClick={onCancel}
            disabled={pending}
            style={{
              flex: 1,
              height: 42,
              borderRadius: 999,
              color: palette.olive,
              fontFamily: fonts.sans,
              fontSize: 14,
              cursor: pending ? 'not-allowed' : 'pointer',
              boxShadow: `inset 0 0 0 1px ${palette.olive}`,
            }}
          >
            취소
          </button>
          <button
            type="button"
            onClick={second ? onConfirm : onContinue}
            disabled={pending}
            style={{
              flex: 1,
              height: 42,
              borderRadius: 999,
              background: palette.olive,
              color: palette.onOliveAlt,
              fontFamily: fonts.sans,
              fontSize: 14,
              cursor: pending ? 'not-allowed' : 'pointer',
            }}
          >
            {second
              ? pending
                ? '연결 해제 중…'
                : failed
                  ? '다시 시도'
                  : '커플 연결 해제하기'
              : '계속하기'}
          </button>
        </div>
      </div>
    </>
  );
}

export default function MyPage() {
  const navigate = useNavigate();
  const {
    couple,
    wishlist,
    wishlistStatus,
    setMyName,
    disconnectCouple,
  } = useApp();
  const [settings, setSettings] = useState(null);
  const [settingsStatus, setSettingsStatus] = useState('loading');
  const [settingsAttempt, setSettingsAttempt] = useState(0);
  const [editing, setEditing] = useState(false);
  const [disconnectStep, setDisconnectStep] = useState(null);
  const [disconnectPending, setDisconnectPending] = useState(false);
  const [disconnectFailed, setDisconnectFailed] = useState(false);
  const disconnectInFlightRef = useRef(false);

  useEffect(() => {
    let active = true;
    setSettingsStatus('loading');
    api.getSettings()
      .then((nextSettings) => {
        if (!active) return;
        setSettings(nextSettings);
        setSettingsStatus('ready');
      })
      .catch(() => {
        if (active) setSettingsStatus('error');
      });
    return () => {
      active = false;
    };
  }, [settingsAttempt]);

  const profileBlob = (side) => (
    <div
      data-profile-blob={side}
      style={{
        width: 96,
        height: 96,
        flexShrink: 0,
        background: palette.photoFill,
        borderRadius: side === 'left'
          ? '48% 52% 47% 53% / 51% 48% 52% 49%'
          : '52% 48% 53% 47% / 48% 52% 49% 51%',
      }}
    />
  );

  const settingRow = (title, value, onClick, top) => (
    <button
      data-setting-row
      type="button"
      onClick={onClick}
      style={{
        position: 'absolute',
        left: 2,
        top,
        width: 398,
        height: 56,
        padding: '0 13px',
        border: 0,
        borderRadius: 20,
        background: palette.cardAlt,
        boxShadow: '0 1px 4px rgba(60, 40, 30, 0.035)',
        boxSizing: 'border-box',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        cursor: onClick ? 'pointer' : 'default',
      }}
    >
      <span
        style={{
          fontFamily: fonts.hand,
          fontSize: 20,
          lineHeight: 1,
          color: palette.textStrong,
        }}
      >
        {title}
      </span>
      <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
        <span
          style={{
            fontFamily: fonts.hand,
            fontSize: 17,
            lineHeight: 1,
            color: palette.textMuted,
          }}
        >
          {value}
        </span>
        <MaskIcon src={uiSvg.expandRight} color={palette.textSubtle} size={18} />
      </span>
    </button>
  );

  const myName = couple.me?.name?.trim() || '이름 없음';
  const partnerName = couple.partner?.name?.trim() || '이름 없음';
  const relationshipDays = dDay(couple.startDate);
  const wishlistItems = Array.isArray(wishlist) ? wishlist : [];
  const wishlistValue = wishlistStatus === 'loading' && wishlistItems.length === 0
    ? '불러오는 중…'
    : wishlistStatus === 'error' && wishlistItems.length === 0
      ? '불러오지 못함'
      : `${wishlistItems.length}곳`;
  const settingsValue = settingsStatus === 'loading'
    ? '불러오는 중…'
    : settingsStatus === 'error'
      ? '불러오지 못함'
      : settings?.recordAlert || '사용 안 함';

  const handleDisconnect = async () => {
    if (disconnectInFlightRef.current) return;
    disconnectInFlightRef.current = true;
    setDisconnectPending(true);
    setDisconnectFailed(false);
    try {
      await disconnectCouple();
      setDisconnectStep(null);
    } catch {
      setDisconnectFailed(true);
    } finally {
      disconnectInFlightRef.current = false;
      setDisconnectPending(false);
    }
  };

  return (
    <Screen bg={palette.bgAlt}>
      <BackButton left={4} top={5} />

      <h1
        style={{
          position: 'absolute',
          left: 0,
          top: 14,
          width: 402,
          margin: 0,
          textAlign: 'center',
          fontFamily: fonts.hand,
          fontSize: 20,
          fontWeight: 400,
          lineHeight: 1,
          color: palette.text,
          pointerEvents: 'none',
        }}
      >
        마이페이지
      </h1>

      <div
        style={{
          position: 'absolute',
          left: 90,
          top: 112,
          width: 222,
          height: 96,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 4,
        }}
      >
        {profileBlob('left')}
        <MaskIcon src={uiSvg.heartFilled} color={palette.heart} size={18} />
        {profileBlob('right')}
      </div>

      <p
        style={{
          position: 'absolute',
          left: 0,
          top: 229,
          width: 402,
          margin: 0,
          textAlign: 'center',
          whiteSpace: 'nowrap',
          fontFamily: fonts.hand,
          fontSize: 20,
          lineHeight: 1,
          color: palette.textStrong,
        }}
      >
        {myName}과(와) {partnerName}이 함께한지{' '}
        <span data-dday style={{ color: palette.olive }}>
          +{relationshipDays}
        </span>
        일째
      </p>

      <button
        type="button"
        onClick={() => setEditing(true)}
        style={{
          position: 'absolute',
          left: 139,
          top: 262,
          width: 124,
          height: 32,
          padding: 0,
          border: 0,
          borderRadius: 999,
          background: palette.olive,
          color: palette.onOliveAlt,
          fontFamily: fonts.sans,
          fontSize: 14,
          fontWeight: 500,
          lineHeight: '32px',
          cursor: 'pointer',
        }}
      >
        내 정보 수정하기
      </button>

      <span
        style={{
          position: 'absolute',
          left: 4,
          top: 337,
          fontFamily: fonts.hand,
          fontSize: 18,
          lineHeight: 1,
          color: palette.text,
        }}
      >
        설정
      </span>

      {settingRow('가고 싶은 곳', wishlistValue, () => navigate('/mypage/wishlist'), 363)}
      {settingRow('기록 알림', settingsValue, undefined, 428)}

      {settingsStatus === 'error' && (
        <div
          role="alert"
          style={{
            position: 'absolute',
            left: 16,
            top: 492,
            width: 370,
            minHeight: 58,
            padding: '10px 14px',
            borderRadius: 14,
            background: palette.cardAlt,
            boxSizing: 'border-box',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 10,
            color: palette.text,
            fontFamily: fonts.sans,
            fontSize: 13,
            lineHeight: 1.35,
          }}
        >
          <span>설정을 불러오지 못했어요.</span>
          <button
            type="button"
            onClick={() => setSettingsAttempt((attempt) => attempt + 1)}
            style={{
              flexShrink: 0,
              padding: '6px 10px',
              borderRadius: 999,
              color: palette.olive,
              fontFamily: fonts.sans,
              fontSize: 12,
              cursor: 'pointer',
              boxShadow: `inset 0 0 0 1px ${palette.olive}`,
            }}
          >
            설정 다시 시도
          </button>
        </div>
      )}

      <button
        data-disconnect
        type="button"
        onClick={() => setDisconnectStep('first')}
        style={{
          position: 'absolute',
          right: 16,
          top: settingsStatus === 'error' ? 560 : 516,
          height: 24,
          padding: 0,
          border: 0,
          background: 'transparent',
          color: palette.textDisabled,
          fontFamily: fonts.hand,
          fontSize: 16,
          lineHeight: '24px',
        }}
      >
        커플 연결해제
      </button>

      <div
        data-home-indicator
        aria-hidden="true"
        style={{
          position: 'absolute',
          left: 128,
          bottom: 4,
          width: 146,
          height: 5,
          borderRadius: 999,
          background: palette.textMuted,
          opacity: 0.55,
        }}
      />

      {editing && (
        <ProfileEditSheet
          name={couple.me?.name ?? ''}
          onClose={() => setEditing(false)}
          onSave={async (next) => {
            await setMyName(next);
            setEditing(false);
          }}
          onDisconnect={() => {
            setEditing(false);
            setDisconnectFailed(false);
            setDisconnectStep('first');
          }}
        />
      )}

      {disconnectStep && (
        <DisconnectDialog
          step={disconnectStep}
          pending={disconnectPending}
          failed={disconnectFailed}
          onCancel={() => {
            setDisconnectFailed(false);
            setDisconnectStep(null);
          }}
          onContinue={() => {
            setDisconnectFailed(false);
            setDisconnectStep('second');
          }}
          onConfirm={handleDisconnect}
        />
      )}
    </Screen>
  );
}
