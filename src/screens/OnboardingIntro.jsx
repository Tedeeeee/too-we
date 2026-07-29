import { useNavigate } from 'react-router';
import { palette, fonts, gradients } from '@/styles/tokens';
import Screen from '@/components/Screen';
import FigLogo from '@/components/FigLogo';
import PrimaryButton from '@/components/PrimaryButton';
import { useApp } from '@/data/store';

/** onboarding1 — 서비스 소개 + 두 갈래 진입(시작하기 / 초대코드) */
export default function OnboardingIntro() {
  const navigate = useNavigate();
  const { startNewCouple } = useApp();

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
      <PrimaryButton
        label="시작하기"
        left={22}
        top={744}
        width={358}
        textColor={palette.onOliveAlt}
        onClick={async () => {
          await startNewCouple();
          navigate('/onboarding/name', { state: { invited: false } });
        }}
      />
      <button
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
