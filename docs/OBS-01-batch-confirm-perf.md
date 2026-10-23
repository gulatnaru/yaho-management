> 2026-10-23 — Iteration 6A 정정 안내
> 아래 처리시간 수치(구간별 추정 및 N=2 합계 200–600ms)는 모두 **UNMEASURED 추정값**이며 실측 결과가 아니다.
> 현재 코드와의 주장·쿼리 수 대조 및 실제 PostgreSQL 측정 설계는 [OBS-01-PERF-SPEC.md](OBS-01-PERF-SPEC.md)를 따른다.
> 원 분석 본문은 이력으로 보존하며, 측정 구현은 흥영의 별도 승인 후 진행한다.

# OBS-01: 가족 신청 일괄확정 처리시간 분석

## 측정 대상
`confirmApplicationSubmissionCore` (server/reservation-applications/finance.ts:236)

## 쿼리 수 분석 (N개 신청 기준)

### 고정 쿼리 (신청 수 무관)
| 단계 | 쿼리 수 | 비고 |
|------|---------|------|
| Submission 잠금 | 1 | SELECT FOR UPDATE |
| Application 잠금 | 1 | SELECT ... FOR UPDATE |
| Application 조회 | 1 | findMany |
| Submission 조회 | 1 | findUnique |
| ClassSchedule 잠금 | 1 | SELECT ... FOR UPDATE |
| Child 잠금 (FOR SHARE) | 0-1 | 기존 아이가 있을 때만 |
| 반환 의무 조정 | 2-3 | reconcileReturnObligations |
| 원장 조회 | 2-3 | ledgerForSubmission |
| 중복 예약 검사 | 1-2 | findMany + count |

고정: 약 **10-14 쿼리**

### 신청당 쿼리 (N배)
| 단계 | 쿼리 수/신청 | 비고 |
|------|-------------|------|
| 자문 잠금 (신규 아이) | 0-1 | pg_advisory_xact_lock |
| 아이 중복 검사 | 0-1 | 신규 아이만 |
| 아이 생성 | 0-1 | 신규 아이만 |
| 아이 검증 | 0-1 | 기존 아이만 |
| 예약 생성 | 3-5 | createReservationInTransaction 내부 |
| 신청 상태 업데이트 | 1 | updateMany |
| 디바이스 조회 | 1 | **루프 안에서 매번 동일 쿼리** |
| 디바이스-아이 연결 | 0-1 | 디바이스가 있을 때만 |
| 동의 조회 | 2 | Promise.all로 병렬 |
| 동의 생성 | 1 | createMany |

신청당: 약 **8-12 쿼리**

### 결제/배분 (N배, 순차 실행)
| 단계 | 쿼리 수 | 비고 |
|------|---------|------|
| Payment 생성 | 1 | |
| PaymentItem 생성 | N | **순차 루프** |
| 매핑 생성 | N | **순차 루프** |
| FundAllocation 조회 | N | **순차 루프, N+1 패턴** |
| FundAllocation 생성 | 가변 | 배분 건수만큼 |

## 병목 지점

### 1. 디바이스 조회 중복 (높음)
```typescript
// 루프 안에서 매번 동일한 submissionId로 조회
const devices = await tx.deviceSubmission.findMany({ where: { submissionId: input.submissionId } });
```
**개선**: 루프 밖으로 이동, 1회만 조회

### 2. PaymentItem/매핑 순차 생성 (중간)
```typescript
for (let index = 0; index < applications.length; index += 1) {
  const item = await tx.paymentItem.create({...});
  const mapping = await tx.reservationApplicationPaymentMapping.create({...});
}
```
**개선**: `createMany`로 배치 처리 가능 (ID가 필요하면 `createManyAndReturn`)

### 3. FundAllocation N+1 (중간)
```typescript
for (const mapping of mappings) {
  const currentAllocations = await tx.fundAllocation.findMany({...}); // N번
  for (const allocation of allocateFifo(...)) {
    await tx.fundAllocation.create({...}); // 순차
  }
}
```
**개선**: allocations를 한 번에 조회 후 메모리에서 배분, `createMany`로 일괄 생성

### 4. 동의 조회 (낮음)
이미 `Promise.all`로 병렬 처리됨. 양호.

## 트랜잭션 안전성 (유지됨)

### 잠금 순서 (데드락 방지)
1. Submission (FOR UPDATE)
2. ReservationApplication (FOR UPDATE, id 순)
3. ClassSchedule (FOR UPDATE, id 순)
4. Child (FOR SHARE, id 순)
5. 신규 아이 identity (pg_advisory_xact_lock, 정렬된 키)

모든 잠금이 id 순으로 정렬되어 있어 데드락 위험이 낮음.

### 중복 방지
- `updateMany` with `status: "SUBMITTED"` 조건 + count 검증
- 아이 identity 중복 검사 (exact match 시 거부)
- Idempotency key (반환 처리)
- `skipDuplicates` (디바이스-아이 연결)

## 예상 처리시간 (N=2, 실측 필요)

| 구간 | 예상 |
|------|------|
| 잠금 + 검증 | 50-150ms |
| 신청당 처리 (×2) | 100-300ms |
| 결제/배분 | 50-150ms |
| **합계** | **200-600ms** |

Supabase + PgBouncer + Vercel 서버리스 환경에서는 네트워크 왕복이 지배적.
실제 측정은 Vercel 로그 또는 APM 필요.

## 권장사항 (우선순위)

1. **디바이스 조회 호이스팅** - 간단, 효과 확실
2. **PaymentItem/Mapping 배치 생성** - 중간 복잡도
3. **FundAllocation 배치 처리** - 로직 변경 주의 필요
4. **실측 계측 추가** - 각 단계별 timing 로그 (디버그 모드)

## 변경 금지 사항
- 잠금 순서 변경 금지 (데드락 위험)
- 트랜잭션 범위 축소 금지
- 중복 방지 로직 제거 금지
