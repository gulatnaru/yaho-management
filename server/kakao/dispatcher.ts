import "server-only";
import { verifySyntheticDispatchIdentity } from "@/lib/kakao/send-config";
import { processOutboxBatch, recoverStaleProcessing, type OutboxBatchOptions } from "@/lib/kakao/outbox-worker";
import type { InMemoryOutboxStore } from "@/lib/kakao/outbox-store";
import { timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/db/prisma";
import { PrismaOutboxStore } from "@/lib/kakao/outbox-store";
import { assertApprovedSupabaseProjectRef, assertApprovedRuntimeDatabaseIdentity, prismaSchemaTargetFromDatabaseUrl, type RuntimeDatabaseIdentity } from "@/lib/e2e/preview-safety";
import { getSyntheticTestDependencies } from "@/server/kakao/dispatch-test-source";

// G2 fixture only. This interface is not a proof of any deployed DB identity.
export type SyntheticDependencies = {
  expectedBearer: unknown;
  runner: unknown;
  app: unknown;
  readDbIdentity: () => Promise<unknown>;
  store: InMemoryOutboxStore;
  safe: NonNullable<OutboxBatchOptions["safe"]>;
  clock: () => number;
  deadline: number;
  now: () => Date;
};
type Result = { code: "unauthorized" | "budget" | "sweep_failed" | "batch_failed" | "ok"; processed?: number };

/** Injectable synthetic orchestration; no request data supplies environment identity. */
export async function dispatchSyntheticOnce(request: Request, deps: SyntheticDependencies): Promise<Result> {
  try {
    const url = new URL(request.url);
    const authenticated = await verifySyntheticDispatchIdentity({
      authorization: request.headers.get("authorization"), expectedBearer: deps.expectedBearer,
      queryCredential: url.search ? true : undefined, runner: deps.runner, app: deps.app,
      readDbIdentity: deps.readDbIdentity,
    });
    if (!authenticated) return { code: "unauthorized" };
    const start = deps.clock();
    if (!Number.isFinite(start) || !Number.isFinite(deps.deadline) || deps.deadline - start > 20000 || deps.deadline - start <= 12000) return { code: "budget" };
    try { await recoverStaleProcessing(deps.store, deps.now()); }
    catch { return { code: "sweep_failed" }; }
    const after = deps.clock();
    if (!Number.isFinite(after) || after < start || deps.deadline - after <= 10000) return { code: "budget" };
    let last = after;
    const canIssue = () => { try { const current = deps.clock(); if (!Number.isFinite(current) || current < last) return false; last = current; return deps.deadline - current > 10000; } catch { return false; } };
    const result = await processOutboxBatch(deps.store, { provider: null, now: deps.now(), limit: 1, safe: { ...deps.safe, canIssue } });
    if (result.error) return { code: "batch_failed" };
    return { code: "ok", processed: result.outcomes.length };
  } catch { return { code: "batch_failed" }; }
}

/** The synthetic handler is injectable only on the server; it proves no deployed identity. */
export function createSyntheticDispatchHandler(deps: SyntheticDependencies) {
  return async (request: Request): Promise<Response> => {
    const result = await dispatchSyntheticOnce(request, deps);
    const status = result.code === "unauthorized" ? 403 : result.code === "ok" ? 200 : 503;
    return Response.json(result, { status, headers: { "cache-control": "no-store" } });
  };
}

/** Manual Preview entry point. Its only provider is the G2 mock. */
export async function dispatchPreview(request: Request): Promise<Response> {
  const reply = (code: string, status: number, processed?: number) => Response.json(processed === undefined ? { code } : { code, processed }, { status, headers: { "cache-control": "no-store" } });
  const started = performance.now();
  try {
    const expected = process.env.KAKAO_DISPATCH_BEARER_SECRET;
    const supplied = request.headers.get("authorization");
    if (new URL(request.url).search || !expected || !/^[A-Za-z0-9_-]{43}$/.test(expected) || !supplied || !/^Bearer [A-Za-z0-9_-]{43}$/.test(supplied)) return reply("unauthorized", 403);
    const a = Buffer.from(expected); const b = Buffer.from(supplied.slice(7));
    if (a.length !== b.length || !timingSafeEqual(a, b)) return reply("unauthorized", 403);
    if (process.env.VERCEL_ENV !== "preview") return reply("unauthorized", 403);
    // Only the server-side test module loader can provide an in-memory fixture.
    // Production builds and all non-Preview environments cannot enter it.
    if (process.env.NODE_ENV === "test") {
      const synthetic = getSyntheticTestDependencies();
      if (synthetic) {
        const result = await dispatchSyntheticOnce(request, synthetic);
        return reply(result.code, result.code === "unauthorized" ? 403 : result.code === "ok" ? 200 : 503, result.processed);
      }
    }
    const expectedProjectRef = process.env.KAKAO_PREVIEW_PROJECT_REF;
    const productionProjectRef = process.env.KAKAO_PRODUCTION_PROJECT_REF;
    if (!productionProjectRef) return reply("unauthorized", 403);
    const projectRef = assertApprovedSupabaseProjectRef({ databaseUrl: process.env.DATABASE_URL, expectedProjectRef, productionProjectRef });
    const schema = prismaSchemaTargetFromDatabaseUrl(process.env.DATABASE_URL);
    const fingerprint = process.env.KAKAO_PREVIEW_DB_IDENTITY_SHA256;
    if (!fingerprint || !/^[a-f0-9]{64}$/i.test(fingerprint)) return reply("unauthorized", 403);
    const rows = await prisma.$queryRaw<RuntimeDatabaseIdentity[]>`SELECT current_database() AS database, current_user AS "currentUser", current_schema() AS "currentSchema"`;
    if (rows.length !== 1) return reply("unauthorized", 403);
    assertApprovedRuntimeDatabaseIdentity(rows[0], projectRef, fingerprint, schema);
    const deadline = started + 20000;
    if (deadline - performance.now() <= 12000) return reply("budget", 503);
    const store = new PrismaOutboxStore(prisma);
    try { await recoverStaleProcessing(store, new Date()); } catch { return reply("sweep_failed", 503); }
    if (deadline - performance.now() <= 10000) return reply("budget", 503);
    // No persistent Preview key or safety configuration is supplied here;
    // the worker rejects before claiming a row.
    const result = await processOutboxBatch(store, {
      provider: null, now: new Date(), limit: 1,
    });
    return result.error ? reply("batch_failed", 503) : reply("ok", 200, result.outcomes.length);
  } catch { return reply("unavailable", 503); }
}
