# Phase 2 integration execution status

Final verification follow-up to `e61aa87`; local audit on 2026-10-20. **The PostgreSQL/browser release gate remains BLOCKED.** No Preview, Production, or Supabase database was accessed. No database was created, connected to, seeded, or migrated during this audit. No schema/migration file was changed.

| Verification | Execution status | Evidence / limitation |
|---|---|---|
| Legacy reissue code + unit flow | **PASS — code/unit only** | Six new unit cases cover success, recovered copy/share handlers, old-token refusal, lost response/read failure, possible committed error, no-commit reload, and upgrade guidance. DB/browser behavior remains unverified. |
| Advisory lock on actual PostgreSQL 16 | **UNEXECUTED / BLOCKED** | Installed Prisma client is **6.19.3**. `issueClassLinkOperationCore()` still uses transactional `$executeRaw` with `SELECT pg_advisory_xact_lock(...)`. No actual PostgreSQL call succeeded or failed; no speculative SQL change or lock-order change was made. |
| Original dedicated PostgreSQL suite | **UNEXECUTED / BLOCKED**, all **8** original `it()` cases | PostgreSQL 16 installation and local IPv4 socket creation are blocked by the execution environment; unit mocks cannot prove transactions or locks. |
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

Required environment conditions: PG16 binaries must be pre-provisioned or package downloads permitted; a local user must be able to initialize/start an isolated data directory; IPv4 loopback TCP server/client sockets must be allowed; and port `55432` must be free. Only then create the brand-new role/database and apply the existing migrations as shown below. Browser verification additionally needs the configured browser binaries plus local app and synthetic authenticated fixtures. Real Safari requires a macOS/Safari runner.

| Local PostgreSQL case | Final execution status |
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

## Required dedicated local setup

Provision an **empty disposable local-only** PostgreSQL database. The safety guard requires host `127.0.0.1` or `localhost`, port `55432`, database `yaho_e2e`, and user `yaho_e2e` for **both** URLs. Remote hosts, Preview/Production, and alternative DB names/users are rejected. Do not use existing Preview/Production credentials or data.

With Docker installed, an example local-only setup (synthetic disposable password only):

```sh
docker run --name yaho-phase2-pg -d -p 127.0.0.1:55432:5432 \
  -e POSTGRES_USER=yaho_e2e -e POSTGRES_PASSWORD=local_test_only \
  -e POSTGRES_DB=yaho_e2e postgres:16
docker exec yaho-phase2-pg pg_isready -U yaho_e2e -d yaho_e2e
export DATABASE_URL='postgresql://yaho_e2e:local_test_only@127.0.0.1:55432/yaho_e2e?schema=public'
export DIRECT_URL="$DATABASE_URL"
unset VERCEL_ENV PLAYWRIGHT_PREVIEW_E2E
npx prisma migrate deploy
npx prisma generate
npx vitest run --config vitest.integration.config.ts
```

Wait until `pg_isready` succeeds before deploying the repository's **existing** migrations to that empty dedicated local DB. This is test-environment preparation, not a source schema change. Never run `db push`, `migrate reset`, or any migration against Preview/Production for this task. A native alternative is to install PostgreSQL 16, initialize a private data directory, start it on `127.0.0.1:55432`, create role/database `yaho_e2e`, then use the same URLs and commands above. Do not seed real personal data.

Capture the runner's full case counts, transaction/race results and date here after actual execution. The integration config and test file independently enforce local DB safety. Fixtures create synthetic run-scoped rows; cleanup deletes only that run's rows and owned settings. Browser E2E additionally needs a local app server and explicit synthetic admin/session fixtures; report it independently. Actual Safari additionally needs a macOS Safari runner and the same local test flow; do not label SSR or WebKit results “Safari PASS”.
