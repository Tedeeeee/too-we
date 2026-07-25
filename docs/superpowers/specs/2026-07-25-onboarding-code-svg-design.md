# 온보딩 초대코드 SVG 교체 설계

## 목표

참고 이미지의 편지봉투 일러스트를 `/onboarding/code` 화면에 적용한다.

## 적용

- `src/screens/OnboardingCode.jsx`의 구형 `EnvelopeIllust`를 제거한다.
- `@assets/svg`의 `onboardingSvg.letter`를 `<img>`로 렌더링한다.
- 원본 `letter.svg`의 139×105 비율을 그대로 사용한다.
- 402px 캔버스 중앙인 `left: 132px`, 기존 세로 기준인 `top: 150px`에 배치한다.
- 장식 이미지이므로 `alt=""`와 `display: block`을 지정한다.
- 제목, 설명, 코드 입력 및 버튼 위치는 변경하지 않는다.

## 검증

- 화면 SVG 사용 검증에 `OnboardingCode` 계약을 먼저 추가해 실패를 확인한다.
- 교체 후 화면 사용 검증, 전체 SVG 검증과 앱 빌드를 실행한다.
- `/onboarding/code` 화면을 캡처해 비율, 중앙 정렬, 제목과의 간격을 비교한다.
