import { useEffect, useState } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router';
import { cssVars, layout } from '@/styles/tokens';
import { useApp } from '@/data/store';

import OnboardingIntro from '@/screens/OnboardingIntro';
import OnboardingCode from '@/screens/OnboardingCode';
import OnboardingName from '@/screens/OnboardingName';
import OnboardingShare from '@/screens/OnboardingShare';
import Home from '@/screens/Home';
import MapSelect from '@/screens/MapSelect';
import RecordNew from '@/screens/RecordNew';
import BookmarkPick from '@/screens/BookmarkPick';
import PlaceDetailScreen from '@/screens/PlaceDetailScreen';
import RecordEdit from '@/screens/RecordEdit';
import MyPage from '@/screens/MyPage';
import Wishlist from '@/screens/Wishlist';

/** 온보딩 완료 전에는 앱 화면 진입을 막는다 */
function RequireOnboarded({ children }) {
  const { couple } = useApp();
  if (!couple?.onboarded) return <Navigate to="/onboarding" replace />;
  return children;
}

/** 모바일 실기기에서 402px 캔버스를 화면 폭에 맞춰 스케일 */
function useCanvasScale() {
  const [scale, setScale] = useState(1);
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const update = () => {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      if (vw <= 480) {
        setScale(Math.min(vw / layout.width, vh / layout.height));
        setIsMobile(true);
      } else {
        setScale(1);
        setIsMobile(false);
      }
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);
  return { scale, isMobile };
}

const startupPanelStyle = {
  position: 'absolute',
  inset: 0,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 12,
  padding: '48px 32px',
  textAlign: 'center',
  background: 'var(--c-bg)',
  color: 'var(--c-text)',
};

const startupTitleStyle = {
  margin: 0,
  color: 'var(--c-text-strong)',
  fontSize: 27,
  fontWeight: 400,
  lineHeight: 1.35,
};

const startupBodyStyle = {
  maxWidth: 286,
  margin: 0,
  fontSize: 19,
  lineHeight: 1.55,
};

const retryButtonStyle = {
  minWidth: 164,
  minHeight: 52,
  marginTop: 16,
  padding: '12px 30px',
  borderRadius: 999,
  background: 'var(--c-olive)',
  color: '#FFFDF8',
  fontFamily: 'var(--font-sans)',
  fontSize: 16,
  fontWeight: 700,
  cursor: 'pointer',
};

function StartupLoading() {
  return (
    <div role="status" aria-live="polite" aria-busy="true" style={startupPanelStyle}>
      <p style={startupTitleStyle}>앱을 준비하고 있어요</p>
      <p style={startupBodyStyle}>저장된 커플과 기록을 불러오는 중이에요.</p>
    </div>
  );
}

function StartupError({ error, onRetry }) {
  const retryable = error?.retryable === true;
  const description = retryable
    ? error.code === 'rate_limited'
      ? '요청이 잠시 몰렸어요. 잠시 뒤에 다시 시도해 주세요.'
      : '네트워크 연결을 확인한 뒤 다시 시도해 주세요.'
    : '앱을 다시 열어 주세요. 문제가 계속되면 문의해 주세요.';

  return (
    <div role="alert" aria-live="assertive" style={startupPanelStyle}>
      <h1 style={startupTitleStyle}>앱을 불러오지 못했어요</h1>
      <p style={startupBodyStyle}>{description}</p>
      {retryable && (
        <button type="button" style={retryButtonStyle} onClick={onRetry}>
          다시 시도
        </button>
      )}
    </div>
  );
}

export default function App() {
  const { ready, bootstrapStatus, bootstrapError, retryBootstrap } = useApp();
  const location = useLocation();
  const { scale, isMobile } = useCanvasScale();

  return (
    <div className={`stage${isMobile ? ' is-mobile' : ''}`} style={cssVars}>
      <div style={{ width: layout.width * scale, height: layout.height * scale }}>
        <div className="phone" style={scale !== 1 ? { transform: `scale(${scale})` } : undefined}>
          {bootstrapStatus === 'loading' && <StartupLoading />}
          {bootstrapStatus === 'error' && (
            <StartupError error={bootstrapError} onRetry={retryBootstrap} />
          )}
          {ready && (
            <div className="screen-host" key={location.pathname}>
              <Routes location={location}>
                <Route path="/onboarding" element={<OnboardingIntro />} />
                <Route path="/onboarding/code" element={<OnboardingCode />} />
                <Route path="/onboarding/name" element={<OnboardingName />} />
                <Route path="/onboarding/share" element={<OnboardingShare />} />
                <Route
                  path="/"
                  element={
                    <RequireOnboarded>
                      <Home />
                    </RequireOnboarded>
                  }
                />
                <Route
                  path="/map"
                  element={
                    <RequireOnboarded>
                      <MapSelect />
                    </RequireOnboarded>
                  }
                />
                <Route
                  path="/record"
                  element={
                    <RequireOnboarded>
                      <RecordNew />
                    </RequireOnboarded>
                  }
                />
                <Route
                  path="/pick"
                  element={
                    <RequireOnboarded>
                      <BookmarkPick />
                    </RequireOnboarded>
                  }
                />
                <Route
                  path="/place/:recordId"
                  element={
                    <RequireOnboarded>
                      <PlaceDetailScreen />
                    </RequireOnboarded>
                  }
                />
                <Route
                  path="/place/:recordId/edit"
                  element={
                    <RequireOnboarded>
                      <RecordEdit />
                    </RequireOnboarded>
                  }
                />
                <Route
                  path="/mypage"
                  element={
                    <RequireOnboarded>
                      <MyPage />
                    </RequireOnboarded>
                  }
                />
                <Route
                  path="/mypage/wishlist"
                  element={
                    <RequireOnboarded>
                      <Wishlist />
                    </RequireOnboarded>
                  }
                />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
