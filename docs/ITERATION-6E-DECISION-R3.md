# Requirement

YAHO 개인정보 정책 결정 Round 3 — 연결·capability·재시도 K01–K04 운영자 결정표.

기준: `f37398655fce1edf5bd6399f56c9aedc6f743b17` · `feature/phase21-ai-service` · PR #54 Draft(사용자 제공; 원격 재조회 없음). 작성일: 2026-10-24 UTC. **DOCS ONLY / 정책 방향 검토안 / 최종 정책 승인 아님.**

근거: [6E SPEC K01–K04·BR1–4·E01–E08](ITERATION-6E-SPEC.md#정책-결정표--핵심-산출물), [6E PLAN Gate 0·Data Model·P5·원문 부활 방지](ITERATION-6E-PLAN.md#task), 미커밋 [Round 1](ITERATION-6E-DECISION-R1.md)·[Round 2](ITERATION-6E-DECISION-R2.md). R1·R2는 읽기만 했으며 승인된 정책으로 취급하지 않는다. SPEC/PLAN의 조사 HEAD는 `12bfdf6`이고, 아래 코드·스키마 인용은 이번 기준 HEAD에서 정적으로 확인했다. DB·실제 개인정보·운영 설정·백업 내용은 조회하지 않았다. `agent-memory-repo` 스킬은 로컬 설치·프로젝트·Memory 경로에서 찾지 못했으며, 기존 Memory는 보조 문맥으로만 읽었다.

## Problem

이름·연락처·자유입력을 지워도 안정적인 ID·FK·기기 관계·거래 키가 남는다. 이 잔존 연결의 식별 가능성, capability의 접근 종료와 저장 종료, 원문이 사라진 거래의 receipt/replay 계약을 따로 결정해야 한다. 필드 파기를 완전 익명화로, 토큰 만료를 DB 행 파기로, 기존 receipt 발견을 동일 payload 재실행 승인으로 보고할 수 없다.

## Current Process

- 일반 고객 파기는 기존 C5/A1 범위에서 Child 변환, 신청 사본 NULL, ChildConsent·ChildSafetyInfo·Relationship·해당 DeviceChild 삭제, `requestedChildId` NULL과 tombstone을 처리한다. 예약·금융행·주요 FK·처리자·시각은 유지한다([retention.ts:342](../server/reservation-applications/retention.ts#L342)). **S**는 모든 자녀 신청이 이미 파기된 Submission에 한해 보호자·선언명과 연결 Deposit.payerName·Return.reason을 NULL 처리하는 현행 조건이다([retention.ts:223](../server/reservation-applications/retention.ts#L223)).
- 기기 조회·재신청은 `revokedAt: null`, `expiresAt > now` 및 파기 여부·유효 Child 범위를 확인한다. 철회 함수는 `revokedAt`만 기록한다([devices.ts:35](../server/reservation-applications/devices.ts#L35), [devices.ts:73](../server/reservation-applications/devices.ts#L73), [groups.ts:268](../server/reservation-applications/groups.ts#L268)). 이 경로와 일반 파기에 만료 ApplicationDevice·DeviceSubmission의 저장 종료 처리는 없다.
- 완료 조회·입금 알림은 유효 hash·`completionExpiresAt > now`·Submission 미파기를 확인한다([completion.ts:17](../lib/reservation-applications/completion.ts#L17), [completion.ts:61](../lib/reservation-applications/completion.ts#L61)). S는 `completionTokenHash/completionExpiresAt`를 지우지 않는다([retention.ts:232](../server/reservation-applications/retention.ts#L232)).
- `lookupWorkflowReceipt`는 ADMIN 읽기 전용이다. formData 없이는 종류·대상·키로 기존 receipt를 읽고, formData가 있으면 금액·이름/사유·일시도 비교한다. 쓰기 action도 같은 원문을 비교한다([actions.ts:201](../app/%28admin%29/reservation-applications/actions.ts#L201), [actions.ts:234](../app/%28admin%29/reservation-applications/actions.ts#L234), [actions.ts:261](../app/%28admin%29/reservation-applications/actions.ts#L261)).

## User Story

운영자는 원장·중복 방지·처리 책임을 보존하면서 불필요한 신원 연결과 접근 수단을 종료하고, 파기 후에는 이미 저장된 금융행위만 안전하게 확인하고 싶다.

## Scope

K01 / D16-LINK, K02 / D16-DEVICE, K03 / D16-COMPLETION, K04 / D16-REPLAY의 목적·종료 사건 후보·잔존 데이터·기간 검증 상태와 승인 경계를 작성한다. R1 F04/F05의 receipt/replay 및 R2 직원·공용 필드 결정을 의존 관계로 연결한다.

## Out of Scope

다른 파일 수정, 정책 최종 확정, REQUIREMENTS/ADR 반영, 코드·테스트·설계 구현, DB 접근·실제 개인정보 조회·삭제, migration·scheduler·CI·stage/commit/push. G1–G4는 마지막에 목록만 남긴다. 금액·환불 규칙·수집항목·새 hash 저장을 결정하지 않는다.

## Business Rules

- **A층 / B층 / L:** A층은 거래 행·금액·일시·상태·FK·배정·환불/반환 누계, B층은 개별 개인정보의 목적별 필요성이다. `L`은 실제 적용되는 증빙 분류의 기간·기산점이며 **ESTIMATE / 미결정**이다. A층 유지가 고객 실명·직원 이메일·기기 hash·완료 hash의 일괄 보존 근거가 되지 않는다. K04의 중복 방지 키는 금융 무결성과 별도 관계가 있으므로 K02/K03의 불필요 capability와 같은 삭제 묶음으로 취급하지 않는다.
- **기간과 법적 적용:** 아래 ③은 목적 종료 사건의 추천이며 확정된 만료일이 아니다. ④·⑦의 법령 적용·증빙 필요성·예외·새 저장 종료기간은 모두 **ESTIMATE / 미결정**이다. SPEC에 없는 숫자 기간은 제안하지 않는다. 현행 접근 TTL 상수는 접근을 허용하는 한계이며 DB 행 보관기간의 법적·운영 승인값이 아니다. C5/A1/S를 K항목의 새 보관기간으로 전용하지 않는다.
- **법령 코드:** P·H·E/T/C는 [SPEC BR2](ITERATION-6E-SPEC.md#br2-근거-표기와-법률-검토)의 개인정보·아동/건강·전자상거래/세무/장부 검토 후보다. 공식 [개인정보 보호법 제15조](https://www.law.go.kr/LSW/lsLinkCommonInfo.do?chrClsCd=010202&lsJoLnkSeq=1033214947)와 [제21조](https://www.law.go.kr/LSW/lsLinkCommonInfo.do?chrClsCd=010202&lsJoLnkSeq=1029334901) 공개 조문을 보조 확인했다. 목적·필요성 종료와 법령상 보존 예외의 구별을 참고하되 YAHO의 필드별 적용·적법 근거·기간을 확정한 것은 아니다. E/T/C의 숫자 후보도 이 문서에서 K항목의 기간으로 채택하지 않는다.
- **B1–B4:** 논리적 필드/행 제거와 백업·PITR·복제본·내보내기·로그의 종료는 다르다. 사본별 최종 잔존·접근자·복구 후 재파기 책임은 E06 검토다. 파기 원문·새 이름 hash·별도 역매핑을 삭제증빙이나 재시도 자료로 만들지 않는다. 잔존 ID·hash를 법률상 익명정보라고 단정하지 않는다.
- 아래 ⑧의 **방향 후보**와 **독립 승인 필요**는 둘 다 미승인 상태다. 배치 방향 승인만으로 개별 기간·예외·실행 승인이 성립하지 않는다. 모든 승인 후보는 행별 ID로 기록해야 한다.

### 운영자 결정표 — K01–K04 / 8점 구조

| 항목·정적 근거 | ① 현재 목적 | ② 분리 가능성 | ③ 추천 목적 종료 사건 | ④ 적용 가능 법령 및 증빙 예외 | ⑤ 기존 파기 정책과의 충돌 | ⑥ 파기 이후 조회·감사·권한·운영 영향 | ⑦ 추천 보관 기간과 기산점의 검증 상태 | ⑧ 권장안·대안·운영자 결정 필요 사항 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **K01 / D16-LINK**<br>고객·감사 연결 tuple 전체는 아래 보충표 참조.<br>[Child:222](../prisma/schema.prisma#L222) · [Application:537](../prisma/schema.prisma#L537) · [원장:683](../prisma/schema.prisma#L683) · [Item/Refund:819](../prisma/schema.prisma#L819) | 동일 고객·예약·거래의 이력 연결, 입금 배정·반환·환불 검증, 동의/안전 출처와 처리 책임 확인. | PII 필드 제거와 원장/FK 보존은 분리 가능하나 **안정적인 FK가 남는 한 연결 가능성이 끝나는 것은 아님**. C5에서 제거하는 부속행/요청 연결과 남기는 원장/actor 연결을 구분. | 고객 목적은 기존 C5/A1/S를 유지. 잔존 연결은 **해당 이력·처리 책임·실제 증빙 필요의 종결**을 별도 종료 사건 후보로 검토. 한 개인 필드의 목적 종료를 원장 FK 제거 사건으로 바꾸지 않음. | **ESTIMATE:** P/H·E04/E05, 원장에 실제 적용되는 E/T/C·E02/E03, 직원 책임 E07. 확인된 최소 연결·필드만 분리·제한 보관 후보. 막연한 감사 가능성이 고객 신원·직원 실명 전체의 무기한 보존 근거가 아님. | C5에서 삭제되는 Consent/Safety/Relationship을 감사 tuple이라는 이유로 되살리거나 연장 금지. 기존 금융 FK·처리 기록 보존, 요청 연결 NULL+tombstone 유지. R1 원문 제거 및 R2 직원/공용 본문 판단과 별도 의존. | 이름 NULL 뒤에도 동일 Child의 수업·출결·금융 이력을 묶을 수 있고 미파기 형제·공유 Payment·잔존 원문·외부 장부로 신원에 도달할 수 있음. actor FK로 직원 신원에 도달. ADMIN 금융 접근이 건강/직원 신원의 무제한 조회 권한은 아님. | **ESTIMATE / 미결정:** 원장 L과 개인/직원 연결 필요기간·접근 종료·정확한 기산점. 기존 C5가 잔존 tuple 전체의 종료일은 아님. `paidAt/updatedAt/파기시각`으로 새 기간을 추정하지 않음. | **권장:** 금융·책임 FK 보존, 기존 부속/요청 연결 종료만 유지, 최소 조회 및 식별 위험을 명시.<br>**대안:** 입증된 최소 책임 연결만 제한 조회하는 별도 정책 검토. FK 단절·새 대체 ID/역매핑은 이번 후보 아님.<br>**결정:** 그래프별 필요성·접근자·기간/기산점·외부 자료 결합 및 익명성 판단을 **독립 승인 필요**. |
| **K02 / D16-DEVICE**<br>`ApplicationDevice.tokenHash/expiresAt/revokedAt` · `DeviceChild` · `DeviceSubmission`<br>[schema:643](../prisma/schema.prisma#L643) · [devices:35](../server/reservation-applications/devices.ts#L35) | 같은 기기에서 직접 제출한 보호자의 제한된 재신청 편의·자녀 선택. 연락처 조회나 일반 고객 계정 권한 아님. | 접근 TTL/철회와 hash·기기 행·관계 행의 저장 종료를 분리 가능. Device 관계는 원장 FK가 아니며 제거해도 Submission·Child·금융행 자체를 지우는 것은 아님. `tokenHash`는 필수이므로 단순 NULL은 현 schema 후보가 아님. | **접근 만료 또는 철회**, 개별 grant는 **연관 PII 파기 또는 정당한 재신청 연결 목적 소멸**을 종료 사건 후보로 추천. 유효한 다른 자녀/Submission 범위가 남는 기기 전체의 종료와 개별 grant 종료를 구별. | **ESTIMATE:** P/H·E05/E06. 구체 보안 사고·분쟁에서 hash/관계 자체가 필요한 최소 증거인지 별도 입증된 때만 제한 잔존 예외 검토. E/T/C 원장을 이유로 편의 토큰·관계를 일괄 L까지 보존하지 않음. | 만료·철회는 현행 접근 거절일 뿐 저장 삭제 아님. C5는 해당 DeviceChild만 삭제하고 DeviceSubmission·ApplicationDevice는 남김. S 후에도 이 둘의 자동 종료 없음. 다른 형제·가족의 유효 범위를 고객 한 명의 파기로 일괄 제거 금지. | 만료/철회 hash만으로 현행 접근은 불가. 잔존 관계는 같은 기기와 신청·자녀의 연결을 드러내고, 잘못된 권한 복구/검증 누락 때 재노출의 경로가 될 수 있음. 제거하면 이전 자녀 선택·보호자 prefill이 사라져 새 신청 필요. 원장 조회·K04 receipt에는 영향 없어야 함. | **ESTIMATE / 미결정:** 만료/철회 후 DB hash·기기·관계를 얼마 동안 둘지는 승인값 없음. **권장 후보는 목적 종료 시 불필요 잔존 중단**, 별도 유예 숫자 없음. 예외는 근거·최소 범위·종료 사건/최종 잔존기한 확인 전 기간 산정 불가. | **권장:** 접근 차단 유지, 불필요 grant와 목적을 잃은 기기/hash의 저장 종료 방향.<br>**대안:** 입증된 보안 증빙 범위만 서비스 접근과 분리·제한 보관 후보.<br>**결정:** 개별 grant/기기 단위·종료 시점·유효 형제 보호·예외/사본 종료는 **독립 승인 필요**. TTL을 저장기간으로 승인하지 않음. |
| **K03 / D16-COMPLETION**<br>`Submission.completionTokenHash/completionExpiresAt`<br>[schema:516](../prisma/schema.prisma#L516) · [completion:20](../lib/reservation-applications/completion.ts#L20) | 본인 제출의 완료 송금 안내, 입금 알림, 유효 완료 capability를 이용한 제출 결과 확인. 금융 원장 인증이나 ADMIN receipt 권한 아님. | nullable hash를 종료하면서 Submission·신청·금액 snapshot·금융 원장을 유지 가능. **종료 대상은 capability 필드이며 Submission 행 삭제가 아님.** expiry 시각의 별도 최소 증빙 필요성은 hash와 구별. | **완료 접근 만료 또는 그 capability 대상 PII 파기 중 먼저 발생한 사건**을 기본 종료 후보로 추천. 완료 목적이 사라지면 만료 대기 없이 종료하는 방향. 공유 형제 범위의 부분 파기는 아래 별도 판단 필요. | **ESTIMATE:** P/H·E05/E06. hash 자체의 구체적 별도 증빙 필요성은 미확인. **금융 L은 완료 hash 보관 근거로 사용할 수 없음.** 별도 사건 증빙 주장은 독립 적법 근거·필요성·제한 접근·종료를 전문가에게 확인해야 함. | 현행 S는 hash/expiry를 남기고 parent 파기 표시로 접근 차단만 함. 현행 만료 검사도 hash를 NULL로 만들지 않음. R1 선언명·R2 공용/건강정보 파기와 완료 capability 저장 종료는 자동 연동된 정책이 아님. | hash NULL 뒤 기존 완료 화면 접근·알림·해당 제출 replay는 유효 capability로 인정될 수 없음. 그 결과가 입금/반환·Payment 생성이나 ADMIN 원장 조회를 취소/차단할 근거는 아님. 잔존 hash는 제시 토큰과 Submission을 연결할 수 있어 익명성 주장의 근거가 되지 않음. | **ESTIMATE / 미결정:** 접근 TTL은 현행 기술 한계이며 DB hash 잔존기간 아님. 추천은 종료 사건에서 불필요 hash NULL, 추가 숫자 기간 없음. 부분 PII 파기 단위·expiry metadata 필요성·예외와 처리 시점은 미승인. L/C5를 더해 연장 불가. | **권장:** 완료 목적·접근 종료에 맞춰 hash NULL, 원장/Submission 보존.<br>**대안:** 유효 형제 안내가 남은 경우 승인된 최소 범위만 유지할지 개별 검토; 만료·파기 접근을 복원하거나 L까지 연장하지 않음.<br>**결정:** PII 파기 단위·hash 종료·expiry 정보·공유 형제 영향은 **독립 승인 필요**. |
| **K04 / D16-REPLAY**<br>`ApplicationDeposit.idempotencyKey` · `ApplicationReturn.idempotencyKey`<br>[schema:691](../prisma/schema.prisma#L691) · [schema:738](../prisma/schema.prisma#L738) · [actions:201](../app/%28admin%29/reservation-applications/actions.ts#L201) | 기존 성공 입금/반환의 식별·중복 기록 방지·receipt 재조회. bearer capability나 이름 보존 목적과 다름. | F04 이름/F05 사유 NULL과 원장·고유 키 유지는 양립. **read-only receipt 확인**과 **원문 equality 기반 write-replay**를 분리해야 함. 원문이 NULL이면 과거 문자열과 동일성은 증명되지 않음. | **원문 목적 종료·파기**는 기존 성공 거래의 원문 기반 쓰기 replay 종료 사건 후보. 키 자체의 중복 방지·receipt 식별 목적 종료는 별도 판단이며 같은 사건에 자동 삭제하지 않음. | **ESTIMATE:** P·E05/E08, 해당 금융 증빙의 E/T/C·E02/E03. 중복 방지·증빙에 필요한 키·연결의 최소 범위/기간을 따로 확인. 키 필요성이 삭제된 이름/사유나 새 비교용 hash를 보존할 근거는 아님. | S가 F04/F05를 NULL로 만들지만 고유 키는 남김. 기존 원문 비교는 NULL과 불일치하여 formData receipt/쓰기 replay 실패. R1 F04/F05·S 선후 및 PLAN P5 계약은 미승인. 키 삭제/회전이나 비교 생략으로 이 충돌을 우회 금지. | 파기 후 ADMIN의 종류·대상·키가 맞는 기존 receipt 읽기만 제안. 원문 재입력·동일 요청의 쓰기 성공 간주·새 키 자동 재처리 금지. 잔액·배정·누계 및 최신 원장 확인을 유지하며 반환 초과·중복 입금/반환을 막아야 함. 아래 동작표 참조. | **ESTIMATE / 미결정:** 키의 필요 보관기간·기산점·receipt 조회 창·파기 후 경계는 별도 승인 필요. 원문 파기 시 쓰기 replay 종료 방향과 키 보존 요구만 제시하며 무기한 키 보관이나 임의 창을 승인하지 않음. | **권장:** 키/원장 유지, 파기 후 기존 receipt는 읽기 전용 확인, 기존 성공 거래의 원문 기반 write-replay 종료.<br>**대안:** 기존 비교를 유지해 충돌을 거절하고 별도 ADMIN 원장 확인으로 안내; 원문을 복원하지 않음.<br>**결정:** 아래 정확한 계약·키 필요기간·결과 불명/미발견 처리·신규 금융행위는 **독립 승인 필요**. 키 변경·비교 완화·새 이름 hash는 이번 승인 후보에서 제외. |

### K01 보충 — 잔존 FK 그래프와 익명화 주장의 한계

이 문서의 Application/Submission/Deposit/Return/Obligation/Mapping/Allocation/SafetyInfo는 각각 `ReservationApplication` / `ReservationApplicationSubmission` / `ApplicationDeposit` / `ApplicationReturn` / `ReturnObligation` / `ReservationApplicationPaymentMapping` / `FundAllocation` / `ChildSafetyInfo`의 약칭이다. 새 모델을 뜻하지 않는다.

| 연결 tuple·근거 | 기존 파기 후 남거나 끝나는 연결 | 재식별·조회 영향과 R1/R2 의존 |
| --- | --- | --- |
| `Child.id` → `Reservation.id/childId` → `PaymentItem.reservationId/paymentId` → `Payment`; `Refund.paymentItemId`([schema:408](../prisma/schema.prisma#L408), [schema:819](../prisma/schema.prisma#L819)) | 고객 표식과 원장 ID/FK, 수업·출결·취소/환불 enum·금액/시각 유지. Payment가 여러 Item을 공유할 수 있음. | 같은 아이의 이력 묶음은 계속 추적 가능. 공유 Payment의 다른 아이·R1 F01/F02/F03 미종료 이름/메모/환불 상세, 수업 명단·은행 기록 등 외부 자료가 있으면 신원에 도달할 가능성. `Refund.reason=ILLNESS`도 잔존 단서다. 일반 Child 파기만으로 거래 원문이 모두 없어졌다고 주장하지 않음([결제 상세:58](../lib/payments/queries.ts#L58)). 실제 결합·식별 성공 여부는 미조회. |
| `Application.childId/reservationId/submissionId` ↔ `Submission.id`; `Application.requestedChildId`([schema:537](../prisma/schema.prisma#L537)) | 확정 연결·Submission 행·확인/동의 boolean/version·상태·시각은 유지. C5의 요청 연결은 NULL과 `requestedChildPurgedAt` tombstone으로 종료. | 같은 Submission의 미파기 형제가 남으면 S가 성립하지 않아 보호자·선언명 등 parent PII가 남을 수 있음. 파기된 자녀도 그 가족과 연결될 수 있다. 요청 FK를 지웠다는 사실이 확정 `childId`·예약 FK도 끊었다는 뜻은 아님. R1 F07과 F04/F05의 S 관계를 따로 추적. |
| `Deposit.submissionId` → `Allocation.depositId/paymentMappingId/returnObligationId`; `Mapping.applicationId/paymentItemId`; `Obligation.applicationId/submissionId`; `Return.returnObligationId`([schema:683](../prisma/schema.prisma#L683)) | 입금→배정→PaymentItem/반환 의무→반환 경로·금액·누계 유지. | 원장 경로를 따라 예약·Child·Submission·형제에 도달 가능. R1 F04/F05 원문 NULL은 이 경로 단절이 아니다. K04 키도 원장 한 건을 다시 특정하므로 익명화 수단이 아님. |
| `ChildConsent.childId/reservationApplicationId/recordedById`; `SafetyInfo.childId/updatedById`; `Relationship.childAId/childBId`([schema:255](../prisma/schema.prisma#L255), [schema:273](../prisma/schema.prisma#L273), [schema:296](../prisma/schema.prisma#L296)) | **해당 C5 Child의 부속행은 삭제되므로 그 행의 FK도 남지 않음.** 거래 필드만 NULL로 하는 별도 처리에서는 이 부속행이 자동 삭제되지 않음. | 모든 tuple이 언제나 잔존한다고 설명하면 틀림. 삭제된 ChildConsent와 달리 Application의 확인/동의 boolean/version은 남음. R2 F52·F50–F54/F57의 공용 본문에 별도 사본·문맥이 있을 가능성은 그 별도 필드 결정 대상이며 실제 존재는 미확인. 금융 증빙을 이유로 부속행의 삭제 예외를 새로 만들지 않음. |
| `Child/Application.personalDataPurgedById`; `Reservation.cancelledById/attendanceRecordedById`; `Application.depositConfirmedById/resolvedById`; `Submission.updatedById` → `User`([schema:238](../prisma/schema.prisma#L238), [schema:408](../prisma/schema.prisma#L408), [schema:518](../prisma/schema.prisma#L518), [schema:578](../prisma/schema.prisma#L578)) | 파기·취소·출결·확정/해결·수정 actor 연결과 해당 시각 유지. 금융 actor인 `Refund.processedById`, `Deposit.confirmedById`, `Return.processedById`도 R2 F33–F35 범위에서 유지. | User의 현재 이름/이메일 및 선택적 Teacher 연결에 도달 가능([schema:164](../prisma/schema.prisma#L164)). 이것은 직원 신원 연결이며 고객 신원을 그 자체로 증명하지는 않지만 사건 문맥·직원 보유 정보와 결합 가능. R2 F33–F37/F55–F57의 별도 목적·조회 제한을 유지. 고객 파기로 User/ADMIN 계정 삭제·필수 FK NULL·직원 신원 일괄 제거 금지. |

**주장 가능한 범위:** 승인된 필드·부속행을 실제로 처리하고 검증한 범위에서만 “지정 개인정보 필드 제거/기존 정책상 비식별화; 예약·금융·책임 연결 잔존”이라고 보고하는 방향이다. 이 문서 작성은 그 처리·검증 실적이 아니다. **주장할 수 없는 범위:** `(파기됨)`·NULL·token hash만으로 “법률상 익명정보”, “개인/가족과 재연결 불가”, “전체 사본까지 파기 완료”, “개인정보 관련 의무에서 제외”라고 단정하는 것. 안정적 ID는 이름 복구 없이도 동일 대상을 묶을 수 있고, 일부 살아 있는 원문·형제·공용 본문·외부 장부가 있으면 실명에 이를 가능성도 있다(**ESTIMATE**, E05). ledger FK를 보존하는 동안 이 연결 가능성이 끝났다고 말할 수 없다. 향후 원장 자체의 최종 폐기는 이번 라운드의 승인 대상이 아니다.

### K02/K03 보충 — 접근 TTL과 저장 종료

- **K02 접근:** 현행 `APPLICATION_DEVICE_TTL_MS`와 만료/철회 predicate를 유지한다. 만료·철회 토큰은 새 신청이 필요하며 전화번호로 복구하지 않는다. hash 값만으로 원문 토큰을 복원할 수 있다거나, 만료된 토큰이 현재 서비스에서 유효하다고 주장하지 않는다. 다만 hash는 제시된 토큰을 특정 device 행에 매칭할 수 있고, DeviceSubmission/DeviceChild는 동일 기기 연결을 남긴다. stale 행은 그 연결 분석을 가능하게 하며 검증 누락·잘못된 복구가 생겼을 때 과거 권한의 재노출 경로가 될 수 있다. 이는 현재 우회 접근이 성공한다는 실측이 아니다.
- **K02 저장:** 만료/철회 후 **얼마 동안 더 남길 수 있는지 승인된 기간이 없다(ESTIMATE / 미결정)**. 추천은 필요 목적이 끝난 grant·기기/hash의 불필요 잔존 종료이며 임의 유예를 추가하지 않는다. 예외를 주장하려면 hash/관계 각각의 구체 필요성·근거·접근자·종료 사건·최종 잔존기한을 별도로 승인해야 한다. 철회 표시가 존재한다는 것만으로 무기한 보관이 정당화되지 않는다. 여전히 유효한 기기의 다른 자녀/Submission 관계는 독립적으로 확인하며 전체 기기 종료와 개별 관계 종료를 합치지 않는다.
- **K02 제거 단위:** ApplicationDevice.tokenHash는 필수, DeviceChild/DeviceSubmission은 별도 관계 행이다([schema:643](../prisma/schema.prisma#L643)). 기기 행 제거에 따른 관계 행 cascade는 **금융행/FK cascade 삭제와 구별**된다. 이 schema 사실이 실제 제거 허가는 아니다. 다른 유효 범위·증빙 예외를 확인한 뒤 최종 단위와 시점을 승인해야 한다. grant 제거가 Child/Submission/금융 원장 삭제나 고객 신원 복구로 이어져서는 안 된다.
- **K03 저장:** 현행 `COMPLETION_TTL_MS`는 접근 한계일 뿐 hash 보관기간이 아니다. 기본 추천은 완료 만료 또는 capability 대상 PII 파기의 먼저 발생한 종료 사건에서 **hash를 NULL로 끝내고**, Submission/원장을 남기는 것이다. 이 권장 종료 사건과 실제 처리 시점·사본 전파/백업 종료는 아직 승인되지 않았다. `completionExpiresAt` 자체를 별도 증빙으로 남길 필요가 있는지와 그 종료도 독립 확인한다. K03 hash를 L까지 유지하거나 만료를 갱신해 보존하는 안은 금융 보존의 이유로 승인할 수 없다.
- **K03 부분 파기:** 공유 Submission의 자녀 한 명/선언명 등 일부 PII가 먼저 파기될 때, 전체 완료 hash를 종료할지 유효 형제의 허용 안내만 남기는지 **미결정**이다. 기본 종료 후보를 조용히 S 전체 파기까지 늦추지 않는다. 현행 완료 조회는 parent 미파기와 만료를 검사하고 SUBMITTED 자녀 안내를 고르지만, 일반 파기 처리는 완료 hash를 제거하지 않는다. 유효 형제 목적을 이유로 파기된 원문·권한을 되살리거나 다른 가족의 권한을 넓히지 않는 범위를 따로 승인해야 한다.
- **K03 다른 사용처:** 완료 hash는 송금 안내뿐 아니라 `markApplicationDepositNotified`의 알림과 [groups.ts:251](../server/reservation-applications/groups.ts#L251)의 이미 제출한 요청 확인에도 사용된다. 종료하면 그 완료 capability로 이 동작을 다시 성공시킬 수 없다. “입금했어요”는 금융행위가 아니며 이 영향이 입금/반환 원장·K04의 ADMIN receipt를 다시 쓰거나 지울 이유가 되지 않는다.

### K04 보충 — 파기 후 receipt와 write-replay의 정확한 승인 후보

**현행 사실과 의존:** R1의 [F04/F05 보충](ITERATION-6E-DECISION-R1.md#표-보충-및-open-questions)은 formData 없는 읽기와 원문 비교 쓰기를 구별한다. F07 선언명은 직접 replay 비교 필드가 아니다. 입금은 `payerName`, 반환은 `reason`이 필수 문자열이고([validation:87](../lib/reservation-applications/phase20-validation.ts#L87)), 서버는 prior의 대상·금액·이름/사유·시각을 비교한다. 파기 후 prior의 NULL은 이전 문자열과 같지 않다. NULL을 빈 문자열이나 wildcard로 해석해 성공 처리할 수 없다.

현 ADMIN 폼의 “저장 결과 조회”도 `attempt.current` formData를 전달하므로 원문 파기 후 그대로 성공하는 UI라고 설명할 수 없다([deposit-form.tsx:74](../app/%28admin%29/reservation-applications/submissions/%5Bid%5D/deposit-form.tsx#L74), [deposit-form.tsx:89](../app/%28admin%29/reservation-applications/submissions/%5Bid%5D/deposit-form.tsx#L89)). 다음은 **D16-REPLAY로 독립 승인받을 행동 계약**이며 현재 구현 완료 주장이 아니다. 오류 코드·새 API·화면 설계를 확정하는 작업도 아니다.

| 요청·상태 | 현행 근거 / 파기 후 권장 동작 | 성공이 뜻하는 범위·쓰기 제한 |
| --- | --- | --- |
| 기존 receipt, formData 없는 명시적 **읽기 전용 조회** | ADMIN 권한과 입력 검증 후 `kind + targetId + key`로 조회. Deposit 대상은 Submission ID, Return 대상은 ReturnObligation ID. 해당 종류의 고유 키와 대상이 실제 기존 행에 일치할 때만 기존 `receiptId/submissionId`를 반환하는 방향. | **기존 저장 기록이 존재한다는 확인만** 성공. 이름/사유 재입력·복원·재노출 없이 읽는다. 원래 payload가 같았다는 증명, 새 입금/반환 기록, 실제 은행 이체 성공, 최신 잔액 검증을 뜻하지 않음. 현 lookup도 원장 무결성 검증을 수행하지 않으므로 최신 금융 상태는 별도 권한 있는 원장 조회로 확인. |
| 기존 receipt, formData를 붙인 결과 조회 | 금액·시각·대상은 계속 일치해야 하고 이름/사유도 기존 equality를 유지. 원문이 NULL이면 이전 문자열과 불일치하므로 **입력 동등성 확인은 실패**. | 서버가 몰래 원문 비교를 건너뛰어 같은 요청이라고 성공시키지 않음. 사용자에게 원문 재입력 대신 별도 읽기 전용 원장/receipt 확인을 안내하는 후보. 그 읽기는 payload equality를 주장하지 않음. |
| 원문이 파기된 기존 성공 거래의 **쓰기 재시도**, 같은 key | 기존 성공 거래의 원문 기반 write-replay는 종료. 현행 action은 NULL 불일치로 conflict/failure이며 이 거절 경계를 유지하는 방향. | 새 Deposit/Return·Allocation·Mapping 생성, 금액/누계/시각/actor 갱신, 원문 복원 없음. 기존 키·원장 확인으로만 이동. 같은 금액·시각이라는 이유로 성공 replay로 변환하지 않음. |
| 다른 대상·종류·키 또는 제공 금액/시각 불일치 | 요청 종류별 기존 행/대상 일치를 검증하고 불일치는 거절. 다른 key를 이름·금액·가족 유사성으로 같은 거래라고 찾거나 교체하지 않음. | 키만 가진 비ADMIN에 접근권 없음. 종류를 바꿔 다른 원장을 조회하는 우회 없음. formData 없는 읽기는 금액/시각 동등성을 확인한 것이 아니므로 그런 주장을 응답에 붙이지 않음. |
| 조회 **not-found**, 원문 파기 후 과거 요청의 결과를 찾는 경우 | 저장 기록 미발견만 알리고 원장 확인/운영자 검토. **해당 과거 요청을 자동 쓰기로 넘기거나 새 키를 발급해 재처리하지 않는 방향.** | 미발견이 미입금·미반환 또는 안전한 재쓰기의 증거가 아님. 기존 파기 전 폼의 동일 key 재시도 경로를 파기 후까지 자동 연장하지 않음. 실제 새 금융행위는 아래 별도 결정. |
| 조회 오류·결과 불명 | 성공/실패를 추정하지 않고 기존 결과 불명 경계를 유지. 읽기 전용 재조회·원장 확인만 안내. | 동일/새 key의 자동 재쓰기 없음. 기록 확인 전 중복 금융 처리를 유발하지 않음. |
| 원문이 아직 적법하게 남고 파기되지 않은 기존 거래 | 기존 전체 입력 비교·권한·잠금·원장 검증을 유지. 본 라운드는 파기 전의 정상 멱등 동작을 완화하지 않음. | 동일 입력의 기존 동작과 파기 후 종료 계약을 구별. R1의 필드별 목적 종료 승인이 먼저이며, replay를 살리려고 원문 보관을 연장하지 않음. |
| 실제로 새로 발생한 입금/반환·파기 parent의 신규 사유 입력 | 새로운 금융행위의 사실·권한·적법 목적·필요 PII·중복 여부·최신 잔액을 별도 판단. R1 D16-DEPOSIT/RETURN 및 D16-REPLAY와 함께 **독립 승인 필요**. | 과거 요청의 replay와 혼동 금지. 파기 parent/Child 원문 복원, 새 key 자동 재처리 허가가 아님. 신규 반환의 사유 필수 입력과 파기 parent의 재수집 금지 경계를 임의 변경하지 않음. |

**키·원장·중복 방지의 제약:**

- Deposit/Return의 idempotencyKey는 **각 테이블에서 unique인 nullable 필드**다([schema:691](../prisma/schema.prisma#L691), [schema:738](../prisma/schema.prisma#L738), [migration:166](../prisma/migrations/20261006090000_phase20_reservation_application_enhancements/migration.sql#L166), [migration:197](../prisma/migrations/20261006090000_phase20_reservation_application_enhancements/migration.sql#L197)). 종류 간 전역 고유성이나 NULL인 과거 행의 키 존재를 가정하지 않는다. 키 없는 행의 receipt 탐색 방식·키 backfill은 이번 승인 대상이 아니다.
- 기존 키를 NULL·삭제·회전하면 같은 키의 prior 인식·unique 방어를 잃어 같은 은행 거래를 다시 기록할 수 있다. 새로운 키 자동 발급도 그 방어를 우회할 수 있다. 현 키가 서로 다른 키로 입력된 동일 은행 거래까지 자동 탐지한다고 보장하지 않는다. 원문 파기가 기존 은행 거래의 새 입금/반환 기록을 허용해서는 안 된다.
- **Deposit/Return/Obligation/Allocation/Mapping/Payment/PaymentItem/Refund의 행·FK·금액·일시·상태·환불/반환 누계·actor 증빙을 보존**한다. `D = A + P + R + T`(확인 입금 = 미배정 가용액 + Payment 배정액 + 반환 필요 잔액 + 완료 반환액), 미반환 잔액·반환 상한, 동일 입금의 중복 배정 금지, 동일 반환의 중복 완료 금지, Payment/Revenue와 Reservation 전 입금/반환의 분리를 유지해야 한다([ADR-060:549](DECISIONS.md#L549)). PII 삭제·receipt 조회·실패 retry가 이 값들을 바꾸면 안 된다.
- 현 action은 Submission 잠금·원장 검증·전체 payload 비교를 수행하고, finance core는 prior key/target을 보고 기존 결과를 반환한다([actions.ts:231](../app/%28admin%29/reservation-applications/actions.ts#L231), [actions.ts:255](../app/%28admin%29/reservation-applications/actions.ts#L255), [finance.ts:196](../server/reservation-applications/finance.ts#L196), [finance.ts:425](../server/reservation-applications/finance.ts#L425)). **core의 prior 반환을 원문 비교 생략의 승인 근거로 사용할 수 없다.** 파기 후에도 이 잠금·무결성·중복 방지 경계를 보존해야 한다.
- **키 삭제/회전, NULL을 허용하는 비교 완화, 원문/이름 hash·사유 hash·별도 payload 사본 추가 저장은 이번 라운드에서 승인하지 않는다.** 키 변경은 중복 방지를 훼손하고, 비교 완화는 “동일 요청”의 의미를 바꾸며, 새 비교용 저장은 개인정보 사본/수집·보관 목적을 추가한다. 어느 것도 F04/F05 원문 파기의 부수적인 기술 선택이 아니다. 키의 최종 필요기간·조회 창은 미결정이며 이를 무기한 보존 승인으로 읽지 않는다.

## Acceptance Criteria

- K01–K04 각각에 ①–⑧, traceable D16 ID, 현재 사실과 미승인 추천·대안·결정 질문이 있다.
- K01은 C5에서 삭제되는 부속/요청 연결과 잔존 원장/actor 그래프를 구별하고, 형제·다른 거래·직원·외부 장부를 통한 식별 가능성 및 익명성 주장의 한계를 명시한다.
- K02/K03은 접근 TTL과 DB 잔존을 구별하고 만료·철회/PII 파기 후의 저장 종료 후보·유효 형제 영향·미결정 예외를 기록한다. K03에 금융 L을 적용하지 않는다.
- K04는 원문 NULL 이후 읽기 전용 receipt와 원문 비교 write-replay의 차이, 거절·미발견·결과 불명·신규 금융행위 경계, 키·원장 보존 및 중복 방지 제약을 명시한다. R1 F04/F05와 R2의 독립 결정을 대체하지 않는다.
- 기간·법적 적용은 ESTIMATE / 미결정이고 새로운 숫자 기간·최종 승인·실행 실적이 없다. 이 한 문서 외에는 수정하거나 실행하지 않는다.

## Conflicts — 유지할 규칙과 SPEC 미정합·모호성

- **유지:** REQUIREMENTS [19장·20장·20-1장](../REQUIREMENTS.md#L801)(처리자/시각·최소 접근·안전정보 분리), [C5/A1 파기 범위](../REQUIREMENTS.md#L1879)·[확정 고객 한정·원장 보존](../REQUIREMENTS.md#L1923), [같은 기기 권한](../REQUIREMENTS.md#L2114), [24장 미결정](../REQUIREMENTS.md#L2380); ADR-008/050/055–058/060; ARCHITECTURE 6·7·9장. 현재 고객/신청 기간·수동 실행·권한·동의 append-only의 기존 만료 예외·금융 불변식은 변경하지 않는다. AI 상담 보관 정책을 이 tuple에 적용하지 않는다.
- **K04 — SPEC의 파기 전후 계약 경계 미정:** [K04](ITERATION-6E-SPEC.md#L158)는 **“고유 키와 원문 필드 비교 유지”**, 동시에 **“B층 원문 제거 후에도 중복 방지 키 필요; 정확한 보존/재시도 창은 별도 승인”**이라고 한다. 현행 S는 F04/F05를 NULL로 만든다. 같은 행의 **“원문 불일치 시 자동 재쓰기 없이 원장 확인”**과 PLAN의 **“기존 성공 거래를 원문 입력으로 다시 쓰는 replay를 종료”**([PLAN:92](ITERATION-6E-PLAN.md#L92))를 함께 보면, “비교 유지”를 파기 후에도 동일 원문 replay가 성공해야 한다는 뜻으로 읽을 수 없다. **파기 전 비교 유지 / 파기 후 쓰기 종료 / 별도 읽기 전용 receipt**라는 적용 경계가 SPEC에 실행 계약으로 확정되어 있지 않다. 직접 논리 모순으로 단정하지 않되 이 미정합·모호성을 숨기지 않고 위 동작표를 **새 독립 승인 후보**로 남긴다. SPEC/PLAN/R1을 수정하거나 해소 완료로 표시하지 않는다.
- **K01 — 기간 분리가 연결 단절을 뜻하지 않는 한계:** SPEC K01의 **“원장 기간 L과 개인 연결 가능 기간 분리; 별도 종료기간 미정”**과 **“기존 FK 보존”**([SPEC:155](ITERATION-6E-SPEC.md#L155))를 함께 유지한다. 안정적인 FK를 남기면서 개인 연결 가능성이 특정 필드 종료일에 사라진다고 약속할 수 없다. 고객 필드/신원 접근의 기간을 따로 판단할 수 있다는 방향과 그래프의 실제 재연결 가능성은 구별해야 한다. K01/E05가 미해결이며 이번에 FK 변경·완전 익명화로 조용히 해결하지 않는다.
- **R2의 기존 공용 필드 미정합도 미해결:** SPEC F50–F53/F57의 **“해당 개인정보 목적 종료 후 전체 필드 NULL 제안”**과 **“고객 한 명의 C5로 공용 내용·다른 강사/아이 정보 일괄 제거 금지”**의 제거 단위는 [R2 Conflicts](ITERATION-6E-DECISION-R2.md#conflicts--유지할-규칙과-spec-미정합)에서 이미 질문으로 남았다. 공용 본문의 잔존 사본이 K01의 재식별에 영향을 주더라도 R3가 그 단위를 선택하거나 승인하지 않는다.

## Open Questions

**미해결.** 아래 (b)의 각 K행과 (c)의 전문가 질문은 개별 정책 승인 전 해소해야 한다. 이번 요청은 결정 준비 문서 작성만 허용한다. 미해결을 유지한 채 이 문서에서 멈추며 설계/구현·실제 파기로 넘어가지 않는다.

## Priority

**Now:** K01–K04의 운영자 선택과 검토 근거를 문서화. **Next:** 해당 행의 개별 답·전문가 확인 후 별도 최종 정책/ADR·REQUIREMENTS·PLAN 승인 절차. **Later:** 승인된 범위만 역할 workflow로 구현·검증. Round 4는 아래 목록만 남기며 착수하지 않는다.

### (a) BATCH로 승인할 수 있는 방향 — 아직 승인 기록 없음

- **K01–K04 공통:** 필드 목적·접근 권한·저장 필요기간을 구별하고, 기존 원장/FK·처리 책임·금액 보존·중복 방지와 C5/A1/S를 유지한다. 잔존 연결/해시의 익명정보 단정, 파기 신원·원문 복구, 고객 파기에 따른 User/ADMIN 계정 삭제를 금지하는 방향. 행별 선택 기록을 남긴다.
- **K02/K03 공통:** 만료/철회·파기 접근 차단 유지, 접근 TTL을 DB 보관기간으로 전용하지 않기, 목적을 잃은 capability/grant 저장 종료 및 유효 형제·가족 범위 보호 방향. K03 금융 L 적용 금지. **K04 금융 중복 방지 키의 삭제는 이 배치에 포함하지 않는다.**
- **K01 및 R1/R2 연동 공통:** 최소 projection·목적별 권한·사본/백업 종료 확인, 원문·새 이름 hash·역매핑 미추가 원칙. 공통 방향 승인으로 각 행의 필요성·기간·법적 판단·실행을 확정하지 않는다.

### (b) INDEPENDENTLY 승인해야 할 판단 — 전부 미결정

- **K01 / D16-LINK:** 어떤 잔존 원장/처리 책임 연결이 왜·누구에게·언제까지 필요한가? 개인 연결/직원 실명 접근의 종료 사건·기간·예외는 무엇인가? R1 거래 원문·형제/공유 Payment·R2 공용 본문/직원 계정·외부 장부와 결합하는 범위 및 보고 가능한 비식별성 수준은 무엇인가? 기존 FK를 보존한 상태의 한계를 승인 기록에 남겨야 한다.
- **K02 / D16-DEVICE:** 접근 만료/철회와 각 PII 파기 뒤 hash·기기·DeviceChild·DeviceSubmission이 남을 수 있는 근거·최종 잔존기한은 무엇인가? 개별 grant와 전체 기기의 종료를 어떻게 구별하고 유효 형제/Submission 범위를 보전할 것인가? 별도 보안 증빙이 필요하면 최소 범위·접근자·해제 사건·사본 종료는 무엇인가? 새 숫자 기간은 제시되지 않았다.
- **K03 / D16-COMPLETION:** 만료 또는 대상 PII 파기 중 먼저 발생한 사건에서 hash를 끝내는 기본 후보를 채택할 것인가? 부분 파기 때 전체 종료/유효 형제의 최소 안내 중 어느 범위를 허용하며, hash NULL·expiry metadata 종료·사본 처리를 어떤 사건과 책임으로 기록할 것인가? 금융 L을 보관 근거로 채택할 수 없다는 경계도 개별 기록한다.
- **K04 / D16-REPLAY:** 위 receipt/replay 동작표, 원문 파기 후 쓰기 종료·명시적 읽기 전용 receipt 확인, 불일치/미발견/결과 불명 거절 경계를 승인할 것인가? 키의 필요 보관기간·기산점·조회 창·접근자·사본 종료는 무엇인가? 원문이 NULL인 사유가 불명확한 과거 행은 파기/동일성 증거를 추정하지 않고 어떻게 보류할 것인가? R1 F04/F05의 목적 종료와 S 선후, 실제 신규 금융행위·파기 parent의 새로운 사유 입력은 별도 승인해야 한다. **키 삭제/회전·비교 완화·새 이름/사유 hash는 이번 승인 선택지가 아니다.**

### (c) 전문가 확인 항목 — ESTIMATE / 미결정

- **개인정보·식별 가능성(E01/E04/E05):** 아동·보호자·제3자·직원별 적법 목적과 최소 연결 범위는 무엇인가? NULL/공통 표식 뒤 안정적 ID·금액/시각·동의/version·ILLNESS enum·형제/기기·공용 본문·외부 장부를 결합하면 어떤 식별 가능성이 남는가? K01의 적절한 보고 표현과 법률상 익명성 판단은 무엇인가? hash의 비가역성만으로 비개인정보라고 할 수 있는가?
- **법률·세무·책임증빙(E02/E03/E07):** 실제 적용되는 E/T/C 분류·기산점·필수 연결/직원 식별 범위·예외 종료는 무엇인가? 원장·actor ID의 보존 필요가 고객 원문·직원 이메일·기기/완료 hash까지 요구하는가? K03에는 금융 L을 전용하지 않고 별도 근거만 검토한다. 법령 후보 숫자나 고객 C5를 K01–K04에 일괄 적용하지 않는다.
- **보안·사본 종료(E05/E06):** K02의 만료/철회 후 hash/관계, K03의 완료 종료 후 hash/expiry metadata가 구체 사고 증빙에 정말 필요한가? 그렇다면 서비스 접근과 분리한 최소 범위·접근자·종료 사건·최종 잔존기한은 무엇인가? 복제/PITR/백업/내보내기·로그 및 복구 후 재파기를 누가 어떤 기한·증거로 확인할 것인가? 실제 설정 검증은 이번에 수행하지 않았다.
- **금융 재시도·재수집(E01/E05/E08):** K04의 키/대상으로 기존 기록만 확인하는 계약과 원문 비교 쓰기 종료를 승인할 수 있는가? 키 보존이 실제 중복 방지를 유지하는 필요기간·최종 종료 검토는 무엇인가? 미발견/결과 불명과 실제 새 금융행위를 어떻게 구별하며, 파기 parent에 신규 사유가 필요할 때 최소 처리·고지 근거는 무엇인가? 비교용 원문/hash 추가 없이도 금융 불변식·권한·중복 방지를 지키는 경계를 확인해야 한다.

### (d) Round 4 잔여 — 목록만 / 미착수

- **G1 / D17-ADMIN** — 관리자 등록·신청 없는 Child.
- **G2 / D17-HISTORY** — 신청 없이 과거 Reservation만 있는 Child.
- **G3 / D17-UNCONFIRMED** — 신청했으나 CONFIRMED 없는 사람.
- **G4 / D17-MIXED** — 비CONFIRMED의 예약·금융·동의·안전 목적 혼합 overlay.
