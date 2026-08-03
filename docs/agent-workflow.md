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

## 구현 작업자 라우팅

- 모든 root, Wave, 구현 task는 Claude를 최초 구현 작업자로 전제한다. 사용량 소진 증거가 생기기 전에 task 제목·명세·Run 목표에 Codex 구현을 미리 지정하지 않는다.
- Codex는 구현 dispatch 직전에 Claude Code 계정이나 런타임이 제공하는 읽기 전용 사용량 상태를 확인한다. 확인 과정에서 토큰, 키 또는 계정 비밀정보를 기록하지 않는다.
- 사용 가능하면 Claude로 dispatch한다. 사용량 상태를 확인할 수 없거나 결과가 불명확해도 소진으로 추정하지 않고 Claude를 먼저 시도한다.
- 사전 확인에서 Claude 계정 전체의 사용량 소진이 명확히 확인되거나, 아래 Fable→Opus 라우팅까지 거친 뒤에도 계정 수준의 사용량 크레딧·결제·rate-limit 오류로 중단된 경우에만 Codex fallback을 허용한다.
- 일시적 과부하나 서비스 오류는 Codex fallback 사유가 아니다. 이런 경우에는 아래 Claude 모델 라우팅을 먼저 따른다.

### 증거 기반 Codex fallback

- fallback 기록에는 `originalTaskId`, `originalDispatchId`, 확인 출처, 오류 종류, `observedAt`, 완료된 작업과 남은 범위를 포함한다. 사전 확인으로 Claude Dispatch를 만들지 않았다면 `originalDispatchId`에 그 사실을 기록한다.
- 기존 Run, Task, worktree, 브랜치와 완료된 변경을 그대로 보존한다. 사용량 소진만을 이유로 새 Run, 새 Task 또는 새 worktree를 만들거나 이미 끝난 구현 단계를 반복하지 않는다.
- Codex 구현 작업자는 기존 작업의 남은 범위만 이어받는다. 시작 전에 기존 Claude 터미널을 정지하거나 유휴 상태로 만들어 같은 worktree를 동시에 편집하지 않게 한다.
- Codex 구현 작업자와 Codex 코디네이터·리뷰어는 각각 별도 터미널로 분리한다. 구현 작업자가 보낸 `worker_done`은 별도 코디네이터가 diff와 검증 결과를 다시 확인한다.
- fallback 증거가 없거나 오류 의미가 모호하면 Codex로 전환하지 않고 사용자 decision gate를 연다.
- Codex fallback 결과도 동일한 파일 소유권, 테스트, 빌드, 리뷰 및 통합 게이트를 통과한다.

### 저장소 라우팅 가드

위 규칙은 저장소 가드로도 강제된다. Codex 세션이 구현 경로를 바꾸면 테스트·빌드·커밋이
살아 있는 fallback grant를 요구한다. Claude와 사람 세션, 그리고 `docs/**/*.md`와 루트
`AGENTS.md` / `CLAUDE.md` / `README.md`만 바꾸는 Codex 세션은 그대로 통과한다.

설치는 통합 worktree에서 한 번만 하면 된다. 버전 관리되는 `.githooks/` 템플릿 두 개와
검증기 런타임 세 개(`verify-agent-routing.mjs`, `agent-routing-grant.mjs`,
`agent-routing-policy.mjs`)를 `<git-common-dir>/orca-routing-hooks/`로 복사하고 공유
`core.hooksPath`를 그 절대 경로로 맞추므로, 기존·새 worktree가 모두 같은 사본을 쓴다.
배포본은 작업 트리 밖이라 커밋으로 바꿀 수 없다.

**훅은 작업 트리의 `scripts/`를 실행하지 않는다.** 실행하면 Codex가 같은 커밋에서 검증기를
`process.exit(0)`으로 바꿔 가드를 통과할 수 있다. 대신 배포된 사본만 실행하며, 배포는 다섯
파일이 모두 Git이 추적하는 일반 파일이고 HEAD 기준 staged·unstaged 변경이 없을 때만 이뤄진다.
따라서 **가드 코드를 고쳤으면 커밋한 뒤 다시 설치해야 반영된다**(`npm install`의 postinstall도
같은 일을 한다). `pretest`·`prebuild`는 편의 검사이므로 작업 트리 사본을 그대로 쓴다.

```bash
npm run agent-routing:install   # 훅 배포 (postinstall에서도 자동 실행, 반복 실행 안전)
npm run agent-routing:verify    # 현재 변경을 수동 검사
npm run agent-routing:test      # 가드 자체 테스트
```

grant는 커밋되지 않고 `<git-common-dir>/orca-routing-grants/<terminal>.json`에 저장된다.
`create`와 `finalize`는 **주 통합 worktree의 통합 브랜치에서, 그 Run의 코디네이터
터미널만** 실행할 수 있다. `orca orchestration run-show --id <run> --json`의
`coordinator_handle`이 현재 세션의 `ORCA_TERMINAL_HANDLE`과 정확히 같아야 하고, 코디네이터
자신에게는 발급할 수 없다. 확인이 안 되면 발급하지 않는다.

```bash
node scripts/agent-routing-grant.mjs create \
  --terminal <term> --task <task> --run <run> \
  --evidence-source read-only-usage-check|claude-response-classification \
  --observed-at <iso> --expires-at <iso> \
  --allowed-path <repo-relative-path> --remaining-scope "<남은 범위>"

node scripts/agent-routing-grant.mjs finalize --terminal <term> --dispatch <ctx>
node scripts/agent-routing-grant.mjs status   --terminal <term>
```

`create`는 provisional 상태만 만든다. Task를 dispatch한 뒤 `finalize`로 살아 있는
Dispatch ID·Run·담당 terminal을 묶어야 가드가 열린다. 유효 기간은 최대 60분이고, grant는
staged tree 하나에 예약된 뒤 커밋 시 소진되어 재사용되지 않는다. `--remaining-scope`에는
토큰·키·원시 오류 본문을 넣을 수 없다(패턴 검사로 거부된다).

## Claude 모델 라우팅

- 모든 새 Claude 구현 작업자는 프로젝트 설정인 `.claude/settings.json`에 따라 Fable로 시작한다.
- Fable이 과부하되거나 일시적으로 사용할 수 없으면 Claude Code의 `fallbackModel` 설정으로 해당 요청을 Opus에서 재시도한다.
- 일반 fallback은 한 요청에만 적용되며, 다음 요청에서는 Fable을 다시 우선 시도한다.
- 사용량 크레딧, 결제 또는 rate-limit 오류는 Claude Code의 일반 fallback을 작동시키지 않는다.
- Fable 작업자가 사용량 제한으로 중단되면 해당 Orca task를 실패 처리하거나 새 worktree를 만들지 않는다.
- Codex는 기존 worktree, 브랜치, task 상태와 완료된 변경을 보존하고, 막힌 Fable 세션을 정지하거나 유휴 상태로 만든 뒤 같은 worktree에서 다음 명령으로 Opus 세션을 시작한다.

```bash
claude --model opus --continue
```

- Codex는 미완료 task를 Opus 세션에 다시 dispatch하고 이미 끝난 구현 단계를 반복하지 않도록 명세에 현재 진행 상태를 포함한다.
- Opus로 완료된 결과도 동일한 `worker_done`과 Codex 리뷰 게이트를 통과해야 한다.
- Fable과 Opus를 모두 사용할 수 없으면 위의 증거 기반 Codex fallback 게이트를 적용한다. 사용량 소진 증거가 불명확하면 다른 모델로 임의 전환하지 않고 decision gate로 사용자에게 알린다.

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
