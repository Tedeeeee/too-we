import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { palette, fonts, gradients } from '@/styles/tokens';
import { flowersIllustSvg, onboardingSvg, svgSize } from '@assets/svg';
import Screen from '@/components/Screen';
import PrimaryButton from '@/components/PrimaryButton';
import HandDrawnLine from '@/components/HandDrawnLine';
import { useApp } from '@/data/store';
import { onboardingError } from './onboarding-errors';

const newRequestKey = () => {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  return `onboarding-invite-${Date.now()}-${Math.random().toString(36).slice(2)}`;
};

const copyText = async (text) => {
  try {
    if (typeof navigator.clipboard?.writeText === 'function') {
      await navigator.clipboard.writeText(text);
      return;
    }
  } catch {
    // Clipboard API 실패 시 선택 복사 fallback을 이어서 시도한다.
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();

  try {
    if (typeof document.execCommand !== 'function' || !document.execCommand('copy')) {
      throw new Error('copy unavailable');
    }
  } finally {
    textarea.remove();
  }
};

const isShareCancellation = (error) => error?.name === 'AbortError';

/** onboarding4 — 내 초대 코드 공유 카드 */
export default function OnboardingShare() {
  const navigate = useNavigate();
  const { couple, reissueCoupleInvite, completeOnboarding } = useApp();
  const [clock, setClock] = useState(() => Date.now());
  const [activeAction, setActiveAction] = useState(null);
  const [feedback, setFeedback] = useState(null);
  const [copySucceeded, setCopySucceeded] = useState(false);
  const actionRef = useRef(null);
  const reissueKeyRef = useRef(null);

  const code = typeof couple?.inviteCode === 'string' ? couple.inviteCode.trim() : '';
  const expiresAt = Date.parse(couple?.inviteExpiresAt ?? '');
  const expired = Number.isFinite(expiresAt) && expiresAt <= clock;
  const codeAvailable = /^\d{6}$/.test(code) && Number.isFinite(expiresAt) && !expired;
  const codeDisplay = codeAvailable ? `${code.slice(0, 3)} ${code.slice(3)}` : '— —';
  const myName = couple?.me?.name?.trim() ?? '';
  const codeIssueMessage = expired ? '초대 코드가 만료됐어요.' : '새 초대 코드가 필요해요.';
  const busy = activeAction !== null;

  useEffect(() => {
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return undefined;
    const delay = Math.min(expiresAt - Date.now() + 25, 2_147_483_647);
    const timer = window.setTimeout(() => setClock(Date.now()), delay);
    return () => window.clearTimeout(timer);
  }, [expiresAt]);

  useEffect(() => {
    if (!couple || activeAction) return;
    if (!couple.coupleId) {
      navigate('/onboarding', { replace: true });
      return;
    }
    if (!couple.me?.name) {
      navigate('/onboarding/name', {
        replace: true,
        state: { invited: Boolean(couple.connected && !couple.inviteCode) },
      });
      return;
    }
    if (couple.connected) navigate('/', { replace: true });
  }, [activeAction, couple, navigate]);

  const beginAction = (action) => {
    if (actionRef.current) return false;
    actionRef.current = action;
    setActiveAction(action);
    setFeedback(null);
    return true;
  };

  const endAction = () => {
    actionRef.current = null;
    setActiveAction(null);
  };

  const copyCode = async () => {
    if (!codeAvailable || !beginAction('copy')) return;
    setCopySucceeded(false);
    try {
      await copyText(code);
      setCopySucceeded(true);
      setFeedback({ kind: 'status', operation: 'copy', message: '코드를 복사했어요.' });
    } catch {
      setFeedback({
        kind: 'error',
        operation: 'copy',
        message: '복사하지 못했어요. 화면의 코드를 길게 눌러 직접 복사해 주세요.',
      });
    } finally {
      endAction();
    }
  };

  const shareCode = async () => {
    if (!codeAvailable || !beginAction('share')) return;
    const text = `오늘,우리는 — ${myName ? `${myName}님의` : '나의'} 초대 코드: ${code}`;

    try {
      if (typeof navigator.share === 'function') {
        try {
          await navigator.share({ title: '오늘,우리는', text });
          setFeedback({
            kind: 'status',
            operation: 'share',
            message: '초대 코드를 공유했어요.',
          });
        } catch (shareError) {
          if (isShareCancellation(shareError)) {
            setFeedback({ kind: 'status', operation: 'share', message: '공유를 취소했어요.' });
          } else {
            setFeedback({
              kind: 'error',
              operation: 'share',
              message: '공유하지 못했어요. 코드를 복사해 직접 보내 주세요.',
            });
          }
        }
      } else {
        await copyText(code);
        setCopySucceeded(true);
        setFeedback({
          kind: 'status',
          operation: 'share',
          message: '코드를 복사했어요. 원하는 곳에 붙여넣어 주세요.',
        });
      }
    } catch {
      setFeedback({
        kind: 'error',
        operation: 'share',
        message: '복사하지 못했어요. 화면의 코드를 길게 눌러 직접 복사해 주세요.',
      });
    } finally {
      endAction();
    }
  };

  const reissueCode = async () => {
    if (codeAvailable || !beginAction('reissue')) return;
    reissueKeyRef.current ??= newRequestKey();

    try {
      await reissueCoupleInvite({ requestKey: reissueKeyRef.current });
      reissueKeyRef.current = null;
      setFeedback({
        kind: 'status',
        operation: 'reissue',
        message: '새 초대 코드를 만들었어요.',
      });
    } catch (nextError) {
      const mapped = onboardingError(nextError, 'reissue');
      setFeedback({ kind: 'error', operation: 'reissue', ...mapped });
    } finally {
      endAction();
    }
  };

  const finishOnboarding = async () => {
    if (!beginAction('complete')) return;
    try {
      await completeOnboarding();
      navigate('/', { replace: true });
    } catch (nextError) {
      const mapped = onboardingError(nextError, 'complete');
      setFeedback({ kind: 'error', operation: 'complete', ...mapped });
    } finally {
      endAction();
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
          {myName ? `${myName}님이` : '초대한 사람이'} 당신을 기다리고 있어요
        </div>
        <HandDrawnLine
          color={palette.beige}
          width={275}
          height={12}
          style={{ position: 'absolute', left: 28, top: 246 }}
        />
        <div
          aria-label={codeAvailable ? `초대 코드 ${code}` : undefined}
          style={{
            position: 'absolute',
            left: 0,
            top: 274,
            width: 331,
            textAlign: 'center',
            fontFamily: fonts.hand,
            fontSize: codeAvailable ? 80 : 52,
            lineHeight: 1,
            color: palette.text,
            letterSpacing: 4,
            userSelect: 'text',
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
            type="button"
            disabled={!codeAvailable || busy}
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
              cursor: !codeAvailable || busy ? 'not-allowed' : 'pointer',
              opacity: !codeAvailable || busy ? 0.55 : 1,
            }}
          >
            {activeAction === 'copy' ? '복사 중…' : copySucceeded ? '복사됨!' : '코드복사'}
          </button>
          <button
            type="button"
            disabled={!codeAvailable || busy}
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
              cursor: !codeAvailable || busy ? 'not-allowed' : 'pointer',
              opacity: !codeAvailable || busy ? 0.55 : 1,
            }}
          >
            {activeAction === 'share' ? '공유 중…' : '공유하기'}
          </button>
        </div>
        {!codeAvailable && (
          <button
            type="button"
            disabled={busy}
            onClick={reissueCode}
            style={{
              position: 'absolute',
              left: 96,
              top: 438,
              width: 139,
              height: 40,
              borderRadius: 999,
              background: palette.olive,
              color: palette.onOlive,
              fontFamily: fonts.sans,
              fontSize: 15,
              fontWeight: 500,
              cursor: busy ? 'not-allowed' : 'pointer',
            }}
          >
            {activeAction === 'reissue'
              ? '만드는 중…'
              : feedback?.operation === 'reissue' && feedback.retryable
                ? '다시 시도'
                : '새 코드 받기'}
          </button>
        )}
      </div>
      {!codeAvailable && !feedback && (
        <p
          role="alert"
          style={{
            position: 'absolute',
            left: 32,
            top: 580,
            width: 338,
            margin: 0,
            textAlign: 'center',
            fontFamily: fonts.sans,
            fontSize: 15,
            lineHeight: 1.45,
            color: palette.text,
          }}
        >
          {codeIssueMessage} 새 코드를 받은 뒤 복사하거나 공유해 주세요.
        </p>
      )}
      {feedback && (
        <p
          role={feedback.kind === 'error' ? 'alert' : 'status'}
          aria-live={feedback.kind === 'error' ? 'assertive' : 'polite'}
          style={{
            position: 'absolute',
            left: 32,
            top: 580,
            width: 338,
            margin: 0,
            textAlign: 'center',
            fontFamily: fonts.sans,
            fontSize: 15,
            lineHeight: 1.45,
            color: palette.text,
          }}
        >
          {feedback.message}
        </p>
      )}
      <fieldset disabled={busy} style={{ display: 'contents' }}>
        <PrimaryButton
          label={
            activeAction === 'complete'
              ? '시작하는 중…'
              : feedback?.operation === 'complete' && feedback.retryable
                ? '다시 시도'
                : '시작하기'
          }
          left={22}
          top={772}
          width={358}
          disabled={busy}
          onClick={finishOnboarding}
        />
      </fieldset>
    </Screen>
  );
}
