# UI SVG 등록 설계

## 목표

`C:\Users\gksmf\Downloads\icon\icon`의 24×24 SVG 29개를 기존 Figma SVG
에셋 체계에 등록한다. SVG 원본 내용과 `viewBox`는 변경하지 않는다.

## 구조

- 일반 UI 아이콘 27개는 `design-assets/svg/ui/`에 의미가 분명한 camelCase
  파일명으로 복사한다.
- 기존 파일과 이름이 겹치는 `pencil.svg`, `schedule.svg`는 사용자 요청에 따라
  `design-assets/svg/etc/`의 파일을 새 원본으로 덮어쓴다.
- `design-assets/svg/index.js`에서 모든 29개를 `uiSvg` 객체로 내보낸다.
- `pencil`, `schedule`은 기존 `etcSvg`에서도 계속 접근할 수 있게 하여 기존
  인터페이스를 보존한다.
- 모든 아이콘의 실측 크기 24×24를 `svgSize`에 등록한다. 덮어쓴 `schedule`은
  기존 32×32 선언을 24×24로 갱신한다.

## 파일명 정리

Figma에서 생성된 오타와 속성형 파일명은 import하기 쉬운 이름으로 바꾼다.

- `cancle.svg` → `cancelCircle.svg`
- `cancle2.svg` → `cancel.svg`
- `Expand_*.svg` → `expand*.svg`
- `Property 1=icon_*_24.svg` → `arrow*.svg`
- `icon_callender_24.svg` → `calendar.svg`
- `home.svg`, `map1.svg`, `plus.svg`의 손그림 버전은 각각
  `homeSketch.svg`, `mapSketch.svg`, `plusSketch.svg`
- `icon_home_24.svg`, `icon_plus_24.svg`는 `home.svg`, `plus.svg`
- 나머지는 접두사와 `_24`를 제거한 의미 이름을 사용한다.

## 검증

1. 다운로드 원본과 등록 파일의 개수 및 해시를 대조한다.
2. `npm run svg:verify`로 태그 균형, 참조, base64, `svgSize`를 검사한다.
3. 임시 Vite 진입점 없이도 실제 앱에서 import 해석이 검증되도록
   `src`에서 사용하는 중앙 모듈의 문법과 모든 대상 경로를 확인한다.
4. `npm run build`를 실행한다.

## 범위 밖

이번 작업은 에셋 등록까지만 수행한다. 기존 화면의 JSX 아이콘을 새 SVG로
교체하는 작업은 포함하지 않는다.
