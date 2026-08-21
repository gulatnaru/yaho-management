# YAHO Database Design

`REQUIREMENTS.md` v2 기준이다. 충돌 시 요구사항을 우선한다.

## Core Models
- User: 운영자 계정(Admin, 향후 Teacher 역할 확장)
- Child: 기본 고객 단위(아이 1명), 보호자 정보 포함
- ChildSafetyInfo: 알레르기/비상연락처 등 민감 안전 정보 (Child와 1:1, 분리 저장)
- ChildConsent: 개인정보/민감정보/사진 활용 동의 이력 (append-only)
- Relationship: 아이 간 관계(FRIEND / SIBLING)
- Teacher: 선생님
- Program: 프로그램 정의
- ClassSchedule: 실제 운영 클래스 + 취소 정보
- ClassTeacher: 클래스-선생님 배정(관계 테이블)
- Reservation: 아이 1명 단위 예약 + 개인 취소 정보
- Payment: 결제 1건. 결제자(보호자 또는 기관) 기준
- PaymentItem: 결제에 포함된 예약별 금액 명세 + 환불 누계(refundedAmount)
- Refund: PaymentItem 기준 환불(부분 환불 포함)

향후 도입 예정(지금은 만들지 않는다):
- Organization: 어린이집/유치원 등 기관. Child와 ClassSchedule에 nullable FK로 붙인다.

`ReservationParticipant`는 사용하지 않는다.
예약 단위가 아이 1명이므로 참가자 테이블이 필요 없다.

## Relationships
```text
Child        1:N  Reservation
Child        N:N  Child        via Relationship
Program      1:N  ClassSchedule
ClassSchedule 1:N Reservation
ClassSchedule N:N Teacher      via ClassTeacher
Child        1:1  ChildSafetyInfo
Child        1:N  ChildConsent
Payment      1:N  PaymentItem
PaymentItem  1:1  Reservation
PaymentItem  1:N  Refund
```

## Enums
- RelationshipType: FRIEND, SIBLING (향후 BROTHER, SISTER 확장)
- ClassStatus: SCHEDULED, COMPLETED, CANCELLED
- ClassCancelReason: WEATHER, SAFETY, MINIMUM_ENROLLMENT, OPERATION, OTHER
- ReservationStatus: RESERVED, CANCELLED, COMPLETED, NO_SHOW
- ReservationCancelReason: PERSONAL, ILLNESS, SCHEDULE, WEATHER, DUPLICATE, OPERATION, OTHER
- PaymentStatus: PAID, PARTIAL_REFUNDED, REFUNDED, CANCELLED
- PaymentMethod: CARD, TRANSFER, CASH, OTHER
- ConsentType: PRIVACY, SENSITIVE_INFO, PHOTO_SHARE, PHOTO_MARKETING
- ConsentAction: AGREED, REVOKED
- AttendanceStatus: PRESENT, ABSENT (미기록은 null)
- RefundReason: PERSONAL, ILLNESS, WEATHER, SCHEDULE, DUPLICATE_PAYMENT, CLASS_CANCELLED, OPERATION, OTHER

## Constraints
DB 레벨에서 강제한다.

- Relationship: `unique(childAId, childBId)` + `childAId != childBId` (양방향 중복 방지를 위해 정렬된 쌍으로 저장)
- ClassTeacher: `unique(classScheduleId, teacherId)`
- Reservation: `unique(classScheduleId, childId)`
- PaymentItem: `unique(reservationId)` — 한 예약은 한 번만 청구된다
- ClassSchedule.capacity: 1 이상. 기본값 8, 상한 8 검증은 서버 규칙으로 처리하고 DB에 8을 하드코딩하지 않는다
- 금액 컬럼: 0 이상 정수(KRW)
- PaymentItem: `CHECK (refundedAmount >= 0 AND refundedAmount <= paidAmount)` — 환불 상한을 DB가 보장한다
- ChildSafetyInfo: `unique(childId)`
- ChildConsent: unique 제약 없음. 동의/철회마다 행을 쌓는 append-only 구조
- ClassSchedule: 보험 가입 여부 / 보험사 / 증권번호 컬럼 보유

## Payment 구조 주석
현재는 결제 1건에 PaymentItem 1건만 생성된다(보호자 개인 결제).
기관 일괄 결제가 시작되면 Payment 1건에 PaymentItem N건이 붙는다.

매출 집계는 **반드시 PaymentItem 기준**으로 작성한다.
Reservation을 직접 세거나 Payment 총액만으로 집계하면 기관 결제 도입 시 프로그램별/클래스별 매출이 어긋난다.

## 환불 상한을 지키는 방법
PostgreSQL의 CHECK 제약은 같은 행 안에서만 검사할 수 있어 다른 Refund 행들의 SUM을 볼 수 없다.
따라서 환불 누계를 `PaymentItem.refundedAmount` 컬럼으로 들고 있고, DB는 이 컬럼에만 상한을 건다.

환불 처리는 반드시 하나의 트랜잭션에서 수행한다.
1. PaymentItem 행을 잠근다 (SELECT ... FOR UPDATE)
2. Refund 행을 생성한다
3. PaymentItem.refundedAmount 를 갱신한다
4. Payment.status 를 PAID / PARTIAL_REFUNDED / REFUNDED 로 갱신한다

3번에서 상한을 넘으면 CHECK 제약이 트랜잭션 전체를 되돌린다.
refundedAmount 를 갱신하지 않고 Refund 만 생성하는 코드 경로를 만들지 않는다.

## 동의 이력 취급 규칙
ChildConsent 는 append-only 다. 기존 행을 수정하거나 삭제하지 않는다.

- 동의 → `action: AGREED` 행 추가
- 철회 → `action: REVOKED` 행 추가
- 재동의 → `action: AGREED` 행 다시 추가

현재 동의 상태는 해당 consentType 의 `recordedAt` 최신 행으로 판단한다.
이렇게 해야 "언제 동의했고 언제 철회했는가" 를 나중에 증빙할 수 있다.

## 민감정보 취급 규칙
`ChildSafetyInfo`는 다음을 반드시 지킨다.

- Child 조회 시 기본 include 하지 않는다. 명시적으로 요청한 상세 조회에서만 join 한다.
- 목록/검색 API 응답에 포함하지 않는다.
- 로그, 에러 메시지, 외부 전송 payload에 포함하지 않는다.
- 조회/수정 시 처리자와 일시를 남긴다.
- 수집 항목은 현장 응급 대응에 필요한 범위로 제한한다. 진단명/병력/복용약 이력은 저장하지 않는다.

`PHOTO_MARKETING` 동의가 없는 아이는 외부 공개 자료 대상에서 제외할 수 있어야 한다.

## Principles
- Prisma schema를 기준으로 한다.
- schema 변경은 migration으로 관리한다.
- FK와 unique constraint를 활용한다.
- 금액은 integer KRW 단위를 사용한다.
- 물리 삭제 대신 isActive / 상태 컬럼으로 이력을 보존한다.
- 취소/환불 등 중요한 변경에는 처리자(userId)와 처리일시를 남긴다.
- 개인정보 저장을 최소화한다.

## Raw SQL CHECK 제약 마이그레이션 절차
`prisma/schema.prisma` 하단에 정리된 CHECK 제약(Prisma가 표현하지 못하는 제약)처럼 **모델 필드 자체는 바뀌지 않고 raw SQL 제약만 추가하는 경우**, `npx prisma migrate dev`는 스키마 diff를 감지하지 못해 마이그레이션 파일을 만들지 않는다. Phase 2(`child_name_not_blank`), Phase 3(`teacher_name_not_blank`, `program_name_not_blank` 외 3건)에서 매번 이 문제로 개발자가 절차를 즉석에서 재구성했다. 다음 절차를 따른다.

1. `prisma/migrations/<YYYYMMDDHHMMSS>_<name>/migration.sql` 폴더와 파일을 직접 생성한다(`migrate dev`가 생성해주지 않는다).
2. `migration.sql`에는 `ALTER TABLE ... ADD CONSTRAINT ... CHECK (...)` 구문만 작성하고, Zod 검증이 1차 방어선이며 CHECK은 2차 방어선임을 주석으로 남긴다.
3. `npx prisma migrate deploy`로 적용한다(`migrate dev`가 아니다 — 로컬 개발 DB라도 diff가 없는 이 경우엔 `deploy`를 쓴다).
4. `npx prisma migrate status`로 적용 여부를 확인하고 결과를 완료 보고에 남긴다.
5. 추가한 CHECK 제약은 `prisma/schema.prisma` 하단 주석 블록에도 동기화해 다음 담당자가 전체 제약 목록을 한눈에 볼 수 있게 한다.
