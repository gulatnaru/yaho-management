# YAHO 개인정보 정책 결정 Round 1 — 거래 PII 6항목 승인안

기준: `f37398655fce1edf5bd6399f56c9aedc6f743b17` · `feature/phase21-ai-service` · PR #54 Draft(사용자 제공). **정책 방향 승인 대기이며, 기간 확정·구현·실제 파기 승인이 아니다.**

유일한 정책 근거: [6E SPEC](ITERATION-6E-SPEC.md)의 F01–F05/F07·BR1–4·K04·Conflicts·E01–E08 및 [6E PLAN](ITERATION-6E-PLAN.md)의 Gate 0·Data Model·원문 파기 후 receipt/replay 조건. 아래 코드·스키마 링크는 그 인용 근거의 정적 확인이다. DB·개인정보·운영 설정은 조회하지 않았다.

- **A층**: 거래 행·금액·일시·상태·FK·환불/반환 누계·배정 보존. **B층**: 이름·자유입력 등 해당 개인정보의 목적별 필요성만 판단. A층 보존이 B층 전체 보존을 뜻하지 않는다. `L`은 실제 적용되는 증빙 분류의 기간·기산점이며 **미결정**이다. 모든 법적 적용·예외는 SPEC의 **ESTIMATE**다. 확정 고객 5년(C5)을 이 여섯 필드의 기간으로 전용하지 않는다.
- **S**: 모든 자녀 신청이 기존 A1/C5에 따라 파기된 뒤 Submission의 보호자·선언명, 연결 Deposit 입금자명·Return 사유를 NULL 처리하는 현행 조건이다. 형제 신청이 미파기이면 S 미충족이다([retention.ts:223](../server/reservation-applications/retention.ts#L223)).
- 모든 행에 SPEC의 B1(사본·백업·복구·접근 통제), F02/F03/F05에 B2(건강·아동 내용의 추가 노출 제한)를 적용하는 제안이다. 필드 NULL만으로 법률상 익명정보나 백업까지 파기 완료라고 판단하지 않는다(E05/E06).

## 운영자 승인표

각 행의 ③은 **기간이 아닌 목적 종료 사건의 추천**이다. ④의 예외 종료일과 ⑦의 기간·기산점이 확인되기 전에는 실행 가능한 만료일이 없다.

| 항목·근거 | ① 현재 수집·사용 목적 | ② A층/B층 분리 가능성·생존 데이터 | ③ 추천 목적 종료 사건 | ④ 법정 보존 필요 확인 시 예외 | ⑤ 기존 S와 충돌·의존 | ⑥ 파기 후 재시도·영수증 조회 | ⑦ 전문가 확인 기간·기산점 | ⑧ 권장안·대안·승인 보류 사유 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **F01 · D16-NAME**<br>`Payment.payerName`<br>[schema:803](../prisma/schema.prisma#L803) · [저장:61](../lib/payments/core.ts#L61) | 수동 결제의 입금·결제자 식별과 대사. | **B층** 이름만 NULL 가능. **A층** Payment/Item 행·금액·paidAt·status·예약 FK 유지. | **결제 대사 완료**. | 실명이 필수 증빙임이 확인된 경우에만 필요한 이름을 분리·제한 보관하고 승인된 L 종료에 제거. 종료일은 미결정. | S의 삭제 대상 아님. 현행 일반 Child 파기에서도 보존하므로 별도 필드 종료 승인이 필요. | 이름 재조회 불가. Payment ID·원장 조회와 예약별 결제 중복 방지는 유지. K04의 Deposit/Return 원문 비교와는 직접 관계 없음. | **미결정** — A층 증빙 분류·기간·기산점과 B층 실명 필요기간(E01/E02/E03). paidAt은 후보이며 세무·장부 기산점 확정값 아님. | **권장:** 대사 종료 후 이름 NULL.<br>**대안:** 확인된 실명 증빙 필요 범위만 L까지 보관.<br>**보류:** 실명 필요성·기간·기산점 미확인. |
| **F02 · D16-MEMO**<br>`Payment.memo`<br>[schema:808](../prisma/schema.prisma#L808) · [저장:65](../lib/payments/core.ts#L65) | 결제 운영 메모. 개인·건강 내용 혼입은 가능성만 확인됨. | **B층** memo만 NULL 가능. **A층** Payment/Item·금액·paidAt·status·예약 FK 유지. | **대사와 해당 메모로 처리하던 문의의 종결**. | 메모 내용이 필수 증빙임이 확인된 경우에만 필요한 최소 범위를 승인된 증빙 종료일까지 제한 보관. 전체 메모의 보존 의무는 미확인. | S 대상 아님. 일반 Child 파기에서 보존하는 기존 규칙에 새 종료 범위를 추가하려면 별도 승인 필요. | 메모 재조회 불가. 원장 ID 조회·예약별 결제 중복 방지에 필요한 행/FK 유지. K04 직접 비교 필드 아님. | **미결정** — A층 L, B층 메모 필요 범위·문의 종료 기준 및 예외 기간·기산점(E01/E02/E03/E04). paidAt만으로 일률 기산 불가. | **권장:** 목적 종료 후 전체 memo NULL.<br>**대안:** 확인된 최소 증빙 내용만 예외 보관.<br>**보류:** 문의 종료·법정 필요 범위 미확인. |
| **F03 · D16-REFUND**<br>`Refund.reasonDetail`<br>[schema:843](../prisma/schema.prisma#L843) · [생성 검증:135](../lib/payments/core.ts#L135) | 환불 설명과 NO_SHOW/ABSENT 처리 이유. | **B층** 상세만 NULL 가능. **A층** Refund 행·reason enum·amount·status·refundedAt·item/actor FK·환불 누계 유지. | **환불 처리 완료**, 실제 분쟁이 있으면 **그 분쟁의 종결**. | 실제 분쟁 자료나 다른 필수 증빙에 해당한다고 확인된 상세 범위만 승인 종료일까지 제한 보관. 모든 환불 상세를 분쟁 기록으로 분류하지 않음. | S 대상 아님. 일반 Child 파기 후 상세 보존이 현행이므로 종료 범위는 별도 승인 대상. | 과거 상세는 조회 불가하나 환불 행·누계 조회는 유지. 신규 NO_SHOW/ABSENT 환불의 상세 필수 검증은 유지. 삭제가 환불 재실행을 허가하지 않으며 K04 직접 대상 아님. | **미결정** — A층 L, B층 실제 분쟁 해당성·기간·정확한 기산점(E01/E02/E03/E04). SPEC의 분쟁 3년은 **ESTIMATE 후보**. refundedAt/분쟁 종료는 후보. | **권장:** 환불·실제 분쟁 목적 종료 후 상세 NULL.<br>**대안:** 필요한 분쟁·증빙 범위만 제한 보관.<br>**보류:** 분쟁 분류·건강정보 근거·기간 미확인. |
| **F04 · D16-DEPOSIT**<br>`ApplicationDeposit.payerName`<br>[schema:687](../prisma/schema.prisma#L687) · [저장:205](../server/reservation-applications/finance.ts#L205) | ADMIN이 기록한 은행의 실제 입금자 확인·대사. F07의 선언명과 별개. | **B층** 이름만 NULL 가능. **A층** Deposit 행·amount·depositedAt·confirmedAt/ById·submission FK·배정/Mapping 연결·잔액·고유 키 유지. | **실제 입금자 대사 완료**. | 실제 입금자명이 필수 입금 증빙임이 확인된 경우만 승인된 L 종료까지 제한 보관. 미반환 자체가 이름 전체의 법정 보존 근거로 확정된 것은 아님. | 현행 S에서 NULL. 별도 대사 종료가 S보다 빠르거나, S 때도 미반환 목적·필드 보존 필요가 남으면 충돌 가능. 선후·예외 미결정. | NULL 후 과거 이름을 포함한 receipt 조회/쓰기 재시도는 원문 불일치 가능. 키 유지·읽기 전용 영수증 확인 방향은 K04 별도 승인 필요. 아래 보충 참조. | **미결정** — A층 L, B층 실제 이름 필요기간·기산점·S 관계(E01/E02/E03/E08). depositedAt은 후보이며 자동 기산 불가. | **권장:** 대사 종료 후 이름 NULL 방향.<br>**대안:** 필요한 증빙·미반환 목적의 최소 필드만 예외 검토.<br>**보류:** S 선후·필드 필요성·기간·K04 계약 미확정. |
| **F05 · D16-RETURN**<br>`ApplicationReturn.reason`<br>[schema:737](../prisma/schema.prisma#L737) · [저장:440](../server/reservation-applications/finance.ts#L440) | Reservation 전 실제 반환 사유. Refund.reason(enum)과 다른 자유입력. | **B층** reason만 NULL 가능. **A층** Return 행·amount·returnedAt·actor/obligation FK·배정·반환 누계/잔액·고유 키 유지. | **해당 반환 이행 완료**, 관련 분쟁이 있으면 **그 분쟁의 종결**. | 반환 사유가 필수 증빙·실제 분쟁 자료임이 확인된 범위만 승인된 종료일까지 제한 보관. 상세 전체의 보존 의무는 미확인. | 현행 S에서 NULL. 반환·분쟁 목적이 S 전/후에 끝날 수 있어 별도 만료와 충돌 가능. 미반환 잔액 예외·S 선후 미결정. | NULL 후 과거 사유를 포함한 receipt 조회/쓰기 재시도는 불일치 가능. 원장·키는 유지하되 파기 후 K04 계약은 미승인. 아래 보충 참조. | **미결정** — A층 L, B층 사유·실제 분쟁 기간·기산점(E01/E02/E03/E04/E08). returnedAt/obligation.resolvedAt은 후보이며 서로 같은 사건으로 간주하지 않음. | **권장:** 반환·분쟁 목적 종료 후 reason NULL.<br>**대안:** 필요한 최소 사유만 증빙 예외 보관.<br>**보류:** 미반환 필요 범위·기간·S·K04 및 파기 후 신규 반환 입력 계약 미확정. |
| **F07 · D16-DECLARED**<br>`Submission.declaredPayerName`<br>[schema:512](../prisma/schema.prisma#L512) · [현행 파기:232](../server/reservation-applications/retention.ts#L232) | 보호자가 선언한 송금자와 입금 대사. 실제 Deposit 입금자명 사본으로 취급하지 않음. | **B층** 선언명만 NULL 가능. **A층** 연결 입금/반환 원장·금액·일시·상태/FK와 Submission 행·submittedAt·신청/입금/반환 연결 유지. | **선언 송금자와 실제 입금의 대사 완료**. | 선언명 자체가 필수 증빙임이 별도로 확인된 경우만 필요한 범위를 승인 종료일까지 제한 보관. 실제 입금자명 필요성만으로 선언명까지 보존하지 않음. | 현행 S에서 NULL. 별도 대사 종료·고지 기간과 S의 선후는 미결정. 선언명을 이유로 C5 또는 다른 형제 PII를 연장하지 않음. | 선언명 재조회 불가. K04의 비교 필드는 실제 payerName/reason이며 선언명은 직접 비교하지 않음. S로 함께 삭제되는 F04/F05의 재시도 영향은 남음. | **미결정** — B층 수집 고지·계약 근거·기간·기산점(E01/E04); submittedAt 기준 수치 미승인. A층 L은 연결 거래에서 별도 확인. | **권장:** 대사 종료 후 선언명 NULL 방향.<br>**대안:** 별도 필요성·고지가 확인된 최소 범위만 예외 보관.<br>**보류:** 고지 적합성·기간·기산점·S 관계 미확정. |

## 표 보충 및 Open Questions

- **F04/F05/F07 — S 선후의 미결정:** SPEC F04는 “S보다 연장/단축 자동 적용 금지”, F05는 “현행 S; 제안은 반환/관련 분쟁 목적 종료 및 필요한 L만”, F07은 “S 현재; B층 대사 목적 종료/고지된 기간 후보”라고 적었다. **별도 목적/증빙 종료와 S가 다를 때 어느 조건을 적용할지는 정해져 있지 않다.** 현행 함수는 미반환 잔액·별도 필드 기간을 검사하지 않는다([retention.ts:226](../server/reservation-applications/retention.ts#L226)). S가 더 빠르거나 늦을 가능성은 ESTIMATE이며 실제 발생을 확인한 것이 아니다. 운영자·전문가는 필드별 선후·예외 범위·해제 사건을 무엇으로 승인할 것인가? 이번 추천 사건으로 S를 대체하거나 앞당기거나 늦추지 않는다.
- **F04/F05 — receipt와 쓰기 replay 구분:** 현행 [lookupWorkflowReceipt:201](../app/%28admin%29/reservation-applications/actions.ts#L201)은 formData 없이 권한·대상·키에 맞는 기존 영수증을 읽을 수 있으나, formData가 있으면 이름/사유·금액·시각도 비교한다. [입금:234](../app/%28admin%29/reservation-applications/actions.ts#L234)·[반환:261](../app/%28admin%29/reservation-applications/actions.ts#L261) 쓰기 재시도도 원문을 비교하므로 삭제 전 입력과 NULL은 불일치한다. PLAN의 추천은 파기 후 기존 성공 거래의 **쓰기 replay 종료와 읽기 전용 receipt 확인**이다. K04의 키 보존/재시도 창·정확한 동작은 **미결정(E08)**이다. 키 삭제/회전·새 키 자동 재처리·비교 완화·원문/이름 hash 추가 보관을 승인하지 않는다. 실제 신규 금융행위와 파기 후 새 반환 사유 입력 계약은 별도 결정이 필요하다.
- **F07 — 고지 기간의 모호함:** SPEC의 “고지된 기간 후보”는 확인된 고지 기간을 뜻하지 않는다. SPEC E01은 수집항목 목록에 `payerName/declaredPayerName`의 “직접 표기 없음”을 지적한다([consent-content.ts:67](../lib/reservation-applications/consent-content.ts#L67)). 전문가는 선언명의 고지·계약 근거와 기간·기산점을 별도로 확인해야 한다. 이를 임의 기간이나 C5로 채우지 않는다.

## (a) 이번 라운드 운영자가 승인할 수 있는 결정

아래는 **정책 방향과 목적 종료 사건 후보의 행별 승인 목록**이다. 아직 승인 기록은 없으며, 승인하더라도 (b)의 미결정이 남은 실제 파기는 허용되지 않는다.

- **F01 / D16-NAME:** 결제 대사 완료를 목적 종료 사건으로 삼고 이름을 NULL 처리하는 방향.
- **F02 / D16-MEMO:** 대사·해당 문의 종결을 사건으로 삼고 메모 전체를 NULL 처리하는 방향.
- **F03 / D16-REFUND:** 환불 완료·실제 분쟁 종결을 사건으로 삼고 상세만 NULL 처리하는 방향. 사유 enum·신규 NO_SHOW/ABSENT 검증 유지.
- **F04 / D16-DEPOSIT:** 실제 입금자 대사 완료를 사건으로 삼고 이름을 NULL 처리하는 방향. S·K04 관계는 별도 보류.
- **F05 / D16-RETURN:** 반환 이행 완료·관련 분쟁 종결을 사건으로 삼고 사유를 NULL 처리하는 방향. S·K04·신규 반환 입력 계약은 별도 보류.
- **F07 / D16-DECLARED:** 선언명과 실제 입금의 대사 완료를 사건으로 삼고 선언명을 NULL 처리하는 방향. 고지·S 관계는 별도 보류.
- **공통:** A층 보존과 B층 목적 종료를 분리하고, 필드별 법정 필요성이 확인된 경우에만 필요한 최소 범위를 승인 종료일까지 제한 보관하는 조건부 예외 원칙. 고유 대체 이름·이름 hash·역매핑을 만들지 않는 방향.

## (b) 전문가 확인 전 계속 보류할 항목

- **여섯 행 전부:** A층 증빙의 실제 적용 분류·기간·기산점, B층 해당 필드의 법적/계약·동의 근거·필요기간·기산점·만료 경계·예외 해제일은 **미결정**. 운영 선호로 법정 근거를 확정하지 않는다(E01–E04). C5 전용이나 거래일에 임의 연수를 더하는 결정은 하지 않는다.
- **F04/F05/F07:** S와 별도 목적·필드 보존기간의 선후, 미반환·분쟁 중 필요한 최소 범위. **F04/F05 및 K04 의존:** 파기 후 키 보존/receipt·replay 기간과 동작, 새 금융행위의 필요 PII 처리·입력 계약(E08). K04 전체 승인은 이번 여섯 행의 방향 승인으로 대체되지 않는다.
- **F02/F03/F05의 민감 내용, F01/F04/F07의 제3자·선언명 고지:** 실제 필요성과 근거 확인(E01/E04). **공통:** 잔존 FK 등의 식별 가능성, 법정보존 분리·접근 제한, 사본/백업 최종 잔존 기한과 복구 후 재파기 책임·증거(E05/E06). 실제 조회·설정 검증은 별도 승인 범위다.

## (c) 다음 라운드 범위 — 목록만, 검토 시작 전

- **D16 처리자·직원:** F33 `Refund.processedById`(D16-ACTOR-RF), F34 `ApplicationDeposit.confirmedById`(D16-ACTOR-DP), F35 `ApplicationReturn.processedById`(D16-ACTOR-RT), F36 `User.name`(D16-STAFF-NAME), F37 `User.email`(D16-STAFF-EMAIL).
- **D16 공용 클래스:** F50 `ClassSchedule.memo`(D16-CLASS-MEMO), F51 `ClassSchedule.cancelDetail`(D16-CLASS-CANCEL), F52 `ClassSchedule.safetyMemo`(D16-CLASS-SAFETY).
- **D16 공용 프로그램·강사:** F53 `Program.memo`(D16-PROGRAM-MEMO), F54 `Program.description`(D16-PROGRAM-DESCRIPTION), F55 `Teacher.name`(D16-TEACHER-NAME), F56 `Teacher.phone`(D16-TEACHER-PHONE), F57 `Teacher.memo`(D16-TEACHER-MEMO).
- **D16 연결·권한·재시도:** K01 고객·감사 연결 tuple(D16-LINK), K02 기기 capability/관계(D16-DEVICE), K03 완료 화면 capability(D16-COMPLETION), K04 입금/반환 idempotencyKey·receipt/replay(D16-REPLAY).
- **D17 집단:** G1 관리자 등록·신청 없는 Child(D17-ADMIN), G2 신청 없이 과거 Reservation만 있는 Child(D17-HISTORY), G3 신청했으나 CONFIRMED 없는 사람(D17-UNCONFIRMED), G4 비CONFIRMED의 예약·금융·동의·안전 목적 혼합(D17-MIXED; G1–G3에 겹치는 overlay).
