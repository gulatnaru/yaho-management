# YAHO API Design

`REQUIREMENTS.md` v2 기준이다.

## Domains
- Auth
- Children
- Relationships
- Teachers
- Programs
- Classes
- Reservations
- Payments / Refunds
- Revenue

## Rules
1. Authentication
2. Authorization
3. Input validation with Zod
4. Business rule validation
5. Database operation
6. Consistent error handling

RESTful resource naming을 우선한다.

## Endpoints

```text
GET    /api/children
POST   /api/children
GET    /api/children/:id
PATCH  /api/children/:id

GET    /api/children/:id/relationships
POST   /api/children/:id/relationships
DELETE /api/relationships/:id

GET    /api/teachers
POST   /api/teachers
PATCH  /api/teachers/:id

GET    /api/programs
POST   /api/programs
GET    /api/programs/:id
PATCH  /api/programs/:id

GET    /api/classes
POST   /api/classes
GET    /api/classes/:id
PATCH  /api/classes/:id
POST   /api/classes/:id/cancel

GET    /api/reservations
POST   /api/reservations
GET    /api/reservations/:id
POST   /api/reservations/:id/cancel

POST   /api/payments
POST   /api/payments/:id/refund

GET    /api/revenue/summary
GET    /api/revenue/by-program
GET    /api/revenue/by-class
```

## Notes
- 클래스 전체 취소(`/api/classes/:id/cancel`)와 개인 예약 취소(`/api/reservations/:id/cancel`)는 별도 엔드포인트로 구분한다.
- 클래스 취소 시 기존 예약을 삭제하지 않는다. 환불은 별도 처리한다.
- 친구와 함께 예약하는 경우에도 아이별 Reservation을 각각 생성한다.
- 취소/환불 응답에는 처리자와 처리일시를 포함한다.
- `POST /api/payments`는 예약 목록을 받아 Payment 1건 + PaymentItem N건을 생성한다. 현재는 항상 예약 1건이지만 기관 일괄 결제를 위해 배열로 받는다.
- 환불은 PaymentItem 단위로 처리한다. 기관 결제에서도 아이 1명만 환불할 수 있어야 한다.

## Reservation Applications (Phase 18, Server Actions)
- 공개(인증 없음): `GET /apply/:token` 신청 화면, `submitReservationApplication(token)` 제출, `GET /apply/complete` 완료 안내. 대상 클래스는 토큰으로만 결정하고, 무효·중지·마감은 같은 문구로 닫는다(ADR-052).
- 신청 화면은 접수 판정용 최소 필드(링크 활성, 클래스 상태·시작 시각)만 먼저 조회하고, 열린 링크일 때만 표시 정보(일시·장소·프로그램 이름·설명·대상 연령)를 조회한다(`lib/reservation-applications/public-queries.ts`). 닫힌 링크의 HTML·RSC payload에는 클래스 표시 정보가 담기지 않는다. 제출은 화면 판정과 별도로 서버에서 다시 판정한다.
- `submitReservationApplication` 은 성공하면 `{ submitted: true }` 만 돌려주고(입력값·개인정보 없음) redirect 하지 않는다. 신청서는 이 상태를 받으면 `window.location.replace("/apply/complete")` 로 전체 문서 이동하고, 이후 제출을 막는다. 클라이언트 전환이면 신청 페이지의 RSC payload(동의 문구 등)가 완료 화면 문서에 남기 때문이다. 검증·링크 마감·요청 제한·저장 실패는 기존처럼 오류와 입력값을 돌려준다.
- ADMIN 전용: `issueApplicationLink` / `stopApplicationLink`(클래스 상세), `confirmApplicationDeposit`, `confirmReservationApplication`, `rejectReservationApplication`, `cancelReservationApplication`(`/reservation-applications`), `purgeExpiredPersonalData`(`/reservation-applications/retention` — 만료된 반려·취소 신청과 Phase 18 확정 신청 이력이 있는 확정 고객 파기, ADR-055~058). MANAGER·TEACHER는 서버에서 차단한다(ADR-053).
- 확정은 신청 행 잠금 후 기존 예약 생성 규칙(ClassSchedule 잠금 → Child 잠금)을 같은 트랜잭션에서 실행하고 Payment는 만들지 않는다. 파기된 아이를 고르면 "보관기간이 지나 개인정보를 파기한 아이에게는 예약할 수 없습니다. 새 아이로 등록해 확정해주세요."로 거절한다(ADR-058).
- `purgeExpiredPersonalData` 결과: `{ purgedApplicationCount, purgedChildCount, hasMore }` 또는 `{ error }`. `hasMore` 가 true 면 한 번 실행 한도(신청 500건·고객 100명)를 넘은 대상이 남아 있어 다시 실행해야 한다.
- 파기된 아이에게는 예약 생성·동의 기록·안전정보 저장이 거절되고, 그 아이의 예약 취소(`cancelReservation`)는 사유 코드만 받는다 — 상세 사유를 보내면 `errors.cancelDetail` 로 거절한다(ADR-058).
