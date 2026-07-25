# 마이페이지 레퍼런스 정합 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 마이페이지를 제공된 402px 모바일 레퍼런스와 같은 시각적 위계로 정리하면서 기존 데이터와 수정 동작을 유지한다.

**Architecture:** 기존 `MyPage` 화면 안에서 데이터 로딩과 수정 시트 연결은 그대로 두고, 본문을 기준 좌표에 맞춘 절대 배치로 단순화한다. 흰 배경을 포함한 기존 하트는 유지하고 마이페이지 전용 무배경 하트 SVG를 별도 등록한다.

**Tech Stack:** React 19, React Router, Vite, 인라인 스타일, 정적 SVG 레지스트리, Node 기반 소스 계약 검증

---

### Task 1: 마이페이지 시각 계약 추가

**Files:**
- Modify: `scripts/verify-svg-usage.mjs`
- Test: `scripts/verify-svg-usage.mjs`

- [ ] **Step 1: 실패하는 검증 조건 작성**

  `MyPage.jsx`와 SVG 레지스트리를 읽고 다음을 검사한다.

  - 마이페이지가 `uiSvg.heartFilled`를 사용한다.
  - 마이페이지가 기존 `uiSvg.heart`를 사용하지 않는다.
  - 프로필에 `data-profile-blob` 표식이 두 개 있다.
  - D-day 강조가 `palette.olive`를 사용한다.
  - 설정 행이 `left: 2`, `width: 398` 계약을 사용한다.
  - 연결 해제가 `data-disconnect` 평면 버튼이다.
  - `data-home-indicator`가 있다.
  - SVG 레지스트리에 `heartFilled`와 24×24 크기가 등록된다.

- [ ] **Step 2: 검증 실패 확인**

Run: `npm run svg:verify-usage`

Expected: 마이페이지 및 `heartFilled` 관련 새 조건이 FAIL.

### Task 2: 무배경 채움 하트 SVG 등록

**Files:**
- Create: `design-assets/svg/ui/heartFilled.svg`
- Modify: `design-assets/svg/index.js`

- [ ] **Step 1: 배경 없는 24×24 SVG 생성**

  기존 하트의 경로만 재사용하고 사각형 배경은 포함하지 않는다.

- [ ] **Step 2: 중앙 레지스트리 등록**

  `uiSvg.heartFilled`와 `svgSize.heartFilled`를 추가한다.

- [ ] **Step 3: SVG 자체 검증**

Run: `npm run svg:verify && npm run svg:verify-ui`

Expected: 두 명령 모두 성공하고 신규 UI SVG를 등록된 자산으로 인식.

### Task 3: 마이페이지 레이아웃 구현

**Files:**
- Modify: `src/screens/MyPage.jsx`

- [ ] **Step 1: 프로필과 헤더 단순화**

  큰 카드 및 카드 그림자를 제거한다. 상단 중앙 제목, 96px 파란 프로필 도형 두 개, `uiSvg.heartFilled`를 독립 배치한다.

- [ ] **Step 2: 문구와 수정 버튼 배치**

  함께한 기간 문구를 가운데 정렬하고 `+N`만 올리브색으로 표시한다. 기존 수정 시트 열기 동작은 유지한다.

- [ ] **Step 3: 설정과 하단 요소 배치**

  설정 행을 좌측 2px, 폭 398px로 확장한다. 연결 해제를 흐린 우측 텍스트 버튼으로 바꾸고 하단 홈 인디케이터를 추가한다.

- [ ] **Step 4: 데이터 및 동작 보존 확인**

  사용자 이름, 상대 이름, D-day, 위시리스트 수, 기록 알림 값과 기존 탐색/수정 동작이 계속 상태에서 파생되는지 확인한다.

- [ ] **Step 5: 사용 계약 검증**

Run: `npm run svg:verify-usage`

Expected: 모든 화면 SVG 사용 검증이 PASS.

### Task 4: 통합 및 시각 검증

**Files:**
- Verify: `src/screens/MyPage.jsx`
- Verify: `design-assets/svg/ui/heartFilled.svg`
- Verify: `design-assets/svg/index.js`

- [ ] **Step 1: 전체 정적 검증**

Run: `npm run svg:verify && npm run svg:verify-ui && npm run svg:verify-usage`

Expected: 모든 검증이 exit code 0.

- [ ] **Step 2: 프로덕션 빌드**

Run: `npm run build`

Expected: Vite 빌드 성공, 오류 없음.

- [ ] **Step 3: 402×874 화면 확인**

  실행 중인 개발 화면 `/mypage`에서 다음을 확인한다.

  - 하트가 사각형 없이 작은 빨간 하트로 보인다.
  - 프로필 도형 두 개에 문자와 테두리가 없다.
  - 설정 행이 화면 가장자리 가까이 확장된다.
  - 연결 해제가 카드 없이 흐린 텍스트로 보인다.
  - 홈 인디케이터가 실제 화면 하단에 고정된다.

### Task 5: Orca 모바일 패널 오버플로 방지

**Files:**
- Create: `scripts/verify-responsive-canvas.mjs`
- Modify: `package.json`
- Modify: `src/App.jsx`

- [ ] **Step 1: 실패하는 반응형 계약 작성**

  모바일 캔버스 배율이 뷰포트의 폭 비율과 높이 비율 중 작은 값을 사용하고, 402×874를 넘지 않는지 검사한다.

- [ ] **Step 2: 현재 폭 전용 배율에서 실패 확인**

Run: `npm run ui:verify-responsive`

Expected: 높이 비율을 사용하지 않아 FAIL.

- [ ] **Step 3: 배율 계산의 근본 원인 수정**

  `window.innerHeight`를 함께 읽고 `Math.min(vw / layout.width, vh / layout.height)`를 사용한다.

- [ ] **Step 4: 계약과 실화면 재검증**

Run: `npm run ui:verify-responsive`

Expected: PASS. 427×920 Orca 패널에서 가로·세로 스크롤바가 사라진다.

> 저장소 규칙에 따라 사용자가 요청하지 않은 커밋은 만들지 않는다.
