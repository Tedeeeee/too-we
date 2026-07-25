# 온보딩 이름 입력 SVG 교체 설계

## 목표

참고 이미지의 장미·연필 일러스트를 `/onboarding/name` 화면에 적용한다.

## 적용

- `src/screens/OnboardingName.jsx`의 구형 `WritingIllust` JSX 컴포넌트를 제거한다.
- `@assets/svg`의 `onboardingSvg.name`을 `<img>`로 렌더링한다.
- 원본 `name.svg`의 258×172 비율을 그대로 사용한다.
- 402px 캔버스 중앙인 `left: 72px`, 기존 세로 기준인 `top: 98px`에 배치한다.
- 장식 이미지이므로 `alt=""`와 `display: block`을 지정한다.
- 제목, 설명, 이름 입력 및 버튼 위치는 변경하지 않는다.

## 검증

- `OnboardingName.jsx`에서 `WritingIllust` 참조가 제거됐는지 확인한다.
- SVG 등록 검증과 앱 프로덕션 빌드를 실행한다.
- `/onboarding/name` 화면을 402×874로 캡처해 원본 비율, 중앙 정렬,
  제목과의 간격을 참고 이미지와 비교한다.
