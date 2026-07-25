# 오늘,우리는

커플 장소 기록 앱 — Claude Design 프로토타입(`오늘우리는 프로토타입.dc.html`)을
Vite + React로 구현한 402×874 모바일 기준 웹앱.

```bash
npm install
npm run dev   # http://localhost:5173
```

## 구조

```
design-assets/          디자인 에셋 (README.md 주의사항 참고 — SpringStar는 lazy import)
  svg/                  Figma 원본 SVG 18개 + index.js (URL·실측 크기) — 코드에서 쓸 것
  icons/                일러스트 JSX 컴포넌트 (손그림 재구성분, svg/로 교체 중)
  images/               복원된 원본 아트 (WebP)
scripts/
  import-figma-svg.mjs  Figma SVG 재이관 (npm run svg:import)
  verify-svg.mjs        이관 결과 검증 (npm run svg:verify)
src/
  styles/tokens.js      색·폰트·계절 테마 디자인 토큰 (하드코딩 금지, 단일 소스)
  data/
    fixtures.js         mock 초기 데이터 (프로토타입 데모 내용과 동일)
    api.js              데이터 접근 함수 — 백엔드 연동 시 이 파일 내부만 교체
    store.jsx           React Context 전역 상태 (useApp)
    format.js           프로토타입 표기 형식의 날짜 헬퍼
  components/
    MapView.jsx         지도 어댑터 — 카카오맵/네이버맵 교체 지점 (인터페이스 유지)
    PlaceDetail.jsx     장소 상세 (season prop: spring/summer/autumn/winter)
    FlowerPickSheet.jsx 꽃갈피 선택 바텀시트 (selected state)
    Placeholder.jsx     이미지 업로드 전 자리 (히어로/사용자 사진)
  screens/              라우트별 화면 11개
```

## 라우트 / 플로우

| 경로 | 화면 |
| --- | --- |
| `/onboarding` | 소개 (시작하기 / 초대코드 두 갈래) |
| `/onboarding/code` | 초대 코드 입력 → 이름 → 홈 |
| `/onboarding/name` | 이름 입력 |
| `/onboarding/share` | 내 초대 코드 공유 → 홈 |
| `/` | 홈 (캐러셀: 진행 중 기록 + 빈 카드→지도) |
| `/map` | 지도(장소 선택) — MapView 플레이스홀더 |
| `/record` | 5초 기록 (state: placeId 또는 recordId) |
| `/pick` | 꽃갈피 선택 (확정 시 홈→상세로 스택 재구성) |
| `/place/:recordId` | 장소 상세 (› 로 계절 순환) |
| `/place/:recordId/edit` | 기록 수정 |
| `/mypage` | 마이페이지 |

- 상단 59px safe area는 프로토타입 좌표에 반영돼 있음.
- mock DB는 in-memory — 새로고침하면 온보딩부터 다시 시작.
