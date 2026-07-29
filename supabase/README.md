# Supabase — MVP 스키마와 RLS (W1-A)

`docs/specs/2026-07-29-mvp-functional-spec.md`의 데이터·권한 규칙을 데이터베이스로 옮긴 것이다.
익명 사용자 두 명이 하나의 활성 커플을 이루고, 공동 방문 기록과 사용자별 한 줄·별점을
다른 커플이 접근할 수 없게 저장한다.

```text
supabase/
  migrations/
    20260729120000_mvp_schema_rls.sql     스키마 · RLS · RPC
    20260729120100_visit_photo_storage.sql  비공개 버킷 + storage.objects 정책
  tests/
    schema-contract.test.js               Vitest — 실행되는 계약 테스트
    helpers/sql-contract.js               마이그레이션 SQL 파서
    sql/                                  pgTAP 시나리오 (이 워크스페이스에서 미실행)
```

## 검증 상태 — 무엇이 실행됐고 무엇이 안 됐는지

| 대상 | 상태 |
| --- | --- |
| `npm test -- supabase/tests` | **실행됨.** 64개 통과 (`schema-contract.test.js`) |
| `npm test` | **실행됨.** 전체 통과 |
| `npm run build` | **실행됨.** 통과 |
| `supabase/tests/sql/*.sql` (pgTAP) | **미실행.** Supabase CLI와 Docker 데몬이 이 워크스페이스에 없다 |
| 원격 마이그레이션 적용 | **하지 않음.** 작업 범위에서 금지 |

pgTAP 스크립트는 작성됐지만 **한 번도 돌지 않았다.** 통과했다고 보고하지 않는다.
각 파일 첫 줄에 `NOT EXECUTED IN THIS WORKSPACE` 주석이 붙어 있다.

### pgTAP를 돌리는 방법 (환경이 생긴 뒤)

```bash
docker info                 # 데몬이 떠 있어야 한다
supabase init               # supabase/config.toml 생성 — 아직 없다 (아래 참고)
supabase start
supabase test db
```

`supabase/config.toml`은 **일부러 만들지 않았다.** project ref, 포트, 인증 설정,
스토리지 파일 크기 한도가 들어가는 파일인데 그 값들이 모두 외부 게이트 대상이라
여기서 임의로 정하면 나중에 덮어써야 한다. 인프라/게이트 작업에서 `supabase init`으로
생성하고, 스토리지 한도는 아래 표의 값이 확정된 뒤 채운다.

pgTAP 스크립트가 `insert into auth.users (...)`로 익명 사용자를 만드는데, 필요한 컬럼이
Supabase auth 스키마 버전에 따라 다르다. 처음 돌릴 때 컬럼 목록을 맞춰야 할 수 있다.

### 초대 코드 동시성 — 단일 트랜잭션으로 표현할 수 없는 부분

같은 코드로 두 사람이 **동시에** join하는 경우는 세션이 두 개 필요해서 pgTAP 한
트랜잭션 안에서 표현할 수 없다. `05_invite_concurrency.sql`은 대신 선언적 방어선
(부분 유니크 인덱스, slot 유니크)과 결과 코드 구분을 검증한다. 실제 경합은 두 세션으로
확인한다.

```bash
# 같은 코드로 두 세션이 동시에 join → 한쪽만 ok, 다른 쪽은 invite_consumed
psql "$DB_URL" -c "select code from public.couple_invites where status='active'"
pgbench -n -c 2 -j 2 -t 1 -f join.sql "$DB_URL"
```

`join.sql`은 서로 다른 `sub` 클레임으로 `public.join_couple_with_code(<code>, <key>)`를
호출한다. 기대 동작은 아래 "락" 절에 적어 뒀다.

## Vitest 계약 테스트가 검증하는 것

Docker가 없으니 **실행되는** 가드는 마이그레이션 SQL에 대한 구조 계약이다.
토큰 단위로 SQL을 파싱해서(달러 인용·문자열 인식) 테이블·제약·인덱스·정책·함수·권한을
읽고 명세가 요구하는 항목을 확인한다. 타우톨로지가 아니라는 것은 변이 테스트로 확인했다 —
아래 5가지를 각각 넣었을 때 모두 실패한다.

| 변이 | 잡히는 테스트 |
| --- | --- |
| 활성 커플 유니크 인덱스에서 `where left_at is null` 제거 | `allows one active couple per user` |
| 정책 대상 역할을 `anon`으로 변경 | `targets the authenticated role in every policy` |
| definer 함수에서 `set search_path = ''` 제거 | `pins search_path on every definer function` |
| `couple_members`에 클라이언트 insert 권한 부여 | `grants nothing to the anon role` |
| 초대 만료를 `interval '7 days'`로 하드코딩 | `derives invite expiry from configuration` |

꽃갈피 7종은 `src/data/fixtures.js`의 `FLOWERS`를 **직접 import해서** 시드와 비교한다.
프런트엔드에 꽃을 추가하면 마이그레이션을 고치지 않는 한 테스트가 깨진다.

## 데이터 모델

```text
auth.users (익명)
  └─ profiles (display_name)
       └─ couple_members (couple_id, user_id, slot 1|2, left_at)
            └─ couples (status active|disconnected)
                 ├─ couple_invites (code 6자리, status active|consumed|revoked)
                 ├─ visits ─── 공동: 장소 스냅샷 · visited_at · flower_key
                 │     ├─ visit_entries  개인: note(한 줄) · rating   [visit+author 유일]
                 │     ├─ visit_tags     공동: ordinal 순서
                 │     └─ visit_photos   ordinal 1..5 · uploader_id · storage_path
                 └─ wishlist_places  방문 기록과 무관

app (PostgREST에 노출되지 않는 내부 스키마)
  config · invite_attempts · idempotency_keys · purge_jobs · purge_job_objects
```

명세 규칙이 스키마에서 어디에 대응되는지:

| 규칙 | 구현 |
| --- | --- |
| 한 사용자는 하나의 활성 커플 | `couple_members (user_id) where left_at is null` 유니크 |
| 한 커플에 최대 두 명 | `slot in (1,2)` + `(couple_id, slot) where left_at is null` 유니크 |
| 한 커플에 활성 초대 코드 하나 | `couple_invites (couple_id) where status='active'` 유니크 |
| 개인 기록은 방문×사용자당 하나 | `visit_entries (visit_id, author_id)` 유니크 |
| 별점은 없거나 1~5 | `check (rating is null or rating between 1 and 5)` |
| 유효한 한 줄 = 트림 후 1자 이상 | `check`로 강제 + `normalize_visit_entry` 트리거가 공백을 null로 |
| 사진 최대 5장 | `ordinal between 1 and 5` + `(visit_id, ordinal)` 유니크 |
| 활성 구성원만 공동 데이터 접근 | 모든 select 정책이 `app.is_active_member` / `app.can_read_visit` |
| 한 줄·별점은 작성자만 수정·삭제 | `visit_entries` update/delete 정책 `author_id = auth.uid()` |
| 사진은 올린 사람만 삭제 | `visit_photos` delete 정책 `uploader_id = auth.uid()` |
| 장소·시간·태그·꽃갈피는 둘 다 수정 | `visits` / `visit_tags` update 정책은 멤버십만 확인 |
| 해제 즉시 접근 차단 | 헬퍼가 `couples.status = 'active'`를 요구 → 같은 트랜잭션에서 차단 |
| 삭제는 24시간 안에 | `purge_jobs.due_at default (now() + interval '24 hours')` |

**한 줄 컬럼 이름은 `note`다.** `text`는 타입 이름이라 `check (btrim(text) = text)`
같은 표현에서 파싱이 애매해질 수 있어 피했다. 앱 데이터 셰이프의 `entries[].text`에
대응한다 — API 레이어에서 매핑할 것.

## RPC 계약 (W1-B 데이터 레이어가 쓸 부분)

모든 클라이언트 RPC는 `jsonb` 봉투를 반환한다.

```jsonc
// 성공
{ "ok": true,  "replayed": false, "data": { ... } }
// 도메인 실패
{ "ok": false, "replayed": false,
  "error": { "code": "invite_expired", "sqlstate": "TW006", "details": { ... } } }
```

**중요: 도메인 실패는 예외를 던지지 않고 봉투로 돌아온다.** supabase-js의 `error`가
비어 있어도 `data.ok`를 반드시 확인해야 한다. 이유는 롤백 때문이다 — 초대 코드 시도
횟수 제한은 실패한 시도가 `app.invite_attempts`에 **커밋돼야** 성립하는데, 예외를
던지면 그 행까지 롤백되어 제한이 영원히 작동하지 않는다.

예외를 던지는 경우는 두 가지뿐이다: 세션이 없을 때(`forbidden`), 그리고 필수 인자인
`p_request_key`가 빠졌을 때(`validation_error`). 둘 다 정상 흐름에서 발생하지 않는다.

### 결과 코드

`app.error_sqlstate()` 한 곳에서 매핑한다. SQLSTATE 클래스 `TW`는 표준과 PostgreSQL이
예약한 범위를 피한 사용자 정의 클래스다.

| code | sqlstate | 의미 |
| --- | --- | --- |
| `validation_error` | TW001 | 입력이 규칙에 맞지 않음 |
| `not_found` | TW002 | 대상이 없거나 볼 권한이 없음 (존재 여부를 알려주지 않음) |
| `forbidden` | TW003 | 세션 없음, 또는 활성 커플 없음 |
| `rate_limited` | TW004 | 초대 코드 시도 제한. `details.retry_after_seconds` |
| `invite_not_found` | TW005 | 그런 코드가 없었다 |
| `invite_expired` | TW006 | 유효기간이 지났다 |
| `invite_consumed` | TW007 | 이미 연결에 사용됐다 |
| `invite_revoked` | TW008 | 재발급 등으로 무효화됐다 |
| `invite_own_couple` | TW009 | 자기 커플 코드를 넣었다 |
| `couple_capacity_reached` | TW010 | 정원이 찼다 |
| `active_membership_conflict` | TW011 | 이미 활성 커플이 있다 |
| `photo_limit_reached` | TW012 | 사진 5장을 넘었다 |
| `conflict` | TW013 | 동일 요청이 진행 중이거나 재시도 필요 |

명세가 요구한 "잘못된 코드 / 사용 완료 코드 / 정원이 찬 코드 구분"은 TW005 / TW007 /
TW010으로 각각 분리돼 있고, 만료(TW006)와 무효화(TW008)도 따로 구분된다.

### 함수 목록

| RPC | 권한 | 비고 |
| --- | --- | --- |
| `upsert_my_profile(p_display_name)` | authenticated | 이름 입력 |
| `create_couple(p_display_name, p_started_on, p_request_key)` | authenticated | "시작하기". slot 1 + 첫 초대 코드 |
| `reissue_couple_invite(p_request_key)` | authenticated | 코드가 만료·무효화됐을 때 재발급 |
| `join_couple_with_code(p_code, p_request_key, p_display_name)` | authenticated | **`p_request_key` 필수** |
| `create_visit(p_place, p_visited_at, p_request_key, p_flower_key, p_tags)` | authenticated | **`p_request_key` 필수** |
| `upsert_my_visit_entry(p_visit_id, p_text, p_rating)` | authenticated | `data.pending`으로 대기 상태 반환 |
| `set_visit_tags(p_visit_id, p_labels)` | authenticated | 순서 포함 전체 교체 |
| `register_visit_photo(p_visit_id, p_storage_path, p_metadata, p_request_key)` | authenticated | 빈 ordinal 배정 |
| `disconnect_couple(p_request_key)` | authenticated | 즉시 차단 + purge job 큐잉 |
| `claim_purge_jobs(p_limit)` | **service_role** | 백엔드 워커 전용 |
| `purge_couple_data(p_job_id)` | **service_role** | DB 행 삭제 |
| `mark_purge_objects_deleted(p_job_id, p_object_paths)` | **service_role** | 파일 삭제 보고 |
| `complete_purge_job(p_job_id, p_succeeded, p_error)` | **service_role** | 실패는 재큐잉 |

`join_couple_with_code`와 `create_visit`는 `p_request_key`가 필수다. 명세가 이 두
요청의 중복 실행 안전성을 요구하므로 옵션으로 두지 않았다. 클라이언트가 요청당 안정적인
키(예: 화면 진입 시 생성한 UUID)를 만들어 재시도에 같은 값을 쓴다.

**브라우저는 service_role 키를 쓰지 않는다.** 사용자 흐름 전체가 `authenticated`
권한으로 동작한다. service_role은 purge 워커(cron/edge function)에서만 쓰고, 그 4개
함수는 `anon`·`authenticated`에서 회수돼 있다.

### 멱등성

`app.idempotency_keys (user_id, operation, request_key)` 유니크. 흐름은
`begin_idempotent` → 작업 → `finish_idempotent`다.

- 처음 요청: 응답이 null인 클레임 행을 잡고 작업을 수행한 뒤 응답을 저장한다.
- 재요청: 저장된 응답에 `"replayed": true`를 붙여 돌려준다. 부작용은 다시 실행하지 않는다.
- 동시 중복 요청: 유니크 인덱스에서 대기하다가 앞선 트랜잭션이 커밋되면 그 응답을 재생한다.
- 도메인 실패: `app.error_result`가 클레임 행을 지운다. 실패는 기록하지 않으므로
  같은 키로 정당하게 다시 시도할 수 있다.
- 앞선 트랜잭션이 롤백된 직후: `conflict` / `idempotency_race`로 되돌려 재시도를 유도한다.

`register_visit_photo`는 `storage_path`가 자연 키라서 request key 없이도 같은 객체를
두 번 등록하면 `replayed: true`가 된다.

### 락

| 흐름 | 락 |
| --- | --- |
| `create_couple` | 호출자에 대한 `pg_advisory_xact_lock` → 활성 멤버십 중복 생성 차단 |
| `join_couple_with_code` | 호출자 advisory lock + 초대 행 `for update` + 커플 행 `for update` |
| `register_visit_photo` | 부모 `visits` 행 `for update` → ordinal 경합 차단 |
| `set_visit_tags` | 부모 `visits` 행 `for update` → 순서 재작성 경합 차단 |
| `disconnect_couple` | 커플 행 `for update` |
| `claim_purge_jobs` | `for update skip locked` → 워커 여러 개 안전 |

같은 코드로 두 사람이 동시에 join하면 두 번째 세션은 초대 행에서 대기하다가, 커밋
후 `status='active'` 조건이 더 이상 맞지 않아 0행을 받고 `invite_consumed`로 떨어진다.
멤버십 insert에는 `unique_violation` 핸들러가 있어 그마저 지나가도
`couple_capacity_reached`가 되고 500이 되지 않는다.

## 사진 스토리지

비공개 버킷 `visit-photos`. 객체 경로 규약이 정책의 근거다.

```text
visit-photos/<couple_id>/<visit_id>/<photo_id><확장자>
```

첫 세그먼트가 커플이므로 `app.try_uuid((storage.foldername(name))[1]) =
app.current_couple_id()` 한 줄로 커플 범위를 잠근다. select·insert·update가 이 조건을
쓰고, delete만 `visit_photos` 행의 `uploader_id = auth.uid()`를 추가로 요구한다.

**삭제 순서가 정해져 있다: 객체를 먼저 지우고 메타데이터 행을 나중에 지운다.** 행이
먼저 사라지면 delete 정책이 근거를 잃어 클라이언트가 객체를 지울 수 없게 되고, 그
객체는 purge 워커가 처리하게 된다.

`visit_photos`의 `content_type`·`byte_size`는 기록만 하고 **제약을 걸지 않았다.**
용량·형식 제한은 버킷 설정에 들어가야 하고 아직 확정값이 없다.

## 연결 해제와 삭제

`disconnect_couple` 한 트랜잭션에서:

1. `couples.status = 'disconnected'`, `disconnected_at` 기록
2. 모든 활성 멤버십에 `left_at` 기록
3. 활성 초대 코드 무효화
4. `app.purge_jobs`에 job 하나 큐잉 (`due_at = now() + 24시간`)
5. 삭제할 스토리지 객체 경로를 `app.purge_job_objects`에 스냅샷

접근 차단은 1·2번으로 **즉시** 이뤄진다. 모든 멤버십 헬퍼가 `status='active'`와
`left_at is null`을 요구하므로 커밋 순간 양쪽 사용자의 공동 데이터가 사라진다. 파일
경로를 미리 스냅샷하는 이유는 워커가 파일을 지울 시점에 메타데이터 행이 이미 없기 때문이다.

워커 순서: `claim_purge_jobs` → 스토리지 API로 파일 삭제 →
`mark_purge_objects_deleted` → `purge_couple_data` → `complete_purge_job`.
실패는 `last_error`를 남기고 다시 `queued`가 되며, `purge_max_attempts`를 넘기면
`failed`로 세워 두어 운영자가 추적한다.

`purge_couple_data`는 커플 범위 행을 모두 지우고 `couples` 행만 익명화해서
(`created_by`·`started_on` null, `purged_at` 기록) 남긴다. job의 외래 키가 유효하게
유지되고 삭제 감사 흔적이 남는다. 개인정보는 남지 않는다.

## 외부 게이트 대기 값

`app.config`에 `resolved = false`로 들어 있다. 마이그레이션 없이 값만 갱신할 수 있고,
SQL 안에는 어떤 하드코딩도 없다.

| key | 현재 | 정해지지 않으면 |
| --- | --- | --- |
| `invite_ttl_seconds` | **null (미정)** | **발급된 초대 코드에 유효기간이 없다.** 아래 위험 참고 |
| `photo_max_bytes` | **null (미정)** | 버킷 `file_size_limit`이 null이라 프로젝트 기본값이 적용된다 |
| `photo_allowed_mime_types` | **null (미정)** | 버킷 `allowed_mime_types`가 null이라 형식 제한이 없다 |
| `invite_attempt_max` | 10 (임시) | 임시값으로 동작한다 |
| `invite_attempt_window_seconds` | 600 (임시) | 임시값으로 동작한다 |
| `purge_max_attempts` | 10 (임시) | 임시값으로 동작한다 |

```sql
-- 값이 정해진 뒤 (예시)
update app.config set value = to_jsonb(86400), resolved = true where key = 'invite_ttl_seconds';
update storage.buckets set file_size_limit = <bytes>, allowed_mime_types = array[...] where id = 'visit-photos';
```

`create_couple` / `reissue_couple_invite` 응답의 `data.invite.ttl_unresolved`가 true면
그 코드는 만료되지 않는다는 뜻이다. UI에서 유효기간을 안내하려면 이 값을 봐야 한다.

## 기획에 없어서 판단이 필요했던 부분

명세가 답하지 않은 지점이다. 임의로 정하지 않고 가장 보수적인 쪽을 골랐으며,
다르게 가야 하면 알려주면 고친다.

1. **방문 기록 삭제에 클라이언트 정책을 만들지 않았다.** 명세는 "장소·날짜·시간·태그·
   꽃갈피는 두 사람 모두 **수정**할 수 있다"까지만 말하고 기록 자체의 삭제를 다루지
   않는다. 공동 작성물이라 한쪽이 상대의 한 줄까지 날릴 수 있게 되므로 정책을 넣지
   않았다. 필요하면 추가 마이그레이션으로 붙인다.
2. **가고 싶은 곳은 두 사람 모두 추가·수정·삭제할 수 있게 했다.** 작성자 제한 규칙이
   명세에 없고 "활성 커플 구성원만 조회·변경"이라는 일반 규칙을 따랐다.
3. **purge가 `profiles.display_name`을 비운다.** 이름은 상대에게 공유된 값이고 해제 후
   온보딩에서 다시 받으므로 함께 지웠다. 프로필 행 자체는 남긴다(익명 사용자 = 기기 귀속).
4. **`started_on`은 `Asia/Seoul` 기준 날짜다.** "함께한지 N일째"가 UTC 기준이면 한국
   사용자에게 하루 어긋난다.
5. **텍스트 길이 상한은 방어용이다.** 한 줄 1000자, 태그 200자·최대 20개, 이름 60자.
   명세에 없는 값이라 UI가 닿지 않을 만큼 넉넉하게 잡았다. 필요하면 조정한다.
6. **사진 순서 변경은 두 사람 모두 가능하다.** 명세가 사진에 대해 제한한 것은 삭제뿐이다.
   대신 `visit_photos_guard_immutable` 트리거가 `storage_path`·`uploader_id`·`visit_id`·
   `storage_bucket` 변경을 막아, 순서 변경 권한으로 상대 사진을 바꿔치기할 수 없게 했다.

## 남은 위험

1. **초대 코드에 유효기간이 없다.** `invite_ttl_seconds`가 미정인 동안 발급된 코드는
   만료되지 않는다. 6자리 숫자이므로 시도 제한(사용자당 10회/10분)과 커플당 활성 코드
   1개가 유일한 방어선이다. 게이트에서 가장 먼저 정해야 할 값이다.
2. **시도 제한이 사용자 단위다.** 익명 세션은 얼마든지 새로 만들 수 있어서, 세션을 계속
   갈아타는 공격자에게는 무력하다. IP나 디바이스 단위 제한은 이 레이어에서 불가능하다 —
   Edge Function이나 게이트웨이가 필요하다. 코드에 유효기간이 생기면 노출 창이 줄어든다.
3. **어떤 SQL도 실제 Postgres에서 실행되지 않았다.** Docker가 없어서 문법·타입 오류가
   남아 있을 수 있다. 특히 확인 못 한 것: `('x' || hex)::bit(28)::integer` 캐스트,
   `storage.objects` 정책 안의 `objects.name` 참조, `claim_purge_jobs`의 CTE +
   `for update skip locked` 조합, `foreach ... in array tg_argv`.
   **로컬 스택이 생기면 pgTAP보다 `supabase db reset`(마이그레이션 적용)을 먼저 돌릴 것.**
4. **storage 정책 마이그레이션이 실패할 수 있다.** `storage.objects`에 정책을 만들려면
   그 테이블의 소유권이 필요하다. 마이그레이션 롤이 부족하면 두 번째 파일만 실패하고
   스키마는 남는다 — 그때는 대시보드 Storage Policies에서 같은 4개 정책을 넣는다.
   파일을 분리해 둔 이유가 이것이다.
5. **`profiles`가 이미 다른 형태로 존재하면 완전히 흡수하지 못한다.** 컬럼 추가와
   `not valid` 제약까지는 안전하지만, 기본 키 타입이 `uuid`가 아니거나 `auth.users`를
   참조하지 않으면 수동 정리가 필요하다.
6. **`api.js` mock과 필드 이름이 다르다.** `entries[].text` ↔ `visit_entries.note`,
   `record.date` ↔ `visits.visited_at`, `record.rating`(기록 단위) ↔
   `visit_entries.rating`(사용자 단위). W1-B가 매핑을 흡수해야 한다. 특히 mock은 별점을
   기록 단위로 들고 있는데 명세상 별점은 개인 데이터다.
7. **`replenishPendingRecord()`는 mock 전용이다.** 실제 백엔드로 바꿀 때 함께 지운다
   (`CLAUDE.md`에 이미 적혀 있다).
