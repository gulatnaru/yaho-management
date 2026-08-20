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
