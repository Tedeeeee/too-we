import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { palette, fonts, gradients } from '@/styles/tokens';
import { onboardingSvg } from '@assets/svg';
import Screen from '@/components/Screen';
import PrimaryButton from '@/components/PrimaryButton';
import HandDrawnLine from '@/components/HandDrawnLine';
import { useApp } from '@/data/store';
import { onboardingError } from './onboarding-errors';

/** onboarding3 — 이름(부를 말) 입력. 초대 갈래면 완료 후 바로 홈으로. */
export default function OnboardingName() {
  const navigate = useNavigate();
  const location = useLocation();
  const { couple, setMyName, completeOnboarding } = useApp();
  const invited =
    typeof location.state?.invited === 'boolean'
      ? location.state.invited
      : Boolean(couple?.connected && !couple?.inviteCode);
  const [name, setName] = useState(couple?.me?.name ?? '');
  const [pending, setPending] = useState(false);
  const [pendingStage, setPendingStage] = useState('name');
  const [error, setError] = useState(null);
  const inFlightRef = useRef(false);
  const savedNameRef = useRef(couple?.me?.name?.trim() ?? '');
  const nameLength = Array.from(name).length;
  const normalizedName = name.trim();
  const canSubmit = normalizedName.length > 0 && Array.from(normalizedName).length <= 12;

  useEffect(() => {
    if (!couple || inFlightRef.current) return;
    if (!couple.coupleId) {
      navigate('/onboarding', { replace: true });
      return;
    }
    if (!couple.me?.name) return;

    navigate(couple.connected ? '/' : '/onboarding/share', { replace: true });
  }, [couple, navigate]);

  const handleSubmit = async () => {
    if (!canSubmit || inFlightRef.current) return;

    const needsNameSave = savedNameRef.current !== normalizedName;
    let operation = needsNameSave ? 'name' : 'complete';
    inFlightRef.current = true;
    setPending(true);
    setPendingStage(operation);
    setError(null);

    try {
      if (needsNameSave) {
        await setMyName(normalizedName);
        savedNameRef.current = normalizedName;
      }

      if (invited) {
        operation = 'complete';
        setPendingStage('complete');
        await completeOnboarding();
        navigate('/', { replace: true });
      } else {
        navigate('/onboarding/share');
      }
    } catch (nextError) {
      setError(onboardingError(nextError, operation));
    } finally {
      inFlightRef.current = false;
      setPending(false);
    }
  };

  return (
    <Screen bg={gradients.onboarding}>
      <div style={{ position: 'absolute', left: 72, top: 98, width: 258, height: 172 }}>
        <img
          src={onboardingSvg.name}
          width={258}
          height={172}
          alt=""
          style={{ display: 'block' }}
        />
      </div>
      <div
        style={{
          position: 'absolute',
          left: 22,
          top: 292,
          width: 358,
          textAlign: 'center',
          fontFamily: fonts.hand,
          fontSize: 28,
          color: palette.text,
        }}
      >
        당신을 뭐라고 부를까요?
      </div>
      <div
        style={{
          position: 'absolute',
          left: 22,
          top: 330,
          width: 358,
          textAlign: 'center',
          fontFamily: fonts.hand,
          fontSize: 24,
          color: palette.textMuted,
        }}
      >
        상대방에게도 이 이름으로 보여요
      </div>
      {/* 실제 키보드 입력 (프로토타입의 탭 데모 대신) */}
      <input
        value={name}
        onChange={(e) => {
          setName(Array.from(e.target.value).slice(0, 12).join(''));
          setError(null);
        }}
        disabled={pending}
        maxLength={12}
        autoFocus
        aria-label="이름"
        aria-invalid={Boolean(error)}
        style={{
          position: 'absolute',
          left: 22,
          top: 375,
          width: 358,
          height: 96,
          textAlign: 'center',
          fontFamily: fonts.hand,
          fontSize: nameLength > 4 ? 56 : 80,
          lineHeight: 1,
          color: palette.text,
          caretColor: palette.textMuted,
          background: 'transparent',
        }}
      />
      <HandDrawnLine
        color={palette.textMuted}
        width={358}
        height={12}
        style={{ position: 'absolute', left: 22, top: 465 }}
      />
      <div
        style={{
          position: 'absolute',
          left: 22,
          top: 486,
          width: 358,
          textAlign: 'right',
          fontFamily: fonts.hand,
          fontSize: 20,
          color: palette.textMuted,
          letterSpacing: 2,
        }}
      >
        {name.length}/12
      </div>
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
          label={
            pending
              ? pendingStage === 'complete'
                ? '마치는 중…'
                : '저장하는 중…'
              : error?.retryable
                ? '다시 시도'
                : '다음'
          }
          left={22}
          top={772}
          width={358}
          disabled={!canSubmit || pending}
          onClick={handleSubmit}
        />
      </fieldset>
    </Screen>
  );
}
