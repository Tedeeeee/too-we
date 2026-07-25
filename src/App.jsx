import { useEffect, useState } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
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

export default function App() {
  const { ready } = useApp();
  const location = useLocation();
  const { scale, isMobile } = useCanvasScale();

  return (
    <div className={`stage${isMobile ? ' is-mobile' : ''}`} style={cssVars}>
      <div style={{ width: layout.width * scale, height: layout.height * scale }}>
        <div className="phone" style={scale !== 1 ? { transform: `scale(${scale})` } : undefined}>
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
