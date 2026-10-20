# Phase 2 integration execution status

Final verification follow-up to `e61aa87`; local audit on 2026-10-20. **The PostgreSQL/browser release gate remains BLOCKED.** No Preview, Production, or Supabase database was accessed. No database was created, connected to, seeded, or migrated during this audit. No schema/migration file was changed.

The current PostgreSQL execution plan is the [GitHub Actions service-container workflow](../.github/workflows/phase2-integration.yml), replacing the local/Windows provisioning plan. Its initial CI run failed during migration bootstrap, before integration tests ran: all 12 PostgreSQL cases remain **UNEXECUTED / BLOCKED** pending a successful CI run. Historical local audit results and provisioning failures below explain the switch; they are not CI results.

| Verification | Execution status | Evidence / limitation |
|---|---|---|
| Legacy reissue code + unit flow | **PASS — code/unit only** | Six new unit cases cover success, recovered copy/share handlers, old-token refusal, lost response/read failure, possible committed error, no-commit reload, and upgrade guidance. DB/browser behavior remains unverified. |
| Advisory lock on actual PostgreSQL 16 | **UNEXECUTED / BLOCKED** | Installed Prisma client is **6.19.3**. `issueClassLinkOperationCore()` still uses transactional `$executeRaw` with `SELECT pg_advisory_xact_lock(...)`. No actual PostgreSQL call succeeded or failed; no speculative SQL change or lock-order change was made. |
| Original dedicated PostgreSQL suite | **UNEXECUTED / BLOCKED**, all **8** original `it()` cases | CI migration bootstrap failed before tests ran; awaiting a successful PostgreSQL 16 service-container run after the role shim. Prior local provisioning was blocked. Unit mocks cannot prove transactions or locks. |
| Follow-up PostgreSQL cases | **UNEXECUTED / BLOCKED**, 4 additional cases (12 total) | Full-edit/inline price race and stale intentional rollback; two-client price CAS; concurrent legacy reissue/lost response; frozen stop retry after resume. |
| Browser E2E (Playwright) | **NOT EXECUTED / BLOCKED** | No dedicated local test DB/application fixture runtime; IPv4/IPv6 sockets are denied and configured Chromium/WebKit executables are absent. Component interaction units are not browser E2E. |
| Real Safari | **NOT EXECUTED** | No real Safari/macOS runner available. Playwright WebKit, even if run, would be reported separately from actual Safari. |

Local verification actually executed for this follow-up:

| Check | Final result |
|---|---|
| Full `npm test` | **PASS**, exit 0; **185 files / 2,187 tests** (six new cases, two new files) |
| `npx tsc --noEmit` | **PASS**, exit 0 |
| `npm run lint` | **PASS**, exit 0; one pre-existing unused `_body` warning in `tests/unit/ai-service/selection-safety.test.ts:40` |
| `npm run build` | **PASS**, exit 0; Next.js 15.5.23, 19 static pages generated; `pgrep -af '[n]ext dev'` found no local dev server immediately before build |
| Independent QA / code review | **PASS — scoped code/unit review only**; no blocking code findings, no database/browser PASS |

These executed local checks do not change any PostgreSQL, Playwright, or Safari status above. No new features, Phase 3–8 work, source schema/migration changes, remote DB access, or PR merge were performed.

Git delivery limitation: the primary workspace's `.git` is read-only; staging failed when creating `.git/index.lock` (`Read-only file system`). The requested fix commit is preserved in a separate offline local clone and Git bundle under `/tmp`, without changing the primary workspace's `e61aa87` HEAD or accessing any remote. The primary workspace retains the reviewed source changes for handoff.

## Legacy address recovery contract

`issueApplicationLink()` intentionally returns no raw URL or token. Reissue replaces the token on the existing legacy row; `getClassApplicationLinks()` reads that stored active token and projects its `/apply/...` address for the ADMIN class detail. Public lookup of the previous token must be closed. This legacy compatibility behavior differs from modern hash-only links, whose original address cannot be recovered after reload.

The scoped fix gives explicit class-detail recovery guidance after reissue success, a lost response, or a failed link read. The pre-operation address is hidden while its snapshot is untrusted, including an action error that could follow a committed write and failed revalidation. Explicit recovery reloads the document: remount queries the database again, so it can recover either the new address after commit or the still-valid previous address when the request never committed. A transport retry retains the initial revision and cannot silently rotate a committed reissue again. Modern hash-only address guidance and storage policy are unchanged.

Verification evidence is in `tests/unit/reservation-applications/legacy-link-recovery.test.ts`, `tests/unit/reservation-applications/legacy-link-card-interactions.test.ts`, and `tests/unit/reservation-applications/admin-actions.test.ts`. The core/query/public test uses a mutable synthetic in-memory database adapter: it discards the successful result, injects a failed detail read, retries the detail query, checks the new stored address and old-token rejection, and verifies that a frozen retry does not rotate again. Component-handler units drive state explicitly and call the actual copy/share handlers with mocked browser APIs. They do not run React in a browser or verify a real database; actual browser clipboard/share APIs remain unverified until browser E2E runs. The upgrade-response-loss case specifically rejects any promise to recover modern hash-only plaintext from class detail.

The eight original cases cover atomic issue/metadata retry, rollback after mid-transaction failure, Operation-ID payload conflict, concurrent identical retry, independent stale-admin race, stale price/application/payment preservation, replace/stop race, and historical quotes through issue/replace/membership/stop. These are test definitions, **not PASS results**.

## Actual local PostgreSQL 16 provisioning attempts

All package/cache paths for these attempts were under `/tmp`; the project dependency manifest and lockfile were not changed.

1. `postgres`, `initdb`, `pg_ctl`, `psql`, `docker`, and `podman` were absent from PATH. No PostgreSQL server/initdb binary or cached PG16 package was found in `/usr`, `/opt`, `/home/hatch/.cache`, or `/tmp`.
2. `apt-get update` with lists/cache redirected to `/tmp/yaho-phase2-apt` exited **100**: its default `_apt` privilege switch failed (`setgroups`, `setegid`, `seteuid`: `Operation not permitted` / `Invalid argument`). Retrying with `APT::Sandbox::User=root` (the existing process identity) exited **100** because repository access could not create IPv4/IPv6 sockets (`socket (1: Operation not permitted)`). `apt-get --download-only --no-install-recommends -y install postgresql-16` using the same temporary directories exited **100**, `Unable to locate package postgresql-16`, since no package lists/package were available. No system package was installed.
3. `npm install --prefix /tmp/yaho-phase2-embedded --cache /tmp/yaho-phase2-npm-cache --ignore-scripts --no-audit --no-fund --fetch-retries=0 --fetch-timeout=15000 embedded-postgres` exited **1**: fetching the registry package failed with **EPERM**. Its install scripts never ran. A separate registry connectivity probe also failed to connect to the configured egress proxy.
4. A direct Python socket probe failed at `socket.socket(AF_INET, SOCK_STREAM)` and `socket.socket(AF_INET6, SOCK_STREAM)` with **PermissionError / errno 1 / Operation not permitted**, before binding. AF_UNIX socket creation succeeded, but it cannot provide the required guarded `127.0.0.1:55432` test endpoint. Downloading another binary would not resolve the denied IPv4 socket prerequisite.

Therefore no local PG16 server could be provisioned or started, no `prisma migrate deploy`/`db push` was run, and **zero of the 12 PostgreSQL cases executed**. The advisory-lock call is **unverified**, not an observed SQL failure. The integration runner was not started against an absent or substitute database.

The local provisioning plan is superseded by the GitHub-hosted Ubuntu service-container approach below. Browser verification remains separate and additionally needs the configured browser binaries plus an app and synthetic authenticated fixtures. Real Safari requires a macOS/Safari runner.

| PostgreSQL integration case | Final execution status |
|---|---|
| 1. Atomic group/membership/hash issuance and metadata-only retry | **UNEXECUTED / BLOCKED** |
| 2. Mid-transaction insertion failure rolls back all issuance writes | **UNEXECUTED / BLOCKED** |
| 3. Same Operation-ID with conflicting payload is rejected | **UNEXECUTED / BLOCKED** |
| 4. Identical concurrent retry yields one original raw token | **UNEXECUTED / BLOCKED** |
| 5. Independent stale-admin race creates no duplicate scope | **UNEXECUTED / BLOCKED** |
| 6. Stale price preserves application/payment/class data | **UNEXECUTED / BLOCKED** |
| 7. Replace/stop race preserves unrelated URLs and replay stays inactive | **UNEXECUTED / BLOCKED** |
| 8. Issue/replace/membership/stop preserve quotes and prices | **UNEXECUTED / BLOCKED** |
| 9. Full-edit/inline price race and stale intentional edit rollback | **UNEXECUTED / BLOCKED** |
| 10. Two-client price CAS accepts exactly one revision | **UNEXECUTED / BLOCKED** |
| 11. Concurrent legacy reissue/lost response never rotates twice | **UNEXECUTED / BLOCKED** |
| 12. Frozen stop retry after resume cannot stop the new link | **UNEXECUTED / BLOCKED** |

## GitHub Actions service-container execution

The workflow [Phase 2 PostgreSQL Integration](../.github/workflows/phase2-integration.yml) runs on `pull_request` and `workflow_dispatch` only, on `ubuntu-latest`, with `contents: read` permissions. Open/update a PR to trigger a run. Once the workflow is registered on the default branch, select it in GitHub Actions and choose **Run workflow** for a branch containing the workflow to run it manually. It uses no repository secrets.

The confirmed CI bootstrap failure comes from `prisma/migrations/20261015090000_ai_service_followup/migration.sql`: its `REVOKE ALL ON TABLE ... FROM anon, authenticated` references roles supplied by Supabase but absent from vanilla `postgres:16`. PostgreSQL reports that the role does not exist, aborts the migration transaction, and `prisma migrate deploy` fails before the integration suite starts.

The fix is a CI test-environment shim in `scripts/ci/prepare-e2e-db.ts`. After PostgreSQL verification and before migrations, the generated Prisma client idempotently creates missing `anon` and `authenticated` roles as `NOLOGIN`, reporting created/already-existing status. It validates both database URLs with `assertSafeE2eDatabaseUrls` before constructing the client, restricting execution to the dedicated local host/port/database/user. These roles only emulate the Supabase role environment inside the disposable CI service. Existing migrations, schema, and application code are unchanged. This shim has not yet passed CI; all PostgreSQL test statuses remain **UNEXECUTED / BLOCKED**.

Each job provisions a new disposable `postgres:16` service with database/user `yaho_e2e`, synthetic CI-only password `ci-synthetic-e2e`, and port mapping `55432:5432`. GitHub waits for `pg_isready -U yaho_e2e -d yaho_e2e` with interval 10 seconds, timeout 5 seconds, and 5 retries. Both `DATABASE_URL` and `DIRECT_URL` point to `postgresql://yaho_e2e:ci-synthetic-e2e@127.0.0.1:55432/yaho_e2e`. The existing local-only safety checks remain unchanged.

The job executes these steps in order:

1. Checkout with `actions/checkout@v4`.
2. Set up Node 20 and npm caching with `actions/setup-node@v4`.
3. Install the locked dependencies with `npm ci`.
4. Generate the Prisma client with `npm run prisma:generate`.
5. Run `npx tsx scripts/ci/verify-e2e-db.ts`. Before connecting, the script validates both URLs with the existing safety guard. The generated Prisma client queries `version()`, `current_database()`, and `current_user`, and fails unless they identify PostgreSQL major version 16 and database/user `yaho_e2e`.
6. Run `npx tsx scripts/ci/prepare-e2e-db.ts` to prepare the Supabase roles in the safe ephemeral service database.
7. Apply the repository's existing migrations with `npx prisma migrate deploy` to the ephemeral service database only.
8. Run `npx vitest run --config vitest.integration.config.ts`, including `tests/integration/reservation-applications/class-link-issuance.test.ts` and its 12 cases.

The service and its data are discarded with the job. Fixtures use synthetic run-scoped rows; cleanup deletes only that run's rows and owned settings. No Preview, Production, or Supabase connection is used, and no source schema/migration change is required. The existing quality workflow in `ci.yml` is unchanged.

After the corrected workflow runs, capture the run URL, date/commit, PostgreSQL verification, role preparation, migration result, full case counts, and transaction/race results here. Workflow changes or YAML validation do not change the 12 **UNEXECUTED / BLOCKED** statuses above. Browser E2E, Playwright WebKit, and actual Safari remain separate verification gates; this workflow does not execute them.
