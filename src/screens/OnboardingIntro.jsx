import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { palette, fonts, gradients } from '@/styles/tokens';
import Screen from '@/components/Screen';
import FigLogo from '@/components/FigLogo';
import PrimaryButton from '@/components/PrimaryButton';
import { useApp } from '@/data/store';
import { onboardingError } from './onboarding-errors';

const newRequestKey = () => {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  return `onboarding-create-${Date.now()}-${Math.random().toString(36).slice(2)}`;
};

/** onboarding1 — 서비스 소개 + 두 갈래 진입(시작하기 / 초대코드) */
export default function OnboardingIntro() {
  const navigate = useNavigate();
  const { couple, startNewCouple } = useApp();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);
  const inFlightRef = useRef(false);
  const requestKeyRef = useRef(null);

  useEffect(() => {
    if (!couple?.coupleId) return;

    if (couple.connected && couple.onboarded) {
      navigate('/', { replace: true });
      return;
    }

    if (couple.me?.name && !couple.connected) {
      navigate('/onboarding/share', { replace: true });
      return;
    }

    navigate('/onboarding/name', {
      replace: true,
      state: { invited: Boolean(couple.connected && !couple.inviteCode) },
    });
  }, [couple, navigate]);

  const handleStart = async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setPending(true);
    setError(null);
    requestKeyRef.current ??= newRequestKey();

    try {
      await startNewCouple({ requestKey: requestKeyRef.current });
      requestKeyRef.current = null;
      navigate('/onboarding/name', { state: { invited: false } });
    } catch (nextError) {
      const nextOnboardingError = onboardingError(nextError, 'start');
      if (!nextOnboardingError.retryable) requestKeyRef.current = null;
      setError(nextOnboardingError);
    } finally {
      inFlightRef.current = false;
      setPending(false);
    }
  };

  return (
    <Screen bg={gradients.onboarding}>
      {/* 장미 + 워드마크는 Figma에서 216×92.264 단일 락업 (pos 93,90) */}
      <FigLogo left={93} top={90} />
      {/*
        본문 6줄. lineHeight 1.5 — 락업(92.264) 다음 gap 24로 206에서 시작해
        상단 컨테이너 끝 422.264까지 216px, 즉 6줄 × 36px = 24px × 1.5.
      */}
      <div
        style={{
          position: 'absolute',
          left: 22,
          top: 206,
          width: 358,
          textAlign: 'center',
          fontFamily: fonts.hand,
          fontSize: 24,
          color: palette.textMuted,
          lineHeight: 1.5,
        }}
      >
        어떤 감성적인 글귀들이
        <br />
        한줄 한줄
        <br />
        나오던가, 이 서비스에 대한
        <br />
        설명이 한줄한줄 뜨면
        <br />
        좋을거 같아요
        <br />
        우리가 머문 자리에 꽃갈피를 꽂아주세요
      </div>
      {error && (
        <p
          role="alert"
          style={{
            position: 'absolute',
            left: 32,
            top: 650,
            width: 338,
            margin: 0,
            textAlign: 'center',
            fontFamily: fonts.sans,
            fontSize: 15,
            lineHeight: 1.45,
            color: palette.text,
          }}
        >
          {error.message}
        </p>
      )}
      <fieldset disabled={pending} style={{ display: 'contents' }}>
        <PrimaryButton
          label={pending ? '시작하는 중…' : error?.retryable ? '다시 시도' : '시작하기'}
          left={22}
          top={744}
          width={358}
          disabled={pending}
          textColor={palette.onOliveAlt}
          onClick={handleStart}
        />
      </fieldset>
      <button
        type="button"
        disabled={pending}
        onClick={() => navigate('/onboarding/code')}
        style={{
          position: 'absolute',
          left: 22,
          top: 802,
          width: 358,
          textAlign: 'center',
          fontFamily: fonts.sans,
          fontSize: 16,
          fontWeight: 400,
          color: palette.olive,
          cursor: 'pointer',
        }}
      >
        초대코드를 받았어요
      </button>
    </Screen>
  );
}
