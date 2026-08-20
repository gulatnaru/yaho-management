# YAHO Architecture v2

본 문서는 `REQUIREMENTS.md` v2를 기준으로 한다.
요구사항과 충돌하는 내용이 발견되면 `REQUIREMENTS.md`를 우선한다.

## 1. Architecture
Modular Monolith

Next.js App Router 하나의 애플리케이션에서 도메인을 모듈화한다.

## 2. Stack

| Area | Technology |
|---|---|
| Framework | Next.js |
| Language | TypeScript |
| UI | Tailwind CSS |
| Components | shadcn/ui |
| Backend | Next.js Route Handlers / Server Actions |
| Validation | Zod |
| Database | PostgreSQL |
| DB Platform | Supabase |
| ORM | Prisma |
| Auth | Auth.js |
| Unit/Integration | Vitest |
| E2E | Playwright |
| CI | GitHub Actions |
| Hosting | Vercel |
| Repository | GitHub |
| AI | Codex |

## 3. Project Structure

```text
yaho-management/
├── app/
│   ├── (auth)/
│   ├── dashboard/
│   ├── children/
│   ├── teachers/
│   ├── programs/
│   ├── classes/
│   ├── reservations/
│   └── revenue/
├── components/
│   ├── ui/
│   ├── layout/
│   └── domain/
├── lib/
│   ├── auth/
│   ├── db/
│   ├── validation/
│   └── utils/
├── server/
│   ├── children/
│   ├── relationships/
│   ├── teachers/
│   ├── programs/
│   ├── classes/
│   ├── reservations/
│   ├── payments/
│   └── revenue/
├── prisma/
│   ├── schema.prisma
│   └── migrations/
├── tests/
│   ├── unit/
│   ├── integration/
│   └── e2e/
├── public/
├── .agents/
│   └── skills/
├── .github/
├── AGENTS.md
├── REQUIREMENTS.md
└── ARCHITECTURE.md
```

관계(Relationship)는 아이의 하위 개념이므로 별도 화면 대신 아이 상세 화면에서 관리한다.
서버 모듈은 도메인 단위로 분리한다.

## 4. Domain Boundaries
- Child: 아이(기본 고객 단위), 보호자 정보, 안전 정보(ChildSafetyInfo), 동의 이력(ChildConsent)
- Relationship: 아이 간 친구/형제자매 관계
- Teacher: 선생님
- Program: 프로그램 정의(어떤 수업인가)
- ClassSchedule: 실제 운영 클래스(언제/어디서/누가) 및 클래스 취소
- Reservation: 아이 1명 단위의 예약 및 개인 취소
- Payment / PaymentItem / Refund: 결제, 예약별 청구 명세, 환불
- Revenue: 결제/할인/환불 기반 매출 집계(읽기 전용 도메인)

## 5. Data Flow
```text
Program → ClassSchedule → Reservation → Child
ClassSchedule ↔ Teacher (ClassTeacher)
Child ↔ Child (Relationship: FRIEND / SIBLING)
Reservation → PaymentItem → Refund
Payment → PaymentItem (1:N, 기관 일괄 결제 대비)
Payment / Refund → Revenue(집계)
```

예약은 아이 1명 단위다. 친구 3명이 함께 신청해도 Reservation은 3건 생성된다.

## 6. Database
- Prisma schema를 기준으로 한다. 상세 모델은 `docs/DATABASE.md`를 따른다.
- 모든 변경은 migration으로 관리한다.
- FK와 unique constraint를 적극 사용한다.
- 금액은 정수 기반 KRW 단위를 사용한다.
- 삭제는 원칙적으로 비활성화(soft) 처리하여 예약/매출 이력을 보존한다.
- 개인정보 저장을 최소화한다.

## 7. API
1. Authentication
2. Authorization
3. Zod validation
4. Business rule validation
5. DB operation
6. Error handling

## 8. Server / Client
기본은 Server Component.
브라우저 상호작용이 필요한 경우에만 Client Component를 사용한다.

## 9. Security
- Auth.js 인증
- 서버 측 권한 검증
- 환경변수 secrets
- 개인정보 로그 금지
- 최소 권한

## 10. Testing
- 핵심 domain logic: Vitest
- API/integration: Vitest
- 핵심 사용자 흐름: Playwright
- PR: GitHub Actions

필수 검증 대상(요구사항 18장):
- 동일 아이의 동일 클래스 중복 예약 금지
- 정원 8명 초과 금지
- 자기 자신/중복 관계 생성 금지
- 동일 클래스 동일 선생님 중복 배정 금지
- 취소된 클래스 신규 예약 금지
- 환불금액 > 결제금액 금지, 음수 금액 금지
- 민감 안전 정보가 목록 조회/로그/외부 전송에 노출되지 않을 것

## 11. Deployment
Vercel + Supabase PostgreSQL.

## 12. Future
실제 분리가 필요할 때만 별도 서비스로 분리한다.
