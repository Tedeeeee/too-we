# design-assets — "오늘,우리는" 디자인 에셋

앱 코드는 `@assets` alias로 참조한다.

```js
import { RoseIllust, BouquetIllust } from '@assets/icons';   // 손그림 재구성 (구버전)
import { flowerSvg, svgSize } from '@assets/svg';             // Figma 원본 (권장)
import { uiSvg } from '@assets/svg';                          // 공통 24×24 UI 아이콘
```

## svg/ — Figma 원본 (2026-07-25 이관)

`C:\couple\product\couple-place-diary` (Next.js 프로젝트)에서 가져왔다. 그쪽은 Figma
개인 액세스 토큰으로 직접 익스포트한 것이라 **이 SVG들이 디자인 원본**이다.
`icons/`의 손그림 재구성분보다 항상 이쪽이 우선한다.

`svg/index.js`가 URL과 실측 크기를 함께 내보낸다. 이 앱은 402×874 캔버스에 절대 좌표로
배치하므로 비율이 깨지지 않게 `svgSize` / `scaleToHeight()`를 쓸 것.

### flowers/ — 꽃갈피 7종 (각 67×91)

`rose` `marigold` `calla` `clover` `forgetmenot` `lilac` `jasmine`
— key가 `src/data/fixtures.js`의 `FLOWERS` key와 1:1로 일치한다.

원본 파일명이 달라서 이관할 때 재매핑했다:

| 원본 | 이관 후 | 이유 |
| --- | --- | --- |
| `Calendula.svg` | `marigold.svg` | 금잔화 = Calendula, fixtures key는 `marigold` |
| `Calla Lily.svg` | `calla.svg` | 공백이 URL에서 `%20`으로 깨짐 |
| `Forget-me-not.svg` | `forgetmenot.svg` | fixtures key 표기 |
| `Jasmine.svg` | `jasmine.svg` | 소문자 통일 |

`flowers.svg`(59×90)는 꽃갈피 7종이 아니라 **여러 송이가 함께 그려진 묶음 일러스트**다.
`flowersIllustSvg`로 따로 내보낸다.

### onboarding/ · etc/

| 파일 | 크기 | 원본 프로젝트에서의 용도 | couple2 대응 |
| --- | --- | --- | --- |
| `onboarding/rose-head.svg` | 90×93 | 온보딩1 인트로 장미 | `RoseIllust` |
| `onboarding/letter.svg` | 139×105 | 온보딩2 초대코드 편지봉투 | `EnvelopeIllust` |
| `onboarding/name.svg` | 258×172 | 온보딩3 이름 입력 | `WritingIllust` |
| `onboarding/note1.svg` | 325×456 | 온보딩4 초대 공유 노트 | `OnboardingShare` 카드 |
| `onboarding/note2.svg` | 382×279 | (원본에서 미사용) | — |
| `onboarding/note2-2.svg` | 382×312 | 홈 "오늘 기록" 노트 | `RecordCard` 배경 |
| `flowers/flowers.svg` | 59×90 | 온보딩4 공유 화면 꽃 일러스트 | `BouquetIllust` |
| `etc/flower-blank.svg` | 92×124 | 홈 — 아직 안 쓴 빈 꽃갈피 자리 | `BalloonSketch` 자리 |
| `etc/sticker.svg` | 65×30 | 홈 "오늘 기록" 스티커 | — |
| `etc/pencil.svg` | 24×24 | (원본에서 미사용) | 수정 `✎` 아이콘 |
| `etc/schedule.svg` | 24×24 | 공통 일정 아이콘 | `uiSvg.schedule` |
| `etc/schedule-color.svg` | 32×32 | 컬러 캘린더 (하늘색 본체 `#C8E2F2`) | 홈 "n월의 기록" 헤더 — `etcSvg.scheduleColor` |
| `etc/scape.svg` | 92×92 | 풍경 일러스트 (하늘색 라운드 사각 `#C8E1F2`, rx 10.857) | 사진 업로드 전 카드 썸네일 — `etcSvg.scape` |

`scape.svg`는 98KB로 현재 가장 큰 에셋이다(gzip 30KB). 순수 벡터이고 한 파일을 카드
여러 장이 공유하므로 다운로드는 한 번뿐이다. **배경 사각형과 라운드가 SVG 안에 이미
있으니 `background`/`borderRadius`를 따로 주지 말 것.** 104px로 렌더하면 rx가
10.857 × 104/92 ≈ 12.3이 되어 카드 radius 12와 자연스럽게 맞는다.

### ui/ — 공통 24×24 아이콘

`C:\Users\gksmf\Downloads\icon\icon`에서 가져온 29개 UI 아이콘을
`uiSvg` 객체로 내보낸다. 일반 아이콘 27개는 `svg/ui/`에 있으며, 기존 이름과
겹친 `pencil.svg`, `schedule.svg`는 새 24×24 원본으로 교체해 `svg/etc/`에
유지한다. 두 아이콘은 이전처럼 `etcSvg`에서도 사용할 수 있다.

```jsx
import { uiSvg, svgSize } from '@assets/svg';

<img src={uiSvg.camera} {...svgSize.camera} alt="" />
```

원본 파일의 `cancle`, `callender`, `Property 1=...` 같은 이름은 코드에서
쓰기 쉬운 `cancel`, `calendar`, `arrow*` key로 정리했다. 손그림 변형은
`homeSketch`, `mapSketch`, `plusSketch`로 구분한다.

### 이관 중 제거한 것 — base64 텍스처

원본 SVG 10개(꽃 8 + `flower-blank` + `sticker`)에 **동일한 390×582 PNG**가 base64로
박혀 있었다. 파일당 342,801바이트, md5 전부 일치 — 즉 3.43MB가 같은 이미지의 중복이었다.

이 텍스처는 하단 마스킹테이프 띠에 `mix-blend-mode: screen`으로 얹히는 종이 질감인데,
`pattern`이 413×617 박스를 채우고 `clipPath`가 **28.5×8.2px**만 남긴다. 계산하면 390×582
이미지 중 **(112,267)에서 27×8px 크롭**만 실제로 보인다. 216픽셀을 위해 257KB였던 셈.

그래서 텍스처 노드(`<image>` / `<pattern>` / pattern으로 채운 `rect`)만 제거했다.
**테이프 띠 자체는 벡터(`fill="#AC8641"`)로 그대로 남아 있다.** 사라진 건 그 띠 위의
미세한 그레인뿐이다. 결과: **3.87MB → 435KB (11.2%)**.

원본 텍스처는 `images/paper-texture.png`로 보존해 뒀다(어디서도 import하지 않으므로
번들에는 안 들어간다). 그레인까지 되살리고 싶으면 위 좌표로 크롭해서 쓰면 된다.

## images/ (WebP)

| 파일 | 크기(논리px) | 출처 |
| --- | --- | --- |
| `rose.webp` | 96×96 | 디자인 PNG(온보딩1)에서 @2x 복원한 원본 장미 일러스트 |
| `rose-tight.webp` | 44×44 | 홈 헤더용 꽉 찬 크롭 (디자인 PNG 홈 화면에서 복원) |
| `bouquet.webp` | 110×112 | 디자인 PNG(온보딩4)에서 @2x 복원한 원본 꽃다발 일러스트 |
| `paper-texture.png` | 390×582 | Figma 종이 질감 원본 — 위 참고, 현재 미사용 |

- WebP는 배경이 크림색(#F1EAE0/#FFFCF4)으로 구워져 있으므로 크림 계열 표면 위에서만 사용.

## icons/ (JSX 컴포넌트) — 손그림 재구성분

`svg/`가 들어오기 전, 디자인 PNG 상단 15%만 복원 가능했던 시절에 만든 것들이다.
표시된 것들은 이제 Figma 원본으로 교체 가능하다.

| 컴포넌트 | 용도 | 상태 |
| --- | --- | --- |
| `RoseIllust` | 온보딩1 타이틀 옆 / 홈 헤더 장미 | `rose.webp` 래퍼 — `onboarding/rose-head.svg`로 교체 가능 |
| `BouquetIllust` | 온보딩4 초대 카드 꽃다발 | `bouquet.webp` 래퍼 — `flowers/flowers.svg`로 교체 가능 |
| `BalloonSketch` | 홈 캐러셀 점선 풍선 스케치 | SVG 재구성 — `etc/flower-blank.svg` 검토 |
| `EnvelopeIllust` | 온보딩2 편지봉투 | **SVG 재구성 — `onboarding/letter.svg`로 교체할 것** |
| `WritingIllust` | 온보딩3 장미·연필 | **합성 재구성 — `onboarding/name.svg`로 교체할 것** |
| `PressedFlower` | 꽃갈피 압화 7종 | **타원 근사 — `flowerSvg[key]`로 교체할 것** |
| `SpringStar` | 봄 시즌 장식 반짝이 | 원본 없음, 유지 |

교체 시 크기 주의 — 재구성분과 원본의 비율이 다르다. 예: `EnvelopeIllust`는 140×95(1.47)로
쓰이지만 `letter.svg`는 139×105(1.32)다. 그대로 넣으면 세로가 눌린다.

## 주의사항

- **SpringStar는 반드시 lazy import** 할 것 (장식 요소라 초기 번들에서 제외):

  ```js
  const SpringStar = lazy(() => import('@assets/icons/SpringStar'));
  // <Suspense fallback={null}><SpringStar /></Suspense>
  ```

- `icons/index.js`는 SpringStar를 재수출하지 않는다(위 규칙 강제).
- 계절 히어로 이미지·사용자 사진은 에셋이 아니라 업로드 대상 —
  `src/components/Placeholder.jsx`를 그대로 둘 것.
- 참고: 원본 프로젝트의 온보딩 배경 그라디언트 (Figma 값, 아직 미적용)

  ```css
  radial-gradient(55.6% 79.84% at 94.42% 12.29%, rgba(255,244,172,.40) 0%, rgba(243,249,255,.40) 100%),
  radial-gradient(41.89% 45.6% at 18.79% 78.32%, rgba(134,167,34,.20) 0%, rgba(243,249,255,.20) 100%),
  #F1EAE0
  ```
