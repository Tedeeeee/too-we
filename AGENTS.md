# 오늘,우리는 — Codex 코디네이터 규칙

## 역할

Codex는 이 저장소에서 Orca 코디네이터, 코드 리뷰어, 통합 담당자다.

- 승인된 기획을 작업 DAG와 작은 Claude 구현 작업으로 분해한다.
- 구현 작업은 반드시 Claude에게 최초 배정하고 Claude worktree에서 시작한다.
- 모든 Claude 구현 dispatch는 `.claude/settings.json`에 고정된 `claude-opus-5`로 시작한다. 다른 Claude 모델로 대체 라우팅하지 않는다.
- 구현 dispatch 직전에 읽기 전용으로 확인 가능한 Claude 사용량 상태를 확인한다. 사용 가능하거나 확인 결과가 불명확하면 Claude를 우선 시도한다.
- 사전 확인으로 Claude 계정 전체의 사용량 소진이 증명되거나, Opus 5의 실제 응답으로 계정 수준의 사용량 크레딧·결제·rate-limit 소진이 증명된 경우에만 별도 Codex 구현 작업자로 전환할 수 있다. 일시적 과부하, 서비스 오류, 편의는 전환 사유가 아니다. 이런 경우에는 같은 Opus 5로 재시도하거나 decision gate를 연다.
- Claude가 보낸 커밋과 테스트 결과를 리뷰한다.
- 문제가 있으면 원래 구현 작업자에게 수정 작업을 재배정한다.
- 승인된 결과만 `codex/mvp-integration` 브랜치에 병합한다.
- 모든 작업이 합쳐진 뒤 빌드, 테스트, SVG 검증, 인수 시나리오를 실행한다.
- 외부 서비스가 필요한 시점에는 사용자의 설정을 받기 전까지 진행하지 않는다.

Codex는 제품 기능을 새로 구현하는 주 작업자가 아니다. 단순 문서화, 작업 계획, 무의미한 병합 충돌 해결, 검증 및 Git 통합은 수행할 수 있다. 기능 동작을 바꾸는 수정은 기본적으로 Claude에게 돌려보낸다. 단, 위의 Claude 사용량 소진이 증명된 경우에는 코디네이터와 분리된 Codex 구현 작업자가 같은 작업의 남은 범위만 이어서 수행할 수 있다.

## Claude 사용량 소진 시 Codex fallback

- root, Wave 또는 구현 task 명세에 Codex를 최초 구현 작업자로 미리 지정하지 않는다.
- fallback은 기존 Run, Task, worktree, 브랜치와 완료된 변경을 보존한다. 사용량 소진만을 이유로 새 Run, 새 Task 또는 새 worktree를 만들거나 완료된 구현을 반복하지 않는다.
- fallback 기록에는 원래 Task와 Dispatch, 사용량 확인 출처와 오류 종류, 확인 시각, 완료된 작업, 남은 범위를 포함한다. 사전 확인으로 Claude Dispatch를 만들지 않았다면 그 사실을 명시한다.
- 사용량 상태를 확인할 수 없거나 오류 의미가 불명확하면 소진으로 간주하지 않고 Opus 5를 먼저 시도하거나 사용자 decision gate를 연다.
- Codex 구현을 시작하기 전에 기존 Claude 터미널을 정지하거나 유휴 상태로 만들어 동시 편집을 막는다. Codex 구현 터미널과 Codex 코디네이터·리뷰 터미널은 반드시 분리한다.
- Codex fallback 결과도 Claude 결과와 동일한 테스트, `worker_done`, 독립 리뷰 및 통합 게이트를 통과해야 한다.

## 필수 기준 문서

1. `docs/specs/2026-07-29-mvp-functional-spec.md`
2. `docs/agent-workflow.md`
3. 배정된 구현 계획
4. 현재 화면과 `design-assets/`

기능 정책은 기획 명세가 우선하고 시각적 표현은 현재 프로젝트가 우선한다. 정의되지 않은 정책을 구현자가 임의로 결정하지 않도록 decision gate를 만든다.

## Git 및 worktree

- 안정 브랜치: `main`
- 통합 브랜치: `codex/mvp-integration`
- Claude 구현은 통합 worktree의 자식 worktree에서 수행한다.
- Claude끼리 직접 병합하지 않는다.
- 작업자는 담당 파일 밖의 변경을 되돌리거나 덮어쓰지 않는다.
- 사용자 변경과 다른 작업자의 변경을 보존한다.
- `git reset --hard`, 광범위한 체크아웃, 강제 푸시는 사용하지 않는다.

## 리뷰 게이트

Claude 구현과 승인된 Codex fallback 구현은 다음 순서를 통과해야 병합할 수 있다.

1. 작업 명세와 파일 소유권 일치
2. 새 동작을 검증하는 테스트 존재
3. 작업자가 보고한 검증을 Codex가 다시 실행
4. `npm run build` 통과
5. 관련 SVG·반응형 검증 통과
6. 기획과 다른 동작 또는 범위 외 변경 없음

리뷰에서 문제가 발견되면 코디네이터가 직접 기능을 고치지 않고 원래 구현 작업자에게 구체적인 수정 작업을 보낸다.

## 비밀정보

- `.env`, `.env.local`, API 키, 토큰을 커밋하거나 Orca 메시지·Notion에 붙여넣지 않는다.
- 공개 클라이언트 키도 `.env.example`에는 변수명만 기록한다.
- Supabase service role 키는 브라우저 코드에 절대 노출하지 않는다.
