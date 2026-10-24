# Task

Iteration 6D — C10 / AP-6C-REFUND (MAJOR / P0), 2026-10-24.

## Goal

기준 SPEC `docs/ITERATION-6D-SPEC.md`의 결정적 PostgreSQL 재현과 최소 환불 수정에 필요한 검증 순서를 정한다.

**Verdict: Gate 0 SATISFIED / Q6D-01 RESOLVED / conditional BUILD gate ACTIVATED.** 흥영 결정(2026-10-24)에 따라 `lib/e2e/phase20-cleanup.ts`는 TEST-ONLY로 production lock-order contract에서 제외한다. 계약은 결제 생성, 확정/일괄확정, 환불 및 관련 ADMIN production write paths에 적용한다. 금융 정책 변경 없음. 원본 실제 PG 재현 Gate 2는 아직 미충족이다.

현재 step 1 권한은 SPEC/PLAN 결정 기록과 신규 재현 integration test 및 companion 두 건 작성이다. `lib/payments/core.ts` 및 모든 제품 코드는 원본 그대로 둔다. stage/commit/push/CI dispatch는 하지 않는다. 향후 commit/CI 증거 체인은 계획이며 현재 권한을 넓히지 않는다. PR merge / Schema Gate 승인 / deployment는 범위 밖이다.

## Current State

- 기준 HEAD `09f404a21a07e0cd189404aefab7a3a7c1d8cbfa`, branch `feature/phase21-ai-service`; 문서 작성 전 baseline clean; 이번 step 1 시작 시 두 문서는 uncommitted 상태다. PR #54 Draft는 사용자 제공 전제.
- 먼저 Prisma 모델을 확인했다: `prisma/schema.prisma:800` Payment, `:819` PaymentItem, `:838` Refund. 정확한 end-to-end 경로와 **단일 lock-order table L01–L12**는 [SPEC의 Current Process](./ITERATION-6D-SPEC.md#current-process)에 있다. 여기서 별도 축약표로 조사 범위를 바꾸지 않는다.
- 현재 refund tx는 `lib/payments/core.ts:114/:120` item만 FOR UPDATE → `:136` Refund → `:147` item → `:152` unlocked aggregate → `:159` parent UPDATE다. 옵션 `:21`: maxWait 10초 / timeout 20초, isolationLevel 미지정.
- 모든 item amount/counter와 실제 Refund 합계가 맞아도 shared parent 상태가 stale일 수 있다는 **INFERENCE**다. **원본 재현 NOT EXECUTED / NOT REPRODUCED, 수정 후 검증 NOT EXECUTED**. VM에 PostgreSQL이 없으며 DB에 연결하지 않는다.
- 일반 원장 관련 결제 writer는 수동 신규 생성(L01), 환불(L02), 선택/일괄확정의 신규 생성(L03/L04), 합성 삭제(L10)다. return-obligation 경로(L06–L08)는 별도 원장이고 이 모델들을 변경하지 않는다. manual_test writer(L11)는 별도 schema/run lock이므로 public과 구분한다.
- L10 삭제 tx는 lease/group lock 아래 item을 먼저 DELETE한다. refund action `app/(admin)/payments/actions.ts:92–102`는 해당 mutex를 취득하지 않는다. cleanup의 사전 refund.count `lib/e2e/phase20-cleanup.ts:155`는 동일행 상호배제 장치가 아니다.
- 따라서 **cleanup holds I, refund holds P → cleanup waits P, refund waits I**의 순환이 가능하다. 이는 정적 충돌/조건부 deadlock 추론이며 런타임 deadlock 관찰 결과가 아니다. 현재 허용된 수정 파일에 cleanup은 없다.
- 과거 회귀 evidence는 `docs/ITERATION-6C-REPORT.md:41–42`: 실제 PG 6 files / 87 tests, unit 206 files / 2557 tests. 이는 과거 기준값이며 이번 세션에서 재실행한 결과가 아니다. 새 CI에서는 기존 모든 사례와 추가 사례 수를 분리 보고한다.

### Gate 0의 해결 기록 — 흥영, 2026-10-24

**Q6D-01 RESOLVED.** `phase20-cleanup`은 격리된 E2E teardown에서 합성 데이터에만 실행하고 production writer와 절대로 동시에 실행하지 않는다. 이 실행 제약 아래 item→parent DELETE는 production lock-order contract의 대상이 아니다. cleanup을 live/production dataset에 연결해서는 안 된다. 이는 DB 수준 mutex를 추가하거나 public namespace를 바꾼 결정이 아니다.

합성 전용 파일 근거: `lib/e2e/phase20-cleanup.ts:5–8` synthetic-group-only 설명, `:23–25` run ID/marker, `:67–69` broad selector 거부, `:75–79/:96–105` lease 및 syntheticRunId 범위, `:147–156` mapped item 소유권과 unowned item/Refund fail-closed, `:177–192` 외부 의존성 거부. 이 근거는 소유권을 좁히며 ADMIN refund와의 상호배제를 증명하지 않는다.

**수용된 잔여 위험:** 제약 위반으로 cleanup이 같은 Payment의 live refund와 동시에 실행되면 위 정적 cycle은 그대로 적용된다. 흥영은 이 조건부 위험을 수용했으며 cleanup 코드/삭제 순서는 변경하지 않는다. conditional BUILD gate **ACTIVATED**; 금융 정책 변경 없음. L01–L12 조사와 FK/암묵적 lock 한계를 보존하고 새로운 정책/Open Question이 생기면 STOP한다.

## Data Model

schema/migration 변경 **없음**. 트리거·컬럼·상태·제약 추가 없음. 신규 DB 적용·Schema Gate도 없다. CI에서는 기존 migration만 disposable DB에 적용한다.

- 기존 DB 책임: `prisma/schema.prisma:822` reservationId unique, `:830` Payment FK(CASCADE), `:849–850` Refund item/처리자 FK. `prisma/migrations/20260820050000_init/migration.sql:54–55`는 금액 비음수, paid=amount−discount, 0≤refunded≤paid, Refund 양수를 보장한다. mapping unique/FK는 `schema.prisma:703–708`.
- 서버 책임: 최신 locked item을 읽어 cap/NO_SHOW 사유를 검증하고, Refund INSERT·counter·parent 상태를 하나의 tx에 넣는다. DB의 개별 행 CHECK는 부모의 cross-row 합계나 Refund 합계=counter를 보장하지 않는다.
- PaymentItem.paymentId는 현 public writer 조사에서 생성 이후 변경되지 않는다. DB 수준 immutable 제약이라고 부르지 않는다. 후보의 초기 lookup 뒤 target lock에서 관계를 다시 검증한다.
- 감사 oracle: 각 item의 실제 COMPLETED Refund 합계와 refundedAmount를 별도로 합산·비교한 뒤, 전체 paid/refunded 합계와 저장 parent 상태를 비교한다. production resolvePaymentStatus만 oracle로 사용하지 않는다. 검증 시 0원/기존 CANCELLED 결제의 정책을 새로 정의하거나 전체 데이터 복구를 하지 않는다.

## API

새 Route Handler/Server Action이나 client API를 추가하지 않는다. createRefundCore의 input/output, 기존 오류 유형, ADMIN·Zod adapter를 보존한다. lib/payments/core.ts 이외의 금융 구현은 수정하지 않는다.

Gate 0와 원본 재현 Gate 2가 모두 통과했을 때만, 다음 후보를 BUILD가 구현한다:

1. 기존 interactive transaction 안에서 paymentItem ID로 paymentId만 조회한다. absence → PaymentItemNotFoundError.
2. **Payment SELECT … FOR UPDATE**를 먼저 얻는다. parent absence → 같은 PaymentItemNotFoundError.
3. 현재 item JOIN/`FOR UPDATE OF pi`를 실행하고 최초 paymentId와 현재 관계가 일치하는지 재검증한다. absence/불일치 → PaymentItemNotFoundError, 쓰기 없음. locked item의 최신 paidAmount/refundedAmount 및 Reservation status/attendance만 이후 판단에 쓴다.
4. 기존 상세 사유 trim·NO_SHOW/ABSENT 검사, 양수·누적 cap 검사를 유지한다. 예약 상태를 eligibility 차단 조건으로 추가하지 않는다.
5. COMPLETED Refund INSERT → item counter UPDATE.
6. parent lock을 보유한 채 **모든 sibling items**를 aggregate한다. 다른 refund는 parent에서 직렬화되므로 READ COMMITTED의 새 문장이 먼저 commit한 형제 변경을 포함해야 한다. siblings 전체 잠금이나 전역 advisory lock은 추가하지 않는다.
7. 기존 resolvePaymentStatus로 parent UPDATE → 같은 tx commit. 어떤 예외라도 세 모델 전부 rollback.

후보의 금융 partial order는 **Payment(parent) FOR UPDATE → PaymentItem(target) FOR UPDATE → Refund/item 쓰기 → 전체 aggregate → Payment.status 쓰기 → commit**이다. 현재 **적용된 final lock order는 여전히 item → parent**이며 어떤 코드도 변경하지 않았다. L03/L04의 Submission → Application → ClassSchedule → Child → 새 Payment → 새 item 순서는 보존한다. Q6D-01 결정에 따라 이 순서는 production write paths의 계약이며 TEST-ONLY L10이나 모든 외부 SQL에 대한 global order라고 표현하지 않는다.

PaymentItemNotFoundError / RefundAmountExceededError / NoShowRefundDetailRequiredError를 보존한다. createPaymentCore의 ReservationNotFoundError / DuplicatePaymentError도 바꾸지 않는다. 재시도·새 refund policy·isolationLevel 변경·timeout 변경으로 잠금 문제를 우회하지 않는다.

## UI

UI 변경 없음. 기존 환불 form·상태 표시·loading/empty/error 흐름과 cache invalidation을 유지한다. transaction·DB lock은 server 전용이다. Client Component에 DB 로직이나 controller barrier를 넣지 않는다. 새 UI acceptance가 없으므로 새 E2E/모바일 테스트 실행은 필요하지 않다. 기존 UI 테스트를 서버 assertion으로 대체하거나 삭제하지 않는다.

## Tests

### 실행 환경과 허용 파일

- 신규: `tests/integration/reservation-applications/payment-refund-concurrency.test.ts`와 필요한 경우 같은 디렉터리의 test-only helper. **기존 integration include glob 안에 둬** workflow/config를 바꾸지 않는다 (`vitest.integration.config.ts:13`).
- 조정 가능: `tests/unit/payments/core.test.ts`의 실제 추가 조회/잠금에 필요한 mock 계약과 관련 assertion. 다른 테스트는 새 검증에 꼭 필요할 때만 수정하며 이유를 기록한다. 확인/배정/반환 로직·수치·기존 기대를 변경하지 않는다.
- unit-only 또는 mocked aggregate로 concurrent 결과를 증명할 수 없다. 아래 새 항목은 전부 실제 PG integration으로 검증한다. principal/auth·Next cache/redirect 경계 seam을 stub할 때는 그 한계를 기록하고 DB tx/lock/aggregate/commit은 실제 실행한다.
- 실제 route는 기존 `.github/workflows/phase2-integration.yml:15/:46–56`: isolated postgres:16 → safe runtime verification → ephemeral NOLOGIN roles → 기존 migrate deploy → `npx vitest run --config vitest.integration.config.ts`. VM PG 설치/DB 우회/Preview·Production 대체 실행은 하지 않는다.
- 새 client 생성 전 기존 URL safety + VERCEL_ENV/Preview mode 차단. 실제 DB/user/version(16xxxx)와 worker tx READ COMMITTED를 확인한다. 기본 schema/기존 isolation 변경 없음.

### 결정적 barrier의 구현 계약

SPEC의 재현 1–10이 필수 계약이다. 하나의 Payment에 40,000짜리 두 항목, ADMIN 두 명을 실제 합성 DB에 만들고 모든 fixture를 commit한 뒤 시작한다.

- C(controller), W1/W2(refund), O(observer)는 각각 별도 PrismaClient/connection이며 interactive tx 내부에서 pg_backend_pid()를 얻어 네 PID의 독립성을 증명한다. 필요하면 안전 검증된 URL의 test connection_limit만 1로 정한다. 연결 문자열은 출력하지 않는다.
- C의 parent **FOR NO KEY UPDATE 성공 handshake** → workers 시작 → O의 **두 parent lock wait 관찰** → C release → 두 worker commit/settle → fresh committed invariant 읽기 순서다. C의 gate와 worker tx promises를 test가 소유한다. 임의 delay·pg_sleep·bare Promise.all을 interleaving 증명에 사용하지 않는다.
- O는 pg_stat_activity의 고정 statement class, pg_locks 및 pg_blocking_pids의 **blocker graph가 C에 도달함**을 검사한다. 두 번째 worker가 첫 번째를 기다리는 queue도 인정한다. controller가 가진 fixture parent와 worker의 대상 parent가 같음을 test wrapper가 보존한다. relation-level RowExclusiveLock 하나만으로 row lock 획득을 단정하지 않는다.
- wrapper는 actual Prisma transaction callback과 쿼리를 forwarding한다. PID, stage, 실제 aggregate의 숫자 결과, commit/rollback outcome만 기록한다. production hook·schema hook·DB trigger는 추가하지 않는다. 이 패턴의 선례는 `confirmation-atomicity.test.ts:110/:116`의 실제 tx 안 fault injection이다. 타입 단언은 테스트 adapter 경계에 제한하고 실제 메서드 binding과 transaction options를 유지한다.
- **원본**: C release 전에 W1/W2 모두 parent UPDATE에서 대기하며 각각 aggregate(paid=80,000, refunded=40,000)가 완료됐음을 증명한다. 두 item critical section 진입/진행과 양쪽 미commit 상태를 증명하지 못하면 barrier failure다.
- **수정 후**: 같은 wait predicate는 parent SELECT FOR UPDATE 대기에서도 성립해야 한다. parent lock 전의 두 worker에게 aggregate 도달을 강제하지 않는다. 실제 관찰 단계는 고정된 enum으로 기록하고, 수정 후 parent wait → target item 순서를 확인한다.
- 정상상태 oracle는 두 버전에서 동일하게 parent=REFUNDED다. 원본의 두 success, full counters/Refund, 정확한 actor를 먼저 assert하고 마지막 parent assertion만 실패해야 예상 red다. `it.fails`, skip, 테스트 삭제, status expectation을 PARTIAL_REFUNDED로 바꿔 green으로 만드는 방식은 금지한다.
- poll은 fresh 조회를 반복하고 predicate에만 반응한다. poll deadline은 core 20초보다 짧게(구현 시 예: 8초) 설정하고 Vitest/controller에는 정리 여유를 준다. deadline·DB error는 별도 barrier/environment failure로 기록한다. 이것을 stale-parent 증거로 분류하지 않는다. 고정 sleep에 성공 여부를 의존하지 않는다.
- finally: controller gate release → controller/worker 모든 promise allSettled로 join(늦은 reject 포함) → 소유 ID 범위의 Refund/mapping/allocation 등 FK순 cleanup → 모든 clients disconnect. cleanup을 진행 중인 refund tx와 겹치게 만들지 않는다. 상한 시간 초과 시에도 pending gate를 방치하지 않는다.

### 요건–검증 추적 및 real-PG matrix

N은 신규 suite `tests/integration/reservation-applications/payment-refund-concurrency.test.ts`다. 각 case 후 단일 일관된 committed snapshot에서 직접 Refund 합계/item counter/parent 상태를 검사한다. 공통 invariant가 별도 case의 정상·거부 assertion을 대신하지 않는다.

| AC / 요건·ADR 근거 | 지켜야 할 결과 | 정상 / 거부·경합 케이스 | 검증 수준 | 예정 테스트 위치 |
| --- | --- | --- | --- | --- |
| AC01/02; §12.3/13, ADR-005/007 | 서로 다른 item 전액 환불 후 parent=REFUNDED, 두 counter/Refund full | 한 부모·40,000×2, ADMIN A1/A2·독립 PID, controller barrier. 원본은 마지막 parent assertion만 red, fix는 green | **실제 PG16 integration** | N: different-items-full-refund / 원본·수정 동일 회귀 case |
| AC03; §13.4, ADR-007/036 | 동일 항목 누계≤40,000, 실패 쓰기 0 | 40,000+40,000 → 정확히 1 success/1 RefundAmountExceededError; 10,000+30,000 → 2 success; 이후 1원 거부. 첫 worker target lock 이후 gate, 둘째가 item(원본) 또는 parent(수정)에서 실제 대기함을 관찰하고 release | **실제 PG16 integration** | N: same-item-full / same-item-partials / over-refund |
| AC04/07; §12.3/13, ADR-007/036 | partial/full 합계에 맞는 parent, Refund 합계=counter | 두 항목에 10,000+40,000 경합(원본과 같은 parent barrier) → 50,000/80,000 PARTIAL_REFUNDED; 잔여 30,000 완료 → REFUNDED. refund 0인 초기 PAID도 확인 | **실제 PG16 integration** | N: mixed-partial-full / remaining-full |
| AC05; 기존 거래 독립성 | 다른 Payment는 독립적으로 완료 | C가 P1만 hold, W1 대기 확인; P2 refund commit을 먼저 관찰한 뒤 P1 release. P2가 완료하기 전 P1을 풀어 통과시키지 않음 | **실제 PG16 integration** | N: independent-payments |
| AC06/07; ADR-007, ARCHITECTURE §10 | Refund/item/parent 모두 atomic rollback | 실제 Refund INSERT 후 throw, 실제 counter UPDATE 후 throw, 실제 parent UPDATE 후 callback 반환 전 throw를 각각 injection. before/after 세 모델·updatedAt·합계 동일, ledger 불변, 후속 정상 refund 가능 | **실제 PG16 integration** | N: late-refund-failure.each(stage). 기존 패턴: confirmation-atomicity `:114`, workflow-races `:130` |
| AC07; ADR-007 | 실제 completed Refund 합계와 모든 item counter, 부모 상태가 일치 | 모든 success/rejection/rollback/race join 후 직접 합산, cap/금액 고정·counter 중복 없음. helper가 production status 함수를 그대로 oracle로 쓰지 않음 | **실제 PG16 integration** | N 공통 assertRefundState + 각 case의 구체 금액 assertion |
| AC08; Phase20 보존식, ADR-060 | D=A+P+R+T, 확정 후 Refund가 A/P/R/T를 바꾸지 않음 | D=P=80,000 fixture에서 전액 refund 전후 동일. 별도 D=100,000/P=80,000/R=15,000/T=5,000/A=0 fixture(기존 excess hold/return core로 생성)도 partial/full 후 동일. mapping/allocation/return rows 불변 | **실제 PG16 integration** | N: ledger-conservation; 재사용 confirmation-atomicity `:170–175`, workflow-races `:78` |
| AC08/10; §14.3–14.7, ADR-040/041 | Revenue는 실제 Refund 처리일·item 금액/필터를 유지 | DB facts query로 paid=80,000/refund=50,000/net=30,000, full 후 net=0. 결제와 환불 날짜가 다른 KST 기간, 환불 여부/수단 필터도 검사. Return은 Refund/Revenue에 들어오지 않음 | **실제 PG16 integration** + 기존 unit 회귀 | N: revenue-regression; confirmation-atomicity `:173–175`; `tests/unit/revenue/{queries,aggregate,period,validation}.test.ts` |
| AC09; §13.1/13.3, ADR-033–039 | 기존 자격·사유·예외 계약 | RESERVED/COMPLETED/CANCELLED는 정상, NO_SHOW 또는 CANCELLED+ABSENT 빈 detail 거부·유효 detail 허용. 0/음수·초과 거부, missing item PaymentItemNotFoundError. 거부 후 세 모델 변화 0, Reservation 원상태/attendance 유지 | **실제 PG16 integration** + 기존 unit 회귀 | N: refund-policy.each; `tests/unit/payments/{core,validation}.test.ts` |
| AC09; §17.5–17.6, ADR-050 | 서버 ADMIN·입력 경계 유지, 처리자 위조 불가 | sequential action case에서 실제 requireAdminPrincipal은 유지하고 principal 공급 seam만 제어. ADMIN 정상; MANAGER/TEACHER/미인증·잘못된 정수/사유 거부 후 실제 DB 쓰기 없음. processedById는 principal 값. 이 seam을 Auth.js HTTP/session 통합 검증으로 주장하지 않음 | **실제 PG16 integration** (DB는 실제) + 기존 principal unit | N: action-boundaries; `tests/unit/auth/principal.test.ts`, `tests/unit/payments/queries.test.ts:90` 재사용 |
| AC09; 기존 개인정보 최소화, ADR-050/057/058/060 | 새 수집/노출 없이 합성 자료만 사용 | barrier/진단 결과는 PID·stage·금액·고정 오류만. 관련 없는 DB 보호자 PII sentinel이 error message/log/진단에 나오지 않음을 검사하되, 자기 입력 values의 기존 form 반환은 유지. raw SQL/parameters, URL/credential, 실제 고객 자료 기록 금지 | **실제 PG16 integration** + 산출물 Review | N: safe-diagnostics / rejection assertions. 기존 privacy/unit는 유지; 새 공개 UI 없음 |
| AC10; L01–L12 lock survey | deadlock 검증 범위 명시, 충돌 은폐 없음 | Gate0는 TEST-ONLY 제외 결정으로 충족. production 범위에서 동종 refund full/same-item/independence 경합에서 SQLSTATE 40P01/예상 밖 transaction failure 없음. L01/L03/L04는 기존 생성/확정 actual-PG cases 재사용 | **실제 PG16 integration + 정적 Review** | N 및 기존 confirmation-atomicity/workflow-races. L10 live-overlap 위험은 수용됨; cleanup 변경/동시 live 실행 검증은 이번 범위 밖 |
| AC10; 기존 회귀 유지 | 기존 PG87·unit suites 전부 green | 6개 기존 integration suite 유지 + N 추가 수 분리. 기존 failure/skip를 새 기대치로 숨기지 않음 | **실제 PG16 integration** + full unit | 기존 integration glob 전체, `npm test` |

권한 검증과 금액 경합 검증은 서로 대체하지 않는다. 새로운 browser UX 요구가 없으므로 E2E는 이번 과제의 검증 수준이 아니다. 기존 Preview/Production 안전 정책을 완화하지 않는다.

## Acceptance Criteria

완료하려면 SPEC AC01–AC10 및 다음 증거 체인이 필요하다. **Gate 0만 충족되었으며 실제 PG 재현/수정 검증은 아직 충족했다고 보고하지 않는다. Step 1은 아래 전체 matrix 중 reproduction + same-item-full + independent-payments 세 case만 작성한다. partial/full mix, atomic rollback 및 나머지 matrix 보완은 fix 단계다.**

1. 원본 test-only checkout에서 core blob이 baseline과 동일하고 실제 PG16 재현이 지정 parent assertion만 실패한 red. exact commit SHA + CI run/job URL + 실제 checkout SHA(merge ref면 별도 표기) + version/isolation + distinct PIDs + barrier stage + committed counters/Refund/status를 남긴다.
2. fix checkout에서 같은 테스트/정상상태 assertion이 green이며 원본 재현 테스트가 삭제·완화되지 않았음을 diff로 증명한다. fix code/test SHA, 실제 CI checkout SHA, 전체 integration 결과를 연결한다.
3. atomicity, same-item cap, mixed/independent parent, per-item completed Refund 합계, parent 상태, D=A+P+R+T 및 전후 D/A/P/R/T 불변, Revenue·policy 회귀가 모두 실제 PG에서 통과한다.
4. lint/full unit/typecheck/build 정책을 충족하고 독립 QA·Review가 범위를 명시해 PASS한다. 실패하면 BUILD developer로만 돌아가 수정하고 영향 있는 QA/Review/CI를 재수행한다.
5. source survey에서 기존 역순 path 처리와 최종 적용 lock order가 명확하다. 샘플 경합 통과를 모든 환경·외부 SQL·혼합 버전의 deadlock 부재 증명으로 확대하지 않는다.

## Risks

- **수용된 L10 잔여 위험:** 같은 public table의 item→parent DELETE는 남는다. TEST-ONLY 격리 teardown/합성 전용/production writer와 비동시 실행 제약으로 계약에서 제외했다(흥영, 2026-10-24). 제약 위반 시 같은 Payment의 live refund와 정적 cycle이 적용된다. live/production dataset 대상 cleanup 금지. 금융 정책 충돌 없음.
- **재현 불확실성:** C10 stale 상태는 아직 관찰되지 않았다. 원본 barrier 미성립·PG 환경 실패·transaction timeout·deadlock·두 commit 미완료 또는 재현 정상 결과는 NOT REPRODUCED다. code-risk와 verification limit를 기록하고 fix build 전에 STOP한다.
- **관찰 도구 한계:** pg_locks가 모든 row lock을 열거하지 않는다. worker PID·실제 query stage·completed aggregate·pg_blocking_pids 그래프를 함께 써야 한다. SQL query 원문/parameters는 log하지 않는다.
- **격리 전제:** 기존 tx isolation을 변경하지 않는다. CI에서 READ COMMITTED 전제가 다르면 중단하고 survey/재현 설계를 다시 검토한다. REPEATABLE READ/SERIALIZABLE를 이번 결과로 검증했다고 주장하지 않는다.
- **혼합 버전:** 기존 item→parent refund와 새 parent→item refund가 같은 행에서 겹치면 또 다른 역순 조합이다. CI는 원본·fix를 별도 실행한다. rolling deployment나 진행 중 구버전 요청과의 overlap 안전성은 검증하지 않으며 배포는 범위 밖이다.
- **금융 보관/정책:** 기존 거래기록 PII 보관기간 미결정은 유지한다. 테스트는 합성 데이터만 사용하고, 환불·취소·노쇼·원장·Revenue 의미를 새로 정하지 않는다. 신규 정책 질문이 생기면 SPEC으로 되돌아가 STOP한다.
- **범위:** cleanup 해결을 포함해 허용 범위를 넘는 수정을 코드/테스트 편의라는 이유로 끼워 넣지 않는다. schema/migration, confirmation/allocation/return-obligation 구현, perf 재실행, Preview/Production, PR merge/Schema Gate/deploy 금지.

## Implementation Order

다음은 Gate 0 해결 이후의 순서다. 이번 step 1은 0의 결정 기록과 1의 재현 테스트 작성/로컬 정적·unit 검증까지다. 코드 변경은 예외 없이 `$yaho-build` developer subagent만 수행한다. QA/Review 역할은 코드/파일을 수정하지 않는다.

1. **Gate 0 — lock-order conflict check (SATISFIED).** L01–L12/FK/public·manual_test 경계를 유지하고 흥영의 Q6D-01 TEST-ONLY 제외 결정을 SPEC/PLAN에 기록했다. conditional BUILD gate ACTIVATED. 금융 정책/Open Questions 없음. cleanup 역순 제거/강제 mutex가 구현되었다고 주장하지 않는다.
2. **Gate 1 — Reproduction test BUILD / 원본 코드 유지.** 허용된 developer가 N 및 필요한 test-only helper만 작성한다. fixture/barrier/PID/정리/failure classification을 준비한다. core blob을 baseline과 비교하고 lint/typecheck/unit로 test adapter를 검증한다. 이 준비가 끝나야 CI 재현으로 진행한다. VM에 PG가 없다는 사실을 real-PG PASS로 대체하지 않는다.
3. **Gate 2 — CI reproduction evidence.** 향후 승인된 Git/CI 작업 단계에서 **(a) test-only commit**을 원본 core 위에 만든다. 기존 Phase 2 workflow만 사용한다. test-only SHA, core 동일성, 실제 checkout SHA/run/job URL을 고정한다. PG16/READ COMMITTED·barrier·두 성공 commit·full counter/Refund가 모두 증명되고 마지막 parent REFUNDED assertion만 actual PARTIAL_REFUNDED로 실패해야 재현 PASS다. CI 자체는 의도한 red이며 merge할 수 없다. 다른 실패면 NOT REPRODUCED + STOP; 재현되지 않은 채 fix로 진행하지 않는다. 현재 no-commit/no-CI 세션에서는 수행하지 않는다.
4. **Fix BUILD — core 최소 수정.** Gate 0와 원본 재현 evidence가 모두 충족된 후에만 위 API 후보를 구현한다. 같은 회귀 테스트를 유지하고 matrix를 보완한다. core 외 product code, exception 계약, policy, schema, confirmation/allocation/return-obligation 변경이 필요해지면 STOP하고 범위를 재검토한다. 필요한 unit mock만 조정한다.
5. **QA — 실제 요구사항 검증.** 독립 `$yaho-qa`가 SPEC/PLAN AC 추적, 원본 red 증거의 정확한 실패 이유, fix 동작, test oracle·barrier·cleanup를 확인한다. 로컬 PG 미실행 항목은 CI 증거 대기로 명시하고 final PASS를 선취하지 않는다. 결함 발견 시 보고만 하고 BUILD로 돌려보낸다.
6. **Review — 코드/잠금/보안 검토.** `$yaho-review`가 QA의 가용 결과와 diff를 검토한다. parent 선잠금, 최신 relation/amount 재검증, 하나의 tx, 모든 writer의 역순 처리, 실제 DB oracle, safe diagnostics, 허용 diff를 확인한다. 파일을 직접 수정하지 않는다. QA의 CI 대기 항목은 최종 CI 뒤 닫아야 한다. changes required면 BUILD → 관련 QA → Review 순으로 반복한다.
7. **Gate 3 — CI full verification.** 향후 승인된 Git/CI 단계에서 **(b) fix commit**을 만든 뒤 기존 Phase 2 integration 전체 **기존 87 + 신규**와 quality CI(lint/full unit/build)를 전부 실행한다. fixture cleanup·deadlock/timeout·skip와 각 invariant를 확인한다. exact fix/tested checkout SHA를 연결한다. red evidence SHA와 fix SHA 사이 코드/테스트 diff도 보존한다. 실행된 것이 merge checkout이면 exact-head와 구분하고 파일/blob 동일성을 검증한다. source가 다시 바뀌면 영향 있는 checks와 QA/Review를 재실행한다. QA/Review는 CI 대기 항목을 닫고 최종 PASS해야 한다. CI green만으로 Schema Gate나 merge/deploy를 승인하지 않는다.
8. **Gate 4 — completion report.** Changed / Tests / Lint / Build / Risks / Next 형식으로 아래 항목을 명시한다. 모든 조건이 충족되지 않으면 완료나 관찰된 결함으로 과장하지 않는다.

로컬 검증 명령은 필요한 구현 이후 `npm run lint`, `npm test`, `npx tsc --noEmit`이다. `npm run build` **직전에는 반드시** `pgrep -f "next dev"` 등 포트 비의존 process 확인을 한다. dev가 있으면 build를 생략하고 typecheck + lint + test로 대체한 사실을 보고한다. 기존 CI의 build 성공과 로컬 생략을 구분한다. 이번 step 1에서는 신규 파일을 포함해 typecheck/lint 및 full unit suite를 실행한다. 실제 PostgreSQL 실행은 로컬 **NOT RUN**, 기존 CI 단계 대기다.

### 향후 완료 보고 필수 내용

- **Changed:** 실제 허용 diff, baseline/fix/test-only SHA, 최종 적용 lock order. step 1은 문서 두 개 + 신규 integration test 하나이며 제품 코드의 적용 order는 원본 item→parent라는 사실.
- **Tests:** 원본 재현 OBSERVED 또는 NOT REPRODUCED와 정확한 assertion/한계, post-fix 결과, CI job·checkout, 기존87+신규·unit 수, same/different item·independent payments·rollback·Refund/counter/parent invariant, D/A/P/R/T before/after와 보존식, Revenue/policy 결과.
- **Lint:** 실제 실행 여부·결과. 과거 성공을 이번 실행으로 표기하지 않음.
- **Build:** dev process 확인·실행 또는 대체, typecheck/CI 결과. step 1의 실제 실행/대체 결과를 기록한다.
- **Risks:** L10 해소 근거와 deadlock 검증 scope(정적 전체 writer + 실행한 동종 경합), mixed-version/외부 SQL/운영 부재 등 실제 미검증 범위. 정책 변경 유무.
- **Next:** 남은 gate 또는 완료 시 인계. PR merge / Schema Gate 승인 / deployment는 수행하지 않았다고 구분.

**현재 상태: Q6D-01 RESOLVED / Gate 0 SATISFIED / conditional BUILD gate ACTIVATED. Step 1은 원본 코드 위 재현 테스트 작성까지다. 실제 PG 재현·invariant·deadlock 검증은 로컬 NOT RUN / NOT EXECUTED. CI 예상 결과는 Payment.status assertion의 observed PARTIAL_REFUNDED vs expected REFUNDED로 FAIL(재현 evidence)이며, 아직 관찰 결과가 아니다. Gate 2 evidence 전 fix BUILD 금지; stage/commit/push/CI dispatch 없음.**
