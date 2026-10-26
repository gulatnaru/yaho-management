import { eventSchema, type NotificationProvider, type NotificationSendResult } from "@/lib/kakao/notify";
import { OutboxStaleClaimError, OutboxTransitionError, type OutboxRow, type OutboxStore } from "@/lib/kakao/outbox";

// OUR retry policy, not a provider guarantee. Failures (not successes/skips)
// increment attemptCount. At attempt 5 the row is terminal; 240 is reserved.
export const MAX_ATTEMPTS = 5;
export const BACKOFF = [1, 5, 15, 60, 240] as const; // minutes

// Same fixed generic status copy as 2B; no recipients/templates/PII/URLs.
const copyByKind = {
  "application.received": { title: "새 예약 신청이 접수되었습니다", body: "새 예약 신청을 확인해주세요." },
  "application.confirmed": { title: "예약이 확정되었습니다", body: "예약 신청이 확정되었습니다." },
  "application.changed": { title: "예약 신청이 변경되었습니다", body: "예약 신청 상태가 변경되었습니다." },
  "application.cancelled": { title: "예약 신청이 취소되었습니다", body: "예약 신청이 취소되었습니다." },
} as const;

export type OutboxBatchOutcome = {
  rowId: string;
  status: "sent" | "skipped" | "failed" | "stale";
  rowStatus?: OutboxRow["status"];
  attemptCount?: number;
  nextRetryAt?: Date | null;
  reason?: "provider_unconfigured" | "provider_skipped" | "provider_error" | "invalid_transition" | "store_error" | "stale_claim";
};
export type OutboxBatchResult = { outcomes: OutboxBatchOutcome[]; error?: "claim_failed" };
export type OutboxBatchOptions = {
  provider: NotificationProvider | null;
  isProviderConfigured?: boolean;
  now: Date;
  limit?: number;
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
 * skipped is TERMINAL by phase policy: dry-run rows will NOT be backfilled;
 * real sending starts with new events after separately approved wiring.
 * The provider gate defaults FALSE and never calls send when unconfigured.
 */
export async function processOutboxBatch(store: OutboxStore, options: OutboxBatchOptions): Promise<OutboxBatchResult> {
  const outcomes: OutboxBatchOutcome[] = [];
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
      if (!(options.isProviderConfigured ?? false) || options.provider === null) {
        const saved = await store.markSkipped(row.id, claimToken, "provider_unconfigured");
        outcomes.push({ rowId: row.id, status: "skipped", rowStatus: saved.status, reason: "provider_unconfigured" });
        continue;
      }
      let result: NotificationSendResult;
      try {
        const event = eventSchema.parse(row.eventKind);
        result = await options.provider.send({ event, dedupeKey: row.dedupeKey, ...copyByKind[event] });
      } catch {
        result = { status: "failed" };
      }
      if (result.status === "sent") {
        const saved = await store.markSent(row.id, claimToken);
        outcomes.push({ rowId: row.id, status: "sent", rowStatus: saved.status });
      } else if (result.status === "skipped") {
        // Pass the reason to the store, which keeps only allowlisted codes.
        const saved = await store.markSkipped(row.id, claimToken, result.reason);
        outcomes.push({ rowId: row.id, status: "skipped", rowStatus: saved.status, reason: "provider_skipped" });
      } else {
        const attemptCount = row.attemptCount + 1;
        const nextRetryAt = attemptCount < MAX_ATTEMPTS
          ? new Date(options.now.getTime() + BACKOFF[Math.min(attemptCount, BACKOFF.length) - 1] * 60_000)
          : null;
        const saved = await store.markFailed(row.id, claimToken, "provider_error", nextRetryAt);
        outcomes.push({ rowId: row.id, status: "failed", rowStatus: saved.status, attemptCount: saved.attemptCount, nextRetryAt: saved.nextRetryAt, reason: "provider_error" });
      }
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
