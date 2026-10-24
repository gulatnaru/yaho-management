# Requirement

Iteration 6D — C10 / AP-6C-REFUND (MAJOR / P0), 2026-10-24.

**Verdict: Q6D-01 RESOLVED — 흥영 결정(2026-10-24)에 따라 TEST-ONLY cleanup은 production lock-order contract에서 제외한다. Gate 0 충족, 조건부 BUILD gate ACTIVATED. 금융 정책 변경 없음. 원본 PostgreSQL 재현 Gate 2는 아직 미충족이며 이번 step 1은 원본 코드 위 재현 테스트 작성까지만 허용한다.**

현재 step 1은 Q6D-01 결정의 SPEC/PLAN 반영과 신규 integration 재현 테스트만 작성한다. `lib/payments/core.ts`를 포함한 제품 코드는 원본 그대로 유지한다. stage/commit/push/CI dispatch는 하지 않는다. 아래 최소 수정 설계는 조건부 승인되었으나 실제 fix BUILD는 원본 CI 재현 evidence 확보 뒤 별도 단계다.

- 확인한 baseline: `09f404a21a07e0cd189404aefab7a3a7c1d8cbfa`, `feature/phase21-ai-service`; 문서 작성 전 baseline clean; step 1 시작 시 SPEC/PLAN 두 파일은 uncommitted 상태다.
- PR #54 Draft는 사용자 제공 전제다. 이 작업에서 PR 상태를 변경하거나 원격 상태를 재검증하지 않았다.
- 발견 근거: `docs/ITERATION-6C-REPORT.md:121` C10 및 `:135`의 추론. 기존 기록의 런타임 영향은 **INFERENCE**다.
- 현재 재현 결과: **NOT EXECUTED / NOT REPRODUCED**. 테스트 작성과 PostgreSQL이 없는 VM에서의 정적 조사는 재현 증거가 아니다.
- Memory는 보조 자료로만 읽었다. `agent-memory-repo` SKILL.md는 로컬 검색에서 발견하지 못했다. 저장소와 현재 요청으로 판단했고 Memory는 수정하지 않았다.

## Problem

한 Payment에 속한 서로 다른 PaymentItem의 전액 환불은 각 항목의 상한을 지키더라도 부모 Payment.status를 잘못 남길 가능성이 있다. 환불별 트랜잭션은 자기 항목만 잠그고, 모든 항목의 환불 합계를 잠금 없는 SELECT로 계산한 뒤 부모에 저장한다. 부모 UPDATE가 직렬화되는 시점에는 저장할 상태가 이미 계산되어 있다.

목표는 이 추론을 먼저 실제 PostgreSQL 16에서 결정적으로 검증하고, 재현될 때 승인된 잠금 설계로 고치는 것이다. **두 항목의 전액 환불은 성공했지만 부모가 REFUNDED가 아닌 상태**를 관찰해야 C10의 재현으로 인정한다. timeout, deadlock, fixture 오류, 단일 환불 실패는 그 증거가 아니다.

## Current Process

### 환불 진입부터 commit까지

1. `app/(admin)/payments/actions.ts:88`의 createRefund는 `:92`에서 현재 ADMIN principal을 요구하고 `:94`에서 Zod를 검증한다. 처리자 ID는 입력을 신뢰하지 않고 `:101`에서 principal에서 전달한다. 스키마는 `lib/validation/payment.ts:21`이며 양의 정수 금액·기존 사유를 받는다.
2. `lib/payments/core.ts:110`의 createRefundCore는 `:111`에서 interactive transaction을 연다. 옵션은 `:21`의 maxWait 10초 / timeout 20초다. isolationLevel은 지정하지 않는다. `lib/db/prisma.ts:5`도 기본 PrismaClient다. 실제 CI에서는 transaction isolation이 READ COMMITTED인지 확인해야 한다.
3. `core.ts:114`의 JOIN SELECT는 `:120`에서 **FOR UPDATE OF pi**만 얻는다. Reservation은 조회할 뿐 잠그지 않고 부모 Payment도 잠그지 않는다. 항목이 없으면 `:122` PaymentItemNotFoundError.
4. `:124`에서 상세 사유를 trim하고, `:127`에서 NO_SHOW 또는 attendance=ABSENT이면 상세 사유를 요구한다. CANCELLED로 바뀐 NO_SHOW 이력도 동일하다. 실패는 NoShowRefundDetailRequiredError.
5. `:131`에서 최신 항목 누계 + 요청액을 계산하고, `:132`에서 양수·paidAmount 상한을 검사한다. 실패는 RefundAmountExceededError.
6. `:136`에서 COMPLETED Refund 생성, `:147`에서 같은 항목 refundedAmount 갱신. 두 작업은 같은 transaction이다.
7. `:152`의 paymentItem.aggregate는 **행 잠금을 요청하지 않는 MVCC SELECT**다. 모든 형제 항목 paidAmount/refundedAmount를 합산하고 `:158`에서 상태를 계산한다. 함수 `:27`은 환불 합계 ≤0이면 PAID, 실결제 합계 이상이면 REFUNDED, 그 사이면 PARTIAL_REFUNDED다.
8. `:159`에서 부모 UPDATE가 암묵적 쓰기 잠금을 얻지만 합계를 다시 읽지는 않는다. `:164` 반환 후 transaction이 commit하며 잠금을 해제한다. 예외면 Refund·항목·부모 모두 rollback한다.
9. ADMIN adapter는 `actions.ts:105`, `:108`, `:111`에서 기존 도메인 예외를 처리하고, 성공 후 `:118`에서 cache를 무효화하고 redirect한다. 기존 API·예외 계약을 보존한다.

### 단일 잠금 순서 조사표

범위: `app/`, `lib/`, `server/`, `scripts/`, `prisma/`의 Prisma mutation, raw SQL, 동적 persistence, 삭제/FK 경로를 조사했다. 테스트 fixture는 아래 별도 행에서 실행 경계를 구분한다. `→`는 같은 transaction에서의 획득/쓰기 순서이며, 일반 SELECT는 row lock으로 세지 않는다. INSERT는 새 행과 FK/unique 검사를 수반한다. INSERT 순서를 기존 행의 명시적 FOR UPDATE와 혼동하지 않는다. public은 일반 앱 원장, manual_test는 별도 SQL 객체다.

| ID / 경로 | transaction 경계와 현재 잠금·쓰기 순서 (file:line) | Payment / PaymentItem / Refund 영향 및 후보와의 관계 |
| --- | --- | --- |
| L01 수동 결제 / ADMIN | `app/(admin)/payments/actions.ts:43/:45/:50` 인가·Zod 후 `lib/payments/core.ts:44–81` 단일 transaction. Reservation/existing item 일반 조회 `:45/:51` → **새 Payment INSERT `:58` → 새 PaymentItem INSERT `:69`**. P2002는 `:83` DuplicatePaymentError로 변환. | 기존 부모·항목을 잠근 뒤 역방향 갱신하지 않는다. 새 부모/항목은 commit 전 다른 refund에서 보이지 않는다. 후보와 충돌 없음. reservationId unique가 중복 결제의 backstop이다. |
| L02 현재 환불 / ADMIN | `actions.ts:92/:94/:99` 후 `core.ts:111–170` 단일 transaction. **기존 PaymentItem FOR UPDATE `:114/:120` → 새 Refund `:136` → 항목 UPDATE `:147` → 일반 aggregate `:152` → 기존 Payment UPDATE `:159`**. Refund FK는 대상 항목·처리자 참조 검사도 수반한다. | 일반 원장에서 발견한 유일한 기존 항목 counter/부모 status 갱신 경로. 현재 **item-before-parent**다. 후보는 이 경로 전체를 parent-before-item으로 교체한다. 구/신 구현의 동시 실행 안전성은 별도 증명하지 않았다. |
| L03 Phase 20 선택/일괄 확정 | `server/reservation-applications/finance.ts:243–404` 단일 transaction: **Submission FOR UPDATE `:244` → Application(id순) FOR UPDATE `:249–252` → ClassSchedule(id순) FOR UPDATE `:267–268` → 기존 Child(id순) FOR SHARE `:275–276` → ReturnObligation reconciliation `:280` → 새 아이 identity advisory lock(정렬) `:300–309` → Reservation·동의 등 쓰기 `:345/:367/:376` → 새 Payment `:379` → 새 PaymentItems·mappings `:386/:390` → allocations `:400`**. helper `server/reservations/create.ts:41/:50`은 class/child를 재진입 잠근다. | Payment/항목은 새로 생성하며 기존 item 존재는 일반 count `finance.ts:296` 후 거부한다. Refund나 기존 parent/status를 갱신하지 않는다. 후보가 Submission/Class/Child/obligation을 나중에 잠그지 않으므로 역방향 edge가 없다. |
| L04 확정 ADMIN outer adapter | `app/(admin)/reservation-applications/actions.ts:306/:309` 인가·Zod; **outer transaction `:315–345`**, Submission `:318` → Application(id순) `:321` → ClassSchedule(id순) `:327` → L03. `:173–174` financeInTransaction은 callback을 **같은 tx**에 넣으며 nested DB transaction을 만들지 않는다. 전후 ledger 검증 `:319/:343`은 읽기다. | L03과 같은 parent-new-before-item 순서. 별도 기존 결제 쓰기 없음. |
| L05 legacy 신청 확정 / 일반 예약 생성 | `server/reservation-applications/confirm.ts:43` 단일 tx: Application FOR UPDATE `:45` → class → Child FOR SHARE (`server/reservations/create.ts:41/:50`) → Reservation·동의·Application 쓰기. 신규 Child 분기는 class 전에 새 Child를 INSERT한다. modern submission은 `confirm.ts:48`에서 거부. `create.ts:112` 일반 예약 transaction은 class → Child → Reservation. | Payment/PaymentItem/Refund를 만들거나 갱신하지 않는다. legacy 결제는 별도 L01 transaction이다. 예약 확정이라는 이름만으로 Payment lock을 가정하지 않는다. 후보는 Reservation을 읽기만 하므로 해당 행 쓰기와 새 역방향 잠금 없음. |
| L06 입금 / 반환 필요액 reconciliation | `finance.ts:194–211` 입금 tx: Submission FOR UPDATE `:195` → ApplicationDeposit INSERT `:204` → ReturnObligation UPDATE/INSERT `:162/:163`, 이어 allocations `:165`, excess obligation `:180–184`. terminal applications는 id순 조회 `:148`. ADMIN `actions.ts:231–239`가 Submission `:232` 후 core를 같은 tx에 넣는다. | Payment/PaymentItem/Refund 쓰기·행 잠금 없음. obligations는 Submission 아래 암묵적 UPDATE lock을 얻는다. 후보와 잠금 대상 겹침 없음. |
| L07 반려/취소 → 반환 필요액 | `finance.ts:219–229` 단일 tx: application 일반 조회 `:220` → Submission FOR UPDATE `:222` → Application 조건부 UPDATE `:223` → L06 reconciliation `:228`. ADMIN outer tx `actions.ts:285–290`도 Submission 먼저, 같은 tx. legacy `server/reservation-applications/resolve.ts:14/:34`는 각각 한 조건부 updateMany 문장(명시 outer tx 없음). | 기존 Payment/항목/Refund에는 쓰지 않는다. 자동 환불 없음. 후보와 역방향 edge 없음. |
| L08 실제 Reservation 전 반환 | `finance.ts:413–444` 단일 tx: obligation의 submissionId 일반 조회 `:416` → **Submission FOR UPDATE `:421` → ReturnObligation FOR UPDATE `:426–427` → ApplicationReturn INSERT `:440` → obligation UPDATE `:442`**. ADMIN outer `actions.ts:255–267`도 `:258/:260` 같은 순서, `:264` core를 같은 tx로 호출. | Payment/PaymentItem/Refund/Revenue를 변경하지 않는다. Refund와 이름·원장을 혼합하지 않는다. 후보는 Submission/obligation을 얻지 않으므로 순환 없음. |
| L09 retention / 운영 취소·출결·Revenue | retention tx `server/reservation-applications/retention.ts:396`: Submission(id순) `:254` → Application(id순) `:260` → Child(id순) FOR UPDATE `:327–331` → 관련 PII 쓰기; `:233/:234`는 deposit payerName/return reason만 scrub. `:272–273`은 Payment/PaymentItem/Refund 보존. Revenue는 `server/revenue/queries.ts:68/:91` 읽기. 예약/클래스 취소·출결의 mutation 조사에서도 결제/환불 writer 없음. | 이 세 금융 행에 새 잠금/쓰기 없음. 환불 JOIN은 Reservation row lock을 요청하지 않는다. 기존 개인정보 보관 정책 결정은 이번 과제의 선행조건이 아니다. |
| **L10 Phase 20 public 합성 cleanup** | `lib/e2e/phase20-cleanup.ts:74–94`의 lease/ownership 선행 tx 후 **별도 삭제 tx `:95–235`**: lease FOR UPDATE `:96–100` → group(id순) FOR UPDATE `:102–105` → 소유권·refund.count 일반 조회 `:147–156` → ApplicationReturn DELETE `:201` → allocations/mappings DELETE `:202/:203` → **PaymentItem DELETE `:204` → Payment DELETE `:205`** → 나머지 자식/신청/예약 삭제. DELETE lock은 commit까지 유지. | **TEST-ONLY: production lock-order contract에서 제외(흥영, Q6D-01, 2026-10-24).** isolated E2E teardown의 합성 행만 삭제하며 production writer와 동시 실행하지 않는다. 같은 public 테이블의 역순 edge 자체는 남는다; live overlap 시 정적 deadlock 위험은 아래에 보존한다. 부모 CASCADE FK (`schema.prisma:830`)도 잠금 순서를 면제하지 않는다. caller `scripts/e2e/preview.ts:205`, 복구 `scripts/e2e/phase21-preview-recover.ts:28/:34`의 runner advisory lock은 ADMIN refund `actions.ts:92–102`가 취득하지 않는다. 단일 runner는 모든 ADMIN 요청과의 상호배제 증명이 아니다. |
| L11 별도 manual_test persistence / cleanup | `lib/db/manual-test-prisma.ts:231–245` 단일 tx: search_path 확인 `:232` → **manual_test.ManualTestRun FOR UPDATE `:233`** → hydrate의 **manual_test.PaymentItem FOR UPDATE `server/manual-test/persistence.ts:77`** → 새 Refund upsert `:195` → Payment(신규면) `:197` → item upsert `:198` → parent upsert `:199`. clean 분기는 `:153/:162` 순서로 **Refund → item → parent DELETE**. bootstrap은 `lib/db/manual-test-prisma.ts:198–220` 별도 tx에서 신규 run INSERT 후 persistence. | item-before-parent지만 `persistence.ts:13/:61–64`의 schema-qualified SQL, 별도 client `lib/db/manual-test-prisma.ts:180/:257–264`, 동일 run 직렬화가 있다. public refund core를 호출하는 경로가 아니므로 **L10과 달리 같은 행의 순환 충돌은 아니다**. 여기까지 parent-before-item으로 바뀐다고 주장하지 않는다. |
| L12 integration/E2E/perf fixture·teardown | 예: `tests/integration/reservation-applications/confirmation-atomicity.test.ts:49–62` afterAll은 완료된 테스트 뒤 Refund DELETE → item DELETE → parent DELETE `:58`를 **각 awaited autocommit**으로 수행한다. `tests/e2e/support/ux-seed.ts:90`는 Payment + nested new item 생성. `tests/performance/support/fixtures.ts:63–64` 생성, `:107–109` Refund/item/parent 각각 awaited DELETE. | test-only 순서이며 outer tx로 묶은 역순 보유라고 간주하지 않는다. 새 테스트도 controller/worker 모든 tx를 join한 후 cleanup한다. perf harness는 재실행하지 않는다. 이 행의 종료 순서 보장은 L10의 일반 ADMIN 요청 배제를 대신하지 않는다. |

표의 source survey에서 main 원장의 Payment/PaymentItem/Refund에 대한 다른 UPDATE/UPSERT writer나 PaymentItem.paymentId 재배정 writer는 발견하지 못했다. DB schema는 paymentId를 immutable로 선언하지 않으므로 **현 write path상 불변**이라는 제한이 있다. FK/unique/새 행 쓰기에 따른 암묵적 lock과 외부 임의 SQL까지 포함한 전역 deadlock 부재를 증명한 것은 아니다.

### Defect model — 아직 INFERENCE

초기 상태는 Payment P.totalAmount=80,000 / status=PAID, I1/I2 각각 paidAmount=40,000 / refundedAmount=0이다. 서로 다른 ADMIN A1/A2, 서로 다른 DB connection T1/T2를 사용한다.

1. T1은 I1만, T2는 I2만 FOR UPDATE한다. 서로 막지 않는다.
2. 각자 Refund 40,000을 INSERT하고 자기 항목 counter를 40,000으로 갱신한다. 둘 다 미commit이다.
3. T1 aggregate는 자신의 I1=40,000과 committed I2=0, T2 aggregate는 committed I1=0과 자신의 I2=40,000을 읽을 수 있다. 둘 다 paid 합계 80,000 / refund 합계 40,000 → PARTIAL_REFUNDED를 계산한다.
4. T1과 T2의 부모 UPDATE는 row lock으로 순차 실행되어도 **이미 계산한 PARTIAL_REFUNDED 상수**를 저장한다. 둘 다 성공 commit하면 counter/Refund는 80,000인데 부모는 PARTIAL_REFUNDED일 수 있다.

aggregate, 초기 relation 조회(후보), 예약 JOIN projection은 row-lock 없는 읽기다. PostgreSQL READ COMMITTED의 SELECT는 각 문장 시작 시 committed 데이터와 자기 변경을 보며 다른 transaction의 미commit 쓰기는 읽지 않는다. 부모 UPDATE의 대기가 앞선 aggregate를 재실행해 주지 않는다. [PostgreSQL 16 Transaction Isolation](https://www.postgresql.org/docs/16/transaction-iso.html).

기존 `tests/unit/payments/core.test.ts:90/:128/:138`은 mocked lock/aggregate와 순수 상태 함수를 검사하므로 두 connection의 MVCC를 관찰하지 못한다. `tests/integration/reservation-applications/confirmation-atomicity.test.ts:120–122` 경합은 Submission에서 직렬화되는 확정 경로이며, 환불 사례 `:170–175`는 **같은 한 항목에 순차 10,000 + 30,000**이다. 두 형제 항목의 aggregate-before-commit을 만들지 않는다. `workflow-races.test.ts:91/:97/:103/:111/:117/:130`은 deposit/rejection/return 및 그 rollback 경합이고 createRefundCore의 cross-item 부모 계산을 호출하지 않는다. 기존 테스트가 통과했다는 사실은 C10 재현/부재 증거가 아니다.

### 후보 수정과 lock-order 판정

아래는 Q6D-01 해결에 따라 조건부 승인된 최소 수정 설계다. 이번 step 1에서는 구현하지 않으며, 원본 실제 PG 재현 Gate 2 이후에만 fix BUILD로 진행한다.

1. 동일 refund transaction 안에서 item ID로 immutable paymentId만 일반 조회한다. 없으면 PaymentItemNotFoundError.
2. 해당 **Payment 행 SELECT … FOR UPDATE**. 부모가 사라졌으면 같은 PaymentItemNotFoundError로 쓰기 없이 종료한다.
3. 현재 JOIN/`FOR UPDATE OF pi`로 target item을 잠그고 paymentId가 최초 조회와 같은지, 현재 amounts/status/attendance를 다시 확인한다. 없거나 relation 불일치면 PaymentItemNotFoundError. 오래된 paidAmount/refundedAmount를 재사용하지 않는다. 재배정·무한 재시도·새 exception type을 추가하지 않는다.
4. NO_SHOW/ABSENT detail, 예약 상태와의 독립성, 양수·누적 환불 상한은 현재 규칙을 그대로 실행한다.
5. COMPLETED Refund INSERT와 target counter UPDATE.
6. **부모를 계속 잠근 채 모든 형제 항목** paid/refunded 합계를 새 문장으로 계산한다. 모든 sibling을 FOR UPDATE할 필요는 없다. 다른 item counter writer도 같은 부모를 먼저 잠근다는 전제가 필요하다.
7. 기존 resolvePaymentStatus로 Payment.status UPDATE.
8. 같은 transaction commit. 중간 어느 예외에도 세 모델 모두 rollback. timeout/maxWait, 입력·반환 타입, 기존 도메인 예외, 금액 정책을 보존한다.

제안하는 일반 금융 경로의 partial order는 **Payment(existing parent) FOR UPDATE → PaymentItem(target) FOR UPDATE → Refund INSERT / item UPDATE → aggregate → parent UPDATE → commit**다. 조회 자체는 잠금 획득이 아니다. 기존 확정의 Submission → Application → ClassSchedule → Child → 새 Payment → 새 item 흐름은 그대로 둔다. 서로 다른 Payment에는 전역 mutex를 추가하지 않는다.

L01/L03/L04는 새 parent-before-new-item이며 기존 item을 잡은 채 parent로 돌아가지 않는다. L05–L09는 Payment/항목 lock과 역방향 edge가 없다. L02는 교체 대상이다. L11은 별도 schema/run lock으로 분리된다. L12는 소유 fixture에서 worker 종료 후 수행된다. **생산 쓰기 경로(production write paths)의 계약은 결제 생성, 선택/일괄 확정, 환불 및 관련 ADMIN 작업에 적용한다. L10은 별도 namespace여서가 아니라 TEST-ONLY 실행 경계에 대한 흥영의 명시적 결정으로 이 계약에서 제외한다. 앱의 모든 SQL에 적용되는 전역 순서라고 확대하지 않는다.**

L10 충돌의 구체적 조건부 schedule (정적 추론, deadlock 미재현):

- C(cleanup)는 소유권/refund.count=0 확인을 끝내고 `:204`에서 I를 DELETE하여 I의 lock을 보유한다. 아직 commit하지 않고 P 삭제 전이다.
- F(후보 refund)는 일반 조회로 아직 committed인 I.paymentId=P를 읽고 P FOR UPDATE를 얻는다. C의 미commit DELETE는 일반 조회에서 보이지 않는다.
- F의 I FOR UPDATE는 C를 기다린다. C의 `:205` P DELETE는 F를 기다린다. **F holds P, waits I; C holds I, waits P.**
- C의 refund.count는 F의 Refund INSERT 이전에 0일 수 있다. 그 검사에는 공유 row lock이 없으므로 이 순환을 막지 않는다. lease/group/runner advisory lock도 F가 공유하지 않는다. [PostgreSQL 16 Explicit Locking](https://www.postgresql.org/docs/16/explicit-locking.html) §13.3.2–13.3.4의 row DELETE/lock 충돌 규칙에 따른 추론이다.

**Q6D-01 해결 결정 — 흥영, 2026-10-24:** `lib/e2e/phase20-cleanup.ts`는 격리된 E2E teardown에서 합성 데이터만 대상으로 실행하며 production writer와 절대로 동시에 실행하지 않는 TEST-ONLY 경로다. 따라서 `item → parent DELETE` 순서는 production lock-order contract 밖이다. cleanup을 live/production dataset에 연결하는 것은 금지한다. 이는 새로운 mutex나 DB 수준 상호배제 증명이 아니라 승인된 실행 제약과 잔여 위험 수용이다.

합성 전용 설계 근거: 파일 `:5–8`의 synthetic-group-only 설명, `:23–25`의 엄격한 run ID/marker, `:67–69`의 broad selector 거부, `:75–79` 및 `:96–105`의 lease·syntheticRunId 범위, `:147–156`의 mapped item 소유권/타인 결제 및 Refund 존재 시 fail-closed 검사, `:177–192`의 외부 예약·아이 의존성 거부다. 이것은 합성 소유권 근거이며 production writer 상호배제 장치라고 주장하지 않는다.

**수용된 잔여 위험:** 이 제약을 위반하여 cleanup과 live refund가 같은 Payment에서 겹치면 위 정적 deadlock cycle은 그대로 적용된다. 흥영은 해당 조건부 위험을 명시적으로 수용했다. cleanup 코드/삭제 순서는 이번 범위에서 바꾸지 않는다. Q6D-01 RESOLVED, conditional BUILD gate ACTIVATED; 금융 정책 변경 없음.

## User Story

ADMIN 두 명이 한 결제에 속한 서로 다른 예약의 환불을 동시에 처리해도, 각 환불의 금액·이력과 결제 전체 상태가 일치해야 한다. 운영자는 추론과 실제 PostgreSQL 검증 결과를 구분해서 확인할 수 있어야 한다.

## Scope

- 현재 step 1: 이 SPEC과 PLAN의 Q6D-01 해결 기록, 신규 실제 PG 재현 테스트 및 same-item/independent-Payments companion 두 건 작성. 제품 코드 변경 없음.
- 향후 조건 충족 시만: `lib/payments/core.ts`와 필요한 테스트. 새 PG suite는 기존 discovery 범위인 `tests/integration/reservation-applications/payment-refund-concurrency.test.ts`에 둔다. 파일 위치는 integration glob을 보존하기 위한 것이며 Refund를 Reservation 전 반환 도메인으로 옮기는 뜻이 아니다.
- 원본 test-only CI red → fix CI green 증거 체인. 원본 환불 함수와 관련 source hash/정확 checkout SHA를 각각 남긴다.

### 결정적 PostgreSQL 16 재현 요구사항

**Gate 0는 Q6D-01 결정으로 충족되었으며 원본 재현 테스트 BUILD가 활성화되었다.** 단순 Promise.all을 재현 절차로 인정하지 않는다.

1. 기존 integration safety를 **client 생성 전** 적용한다: `vitest.integration.config.ts:6–10`, `tests/e2e/support/db-safety.ts:34–76`. DATABASE_URL와 DIRECT_URL 모두 loopback / 55432 / yaho_e2e DB·user만 허용한다. VERCEL_ENV 또는 Preview mode는 차단한다. `.env` 내용이나 URL/credential은 출력하지 않는다.
2. CI `.github/workflows/phase2-integration.yml:15`의 `postgres:16`, `scripts/ci/verify-e2e-db.ts:5–29`의 runtime version/DB/user 확인, 기존 NOLOGIN role 준비와 **기존 migration deploy**를 재사용한다. schema·migration·workflow·config 변경 없이 `:55–56` integration 명령으로 실행한다. 서버 version_num 16xxxx 및 refund tx READ COMMITTED도 테스트에서 확인한다. VM에서는 PG 실행을 시도하거나 Preview를 대용하지 않는다.
3. run-owned 합성 fixture를 commit한다. ADMIN A1/A2 두 User, Reservation 두 개, **Payment 하나, PaymentItems 두 개 각각 amount=paidAmount=40,000, discount/refundedAmount=0**. 가능하면 기존 입금/일괄확정 core로 공통 부모를 만들고 parent 수·공통 paymentId·각 item 금액을 검증한다. 재현에 기존 고객/기관 정책은 필요 없다.
4. 서로 다른 Prisma clients의 T1/T2, 외부 controller C, 관찰자 O를 사용한다. test-only transaction wrapper는 실제 tx에서 pg_backend_pid()를 얻고 실제 callback/쿼리를 그대로 전달한다(기존 실DB fault-injection 패턴 `confirmation-atomicity.test.ts:110/:116` 참고). **C/T1/T2/O의 PID가 서로 다름**을 확인한다. callback을 가짜 DB로 대체하거나 production hook을 추가하지 않는다.
5. C가 P에 `SELECT … FOR NO KEY UPDATE`를 얻은 후 두 createRefundCore 요청(각 40,000, 처리자 A1/A2)을 시작한다. 이 controller lock은 원본의 parent status UPDATE와 후보의 FOR UPDATE 모두를 막으면서 일반 SELECT/무관한 FK key-share를 불필요하게 막지 않는다. C가 lock을 실제 얻었다는 handshake 전에 workers를 시작하지 않는다.
6. O는 fresh autocommit 조회로 두 worker의 pg_stat_activity/pg_locks와 pg_blocking_pids()를 관찰한다. **두 worker 모두 P 획득에서 대기하고 blocker graph가 C에 도달했을 때만 C를 해제**한다. 두 번째 worker는 row-lock queue의 첫 worker를 blocker로 보일 수 있으므로 C가 직접 blocker여야 한다고 한정하지 않는다. SQL/row target은 wrapper의 고정 stage·run-owned ID로 분류하고 전체 SQL/parameter/PII를 log하지 않는다. row lock 보유 전체가 pg_locks에 표시된다고 가정하지 않는다. [pg_locks](https://www.postgresql.org/docs/16/view-pg-locks.html), [pg_blocking_pids](https://www.postgresql.org/docs/16/functions-info.html#FUNCTIONS-INFO-SESSION).
7. **원본 증명**: 두 worker의 활성 문장은 parent **UPDATE**여야 하고, wrapper가 기록한 각 실제 aggregate 완료값은 paid=80,000 / refunded=40,000이어야 한다. `Refund INSERT → item UPDATE → aggregate → parent UPDATE` 순차 완료 기록과 DB lock 대기를 함께 확인해 **양쪽 모두 item critical section을 지나고 어느 쪽도 commit하지 않았음**을 증명한다. observer에서 미commit Refund를 조회할 수 있다고 가정하지 않는다.
8. C를 commit/rollback으로 해제하고 두 refund를 모두 join한다. 새 connection의 committed 조회에서 Refund 두 개·각 amount 40,000·정확한 처리자·COMPLETED, item 두 개·각 refundedAmount=paidAmount=40,000을 먼저 assert한다. 그 뒤 회귀 assertion **Payment.status === REFUNDED**를 실행한다. 원본에서 이 assertion만 actual=PARTIAL_REFUNDED로 실패하면 재현 인정. 잘못된 상태를 기대하는 통과 테스트, it.fails, skip, retry로 red를 숨기지 않는다.
9. **수정 후 같은 barrier**는 둘 다 parent **SELECT FOR UPDATE**에서 막힌 것을 허용한다. 이때 둘 다 aggregate에 도달해야 한다고 요구하면 수정 자체를 deadlock시키므로 금지한다. release 뒤 첫 worker는 partial, 두 번째 worker는 최신 sibling refund를 포함해 full을 계산하고 최종 assertion이 통과해야 한다. 원본 단계 증명과 수정 후 단계 증명은 관찰 stage로 기록하고, test-only/fix SHA 간 같은 정상상태 assertion과 barrier 계약을 유지한다.
10. poll은 관찰 predicate로만 진행한다. sleep 후 추정하거나 임의 지연으로 interleaving을 만들지 않는다. bounded poll/deadline은 20초 core timeout보다 충분히 먼저 실패하도록 두며, 시간 제한은 hang 방지일 뿐 성공 조건이 아니다. controller release는 finally에서 보장하고 모든 worker를 allSettled로 join한 뒤 소유 fixture만 FK순 cleanup, clients disconnect한다. 예외/관찰 실패 시 production SQL 변경 없이 모든 대기 transaction을 정리한다.

강제 interleaving 증명이 실패하거나, 두 환불이 모두 commit하지 못하거나, 조건을 만족해도 stale 상태가 나오지 않으면 **NOT REPRODUCED**로 기록한다. barrier/환경 실패와 관찰된 정상 상태를 구분하고, 관찰한 stage·상태·한계를 남긴다. 이 경우 fix build로 넘어가지 않고 코드 위험만 남긴다. 현재 step 1의 실제 PG 결과 역시 NOT RUN / NOT EXECUTED이며 관찰된 결함으로 승격하지 않는다.

## Out of Scope

schema/migration/trigger, 신규 금융 정책·환불 상태·금액·개인정보 수집 항목, confirmation/allocation/return-obligation 로직 변경, 자동 환불·자동 요청 재전송, 과거 데이터 일괄 정정, 실고객 데이터, Preview/Production DB, perf-harness 재실행, PR merge, Schema Gate 승인, 배포. L10 cleanup 변경은 현재 범위 밖이며 TEST-ONLY 제외 결정만 기록한다. 현재는 test-only commit도 만들지 않는다.

## Business Rules

- ADR-007의 item 누계 상한·실제 COMPLETED Refund 합계 일치·동일 tx 유지. paidAmount를 넘기거나 0/음수 요청을 허용하지 않는다.
- ADR-034/035/036/037/039: ADMIN 단독 수동 부분/전체 환불, 예약 상태 독립, NO_SHOW 또는 ABSENT 이력 상세 사유 의무를 보존한다. Reservation 상태/출결을 환불 때문에 바꾸지 않는다.
- Payment.status는 이 환불 경로가 처리한 유효 결제에 대해 실제 모든 item의 합계로 산출한다. 0 환불→PAID, 0<refund<paid→PARTIAL_REFUNDED, positive paid 전액→REFUNDED. 기존 CANCELLED enum·0원 결제 의미를 새로 정의하지 않는다.
- Refund 이후에도 D=A+P+R+T 및 사전 원장 D/A/P/R/T는 변하지 않는다. Refund는 **확정 후 환불**, T는 **Reservation 전 완료 반환**이다. 서로 차감·재분류하지 않는다.
- Revenue는 ADR-040/041의 PaymentItem 금액, 실제 Refund 처리일, KST·필터 의미를 그대로 따른다.
- 기존 PaymentItemNotFoundError / RefundAmountExceededError / NoShowRefundDetailRequiredError와 결제 생성의 ReservationNotFoundError / DuplicatePaymentError 계약을 보존한다. 개인정보/금액 정책을 추측하지 않는다.

## Acceptance Criteria

아래 항목은 모두 향후 **실제 PostgreSQL integration**에서 검증해야 하며 mocked unit만으로 완료하지 않는다. 세부 테스트 위치·요건 추적은 PLAN의 Tests 표에 있다.

| ID | 요구 결과 / 거부 결과 |
| --- | --- |
| AC01 | 원본 두 item 각 40,000 동시 full refund가 위 barrier를 통과하고 두 item/Refund가 full인 상태에서 부모 REFUNDED assertion만 실패한다. 실패 이유·원본 SHA·CI job을 보존한다. 아니면 NOT REPRODUCED + STOP. |
| AC02 | 수정 후 동일 회귀 assertion 통과, 최종 parent=REFUNDED, item counters=각 40,000, Refund 총액=80,000. 두 ADMIN/독립 PID를 증명한다. |
| AC03 | 같은 item에 40,000+40,000 경합은 하나만 성공하고 다른 하나는 RefundAmountExceededError. 동시 10,000+30,000은 둘 다 성공하여 정확히 40,000. 추가 1원은 거부, 실패 요청의 Refund/counter/parent 변화 없음. |
| AC04 | 서로 다른 item의 partial 10,000 + full 40,000이면 총 환불 50,000/80,000, parent PARTIAL_REFUNDED. 잔여 30,000 후 REFUNDED. 실제 Refund 합계와 counter 모두 일치. |
| AC05 | Payment P1의 parent lock 때문에 대기 중에도 P2 환불은 P1 release 전에 완료한다. 전역 직렬화를 도입하지 않는다. |
| AC06 | Refund INSERT 뒤, item UPDATE 뒤, parent UPDATE 직후 commit 전 각각 의도적 예외를 실제 tx 안에서 주입하면 Refund/PaymentItem/Payment가 전부 정확히 before-state로 rollback된다. |
| AC07 | 각 성공·거부·rollback·경합 settle 후 fresh committed snapshot에서 completed Refund 합계=item.refundedAmount, 0≤refunded≤paid 및 parent 상태=모든 item 실제 합계의 상태. 자기 계산 함수를 oracle로 재호출하는 검사만 하지 않는다. |
| AC08 | mapped Payment fixture에서 refund 전후 D/A/P/R/T 불변 및 D=A+P+R+T. R/T가 둘 다 양수인 별도 fixture도 검사한다. Revenue partial/full·날짜/필터 회귀 유지. |
| AC09 | RESERVED/COMPLETED/CANCELLED 수동 환불 허용, NO_SHOW 및 CANCELLED+ABSENT는 빈 detail 거부/유효 detail 허용. non-ADMIN·잘못된 입력은 기존 action에서 저장 없이 거부. 없는 item도 기존 예외. |
| AC10 | 기존 실제 PG 6 files/87 cases와 unit suites가 green. 새 테스트 추가 수는 별도 보고하며 기존 사례를 삭제·skip·완화하지 않는다. Q6D-01의 TEST-ONLY 제외 결정과 수용된 live-overlap 위험, production 계약의 검증 범위·잔여 한계를 보고한다. |

## Conflicts

| 근거 | 유지/변경 / 판단 |
| --- | --- |
| REQUIREMENTS §12, §13.1–13.5, §22 환불; ADR-005/007 | 유지. multi-item Payment 구조와 환불 상한·거래 원자성을 보강할 후보이며 금액 정책 변경 없음. |
| REQUIREMENTS §13.1/13.3, §24 결제/환불; ADR-033–039 | 유지. 기존 확정된 예약/환불 독립성과 NO_SHOW 예외·사유를 다시 정책 질문으로 열지 않는다. |
| REQUIREMENTS §14.3–14.7; ADR-040/041 | 유지. Revenue 계산/귀속·필터 변경 없음. |
| REQUIREMENTS §17.5–17.6, §20/Phase20 권한; ADR-050/060 | 유지. ADMIN 경계, D=A+P+R+T, 확정 전 반환/후 환불 분리. |
| ADR-030/051/059/060 및 현 integration safety | 유지. CI disposable PostgreSQL 16 integration만 계획한다. Preview E2E나 Production schema/deployment 승인이 아니다. |
| ADR-057/058 | 유지. 금융 보관기간·PII 수집/파기 정책을 새로 결정하지 않는다. |
| ARCHITECTURE §7.1, §8, §10; AGENTS 역할·Git·build 규칙 | 유지. 기존 monolith·서버 입력/권한·real DB 검증, BUILD developer 분리. 현재 docs + test-only/no-stage/no-commit 지시가 우선한다. |
| **L10 기존 write path** | **Q6D-01 RESOLVED. TEST-ONLY teardown은 production 계약에서 제외한다(흥영, 2026-10-24). 역순 자체를 제거한 것은 아니며, 같은 Payment의 live refund와 겹치면 정적 cycle이 적용되는 잔여 위험을 수용한다. live/production dataset 대상 cleanup 금지.** |

기존 사업 규칙을 변경하지 않으므로 REQUIREMENTS.md / docs/DECISIONS.md에 정책이나 새 ADR을 추가하지 않는다. 기존 ADR은 수정하지 않는다.

## Open Questions

**Q6D-01 — RESOLVED (흥영, 2026-10-24):** production write paths(결제 생성, 확정/일괄확정, 환불, 관련 ADMIN 작업)만 잠금 순서 계약의 대상이다. `phase20-cleanup`은 isolated E2E teardown의 합성 전용이며 production writer와 동시 실행하지 않는 제약 아래 제외한다. 같은 Payment의 live refund와 동시 실행될 경우 기존 정적 cycle이 적용되는 잔여 위험을 수용한다. cleanup을 live/production dataset에 연결해서는 안 된다. 파일 근거와 cycle은 위 lock-order 판정에 기록했다.

미결정 금융 정책 질문은 **없음**. conditional BUILD gate **ACTIVATED**. 이번 step 1에서 재현 테스트를 원본 코드 위에 작성하되 실제 PG 실행은 CI 대기(**NOT RUN locally**), fix BUILD는 Gate 2 재현 evidence 이후다.

## Priority

**Now — P0/MAJOR 조사·재현 대상.** 결제 상태 일관성 위험은 우선 검증해야 하지만 아직 관찰된 런타임 결함이 아니다. **현재 결정은 Q6D-01 RESOLVED / conditional BUILD ACTIVATED**. 원본 재현 테스트와 companion 두 건만 준비하며 code-risk와 검증 한계, CI evidence 대기를 보존한다.
