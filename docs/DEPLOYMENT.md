# Phase 1 Deployment

Vercel 프로젝트는 GitHub 저장소와 연결한다. `main`은 Production, pull request는 Preview 배포를 사용한다.

## Region

- Vercel 함수(Serverless Function) 리전은 `syd1`(시드니)로 설정한다.
- Supabase DB가 시드니 리전에 있어, 함수를 같은 리전에 두면 함수-DB 간 요청마다 발생하는 네트워크 왕복(round trip)이 줄어든다. 실제로 이 설정 후 응답 속도가 눈에 띄게 빨라진 것을 확인했다.
- DB 리전을 나중에 서울로 옮기면 함수 리전도 반드시 함께 옮겨야 한다. 함수와 DB가 다른 리전에 있으면 모든 DB 요청이 리전 간 왕복을 거치게 되어 이 설정의 이점이 사라지고 오히려 지연이 늘어난다.

## Environment separation

- Production의 `DATABASE_URL`과 `DIRECT_URL`은 운영 Supabase DB를 사용한다.
- Preview의 `DATABASE_URL`과 `DIRECT_URL`은 운영 DB와 분리된 Preview 전용 Supabase 프로젝트 1개를 사용한다. 모든 PR의 Preview 배포가 이 프로젝트 하나를 공유하며, PR/브랜치별 DB Branching은 쓰지 않는다(ADR-030).
- `AUTH_SECRET`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`도 Vercel 환경별로 따로 등록한다.
- `.env`와 실제 값을 Git에 커밋하지 않는다.

## Environment variables

Vercel 프로젝트 설정의 Environment Variables에 아래를 Production/Preview 각각 등록한다. 값 자체는 Vercel 대시보드에만 존재하며 이 문서나 Git에 남기지 않는다.

| 변수 | Production | Preview |
|---|---|---|
| `DATABASE_URL` | 운영 Supabase 프로젝트 연결 문자열 | Preview 전용 Supabase 프로젝트 연결 문자열(ADR-030) |
| `DIRECT_URL` | 운영 Supabase 프로젝트 direct 연결 문자열 | Preview 전용 Supabase 프로젝트 direct 연결 문자열 |
| `AUTH_SECRET` | 운영 전용 값 | Preview 전용 값 — Production과 반드시 다른 값을 쓴다 |
| `NEXTAUTH_URL` | 비워 둔다 | 비워 둔다 |
| `ADMIN_EMAIL` | 운영 관리자 계정 | Preview 전용 관리자 계정 |
| `ADMIN_PASSWORD` | 운영 전용 값 | Preview 전용 값 |
| `RESERVATION_APPLICATION_BANK_NAME` | 입금 은행명 | 등록하지 않아도 된다 |
| `RESERVATION_APPLICATION_BANK_ACCOUNT_NUMBER` | 입금 계좌번호 | 등록하지 않아도 된다 |
| `RESERVATION_APPLICATION_BANK_ACCOUNT_HOLDER` | 예금주 | 등록하지 않아도 된다 |
| `YAHO_BLOG_URL` | YAHO 블로그 https URL | 등록하지 않아도 된다 |
| `YAHO_INSTAGRAM_URL` | YAHO Instagram https URL | 등록하지 않아도 된다 |
| `YAHO_KAKAO_CHANNEL_URL` | YAHO 카카오톡 채널 https URL | 등록하지 않아도 된다 |

## Manual Preview E2E (Phase 19)

Preview E2E is a developer-run command only. It does not run in GitHub Actions and it never starts a local Next.js server or local PostgreSQL.

The ordinary local `npm run test:e2e` route uses only `http://127.0.0.1:3000`; its configuration rejects a supplied `PLAYWRIGHT_BASE_URL` that is any remote, Preview, or Production origin before test specs load.

1. Push the branch and wait for the intended Vercel Preview deployment to become READY.
2. Set the runner environment values below from the approved Preview deployment and DB configuration, then run `npm run test:e2e:preview`.
3. If a guard fails, fix the target, deployment, migration state, or configuration and run it again. The command does not apply migrations.

The runner accepts only one exact HTTPS origin from `PREVIEW_E2E_ALLOWED_BASE_URLS`, requires a `.vercel.app` Preview URL, and always rejects `https://yaho-management.vercel.app`. Before any DB connection, it derives the Supabase project ref from both runner URLs and rejects the configured Production project ref. Before Playwright starts, it verifies the deployed app's opaque runtime DB fingerprint, both runner connections' runtime DB fingerprints, the requested deployment SHA, and the complete Prisma migration history. The fingerprint includes the approved project ref as well as `current_database()` and `current_user`; this prevents a `postgres`/`postgres` collision between Supabase projects. It also takes a PostgreSQL transaction advisory lock for the child process lifetime. Connection strings, raw database identity values, credentials, and bypass secrets are not printed.

| Location | Variable | Purpose |
|---|---|---|
| Preview deployment | `PREVIEW_E2E_HANDSHAKE_SECRET` | Authenticates the identity handshake endpoint; use a value kept only in Preview and the manual runner environment. |
| Preview deployment and runner | `PREVIEW_E2E_SUPABASE_PROJECT_REF` | Approved shared Preview Supabase project ref; the deployment and both runner URLs must resolve to it. |
| Preview deployment and runner | `PREVIEW_E2E_DB_RUNTIME_IDENTITY_SHA256` | Approved opaque fingerprint of the Preview project ref, `current_database()`, and `current_user`. |
| Manual runner | `PLAYWRIGHT_BASE_URL` | Exact READY Vercel Preview origin. |
| Manual runner | `PREVIEW_E2E_ALLOWED_BASE_URLS` | Comma-separated explicit origin allowlist containing the same Preview origin. |
| Manual runner | `PREVIEW_E2E_DEPLOYMENT_SHA` | Commit SHA reported by that Preview deployment. |
| Manual runner | `DATABASE_URL`, `DIRECT_URL` | Runner connections to the approved shared Preview DB; pooler and direct hosts may differ. |
| Manual runner | `PRODUCTION_E2E_SUPABASE_PROJECT_REF` | Production Supabase project ref, required so the runner rejects it before opening either DB connection. |
| Manual runner | `VERCEL_AUTOMATION_BYPASS_SECRET` | Vercel protection-bypass secret sent as `x-vercel-protection-bypass`; never put it in a URL. |
| Manual runner | `ADMIN_EMAIL`, `ADMIN_PASSWORD` | Dedicated Preview administrator credentials used by the Phase 11 flow. |

The Playwright configuration requires an ephemeral proof file made only by `npm run test:e2e:preview`, so a direct `PLAYWRIGHT_PREVIEW_E2E=1 playwright test` fails before specs load. Phase 11 writes only synthetic values containing its Preview run ID and per-test UUID. The wrapper repeats a FK-safe run-ID sweep before it releases the Preview DB advisory lock; cleanup failure reports the synthetic run ID and leaves other runs and existing Preview data untouched.

Generate `PREVIEW_E2E_DB_RUNTIME_IDENTITY_SHA256` for the approved Preview project only. Production denial happens before any database client exists: both runner URLs must parse to the approved Preview project ref and must differ from the required Production project ref. The existing Production release `PRODUCTION_DB_RUNTIME_IDENTITY_SHA256` remains exclusively for release tooling. The exact Preview fingerprint input is the UTF-8 bytes of `JSON.stringify({ projectRef, database, currentUser, currentSchema, prismaSchema })`: its field order is `projectRef`, `database`, `currentUser`, `currentSchema`, then `prismaSchema`, with JavaScript's ordinary compact JSON encoding. `prismaSchema` is the validated Prisma URL `schema` target and Phase 19 supports `public` only. After placing those values in protected process variables named `E2E_FINGERPRINT_PROJECT_REF`, `E2E_FINGERPRINT_DATABASE`, `E2E_FINGERPRINT_CURRENT_USER`, `E2E_FINGERPRINT_CURRENT_SCHEMA`, and `E2E_FINGERPRINT_PRISMA_SCHEMA`, run this command; it prints only the SHA-256 result:

```powershell
node -e 'const crypto=require("node:crypto"); const {E2E_FINGERPRINT_PROJECT_REF:projectRef,E2E_FINGERPRINT_DATABASE:database,E2E_FINGERPRINT_CURRENT_USER:currentUser,E2E_FINGERPRINT_CURRENT_SCHEMA:currentSchema,E2E_FINGERPRINT_PRISMA_SCHEMA:prismaSchema}=process.env; if(!projectRef||!database||!currentUser||!currentSchema||!prismaSchema) process.exit(1); process.stdout.write(crypto.createHash("sha256").update(JSON.stringify({projectRef,database,currentUser,currentSchema,prismaSchema}),"utf8").digest("hex")+"\n")'
```

Store only the resulting SHA-256 value in the Preview deployment and runner environment. Do not put the input values, connection strings, query output, handshake secret, or bypass secret in a shell history, ticket, repository file, or CI log. The runner requires the local repository `HEAD` to equal the deployment's full 40-character commit SHA and refuses any changed or untracked `prisma/migrations` path before it checks migrations.

| E2E spec | Preview classification | Verification route |
|---|---|---|
| `auth.spec.ts` | Preview-safe | `npm run test:e2e:preview` |
| `phase6-access.spec.ts` | Preview-safe | `npm run test:e2e:preview` |
| `phase11-core-operations.spec.ts` | Safe after modification: run/test markers plus test and wrapper cleanup | `npm run test:e2e:preview` |
| `class-ended-lifecycle.spec.ts` | Preview-forbidden in Phase 19: unscoped fixture lifecycle | `npm run test:e2e` against the dedicated local E2E DB |
| `dashboard.spec.ts` | Preview-forbidden in Phase 19: unscoped fixture lifecycle | `npm run test:e2e` against the dedicated local E2E DB |
| `payment-refund-lifecycle.spec.ts` | Preview-forbidden in Phase 19: payment/refund fixture lifecycle | `npm run test:e2e` against the dedicated local E2E DB |
| `phase12-class-reservation-operations.spec.ts` | Preview-forbidden in Phase 19: unscoped fixture lifecycle | `npm run test:e2e` against the dedicated local E2E DB |
| `phase13-child-history.spec.ts` | Preview-forbidden in Phase 19: unscoped fixture lifecycle | `npm run test:e2e` against the dedicated local E2E DB |
| `phase15-recurring-class-registration.spec.ts` | Preview-forbidden in Phase 19: unscoped fixture lifecycle | `npm run test:e2e` against the dedicated local E2E DB |
| `phase16-account-access.spec.ts` | Preview-forbidden in Phase 19: changes shared account state | `npm run test:e2e` against the dedicated local E2E DB |
| `phase18-reservation-application.spec.ts` | Preview-forbidden: public application intake is closed in Preview | `npm run test:e2e` against the dedicated local E2E DB |
| `phase18-retention-concurrency.spec.ts` | Preview-forbidden: retention can affect candidates outside its fixtures | `npm run test:e2e` against the dedicated local E2E DB |
| `revenue-report.spec.ts` | Preview-forbidden in Phase 19: unscoped payment fixture lifecycle | `npm run test:e2e` against the dedicated local E2E DB |

- 예약 신청(Phase 18, ADR-052) 설정값 6개는 하나라도 없거나 https가 아니면 공개 신청을 받지 않는다(fail closed). 값을 바꾸면 재배포한다.
- Preview(`VERCEL_ENV=preview`)는 공유 DB(ADR-030)이므로 설정과 무관하게 공개 신청을 받지 않는다.
- Production은 `lib/reservation-applications/consent-content.ts`의 동의 문구가 확정 원문(`isPlaceholder: false`)이고 `pendingDecisions`가 비어 있을 때만 공개 신청을 받는다. 2026-09-30-r3 기준 pendingDecisions 는 비어 있으므로 아래 환경변수 6개가 등록되면 Production 접수가 열린다.
- Phase 18 migration 다섯 개(`20260929073840_phase18_reservation_applications`, `20260929150958_phase18_application_consent_retention`, `20260929155124_phase18_refund_terms_acknowledgement`, `20260929162100_phase18_child_personal_data_purge`, `20260930043249_phase18_application_resolution_note_purge`)는 같은 release로 적용한다. 네 번째는 기존 `Child` 에 nullable 컬럼과 파기된 행에만 걸리는 CHECK 를 더하는 expand-only 변경이다. 다섯 번째는 `ReservationApplication` 의 status consistency CHECK 를 "파기된 반려·취소 신청은 사유 NULL" 로 다시 만든다(ADR-058). 이미 파기된 신청의 사유만 NULL 로 바꾸는 UPDATE 가 있으며 Production 에서는 대상 행이 없다. 두 번째·세 번째 migration은 `ReservationApplication`이 비어 있지 않으면 스스로 중단한다. 로컬·Preview DB에 Phase 18 테스트 신청이 있으면 그 테스트 데이터를 먼저 지운다(Production은 첫 migration 직후라 비어 있다).
- 개인정보 보관기간 정리: ADMIN이 주기적으로(예: 월 1회) `/reservation-applications/retention`에서 만료된 반려·취소 신청(수업일+1년), 만료된 확정 고객(Phase 18 예약 신청으로 CONFIRMED 된 이력이 있는 아이만, 마지막 예약 수업일+5년 — ADR-058), 먼저 처리가 필요한 대기 신청을 확인하고 파기한다. 관리자가 직접 등록했거나 기존 예약만 있는 고객은 대상이 아니다. 한 번에 신청 500건·고객 100명까지 처리하므로 "남은 대상" 안내가 나오면 다시 실행한다. 파기 중에는 대상 아이의 예약·동의·안전정보 저장이 잠시 기다릴 수 있다. 자동 배치는 없으므로 이 정리를 거르면 만료된 개인정보가 남는다(docs/DATABASE.md 참고).

- `AUTH_SECRET`은 Production과 Preview가 같은 값을 쓰지 않는다 — 한쪽이 유출돼도 다른 환경의 세션을 위조할 수 없어야 한다.
- `NEXTAUTH_URL`은 두 환경 모두 값을 채우지 않고 비워 둔다. Vercel은 요청 헤더로 배포 URL을 자동 감지하므로, 값을 채우면 오히려 PR마다 달라지는 Preview URL과 어긋나 인증이 깨질 수 있다.

## Build

- Vercel Build Command는 기본값(`next build`)을 그대로 쓴다. 별도로 `prisma generate`를 Build Command에 추가하지 않는다.
- 대신 `package.json`의 `postinstall`에서 `prisma generate`를 실행한다. Vercel은 빌드 간 `node_modules`를 캐시하는데, `postinstall`이 없으면 `schema.prisma`가 바뀌어도 Prisma Client가 재생성되지 않아 stale client로 배포될 위험이 있다. `postinstall`은 install 단계마다 실행되므로 이 위험을 없앤다.

## Migration policy

- Vercel의 Build Command에는 `prisma migrate deploy`를 넣지 않는다.
- Preview 배포에서는 migration을 자동 실행하지 않는다.
- Production migration은 GitHub `production` Environment 승인을 받은 PR gate에서만 `prisma migrate deploy`로 실행한다(ADR-051).
- Production에서는 `prisma db push`, `prisma migrate reset`, `prisma db seed`, 자동 rollback을 사용하지 않는다.
- Vercel 배포가 READY여도 migration post-status와 Production smoke가 끝나기 전에는 schema-changing release를 완료로 보지 않는다.

## Production schema release gate

Phase 17 이후 schema-changing PR에는 다음 순서를 적용한다.

1. `detect-schema-change`가 base/head diff의 `prisma/schema.prisma`와 `prisma/migrations/**`를 검사한다.
2. schema 변경이 없으면 Production DB에 연결하지 않고 `production-migrate`를 건너뛴 뒤 최종 `production-schema-gate`가 성공한다.
3. schema 변경이 있으면 신규 `migration.sql`이 함께 있어야 한다. 기존 migration 수정·삭제, migration 없는 schema 변경, 알 수 없는 migration payload는 fail closed한다.
4. `production-migrate`는 GitHub `production` Environment의 required reviewer 승인을 기다린다. 이 승인이 명시적인 Production migration 승인이다.
5. 승인 후에도 현재 PR head가 승인한 exact SHA인지 다시 확인한다. default branch의 trusted release tooling만 실행하고, PR에서는 exact head의 `prisma/schema.prisma`와 `prisma/migrations` payload만 가져온다.
6. preflight가 대상 identity, migration history, expected pending 목록, failed/incomplete migration과 명시적으로 지원되는 migration별 blocker를 확인한다.
7. preflight가 성공한 경우에만 `prisma migrate deploy`를 실행하고 즉시 post-status를 확인한다.
8. schema-changing PR은 `production-migrate`가 성공해야 최종 `production-schema-gate`가 성공한다. branch protection에는 최종 check 하나만 required check로 등록한다.
9. main merge 후 `production-release-verify`가 exact merge SHA의 현재 Vercel Production alias/deployment를 확인하고 migration status를 다시 읽는다. smoke 직전과 직후에도 같은 deployment ID·SHA·READY·Production target인지 재검증한 뒤 invalid-login smoke를 완료한다.

Migration은 application merge보다 먼저 적용되므로 모든 신규 migration은 기존 Production application과 함께 동작하는 backward-compatible expand 변경이어야 한다. 적용된 migration은 PR 중단이나 application rollback을 이유로 자동 rollback하지 않는다. 장애가 발생하면 호환 가능한 application rollback 또는 별도의 검토된 forward migration으로 복구한다.

## Production Environment configuration

Phase 17 자체는 schema 변경이 없으므로 이 workflow가 main에 들어오는 PR에서는 Production migration, GitHub Environment 변경, live smoke를 실행하지 않는다. merge 후 운영자가 다음 순서로 rollout한다.

1. workflow와 trusted release scripts가 main에 존재하는지 확인한다.
2. GitHub `production` Environment를 만들고 required reviewer를 설정한다. 단독 운영 환경에서는 `prevent self-review`를 필수로 요구하지 않는다.
3. 아래 secret과 variable을 Environment에 등록한다. 실제 값은 GitHub/Vercel 설정에만 두며 저장소나 로그에 남기지 않는다.
4. schema 변경이 없는 canary PR에서 `production-migrate`가 skip되고 `production-schema-gate`가 성공하며 Production DB 접속이 없음을 확인한다.
5. 그 다음 branch protection의 required check에 `production-schema-gate`를 추가한다.
6. 첫 schema-changing release 전에 detector와 preflight를 승인된 dry-run 절차로 확인한다.

| 종류 | 이름 | 목적 |
|---|---|---|
| Environment secret | `PRODUCTION_DIRECT_URL` | migration 전용 Production direct connection |
| Environment secret | `PRODUCTION_DB_IDENTITY_SHA256` | password와 query parameter를 제외한 정규화된 username/hostname/port/database identity의 승인 fingerprint |
| Environment secret | `PRODUCTION_DB_RUNTIME_IDENTITY_SHA256` | 연결 후 read-only로 확인한 `current_database()`/`current_user` runtime identity의 승인 fingerprint |
| Environment secret | `VERCEL_TOKEN` | exact Production deployment 조회 |
| Environment variable | `VERCEL_ORG_ID` | Vercel team 식별 |
| Environment variable | `VERCEL_PROJECT_ID` | Vercel project 식별 |
| Environment variable | `PRODUCTION_BASE_URL` | HTTPS Production login URL |

Migration workflow는 서로 다른 목적의 두 fingerprint를 독립적으로 확인한다. `PRODUCTION_DB_IDENTITY_SHA256`은 `PRODUCTION_DIRECT_URL`의 username/hostname/port/database를 정규화한 URL·tenant endpoint identity이며 password와 query parameter를 포함하지 않는다. `PRODUCTION_DB_RUNTIME_IDENTITY_SHA256`은 연결 후 read-only `current_database()`와 `current_user`로 계산한 PostgreSQL database/role runtime identity다. tenant-qualified pooler username과 upstream `current_user`를 직접 비교하지 않으며 두 fingerprint가 모두 승인값과 일치해야 migration을 실행한다. URL, host identity, username, database/role raw value, canonical identity, password와 connection string은 출력하지 않는다. Vercel runtime DB secret은 workflow에서 읽거나 GitHub secret과 직접 비교하지 않는다. 대신 merge 후 invalid-login smoke가 실제 Vercel runtime의 credentials query와 DB schema 호환성을 검증한다.

## Production post-deploy smoke

Smoke는 별도 계정이나 business fixture를 만들지 않는다. authoritative alias API로 확인한 동일 deployment ID와 exact merge SHA가 smoke 직전과 직후에도 현재 Production인지 검증하면서, `schema-smoke@release.example.invalid`처럼 존재할 수 없는 reserved-domain 이메일로 `/login`을 제출하고 다음을 확인한다.

- `/login` GET과 submit 중 HTTP 5xx가 없다.
- 기존의 일반 credential 실패 메시지가 표시된다.
- dashboard에 인증되지 않는다.
- Prisma, callback 또는 database infrastructure 오류가 응답에 나타나지 않는다.

이 흐름은 User lookup, dummy bcrypt 경로와 Vercel runtime DB 연결을 통과하지만 User·Teacher·업무 데이터를 쓰지 않는다. cookie, token, 입력 credential, 응답 HTML 전체는 로그에 출력하지 않는다. post-status나 smoke가 실패하면 Vercel 상태와 무관하게 release는 incomplete다.
