import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { palette, fonts, gradients } from '@/styles/tokens';
import { onboardingSvg } from '@assets/svg';
import Screen from '@/components/Screen';
import PrimaryButton from '@/components/PrimaryButton';
import HandDrawnLine from '@/components/HandDrawnLine';
import { useApp } from '@/data/store';
import { onboardingError } from './onboarding-errors';

const newRequestKey = () => {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  return `onboarding-join-${Date.now()}-${Math.random().toString(36).slice(2)}`;
};

/** onboarding2 — 초대 코드 입력 (6자리) */
export default function OnboardingCode() {
  const navigate = useNavigate();
  const { couple, connectWithCode } = useApp();
  const [code, setCode] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);
  const inputRef = useRef(null);
  const inFlightRef = useRef(false);
  const requestKeyRef = useRef(null);

  const cur = Math.min(code.length, 5);
  const canSubmit = code.length === 6;

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

  const handleConnect = async () => {
    if (!canSubmit) {
      inputRef.current?.focus();
      return;
    }
    if (inFlightRef.current) return;

    inFlightRef.current = true;
    setPending(true);
    setError(null);
    requestKeyRef.current ??= newRequestKey();
    try {
      await connectWithCode(code, { requestKey: requestKeyRef.current });
      requestKeyRef.current = null;
      navigate('/onboarding/name', { state: { invited: true } });
    } catch (nextError) {
      const nextOnboardingError = onboardingError(nextError, 'join');
      if (!nextOnboardingError.retryable) requestKeyRef.current = null;
      setError(nextOnboardingError);
    } finally {
      inFlightRef.current = false;
      setPending(false);
    }
  };

  return (
    <Screen bg={gradients.onboarding}>
      <div style={{ position: 'absolute', left: 132, top: 150, width: 139, height: 105 }}>
        <img
          src={onboardingSvg.letter}
          width={139}
          height={105}
          alt=""
          style={{ display: 'block' }}
        />
      </div>
      <div
        style={{
          position: 'absolute',
          left: 22,
          top: 262,
          width: 358,
          textAlign: 'center',
          fontFamily: fonts.hand,
          fontSize: 28,
          color: palette.text,
        }}
      >
        초대 코드를 입력해요
      </div>
      <div
        style={{
          position: 'absolute',
          left: 22,
          top: 299,
          width: 358,
          textAlign: 'center',
          fontFamily: fonts.hand,
          fontSize: 24,
          color: palette.textMuted,
        }}
      >
        초대한 사람이 당신을 기다리고 있어요
      </div>
      <div
        style={{
          position: 'absolute',
          left: 22,
          top: 392,
          width: 358,
          height: 113,
          display: 'flex',
          flexDirection: 'row',
          gap: 10,
        }}
      >
        {Array.from({ length: 6 }, (_, i) => {
          const isCaret = i === cur && code.length < 6;
          const filled = i < code.length;
          return (
            <div
              key={i}
              data-code-cell={i}
              style={{
                position: 'relative',
                flex: 1,
                minWidth: 0,
                height: 113,
              }}
            >
              <div
                data-code-digit={i}
                style={{
                  position: 'absolute',
                  left: 0,
                  top: 0,
                  width: '100%',
                  height: 80,
                  textAlign: 'center',
                  fontFamily: fonts.hand,
                  fontSize: 80,
                  lineHeight: 1,
                  color: palette.text,
                }}
              >
                {code[i] ?? ''}
              </div>
              <HandDrawnLine
                variant="short"
                color={isCaret || filled ? palette.text : palette.beige}
                width="100%"
                height={10}
                style={{
                  position: 'absolute',
                  left: 0,
                  top: 73,
                  transform: isCaret ? 'scaleY(1.2)' : undefined,
                }}
              />
            </div>
          );
        })}
      </div>
      {/* 실제 키보드 입력 (프로토타입의 탭 데모 대신) */}
      <input
        ref={inputRef}
        value={code}
        onChange={(e) => {
          const nextCode = e.target.value.replace(/\D/g, '').slice(0, 6);
          if (nextCode !== code) requestKeyRef.current = null;
          setCode(nextCode);
          setError(null);
        }}
        disabled={pending}
        maxLength={6}
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]{6}"
        autoFocus
        aria-label="초대 코드"
        aria-invalid={Boolean(error)}
        style={{
          position: 'absolute',
          left: 22,
          top: 360,
          width: 358,
          height: 160,
          opacity: 0,
          cursor: 'text',
        }}
      />
      {error && (
        <p
          role="alert"
          style={{
            position: 'absolute',
            left: 32,
            top: 560,
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
      <fieldset disabled={!canSubmit || pending} style={{ display: 'contents' }}>
        <PrimaryButton
          label={pending ? '연결하는 중…' : error?.retryable ? '다시 시도' : '연결하기'}
          left={22}
          top={772}
          width={358}
          disabled={!canSubmit || pending}
          onClick={handleConnect}
        />
      </fieldset>
    </Screen>
  );
}
