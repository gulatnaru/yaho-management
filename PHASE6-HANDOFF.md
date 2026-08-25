# Phase 6 핸드오프 메모 (claude.ai 세션 → Claude Code)

이 세션(claude.ai)에서는 네트워크/빌드 환경이 없어 `$yaho-spec`(Analyst) → `$yaho-plan`(Architect)
설계 승인까지만 진행했습니다. `$yaho-build`부터는 Claude Code에서 이어서 진행하세요.

## 이 세션에서 이미 변경한 파일 (그대로 반영됨, 리포에 덮어쓰기만 하면 됨)
- `REQUIREMENTS.md` — 24장 정리 (출결 상세 범위 항목 제거, ClassSchedule.status 미결정 항목만 남김,
  보험 항목에 ADR-032 참고 추가, Phase 6 섹션에 ADR-031 내용 반영)
- `docs/DECISIONS.md` — ADR-031, ADR-032 추가

## 승인된 설계 요약 ($yaho-plan 산출물)

### 스키마 변경 (2건, `npx prisma migrate dev`로 진행 — 필드 자체가 바뀌므로 diff 정상 감지됨)
```prisma
model ChildConsent {
  ...
  recordedById String?
  recordedBy   User?  @relation("ConsentRecordedBy", fields: [recordedById], references: [id])
}

model Reservation {
  ...
  attendanceRecordedById String?
  attendanceRecordedAt   DateTime?
  attendanceRecordedBy   User? @relation("AttendanceRecordedBy", fields: [attendanceRecordedById], references: [id])
}

model User {
  ...
  consentRecords         ChildConsent[] @relation("ConsentRecordedBy")
  attendanceRecords      Reservation[]  @relation("AttendanceRecordedBy")
}
```

### 핵심 결정 (ADR-031, ADR-032 — docs/DECISIONS.md 참고)
- 출결 기록(참석/불참) 시 `Reservation.status`를 실제로 `COMPLETED`/`NO_SHOW`로 전환한다.
  `ClassSchedule.status`는 건드리지 않는다(ADR-026 유지).
- **정정 기능 포함**: 이미 `COMPLETED`/`NO_SHOW`인 예약도 반대 값으로 정정 가능.
  단 `RESERVED`로 되돌리는 것(출결 취소)은 이번 범위 아님.
- 최초 기록/정정 모두 조건부 `updateMany` (check-then-write, ARCHITECTURE.md §7.1 패턴)로 레이스 방지.
  - 최초: `updateMany({ where: { id, status: "RESERVED" }, data: {...} })`
  - 정정: `updateMany({ where: { id, status: { in: ["COMPLETED","NO_SHOW"] } }, data: {...} })`
- 클래스 보험 정보는 클래스 단위 컬럼 유지 + "직전 클래스 값 불러오기" 편의 기능 추가(ADR-032).
- 민감정보 보관기간/파기 정책은 이번 Phase에서 다루지 않음(REQUIREMENTS.md 24장 백로그 유지).

### ⚠️ 반드시 확인할 위험 요소
1. **`lib/reservations/status.ts::getReservationDisplayStatus`가 이번에 처음으로 실제
   `COMPLETED`/`NO_SHOW` DB 값을 받게 됩니다** (지금까지는 죽은 enum 값이었음 — ADR-026).
   이 함수를 수정한 뒤 기존 `tests/e2e/class-ended-lifecycle.spec.ts`가 여전히 통과하는지
   반드시 재확인하세요. 회귀 가능성이 가장 높은 지점입니다.
2. 클래스 상세에 안전정보(`ChildSafetyInfo`)를 join할 때 N+1 주의 —
   예약 목록 쿼리 1회에 `include: { child: { include: { safetyInfo: true } } }`로 묶을 것.
3. `ChildSafetyInfo`는 목록/검색 쿼리에 절대 select 되면 안 됨(ADR-006) — 회귀 테스트 필수.

### Implementation Order
1. Prisma: `ChildConsent.recordedById`, `Reservation.attendanceRecordedById/attendanceRecordedAt` 컬럼 + migration
2. `lib/children/safety-info` (queries/actions/Zod)
3. `lib/children/consent` (queries/actions/Zod)
4. 아이 상세 화면 placeholder 교체(`app/(admin)/children/[id]/page.tsx`) + 안전정보 수정 페이지
5. `lib/reservations/status.ts` 실제 COMPLETED/NO_SHOW 반영 + 기존 E2E 회귀 확인
6. `lib/reservations/attendance.ts`(최초 기록 + 정정) + 클래스 상세 출결/정정 버튼
7. 클래스 생성/수정 폼에 보험/안전메모 필드 + 불러오기 기능(`lib/classes/insurance-prefill.ts`)
8. 클래스 상세에 참여 아이 안전정보 카드
9. Vitest 단위/통합 테스트
10. Playwright E2E
11. `npm run lint` / `npm test` / `npm run build` 통과 확인 → `$yaho-qa`로 전달

## Claude Code에서 시작하는 방법
1. 이 zip을 실제 로컬 리포(`yaho-management`, git 연결된 폴더)에 덮어씁니다 —
   최소한 `REQUIREMENTS.md`, `docs/DECISIONS.md`, 이 `PHASE6-HANDOFF.md`만 복사해도 됩니다.
2. `feature/phase-6-safety-attendance` 같은 브랜치를 새로 만듭니다(AGENTS.md: main 직접 작업 금지).
3. Claude Code에게 "`$yaho-build`로 Phase 6 진행해줘, PHASE6-HANDOFF.md 참고해" 라고 지시하면
   위 승인된 설계 그대로 이어서 구현할 수 있습니다.
4. 이 메모 파일(`PHASE6-HANDOFF.md`)은 참고용이라 구현 완료 후 삭제해도 됩니다(리포의 정식 문서 아님).
