# Onboarding Code SVG Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 참고 이미지의 편지봉투 SVG를 초대코드 입력 화면에 원본 비율로 적용한다.

**Architecture:** 기존 화면 SVG 사용 검증에 `OnboardingCode` 계약을 추가한 뒤,
`EnvelopeIllust`를 등록된 `onboardingSvg.letter` URL 이미지로 교체한다.
인증 및 코드 입력 동작은 변경하지 않는다.

**Tech Stack:** React 19, Vite 7 SVG URL imports, Node.js verification script, Edge headless screenshot

---

### Task 1: 초대코드 화면 SVG 연결 계약

**Files:**
- Modify: `scripts/verify-svg-usage.mjs`

- [ ] `OnboardingCode.jsx`에서 `onboardingSvg.letter`, 139×105, `EnvelopeIllust`
  제거를 검사하는 항목을 추가한다.
- [ ] `npm run svg:verify-usage`가 새 5개 항목 때문에 실패하는지 확인한다.

### Task 2: 편지봉투 일러스트 교체

**Files:**
- Modify: `src/screens/OnboardingCode.jsx`

- [ ] `EnvelopeIllust` import를 `onboardingSvg` import로 교체한다.
- [ ] 상단 일러스트를 `left:132`, `top:150`, `139×105`의 장식 `<img>`로 교체한다.
- [ ] `npm run svg:verify-usage`가 전체 10개 검사에서 실패 0개인지 확인한다.

### Task 3: 전체 및 시각 검증

**Files:**
- Verify: `design-assets/svg/onboarding/letter.svg`
- Verify: `src/screens/OnboardingCode.jsx`

- [ ] `npm run svg:verify`가 45개 파일, 실패 0개인지 확인한다.
- [ ] `npm run build`가 exit code 0인지 확인한다.
- [ ] `/onboarding/code`를 캡처해 원본 비율, 중앙 정렬, 제목 간격을 비교한다.
- [ ] 개발 서버를 종료하고 커밋·푸시 없이 현재 작업 상태를 유지한다.
