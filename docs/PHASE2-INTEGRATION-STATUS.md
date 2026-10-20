# Phase 2 integration execution status

Follow-up to `3138d8c`; local audit on 2026-10-20. No Preview or Production database was accessed. No schema/migration file was changed.

| Verification | Execution status | Evidence / limitation |
|---|---|---|
| Original dedicated PostgreSQL suite | **UNEXECUTED / BLOCKED**, all **8** original `it()` cases | No local PostgreSQL server or connection configured; unit mocks cannot prove transactions or locks. |
| Follow-up PostgreSQL cases | **UNEXECUTED / BLOCKED**, 4 additional cases (12 total) | Full-edit/inline price race and stale intentional rollback; two-client price CAS; concurrent legacy reissue/lost response; frozen stop retry after resume. |
| Browser E2E (Playwright) | **NOT EXECUTED** | No dedicated local test DB/application fixture runtime available; static component tests are not browser E2E. |
| Real Safari | **NOT EXECUTED** | No real Safari/macOS runner available. Playwright WebKit, even if run, would be reported separately from actual Safari. |

Local verification actually executed for this follow-up: `npx tsc --noEmit` PASS (exit 0); `npm run lint` PASS (exit 0, one pre-existing unused `_body` warning in `tests/unit/ai-service/selection-safety.test.ts:40`); `npm run build` PASS (exit 0, no `next dev` process found before build); FULL `npm test` PASS, **183 files / 2,181 tests**. These results do not change any UNEXECUTED status above. The React checklist was applied to the scoped form/link-card TSX changes (stable hooks, frozen state, explicit pending/error feedback, native confirmation dialog, ADMIN server validation).

The eight original cases cover atomic issue/metadata retry, rollback after mid-transaction failure, Operation-ID payload conflict, concurrent identical retry, independent stale-admin race, stale price/application/payment preservation, replace/stop race, and historical quotes through issue/replace/membership/stop. These are test definitions, **not PASS results**.

Audit evidence: `postgres`, `initdb`, `pg_ctl`, `psql`, `docker`, and `podman` were absent from PATH; `/usr/lib/postgresql` and `/usr/local/pgsql/bin` were absent. Docker/Podman sockets were absent. `DATABASE_URL` and `DIRECT_URL` were absent; no local env file other than `.env.example` was found. `127.0.0.1:55432` had no listener. A dedicated local server/runtime was not available during the audit. Therefore no integration runner was started and no transaction/race assertion executed.

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
