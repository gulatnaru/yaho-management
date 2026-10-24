# PLAN — 실제 예약 화면 기반 수동 테스트

- 상태: PLAN (SPEC `docs/MANUAL_APPLY_TEST_SPEC.md` 승인 전제)
- 작성: 2026-10-19 (YAHO 오케스트레이터, yaho-plan 역할)
- 브랜치: `feature/phase21-ai-service` (HEAD 2df278d), PR #53/#54 Draft 유지

## 1. 변경 개요

신규 모듈 2개 + 기존 파일 6곳 수정. 전부 additive하며, 자동화 E2E(lease 경로)와
Production 동작은 바이트 단위로 동일하게 유지한다.

## 2. 파일별 변경 명세

### 2.1 신규: `lib/e2e/preview-manual-session.ts`

```ts
import { getOptionalOperationalPrincipal } from "@/lib/auth/authorization";

export type PreviewApplyAccess = { allowed: boolean; operatorSession: boolean };

export const MANUAL_TEST_RUN_ID_PATTERN = /^manual-[A-Za-z0-9_-]{22}$/;

export function isManualTestRunId(value: unknown): value is string {
  return typeof value === "string" && MANUAL_TEST_RUN_ID_PATTERN.test(value);
}

/** Preview에서만 동작. live 운영자 세션(ADMIN/MANAGER)을 확인한다. */
export async function hasOperatorPreviewTestSession(): Promise<boolean> {
  if (process.env.VERCEL_ENV !== "preview") return false;
  try {
    return (await getOptionalOperationalPrincipal()) !== null;
  } catch {
    return false; // fail-closed
  }
}

/**
 * 공개 신청 화면의 Preview 접근 판정을 한 곳에 모은다.
 * - production: 항상 허용(기존 동작)
 * - preview + lease: 허용, operatorSession=false (자동화 E2E와 렌더 동일)
 * - preview + 유효한 manual- runId + 운영자 세션: 허용, operatorSession=true (테스트 배너 표시)
 * - 그 외: 거부
 */
export async function resolvePreviewApplyAccess(
  hasLease: boolean,
  syntheticRunId: string | null,
): Promise<PreviewApplyAccess> {
  if (process.env.VERCEL_ENV !== "preview") return { allowed: true, operatorSession: false };
  if (hasLease) return { allowed: true, operatorSession: false };
  if (!isManualTestRunId(syntheticRunId)) return { allowed: false, operatorSession: false };
  const operator = await hasOperatorPreviewTestSession();
  return { allowed: operator, operatorSession: operator };
}
```

운영자 세션은 관리자가 승인해 `manual-` + 22자(`[A-Za-z0-9_-]`)로 마킹한 그룹에만
허용한다. 자동화 E2E의 `preview-*` 그룹, 일반 그룹(`null`), 형식이 잘못된 runId는
세션 조회 전에 거부하여 자동화 데이터 오염과 일반 그룹의 입금 알림 실행을 막는다.
lease가 있으면 runId 형식이나 운영자 세션을 확인하지 않고 기존 lease 경로를 유지한다.

### 2.2 수정: `lib/auth/authorization.ts` (additive export)

```ts
/**
 * Public 라우트용 non-throwing 변형. 운영 역할(ADMIN/MANAGER)의 live principal이
 * 있을 때만 반환하고, 그 외(비로그인·TEACHER·비밀번호 변경 필요·오류)는 null.
 * Fail-closed.
 */
export async function getOptionalOperationalPrincipal(): Promise<
  AdminPrincipal | Extract<CurrentPrincipal, { role: "MANAGER" }> | null
> {
  try {
    const principal = await getRequestPrincipal();
    if (!principal || principal.mustChangePassword) return null;
    if (principal.role === "TEACHER") return null;
    return principal;
  } catch {
    return null;
  }
}
```

기존 `require*` 함수들은 손대지 않는다.

### 2.3 수정: `app/(public)/apply/group/[token]/page.tsx`

```ts
const leaseAllowed = process.env.VERCEL_ENV === "preview"
  ? await hasActivePhase20PreviewLease(prisma, { signed: parseAndVerifySignedPreviewRun((await headers()).get(PHASE20_PREVIEW_HEADER), process.env), syntheticRunId: link?.group?.syntheticRunId ?? null, now: new Date() })
  : true; // production은 기존 short-circuit과 동일
const access = await resolvePreviewApplyAccess(leaseAllowed, link?.group?.syntheticRunId ?? null);
...
if (!access.allowed || !settingsReady || !isConsentContentReady(process.env.VERCEL_ENV) || classes.length === 0) return <ApplicationClosedNotice />;
return <section ...>{access.operatorSession ? <TestSessionBanner /> : null}<div>...</div><GroupApplicationForm ... /></section>;
```

주의: 기존 한 줄 `previewAllowed`를 풀어쓰되, production에서는 `hasActivePhase20PreviewLease`
자체를 호출하지 않는다(기존 `||` short-circuit 의미 보존, SR5).

### 2.4 수정: `app/(public)/apply/group/[token]/actions.ts`

```ts
if (process.env.VERCEL_ENV === "preview") {
  const requestHeaders = await headers();
  const signed = parseAndVerifySignedPreviewRun(requestHeaders.get(PHASE20_PREVIEW_HEADER), process.env);
  const leaseAllowed = await hasActivePhase20PreviewLease(prisma, { signed, syntheticRunId: scoped?.group?.syntheticRunId ?? null, now: new Date() });
  const access = await resolvePreviewApplyAccess(leaseAllowed, scoped?.group?.syntheticRunId ?? null);
  // 동행 경로는 token이 falsy일 때 선택된다(undefined 또는 직접 호출의 빈 문자열).
  // 이 경로는 lease 전용이며, 운영자 허용은 비어 있지 않은 그룹 링크 토큰에만 적용한다.
  if (!access.allowed || (access.operatorSession && !token)) return { error: "현재 신청을 받을 수 없습니다." };
}
```

### 2.5 신규: `app/(public)/apply/group/[token]/test-session-banner.tsx`

서버 컴포넌트. 문구: "테스트 세션 — 관리자 테스트 화면입니다. 실제 고객에게는 노출되지 않습니다."
`data-testid="preview-test-session-banner"` 부여 (QA/향후 E2E 식별용).

### 2.6 수정: `app/(public)/apply/complete/page.tsx`

`previewAllowed` 계산을 2.3과 동일한 패턴으로 교체하고,
`access.operatorSession`일 때 배너를 렌더한다.

```ts
const access = await resolvePreviewApplyAccess(leaseAllowed, completion?.syntheticRunId ?? null);
```

### 2.7 수정: `app/(public)/apply/complete/completion-actions.ts`

`completionPreviewAllowed(syntheticRunId)` → `completionPreviewAllowed(syntheticRunId, options?: { allowOperatorSession?: boolean })`.
내부:

```ts
if (process.env.VERCEL_ENV !== "preview") return true; // 기존 동작 (production synthetic 제외 유지)
const leaseAllowed = await hasActivePhase20PreviewLease(...);
const access = await resolvePreviewApplyAccess(leaseAllowed, syntheticRunId);
return access.allowed && (access.operatorSession ? (options?.allowOperatorSession === true) : true);
```

- `notifyApplicationDeposit`: `{ allowOperatorSession: true }` 전달
- `createCompanionInvitation` / `revokeCompanionInvitation`: 기존 호출 그대로 (lease 전용 유지)

기존 production 분기(`process.env.VERCEL_ENV === "production" && syntheticRunId → false`)는 그대로 둔다.

### 2.8 수정: `app/(admin)/reservation-applications/actions.ts` (additive)

ADR-053에 따라 예약 신청 관리 액션 전체와 그룹 상세 페이지는 ADMIN 전용이다.
수동 테스트 그룹 지정도 `requireAdminPrincipal()`로 보호해 MANAGER/TEACHER의 직접 호출을
DB 접근 전에 차단한다. 공개 신청 화면의 Preview 운영자 세션 허용과는 별개의 관리 권한이다.

```ts
export async function markGroupManualTestSession(groupId: string): Promise<{ error?: string; runId?: string }> {
  const principal = await requireAdminPrincipal();
  if (process.env.VERCEL_ENV !== "preview") return { error: "Preview 환경에서만 사용할 수 있습니다." };
  const parsed = z.string().trim().min(1).safeParse(groupId);
  if (!parsed.success) return { error: "잘못된 요청입니다." };
  const group = await prisma.reservationApplicationGroup.findUnique({ where: { id: parsed.data }, select: { id: true, syntheticRunId: true, isActive: true } });
  if (!group) return { error: "그룹을 찾을 수 없습니다." };
  if (group.syntheticRunId) return { error: "이미 테스트 세션으로 지정된 그룹입니다." };
  const settings = await getReservationApplicationSettings(prisma);
  const checked = reservationApplicationSettingsSchema.safeParse(settings);
  if (!checked.success || !isReservationApplicationSettingsReady(settings)) return { error: "예약 신청 설정을 먼저 완료해주세요." };
  const runId = `manual-${randomChars(22)}`; // [A-Za-z0-9_-]
  const updated = await prisma.reservationApplicationGroup.updateMany({
    where: { id: group.id, syntheticRunId: null },
    data: { syntheticRunId: runId, syntheticSettings: checked.data },
  });
  if (updated.count !== 1) return { error: "이미 테스트 세션으로 지정된 그룹입니다." };
  return { runId };
}
```

기존 사전 검사는 유지한다. 쓰기는 `syntheticRunId: null` 조건을 포함한 원자적
`updateMany`로 수행해 동시 요청에서도 한 요청만 성공하고, 나머지는 기존 지정 오류를 반환한다.

`randomChars`는 `node:crypto` `randomBytes` 기반. `actorUserId`는 principal.userId를
감사(audit) 목적 로그에 남기지 않는다(개인정보 로그 금지) — 성공/실패만 boolean으로.

### 2.9 수정: `app/(admin)/reservation-applications/groups/[id]/page.tsx` (additive)

"모바일 테스트 세션" 섹션 추가 — `process.env.VERCEL_ENV === "preview"`일 때만 렌더.
버튼 폼 → `markGroupManualTestSession` 호출 → 반환된 runId 표시.
(BUILD가 페이지 구조를 확인해 기존 UI 패턴에 맞게 배치한다.)

## 3. 테스트 계획 (BUILD가 작성)

- `tests/unit/e2e/preview-manual-session.test.ts`
  - production + ADMIN 세션 → `{ allowed: true, operatorSession: false }`, principal 조회 시도 없음
  - preview + lease + 일반 그룹(`null`) → `{ allowed: true, operatorSession: false }`, 세션 조회 없음
  - preview + 유효한 manual- runId + ADMIN/MANAGER 세션 → `{ allowed: true, operatorSession: true }`
  - preview + ADMIN 세션 + `preview-*`/`null`/길이가 잘못된 manual- runId → 거부, 세션 조회 없음
  - preview + 유효한 manual- runId + TEACHER/비로그인 → `{ allowed: false, operatorSession: false }`
  - principal 조회 throw → `{ allowed: false, ... }` (fail-closed)
  - companion + MANAGER 세션 + 유효한 manual- 그룹 + lease 없음 → 신청 거부, `submitApplicationGroupCore` 호출 없음
    (`token`이 `undefined`인 정상 동행 경로와 `""`인 직접 액션 호출을 모두 검증)
- `tests/unit/reservation-applications/admin-manual-session-action.test.ts`
  - non-preview → error, DB 쓰기 없음
  - syntheticRunId 기존 → error
  - 설정 미비 → error
  - 성공 → `syntheticRunId`가 `manual-[A-Za-z0-9_-]{22}`, `syntheticSettings`가 설정 복사
  - `updateMany` 조건은 `{ id: "group-1", syntheticRunId: null }`, count=0이면 기존 지정 오류
  - 동시 마킹 요청은 한 요청만 성공하고 다른 요청은 기존 지정 오류 반환
- 기존 테스트 전부 통과 (특히 `tests/unit/reservation-applications/admin-actions.test.ts`)
- `npm run lint`, `npx tsc --noEmit`, `npm run build` (dev 서버 확인 후)

## 4. QA/REVIEW 관점

- QA: 위 테스트 + 변경 파일 diff 전수 확인, 자동화 E2E 경로 불변 확인
  (lease=true일 때 렌더·동작이 기존과 동일하고 배너가 없는지)
- REVIEW: SR1~SR6 (§SPEC) 체크리스트 기반 보안 리뷰. 특히
  - `resolvePreviewApplyAccess`의 production short-circuit 순서
  - `getOptionalOperationalPrincipal`의 fail-closed
  - admin 액션의 Preview 전용 가드와 입력 검증
  - companion 경로가 lease 전용으로 남았는지

## 5. Preview E2E 계획

### 5.1 배포

1. BUILD 커밋 후 `git push origin feature/phase21-ai-service` (force 금지)
2. Vercel 자동 Preview 배포 확인 — 브랜치 Preview URL (패턴:
   `https://yaho-management-git-feature-phase21-ai-service-*.vercel.app`,
   정확한 URL은 배포 후 부모 에이전트가 확인)
3. ai-service 미커밋 변경이 건드려지지 않았는지 `git status`로 재확인

### 5.2 자동 검증 (VM → Preview, 브라우저 불필요)

- 익명 `curl`로 (무효 토큰) `/apply/group/xxx` → "현재 신청을 받지 않는 링크입니다." 포함 확인
- 그룹·링크 생성 후 익명 GET → 동일하게 닫힘 안내 (lease 게이트 유지 증거)

### 5.3 아이폰 Safari 수동 E2E 런북 (흥영 실행, 13단계)

사전 준비 (Preview 관리자, 아이폰 Safari):
1. `<preview>/login` 관리자 로그인
2. 클래스 관리에서 TEST 클래스 생성 (이름에 `[TEST]` 포함, 미래 일시, SCHEDULED, 신청가>0)
3. 예약 신청 관리에서 그룹 생성 → 클래스 선택 → 신청 링크 발급
4. 그룹 상세에서 "모바일 테스트 세션으로 지정" → runId 기록 (예: `manual-Ab3...`)
5. 발급된 `/apply/group/[token]` 링크를 같은 Safari에서 열기 → **신청 폼 + 테스트 배너** 확인
6. 보호자 정보 입력 (가상): 이름 `김테스트`, 연락처 `010-0000-0000`, 관계 `모`, 입금자명 `김테스트`
7. 아이 2명 입력 (가상): `이테스트1`(2023-01-15, 여), `이테스트2`(2024-06-20, 남) + 클래스 선택 (다자녀: "아이 추가")
8. 필수 약관 전체 동의 (선택 약관 1개만 동의해서 선택 동작도 확인)
9. 신청 제출 → "신청이 접수되었습니다" + 입금 안내(계좌번호·예금주) 확인
10. 관리자에서 신청 조회 → 입금 확인 → 예약 확정
11. 결제 등록 후 부분 환불 처리
12. 매출 집계에서 해당 내역 확인
13. 정리: 아래 §5.4

### 5.4 테스트 데이터 정리 (SQL 런북, 부모 경유 흥영 실행)

- 식별자: `ReservationApplicationGroup.syntheticRunId = '<runId>'`
- 삭제 순서 (`lib/e2e/phase20-cleanup.ts`의 FK-safe 순서와 동일):
  1. 하위 매핑/원장: `ReservationApplicationGroupClass` → `ReservationApplicationLink`
     → `ApplicationDeposit` → `FundAllocation` → `ReturnObligation` → `ApplicationReturn`
     → `ReservationApplicationPaymentMapping` → `PaymentItem` → `Payment` → `Refund`
     → `DeviceSubmission` → `DeviceChild` → `ApplicationDevice`
  2. `ReservationApplication` → `ReservationApplicationSubmission`
  3. `CompanionInvite` 계열 (사용했다면)
  4. `ChildConsent` → `ChildSafetyInfo` → `Relationship` → `Reservation` → `Child`
     (단, Child/Reservation 중 기존 실데이터와 연결된 행이 있으면 중단 — 카운트 검증)
  5. `ReservationApplicationGroup`
- 검증 쿼리: 정리 전후 `SELECT count(*) ... WHERE syntheticRunId = '<runId>'` = 0,
  전체 테이블 행 수 스냅샷 비교로 기존 데이터 불변 확인.
- 정확한 SQL은 BUILD 완료 후 `phase20-cleanup.ts`를 대조해 런북에 확정한다.

## 6. manual_test 정리 계획

SPEC §11과 동일. 이번 PLAN 범위에서는 삭제하지 않는다.

## 7. 리스크

- R1. Playwright 자동화 E2E를 VM에서 실행할 수 없어(직접 DB 접속 차단),
  lease 경로 불변은 코드 리뷰 + 단위 테스트로만 검증한다.
- R2. 아이폰 실기 13단계는 흥영의 실행이 필요 — 본 작업자는 런북·URL·사전 검증을 제공한다.
- R3. 그룹 상세 페이지에 섹션을 추가하면 Phase 11 E2E 어서션에 영향을 줄 수 있다 —
  Preview 전용 렌더 + 기존 테스트 확인으로 완화.
- R4. `auth()`가 public 라우트에서 세션을 읽지 못하는 엣지 (쿠키 설정 변경 등) —
  실기 5단계에서 즉시 드러나며, 실패 시 롤백(해당 커밋 revert) 후 대안(서명 URL) 검토.
