# Phase 1 test failure analysis

Date: 2026-10-20. Baseline: `c99a92a` on `feature/phase21-ai-service`.
Scope: Phase 1 link inventory/readiness follow-up only. No schema, migration, fixture, application-data, Preview policy or deployment changes.

## Verdict

The two full-suite failures reproduce in isolation. Evidence identifies this runtime's synchronous subprocess **pipe capture** as the cause of the lost diagnostics: even a standalone Node constant-print program returns `spawnSync /usr/bin/node EPERM` with empty captured streams. The identical program and actual Playwright admission command work with regular-file stdout/stderr descriptors. This is an environment compatibility issue exposed by the test harness, not evidence of a link-domain or remote-origin admission defect. The precise OS/security mechanism is not established.

The harness now uses temporary regular files, cleans them in `finally`, and explicitly asserts that subprocess execution has no `error`. It still executes the real Playwright CLI and requires the original remote-origin rejection text; no skip, mocked CLI, weaker assertion, network request or guard exception was introduced. The original status-only default-local checks were insufficient: controls show a valid child exit status can coexist with a capture error. They now also assert `error === undefined`.

Browser E2E: **BLOCKED** before browser/server/DB startup because the dedicated local database environment is missing. Browser executables, existing approved synthetic fixtures and existing authenticated states are also missing. This is not a browser test pass or a skipped-test success.

## Exact failing tests and baseline

File: `tests/unit/e2e/local-origin-safety.test.ts`.

1. `Playwright local origin safety > direct --list rejects remote origin https://yaho-management.vercel.app before specs load`
2. `Playwright local origin safety > direct --list rejects remote origin https://yaho-management-git-arbitrary.vercel.app before specs load`

Command: `npm test` (complete output: `/tmp/phase1-before-full-test.log`).
Result: **1 failed / 177 passed files; 2 failed / 2133 passed tests** (178 files / 2135 tests total).
Both cases invoke `node <Playwright CLI> test --list`; the remote-looking strings are rejection inputs, not URLs visited by a browser. Full reported failure output follows:

```text
 FAIL  tests/unit/e2e/local-origin-safety.test.ts > Playwright local origin safety > direct --list rejects remote origin https://yaho-management.vercel.app before specs load
 FAIL  tests/unit/e2e/local-origin-safety.test.ts > Playwright local origin safety > direct --list rejects remote origin https://yaho-management-git-arbitrary.vercel.app before specs load
AssertionError: expected '\n' to contain 'PLAYWRIGHT_BASE_URL must be http://12…'

- Expected
+ Received

- PLAYWRIGHT_BASE_URL must be http://127.0.0.1:3000
+
+

 ❯ tests/unit/e2e/local-origin-safety.test.ts:48:50
     46|     const result = listE2eTests(baseUrl);
     47|     expect(result.status).not.toBe(0);
     48|     expect(`${result.stdout}\n${result.stderr}`).toContain("PLAYWRIGHT…
       |                                                  ^
     49|   });
     50| });

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/2]⎯

 Test Files  1 failed | 177 passed (178)
      Tests  2 failed | 2133 passed (2135)
   Start at  15:00:23
   Duration  75.79s (transform 5.87s, setup 0ms, collect 17.01s, tests 14.29s, environment 52ms, prepare 13.73s)
```

## Isolation before the harness fix

Command: `npx vitest run tests/unit/e2e/local-origin-safety.test.ts`.
Complete unmodified-suite isolation output (`/tmp/phase1-isolated-test.log`):

```text
The CJS build of Vite's Node API is deprecated. See https://vite.dev/guide/troubleshooting.html#vite-cjs-node-api-deprecated for more details.

 RUN  v2.1.9 /home/hatch/workspace/yaho-management

 ❯ tests/unit/e2e/local-origin-safety.test.ts (3 tests | 2 failed) 3320ms
   ✓ Playwright local origin safety > allows the default local webServer origin 1803ms
   × Playwright local origin safety > direct --list rejects remote origin https://yaho-management.vercel.app before specs load 809ms
     → expected '\n' to contain 'PLAYWRIGHT_BASE_URL must be http://12…'
   × Playwright local origin safety > direct --list rejects remote origin https://yaho-management-git-arbitrary.vercel.app before specs load 707ms
     → expected '\n' to contain 'PLAYWRIGHT_BASE_URL must be http://12…'

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 2 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  tests/unit/e2e/local-origin-safety.test.ts > Playwright local origin safety > direct --list rejects remote origin https://yaho-management.vercel.app before specs load
 FAIL  tests/unit/e2e/local-origin-safety.test.ts > Playwright local origin safety > direct --list rejects remote origin https://yaho-management-git-arbitrary.vercel.app before specs load
AssertionError: expected '\n' to contain 'PLAYWRIGHT_BASE_URL must be http://12…'

- Expected
+ Received

- PLAYWRIGHT_BASE_URL must be http://127.0.0.1:3000
+
+

 ❯ tests/unit/e2e/local-origin-safety.test.ts:48:50
     46|     const result = listE2eTests(baseUrl);
     47|     expect(result.status).not.toBe(0);
     48|     expect(`${result.stdout}\n${result.stderr}`).toContain("PLAYWRIGHT…
       |                                                  ^
     49|   });
     50| });

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/2]⎯

 Test Files  1 failed (1)
      Tests  2 failed | 1 passed (3)
   Start at  15:02:11
   Duration  4.26s (transform 97ms, setup 0ms, collect 114ms, tests 3.32s, environment 0ms, prepare 543ms)
```

Adding only `expect(result.error).toBeUndefined()` exposed the otherwise hidden runtime error for both exact cases. Complete diagnostic isolation output (`/tmp/phase1-isolated-diagnostic-test.log`):

```text
The CJS build of Vite's Node API is deprecated. See https://vite.dev/guide/troubleshooting.html#vite-cjs-node-api-deprecated for more details.

 RUN  v2.1.9 /home/hatch/workspace/yaho-management

 ❯ tests/unit/e2e/local-origin-safety.test.ts (3 tests | 2 failed) 3720ms
   ✓ Playwright local origin safety > allows the default local webServer origin 1885ms
   × Playwright local origin safety > direct --list rejects remote origin https://yaho-management.vercel.app before specs load 924ms
     → expected Error: spawnSync /usr/bin/node EPERM { …(5) } to be undefined
   × Playwright local origin safety > direct --list rejects remote origin https://yaho-management-git-arbitrary.vercel.app before specs load 909ms
     → expected Error: spawnSync /usr/bin/node EPERM { …(5) } to be undefined

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 2 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  tests/unit/e2e/local-origin-safety.test.ts > Playwright local origin safety > direct --list rejects remote origin https://yaho-management.vercel.app before specs load
 FAIL  tests/unit/e2e/local-origin-safety.test.ts > Playwright local origin safety > direct --list rejects remote origin https://yaho-management-git-arbitrary.vercel.app before specs load
AssertionError: expected Error: spawnSync /usr/bin/node EPERM { …(5) } to be undefined

- Expected:
undefined

+ Received:
[Error: spawnSync /usr/bin/node EPERM]

 ❯ tests/unit/e2e/local-origin-safety.test.ts:47:26
     45|   ])("direct --list rejects remote origin %s before specs load", (base…
     46|     const result = listE2eTests(baseUrl);
     47|     expect(result.error).toBeUndefined();
       |                          ^
     48|     expect(result.status).not.toBe(0);
     49|     expect(`${result.stdout}\n${result.stderr}`).toContain("PLAYWRIGHT…

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/2]⎯

 Test Files  1 failed (1)
      Tests  2 failed | 1 passed (3)
   Start at  15:02:31
   Duration  4.39s (transform 112ms, setup 0ms, collect 128ms, tests 3.72s, environment 0ms, prepare 88ms)
```

## Runtime controls and actual guard evidence

Runtime: Node `v24.20.0`, Linux x64. No-network controls invoked the same `process.execPath` with `-e`, printed a constant, and explicitly exited 0 or 1. Each was repeated with local/remote-looking `PLAYWRIGHT_BASE_URL` and inherited/minimal environments. Every piped-capture case returned `error.code=EPERM`, `errno=-1`, `syscall=spawnSync /usr/bin/node`, empty stdout/stderr and the requested child exit status. Thus the error is reproducible without importing Playwright or application code and is not specific to a remote origin or application configuration. Complete controls (`/tmp/phase1-process-controls.log`):

```text
node=v24.20.0 platform=linux arch=x64
runtime env NODE_EXTRA_CA_CERTS: present
runtime env NODE_USE_ENV_PROXY: present
{"inherit":true,"origin":"http://127.0.0.1:3000","code":0,"status":0,"signal":null,"error":{"message":"spawnSync /usr/bin/node EPERM","code":"EPERM","errno":-1,"syscall":"spawnSync /usr/bin/node"},"stdout":"","stderr":""}
{"inherit":true,"origin":"http://127.0.0.1:3000","code":1,"status":1,"signal":null,"error":{"message":"spawnSync /usr/bin/node EPERM","code":"EPERM","errno":-1,"syscall":"spawnSync /usr/bin/node"},"stdout":"","stderr":""}
{"inherit":true,"origin":"https://yaho-management.vercel.app","code":0,"status":0,"signal":null,"error":{"message":"spawnSync /usr/bin/node EPERM","code":"EPERM","errno":-1,"syscall":"spawnSync /usr/bin/node"},"stdout":"","stderr":""}
{"inherit":true,"origin":"https://yaho-management.vercel.app","code":1,"status":1,"signal":null,"error":{"message":"spawnSync /usr/bin/node EPERM","code":"EPERM","errno":-1,"syscall":"spawnSync /usr/bin/node"},"stdout":"","stderr":""}
{"inherit":false,"origin":"http://127.0.0.1:3000","code":0,"status":0,"signal":null,"error":{"message":"spawnSync /usr/bin/node EPERM","code":"EPERM","errno":-1,"syscall":"spawnSync /usr/bin/node"},"stdout":"","stderr":""}
{"inherit":false,"origin":"http://127.0.0.1:3000","code":1,"status":1,"signal":null,"error":{"message":"spawnSync /usr/bin/node EPERM","code":"EPERM","errno":-1,"syscall":"spawnSync /usr/bin/node"},"stdout":"","stderr":""}
{"inherit":false,"origin":"https://yaho-management.vercel.app","code":0,"status":0,"signal":null,"error":{"message":"spawnSync /usr/bin/node EPERM","code":"EPERM","errno":-1,"syscall":"spawnSync /usr/bin/node"},"stdout":"","stderr":""}
{"inherit":false,"origin":"https://yaho-management.vercel.app","code":1,"status":1,"signal":null,"error":{"message":"spawnSync /usr/bin/node EPERM","code":"EPERM","errno":-1,"syscall":"spawnSync /usr/bin/node"},"stdout":"","stderr":""}
```

The direct Playwright probe also recorded this full error object/stack for each remote-origin case (`/tmp/phase1-process-probe.log`); it had the same result for the default local case when required discovery settings were absent:

```text
{
  "origin": "https://yaho-management.vercel.app",
  "status": 1,
  "signal": null,
  "error": {
    "name": "Error",
    "message": "spawnSync /usr/bin/node EPERM",
    "code": "EPERM",
    "errno": -1,
    "syscall": "spawnSync /usr/bin/node",
    "path": "/usr/bin/node",
    "spawnargs": [
      "/home/hatch/workspace/yaho-management/node_modules/@playwright/test/cli.js",
      "test",
      "--list"
    ],
    "stack": "Error: spawnSync /usr/bin/node EPERM\n    at Object.spawnSync (node:internal/child_process:1160:20)\n    at spawnSync (node:child_process:928:24)\n    at [stdin]:5:9\n    at runScriptInThisContext (node:internal/vm:219:10)\n    at node:internal/process/execution:451:12\n    at [stdin]-wrapper:6:24\n    at runScriptInContext (node:internal/process/execution:449:60)\n    at evalFunction (node:internal/process/execution:283:30)\n    at evalTypeScript (node:internal/process/execution:295:3)\n    at node:internal/main/eval_stdin:51:5"
  },
  "stdout": "",
  "stderr": ""
}
{
  "origin": "https://yaho-management-git-arbitrary.vercel.app",
  "status": 1,
  "signal": null,
  "error": {
    "name": "Error",
    "message": "spawnSync /usr/bin/node EPERM",
    "code": "EPERM",
    "errno": -1,
    "syscall": "spawnSync /usr/bin/node",
    "path": "/usr/bin/node",
    "spawnargs": [
      "/home/hatch/workspace/yaho-management/node_modules/@playwright/test/cli.js",
      "test",
      "--list"
    ],
    "stack": "Error: spawnSync /usr/bin/node EPERM\n    at Object.spawnSync (node:internal/child_process:1160:20)\n    at spawnSync (node:child_process:928:24)\n    at [stdin]:5:9\n    at runScriptInThisContext (node:internal/vm:219:10)\n    at node:internal/process/execution:451:12\n    at [stdin]-wrapper:6:24\n    at runScriptInContext (node:internal/process/execution:449:60)\n    at evalFunction (node:internal/process/execution:283:30)\n    at evalTypeScript (node:internal/process/execution:295:3)\n    at node:internal/main/eval_stdin:51:5"
  },
  "stdout": "",
  "stderr": ""
}
```

Changing only subprocess stdio to temporary regular-file descriptors produced the following constant-program and actual Playwright results. The constant program's stdout/stderr are captured, `error` is null, and Playwright refuses the remote origin in `assertLocalE2eBaseUrl` before specification loading (`/tmp/phase1-process-file-control.log`):

```text
{
  "mode": "control",
  "status": 1,
  "signal": null,
  "error": null,
  "stdout": "control-stdout\n",
  "stderr": "control-stderr\n"
}
{
  "mode": "playwright-remote",
  "status": 1,
  "signal": null,
  "error": null,
  "stdout": "",
  "stderr": "Error: [Playwright local safety] PLAYWRIGHT_BASE_URL must be http://127.0.0.1:3000.\n    at assertLocalE2eBaseUrl (/home/hatch/workspace/yaho-management/lib/e2e/local-origin-safety.ts:19:11)\n    at Object.<anonymous> (/home/hatch/workspace/yaho-management/playwright.config.ts:33:39)\n    at Module._compile (node:internal/modules/cjs/loader:1929:14)\n    at Object.<anonymous> (node:internal/modules/cjs/loader:2060:10)\n    at Module.load (node:internal/modules/cjs/loader:1651:32)\n    at Module._load (node:internal/modules/cjs/loader:1443:12)\n    at wrapModuleLoad (node:internal/modules/cjs/loader:261:19)\n    at Module.require (node:internal/modules/cjs/loader:1674:12)\n    at require (node:internal/modules/helpers:157:16)\n    at requireOrImport (/home/hatch/workspace/yaho-management/node_modules/playwright/lib/common/index.js:1138:18)\n    at loadUserConfig (/home/hatch/workspace/yaho-management/node_modules/playwright/lib/common/index.js:1323:52)\n    at loadConfig (/home/hatch/workspace/yaho-management/node_modules/playwright/lib/common/index.js:1330:28)\n    at processTicksAndRejections (node:internal/process/task_queues:104:5)\n    at Object.loadConfigFromFile (/home/hatch/workspace/yaho-management/node_modules/playwright/lib/common/index.js:1546:10)\n    at runTests (/home/hatch/workspace/yaho-management/node_modules/playwright/lib/cli/testActions.js:46:18)\n    at _Command.<anonymous> (/home/hatch/workspace/yaho-management/node_modules/playwright/lib/program.js:55:7)\n"
}
```

Post-fix isolation uses the same exact Vitest command; complete output (`/tmp/phase1-isolated-fixed-test.log`):

```text
The CJS build of Vite's Node API is deprecated. See https://vite.dev/guide/troubleshooting.html#vite-cjs-node-api-deprecated for more details.

 RUN  v2.1.9 /home/hatch/workspace/yaho-management

 ✓ tests/unit/e2e/local-origin-safety.test.ts (3 tests) 9077ms
   ✓ Playwright local origin safety > allows the default local webServer origin 3580ms
   ✓ Playwright local origin safety > direct --list rejects remote origin https://yaho-management.vercel.app before specs load 2057ms
   ✓ Playwright local origin safety > direct --list rejects remote origin https://yaho-management-git-arbitrary.vercel.app before specs load 3439ms

 Test Files  1 passed (1)
      Tests  3 passed (3)
   Start at  15:03:48
   Duration  10.10s (transform 193ms, setup 0ms, collect 221ms, tests 9.08s, environment 0ms, prepare 302ms)
```

## Local-only browser E2E attempt — BLOCKED

Actual command:

```sh
npx playwright test --config=playwright.ux.config.ts tests/e2e/integrated-ux-class-links.spec.ts
```

Exit: 1. The existing local configuration rejected the missing database environment before starting the local web server, connecting to a DB or launching a browser. Complete output (`/tmp/phase1-browser-e2e.log`):

```text
Error: [Playwright DB safety] DATABASE_URL is missing.
    at assertSafeE2eDatabaseUrl (/home/hatch/workspace/yaho-management/tests/e2e/support/db-safety.ts:39:11)
    at assertSafeE2eDatabaseUrls (/home/hatch/workspace/yaho-management/tests/e2e/support/db-safety.ts:74:19)
    at Object.<anonymous> (/home/hatch/workspace/yaho-management/playwright.ux.config.ts:10:26)
    at Module._compile (node:internal/modules/cjs/loader:1929:14)
    at Object.<anonymous> (node:internal/modules/cjs/loader:2060:10)
    at Module.load (node:internal/modules/cjs/loader:1651:32)
    at Module._load (node:internal/modules/cjs/loader:1443:12)
    at wrapModuleLoad (node:internal/modules/cjs/loader:261:19)
    at Module.require (node:internal/modules/cjs/loader:1674:12)
    at require (node:internal/modules/helpers:157:16)
    at requireOrImport (/home/hatch/workspace/yaho-management/node_modules/playwright/lib/common/index.js:1138:18)
    at loadUserConfig (/home/hatch/workspace/yaho-management/node_modules/playwright/lib/common/index.js:1323:52)
    at loadConfig (/home/hatch/workspace/yaho-management/node_modules/playwright/lib/common/index.js:1330:28)
    at processTicksAndRejections (node:internal/process/task_queues:104:5)
    at Object.loadConfigFromFile (/home/hatch/workspace/yaho-management/node_modules/playwright/lib/common/index.js:1546:10)
    at runTests (/home/hatch/workspace/yaho-management/node_modules/playwright/lib/cli/testActions.js:46:18)
    at _Command.<anonymous> (/home/hatch/workspace/yaho-management/node_modules/playwright/lib/program.js:55:7)
```

Safe prerequisite inspection used the same `@next/env` loader as Playwright. It reported presence/classification only, never secret values:

| Prerequisite | Observed | Exact environment needed to rerun |
| --- | --- | --- |
| `DATABASE_URL`, `DIRECT_URL` | Both missing | Both point to existing dedicated local PostgreSQL: host `127.0.0.1` or `localhost`, port `55432`, database `yaho_e2e`, user `yaho_e2e`; valid operator-managed credentials |
| Existing local schema/data | No eligible DB supplied; not queried | Compatible pre-provisioned schema and approved synthetic records only; this task does not create/migrate/seed/change data |
| `UX_READ_ONLY_CLASS_FIXTURES` | Missing | JSON class IDs for `noLink`, `hash`, `legacy`, `groups`, `stopped`, `cancelled`, `past`, `teacherAssigned`, referring to existing approved synthetic fixtures |
| `UX_ADMIN_STORAGE_STATE` | Missing | File path to existing authenticated local ADMIN Playwright storage state |
| `UX_MANAGER_STORAGE_STATE`, `UX_TEACHER_STORAGE_STATE` | Both missing | Existing authenticated local role-state files for both denial checks; TEACHER assigned to the synthetic `teacherAssigned` class |
| Chromium and WebKit executables | Both missing (Firefox also absent) | Matching installed Playwright Chromium and WebKit for desktop 1440x900 and mobile WebKit 360/390 projects; no browser download was attempted |
| Local app | Not started because config rejected admission | Existing local app auth/configuration matching supplied states, including valid `AUTH_SECRET` and local auth origin; port 3000 available for the config-managed `npm run dev` server |
| Origin/environment | `VERCEL_ENV`, `PLAYWRIGHT_PREVIEW_E2E` absent | Keep `VERCEL_ENV`/Preview mode/focus unset; `PLAYWRIGHT_BASE_URL` absent or exactly `http://127.0.0.1:3000` |

The suite is read only and fingerprints domain records; it requires supplied fixtures/states rather than creating them. Supplying only database URLs would be insufficient: absent fixtures/states otherwise lead to skips, and missing browsers prevent execution. No Production data, Preview bypass, relaxed restriction, remote DB, fixture creation, auth write, token rotation, data modification or deployment was used.

## Phase 1 regression coverage and final verification

The query exposes link-record activity, group/scope activity, current-class membership and activity-for-this-class independently. Class intake conditions no longer collapse into membership exclusion; environment access remains separate. Removed-class legacy/group records remain in collapsed history, with explicit record/group/membership labels. Header status, top diagnostics and address actions use current-member scopes only.

Added cases cover active-but-excluded group links, included active links, preserved excluded group/legacy history, cancellation/past/missing-price intake independent of membership, and excluded-scope suppression in top status/diagnostics even alongside an included active scope. Existing Preview restrictions and active metadata for closed classes remain covered. React skill checks: existing hooks remain unconditional, derived membership is computed in render, mapped entries keep stable IDs, disclosure remains native closed `details`, and no client fetch, dependency, or widened serialization/authorization boundary was added.

| Command | Result | Complete local log |
| --- | --- | --- |
| `npx tsc --noEmit` | PASS, exit 0 | `/tmp/phase1-typecheck.log` |
| `npm run lint` | PASS, exit 0 | `/tmp/phase1-lint.log` |
| `npm test` | PASS, exit 0; 178 files / 2143 tests | `/tmp/phase1-after-full-test.log` |
| `npm run build` | PASS, exit 0; compiled, types/lint, page generation and build traces completed | `/tmp/phase1-build.log` |
| `git diff --check` | PASS | No whitespace errors |

Before build, `pgrep -af '[n]ext dev'` found no running Next development server, so the full build was permitted without sharing a live dev cache. No deployment was performed. The CJS Vite API deprecation notice remains informational.

Final full-suite summary:

```text
 Test Files  178 passed (178)
      Tests  2143 passed (2143)
   Start at  15:03:58
   Duration  149.99s (transform 12.58s, setup 0ms, collect 38.13s, tests 27.03s, environment 99ms, prepare 26.87s)
```
