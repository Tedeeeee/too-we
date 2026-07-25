# 홈 상단 히어로 개편 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 새 레퍼런스에 맞춰 홈 헤더와 대기 기록 캐러셀을 재배치하고 CTA 문구와 자산 색상을 갱신한다.

**Architecture:** 기존 `Home`의 데이터 계산과 하단 월별 기록 구조는 유지한다. 상단 좌표와 캐러셀 카드 규격만 402px 모바일 캔버스에 맞춰 교체하고, 기존 중앙 SVG 레지스트리는 변경하지 않은 채 `sticker.svg`의 색상과 동적 날짜 라벨을 적용한다.

**Tech Stack:** React 19, Vite, 인라인 스타일, 정적 SVG, Node 소스 계약 검증

---

### Task 1: 홈 레퍼런스 계약 추가

**Files:**
- Modify: `scripts/verify-svg-usage.mjs`
- Test: `scripts/verify-svg-usage.mjs`

- [x] **Step 1: 실패하는 홈 계약 작성**

  다음 조건을 검사한다.

  - 헤더 설명 문구가 제거된다.
  - 캐러셀 상단이 80px이다.
  - 아이템은 348×228px이고 간격은 12px이다.
  - 스크롤 단계는 360px이다.
  - `note2b`는 382×242px, 좌측 -17px, 상단 -8px, 가로 배율 1.22이다.
  - CTA가 `꽃갈피를 남겨주세요`이며 필기체와 22px 연필을 사용한다.
  - 대기 보조 문구가 제거된다.

- [x] **Step 2: 현재 구현에서 실패 확인**

Run: `npm run svg:verify-usage`

Expected: 새 홈 계약이 기존 좌표와 문구 때문에 FAIL.

### Task 2: 홈 헤더와 캐러셀 구현

**Files:**
- Modify: `src/screens/Home.jsx`

- [x] **Step 1: 헤더 이동 및 설명 제거**

  로고·제목·프로필을 상단으로 이동하고 기존 설명 문구 JSX를 삭제한다.

- [x] **Step 2: 캐러셀 프레임 교체**

  헤더·프로필·캐러셀·도트·월별 목록을 함께 16px 내리고, 캐러셀은 상단 80px, 좌측 패딩 24px, 카드 348×228px, 간격 12px, 스크롤 단계 360px을 적용한다.

- [x] **Step 3: 종이 SVG 배치**

  대기 카드와 빈 카드 모두 `note2b`를 382×242px로 렌더링하고 `left: -17`, `top: -8`, `scaleX(1.22)`로 배치한다.

- [x] **Step 4: 카드 내용과 CTA 갱신**

  기존 데이터와 SVG를 유지하면서 CTA를 필기체 `꽃갈피를 남겨주세요`로 바꾸고 대기 보조 문구를 제거한다.

- [x] **Step 5: 하단 연결 위치 조정**

  캐러셀 점과 월별 기록 영역을 새 카드 아래로 이동한다.

- [x] **Step 6: 홈 계약 통과 확인**

Run: `npm run svg:verify-usage`

Expected: 모든 화면 SVG 사용 검증이 PASS.

### Task 3: 날짜 스티커 색상 갱신

**Files:**
- Modify: `design-assets/svg/etc/sticker.svg`

- [x] **Step 1: 스티커 바탕색 변경**

  배경 사각형의 `#DF3633`을 레퍼런스 연분홍색 `#F7CEC6`으로 변경하고 글자 경로 색상은 유지한다.

- [x] **Step 2: SVG 검증**

Run: `npm run svg:verify`

Expected: 52개 SVG 파일, 실패 0개.

### Task 4: 통합 및 실화면 검증

**Files:**
- Verify: `src/screens/Home.jsx`
- Verify: `design-assets/svg/etc/sticker.svg`

- [ ] **Step 1: 전체 자동 검증**

Run: `npm run svg:verify && npm run svg:verify-ui && npm run svg:verify-usage && npm run ui:verify-responsive`

Expected: 모든 검증이 exit code 0.

- [ ] **Step 2: 프로덕션 빌드**

Run: `npm run build`

Expected: Vite 빌드 성공.

- [ ] **Step 3: Orca 실화면 확인**

  홈 화면에서 헤더 설명 제거, 상단 헤더, 카드 외곽, 다음 카드 노출, 연분홍 스티커, 새 CTA와 월별 기록 연결을 확인한다.

> 저장소 규칙에 따라 사용자가 요청하지 않은 커밋은 만들지 않는다.
