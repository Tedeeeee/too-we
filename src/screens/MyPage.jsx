import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { palette, fonts } from '@/styles/tokens';
import { uiSvg } from '@assets/svg';
import Screen from '@/components/Screen';
import MaskIcon from '@/components/MaskIcon';
import BackButton from '@/components/BackButton';
import ProfileEditSheet from '@/components/ProfileEditSheet';
import { useApp } from '@/data/store';
import * as api from '@/data/api';
import { dDay } from '@/data/format';

export default function MyPage() {
  const navigate = useNavigate();
  const { couple, setMyName } = useApp();
  const [wishlistCount, setWishlistCount] = useState(0);
  const [settings, setSettings] = useState(null);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    api.getWishlist().then((wishlist) => setWishlistCount(wishlist.length));
    api.getSettings().then(setSettings);
  }, []);

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

  const relationshipDays = dDay(couple.startDate);

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
        {couple.me.name}과(와) {couple.partner.name}이 함께한지{' '}
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

      {settingRow('가고 싶은 곳', `${wishlistCount}곳`, () => navigate('/mypage/wishlist'), 363)}
      {settingRow('기록 알림', settings?.recordAlert || '', undefined, 428)}

      <button
        data-disconnect
        type="button"
        style={{
          position: 'absolute',
          right: 16,
          top: 516,
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
          name={couple.me.name}
          onClose={() => setEditing(false)}
          onSave={async (next) => {
            await setMyName(next);
            setEditing(false);
          }}
          onDisconnect={() => setEditing(false)}
        />
      )}
    </Screen>
  );
}
