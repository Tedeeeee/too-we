import { useState } from 'react';
import { useNavigate } from 'react-router';
import { palette, fonts, gradients } from '@/styles/tokens';
import { flowersIllustSvg, onboardingSvg, svgSize } from '@assets/svg';
import Screen from '@/components/Screen';
import PrimaryButton from '@/components/PrimaryButton';
import HandDrawnLine from '@/components/HandDrawnLine';
import { useApp } from '@/data/store';

/** onboarding4 — 내 초대 코드 공유 카드 */
export default function OnboardingShare() {
  const navigate = useNavigate();
  const { couple, completeOnboarding } = useApp();
  const [copied, setCopied] = useState(false);

  const code = couple?.inviteCode || '';
  const codeDisplay = `${code.slice(0, 3)} ${code.slice(3)}`;
  const myName = couple?.me?.name || '지은';

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* clipboard 미지원 환경 무시 */
    }
  };

  const shareCode = async () => {
    const text = `오늘,우리는 — ${myName}님의 초대 코드: ${code}`;
    if (navigator.share) {
      try {
        await navigator.share({ title: '오늘,우리는', text });
      } catch {
        /* 사용자가 공유 취소 */
      }
    } else {
      copyCode();
    }
  };

  return (
    <Screen bg={gradients.onboarding}>
      <div
        style={{
          position: 'absolute',
          left: 36,
          top: 90,
          width: 331,
          height: 467,
        }}
      >
        <img
          src={onboardingSvg.note1}
          {...svgSize.note1}
          alt=""
          style={{ position: 'absolute', left: 3, top: 6, display: 'block', pointerEvents: 'none' }}
        />
        {/* 장미 + 노란 카라 묶음 (Figma 컴포넌트 136:912의 일러스트). 카드 331 기준 가운데 */}
        <img
          src={flowersIllustSvg}
          {...svgSize.flowersIllust}
          alt=""
          style={{ position: 'absolute', left: (331 - svgSize.flowersIllust.width) / 2, top: 44, display: 'block' }}
        />
        <div
          style={{
            position: 'absolute',
            left: -22,
            top: 166,
            width: 375,
            textAlign: 'center',
            whiteSpace: 'nowrap',
            fontFamily: fonts.hand,
            fontSize: 32,
            color: palette.text,
          }}
        >
          우리의 꽃갈피를 같이 모아요
        </div>
        <div
          style={{
            position: 'absolute',
            left: 0,
            top: 208,
            width: 331,
            textAlign: 'center',
            fontFamily: fonts.hand,
            fontSize: 24,
            color: palette.textMuted,
          }}
        >
          {myName}님이 당신을 기다리고 있어요
        </div>
        <HandDrawnLine
          color={palette.beige}
          width={275}
          height={12}
          style={{ position: 'absolute', left: 28, top: 246 }}
        />
        <div
          style={{
            position: 'absolute',
            left: 0,
            top: 274,
            width: 331,
            textAlign: 'center',
            fontFamily: fonts.hand,
            fontSize: 80,
            lineHeight: 1,
            color: palette.text,
            letterSpacing: 4,
          }}
        >
          {codeDisplay}
        </div>
        <div
          style={{
            position: 'absolute',
            left: 0,
            top: 384,
            width: 331,
            display: 'flex',
            flexDirection: 'row',
            justifyContent: 'center',
            gap: 16,
          }}
        >
          <button
            onClick={copyCode}
            style={{
              width: 128,
              height: 46,
              border: `1.5px solid ${palette.olive}`,
              borderRadius: 999,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontFamily: fonts.sans,
              fontSize: 16,
              fontWeight: 500,
              color: palette.olive,
              cursor: 'pointer',
            }}
          >
            {copied ? '복사됨!' : '코드복사'}
          </button>
          <button
            onClick={shareCode}
            style={{
              width: 128,
              height: 46,
              background: palette.oliveSoft,
              borderRadius: 999,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontFamily: fonts.sans,
              fontSize: 16,
              fontWeight: 500,
              color: palette.olive,
              cursor: 'pointer',
            }}
          >
            공유하기
          </button>
        </div>
      </div>
      <PrimaryButton
        label="시작하기"
        left={22}
        top={772}
        width={358}
        onClick={async () => {
          await completeOnboarding();
          navigate('/', { replace: true });
        }}
      />
    </Screen>
  );
}
