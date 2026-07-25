# UI SVG Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 다운로드 폴더의 24×24 SVG 29개를 기존 Figma SVG 에셋 체계에 등록한다.

**Architecture:** 일반 아이콘 27개는 `design-assets/svg/ui/`로 분리하고, 이름이
겹치는 `pencil.svg`와 `schedule.svg`는 `design-assets/svg/etc/`의 기존 파일을
덮어쓴다. 중앙 `design-assets/svg/index.js`가 전체 아이콘 URL과 실측 크기를
내보내며 기존 `etcSvg` 인터페이스도 유지한다.

**Tech Stack:** SVG, Vite 7 asset imports, JavaScript ES modules, Node.js verification scripts

---

### Task 1: SVG 원본 배치

**Files:**
- Create: `scripts/verify-ui-svg.mjs`
- Modify: `package.json`
- Create: `design-assets/svg/ui/*.svg` 27개
- Replace: `design-assets/svg/etc/pencil.svg`
- Replace: `design-assets/svg/etc/schedule.svg`

- [ ] **Step 1: 29개 등록 계약을 검사하는 테스트를 작성한다**

`scripts/verify-ui-svg.mjs`에 아래 원본→대상 매핑을 선언하고, 각 대상 파일의 존재,
24×24 `viewBox`, `index.js` import, `uiSvg` key 포함 여부를 검사한다.
`package.json`에 `svg:verify-ui` 명령을 추가한다.

`C:\Users\gksmf\Downloads\icon\icon`에서 다음처럼 복사한다.

```text
camera.svg                         -> ui/camera.svg
cancle.svg                         -> ui/cancelCircle.svg
cancle2.svg                        -> ui/cancel.svg
circle.svg                         -> ui/circle.svg
Expand_down.svg                    -> ui/expandDown.svg
Expand_left.svg                    -> ui/expandLeft.svg
Expand_right.svg                   -> ui/expandRight.svg
Expand_up.svg                      -> ui/expandUp.svg
heart.svg                          -> ui/heart.svg
home.svg                           -> ui/homeSketch.svg
icon_callender_24.svg              -> ui/calendar.svg
icon_crew_24.svg                   -> ui/crew.svg
icon_home_24.svg                   -> ui/home.svg
icon_log_24.svg                    -> ui/log.svg
icon_minus_24.svg                  -> ui/minus.svg
icon_mypage_24.svg                 -> ui/myPage.svg
icon_people_24.svg                 -> ui/people.svg
icon_plus_24.svg                   -> ui/plus.svg
map1.svg                           -> ui/mapSketch.svg
plus.svg                           -> ui/plusSketch.svg
profile.svg                        -> ui/profile.svg
Property 1=icon_down_24.svg        -> ui/arrowDown.svg
Property 1=icon_left_24.svg        -> ui/arrowLeft.svg
Property 1=icon_right_24.svg       -> ui/arrowRight.svg
Property 1=icon_up_24.svg          -> ui/arrowUp.svg
Search_light.svg                   -> ui/search.svg
time.svg                           -> ui/time.svg
pencil.svg                         -> etc/pencil.svg
schedule.svg                       -> etc/schedule.svg
```

- [ ] **Step 2: 테스트가 올바른 이유로 실패하는지 확인한다**

Run: `npm run svg:verify-ui`

Expected: `ui/` 대상 파일과 `uiSvg`가 아직 없어 실패한다.

- [ ] **Step 3: 파일을 복사한다**

내용 변환 없이 바이트 그대로 복사하며, 두 충돌 파일은 명시적으로 덮어쓴다.

- [ ] **Step 4: 원본과 대상 해시를 대조한다**

각 매핑의 SHA-256이 같고 대상 SVG가 총 45개인지 확인한다.

- [ ] **Step 5: 등록 테스트가 중앙 export 누락으로 계속 실패하는지 확인한다**

Run: `npm run svg:verify-ui`

Expected: 파일 검사는 통과하지만 `index.js` import와 `uiSvg` 누락으로 실패한다.

### Task 2: 중앙 export 및 크기 등록

**Files:**
- Modify: `design-assets/svg/index.js`
- Modify: `design-assets/README.md`

- [ ] **Step 1: `design-assets/svg/index.js`에 URL import를 추가한다**

27개 `ui/` 파일과 `etc/pencil.svg`, `etc/schedule.svg`를 import한다.

- [ ] **Step 2: `uiSvg` 객체를 export한다**

```js
export const uiSvg = {
  camera,
  cancelCircle,
  cancel,
  circle,
  expandDown,
  expandLeft,
  expandRight,
  expandUp,
  heart,
  homeSketch,
  calendar,
  crew,
  home,
  log,
  minus,
  myPage,
  people,
  plus,
  mapSketch,
  pencil,
  plusSketch,
  profile,
  arrowDown,
  arrowLeft,
  arrowRight,
  arrowUp,
  schedule,
  search,
  time,
};
```

- [ ] **Step 3: `svgSize`를 갱신한다**

새 key 27개를 모두 `{ width: 24, height: 24 }`로 추가하고 기존
`schedule`을 32×32에서 24×24로 변경한다. `pencil`은 기존 24×24 선언을 유지한다.

- [ ] **Step 4: 에셋 문서를 갱신한다**

`uiSvg` 사용 예시, 29개 24×24 아이콘, 충돌 파일 교체 사실을 기록한다.

- [ ] **Step 5: 등록 테스트가 통과하는지 확인한다**

Run: `npm run svg:verify-ui`

Expected: `29개 UI SVG, 실패 0개`

### Task 3: 구조·import·앱 빌드 검증

**Files:**
- Verify: `design-assets/svg/**/*.svg`
- Verify: `design-assets/svg/index.js`

- [ ] **Step 1: SVG 구조와 크기를 검증한다**

Run: `npm run svg:verify`

Expected: `45개 파일, 실패 0개`

- [ ] **Step 2: 중앙 SVG 모듈을 Vite로 직접 번들링한다**

Run:

```powershell
node --input-type=module -e "import { build } from 'vite'; await build({ configFile: 'vite.config.js', build: { write: false, emptyOutDir: false, rollupOptions: { input: 'design-assets/svg/index.js' } } });"
```

Expected: Vite build exit code 0 and all SVG import paths resolve.

- [ ] **Step 3: 앱 프로덕션 빌드를 검증한다**

Run: `npm run build`

Expected: Vite build exit code 0.

- [ ] **Step 4: 변경 범위를 확인한다**

Run: `git status --short`

Expected: 저장소가 첫 커밋 전이라 개별 교체 diff는 표시되지 않지만 모든 작업 파일이
untracked 상태로 유지된다. 실제 추가·교체 여부는 앞선 개수 및 해시 검증으로 확인한다.
저장소 지침에 따라 커밋과 푸시는 하지 않는다.
