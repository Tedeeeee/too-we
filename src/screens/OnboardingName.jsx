import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { palette, fonts, gradients } from '@/styles/tokens';
import { onboardingSvg } from '@assets/svg';
import Screen from '@/components/Screen';
import PrimaryButton from '@/components/PrimaryButton';
import HandDrawnLine from '@/components/HandDrawnLine';
import { useApp } from '@/data/store';

/** onboarding3 — 이름(부를 말) 입력. 초대 갈래면 완료 후 바로 홈으로. */
export default function OnboardingName() {
  const navigate = useNavigate();
  const location = useLocation();
  const invited = location.state?.invited ?? false;
  const { setMyName, completeOnboarding } = useApp();
  const [name, setName] = useState('');

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
        onChange={(e) => setName(e.target.value.slice(0, 12))}
        maxLength={12}
        autoFocus
        aria-label="이름"
        style={{
          position: 'absolute',
          left: 22,
          top: 375,
          width: 358,
          height: 96,
          textAlign: 'center',
          fontFamily: fonts.hand,
          fontSize: name.length > 4 ? 56 : 80,
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
      <PrimaryButton
        label="다음"
        left={22}
        top={772}
        width={358}
        disabled={name.trim().length === 0}
        onClick={async () => {
          if (!name.trim()) return;
          await setMyName(name.trim());
          if (invited) {
            await completeOnboarding();
            navigate('/', { replace: true });
          } else {
            navigate('/onboarding/share');
          }
        }}
      />
    </Screen>
  );
}
