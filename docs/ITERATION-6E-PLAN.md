# Task

Iteration 6E — A16/A17 정책 승인 후 최소 retention 확장 설계. **DOCS ONLY / CONDITIONAL / NOT APPROVED FOR BUILD.**

작성일 2026-10-24 UTC. 기준 HEAD `12bfdf67d468efd9feb0f7e6d5d4c8efae61281a`, branch `feature/phase21-ai-service`, 사용자 제공 PR #54 Draft. 입력: [SPEC](./ITERATION-6E-SPEC.md), REQUIREMENTS, ADR-055~058/060, 현행 Prisma schema와 retention/purge 코드. `$yaho-spec` 문서를 먼저 작성한 뒤 `$yaho-plan`으로 전환했다. 사용자 지시에 따라 이 설계 문서만 저장하며, 일반적인 PLAN의 파일 무수정 규칙을 제품 코드 변경 허가로 확대하지 않는다. `$yaho-build` 진입 없음.

## Goal

승인된다면 거래 **행/금융 불변식**은 보존하면서 필요한 PII 필드만 종료하고, CONFIRMED 이력 없는 고객은 각자 승인된 목적·기간에 한해 처리한다. 기존 `server/reservation-applications/retention.ts`와 `lib/reservation-applications/retention.ts`, ADMIN 수동 purge 경로를 우선 재사용한다. 새 서비스/범용 개인정보 플랫폼/자동 scheduler를 전제로 하지 않는다.

SPEC의 결정표는 **66행, 운영자 결정 REQUIRED 27행**, 기존 정책 범위 유지 39행이다. F01–F05/F07, F33–F37, F50–F57, K01–K04, G1–G4의 개별 승인과 E01–E08 전문가 검토가 남았다. 법적 적용 판단은 SPEC대로 모두 **ESTIMATE(추정)**다. 조건부 설계는 미해결 질문을 실행 가능한 정책으로 바꾸지 않는다.

### Gate 0 — 구현 이전에 반드시 필요한 결정

| 승인 묶음 | 확정해야 할 내용 | 미확정이면 |
| --- | --- | --- |
| A16 고객 거래 필드: D16-NAME/MEMO/REFUND/DEPOSIT/RETURN/DECLARED | 필드별 법적/계약·동의 근거, 필요한 범위, 기간·기산사건·timezone/만료경계, 원문 종료 방법, S(parent 전체 파기)와 별도 필드 기간의 관계 | 해당 새 purge scope 구현·활성화 금지. 기존 일반 Child 파기의 Payment/Refund 보존 유지 |
| A16 연결·처리자: D16-ACTOR-RF/DP/RT, STAFF-NAME/EMAIL, LINK/DEVICE/COMPLETION/REPLAY | 잔존 FK/직원 신원/토큰·키의 필요기간·접근, 원문 파기 후 receipt/replay, 최종 비식별성 판정 | User 삭제/직원 FK 변경/키 삭제/익명정보 선언 금지. 고객 필드 종료 승인과 직원 정책 승인을 합치지 않음 |
| 공용 필드: D16-CLASS-MEMO/CANCEL/SAFETY, PROGRAM-MEMO/DESCRIPTION, TEACHER-NAME/PHONE/MEMO | 공용 본문의 개인정보 해당 범위, 다른 아이/강사 목적과의 분리, 필드별 기간/기산점·권한, 직원 정책 담당자 | 개별 고객 C5에 묶어 공용 내용을 일괄 삭제 금지. 승인된 한 필드 범위만 별도 확정 |
| A17: D17-ADMIN/HISTORY/UNCONFIRMED/MIXED | 각 집단의 목적·고지/계약 증거·기간/기산점, 과거자료 처리, 안전·동의/금융 혼합 근거와 hold 범위/해제일 | CONFIRMED CTE를 넓히지 않음. G1–G4에 C5 적용 금지 |
| 전문가 E01–E08 + 운영 책임 | 법정 적용·세무 기산 자료, 아동/건강/제3자 고지, 백업/복제본 최종 잔존·복구 재파기·분리 접근의 책임과 기한 | 실제 PII 제거·운영 연결 금지. 숫자/근거 부족은 `ineligible-policy-unresolved` 성격의 결과로 처리할 설계만 허용 |

승인된 부분만 구현하려면 그 범위의 질문을 모두 해소하고 범위 밖은 계속 차단한다. 이 PLAN 자체는 설계 승인을 대신하지 않는다. 운영자와 전문가의 답을 새 ADR/REQUIREMENTS에 기록하고 이 PLAN의 조건·기간을 확정한 후 사용자의 설계 승인을 받아 멈추는 것이 다음 절차다.

## Current State

1. Prisma schema를 먼저 확인했다. 거래 PII 다섯 필드 모두 nullable이다(`prisma/schema.prisma:683`, `:731`, `:800`, `:838`). 연결 원장 모델은 PaymentItem/Mapping/Obligation/Allocation(`:701`, `:712`, `:747`, `:819`). Child는 제자리 비식별화와 actor/time을 이미 지원한다(`:222`).
2. 순수 날짜 계산은 `lib/reservation-applications/retention.ts:42`, `:56`, `:78`; 별도 조회/변경은 `server/reservation-applications/retention.ts:138`, `:172`, `:195`, `:280`, `:392`다. 승인 고객 정책과 날짜 처리를 대체하지 않는다.
3. `PersonalDataPurgeScope`는 applicationIds/childIds만 받는다. scope가 주어지면 빠진 sibling은 빈 목록으로 취급한다(`server/reservation-applications/retention.ts:36`, `:285`). 이 의도적 bounded scope 계약을 확장 시에도 유지한다.
4. 일반 파기는 Submission → Application → Child 잠금, 새 문장으로 자격 재확인, 기존 부속자료 제거·Child 변환, S(parent 전부 파기) 처리다(`server/reservation-applications/retention.ts:237`, `:309`, `:327`, `:334`, `:342`, `:380`). 신청 500/Child 100 batch, 30초 tx timeout 및 `hasMore` 계약도 유지한다(`:22`, `:26`, `:384`).
5. ADMIN page는 `app/(admin)/reservation-applications/retention/page.tsx:98`, action은 `app/(admin)/reservation-applications/actions.ts:598`, 확인 UI는 `app/(admin)/reservation-applications/_components/purge-expired-button.tsx:9`다. action은 실행 시 전체 현행 대상 재계산이며 UI 숫자가 대상 승인/고정 목록을 뜻하지 않는다.
6. 현재 HEAD의 환불은 Payment `FOR UPDATE` → PaymentItem → Refund/counter/aggregate/status다(`lib/payments/core.ts:110`, `:118`, `:125`, `:147`). 6C의 과거 item-only 설명을 현재 코드 상태로 재사용하지 않는다. 해당 금융 경합 개선을 다시 구현하지 않는다.
7. 일반 파기는 Payment/Refund 원문을 보존하지만 S는 Deposit.payerName/Return.reason을 NULL로 만든다(`server/reservation-applications/retention.ts:223`, `:272`). 재시도는 이름/사유를 비교한다(`app/(admin)/reservation-applications/actions.ts:201`, `:234`, `:261`). nullability만 확인한 뒤 무조건 지우는 설계는 충분하지 않다.
8. Child.registeredAt/createdAt/updatedAt은 있지만 등록 출처·마지막 연락·목적 종료·세무 신고기한·장부 폐쇄·hold 만료·거래 PII 파기 표시는 없다(`prisma/schema.prisma:222`, `:683`, `:800`). 없는 값을 있는 것처럼 기산하지 않는다.

이상은 정적 사실이다. 실제 만료대상 수·DB constraint 적용 상태·성능·백업 정책은 확인하지 않았다.

## Data Model

### 최소안: 현재 컬럼과 구조 재사용

| 제안 변경 | 현재 근거 / 생존 데이터 | migration | 조건 |
| --- | --- | --- | --- |
| Payment.payerName/memo, Refund.reasonDetail을 승인 만료 때 NULL | 모두 nullable. 금액·paidAt/refundedAt·status·reason enum·item/예약 FK·처리자 유지 | **불필요** — 값 변환 자체 | 각 필드 기산점이 기존 사실에서 정확히 계산 가능하고 보관 예외/hold를 빠뜨리지 않을 때만 |
| Deposit.payerName/Return.reason의 승인된 별도 필드 만료 | nullable; S의 기존 clear를 재사용. Deposit/Allocation/Obligation/Return의 행·금액·시간·연결/누계 유지 | **불필요** — 값 변환 자체 | S와의 차이 및 재시도 계약 승인 필수. S를 조용히 늦추거나 C5를 변경하지 않음 |
| 승인된 G1/G2/G3의 독립 Child 범위 + G4 목적별 부분 처리 | Child 기존 purge marker/공통 표식, nullable 필드, 부속행 삭제 재사용. 예약/금융행 삭제 없음 | **불필요** — 기존 marker와 approved event로 판정할 수 있는 최소안 | G3 신청만이면 별도 Child 생성 없음. 부분 안전정보 파기에 Child 전체 purge marker를 쓰지 않음 |
| K02/K03에서 승인된 만료 capability/grant 종료 | 기존 expiresAt/revokedAt, nullable completionTokenHash, DeviceChild/DeviceSubmission 관계 | **불필요** — 기존 컬럼/관계 제거만 | 키 잔존·접근/복구 조건 승인. 아직 유효한 형제/가족 권한을 다른 가족까지 삭제하지 않음 |
| 순수 policy/scan/action/UI 확장·고지 문구 version | DB enum/컬럼을 추가하지 않는 서버 타입/기존 문자열 | **불필요** | 결정된 고지만 반영; 과거 consentVersion UPDATE 금지 |

**조건부 확장(최소안에 자동 포함하지 않음):**

| 선택 사항 | 필요한 이유 | migration |
| --- | --- | --- |
| 목적 종료 사건/고지 근거/hold 사유코드·해제일/정책 version/거래 필드 파기 시각·actor의 영속 기록 | 기산사건이 현재 모델에 없거나 개별 예외·감사 증명이 요구되면 날짜를 추측할 수 없음. 운영 입력을 저장·검증할 모델이 필요 | **필요** — 새 metadata/table 선택 시 additive Prisma migration. 실제 컬럼/보유기간은 승인 후 별도 확정 |
| 목적별 Child/Consent/Safety의 부분 종료 marker | G4 부분 삭제를 전체 Child의 personalDataPurgedAt으로 표시하면 살아 있는 예약 목적까지 막음 | **필요할 수 있음** — 부분 삭제가 현재 행 유무로 충분하면 불필요; 지속 증빙 필요 시 새 metadata 설계 |
| 세무 법정신고기한/장부 폐쇄일 저장 | T/C 기간의 기산 근거를 기존 paidAt으로 대체할 수 없음 | **필요** — DB 영속화를 선택할 경우. 세무체계 통합을 발명하지 않음; 근거 없는 레코드는 실행 보류 |
| 처리자 required FK NULL 허용/퇴직 직원 대체 신원 | Deposit.confirmedById/Return.processedById는 required(`prisma/schema.prisma:690`, `:736`); 현재 User.name/email은 별도 계정 목적 존재 | **필요** — 그런 변경을 승인한 경우. 최소 A16 고객 필드안에는 **제안하지 않음** |

현재 시점에는 **schema 변경 0 / migration 0**이다. “NULL 가능”은 법적 파기/복제본 제거/감사 증빙 완료를 뜻하지 않는다. 새 metadata가 꼭 필요해지면 승인된 PLAN을 수정하고 별도 migration 승인을 받아야 한다. `prisma db push`, 기존 migration 수정, cascade 변경, schema 불변이라는 이유로 무근거 날짜를 사용하는 우회는 금지다.

### DB 제약과 서버 책임

- DB는 기존 FK/unique/금액 CHECK 및 Child 파기 후 필드 CHECK를 유지한다(`prisma/schema.prisma:860`, `:880`, `:905`; 기존 Phase18/20 migrations). 이것으로 목적/법률/기간 적합성이 검증되지는 않는다.
- 서버는 ADMIN 권한, Zod scope, 승인된 정책 종류/version·기산사건, pending/미래 예약/분쟁/잔액에 필요한 최소필드, KST 또는 승인된 법정 만료경계, 대상 재검증을 책임진다. 정책 불명·근거 날짜 부재는 파기 불가다.
- 기존 C5 경로에 새 전역 hold/필드 기간을 끼워 넣어 승인된 5년 보유·파기를 연장하지 않는다. 새 A16 필드 scope와 A17 scope의 자격 판정으로 분리한다. 의무 충돌이 발견되면 전문가/운영 결정으로 되돌린다.

## API

### 기존 retention 서비스 확장 지점

| ID | 최소 touch point / 설계 | 규모·이유 | migration |
| --- | --- | --- | --- |
| P1 | `lib/reservation-applications/retention.ts`에 **별도의** 승인 거래필드/비CONFIRMED 목적 계산 helper 추가. C5/A1 상수·함수는 유지. 입력은 근거 사건·승인 기간/버전, 출력은 eligibility/basis/expiry/보류 사유 | **small**: 순수 판정; 단, T/C 기산 데이터 부재는 P6로 전환 | 불필요; 새 영속 사건은 P6 |
| P2 | `server/reservation-applications/retention.ts`에서 기존 scan/batch/tx 패턴에 transaction-field scope 추가. paymentIds/refundIds/submissionIds 등은 **제안 API 명칭**이며 현재 없는 필드다. 새 kind를 명시한 호출에서만 사용, 빈/누락 scope가 전체 sweep으로 승격되지 않게 함 | **medium**: 필드별 기간·shared Payment/Submission 관계와 pagination/재검증 필요 | 값/타입만이면 불필요 |
| P3 | 같은 파일의 PURGED_APPLICATION_FIELDS, `purgeFullyPurgedSubmissions`, Child/부속자료 변환(`:210`, `:223`, `:342`)을 재사용/필요시 내부 helper로 추출. 새 Payment/Refund NULL 변환과 기존 Deposit/Return 변환을 연결. approved fields만 갱신 | **medium**: 기존 정확한 제거 범위·S/형제·부분 처리 구분. 필요 없는 대규모 파일 이동 금지 | 불필요 |
| P4 | 비CONFIRMED 전용 scan/recheck를 같은 서비스에 추가. CTE의 CONFIRMED 필터를 제거하지 않음. G1/G2/G3와 G4 overlay, 명시 승인 근거·대상 scope 필요 | **medium**: provenance 부족·집단 중복/미래 예약·requestedChild와 실제 Child 구분 | 기존 사건으로 충분하면 불필요; 부족하면 P6 |
| P5 | `app/(admin)/reservation-applications/actions.ts`의 기존 ADMIN action 옆에 새 종류의 bounded 수동 action/scan adapter. Zod로 kind·id allowlist/정책 근거를 검증. 기존 no-argument 일반 sweep은 기존 범위 유지. 기존 receipt/deposit/return action의 **PII 파기 후 read-only receipt / 쓰기 replay 종료** 처리 | **medium**: 권한/재시도 원문 비교를 보존하면서 지워진 원문 재수집을 막음 | 불필요; 새 receipt 원문/hash 저장 없음 |
| P6 | 승인 정책이 현재 없는 목적종료/hold/세무 기산·감사 metadata를 요구할 때만 schema/migration 및 검증된 입력 경로 설계 | **large (조건부)**: 과거 근거 부재 해결·새 모델/권한·migration/고지 검토 필요. 최소안으로 숨기지 않음 | 필요; 별도 PLAN/승인 |
| P7 | `lib/payments/queries.ts`, `lib/reservation-applications/detail-queries.ts`, `return-queries.ts`, 필요시 devices/completion projection에서 파기 필드의 공통 표시/비노출. 원문 복원·새 join 사본 생성 없음 | **small**: nullable 표현과 최소 projection, 이미 있는 parent 표시 재사용 | 불필요 |
| P8 | 기존 retention page와 확인 버튼에 A16 필드 scope/A17 승인 집단의 구분·확인/결과/보류 사유/남은 batch 추가. 승인된 고지가 바뀌면 `lib/reservation-applications/consent-content.ts`의 새 version만 추가 | **medium**: 되돌릴 수 없는 동작의 명시 확인·접근성·여러 근거 표시. 고지만은 small | 불필요 |
| P9 | 백업/복제/복구 runbook과 새 ADR/REQUIREMENTS 결정 기록 | **medium (문서·운영)**: 실제 사본 소유자와 기한·접근/복구 절차 증거 필요. 현재 조사로 완료 주장 불가 | 불필요; 새 삭제증빙 저장 선택은 P6 |
| P10 | 스케줄러 **hook 위치만**: 미래 승인 시 `purgeExpiredPersonalDataCore` 인근의 bounded approved-scope entry를 호출 가능하게 설계. 현재 manual adapter만 연결 | **small (설계만)**: 기존 batch/hasMore/재실행 재사용. cron 구현/인증/서비스 actor/활성화는 별도 과제이며 이 추정에 포함하지 않음 | hook 자체 불필요; job table은 지금 필요 없음 |
| P11 | 공용 ClassSchedule.memo/cancelDetail/safetyMemo·Program.memo/description·Teacher.name/phone/memo는 별도 승인 scope에서만 `retention.ts`의 scan/변환 패턴을 재사용. 공유 목적 종료/PII 범위가 증명되지 않으면 보류. 운영/직원 모듈의 조회·입력 경계도 해당 담당자와 검토 | **medium (조건부)**: 한 고객의 만료가 공유 레코드의 만료가 아님. 부분 본문 판단은 자동 추론하지 않음 | 기존 nullable 필드 NULL은 불필요; Teacher.name은 공통 표시 후보. 별도 종료 metadata 필요 시 P6 |

### 잠금·재검증·원문 부활 방지

- 기존 일반 파기는 Submission → Application → Child 순서와 잠금 후 fresh read를 그대로 유지한다(`server/reservation-applications/retention.ts:237`, `:327`, `:334`). G1/G2 Child-only 후보라도 관련 신청/Submission이 생겼는지 확인하고 필요한 경우 같은 순서로 다시 획득/재판정한다. 판정이 달라지면 skip하며 원래 승인 범위를 넓히지 않는다.
- 새 **거래 필드** 처리에서 Payment/Refund는 현재 환불과 같은 Payment → PaymentItem → Refund 순서를 사용한다. parent 잠금 전에 대상을 탐색할 수 있으나 잠금 후 payment 관계/만료·추가 환불 등 기산사실을 재확인한다. 금액/누계/status 업데이트는 하지 않는다(`lib/payments/core.ts:114`, `:118`, `:125`).
- Deposit/Return의 필드 처리와 replay는 Submission을 먼저 잠그고, 필요한 ReturnObligation 및 하위 행은 기존 finance 순서와 일치시킨다(`server/reservation-applications/finance.ts:194`, `:413`; `app/(admin)/reservation-applications/actions.ts:176`, `:258`). S의 all-siblings 조건을 재사용한다. shared Payment는 한 Child의 만료만으로 다른 아이/입금자의 정당한 보관 범위까지 제거하지 않는다.
- 새 금융필드 batch와 Child batch를 한 트랜잭션에 무리하게 묶어 Child → Payment 같은 역방향 잠금 edge를 만들지 않는다. 새 수동 scope별 bounded transaction으로 나누고 결과도 scope별로 보고한다. 기존 일반 purge 한 tx의 원자성은 그대로다. 전체 여러 scope가 한 번에 원자적이라는 보장은 추가하지 않는다.
- 두 purge/금융 쓰기 경합 뒤에는 만료·새 사건·이미 파기·권한을 다시 확인한다. 실패 시 해당 tx rollback, `hasMore` 기반 명시 재실행만 허용한다. 신규 정책 범위의 batch 크기는 기존 한도를 우선 쓰고, 관계 fan-out은 별도 cap으로 제한한다. 실측 없이 성능 PASS/안전한 전체 sweep을 주장하지 않는다.
- payerName/reason 제거 이후에는 **기존 성공 거래를 원문 입력으로 다시 쓰는 replay를 종료**하고 권한·대상/key가 일치하는 기존 ledger receipt의 읽기 전용 확인만 제안한다(D16-REPLAY 승인 필요). 금액·시각/target/key 불일치는 계속 거절하고, 새 키로 자동 재처리하거나 비교를 느슨하게 해 성공이라고 답하지 않는다. 원문/이름 hash/별도 payload 사본을 만들어 비교를 살리는 방법은 최소안에 없다.
- 실제 새 입금/환불/반환은 새로운 금융행위의 적법 목적·기산사건으로 별도 판정해야 한다. 기존 파기 parent/Child 사본을 복원하지 않는다. 필요 PII를 새로 처리할 수 있는지 불명확하면 운영자 검토로 보내되 금액·환불 자격·NO_SHOW 생성 상세 의무를 임의 변경하지 않는다. 파기된 부모에 새 사유를 기록하는 경우의 구체 입력 계약은 D16-RETURN/REPLAY 승인과 함께 확정해야 한다.

### 명시적으로 필요 없는 것

새 microservice/queue/범용 retention framework, 외부 개인정보 처리 서비스, 고객 계정, 이름/전화 hash 저장소, 원문 사유를 복제하는 archive, 신규 결제/환불 API, ledger 재계산 엔진, 금융행/FK cascade 삭제, 기존 고객 5년 rule 수정은 필요 없다. 기본안에는 schema migration·새 job table·운영 cron·CI/workflow/config 수정도 필요 없다. 기술 선택만으로 정책 승인 단계를 늘리지 않으며, 실제 근거/모델이 부족한 P6만 별도로 다시 설계한다.

## UI

기존 ADMIN Server Component page가 권한 확인 후 최소 후보·정책종류·기산일/만료일·제거 필드·남는 원장·보류 사유를 렌더링한다. Client Component는 선택/확인·pending·결과 안내만 담당한다. 날짜/자격/권한/금액 규칙을 클라이언트 판정에 맡기지 않는다. 새로운 공개 UI는 없다.

기존 `PurgeExpiredButton`의 확인을 확장하거나 인접한 작은 컴포넌트를 둔다. 일반 C5/A1 수동 파기와 새 A16/A17 승인 scope는 명시적으로 선택하게 하고, 확인 문구에 제거 대상·불가역성·원장 보존을 표시한다. 표시 숫자는 실행 시점 자격 재검증 결과와 달라질 수 있음을 설명한다. 미승인/기산근거 없음/hold 대상은 버튼 비활성만으로 보호하지 않고 서버에서 거절한다. 기간 만료 전 “수동 강제 실행” 우회는 추가하지 않는다.

loading/empty/error, pending 중 중복 클릭 방지, `hasMore`·부분 scope 성공/보류, 스크린리더 상태, 모바일 표 표시를 기존 관리 화면 패턴으로 유지한다. 고객 원문은 확인 dialog·오류·로그/분석 이벤트에 복사하지 않는다. UI에 법률 ESTIMATE를 확정 법정기간으로 표시하지 않는다.

## Tests

**이번 실행은 문서 정적 검토만이다.** 아래는 정책/설계 승인 후 `$yaho-build`가 작성·실행할 검증 계획이다. 기존 테스트 파일은 읽었으며 PASS 재실행 주장이 아니다. 테스트는 합성 자료만 사용하고 현재 사용자의 모든 DB 접근 금지는 이번 세션 내내 유지한다.

| 요건/ADR 근거 | 지켜야 할 결과 | 정상/거부 케이스 | 검증 수준 | 예정 테스트 위치 / 재사용 |
| --- | --- | --- | --- | --- |
| SPEC AC01/04, ADR-057/058 | 기존 C5/A1·KST·fallback·마지막 날·CONFIRMED 범위 불변 | 승인 대상 만료 다음날 처리; 당일/미래예약/비CONFIRMED C5 편입 거부; 윤일/UTC 경계 | unit | 기존 `tests/unit/reservation-applications/retention.test.ts:64`, `:97`, `:326`, `:353` 재사용, 새 helper 사례 추가 |
| SPEC F01–F05/AC01, ADR-057/060 | 승인 필드만 NULL; 원장과 D=A+P+R+T/환불 누계/status/FK 유지 | 개별 필드 만료·이미 NULL·공유 Payment·다른 필드 미만료; 법정 기산 부족/미승인/해당 필드 hold 거부 | unit + integration | retention.test.ts 확장; 신규 제안 `tests/integration/reservation-applications/transaction-pii-retention.test.ts`; 기존 finance/ledger 검증 helper 재사용 |
| SPEC F04/F05/F07, S | 형제 모두 파기된 경우만 parent 기존 S 처리, 새 기간과 S는 승인대로 분리 | 모든 자녀 파기/한 자녀 미만료/다른 가족/미반환 잔액·목적 혼합; 다른 가족 PII 제거 거부 | unit + integration | 기존 `tests/unit/reservation-applications/retention.test.ts:440`, detail/return-queries test 확장; 신규 integration 위 파일 |
| SPEC G1–G4/AC03, ADR-058 | 별도 근거로만 비CONFIRMED 처리; G4를 별도 인원 합산 안 함 | 등록 출처 미상·신청만/Child 없음·requestedChild·과거 예약·취소/NO_SHOW·새 CONFIRMED 편입·날짜 근거 없음 | unit + integration | 신규 제안 `tests/unit/reservation-applications/nonconfirmed-retention.test.ts`, `tests/integration/reservation-applications/nonconfirmed-retention.test.ts` |
| SPEC BR1/AC02, ADR-057 | Child 변환/부속 삭제 재사용; 부분 안전 목적 파기가 금융·일반 고객 목적을 바꾸지 않음 | 전체 C/D/N 승인·안전정보만 만료·동의 이력만 보존 필요·공용 메모에 다른 아이의 살아 있는 목적 존재; consent 평상시 UPDATE/타 Child 삭제 거부 | unit + integration | tests/unit/reservation-applications/retention.test.ts:440/:484 및 위 nonconfirmed integration |
| SPEC K01–K04/AC02, D16-REPLAY | 파기 신원/원문 부활·권한 복구·중복 금융쓰기 금지 | 파기 후 기존 receipt 읽기; 동일 원문 replay 종료; 다른 target/key/금액/시각 거부; 신규 금융행위는 별도 근거 | unit + integration | 기존 `tests/unit/reservation-applications/admin-actions.test.ts`, `phase20-devices.test.ts`, `return-queries.test.ts` 확장; 신규 transaction-pii integration |
| SPEC AC06, ADMIN/입력 경계 | 미인증·MANAGER·TEACHER·잘못된 kind/id/version·빈 scope로 전체 sweep을 호출할 수 없음 | ADMIN 유효 scope, 잘못된 입력/불명정책 거부; 내부 scope sibling 누락=[] 유지 | unit + E2E | 기존 admin-actions.test.ts 및 신규 제안 `tests/e2e/retention-policy-scopes.spec.ts`(아래 환경 제한) |
| SPEC BR4/Conflicts, 기존 잠금 규약 | 새 reservation/confirmation/consent/safety/입금·반환·환불/purge 경합에 stale 판정·원문 재생성·deadlock 없음 | 두 purge; purge 전 후보 후 새 예약/CONFIRMED/금융 사건 commit; 환불 parent 대기·형제 submission; 단계별 실패 rollback | integration | 신규 두 integration; 기존 `tests/integration/reservation-applications/confirmation-atomicity.test.ts:182`, `tests/e2e/phase18-retention-concurrency.spec.ts`의 의도 재사용. PostgreSQL 두 연결·명시 barrier 사용; mock만으로 경합 증명 금지 |
| SPEC AC02, ADMIN 최소 projection/로그 | NULL 필드 원문/기타 가족·건강정보가 RSC/HTML/오류/log에 재등장하지 않음 | 합성 canary 값 입력→승인 파기→protected detail/receipt/완료/기기 재조회; 비ADMIN 직접 요청/임의 키 거부 | unit + E2E | 기존 detail-queries/return-queries/payments/queries tests; 신규 retention-policy-scopes E2E. UI의 확인·실패·hasMore·접근성은 별도 브라우저 assertion |
| SPEC B1–B4, E06 | 복구 뒤 만료 PII를 서비스에 재노출하지 않고 재처리 절차로 차단 | 별도 승인된 합성 snapshot 복구 리허설과 사본 잔존/권한 증거. 실제 고객 backup 사용 금지 | 운영 runbook 검증(별도 승인) | 신규 실행 문서(승인 후 경로 확정). unit PASS로 대체 불가; 이번 실행 대상 아님 |

동시성 검증은 새 대상의 관계/기간 재확인이 결과를 바꾸므로 필수다. 테스트 중 실제 금융/개인정보 조회는 필요 없다. 기존 금융 검증을 보존하며 환불 정책 자체의 새 테스트는 추가하지 않는다. scheduler를 구현하지 않으므로 scheduler delivery/cron 테스트는 **적용 안 됨**이다. schema 변경이 없으면 migration 테스트도 적용 안 됨이며 P6 선택 시에만 추가한다.

향후 실행 환경: 전용 폐기 가능한 합성 로컬 PostgreSQL을 우선하고, shared Preview의 전체 purge를 실행하지 않는다. Preview/Production 접근·migration·E2E는 기존 ADR-059/060 안전 정책과 별도 사용자 승인 범위가 확인될 때만 가능하다(`REQUIREMENTS.md:1976`; `docs/DECISIONS.md:555`). 이 문서는 해당 승인을 제공하지 않는다. 기존 phase18 전체 만료 sweep을 shared Preview에서 돌리면 안 된다.

## Acceptance Criteria

| ID | 승인 후 구현 완료 판정 |
| --- | --- |
| PAC01 | SPEC 27개 결정 행의 승인/전문가 근거 또는 범위 제외를 추적하고, 선택 범위의 Open Questions가 0이다. 새 ADR/REQUIREMENTS와 PLAN 설계 승인이 있다. |
| PAC02 | 기존 CONFIRMED C5/A1 계산·대상 범위/수동 실행·잠금/금융 불변식을 바꾸지 않는다. A17은 별도 정책·scope로만 진입한다. |
| PAC03 | 모든 새 필드 만료에 A층과 B층의 실제 근거/시작 사건이 있고, 없으면 실행하지 않는다. nullable이라는 이유로 법적 판정을 생략하지 않는다. |
| PAC04 | 제거 필드와 생존 원장/FK/enum/금액/일시/status가 SPEC와 일치한다. ledger 행·고유 중복 방지 키·금액 보존식은 훼손하지 않는다. |
| PAC05 | 서버 ADMIN/Zod, 명시 scope, post-lock 재검증, rollback, bounded batch/hasMore, 합성 경합 검증 및 UI 직접 검증을 통과한다. 파기된 신원/원문 재생성이 없다. |
| PAC06 | 백업/복제/복구·접근 통제의 운영 소유자와 승인된 종료 절차/증거가 있다. DB 값만 NULL로 만든 결과를 전체 익명화·사본 파기 완료로 보고하지 않는다. |
| PAC07 | schema 불필요 항목은 migration 없이 처리하고, P6/직원 FK 등 필요 항목은 별도 승인된 additive migration으로만 한다. scheduler는 연결하지 않는다. |

## Risks

- **정책/법률 미해결:** 27 REQUIRED 행은 기술 선택 문제가 아니다. 법령 기간을 과대·과소 적용하거나 기존 고객에게 C5를 소급하지 않는다. 한국 PIPA의 목적/필드 최소화와 아동·건강 관련 적용은 모두 전문가 검토가 남은 ESTIMATE다.
- **기산 근거 부족:** registeredAt/updatedAt/paidAt은 세무 신고기한·목적 종료·마지막 연락을 입증하지 않는다. 근거가 없으면 보류하거나 P6를 명시적으로 선택해야 한다. 날짜 backfill 추정은 금지다.
- **S와 별도 필드 기간:** 기존 parent 전부 파기 시점이 실제 반환 목적/필드 증빙보다 빠르거나 늦을 수 있다. 데이터에서 실제 발생했다고 주장하지 않으며 승인 없이 S/C5를 연장하지 않는다.
- **반복 요청/금융 사건:** 원문을 지우면 현재 equality 비교로 과거 payload replay가 실패한다. 무조건 성공 응답/새 key/원문 hash 보관으로 우회하면 금융·개인정보 경계를 바꾼다. D16-REPLAY와 신규 금융행위 처리 계약이 먼저다.
- **부분 파기/형제/actor 연결:** 한 사람·목적의 종료가 가족/다른 아이·직원 계정까지 제거하면 안 된다. 반대로 잔존 FK/장부/금액·시간·ILLNESS enum이 식별 단서가 될 수 있으므로 완전 익명화라고 표시하지 않는다.
- **운영 사본:** 복제본·PITR·내보내기·로그의 실제 상태는 미확인이다. 백업 최종 잔존/분리 보관과 복구 후 재파기는 코드 변경만으로 완료되지 않는다.
- **규모/잠금:** shared Payment/Submission의 fan-out·실제 backlog/timeout은 미측정이다. 기존 batch cap을 재사용하되 새 관계 fan-out을 제한하고 합성 경합에서 검증한다. 운영 DB 측정은 이번 승인 범위 밖이다.

## Implementation Order

아래는 **미래 승인 후 순서**이며 현재 실행 목록이 아니다. 한 번에 한 정책 기능만 열고 각 단계 뒤 검증한다.

1. **정책 문서 확정 (small; 기술 구현 0)** — 27행의 답과 E01–E08 전문가 결과를 받고 새 ADR/REQUIREMENTS/PLAN 범위를 확정한다. 기존 C5/A1/금융 불변식 diff를 검토하고 사용자의 설계 승인을 받는다. 확인 결과: 선택 범위의 기간·기산점·방법·예외/사본 책임이 모두 존재한다.
2. **A16 순수 판정 (small)** — `$yaho-build` 개발 subagent에서 P1을 구현하고 unit으로 날짜/불명정책/기존 C5 불변을 검증한다. 현재 컬럼으로 부족하면 P6를 별도 설계하여 승인 전 중단한다.
3. **A16 bounded scan/변환 (medium)** — P2/P3의 Payment/Refund 필드부터 최소 범위로 구현, ledger 보존·잠금·재검증·rollback integration으로 확인한다. Deposit/Return/S 및 replay 승인도 완료한 다음 해당 필드를 연결한다. 원문 재수집을 허용하지 않는다.
4. **A16 adapter/UI/projection (medium)** — P5/P7/P8. ADMIN 직접 action 거절/빈 scope/receipt, 브라우저 확인·pending/error/hasMore·비노출을 검증한다. 사본 runbook P9가 준비되기 전 실제 운영 실행은 하지 않는다. P11의 공용/직원 필드는 별도 정책 승인이 완료된 한 필드씩만 이어서 다루며, 미승인 항목은 계속 보류한다.
5. **A17은 A16 단계가 닫힌 뒤 집단 하나씩 (각 medium; P6가 필요하면 large)** — P4로 승인된 G1→G2→G3 순서 또는 운영자가 선택한 한 집단을 연다. G4는 그 집단의 필드별 overlay로 적용하며 새 전역 5년 정책을 만들지 않는다. 매 집단 unit/integration/E2E로 분류·재확인·기존 C5 불변을 검증한다.
6. **QA→Review→필요 수정→SHIP gate (medium)** — 향후 코드 변경에는 repo workflow대로 독립 역할·합성 검증을 적용한다. 적절한 lint/test/typecheck와 build는 그때 규칙에 따라 수행하며 build 전 포트에 의존하지 않는 dev 프로세스 점검을 한다. 이번 문서 작업은 그 검증의 PASS가 아니다. stage/commit/push/merge/배포/실제 파기는 별도 승인 범위다.

**승인 전에 절대 하지 않는 일:** 실제 개인정보 삭제·익명화/대상 DB 조회, scheduler 구현·활성화, schema 수정·migration 실행, 기존 고지/동의/보유기간 소급 변경, 신규 PII/hash 수집, build 진입. **이 세션의 추가 금지:** 모든 DB 접근(local/Preview/Production), product code/tests/workflows/config 변경, 테스트·빌드 실행, staging/commit/push. 두 문서만 작성하고 정책·설계 승인 대기 상태로 종료한다.
