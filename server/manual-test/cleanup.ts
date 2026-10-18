import { emptyMockData, type MockRun } from "@/lib/db/manual-test-prisma";
import { ManualTestAuth, MANUAL_COOKIES, MOCK_TTL, manualCookie, opaqueToken, readManualCookie, tokenHash } from "./auth";
import { runBodySchema } from "./contracts";
import { requireManual } from "./errors";

/** Only the already-selected, closed run aggregate is reachable here. */
export function cleanClosedMockRun(run: MockRun) {
  requireManual(run.status === "CLOSED" || run.status === "CLEANED", "RUN_MUST_BE_CLOSED", 409);
  run.data = emptyMockData();
  run.sessions = {};
  run.grants = {};
  run.receipts = {};
  run.status = "CLEANED";
}

export class ManualTestCleanup {
  constructor(readonly auth: ManualTestAuth) {}

  async close(request: Request, input: unknown) {
    const body = runBodySchema.parse(input);
    return this.auth.withSession(request, body.runId, "OPERATOR", (run) => {
      run.status = "CLOSED";
      for (const session of Object.values(run.sessions)) session.revoked = true;
      for (const grant of Object.values(run.grants)) grant.consumed = true;
      const token = opaqueToken();
      const csrf = opaqueToken();
      run.cleanup = { hash: tokenHash("cleanup", token), csrfHash: tokenHash("csrf", csrf), expiresAt: this.auth.now() + MOCK_TTL.session };
      return { runId: run.id, status: run.status, csrf, cookie: manualCookie(MANUAL_COOKIES.cleanup, token, MOCK_TTL.session) };
    });
  }

  async cleanup(request: Request, input: unknown) {
    const body = runBodySchema.parse(input);
    this.auth.assertOrigin(request);
    const hash = tokenHash("cleanup", readManualCookie(request, MANUAL_COOKIES.cleanup));
    return this.auth.transaction(body.runId, (run) => {
      requireManual(run.cleanup && run.cleanup.hash === hash && run.cleanup.expiresAt > this.auth.now(), "UNAUTHORIZED", 401);
      this.auth.verifyCsrf(request, run.cleanup.csrfHash);
      cleanClosedMockRun(run);
      return { runId: run.id, status: run.status };
    });
  }
}
