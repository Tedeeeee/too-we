# Orca 에이전트 작업 흐름

## 목적

오늘,우리는 MVP를 여러 Claude worktree에서 병렬 구현하고 Codex가 리뷰·통합하기 위한 공통 규칙이다.

## 역할과 소유권

### Codex

- Notion 기획과 저장소 스냅샷을 작업 명세로 변환한다.
- task, dependency, decision gate, dispatch를 생성한다.
- 각 Claude 작업에 파일 소유권과 제외 범위를 지정한다.
- `worker_done` 결과와 커밋 diff를 리뷰한다.
- 재작업이 필요하면 같은 Claude 또는 새 Claude에게 수정 작업을 배정한다.
- 승인된 브랜치만 통합 worktree에 병합한다.
- 전체 검증 후 다음 Wave를 연다.

### Claude

- 배정된 worktree와 파일 범위에서만 구현한다.
- 테스트를 먼저 작성하고 실패를 확인한 뒤 최소 구현으로 통과시킨다.
- 기존 화면의 SVG, 레이아웃, 스타일을 불필요하게 바꾸지 않는다.
- 기능 정책이 불분명하면 추측하지 않고 `ask`를 보낸다.
- 커밋 전에 관련 테스트와 빌드를 실행한다.
- 완료 시 `worker_done`에 다음을 포함한다.
  - 수정 파일
  - 커밋 SHA
  - 실행한 명령과 결과
  - 남은 위험 또는 미완료 항목

## 기준 문서

- 제품 원본: Notion `기획`
  - https://app.notion.com/p/3aacea2af9f4801c8c8ced6463fed68d
- 저장소 작업 스냅샷: `docs/specs/2026-07-29-mvp-functional-spec.md`
- 화면과 에셋: 현재 `src/`, `design-assets/`

Notion과 스냅샷이 다르면 작업을 멈추고 Codex에게 알린다. Codex가 최신 Notion 내용을 확인해 스냅샷을 갱신한 뒤 작업을 재개한다.

## Worktree 구조

```text
main
└─ codex/mvp-integration
   ├─ claude/<task-a>
   ├─ claude/<task-b>
   └─ claude/<task-c>
```

- 모든 Claude 작업 브랜치는 해당 Wave 시작 시점의 통합 브랜치를 기준으로 만든다.
- 선행 작업이 필요하면 선행 브랜치를 직접 기준으로 삼지 않는다. Codex가 먼저 통합하고 최신 통합 브랜치에서 새 worktree를 만든다.
- Claude는 다른 Claude 브랜치를 병합하지 않는다.
- 통합된 worktree는 다음 Wave 전에 닫거나 보관한다.

## 작업 명세 필수 항목

모든 Orca 구현 task는 다음 정보를 포함한다.

1. 사용자에게 생기는 한 가지 명확한 결과
2. 참조할 기획 문서와 현재 화면
3. 생성·수정 가능한 파일
4. 수정 금지 파일과 범위 외 기능
5. 데이터·권한 규칙
6. 로딩·빈 화면·오류 상태
7. 재현 가능한 인수 시나리오
8. 정확한 검증 명령
9. 커밋 메시지

## 리뷰와 재작업

```text
Claude 구현·테스트·커밋
        ↓
worker_done
        ↓
Codex diff·테스트·기획 리뷰
        ├─ 문제 있음 → Claude 재작업
        └─ 승인 → Codex 통합
```

- `worker_done`은 리뷰 시작 신호이지 자동 병합 승인이 아니다.
- 단순 import·설정 충돌은 Codex가 해결할 수 있다.
- 동작 선택이나 큰 코드 변경이 필요한 충돌은 Claude 작업으로 돌려보낸다.
- 통합 후 발생한 회귀도 원인을 만든 Claude 작업 또는 별도의 Claude 수정 작업이 담당한다.

## 공통 검증

기본 명령:

```bash
npm test
npm run build
npm run svg:verify
npm run svg:verify-ui
npm run svg:verify-usage
npm run ui:verify-responsive
```

작업 시점에 아직 존재하지 않는 명령은 해당 기반 작업이 통합된 이후부터 필수로 적용한다.

## 외부 서비스 중단 지점

다음 값이 필요한 작업은 Codex가 decision gate로 막고 사용자와 함께 설정한다.

- Supabase 프로젝트 URL과 공개 anon key
- Supabase 서버 전용 비밀정보
- Kakao Developers JavaScript 키와 허용 도메인
- 배포 환경변수
- 사진 용량·형식과 초대 코드 유효기간 같은 운영값

비밀정보를 Git, Notion, Orca 메시지에 기록하지 않는다.
