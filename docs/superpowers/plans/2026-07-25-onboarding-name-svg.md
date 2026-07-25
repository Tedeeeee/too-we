# Onboarding Name SVG Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 참고 이미지의 장미·연필 SVG를 온보딩 이름 입력 화면에 원본 비율로 적용한다.

**Architecture:** 기존 `WritingIllust` JSX 근사 아이콘을 제거하고 이미 등록된
`onboardingSvg.name` URL을 `<img>`로 렌더링한다. 데이터 흐름은 건드리지 않고
에셋 import와 상단 배치만 교체한다.

**Tech Stack:** React 19, Vite 7 SVG URL imports, Node.js verification script, Edge headless screenshot

---

### Task 1: 화면 SVG 연결 계약 검증

**Files:**
- Create: `scripts/verify-svg-usage.mjs`
- Modify: `package.json`

- [ ] **Step 1: 실패 검증을 작성한다**

`src/screens/OnboardingName.jsx`가 아래 조건을 만족하는지 검사한다.

```text
required: import { onboardingSvg } from '@assets/svg'
required: src={onboardingSvg.name}
required: width: 258
required: height: 172
forbidden: WritingIllust
```

`package.json`에 `svg:verify-usage` 명령을 추가한다.

- [ ] **Step 2: 검증이 기존 아이콘 때문에 실패하는지 확인한다**

Run: `npm run svg:verify-usage`

Expected: `onboardingSvg.name` 연결 누락과 `WritingIllust` 잔존으로 실패.

### Task 2: 온보딩 이름 입력 일러스트 교체

**Files:**
- Modify: `src/screens/OnboardingName.jsx`

- [ ] **Step 1: 구형 아이콘 import를 교체한다**

```jsx
import { onboardingSvg } from '@assets/svg';
```

- [ ] **Step 2: 상단 일러스트를 원본 비율로 렌더링한다**

```jsx
<img
  src={onboardingSvg.name}
  width={258}
  height={172}
  alt=""
  style={{ display: 'block' }}
/>
```

컨테이너는 `left: 72`, `top: 98`, `width: 258`, `height: 172`를 사용한다.

- [ ] **Step 3: 연결 계약 검증을 통과시킨다**

Run: `npm run svg:verify-usage`

Expected: 실패 0개.

### Task 3: 전체 및 시각 검증

**Files:**
- Verify: `design-assets/svg/onboarding/name.svg`
- Verify: `src/screens/OnboardingName.jsx`

- [ ] **Step 1: SVG 구조 검증을 실행한다**

Run: `npm run svg:verify`

Expected: 45개 파일, 실패 0개.

- [ ] **Step 2: 앱 빌드를 실행한다**

Run: `npm run build`

Expected: Vite exit code 0.

- [ ] **Step 3: 이름 입력 화면을 캡처한다**

Vite 개발 서버를 실행하고 Edge headless로
`http://127.0.0.1:5173/onboarding/name`을 402×874 PNG로 저장한다.

- [ ] **Step 4: 캡처를 참고 이미지와 비교한다**

원본 비율, 화면 중앙 정렬, 제목과의 간격, 잘림 여부를 육안으로 확인한다.
저장소 지침에 따라 커밋과 푸시는 하지 않는다.
