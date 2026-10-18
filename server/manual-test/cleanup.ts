import "server-only";
import { emptyMockData, type MockRun } from "@/lib/db/manual-test-prisma";
import type { ManualTestAuth } from "./auth";
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
    return this.auth.withSession(request, body.runId, "OPERATOR", (run, session) => {
      run.status = "CLOSED";
      // Reservation sessions are revoked; the OPERATOR session survives so it
      // can authorize cleanup via withClosedOperatorSession.
      for (const s of Object.values(run.sessions)) if (s.scope !== "OPERATOR") s.revoked = true;
      for (const grant of Object.values(run.grants)) grant.consumed = true;
      const issued = this.auth.refreshSession(session);
      return { runId: run.id, status: run.status, csrf: issued.csrf, cookie: issued.cookie };
    });
  }

  async cleanup(request: Request, input: unknown) {
    const body = runBodySchema.parse(input);
    return this.auth.withClosedOperatorSession(request, body.runId, (run) => {
      cleanClosedMockRun(run);
      return { runId: run.id, status: run.status };
    });
  }
}
