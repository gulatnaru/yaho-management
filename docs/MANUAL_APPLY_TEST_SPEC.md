# SPEC — 실제 예약 화면 기반 수동 테스트 (모바일 접근 문제 해결)

- 상태: SPEC (승인 후 PLAN 진행)
- 작성: 2026-10-19 (YAHO 오케스트레이터, yaho-spec 역할)
- Source of Truth 순서: 사용자 요청 > REQUIREMENTS.md > docs/DECISIONS.md > ARCHITECTURE.md > AGENTS.md > 기존 구현

## 1. 배경

YAHO 수동 테스트를 합성 프로그램(`/manual-test`)에서 실제 고객 예약 화면 기반으로 전환한다.
`/manual-test` 확장은 중단하고, 실제 예약 신청 화면(`/apply/group/[token]`)과 기존 관리자 기능을
그대로 사용해 아이폰 Safari에서 전체 업무 흐름을 검증한다.

## 2. 문제 정의 (핵심 과제 1)

현재 Preview(`VERCEL_ENV === "preview"`)에서 `/apply/group/[token]`을 아이폰 Safari로 열면
"현재 신청을 받지 않는 링크입니다."(`APPLICATION_CLOSED_MESSAGE`)가 표시된다.

원인 — `app/(public)/apply/group/[token]/page.tsx:35`:

```ts
const previewAllowed = process.env.VERCEL_ENV !== "preview"
  || await hasActivePhase20PreviewLease(prisma, {
       signed: parseAndVerifySignedPreviewRun((await headers()).get(PHASE20_PREVIEW_HEADER), process.env),
       syntheticRunId: link?.group?.syntheticRunId ?? null, now: new Date() });
```

`hasActivePhase20PreviewLease`(`lib/e2e/phase20-lease.ts`)는 다음을 모두 요구한다.

1. `x-yaho-phase20-preview-run` 요청 헤더에 실린 HMAC 서명 값
   (`PREVIEW_E2E_HANDSHAKE_SECRET` 서명, `runId.deploymentSha.issuedAt.signature` 형식,
   발급 후 24분 이내, `deploymentSha === VERCEL_GIT_COMMIT_SHA`)
2. `previewE2eRunLease` 테이블에 `runId`와 일치하는 유효한 lease 행
3. 자동화 러너 트랜잭션이 쥐고 있는 advisory lock(`PHASE20_PREVIEW_LOCK_KEY`)이 `pg_locks`에 존재
4. `syntheticRunId === runId` (그룹이 해당 E2E run 전용)

아이폰 Safari는 커스텀 요청 헤더를 보낼 수 없으므로 조건 1을 절대 만족할 수 없고,
결과적으로 `previewAllowed === false`가 되어 항상 닫힘 안내가 렌더된다.
동일한 게이트가 `actions.ts`(신청 제출), `apply/complete` 페이지/액션에도 적용되어
실제 고객 흐름을 수동으로 검증할 수 없다.

## 3. 목표

- G1. 관리자 승인 테스트 세션에 한해, Preview에서 실제 예약 신청 화면을 아이폰 Safari로
  열고 끝까지(신청→입금 안내→관리자 처리→결제/환불→매출) 검증할 수 있다.
- G2. 기존 자동화 E2E(Phase 20 lease 경로)와 보안 정책을 그대로 유지한다.
  - 익명(비로그인) 공개 접근은 Preview에서 계속 차단된다.
  - Production 동작은 전혀 바뀌지 않는다.
- G3. 실제 고객이 보는 화면과 테스트 화면의 UI·업무 처리 차이가 없다.
  단, 테스트 환경 표시는 명확히 유지한다(운영자 세션 렌더 시 "테스트 세션" 배너).
- G4. 테스트 데이터는 기존 식별 체계(`syntheticRunId`)로 정확히 식별·정리한다.
- G5. DB 마이그레이션 없음, 기존 ACL 변경 없음, 새 시크릿 없음, URL에 토큰 없음.

## 4. 비목표

- `/manual-test` 합성 프로그램의 추가 개발 (동결 유지, 코드는 보존)
- 새로운 예약 엔진, Mock 예약 API, 별도 테스트용 UI(독립 화면) 개발
- Companion 초대(`/apply/companion/[token]`) 플로우의 수동 테스트 (이번 범위 밖, lease 게이트 유지)
- Production에서의 공개 신청 동작 변경
- OpenAI/Kakao 실제 호출, 고객 개인정보 처리

## 5. 해결책 (설계 결정)

**운영자 세션 기반 수동 테스트 세션.**

Preview에서 `previewAllowed` 판정에 다음을 OR로 추가한다:

> 요청이 유효한 운영자(ADMIN 또는 MANAGER) 인증 세션을 가지고 있으면 허용한다.
> 세션은 기존 `auth()` + `resolveSessionPrincipal()`로 DB에서 live principal을 재확인하며,
> 어떤 경우에도 fail-closed(세션 없음·비활성·authVersion 불일치 → 거부)한다.

운영자 세션 허용은 관리자가 승인하여 `syntheticRunId`를 `manual-` + 22자
(`[A-Za-z0-9_-]`)로 마킹한 그룹에만 적용한다. 자동화 E2E의 `preview-*` 그룹,
일반 그룹(`syntheticRunId === null`), 형식이 잘못된 runId에는 적용하지 않는다.
동행 초대 경로(`/apply/companion/[token]` 및 `!token`인 공유 제출 액션, 즉 `undefined` 또는 빈 문자열)는
계속 lease 전용으로 유지한다. 이는 "관리자 승인 테스트 세션에 한해"라는 기존 설계 의도의 명확화다.

선택 근거:

- 아이폰 Safari는 헤더를 못 보내지만, 관리자는 같은 Safari에서 Preview 관리자 로그인을
  이미 한다(작업 흐름 1단계). 동일 오리진 쿠키로 세션이 전달되므로 추가 토큰·서명·URL
  파라미터가 필요 없다. URL에 토큰을 넣지 않으므로 로그·히스토리 유출 경로가 없다.
- 권한 상승이 없다: 운영자는 Preview 관리자에서 이미 클래스 생성·예약 확정·결제·환불 등
  모든 업무를 수행할 수 있다. 공개 신청 폼을 여는 것은 새 권한이 아니다.
- 기존 자동화 경로(헤더+lease+자문락)는 한 글자도 바뀌지 않는다. 익명 접근도 그대로 차단된다.
- DB 마이그레이션 불필요, 새 환경변수·시크릿 불필요.
- TEACHER는 제외한다: 예약 신청 접수 테스트는 운영 역할(ADMIN/MANAGER) 범위로 한정한다.
  (`lib/auth/roles.ts`의 `isOperationalRole`과 동일한 경계)

적용 지점 (4곳, companion 페이지는 제외):

1. `app/(public)/apply/group/[token]/page.tsx` — 페이지 렌더 게이트
2. `app/(public)/apply/group/[token]/actions.ts` — 신청 제출 게이트
3. `app/(public)/apply/complete/page.tsx` — 신청 완료·입금 안내 게이트
4. `app/(public)/apply/complete/completion-actions.ts` — `notifyApplicationDeposit` 게이트
   (입금 알림 기록; companion 초대 발급/취소는 기존 lease 게이트 유지)

테스트 세션 표시: 운영자 세션으로 렌더된 신청 화면에는 "테스트 세션" 배너를 표시한다
(lease 경로 렌더에는 표시하지 않아 자동화 E2E 어서션을 건드리지 않는다).

## 6. 테스트 데이터 식별 체계

- 수동 테스트용 그룹은 `ReservationApplicationGroup.syntheticRunId = "manual-" + 22자` 로 표시한다.
- Preview 페이지가 요구하는 `syntheticSettings`는 마킹 시점의 예약 신청 설정
  싱글톤(`getReservationApplicationSettings`)을 그대로 복사한다.
  → 페이지/액션의 기존 `reservationApplicationSettingsSchema.safeParse(...)` 코드 경로를
  자동화 E2E와 동일하게 사용한다 (분기 없음).
- 그룹 생성·링크 발급 자체는 기존 관리자 UI/서버 액션을 그대로 사용한다.
  마킹은 기존 `app/(admin)/reservation-applications` 그룹 상세 화면에 최소 버튼
  ("모바일 테스트 세션으로 지정", Preview 전용, ADMIN 전용(ADR-053)) 하나로 수행한다.
  이는 별도 테스트 UI가 아니라 기존 링크 발급 흐름의 보조 수단이다.
- 정리: `syntheticRunId` 기준으로 기존 `phase20-cleanup.ts`의 FK-safe 삭제 순서를 따른
  SQL 런북으로 수행한다 (VM→Supabase 직접 접속 차단이므로 부모 에이전트 경유로 흥영에게
  SQL 실행 요청). 실행 전·후 검증 쿼리로 기존 데이터 불변을 확인한다.

## 7. 기능 요구사항

- FR1. Preview + 운영자 세션(ADMIN/MANAGER) → `/apply/group/[token]` 정상 렌더
      (유효한 링크·활성 그룹·미래 SCHEDULED 클래스·가격>0 조건은 기존대로 적용)
- FR2. Preview + 운영자 세션 → 신청 폼 제출(`submitApplicationGroup`) 정상 접수,
      완료 쿠키 발급, `/apply/complete` 입금 안내 표시
- FR3. Preview + 익명 → 기존과 동일하게 "현재 신청을 받지 않는 링크입니다."
- FR4. Preview + 운영자 세션 → 완료 화면의 입금 알림(`notifyApplicationDeposit`) 동작
- FR5. Production → 동작 변경 없음 (공개 접수 기존대로, synthetic 그룹 제외 기존대로)
- FR6. 운영자 세션 렌더 시 "테스트 세션" 배너 표시 (신청 폼 상단)
- FR7. 마킹 액션: Preview 전용, ADMIN 전용(ADR-053), 이미 `syntheticRunId`가 있는 그룹 거부,
      설정 싱글톤 미비 시 안내 오류, `manual-` + 22자 runId 생성·표시.
      쓰기는 조건부 `updateMany({ where: { id, syntheticRunId: null }, ... })`로 수행해
      동시 요청 중 정확히 한 요청만 성공하고, 나머지는 기존
      "이미 테스트 세션으로 지정된 그룹입니다." 오류를 반환한다.
- FR8. 아이폰 Safari 실기 검증 13단계 (사용자 요청의 핵심 과제 2 목록) PASS

## 8. 보안 요구사항

- SR1. 어떤 예외·DB 오류에서도 거부 쪽으로 닫힌다 (fail-closed).
- SR2. `resolveSessionPrincipal`로 live DB 행을 확인한다 (JWT만 믿지 않는다).
- SR3. 새 시크릿·새 쿠키·URL 토큰을 도입하지 않는다.
- SR4. 자동화 E2E의 lease/advisory-lock 검증 로직을 변경하지 않는다.
- SR5. Production 분기(`VERCEL_ENV !== "preview"` short-circuit) 이전에
      운영자 세션을 확인하지 않는다 — Production에서는 세션 검사를 수행하지 않는다.
- SR6. 개인정보를 로그에 출력하지 않는다.

## 9. Open Questions

없음. (설계 대안으로 검토한 "서명된 URL 토큰" 방식은 URL 유출 경로와 추가 암호
프로토콜 때문에 기각하고, 운영자 세션 방식을 채택한다. 이유 §5.)

## 10. 완료 기준 (사용자 요청)

- 실제 고객 예약 UI를 아이폰 Safari에서 열 수 있음
- 실제 예약 신청·관리자 처리 E2E PASS
- Preview 기존 데이터 변경 없음
- Production 영향 없음
- 테스트 데이터 식별 및 Cleanup 검증
- QA·Review PASS
- 실제 아이폰에서 사용할 Preview URL 제공

## 11. manual_test 정리 계획 (코드 삭제는 이번 범위 밖)

새 테스트가 실제 UI에서 정상 동작함이 확인된 뒤, 별도 승인 하에 정리할 후보:

- `app/(public)/manual-test/`, `app/api/manual-test/`, `server/manual-test/`,
  `lib/manual-test/`(존재 시) 등 manual_test 전용 라우트·서버 모듈
- `MANUAL_TEST_*` 환경변수 (`MANUAL_TEST_ENABLED`, `MANUAL_TEST_MOCK_ORIGIN`,
  `MANUAL_TEST_DATABASE_URL`)
- `schema=manual_test` 격리 클라이언트 및 관련 Prisma 설정
- `~/workspace/yaho-ops/manual_test_*.py` 스크립트 자산
- `PreviewE2eRunLease`의 manual_test 관련 행 (DB 삭제는 별도 승인)
- PR #54 (Draft 유지 → 정리 시점에 close)

단, 본 SPEC 범위에서는 어떤 manual_test 코드도 삭제하지 않는다.
