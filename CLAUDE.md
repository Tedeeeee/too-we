# 오늘,우리는 — 작업 지침

커플 장소 기록 앱. 402×874 모바일 웹앱, Vite + React 19 + react-router 7.
화면 구조·라우트 표는 `README.md`, 에셋 상세는 `design-assets/README.md` 참고.

## Orca 작업 역할

- **Claude는 구현 작업자다.** 배정받은 worktree에서 기능 코드, 테스트, 마이그레이션을 작성하고 검증한 뒤 커밋한다.
- **Codex는 코디네이터·리뷰어·통합 담당자다.** 작업 DAG와 의존성을 관리하고, Claude 결과를 리뷰하며, 승인된 브랜치를 통합 worktree에 병합한다.
- 리뷰에서 기능 수정이 필요하면 Claude가 다시 수정한다. Codex는 단순 병합 충돌을 해결할 수 있지만 동작 변경이 필요한 충돌은 Claude에게 재배정한다.
- 기획에 없는 정책을 임의로 만들지 않는다. 막히면 Orca `ask`로 Codex에게 질문한다.
- 작업 완료 시 수정 파일, 실행한 검증, 남은 위험을 포함해 Orca `worker_done`을 정확히 한 번 보낸다.
- 상세 작업 규칙은 `docs/agent-workflow.md`, 기능 기준은 `docs/specs/2026-07-29-mvp-functional-spec.md`를 먼저 읽는다.

## 기준 우선순위

1. 기능 동작·상태·데이터·권한·오류 정책: 승인된 Notion 기획과 `docs/specs/2026-07-29-mvp-functional-spec.md`
2. 화면 레이아웃·SVG·색상·간격: 현재 프로젝트 화면과 기존 디자인 에셋
3. 과거 메모·프로토타입 mock 동작: 위 두 기준과 충돌하지 않을 때만 참고

현재 화면을 임의로 재설계하지 않는다. 화면과 기능 정책이 충돌하면 시각 요소는 현재 화면을 유지하고 동작은 기능 명세를 따른다.

```bash
npm run dev          # http://localhost:5173
npm run build        # 변경 후 항상 통과 확인
npm run svg:import   # Figma SVG 재이관 (아래 참고)
npm run svg:verify
```

## 디자인 소스 계보 — 어느 쪽이 진짜인지

여러 소스가 섞여 있어서 우선순위가 중요하다. **위쪽이 항상 우선한다.**

1. **Figma** — 최종 진실. fileKey `SwPUTjl7rMmD61ELwMRFjC`
   (`https://www.figma.com/design/SwPUTjl7rMmD61ELwMRFjC`). 디자인 변경은 여기서 시작한다.
2. **`design-assets/svg/`** — Figma 원본 SVG. 코드에서 쓸 것은 이쪽.
3. **`design-assets/icons/`** — 손그림 재구성분(구버전). 원본이 없던 시절의 근사치.
4. Claude Design 프로토타입 `오늘우리는 프로토타입.dc.html`
   (프로젝트 `575e0b33-6a57-4570-becb-daa77aa1fcfe`) — 좌표·문구의 원래 기준.
   여기 `uploads/*.png`가 아래 REST로 렌더한 화면 스크린샷이고,
   `uploads/오늘우리는_디자인스펙_v2.md`에 18화면 전체의 Figma 좌표·색·폰트가 있다.

**주의: 프로토타입도 갱신된다.** 사용자가 Figma 변경을 프로토타입에 반영하므로,
캐시해 둔 사본을 믿지 말고 작업 시작 때 `DesignSync get_file`로 다시 받을 것.
갱신 여부는 섹션 주석에 붙는 `(fig 최신)` 표시로 알 수 있다. Figma REST가 429
rate limit에 걸렸을 때도 프로토타입 쪽은 읽히므로 이 경로가 더 안정적이다.

### Figma에서 가져오는 두 경로

**MCP는 Starter 플랜 호출 제한에 걸린다** (`You've reached the Figma MCP tool call
limit on the Starter plan`). 연결 자체는 살아 있어(gksrmf359@gmail.com, team
`1304838218121506770`) 파일 URL만 있으면 소량 읽기는 되지만, 대량 작업엔 못 쓴다.

그래서 실제로는 **개인 액세스 토큰 + Figma REST API**를 쓴다. 토큰은 `.figma-token`
(프로젝트 루트, gitignore됨)에서 읽는다. 스코프는 File content → Read-only.
2026-07-25에 발급한 토큰으로 동작 확인됨. 만료되면 403이 뜨니 재발급해 덮어쓸 것.

```bash
npm run figma:screens -- --list                    # 화면 목록만 (호출 절약)
npm run figma:screens -- --scale 1                 # 전체 렌더
npm run figma:screens -- --only 208:1452 --scale 3 # 특정 화면만
```

`.figma-renders/`에 `<node_id>.png` + `index.json`으로 떨어진다(gitignore, 재생성 가능).
`scale=1`은 대조용, `scale=3`은 에셋 복원용. 스크립트가 화면 목록을 하드코딩하지 않고
매번 트리에서 찾으므로 디자인이 재편돼 node id가 바뀌어도 그대로 동작한다.

**node id는 대략 생성순이다.** 무엇이 새로 추가됐는지 판단할 때 유용하다 — 예컨대
2026-07-06 시점의 최대치가 `174:3247`이라, `208:*` / `209:*` / `215:*`는 그 이후 작업이다.

SVG는 별도로 **`C:\couple\product\couple-place-diary`**(같은 앱의 Next.js 버전)의
`public/svg/`에 토큰 익스포트로 도착해 있고, `npm run svg:import`가 거기서 가져온다.
새 에셋을 찾을 때 Figma를 바로 긁기보다 이 경로에 먼저 도착했는지 확인할 것.

### 화면 인벤토리 (2026-07-25 기준)

`레퍼런스` 페이지의 `html.to.design ...` 섹션은 외부 사이트를 캡처한 참고자료라
화면이 아니다 — `--list`에 섞여 나오지만 무시할 것.

| 섹션 | node id | 화면 |
| --- | --- | --- |
| onboarding | 110:467 / 111:726 / 113:858 / 114:16 | onboarding 1~4 |
| Main | 134:159, 157:304 | main.phone |
| Main | 174:6462, **215:2505** | 상대 기다리는 화면 (215는 174의 사소한 이터레이션) |
| Rocation edit | 157:584 | 지도(장소 선택) |
| Rocation edit | 158:514 | 5초 기록 |
| 장소 상세 | 159:61 / 161:1149 / 161:1689 / 161:1840 | 봄 / 여름 / 가을 / 겨울 |
| 장소 상세 | 161:1071 | 장소 상세 편집 (402×1150) |
| 장소 상세 | 174:3247, 161:1513, **209:1924** | 꽃갈피 선택 / (활성) / **209는 이름만 그렇고 실제론 '시간 변경' 바텀시트** |
| Mypage(수정중) | 174:3918 | 마이페이지 (재설계) |
| Mypage(수정중) | **208:1452** | 내 정보 수정하기 (모달) |
| Mypage(수정중) | **208:1552** | 가고 싶은 곳 (전체 화면) |

### 같은 앱의 다른 구현체 (혼동 주의)

| 경로 | 스택 | 상태 |
| --- | --- | --- |
| `C:\couple2` (여기) | Vite + React 19, mock only | 현재 작업 대상 |
| `C:\coupleApp` | Vite + React + TS, CSS Modules, Supabase, Kakao 지도 | UI 완료(2026-07-06), Supabase 미연결. Figma 토큰 보관처 |
| `C:\couple\product\couple-place-diary` | Next.js, Supabase | Figma SVG 익스포트 도착지 |

`coupleApp` 쪽에 이미 나온 결정들(PWA 선택 이유, Supabase 채택, Kakao 지도 401 도메인
미등록 이슈, 익명인증 계획)은 그쪽 메모리
`~/.claude/projects/C--coupleApp/memory/project-oneul-woorineun.md`에 있다.
couple2의 인증 설계를 정할 때 먼저 읽을 것.

## Figma 디자인이 바뀌었을 때

```bash
npm run svg:import   # --src 로 다른 경로 지정 가능, --dry 로 미리보기
npm run svg:verify   # 태그 균형·끊긴 url(#id)·base64 잔존·svgSize 불일치 검사
npm run build        # import 해석까지 확인
```

`svg:import`가 자동으로 처리하는 것:

- **base64 종이질감 텍스처 제거.** Figma는 390×582 PNG(342,801B)를 꽃 8개 +
  `flower-blank` + `sticker`에 **전부 중복 삽입**한다(md5 동일). 그런데 `pattern`이
  413×617 박스를 채우고 `clipPath`가 28.5×8.2px 띠만 남겨서, 실제로 보이는 건 그
  이미지의 27×8px 크롭뿐이다. 216픽셀을 위해 257KB. 3.87MB → 435KB(11.2%)로 줄어든다.
  테이프 띠는 벡터(`fill="#AC8641"`)로 남으므로 사라지는 건 미세한 그레인뿐이고,
  원본 텍스처는 `design-assets/images/paper-texture.png`에 보존돼 있다.
  **이 텍스처를 다시 인라인하지 말 것.**
- 파일명 → `fixtures.js`의 `FLOWERS` key 정렬
  (`Calendula`→`marigold`, `Calla Lily`→`calla`, `Forget-me-not`→`forgetmenot`).
- Next.js 템플릿 기본 에셋(`file`/`globe`/`window`.svg) 제외.

**viewBox가 바뀌면 `design-assets/svg/index.js`의 `svgSize`를 반드시 갱신할 것.**
이 앱은 절대 좌표 배치라 크기가 틀리면 비율이 깨진다. `svg:verify`가 불일치를 잡아준다.

## 장소 상세 — 계절과 사진 페이저

**계절은 기록 날짜의 월로 결정된다.** `seasonFromDate()`(`src/data/format.js`)가
기상청이 쓰는 기상학적 3개월 묶음을 따른다 — **3~5 봄 / 6~8 여름 / 9~11 가을 /
12·1·2 겨울**. 겨울만 해를 넘어가므로 `['winter','spring','summer','autumn']`을
`Math.floor((month % 12) / 3)`로 인덱싱한다(12개월 전수 확인함).

한국의 계절 기준은 하나가 아니다. 24절기(입춘 2/4경, 입하 5/5경, 입추 8/7경,
입동 11/7경)로 잡으면 기상학적 기준보다 한 달쯤 이르러 "8월 중순인데 가을"이 된다.
체감과 어긋나서 쓰지 않는다. 기상청 공식 정의는 기온 기반(일평균 5℃·20℃)이라
날씨 데이터 없이는 불가능하다.

**시안의 봄/여름/가을/겨울 4화면은 `section.screen` 배경색만 다르다.** 스펙을 라인
단위로 비교한 결과 메모 영역(`div.memo-section` 402×475 @(0,325))을 포함해 나머지가
완전히 동일하다. 네 배경색은 `tokens.js`의 `SEASONS`에 이미 들어 있다
(봄 `#F3E7E2` / 여름 `#F0F9FF` / 가을 `#ECE4D9` / 겨울 `#FFFFFF`).

**히어로 상단의 `n/m`과 화살표는 사진 페이저다 — 계절 전환이 아니다.** 시안 표기가
`1/5`(사진 5장)인데 이전 구현은 이 자리를 계절 순환(`1/4`)에 쓰고 있었다.
지금은 `record.photos`를 넘기며, 2장 미만이면 카운터와 버튼을 렌더하지 않는다.
시안에 오른쪽 화살표가 하나뿐이라 순환(`(i+1) % count`)으로 전체를 돈다.

### 계절 검토용 예시 데이터

네 계절을 모두 볼 수 있게 픽스처에 기록을 시드해 뒀다. 홈 하단 목록에서 눌러 들어간다.

| 기록 | 날짜 | 계절 / 배경 | 장소 | 꽃갈피 | 사진 |
| --- | --- | --- | --- | --- | --- |
| `r10` | 2026-07-04 | 여름 `#F0F9FF` | 뚝섬 한강공원 | marigold | 2장 |
| `r1` `r2` | 2026-05-03 | 봄 `#F3E7E2` | 성수동 블루보틀 | rose / lilac | 3장 / 0장 |
| `r12` | 2026-01-17 | 겨울 `#FFFFFF` | 어라운드 성수 | jasmine | 1장 |
| `r11` | 2025-10-19 | 가을 `#ECE4D9` | 서울숲 카페거리 | lilac | 0장 |

**홈 하단 목록은 시안과 다르게 모든 달을 보여준다.** 시안은 최신 달 2장만 노출하는데,
그러면 한 계절밖에 못 본다. 그래서 `Home.jsx`가 완성 기록을 월별로 묶어(연도 포함 키 —
2025-10과 2026-10이 섞이지 않게) 402×408 영역에서 스크롤한다. 그룹 헤더는 계절 캘린더
아이콘 + "n월의 기록"이고 "전체보기"는 첫 그룹에만 붙는다. 레이아웃 상수는
`GROUP_HEADER_H=49` / `CARD_STEP=165`(카드 153 + 12) / `GROUP_GAP=24`이고,
`RecordCard`가 절대 배치라 그룹별 y를 직접 쌓는다. **카드 컴포넌트 자체는 손대지 않았다.**
시안 그대로 돌리려면 이 목록을 최신 달 `slice(0, 2)`로 되돌리면 된다.

## 에셋 사용 규칙

```js
import { flowerSvg, svgSize, scaleToHeight } from '@assets/svg';   // 원본 (권장)
import { PressedFlower } from '@assets/icons';                      // 손그림 (교체 대상)
```

- `flowerSvg`의 key는 `fixtures.js`의 `FLOWERS` key와 1:1이다.
- `flowers.svg`는 꽃갈피 7종이 아니라 여러 송이 묶음 일러스트 → `flowersIllustSvg`.
- **`SpringStar`는 반드시 lazy import** (`icons/index.js`가 재수출하지 않는 이유).
- 색·폰트는 `src/styles/tokens.js` 단일 소스. 화면에 하드코딩 금지.

## 미완 작업

**1. icons/ → svg/ 교체.** `design-assets/README.md`에 대응 표가 있다. 우선순위는
`PressedFlower`(타원 5개로 근사한 것 — 원본과 품질 차이가 가장 큼) → `EnvelopeIllust`
→ `WritingIllust`. **비율 주의**: 예컨대 `EnvelopeIllust`는 140×95(1.47)로 쓰이는데
`letter.svg`는 139×105(1.32)다. 크기를 그대로 넘기면 세로가 눌린다.

**2. 2026-07-25 Figma 변경 — 마이페이지는 반영 완료, 바텀시트만 남음.**
홈(`174:6462`)은 현재 `BottomNav` / `RecordCard`와 이미 일치해 손댈 것이 없었다.

반영 완료 (스크린샷으로 시안 대조 확인):

- **마이페이지 재설계** (`174:3918`) → `MyPage.jsx` 재작성. 358×300 프로필 카드를
  버리고 원형 사진 2개 + 하트, "A과(와) B이 함께한지 +N일째" 문장,
  "내 정보 수정하기" 올리브 버튼, 흰 라운드 카드 설정 행, 우측 하단 "커플 연결해제".
  배경이 `palette.bg`(#F1EAE0)가 아니라 **`palette.bgAlt`(#F8F3E6)** 인 점 주의.
- **내 정보 수정하기** (`208:1452`) → `src/components/ProfileEditSheet.jsx`.
  라우트가 아니라 **마이페이지 위 오버레이**로 만들었다 — 시안에서 딤(0.45) 뒤로
  마이페이지가 그대로 보이기 때문이다. 이름 편집이 `MyPage`의 ✎에서 여기로 옮겨왔다.
- **가고 싶은 곳** (`208:1552`) → `src/screens/Wishlist.jsx`, 라우트 `/mypage/wishlist`.
  `fixtures.js`의 wishlist에 `category`/`pickedBy`를 추가했다(칩과 "N Pick!"에 필요).

남은 것:

- **시간 변경 바텀시트** (`209:1924`, 프레임 이름은 '꽃갈피 선택'이지만 내용이 다름) —
  기록 수정 위에 뜨는 휠 피커. "시간 변경 / 우리의 추억이 찍힌 시간을 설정해주세요",
  가운데 행 강조(베이지 라운드), 버튼 "지금 시각"(외곽선) + "완료"(올리브).
  뒤에 깔린 기록 수정 화면에는 사진 편집 영역, 장소 검색 필드, 날짜·시간 드롭다운 2개.

**아이콘 색 — `MaskIcon`을 쓸 것** (`src/components/MaskIcon.jsx`).
`uiSvg`/`etcSvg`의 아이콘은 색이 파일에 구워져 있어(`fill="black"`, `#33363F`,
`fill="white"` 등) `<img>`로는 시안 색을 낼 수 없다. `MaskIcon`은 SVG를 CSS mask로
써서 모양만 가져오고 색은 `background`로 칠한다 — 35KB짜리를 인라인하지 않아도 되고
한 에셋으로 여러 색을 낼 수 있다(꽃갈피 선택 시트가 `rating-flower.svg` 하나로 7색).

```jsx
<MaskIcon src={uiSvg.expandRight} color={palette.textSubtle} size={18} />
```

**색이 이미 맞는 것은 `<img>`로 충분하다**: `cancelCircle`·`cancel`·`plusSketch`는
`#9A9088`(= `palette.textMuted`), `camera`는 `#6E665E`(= `palette.text`)다.
`cancelCircle`은 원과 X가 한 벌이라 감싸는 원 div까지 걷어낼 수 있다.

**텍스트 글리프로 아이콘을 그리지 말 것.** `✿` `✎` `✕` `＋` `‹` `›` `⌕` `◷` `▦` 같은
문자는 폰트에 의존해 기기·브라우저마다 모양이 달라진다. 2026-07-25에 렌더 코드의
글리프를 전부 SVG로 교체했다(`FlowerRating`·`FlowerPickSheet`·`BackButton`·
`RecordNew`·`RecordEdit`·`MyPage`·`Home`·`MapSelect`·`Wishlist`·`PlaceDetail`).

**`FlowerRating` 주의**: 이제 flex라서 `textAlign`으로 정렬되지 않는다. 가운데 정렬은
호출부에서 `justifyContent: 'center'`로 준다. `letterSpacing` prop은 이름만 남고
실제로는 flex `gap`으로 들어간다.

**3. 온보딩 — 디자인과 어긋난 부분** (2026-07-25 대조, Claude Design 프로토타입 +
Figma 렌더 양쪽 확인). 레이아웃 근거는 프로토타입의 공통 셸이다:

```
top:62 height:812  padding:0 22px 48px  justify-content:space-between
  상단  height:360.264  column  gap:24  padding:28px 0
  하단  height:82  column  gap:4  center
    버튼  height:54  radius:999  #64741D  inset 0 0 0 1px  padding:12px 30px  flex-grow:1
```

- **배경 그라디언트 누락** — Figma 온보딩 전 화면에 우상단 노란 글로우 + 좌하단 초록
  틴트가 깔려 있는데 현재는 단색 크림이다. 값은 `design-assets/README.md` 하단.
- **온보딩1 로고 락업** — 장미와 "오늘,우리는"이 **하나의 216×92.264 벡터**(`FigLogo`,
  `figma/FigLogo.jsx`에 "Do not redraw" 명시)로 묶여 pos(93,90)에 온다. 현재는
  `RoseIllust`(rose.webp) 96×96 at (64,78) + 텍스트 at (172,112)로 분리돼 있다.
  텍스트는 (173.4,119.1), **letter-spacing 0.070em**, line-height 36.062px.
- **온보딩1 본문 line-height 2.15 → 1.5** (확실한 차이). 컨테이너 360.264px에서
  로고 92.264 + gap 24 → 본문 시작 206.26, 컨테이너 끝 422.26 → 216px ÷ 6줄 = 36px
  = 24px × 1.5. 현재 2.15면 310px로 컨테이너를 넘친다.
- **버튼 위치는 바뀌지 않았다.** Figma의 `FRAME "Frame 2147238957"`은 온보딩1만
  358×**82** @(22,744)(버튼 54 + gap 4 + 링크 24)이고 온보딩2·3·4는 358×**54** @(22,**772**)다.
  프로토타입이 네 화면 모두 82px 컨테이너로 통일해 버튼이 758로 보이는데 그건 셸을
  공유하려는 프로토타입 쪽 편의다. **772가 맞다.** 온보딩1 링크만 806 → **802**.
- **온보딩2 코드 입력도 그대로 둔다.** 프로토타입은 `width:358px; text-align:center;
  text-indent:22px`로 가운데 정렬하지만, Figma 렌더에서는 "6"이 **왼쪽 첫 세그먼트 위**에
  있고 스펙도 pos(44,388)이다. `codeDisplay`가 `'482195'.slice(0, codeLen)`으로 패딩이
  없어 가운데 정렬하면 1자리 입력이 4번째 세그먼트 위로 가버린다. 현재 `left:44` 유지.
- **온보딩4 카드**는 이제 Figma 컴포넌트 `Frame2147239000`(node `136:912`, 331×467)
  하나다. 구조는 현재 `OnboardingShare.jsx`와 같지만 꽃다발이 `bouquet.webp`(110×112)가
  아니라 `flowers/flowers.svg`(59×90) — 장미 + 노란 카라에 마스킹테이프다.

**함정**: 프로토타입은 온보딩2·3의 일러스트 자리에도 `FigLogo`를 넣어 뒀지만
**Figma 원본에는 편지봉투와 장미·연필이 그대로 있다.** 프로토타입을 그대로 믿고
`EnvelopeIllust` / `WritingIllust`를 지우면 안 된다. 마찬가지로
`uploads/오늘우리는_디자인스펙_v2.md`가 온보딩3 프레임을 390×874로 적은 것은 Figma
작성상 흔적이고, 실제 화면 폭은 402다.

**4. 인증/세션 설계 미결.** 지금은 로그아웃이 없는 게 아니라 **세션 자체가 없다**
(`api.js`의 `db`가 메모리라 새로고침하면 `onboarded`가 false로 돌아가 온보딩으로 튕긴다).
초대코드는 페어링 전용이라 로그인 수단이 될 수 없다 — 6자리 숫자는 브루트포스 가능하고,
설계상 상대에게 공유하는 값이라 비밀이 아니며, 두 사람이 같은 코드를 쓰면 서버가
`me`/`partner`를 구분할 수 없다. 권장안은 카카오 로그인을 정체성 레이어로 두고
**로그아웃(세션 정리, 되돌릴 수 있음)과 커플 연결 해제(파괴적)를 분리**하는 것.
연결 해제는 즉시 삭제보다 읽기 전용 보관이 맞다(기록이 공동 작성물이고 앱의 유일한 자산).
mock 함정: 세션만 localStorage에 넣으면 db는 초기화돼 로그인 상태인데 온보딩으로 튕긴다.

**디자인이 이미 답한 부분**: 2026-07-25 마이페이지 시안에 **"연결해제"는 두 곳
(마이페이지 우측 하단 + 내 정보 수정 모달 하단)에 있지만 "로그아웃"은 어디에도 없다.**
즉 디자이너는 기기 세션을 노출하지 않는 쪽을 택했다. 이 전제를 유지한다면 카카오 로그인을
넣더라도 로그아웃 버튼은 두지 않고, UI에 드러나는 파괴적 동작은 연결해제 하나로 가는 게
시안과 일관된다. 세션 만료·기기 이전 처리는 UI 없이 뒤에서 해결할 것.

**5. 기타** — 원본 프로젝트에서 발견한 값들이
`design-assets/README.md` 하단에 있다.

## 교체 지점 (인터페이스 유지)

- `src/data/api.js` — 데이터 접근 mock. 백엔드 연동 시 **함수 내부만** 교체, 시그니처 유지.
  - **mock 전용 `replenishPendingRecord()`가 있다.** 홈 캐러셀은 `내 한 줄이 아직 없는
    기록`만 보여주는데 픽스처에 그런 기록이 `r3` 하나뿐이라, 거기에 한 줄을 쓰면 홈 상단의
    "짝궁이 당신의 답을 기다리고 있어요" 카드가 사라져 버렸다. 시안은 이 상태를 홈의 기본
    화면으로 두므로(`상대 기다리는 화면`) 저장 후 비면 파트너가 쓴 기록을 하나 더 시드한다.
    카드 수는 2개(대기 1 + 빈 카드 1)로 유지되어 시안의 점 2개와 맞는다.
    **실제 백엔드로 교체할 때 이 함수는 같이 지울 것.**
- `src/components/MapView.jsx` — 카카오맵/네이버맵 어댑터.
- `src/styles/tokens.js` — 색·폰트·계절 테마.

## 검증

`npm run build` 외에, 전 플로우 스크린샷 검증은 puppeteer-core + Edge
(`C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`)로 한다. puppeteer는
설치돼 있지 않으니 필요하면 스크래치패드에 설치할 것. `::-p-text` 셀렉터는 부분 문자열
매치에 주의 — '선택하기'가 '꽃갈피 선택하기'에 먼저 걸린다.

## 저장소 상태

`git init`만 된 상태로 **커밋이 하나도 없다**(`main`, 전부 untracked).
Figma 새 디자인을 덮어쓰기 전에 베이스라인 커밋을 만들어 두면 무엇이 바뀌었는지
diff로 볼 수 있다. 커밋·푸시는 사용자가 요청할 때만 한다.
