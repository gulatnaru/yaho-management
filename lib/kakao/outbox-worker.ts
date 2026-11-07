import { isExplicitSendDisabled } from "@/lib/kakao/send-config";
import type { NotificationProvider } from "@/lib/kakao/notify";
import { dispatchContextSchema, normalizeProviderResult, realDispatchContextSchema } from "@/lib/kakao/send-contract";
import { MockProvider } from "@/lib/kakao/providers/mock";
import { SolapiAdapter } from "@/lib/kakao/providers/solapi";
import { acquireDispatchPermit } from "@/server/kakao/dispatch-guard";
import { InMemoryOutboxStore, PrismaOutboxStore } from "@/lib/kakao/outbox-store";
import { PrismaDispatchRepository } from "@/server/kakao/dispatch-repository";
import { recordLateResult } from "@/server/kakao/late-result";
import { OutboxStaleClaimError, OutboxTransitionError, type OutboxRow, type OutboxStore } from "@/lib/kakao/outbox";

// OUR retry policy, not a provider guarantee. Failures (not successes/skips)
// increment attemptCount. At attempt 5 the row is terminal; 240 is reserved.
export const MAX_ATTEMPTS = 5;
export const BACKOFF = [1, 5, 15, 60, 240] as const; // minutes

function retryAfterTime(value: unknown, observedAt: Date): number | null {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : null;
  const seconds = typeof value === "number" ? value : typeof value === "string" && /^\d+$/.test(value) ? Number(value) : null;
  if (seconds !== null) {
    if (!Number.isSafeInteger(seconds) || seconds < 0) return null;
    const time = observedAt.getTime() + seconds * 1000;
    return Number.isSafeInteger(time) && Number.isFinite(new Date(time).getTime()) ? time : null;
  }
  if (typeof value !== "string") return null;
  const imf = /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), (\d{2}) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{4}) (\d{2}:\d{2}:\d{2}) GMT$/.exec(value);
  const rfc850 = /^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday), (\d{2})-(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)-(\d{2}) (\d{2}:\d{2}:\d{2}) GMT$/.exec(value);
  const asctime = /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) ([ \d]\d) (\d{2}:\d{2}:\d{2}) (\d{4})$/.exec(value);
  if (!imf && !rfc850 && !asctime) return null;
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return null;
  const canonical = parsed.toUTCString();
  if (imf && canonical !== value) return null;
  if (rfc850 && (canonical.slice(0, 3) !== rfc850[1].slice(0, 3) || canonical.slice(5, 7) !== rfc850[2] || canonical.slice(8, 11) !== rfc850[3] || String(parsed.getUTCFullYear() % 100).padStart(2, "0") !== rfc850[4] || canonical.slice(17, 25) !== rfc850[5])) return null;
  if (asctime && (canonical.slice(0, 3) !== asctime[1] || canonical.slice(8, 11) !== asctime[2] || Number(canonical.slice(5, 7)) !== Number(asctime[3]) || canonical.slice(17, 25) !== asctime[4] || canonical.slice(12, 16) !== asctime[5])) return null;
  return parsed.getTime();
}

export type OutboxBatchOutcome = {
  rowId: string;
  status: "sent" | "skipped" | "failed" | "stale";
  rowStatus?: OutboxRow["status"];
  attemptCount?: number;
  nextRetryAt?: Date | null;
  reason?: "provider_unconfigured" | "provider_skipped" | "provider_error" | "invalid_transition" | "store_error" | "stale_claim";
};
export type OutboxBatchResult = { outcomes: OutboxBatchOutcome[]; error?: "claim_failed" | "guard_unavailable" };
export type OutboxBatchOptions = {
  provider: NotificationProvider | null;
  isProviderConfigured?: boolean;
  now: Date;
  limit?: number;
  safe?: {
    repository: Parameters<typeof acquireDispatchPermit>[0];
    // Nullable: a real prepare returns null when its preconditions fail
    // (PLAN §1 step 4.2); the worker treats null as failed/store_error.
    prepare: (row: OutboxRow) => Promise<Omit<Parameters<typeof acquireDispatchPermit>[1], "claimToken" | "now"> | null>;
    provider: MockProvider | SolapiAdapter;
    clock: () => Date;
    retryAfter?: () => unknown;
    canIssue?: () => boolean;
  };
};

/**
 * Sweep only: never calls a provider or consumes retry budget. A future cron
 * route should explicitly recover first, then process; batches do not sweep.
 */
export async function recoverStaleProcessing(store: OutboxStore, now: Date, limit = 100): Promise<OutboxRow[]> {
  return store.recoverStale(limit, now);
}

/**
 * No logger or payload logging. Any future correlation logs must use digests.
 * A missing or mismatched guard leaves rows unclaimed. The mock can only be
 * reached after the repository commits the durable permit and reservation.
 */
export async function processOutboxBatch(store: OutboxStore, options: OutboxBatchOptions): Promise<OutboxBatchResult> {
  const outcomes: OutboxBatchOutcome[] = [];
  const safe = options.safe;
  const sameRepository = safe && (store instanceof InMemoryOutboxStore
    ? store.usesRepository(safe.repository)
    : store instanceof PrismaOutboxStore && safe.repository instanceof PrismaDispatchRepository && store.usesClient(safe.repository));
  if (!safe || !sameRepository || !(safe.provider instanceof MockProvider || safe.provider instanceof SolapiAdapter)) return { outcomes, error: "guard_unavailable" };
  let rows: OutboxRow[];
  try {
    rows = await store.claimDue(options.limit ?? 100, options.now);
  } catch {
    return { outcomes, error: "claim_failed" };
  }
  for (const row of rows) {
    try {
      const claimToken = row.claimToken;
      // Current stores always return a token; never send an unfenced claim.
      if (claimToken === null) throw new OutboxStaleClaimError();
      if (row.eventKind !== "application.received" || row.audience !== "admin") {
        outcomes.push({ rowId: row.id, status: "failed", reason: "store_error" });
        continue;
      }
      if (row.attemptCount >= MAX_ATTEMPTS) {
        const saved = await store.markFailed(row.id, claimToken, "attempt_limit", null);
        outcomes.push({ rowId: row.id, status: "failed", rowStatus: saved.status, attemptCount: saved.attemptCount, nextRetryAt: null });
        continue;
      }
      const observedAt = safe.clock();
      if (Number.isFinite(observedAt.getTime()) && observedAt.getTime() >= row.occurredAt.getTime() + 86_400_000 && (store instanceof InMemoryOutboxStore || store instanceof PrismaOutboxStore)) {
        const saved = await store.markExpired(row.id, claimToken, observedAt);
        outcomes.push({ rowId: row.id, status: "skipped", rowStatus: saved.status });
        continue;
      }
      const prepared = await safe.prepare(row);
      // Explicit prepare-null: failed/store_error, no send, no permit, no
      // provider call, no row state change (row stays processing; the sweep
      // recovers it to pending after lease expiry). Prepare-null is NOT
      // terminal — it must not become a terminal state.
      if (!prepared) {
        outcomes.push({ rowId: row.id, status: "failed", reason: "store_error" });
        continue;
      }
      if (isExplicitSendDisabled(prepared.config, prepared.policy)) {
        const saved = await store.markSkipped(row.id, claimToken, "send_disabled", safe.clock());
        outcomes.push({ rowId: row.id, status: "skipped", rowStatus: saved.status, attemptCount: saved.attemptCount });
        continue;
      }
      // Context–provider correspondence (mock-first: a mock context also
      // parses as a real context). Mismatch or unparsable context fails
      // closed before any permit or provider call.
      const isMockContext = dispatchContextSchema.safeParse(prepared.context).success;
      const isRealContext = !isMockContext && realDispatchContextSchema.safeParse(prepared.context).success;
      const isRealProvider = safe.provider instanceof SolapiAdapter;
      if ((isRealContext !== isRealProvider) || (!isMockContext && !isRealContext)) {
        outcomes.push({ rowId: row.id, status: "failed", reason: "store_error" });
        continue;
      }
      let deadlineDenied = false;
      const permit = await acquireDispatchPermit(safe.repository, { ...prepared, claimToken, now: safe.clock(), canIssue: safe.canIssue ? () => { const allowed = safe.canIssue!(); deadlineDenied = !allowed; return allowed; } : undefined });
      if (!permit) {
        if (deadlineDenied && (store instanceof InMemoryOutboxStore || store instanceof PrismaOutboxStore)) await store.releaseUnissued(row.id, claimToken, safe.clock());
        outcomes.push({ rowId: row.id, status: "failed", reason: "store_error" });
        continue;
      }
      if (safe.canIssue && !safe.canIssue()) {
        const saved = await store.markFailed(row.id, claimToken, "provider_result_unknown", null);
        outcomes.push({ rowId: row.id, status: "failed", rowStatus: saved.status, attemptCount: saved.attemptCount, nextRetryAt: saved.nextRetryAt, reason: "provider_error" });
        continue;
      }
      let result: ReturnType<typeof normalizeProviderResult>;
      try {
        result = normalizeProviderResult(await safe.provider.send(permit));
      } catch {
        result = { status: "unknown" };
      }
      if (result.status === "accepted") {
        try {
          const saved = await store.markSent(row.id, claimToken, result.ref);
          outcomes.push({ rowId: row.id, status: "sent", rowStatus: saved.status });
          continue;
        } catch (error) {
          if (error instanceof OutboxStaleClaimError || error instanceof OutboxTransitionError) {
            try {
              await recordLateResult(safe.repository, permit, result, safe.clock());
              outcomes.push({ rowId: row.id, status: "stale", reason: "stale_claim" });
              continue;
            } catch { /* If still owned, the unknown transition below is required. */ }
          }
          // A failed result commit cannot prove non-acceptance.
        }
      }
      if (result.status === "definite_rejection" && (store instanceof InMemoryOutboxStore || store instanceof PrismaOutboxStore)) {
        const at = safe.clock();
        const attempt = row.attemptCount + 1;
        const expiry = row.occurredAt.getTime() + 86_400_000;
        let next = at.getTime() + BACKOFF[Math.min(attempt, BACKOFF.length) - 1] * 60_000;
        const retryAfter = retryAfterTime(safe.retryAfter?.(), at);
        if (retryAfter !== null) next = Math.max(next, retryAfter);
        const nextRetryAt = result.retryable && attempt < MAX_ATTEMPTS && next < expiry ? new Date(next) : null;
        let saved: OutboxRow;
        try { saved = await store.markDefiniteRejection(row.id, claimToken, permit.dispatchId, permit.slotId, nextRetryAt, at); }
        catch (error) {
          if (error instanceof OutboxStaleClaimError || error instanceof OutboxTransitionError) {
            try { await recordLateResult(safe.repository, permit, result, at); } catch { /* Keep the unresolved reservation. */ }
            outcomes.push({ rowId: row.id, status: "stale", reason: "stale_claim" });
            continue;
          }
          throw error;
        }
        outcomes.push({ rowId: row.id, status: "failed", rowStatus: saved.status, attemptCount: saved.attemptCount, nextRetryAt: saved.nextRetryAt, reason: "provider_error" });
        continue;
      }
      // An unrecordable result must preserve the slot and its cost exposure.
      const saved = await store.markFailed(row.id, claimToken, "provider_result_unknown", null);
      outcomes.push({ rowId: row.id, status: "failed", rowStatus: saved.status, attemptCount: saved.attemptCount, nextRetryAt: saved.nextRetryAt, reason: "provider_error" });
    } catch (error) {
      if (error instanceof OutboxStaleClaimError) {
        // A lost claim is not a provider failure: no write, attempt, or retry.
        outcomes.push({ rowId: row.id, status: "stale", reason: "stale_claim" });
        continue;
      }
      // A store transition/row failure never aborts the remaining batch.
      // Do not reflect exception messages or raw provider reasons/payloads.
      outcomes.push({ rowId: row.id, status: "failed", reason: error instanceof OutboxTransitionError ? "invalid_transition" : "store_error" });
    }
  }
  return { outcomes };
}
