import { useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { palette, fonts, gradients } from '@/styles/tokens';
import { onboardingSvg } from '@assets/svg';
import Screen from '@/components/Screen';
import PrimaryButton from '@/components/PrimaryButton';
import HandDrawnLine from '@/components/HandDrawnLine';
import { useApp } from '@/data/store';
import { DEMO_INVITER } from '@/data/fixtures';

/** onboarding2 — 초대 코드 입력 (6자리) */
export default function OnboardingCode() {
  const navigate = useNavigate();
  const { connectWithCode } = useApp();
  const [code, setCode] = useState('');
  const inputRef = useRef(null);

  const cur = Math.min(code.length, 5);

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
        {DEMO_INVITER}님이 당신을 기다리고 있어요
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
        onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
        inputMode="numeric"
        autoFocus
        aria-label="초대 코드"
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
      <PrimaryButton
        label="연결하기"
        left={22}
        top={772}
        width={358}
        disabled={code.length < 6}
        onClick={async () => {
          if (code.length < 6) {
            inputRef.current?.focus();
            return;
          }
          await connectWithCode(code);
          navigate('/onboarding/name', { state: { invited: true } });
        }}
      />
    </Screen>
  );
}
