# Task

기존 `yaho-preview` DB의 `manual_test` 스키마를 사용하는 수동 예약·결제·환불·매출 검증 환경 구현 PLAN

- 작성일: 2026-10-18
- 상태: **DRAFT — PLAN 승인 대기**
- 선택: **A안 확정. 기존 `yaho-preview` DB 안에 `manual_test` 스키마를 둔다.**
- B안: 별도 Supabase 프로젝트. **흥영의 명시적 결정으로 기각되었으며 재검토 대상이 아니다.**
- 현재 승인: SPEC·PLAN 보완 및 문서 작성.
- 구현: PLAN 승인 후 `yaho-build` developer 서브에이전트가 담당한다.
- **Preview DB 접속·스키마 생성·Migration 실행·기존 데이터 변경·Production 변경·PR merge는 현재 승인되지 않았다.**

## Goal

관리자가 기존 ADMIN 로그인을 통해 테스트 시작을 승인한 뒤, 독립된 테스트 세션으로 가상 클래스를 만들고 예약 URL을 발급한다. iPhone에서 합성 예약을 제출하고 관리자 테스트 화면에서 입금 확인·예약 확정·결제·환불·매출을 확인한 뒤 테스트를 종료한다.

예약과 재무 처리에 필요한 모든 데이터·세션·설정·감사 주체는 `manual_test` 안에 둔다. 테스트 runtime DB role은 `public`을 포함한 다른 업무 스키마의 객체에 접근할 수 없어야 한다.

### 승인된 요구사항 기준

별도 manual-test SPEC 파일은 현재 확인되지 않았다. 아래 항목은 사용자가 직접 확정한 이번 작업의 요구사항 기준이며, 기존 SPEC의 승인 범위를 임의로 확장하지 않는다.

| ID | 확정 요구사항 |
|---|---|
| MT-01 | 기존 `yaho-preview` DB의 `manual_test` 사용. 별도 프로젝트 생성 금지 |
| MT-02 | 전용 runtime DB role. `manual_test` 외 업무 객체 접근 금지, `public` 접근 금지 |
| MT-03 | 별도 생성 Prisma Client 및 인스턴스. 실제 `search_path=manual_test` 보장 |
| MT-04 | ADMIN·E2E와 독립된 짧은 cookie/session 인증. 수동 header 입력 금지 |
| MT-05 | ADMIN 로그인 → 테스트 시작 → 가상 클래스 → 예약 URL → iPhone 예약 → 관리자 확정 → 결제·환불·매출 → 종료 |
| MT-06 | Reservation·Payment·Refund·Revenue 및 모든 의존 데이터의 스키마 격리 |
| MT-07 | cleanup은 해당 테스트의 `manual_test` 데이터만 삭제. `public` 접근 불가 |
| MT-08 | E2E와 스키마·인증 분리. 기존 E2E 구조를 이번 작업에서 재설계하지 않음 |
| MT-09 | 스키마 생성·Migration 적용 계획 작성. 현재 실행 금지 |
| MT-10 | rollback 계획 포함 |

마지막 사용자 메시지의 “8가지”는 이전 열거 항목을 축소하는 것으로 해석하지 않는다. 원래의 10개 요구사항을 모두 유지한다.

### 확정 사항과 PLAN 제안의 구분

사용자가 확정한 사항은 A안, 격리·인증·UX·cleanup 요구사항 및 실행 금지 경계다.

이 문서가 제안하여 PLAN 승인 대상으로 두는 사항은 다음과 같다.

- 구체적인 테이블 구성·파일 배치·경로.
- 테스트 run 60분, 운영자·예약 세션 15분, URL 교환 capability 5분의 기술적 TTL.
- run 단위 잠금·멱등 처리·cleanup tombstone.
- 별도 migration 디렉터리와 Preview 전용 실행 절차.

금액·환불 정책·개인정보 수집 항목은 새로 결정하지 않는다. 기존 요구사항과 ADR의 규칙을 재사용한다.

## Current State

### Git·CI 체크포인트

오케스트레이터가 2026-10-18 실제 Git과 GitHub를 읽기 전용으로 확인했다.

| 항목 | 확인 결과 |
|---|---|
| 로컬 브랜치 | `feature/phase21-ai-service` |
| HEAD | `942068e32808f64f0d8c528eed4cab3a7ac99ae3` |
| 원격 PR | [#54](https://github.com/gulatnaru/yaho-management/pull/54), OPEN / DRAFT / unmerged |
| PR base | `feature/phase21-kakao-ai-consultation` |
| exact-head CI | [run 38929576530](https://github.com/gulatnaru/yaho-management/actions/runs/38929576530): SUCCESS |
| Production Schema Gate | [run 38929573592](https://github.com/gulatnaru/yaho-management/actions/runs/38929573592): PENDING |
| gate 내부 | detect-schema-change SUCCESS, production-migrate PENDING, 실행 단계 없음 |
| 오래된 gate | run `38926417254`: CANCELLED |
| 작업 트리 | 기존 AI 서비스 tracked/untracked 변경 존재. 커밋 HEAD의 CI가 이 변경까지 검증한 것은 아님 |

Memory의 오래된 gate 상태보다 위 실제 확인 결과를 우선한다. fetch·push·commit·merge·Environment 승인·DB 접속을 수행하지 않았다.

### 구현 근거

| 근거 | 현재 상태와 설계 영향 |
|---|---|
| `prisma/schema.prisma:10`, `:14` | 기본 client 하나, `DATABASE_URL` / `DIRECT_URL` 사용 |
| `lib/db/prisma.ts:1` | 기본 `@prisma/client` singleton. manual 경로에서 사용 금지 |
| `auth.ts:1` | Auth.js Credentials + JWT 세션 |
| `lib/auth/authorization.ts:1` | 기존 ADMIN 권한은 기본 Prisma로 현재 User를 조회 |
| `app/(admin)/layout.tsx:1` | ADMIN layout에서도 public 기반 조회 발생. 테스트 실행 화면은 이 layout 밖에 둠 |
| `server/reservations/create.ts` | 클래스 잠금·정원·중복·아이 상태 검증 코어 존재 |
| `server/reservation-applications/groups.ts:149` | Phase20 다자녀 제출 코어. 기기·동행 분기 포함 |
| `server/reservation-applications/finance.ts` | 사전 입금·확정·반환·배정 코어 존재 |
| `lib/payments/core.ts:42`, `:126` | 결제 생성·PaymentItem 잠금 기반 환불 코어 |
| `server/revenue/queries.ts:1` | 현재 ADMIN·기본 Prisma에 결합. manual용 저장소 주입 필요 |
| `lib/e2e/preview-safety.ts:129` | 기존 Preview E2E는 `public`만 허용 |
| `lib/e2e/phase20-lease.ts:5` | E2E 전용 header와 lease 사용 |
| `docs/DEPLOYMENT.md:64` | E2E fingerprint에 schema 포함. 기존 흐름 유지 |
| `scripts/release/schema-change.ts:5` | Production gate는 기본 Prisma 경로를 검사 |
| `.github/workflows/ci.yml:1` | 기본 client 생성·lint·unit·build. 자동 E2E 없음 |

설치된 Prisma CLI와 Client는 모두 `6.19.3`이다. `package.json` 범위는 `^6.0.0`이다. 이번 작업에서 Prisma7·driver adapter 전환을 추가하지 않는다.

### 문서·정책 정합성

- `ARCHITECTURE.md`의 Modular Monolith와 `server/<domain>/` 경계를 유지한다.
- REQUIREMENTS Phase19 및 ADR-030/059의 shared Preview·합성 데이터·수동 migration·Production 차단을 유지한다.
- REQUIREMENTS Phase20 및 ADR-060의 신청·입금·확정·반환 의미를 유지한다.
- ADR-005/007/008/023/034~040의 금액·환불·매출·잠금·동의 규칙을 유지한다.
- 테스트 종료 시 합성 데이터를 삭제하는 범위는 이번 사용자의 명시적 cleanup 요구사항이다. 운영 이력 삭제 정책을 변경하지 않는다.

### 일반 공개 예약 503 관련 확인 한계

사용자는 일반 공개 예약 경로의 기존 503 차단 유지를 요구했다. 이 요구는 그대로 적용한다.

현재 저장소의 예약 `/apply/*`에서는 접수 종료 화면과 Preview lease guard를 확인했으나, HTTP503을 직접 반환하는 기존 예약 차단 코드는 찾지 못했다. 확인된 고정503 코드는 AI ingress에 있다.

따라서 **공개 예약503의 실제 적용 위치·배포 상태는 미확인**이다. 현재는 live 요청이나 배포 변경으로 확인하지 않는다. 후속 구현은 기존 guard를 약화하지 않아야 하며, 활성화 전 기존503의 소유 경로를 확인하고 동일 동작의 회귀 검증을 확보해야 한다.

## A/B Comparison

| 항목 | A: 기존 DB + `manual_test` | B: 별도 Supabase 프로젝트 |
|---|---|---|
| 사용자 결정 | **채택** | **기각** |
| DB·프로젝트 | 기존 `yaho-preview` 유지 | 신규 프로젝트 필요 |
| 데이터 격리 | 별도 schema·role·client·auth | 프로젝트 단위 격리 |
| 운영 준비 | 기존 DB ACL 확인·권한 정리가 중요 | 별도 DB·secret·관리 대상 추가 |
| E2E 관계 | 기존 `public` E2E와 schema 분리 | 프로젝트도 분리 |
| 주요 위험 | 잘못된 PUBLIC 권한·pooling 설정 | 사용자 결정 위반 및 별도 운영 부담 |
| 이번 PLAN | 구현 구조 제안 | 비교 기록만 유지 |

B안 기각 사유는 흥영이 별도 프로젝트를 명시적으로 거부하고 기존 Preview DB 사용을 선택했기 때문이다. A안의 ACL 조건이 충족되지 않으면 A안 활성화를 중단한다. B안으로 자동 전환하지 않는다.

## Final Architecture

```text
기존 ADMIN 로그인 / public User
        │ 시작 요청만 승인
        ▼
POST /api/manual-test/bootstrap
        │ 별도 manual client
        ▼
manual_test.Run + 합성 User + OPERATOR Session
        │
        ├─ 가상 클래스 / 신청 링크 / QR
        │
iPhone ─┴─ fragment capability → POST 교환
                                │
                        RESERVATION Session
                                │
                 신청 → 합성 입금 → 확정
                                │
                 Payment / Refund / Revenue
                                │
                    종료·인증 철회 → cleanup
```

- ADMIN 권한은 테스트 시작·재인증 진입만 승인한다.
- 테스트 동작은 별도 `ManualTestPrincipal`만 인정한다.
- 테스트 업무는 별도 generated client와 제한된 DB role만 사용한다.
- 기존 ADMIN action·공개 action을 테스트 화면에서 호출하지 않는다.
- 기본 Prisma·운영 설정·기존 Child/Program/ClassSchedule로 fallback하지 않는다.
- 외부 결제·실제 계좌이체·고객 알림·외부 API 호출은 수행하지 않는다.

## Data Model

### 공통 원칙

아래 모델·enum·index·FK는 모두 `manual_test`에 생성한다. `public`의 데이터를 복사·이관하거나 객체를 참조하지 않는다.

- 기존 도메인 명칭을 유지한다.
- 업무 테이블은 `id` PK, `runId NOT NULL`, `UNIQUE(runId,id)`를 가진다.
- 모든 업무 FK는 가능한 경우 `(runId, targetId) → (runId,id)` 복합 FK로 연결한다.
- 모든 테이블의 `runId`는 `ManualTestRun.id`를 참조한다.
- FK 열에는 대응 index를 둔다. 기존 unique가 해당 index 역할을 하면 중복 생성하지 않는다.
- 기존 unique는 원칙적으로 run 단위로 확장한다.
- run별 생성·조회·cleanup을 위한 `runId` index를 둔다.
- PK/FK·금액·상태 CHECK는 Prisma migration SQL로 관리한다.
- 새 ID가 public ID와 우연히 같아도 public 데이터에 연결되지 않는다.
- cross-schema FK·view·trigger·function·FDW·`dblink` 의존성을 만들지 않는다.
- 필요한 enum도 `manual_test`에 정의한다.
- UTC 저장·KST 표시 및 정수 KRW를 유지한다.

다음 표의 “기존 필드”는 현재 모델의 해당 업무에 필요한 스칼라 필드를 뜻한다. BUILD에서는 필드·CHECK 대응표를 작성하여 누락을 검증한다. 기존 모델 전체를 무조건 복제하지 않는다.

### 테스트 제어·인증 테이블: 4개

| 테이블 | 주요 열 | 제약·index |
|---|---|---|
| `ManualTestRun` | `id`, `startRequestKey`, `status`, `deploymentSha`, `schemaVersion`, `createdAt`, `expiresAt`, `closedAt?`, `cleanedAt?`, `cleanupAttempts`, `lastCleanupCode?` | startRequestKey unique, status/expiry index, 유효한 시각·상태 CHECK |
| `ManualTestSession` | `id`, `runId`, `tokenHash`, `scope`, `actorUserId?`, `linkId?`, `submissionId?`, `createdAt`, `expiresAt`, `revokedAt?` | tokenHash unique, run/expiry index, OPERATOR와 RESERVATION의 허용 binding CHECK |
| `ManualTestAccessGrant` | `id`, `runId`, `linkId`, `tokenHash`, `purpose`, `expiresAt`, `consumedAt?`, `createdAt` | tokenHash unique, run/link/expiry index. purpose는 예약 세션 교환 |
| `ManualTestOperationReceipt` | `id`, `runId`, `operation`, `requestKey`, `payloadDigest`, `resultIds`, `createdAt` | unique(runId,operation,requestKey). resultIds는 내부 합성 ID만 저장 |

`ManualTestRun.status`는 `ACTIVE`, `CLOSED`, `CLEANUP_PENDING`, `CLEANED`를 사용한다.

`ManualTestSession.scope`는 `OPERATOR`, `RESERVATION`만 사용한다. ADMIN이라는 scope를 만들지 않는다.

### 가상 클래스·아이·감사 주체: 7개

| 테이블 | 주요 열 및 관계 | 제약·index |
|---|---|---|
| `User` | id/runId, 합성 name, isActive, timestamps. 처리자 FK의 대상 | public User FK·실제 email/password·ADMIN credential 없음 |
| `Teacher` | name, isActive, 합성 선택 필드, timestamps | name 공백 금지 |
| `Program` | name, description?, targetAgeMin/Max?, defaultDuration?, defaultPrice, status, memo?, timestamps | 기존 연령·기간·가격 CHECK |
| `ClassSchedule` | programId, startsAt, endsAt, location, capacity, status, applicationPrice?, memo?, 기존 취소·보험 필드, timestamps | 시간 순서·capacity 양수. run/startsAt, run/status |
| `ClassTeacher` | classScheduleId, teacherId, createdAt | unique(runId,classScheduleId,teacherId) |
| `Child` | 기존 이름·생년월일·성별·보호자·활성·파기·timestamps 필드 | 기존 파기 CHECK. run/name, run/isActive |
| `ChildConsent` | childId, consentType, action, recordedAt, recordedById?, reservationApplicationId?, consentVersion?, memo? | run/childId/consentType/recordedAt index. 업무상 append-only |

가상 클래스는 run에서 만든 Program·Teacher만 선택한다. 실제 Preview 카탈로그를 읽거나 가져오는 기능을 만들지 않는다.

`User`는 도메인 감사용 합성 주체다. 테스트 인증은 이 테이블의 ADMIN role이나 비밀번호에 의존하지 않는다.

### 신청·입금·반환 의존 테이블: 11개

| 테이블 | 주요 열 및 관계 | 제약·index |
|---|---|---|
| `ReservationApplicationGroup` | isActive, createdById, timestamps | run/isActive. 기존 syntheticRunId를 E2E lease로 해석하지 않음 |
| `ReservationApplicationGroupClass` | groupId, classScheduleId, createdAt | unique(runId,groupId,classScheduleId) |
| `ReservationApplicationLink` | groupId, tokenHash, isActive, issuedAt, issuedById, timestamps | tokenHash unique. legacy 평문 token 발급하지 않음 |
| `ReservationApplicationSubmission` | groupId, 기존 보호자·입금자·제출·알림·완료·파기 필드 | run/groupId/submittedAt, completionTokenHash unique |
| `ReservationApplication` | submissionId, classScheduleId, quotedAmount, 기존 아이·보호자·확인·동의·상태·처리·Child/Reservation 연결 필드 | 기존 상태/동의 CHECK, run/submissionId/status, run/classScheduleId/status |
| `ApplicationDeposit` | submissionId, amount, payerName?, depositedAt, confirmedAt, confirmedById, idempotencyKey? | amount 양수, run scoped idempotency unique |
| `ReservationApplicationPaymentMapping` | applicationId, paymentItemId, createdAt | 각각 run scoped unique |
| `ReturnObligation` | submissionId, applicationId?, kind, amount, returnedAmount, resolvedAt?, createdAt | 금액 상한 CHECK, run/submissionId/resolvedAt |
| `ApplicationReturn` | returnObligationId, amount, returnedAt, processedById, reason?, idempotencyKey? | 양수, run scoped idempotency unique |
| `FundAllocation` | depositId, paymentMappingId?, returnObligationId?, amount, createdAt | 양수, 배정 대상 정확히 하나 CHECK, 각 FK index |
| `ReservationApplicationSettings` | id, bankName, accountNumber, accountHolder, blogUrl, instagramUrl, kakaoChannelUrl, updatedById, timestamps | `runId UNIQUE`. run별 합성 설정, public singleton 조회 없음 |

설정은 run별로 생성한다. 현재 기본 코드의 `id=1` singleton 조회를 manual 경로에 그대로 사용하지 않는다.

최종 신청금액은 테스트 운영자가 가상 ClassSchedule에 명시한다. `Program.defaultPrice`나 public 가격으로 fallback하지 않는다.

### 예약·결제·환불: 4개

| 테이블 | 주요 열 및 관계 | 제약·index |
|---|---|---|
| `Reservation` | childId, classScheduleId, status, attendance?, 기존 출결·취소·처리자·메모·시각 필드 | unique(runId,classScheduleId,childId), run/status |
| `Payment` | payerType, payerName?, method, status, paidAt, totalAmount, memo?, timestamps | run/paidAt, run/status, 기존 금액 검증 |
| `PaymentItem` | paymentId, reservationId, amount, discountAmount, paidAmount, refundedAmount, timestamps | unique(runId,reservationId), 기존 계산·환불 상한 CHECK |
| `Refund` | paymentItemId, amount, reason, reasonDetail?, status, refundedAt, processedById?, createdAt | 양수, run/paymentItemId, run/refundedAt |

Revenue 저장 테이블은 만들지 않는다. 위 테이블의 run 범위 데이터를 기존 집계 규칙으로 조회한다.

### 신청 기기 의존 테이블: 3개

| 테이블 | 주요 열 및 관계 | 제약·index |
|---|---|---|
| `ApplicationDevice` | tokenHash, expiresAt, revokedAt?, timestamps | tokenHash unique, run/expiry |
| `DeviceSubmission` | deviceId, submissionId, createdAt | unique(runId,deviceId,submissionId) |
| `DeviceChild` | deviceId, childId, createdAt | unique(runId,deviceId,childId) |

현재 제출·확정 코어가 기기 소유 관계를 생성하므로 포함한다. 테스트에서는 기존 장기 기기 TTL을 그대로 사용하지 않고 run·예약 세션 만료 시점 안으로 제한한다.

### 제외하는 테이블·기능

총 구성은 **업무 25개 + 테스트 제어 4개 = 29개 테이블**이다.

- `Relationship`, `ChildSafetyInfo`: 이번 필수 흐름에서 사용하지 않는다.
- `CompanionInvite`, `CompanionGroup`, `CompanionGroupMember`: 친구 동행 기능은 이번 UX 범위에 없다. 해당 분기를 호출하지 않는다.
- `UserAccountChange`: 실제 계정 관리 기능을 제공하지 않는다.
- `PreviewE2eRunLease`, AI 관련 모델: 생성·참조·cleanup하지 않는다.
- 제외 모델로 이어지는 Prisma relation 필드는 manual schema에서 제외한다.
- 기존 코어가 제외 delegate를 타입상 요구하면 필요한 공통 경로를 좁은 port로 추출한다. 빈 delegate나 기본 client로 우회하지 않는다.

### DB 제약과 서버 규칙

| DB에서 보장 | 서버에서 보장 |
|---|---|
| schema ACL 및 runtime role 권한 | bootstrap와 테스트 인증의 분리 |
| 동일 run 복합 FK | 모든 조회·변경의 현재 run binding |
| 예약·PaymentItem·mapping unique | 클래스·아이 상태, 정원 및 초과 예약 확인 |
| 금액 정수·비음수·계산식·환불 상한 | 입금 보존식·배정 합계·Refund 합계 일치 |
| 필수 동의·상태 CHECK | 현재 동의 문구·입력 검증·합성 값만 허용 |
| 세션·grant hash unique | TTL·철회·scope·CSRF·Origin 검증 |
| receipt unique | 멱등 요청의 payload 일치 및 재시도 |
| FK 무결성 | cleanup 대상 run·manifest·삭제 순서 |
| 다른 schema의 업무 객체 접근 차단 | 운영 중 재무·동의 이력의 임의 수정·삭제 금지 |

cleanup을 위해 runtime에 허용한 DELETE 권한만으로 업무 이력이 DB 수준에서 append-only라고 주장하지 않는다. 업무 경로에서는 삭제·덮어쓰기를 제공하지 않으며, 사용자 승인 범위인 합성 run cleanup만 별도 진입점으로 수행한다.

## Database Roles and Prisma

### 역할 구조

| 역할 | 용도 | 권한 경계 |
|---|---|---|
| 승인된 provisioning 주체 | 최초 role·schema·ACL 준비 | 후속 실행 승인에 포함된 SQL만 실행. 앱에서 사용 금지 |
| `manual_test_owner` | schema·table·enum 소유 | NOLOGIN |
| `manual_test_migrator` | manual Prisma migration | manual owner 역할만 사용할 수 있는 전용 migration identity |
| `manual_test_runtime` | 테스트 앱 CRUD | 최초 NOLOGIN, 검증·별도 승인 후 LOGIN. NOSUPERUSER, NOCREATEDB, NOCREATEROLE, NOREPLICATION, NOBYPASSRLS, 다른 privileged role membership 없음 |

runtime은 schema owner가 아니며 CREATE·ALTER·DROP·TRUNCATE·GRANT 권한을 갖지 않는다. `_prisma_migrations`는 변경할 수 없으며, 상태 확인에 필요한 SELECT만 별도로 검토한다.

`manual_test_runtime`은 최초에 **NOLOGIN 상태로 생성하고 credential을 발급하지 않는다.** PUBLIC 실효 권한 정리와 승인된 비변경 권한 검증이 완료되기 전에 LOGIN을 허용하지 않는다. 로그인 전 검증은 승인된 provisioning 세션의 제한된 역할 전환과 catalog·실효 권한 조회로 수행한다. PUBLIC 권한을 상속한 runtime이 중간 단계에서 접속 가능한 상태를 만들지 않는다. credential 발급·LOGIN 전환·Preview 기능 활성화는 각각 명시적으로 승인된 실행 범위에서만 수행하며, PLAN 승인이나 migration 성공으로 자동 승인되지 않는다.

`manual_test`를 Data API exposed schemas에 추가하지 않는다. `anon`, `authenticated`, `service_role`에 해당 schema 접근 권한을 새로 주지 않는다.

### PUBLIC 권한의 함정과 실행 조건

PostgreSQL 권한은 가산 방식이다. 아래 조치만으로는 요구사항을 만족하지 않는다.

```text
REVOKE ... FROM manual_test_runtime
```

`PUBLIC`에 `public` USAGE나 함수 EXECUTE가 남아 있으면 runtime도 그 권한을 받는다. `NOINHERIT`도 PUBLIC 권한을 제거하지 않는다.

따라서 향후 승인된 preflight에서는 다음을 확인해야 한다.

1. PUBLIC·직접 grant·role membership·ownership을 합친 실효 권한.
2. public 외 `auth`, `storage`, `extensions` 등 업무 객체가 있는 schema의 접근 경로.
3. PUBLIC EXECUTE인 SECURITY DEFINER 함수 등 우회 경로.
4. database CREATE·TEMP 및 extension·FDW·외부 연결 관련 권한.
5. 변경이 필요한 PUBLIC ACL과 현재 정상 사용자의 명시적 grant 목록.

PUBLIC ACL을 정리해야 한다면 기존 정상 역할의 필요한 권한을 먼저 명시하고, 같은 검토된 변경 안에서 PUBLIC grant를 제거한다. 이는 기존 데이터 DML과 구분되는 권한 변경이지만 shared Preview에 영향을 줄 수 있으므로 **정확한 영향과 복구 SQL을 별도 승인받기 전 실행하지 않는다.**

이미 lookup을 캐시한 기존 연결까지 USAGE REVOKE만으로 안전해졌다고 간주하지 않는다. 새 runtime role을 사용하고, 승인된 연결 재생성·재검증 계획을 마련한다.

`pg_catalog` 등 PostgreSQL 실행에 필요한 시스템 영역은 별개다. 일반 role로 시스템 catalog 존재 자체를 완전히 감추는 것을 이 요구사항으로 약속하지 않는다. 업무 객체와 고객·예약·재무 데이터의 접근 금지가 검증 대상이다.

### 전용 Prisma 구성

제안 파일 구조:

```text
prisma/manual-test/
  schema.prisma
  migrations/
    migration_lock.toml
    <timestamp>_manual_test_initial/migration.sql
    <timestamp>_manual_test_acl_hardening/migration.sql

lib/db/
  manual-test-prisma.ts

server/manual-test/
  runtime.ts
  database-identity.ts
  unit-of-work.ts
  repositories/
```

- generator output은 기본 client와 다른 `generated/manual-test-client` 경로.
- `MANUAL_TEST_DATABASE_URL`: runtime 전용, `schema=manual_test`.
- `MANUAL_TEST_RUNTIME_DIRECT_URL`: 필요 시 동일 runtime 역할의 직접 연결 검증용.
- `MANUAL_TEST_MIGRATION_URL`: migration 전용 직접 연결. 앱 runtime에 배포하지 않음.
- schema의 directUrl은 CLI 전용 migration 환경에서 주입한다.
- 설정 누락·Production target·기본 role·schema 불일치 시 client 생성 전에 실패한다.
- 기본 `DATABASE_URL` / `DIRECT_URL`을 대체값으로 읽지 않는다.
- server-only lazy singleton이며 기본 Prisma singleton과 별도 global key를 사용한다.
- 생성은 DB 접속 없는 명령으로 분리한다. install/build에서 migration을 실행하지 않는다.

### search_path 보장

`schema=manual_test`와 실제 PostgreSQL 세션 `search_path`를 같은 것으로 간주하지 않는다.

- role의 기본 search_path를 `manual_test`로 설정한다.
- manual unit-of-work는 transaction 진입 시 고정된 `SET LOCAL search_path = manual_test`를 실행한다.
- 같은 transaction에서 runtime identity와 실제 search_path를 확인한다.
- `public`을 fallback으로 추가하지 않는다.
- 필요한 raw SQL 테이블은 고정된 `manual_test` 식별자로 한정한다.
- 사용자 입력으로 schema·role·table 이름을 조합하지 않는다.
- pooled 연결에서 과거 한 번 실행한 `SET`이 유지된다고 가정하지 않는다.
- 직접 연결과 실제 사용할 pooler mode를 각각 검증해야 한다.
- pooler가 필요한 설정을 지원하지 않으면 승인된 runtime 직접/세션 연결을 사용한다. 격리를 낮추지 않는다.

`search_path`는 schema-qualified SQL 접근을 차단하지 않는다. 따라서 최종 보안 경계는 DB role의 실효 권한이다.

## Auth Flow

### 1. ADMIN bootstrap

1. 사용자는 기존 ADMIN으로 로그인한다.
2. `/tools/manual-test`에서 “수동 테스트 시작”을 선택한다.
3. `POST /api/manual-test/bootstrap`이 기존 Auth.js와 현재 ADMIN 권한을 확인한다.
4. CSRF·정확한 Origin·허용 Preview origin·배포 SHA를 검증한다.
5. 전용 client로 run, 합성 감사 User, OPERATOR session을 생성한다.
6. HttpOnly cookie를 설정하고 `/manual-test/runs/[runId]`로 이동한다.

bootstrap는 기존 ADMIN 인증을 위해 public User를 읽는 명시적 예외 경계다. manual 업무 저장소는 ADMIN 조회 client를 전달받지 않는다.

중복 클릭은 `startRequestKey`로 동일 run 결과를 재사용한다. 기존 ADMIN 계정을 manual schema에 복사하거나 ADMIN cookie를 테스트 권한으로 해석하지 않는다.

### 2. 독립 테스트 세션

제안 TTL:

| 대상 | TTL |
|---|---|
| run | 시작 후 최대 60분 |
| OPERATOR session | 발급 후 15분, run 만료를 넘지 않음 |
| RESERVATION session | 발급 후 15분, run 만료를 넘지 않음 |
| 예약 세션 교환 grant | 발급 후 5분, 1회 사용 |

만료값은 PLAN 승인 대상인 기술적 기본안이다. 무제한 sliding 연장하지 않는다.

- 운영자 cookie는 `__Host-yaho-manual-test-operator`, 예약 cookie는 `__Host-yaho-manual-test-reservation`을 사용한다. 두 cookie 모두 Secure, HttpOnly, SameSite=Lax, **`Path=/`**, Domain 미설정으로 발급한다. `/manual-test/*` UI와 `/api/manual-test/*` API에 모두 전달되도록 Path를 지정하며, 독립된 이름과 서버 검증으로 Auth.js·E2E cookie와 구분한다. 삭제할 때도 동일한 이름·Path를 사용한다.
- cookie에는 충분한 엔트로피의 opaque token만 둔다.
- DB에는 domain-separated hash/HMAC만 저장한다.
- 이름·전화번호·역할 claim·고객 정보는 cookie에 넣지 않는다.
- 모든 요청에서 session·run의 만료·철회·scope·binding을 다시 확인한다.
- OPERATOR 재발급은 기존 ADMIN 재인증 경계를 다시 통과한다. run 자체를 연장하지 않는다.
- ADMIN cookie만 있거나 E2E header만 있는 요청은 manual 업무에서 거부한다.

### 3. iPhone URL과 cookie 교환

1. OPERATOR가 run 내 신청 링크에 연결된 1회용 grant를 발급한다.
2. QR·복사 URL은 `/manual-test/join#token=<opaque>` 형식으로 제안한다.
3. URL fragment는 HTTP 요청 경로에 전송되지 않는다.
4. landing Client Component가 fragment를 메모리에서 읽고 주소에서 즉시 제거한다.
5. 같은 origin의 교환 POST로 capability를 전송한다.
6. 서버가 grant 만료·미사용·run·링크 활성 상태를 잠금 후 확인한다.
7. grant 소비와 RESERVATION session 생성을 같은 transaction에서 처리한다.
8. cookie를 설정하고 토큰 없는 예약 화면으로 이동한다.

수동 header 입력·Safari 개발자 도구·별도 토큰 붙여넣기는 요구하지 않는다. 일반 HTTP 라이브러리가 설정하는 표준 header는 수동 인증 입력과 구분한다.

GET·링크 미리보기는 grant를 소비하지 않는다. POST에는 정확한 Origin·Fetch Metadata 검사와 landing에서 발급한 짧은 CSRF nonce를 적용한다.

전화기 여러 대가 필요하면 운영자가 별도 grant를 발급한다. 한 grant의 동시 교환은 하나만 성공한다. 토큰 원문은 로그·에러·analytics·storage에 남기지 않는다.

### 4. 제출·완료 범위

- 예약 session은 `runId + linkId`에 묶인다.
- 제출 성공 후 생성된 submission 범위를 session에 결합하거나 회전한다.
- 다른 submission·아이·금액·입금·환불은 조회하지 못한다.
- 완료·기기 cookie도 manual namespace를 사용한다.
- 현재 공개 제출 코어의 토큰 해석을 별도 경계로 분리한다.
- manual session에서 검증된 linkId를 공유 제출 코어에 전달한다.
- 저장된 hash에서 원문 토큰을 복원하거나 기본 공개 action으로 우회하지 않는다.

### 5. 종료·만료

종료는 모든 session·미사용 grant·신청 링크를 먼저 철회한다. 데이터 정리가 실패해도 예약·결제·환불을 다시 허용하지 않는다.

모든 상태 변경은 CSRF와 Origin을 서버에서 확인한다. 테스트 페이지는 `no-store`, referrer 제한, 검색 엔진 비노출을 적용한다. CSRF token은 인증 cookie와 별개로 취급한다.

## Code Structure

```text
app/(admin)/tools/manual-test/page.tsx
app/api/manual-test/bootstrap/route.ts

app/(manual-test)/manual-test/
  layout.tsx
  join/page.tsx
  runs/[runId]/page.tsx
  runs/[runId]/classes/new/page.tsx
  runs/[runId]/applications/page.tsx
  runs/[runId]/payments/page.tsx
  runs/[runId]/revenue/page.tsx
  reserve/page.tsx
  complete/page.tsx

app/api/manual-test/
  exchange/route.ts
  runs/[runId]/classes/route.ts
  runs/[runId]/links/route.ts
  runs/[runId]/applications/[id]/deposit/route.ts
  runs/[runId]/applications/[id]/confirm/route.ts
  runs/[runId]/refunds/route.ts
  runs/[runId]/close/route.ts
  runs/[runId]/cleanup/route.ts
  submission/route.ts

server/manual-test/
  auth.ts
  csrf.ts
  runtime.ts
  runs.ts
  fixtures.ts
  links.ts
  cleanup.ts
  unit-of-work.ts
  repositories/

server/reservation-applications/
  ports.ts
  submission-core.ts
  finance.ts
server/reservations/
  ports.ts
  create.ts
server/payments/
  ports.ts
  payment-core.ts
  refund-core.ts
server/revenue/
  ports.ts
  queries.ts
  aggregate.ts

lib/validation/manual-test.ts
tests/unit/manual-test/
tests/integration/manual-test/
tests/e2e/manual-test/
scripts/manual-test/
```

경로는 구현 시 기존 구조에 맞춰 좁게 조정할 수 있지만 도메인 경계를 바꾸지 않는다.

### 재사용 방식

- 순수 계산·Zod·동의 계획·매출 병합 함수는 재사용한다.
- DB·권한 결합은 repository와 unit-of-work port로 분리한다.
- 공유 코어는 repository를 필수 인자로 받는다.
- 기본 Prisma·ADMIN principal을 선택적 default로 두지 않는다.
- production adapter와 manual adapter를 각각 명시적으로 조립한다.
- manual adapter는 runId를 서버 context에서 강제한다.
- 다른 generated Prisma Client를 `as unknown as PrismaClient`로 위장하지 않는다.
- transaction 내부 코어를 추출하여 run 잠금·receipt·업무 변경이 하나의 transaction에 들어가게 한다.
- 기존 ADMIN·공개 wrapper 동작은 기존 회귀 테스트로 검증한다.

현재 `lib/payments/core.ts`의 DB 업무 코어는 해당 변경에 필요한 범위만 `server/payments/`로 이동하거나 위임한다. 별도의 광범위한 리팩터링은 포함하지 않는다.

## API

모든 manual API는 환경 확인 → 인증 → CSRF/Origin → Zod → run 잠금·상태 확인 → 업무 규칙 → 전용 repository 순서를 따른다.

| 경로 | 권한 | 주요 동작 |
|---|---|---|
| bootstrap | 기존 ADMIN | 독립 run·OPERATOR 세션 생성 |
| exchange | 유효한 1회 grant | 예약 cookie 발급 |
| classes | OPERATOR | 해당 run의 가상 클래스 생성 |
| links | OPERATOR | 신청 링크·QR용 grant 발급·철회 |
| submission | RESERVATION | 본인 범위 합성 신청 제출 |
| deposit | OPERATOR | 합성 입금 확인 기록 |
| confirm | OPERATOR | Reservation·Payment·mapping·allocation 원자적 생성 |
| refunds | OPERATOR | 기존 환불 규칙에 따른 합성 Refund 생성 |
| revenue 조회 | OPERATOR | 해당 run의 독립 fact 집계 |
| close | OPERATOR | run 종료·세션 철회 |
| cleanup | 유효한 종료 권한 | 종료한 해당 run만 정리 |

cleanup 재시도는 일반 OPERATOR session 철회 후에도 가능한 별도 경계가 필요하다. 기존 ADMIN으로 다시 들어온 bootstrap 관리 경계가 run의 cleanup 작업만 승인하고, 전용 client로 실행한다. 종료된 업무 session을 재활성화하지 않는다.

### 금액·환불·매출

- 합성 신청 제출·“입금했어요”로 Payment·Reservation·Revenue를 생성하지 않는다.
- 합성 입금은 신청 제출 후, 예약 확정 전 입금 원장(`ApplicationDeposit`)에 기록하고 기존 확인·배정 규칙을 따른다.
- 확정 시 고정 quotedAmount를 정확히 한 번 PaymentItem에 연결한다.
- 초과입금·예약 전 반환은 Refund·Revenue에 포함하지 않는다.
- 환불은 PaymentItem 잠금 뒤 잔액을 확인한다.
- 노쇼 사유·수동 환불·금액 상한 등 기존 ADR을 유지한다.
- 완료 환불 합계와 refundedAmount를 같은 transaction에서 일치시킨다.
- PaymentItem·Refund fact를 분리 집계해 중복 합산을 막는다.
- 결제일·환불일·KST 기간 기준은 ADR-040을 유지한다.
- 테스트 금액은 합성 fixture 또는 테스터의 가상 입력이다. 운영 가격·환불 정책의 결정으로 기록하지 않는다.

## UI

1. **기존 관리자 화면**: ADMIN 전용 “수동 테스트” 진입.
2. **시작 화면**: 합성 데이터 전용 표시와 테스트 시작.
3. **가상 클래스**: 합성 Program·Teacher, 날짜·정원·최종 신청금액 지정.
4. **예약 URL**: QR·복사·남은 교환 시간·재발급 제공.
5. **iPhone 예약**: cookie 자동 발급 후 합성 보호자·아이 신청.
6. **관리자 테스트 화면**: 접수 → 합성 입금 → 확정 상태 확인.
7. **결제·환불·매출**: 동일 run의 연결 내역과 합계 확인.
8. **종료**: 접수 중단 → 세션 철회 → 정리 결과. 실패 시 안전한 재시도.

모든 테스트 화면에 “가상 테스트”와 남은 run 시간을 표시한다. QR 표시·복사·폼 상호작용만 Client Component로 두고 데이터·권한·집계는 Server Component/서버 모듈에서 처리한다.

실제 개인정보 입력을 방지하기 위해 이름·전화·생년월일 등은 서버가 발급한 합성 fixture 선택/읽기 전용 값으로 제공한다. 서버도 fixture manifest와 일치하는 값만 허용한다. 임의 개인정보를 입력한 뒤 저장하지 않는다는 안내만으로 제한을 대신하지 않는다.

은행·계좌·연락처 URL도 run별 합성 설정만 사용한다. 실제 이체를 유도하지 않는다. loading·empty·error·만료·정리 실패 상태와 iPhone Safari 화면을 포함한다.

## Concurrency and Cleanup

### 잠금·멱등성

모든 manual 업무 transaction은 먼저 `ManualTestRun`을 `FOR SHARE`로 잠그고 ACTIVE·만료 상태를 재검증한다. 종료·cleanup은 같은 행을 `FOR UPDATE`로 잠근다.

따라서 진행 중 transaction은 종료 전에 완료되거나 실패하고, 종료 이후 새 업무 transaction은 쓰기 전에 거부된다. 세션을 transaction 바깥에서 한 번 확인하는 것만으로 처리하지 않는다.

그 다음 기존 잠금 순서를 유지한다.

```text
Run
→ Submission / Application / Group 등 해당 업무의 부모
→ 정렬된 ClassSchedule
→ 정렬된 Child
→ Payment / PaymentItem 등 해당 재무 부모·자식
```

독립 코어를 합칠 때 기존 잠금 순서와 충돌하지 않도록 실제 호출별 표를 작성한다. 한 Payment에 여러 item이 연결되는 경우 환불 후 Payment 상태 갱신도 직렬화해야 한다.

receipt는 run·operation·requestKey로 중복 요청을 판정한다. 같은 key에 다른 payload가 오면 거부한다. receipt와 실제 변경은 한 transaction에서 저장한다.

### 종료·삭제 절차

1. run 독점 잠금 뒤 CLOSED 전환.
2. session·grant·link 철회 및 종료 commit.
3. 별도 cleanup transaction에서 run 독점 잠금.
4. ACTIVE가 아니고 대상 run이 정확한지 확인.
5. 모든 삭제에 `runId` 조건을 강제하고 의존 순서대로 삭제.
6. 잔여 업무 행 수 0 확인 후 CLEANED 기록.
7. `ManualTestRun`의 최소 tombstone만 남긴다.

삭제 순서 초안:

```text
Session / AccessGrant
→ DeviceChild / DeviceSubmission
→ FundAllocation / ApplicationReturn
→ ReservationApplicationPaymentMapping
→ ChildConsent
→ Application의 Reservation·Child 등 순환 연결 해제
→ ReturnObligation / ApplicationDeposit
→ ReservationApplication
→ Refund
→ PaymentItem / Payment
→ Reservation
→ ReservationApplicationSubmission
→ ReservationApplicationLink / GroupClass / Group
→ ApplicationDevice
→ ClassTeacher / ClassSchedule
→ Child / Teacher / Program / Settings / User
→ OperationReceipt
```

해제 대상 FK도 동일 run인지 복합 FK와 조건으로 확인한다. 세부 순서는 실제 migration FK graph로 검증한다.

삭제 transaction 실패 시 전체 삭제를 rollback한다. 인증 철회와 CLOSED 상태는 유지한다. 별도 상태 갱신으로 CLEANUP_PENDING·오류 코드·시도 횟수를 남긴다.

이미 CLEANED인 run의 재요청은 성공으로 응답한다. 동시 cleanup은 run 잠금으로 하나만 수행한다. 일시적 실패는 제한된 횟수만 재시도하고, 무한 반복·전체 schema 삭제로 복구하지 않는다.

만료 run은 즉시 업무 접근을 거부한다. 삭제는 관리자 재진입 cleanup으로 처리한다. 이번 범위에서 별도 scheduler·공개 cron을 추가하지 않는다.

금지 사항:

- 무조건 `deleteMany`, schema 전체 TRUNCATE·DROP.
- public 테이블 조회·삭제·연결 해제.
- 다른 run·기존 E2E lease·합성 데이터 삭제.
- 사용자 입력을 SQL identifier로 사용.
- 정리 실패 후 제한 없는 privileged client 재시도.

## E2E Isolation

기존 Preview E2E는 `public`과 E2E 전용 header·lease·서명을 사용한다. manual은 `manual_test`와 별도 cookie·grant·key namespace를 사용한다.

| 영역 | 기존 E2E | manual |
|---|---|---|
| schema | public | manual_test |
| client | 기존 client | 별도 generated client |
| 인증 | E2E 서명 header·lease | cookie/session·1회 grant |
| run | 기존 preview run 형식 | 별도 manual run 형식 |
| secret | PREVIEW_E2E 계열 | MANUAL_TEST 계열 |
| cleanup | 기존 ownership guard | manual run 복합 FK·명시 삭제 |
| migration history | public | manual_test |

manual 인증이 E2E header를 읽거나 E2E 서명을 수용하지 않는다. 기존 E2E cookie·lease·advisory lock·fingerprint 함수를 manual 허용을 위해 완화하지 않는다.

기존 Preview E2E를 이번 작업에서 다른 schema로 이관하지 않는다. 두 실행은 서로 다른 schema에서 데이터를 쓰지만 shared DB 자원은 공유하므로 transaction timeout·연결 수를 제한한다. ACL 준비 작업은 E2E 실행과 겹치지 않는 승인된 유지보수 구간에 수행한다.

## Migration Plan — 실행 금지

### 현재 단계에서 하는 일

- schema·migration·권한 검증·rollback 설계만 작성한다.
- 이번 PLAN 단계에서는 migration 파일도 생성하지 않는다.
- PLAN 승인 후 developer가 DB를 변경하지 않는 migration SQL·코드·합성 검증을 준비한다.
- `migrate dev`, `migrate deploy`, `db push`, reset, live SQL을 실행하지 않는다.

### 독립 migration history

`prisma/manual-test/schema.prisma`와 인접 migrations만 사용한다. `_prisma_migrations`는 `manual_test`에 위치해야 한다.

기본 `prisma/schema.prisma`에 manual 모델을 합치거나 기본 migrations에 Preview 전용 DDL을 넣지 않는다.

첫 migration에는 필요한 schema·모델·enum·제약·소유권·grant를 포함한다. Prisma engine이 migration history 생성 전에 schema를 준비하는 동작과 최초 provisioner 권한은 6.19.3 기준으로 별도 disposable 환경에서 확인한다. “빈 schema가 이미 존재한다”는 숨은 선행 조건을 남기지 않는다.

role·schema bootstrap와 PUBLIC ACL hardening을 구분해 SQL artifact를 검토한다. 최초 적용은 승인된 provisioning identity로 수행하고, 이후 manual migration은 전용 migrator로 수행한다. secret 값은 SQL·Git·로그에 넣지 않는다.

### 향후 preflight — 현재 미실행

향후 DB 읽기 전용 접속도 별도 실행 범위로 승인받아야 한다.

- 승인된 Preview URL·프로젝트·database·runtime/migrator identity.
- Production project·origin·역할과 불일치.
- 실제 PG 버전·schema 존재 여부·기존 ACL·소유권·PUBLIC 권한.
- 정상 앱·E2E 역할의 권한 의존성.
- Data API 노출 설정·위험한 함수 경로.
- pooler mode·custom role 지원·실제 search_path.
- migration history 위치·상태·checksum.
- 승인 가능한 ACL 복구 수단과 영향 범위.

현재 이 사실들은 live DB에서 검증하지 않았다.

### 적용 직전 승인 요청

실행자가 다음 내용을 갖춘 **구체적인 적용 요청을 사용자에게 제시하고 명시적 승인을 받은 직후에만** 적용한다.

| 승인 payload | 필수 내용 |
|---|---|
| 코드 신원 | exact branch/commit SHA, 승인된 PLAN 버전 |
| artifact 신원 | migration 목록·SQL SHA256·ACL diff hash |
| 대상 | 승인 Preview project 및 opaque DB/role fingerprint, `manual_test` |
| 금지 대상 | Production·기존 Preview 데이터·public DML·E2E 데이터 |
| 권한 영향 | PUBLIC revoke 여부, 영향 역할, 명시 grant·재연결 계획 |
| 안전 증거 | 별도 승인된 합성 disposable DB의 public sentinel 불변·권한 부정 시험·rollback rehearsal, 실제 Preview는 비변경 관찰만 수행 |
| 복구 | 원래 ACL 복구 SQL·보관 방법·앱 비활성화 절차 |
| 실행 범위 | schema/role/DDL/ACL/secret provisioning 중 정확한 허용 목록 |
| 유효 기간 | 지정 유지보수 시간·일회 실행·승인 만료 |
| 중단 조건 | SHA·SQL·fingerprint·ACL·migration 상태 변경 시 중단·재승인 |

**PLAN 승인, CI 성공, Vercel READY, 이전 DB 승인 중 어느 것도 이 승인을 대체하지 않는다.**

### 적용 후 검증 — 승인된 실행에서만

- migration status·checksum·schema 소유권.
- runtime이 manual schema에서 필요한 CRUD만 수행.
- runtime의 `public."Child"` 등 schema-qualified 비변경·무반환 조회 거부와 실효 DML 권한 부재 확인. public DML은 시도하지 않음.
- 다른 업무 schema·위험 함수·SET ROLE·DDL·TRUNCATE 권한 부재를 catalog·실효 권한으로 확인. 변경 명령의 실제 거부 시험은 별도 승인된 disposable 합성 DB에 한정.
- pooled/direct 모두 같은 제한과 실제 search_path.
- 기존 public 데이터·정상 ADMIN/E2E 권한 불변을 승인된 비변경 관찰로 확인. Preview public에 sentinel을 만들지 않음.
- 공개 예약503 및 기존 guard 유지.
- 실패 시 manual 비활성 상태 유지.

기존 Production workflow의 payload는 기본 Prisma 경로만 사용한다. manual migration 실행 명령·secret을 Production/Vercel build 경로에 연결하지 않는다. release 도구의 경로 제한을 합성 테스트로 고정한다.

## Rollback Plan

### 우선 복구: 비파괴 비활성화

1. manual 진입·bootstrap를 닫는다.
2. 새 테스트 동작을 거부하고 기존 session·grant를 철회한다.
3. 호환되는 앱 버전으로 되돌린다.
4. `manual_test` schema와 migration history는 보존한다.
5. 원인·잔여 run을 확인한 뒤 승인된 cleanup만 수행한다.

Production 배포·DB 변경으로 rollback하지 않는다. 기본 공개 예약 차단도 유지한다.

### 권한 변경 복구

PUBLIC ACL hardening에 문제가 생기면 사전에 확보한 정확한 ACL snapshot과 복구 SQL을 사용한다.

복구로 기존 PUBLIC 권한을 되돌려야 한다면 runtime credential을 먼저 차단하고 연결을 종료하여 public 접근 가능 상태의 manual runtime이 남지 않게 한다. 권한 복구 자체도 실제 영향이 있는 변경이므로 승인된 복구 범위 안에서만 수행한다.

### schema 제거

`DROP SCHEMA ... CASCADE`를 자동 rollback으로 실행하지 않는다.

schema·role 제거는 별도 폐기 승인 대상으로 둔다. 대상 객체·외부 dependency 없음·연결 종료·migration 기록 처리·백업 여부를 검토한 뒤 승인받는다. 필요하더라도 public 데이터 복구·이관·삭제를 이번 작업에 포함하지 않는다.

## Tests

현재는 문서 검토만 수행했다. 아래는 구현 후 실행할 검증 계획이며 PASS 기록이 아니다.

현재 허용된 합성 검증은 DB에 접속하지 않는 fake repository·in-memory·정적 검증이다. 실제 PostgreSQL의 public sentinel 생성·변경, schema-qualified public DML 거부 시험, transaction rollback 및 ACL 복구 리허설은 **별도 DB 실행 승인을 받은 폐기 가능한 합성 전용 DB에서만** 수행한다. 해당 실제 PostgreSQL 검증은 현재 미실행이며, 기존 Preview public에 fixture를 생성하거나 데이터를 변경하여 검증하지 않는다.

향후 승인된 실제 Preview 권한 검증은 catalog·실효 권한 조회와 데이터를 반환하지 않는 비변경 읽기로 제한한다. schema-qualified SELECT는 `WHERE false` 또는 `LIMIT 0` 같은 형태를 사용한다. **거부될 것으로 예상하더라도 Preview public에 INSERT·UPDATE·DELETE·TRUNCATE 등 변경 명령을 시도하지 않는다.** 기존 데이터 불변 여부는 승인된 비변경 관찰로 확인한다.

일반 공개 예약503의 live 요청 검증도 별도 실행 승인 대상이다. 현재 저장소 검토나 DB-free 합성 검증을 실제 Preview503 확인으로 기록하지 않는다.

| 요건·ADR 근거 | 지켜야 할 결과 | 정상·거부·경합 케이스 | 수준 | 예정 위치 |
|---|---|---|---|---|
| MT-01/02, ADR-030 | A 대상만 허용 | Preview 허용, Production·다른 프로젝트·기본 role 거부 | unit/integration | `tests/unit/manual-test/runtime.test.ts` |
| MT-02, PostgreSQL ACL | public 접근 불가 | manual CRUD 성공, public SELECT/DML·함수·SET ROLE·DDL 거부 | integration | `tests/integration/manual-test/privileges.test.ts` |
| MT-03 | 별도 client·search_path | 설정 누락·public schema·기본 client fallback 거부, pooled/direct 확인 | unit/integration | `client-boundary.test.ts`, `search-path.test.ts` |
| MT-04 | 독립 인증 | ADMIN/E2E만으로 거부, scope·위조·만료·철회 거부 | unit/integration | `auth.test.ts` |
| MT-04/05 | URL→cookie | 1회 교환, 동시 교환 하나 성공, 미리보기 미소비, CSRF/다른 Origin 거부 | unit/E2E | `grant.test.ts`, `iphone-flow.spec.ts` |
| MT-06 | 같은 run만 연결 | 다른 run·public ID 대입 거부, 복합 FK 직접 위반 거부 | unit/integration | `run-isolation.test.ts` |
| MT-05, ADR-023 | 기존 예약 규칙 | 취소·종료·비활성·중복·마지막 좌석·초과 확인 경합 | unit/integration | 기존 `tests/unit/reservations/create-core.test.ts` + manual 통합 |
| MT-06, ADR-060 | 입금 보존·원자적 확정 | 부족·부분·초과입금, 동시 확정/반환, 실패 전체 rollback | unit/integration | 기존 `phase20-finance.test.ts` + manual 금융 통합 |
| MT-06, ADR-007/034/039 | 환불 상한·합계 | 동시 환불·잔액 초과·노쇼 사유·중복 재시도 | unit/integration | 기존 `tests/unit/payments/core.test.ts` + manual |
| MT-06, ADR-040 | 매출 중복 없음 | 복수 환불·기간 경계·사전 반환 제외·다른 run 제외 | unit/integration | 기존 revenue 테스트 + `revenue-isolation.test.ts` |
| MT-07 | run-only cleanup | public·다른 run sentinel 불변, 실패 rollback, 재시도 | integration | `cleanup.test.ts` |
| MT-07 | 종료 경합 안전 | 제출/확정/환불 중 종료, 동시 cleanup, 만료 직후 요청 | integration | `close-races.test.ts` |
| MT-08, ADR-059 | E2E 독립 | cookie·서명·run 오용 거부, 기존 lease/cleanup 불변 | unit/integration | `e2e-isolation.test.ts` |
| MT-09/10 | 안전한 적용·복구 | 독립 history, Production payload 제외, ACL rollback rehearsal | static/integration | `migration-boundary.test.ts` |
| 사용자 실행 경계 | 일반 공개503 유지 | manual cookie·grant로 일반 공개 경로가 열리지 않음 | unit/후속 HTTP | `public-guard-regression.test.ts` |
| 개인정보 최소화 | 합성 데이터만 | 임의 이름/전화 입력 거부, token·PII 로그 없음 | unit/E2E | `synthetic-input.test.ts`, `privacy.test.ts` |

iPhone Safari 수동 수용 검증:

- QR/URL 열기와 cookie 자동 교환.
- header 입력 없이 제출·완료.
- 새로고침·뒤로가기·중복 탭에서 중복 결제 없음.
- 세션 만료·테스트 종료 후 접수 거부.
- 작은 화면·키보드·오류·복사 실패 대체 UI 확인.
- 다른 테스트·신청·public 데이터가 화면·RSC·에러에 나타나지 않음.

실제 iPhone·live Preview·DB 통합 검증은 현재 **NOT RUN**이다. DB 없는 합성 검증만으로 실제 ACL·pooler·503을 검증했다고 표시하지 않는다.

## Acceptance Criteria

- MT-01~10의 모든 항목에 대응 구현과 검증 근거가 있다.
- runtime의 arbitrary schema-qualified public 접근이 실제 DB 권한으로 거부된다.
- ADMIN bootstrap 이후 테스트 업무에서 기본 Prisma·public 고객 데이터 조회가 없다.
- run 밖의 업무 FK·조회·금액·cleanup 연결이 없다.
- iPhone에서 cookie 기반 전체 UX가 동작한다.
- 기존 환불·매출 의미와 E2E guard가 유지된다.
- 종료와 동시 업무 요청이 직렬화되고 cleanup 실패 후에도 인증은 닫힌다.
- migration·rollout·폐기 승인을 각각 구분해 기록한다.
- 현재 미실행 항목은 미실행으로 남긴다.

## Risks

1. **실효 PUBLIC 권한 미확인**: A안의 가장 중요한 적용 gate다. runtime만 REVOKE하는 방식은 불충분하다.
2. **ACL 변경의 공유 영향**: 기존 ADMIN·E2E 역할의 권한을 해치지 않는 검증과 복구가 필요하다.
3. **search_path와 pooling**: Prisma URL 설정만으로 세션 설정을 보장하지 않는다.
4. **기존 코어 결합**: 기본 Prisma·ADMIN·넓은 Prisma 타입을 제거하는 좁은 port 추출이 필요하다.
5. **503 위치 미확인**: 저장소의 접수 종료 UI를 HTTP503 증거로 취급하지 않는다.
6. **현재 작업 트리**: 기존 AI 서비스 변경과 이번 설계를 섞지 않는다. BUILD 시작 시 별도 feature/worktree checkpoint를 다시 확인한다.
7. **실측 미완료**: live 권한·pooler·Safari·배포 검증은 현재 금지되어 있다.

이는 B안 채택 사유나 현재 실행 허가가 아니다. 각 검증 전까지 A안을 비활성 상태로 유지할 조건이다.

## Implementation Order

1. **PLAN 승인 및 근거 정리**
   - 사용자 승인 범위와 A 선택을 확정 기록한다.
   - 필요 시 SPEC/ADR 보완을 해당 역할로 처리한다.
   - 검증: 요구사항·ADR·실행 경계 교차 검토.

2. **독립 schema/client 및 정적 경계**
   - developer가 별도 schema·생성 경로·runtime guard를 준비한다.
   - migration SQL은 DB-free 생성·검토만 한다.
   - 검증: schema validate/generate, dependency·SQL 정적 검사, focused unit.

3. **인증·run·unit-of-work**
   - bootstrap·독립 cookie·grant·TTL·run 잠금·receipt 구현.
   - 검증: 인증·CSRF·경합 합성 테스트, lint·typecheck.

4. **예약 코어 연결**
   - 최소 repository port·합성 클래스·신청·확정 구현.
   - 기존 wrapper 회귀 확인.
   - 검증: 예약·Phase20 focused unit, client import 경계.

5. **금융·매출·cleanup**
   - 기존 금액 규칙 재사용, transaction·run-only 정리 구현.
   - 검증: 금액 보존·환불·집계·cleanup rollback 합성 테스트.

6. **UI와 DB-free QA**
   - ADMIN 진입·테스트 layout·QR·iPhone 예약·종료 UI.
   - 검증: synthetic browser/unit, 개인정보·공개 guard 회귀.
   - independent QA와 Review를 수행한다.

7. **전체 로컬 품질 확인**
   - 적절한 unit·lint·typecheck.
   - build 전 `pgrep -f "next dev"` 등 포트와 무관한 dev 프로세스 확인.
   - dev가 있으면 build 생략, `tsc --noEmit` + lint + test로 대체하고 보고.
   - dev가 없고 환경이 안전하면 build. DB 접속·migration 없는지 확인한다.

8. **별도 승인된 DB preflight·통합 검증 준비**
   - 현재는 중단 지점이다.
   - DB read-only 접속·disposable DB 실행도 승인 범위를 확인한다.
   - ACL·pooler·migration·rollback 증거를 준비한다.

9. **Migration 실행 직전 명시 승인**
   - 위 승인 payload를 제출한다.
   - 승인된 exact SHA·SQL·대상·시간 안에서만 실행한다.
   - 변경·만료·preflight 실패 시 실행하지 않는다.

10. **별도 Preview 활성화·수용 검증**
    - 적용 후 role 부정 테스트·public 불변·iPhone 전체 흐름.
    - rollout/활성화도 구체적인 별도 승인 범위 안에서 수행한다.
    - Production 변경·PR merge는 이 PLAN 범위에 없다.

## References

기술적 확인은 공식 문서를 기준으로 하며, 아래 문서 열람은 DB 실행과 구분한다.

- [PostgreSQL Schemas](https://www.postgresql.org/docs/current/ddl-schemas.html): search_path·schema-qualified 접근·pg_catalog·public.
- [PostgreSQL Privileges](https://www.postgresql.org/docs/current/ddl-priv.html): PUBLIC 가산 권한·함수 EXECUTE·USAGE 주의사항.
- [Supabase Database Roles](https://supabase.com/docs/guides/database/postgres/roles): custom role.
- [Supabase Custom Schemas](https://supabase.com/docs/guides/api/using-custom-schemas): Data API 노출과 grant 구분.
- [Supabase Connecting to Postgres](https://supabase.com/docs/guides/database/connecting-to-postgres): 직접·session·transaction pooling.
- [Prisma v6 PostgreSQL](https://www.prisma.io/docs/orm/v6/overview/databases/postgresql): schema 연결 설정.
- [Prisma v6 PgBouncer](https://www.prisma.io/docs/orm/v6/prisma-client/setup-and-configuration/databases-connections/pgbouncer): pooler·직접 migration 연결.

## Changed

요청된 PLAN 문서 artifact만 생성했다. 애플리케이션 소스·설정·Prisma·테스트 코드는 수정하지 않았으며, DB 접속·변경, 배포 변경, stage·commit·push·merge 등 Git 변경 명령은 수행하지 않았다.

## Tests

문서·현재 코드·정책을 읽기 전용 검토했다. 문서 구조·요건 10개·테이블 29개·현재 소스 참조 18개에 대한 정적 확인은 PASS다. 저장 전후 기존 변경 파일 43개의 SHA256, HEAD 및 기존 tracked diff가 동일함을 확인했다. 추가 파일은 이 PLAN뿐이다. 공백 오류는 확인되지 않았다. unit·integration·E2E·live DB·iPhone 검증은 실행하지 않았다.

## Lint

미실행. PLAN 문서 작업이다.

## Build

미실행. PLAN 문서 작업이다.

## Risks

PUBLIC 실효 권한, 실제 pooler 동작, 공개 예약503 적용 위치는 미검증이다. 검증과 승인 전 활성화하지 않는다.

## Next

사용자는 A안의 이 PLAN 및 기술적 제안 범위를 검토한다. PLAN 승인 후 developer가 DB-free 준비를 수행한다. **실제 Preview Migration은 SQL·SHA·대상·ACL 영향·rollback 증거를 제시하고 실행 직전에 별도 승인을 요청한다.**
