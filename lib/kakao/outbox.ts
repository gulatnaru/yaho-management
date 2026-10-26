import { z } from "zod";
import { buildDedupeKey, eventSchema, type ReservationNotificationEvent } from "@/lib/kakao/notify";

export type OutboxStatus = "pending" | "processing" | "sent" | "skipped" | "failed";
// timeout/invalid_payload are reserved for the future real-provider contract.
export type OutboxErrorCode = "provider_unconfigured" | "provider_error" | "provider_timeout" | "invalid_payload";

// OUR policy, not a provider guarantee: allow a normal provider call five
// minutes while keeping interrupted work recoverable in a timely sweep.
export const LEASE_MS = 5 * 60_000;

export const outboxInputSchema = z.object({
  eventKind: eventSchema,
  // Existing group IDs use cuids; groups.ts:250 submission IDs use phase8_UUID.
  // Keep both existing internal contracts, excluding loose strings/PII/URLs.
  entityId: z.union([
    z.string().regex(/^c[a-z0-9]{24}$/),
    z.string().startsWith("phase8_").refine((value) => z.string().uuid().safeParse(value.slice(7)).success),
  ]),
  dedupeKey: z.string().regex(/^application\.(received|confirmed|changed|cancelled):[a-f0-9]{64}$/),
  audience: z.enum(["customer", "admin"]),
  occurredAt: z.date(),
}).strict().refine((input) => input.dedupeKey.startsWith(`${input.eventKind}:`));

export type OutboxEnqueueInput = z.infer<typeof outboxInputSchema>;
export type OutboxRow = OutboxEnqueueInput & {
  id: string;
  status: OutboxStatus;
  attemptCount: number;
  lastErrorCode: OutboxErrorCode | null;
  providerId: string | null;
  providerRef: string | null;
  nextRetryAt: Date | null;
  claimToken: string | null;
  leaseExpiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export class OutboxInputError extends Error {
  constructor() { super("Invalid outbox input."); this.name = "OutboxInputError"; }
}
export class OutboxTransitionError extends Error {
  constructor() { super("Illegal outbox transition."); this.name = "OutboxTransitionError"; }
}
export class OutboxStaleClaimError extends Error {
  constructor() { super("Outbox claim is stale."); this.name = "OutboxStaleClaimError"; }
}

export function parseOutboxInput(input: OutboxEnqueueInput): OutboxEnqueueInput {
  const parsed = outboxInputSchema.safeParse(input);
  if (!parsed.success) throw new OutboxInputError();
  return parsed.data;
}

/**
 * Minimal data only: no names, phones, amounts, customer tokens, URLs, financial details,
 * recipients or arbitrary payloads/reasons. dedupeKey is globally unique; a
 * repeated enqueue returns the existing row and NEVER creates another row.
 * Legal transitions: pending -> processing (claim only); processing -> sent,
 * skipped, failed (terminal), or pending (retry WITH nextRetryAt).
 * Expired processing leases may return to pending without consuming attempts.
 * Missing lease timestamps cannot prove expiry and are never recovered.
 * sent/skipped/failed have no outgoing transitions. Stores reject invalid
 * statuses with OutboxTransitionError and mismatched processing claims with
 * OutboxStaleClaimError; dispatch contains them per row.
 */
export interface OutboxStore {
  enqueue(input: OutboxEnqueueInput): Promise<{ created: boolean; row: OutboxRow }>;
  claimDue(limit: number, now: Date): Promise<OutboxRow[]>;
  recoverStale(limit: number, now: Date): Promise<OutboxRow[]>;
  markSent(rowId: string, claimToken: string, providerRef?: string): Promise<OutboxRow>;
  markSkipped(rowId: string, claimToken: string, reason?: string): Promise<OutboxRow>;
  markFailed(rowId: string, claimToken: string, errorCode: "provider_error", nextRetryAt: Date | null): Promise<OutboxRow>;
  findByDedupeKey(dedupeKey: string): Promise<OutboxRow | null>;
}

export type OutboxEnqueueResult =
  | { status: "enqueued"; created: boolean; row: OutboxRow }
  | { status: "failed"; reason: "outbox_enqueue_failed" };

/** Best effort: store/validation failures never change reservation results. */
export async function enqueueOutboxEvent(store: OutboxStore, input: OutboxEnqueueInput): Promise<OutboxEnqueueResult> {
  try {
    return { status: "enqueued", ...await store.enqueue(input) };
  } catch {
    return { status: "failed", reason: "outbox_enqueue_failed" };
  }
}

/** Build minimal input without persisting an occasion/revision or payload. */
export function buildOutboxInput(
  eventKind: ReservationNotificationEvent, entityId: string, occasion: string,
  audience: OutboxEnqueueInput["audience"], occurredAt: Date,
): OutboxEnqueueInput {
  return parseOutboxInput({ eventKind, entityId, dedupeKey: buildDedupeKey(eventKind, entityId, occasion), audience, occurredAt });
}

/**
 * FOUNDATION ONLY: the current 2B actions.ts:128 LogNotificationProvider emit is
 * unchanged. A future separately approved step swaps emit for best-effort
 * enqueue only AFTER migration + generate; deferred event wiring stays deferred.
 *
 * This is NOT a transactional outbox: 2B emits AFTER the business transaction
 * commits. A crash between business commit and enqueue LOSES the event (no row
 * to retry). A crash after enqueue before response can lead to another emit;
 * globally unique dedupeKey contains that duplicate, it does not eliminate it.
 * A true transactional outbox requires writing INSIDE the
 * server/reservation-applications/groups.ts:246 submitApplicationGroupCore
 * transaction, with explicit approval to change the group-submit core contract.
 *
 * Rows support at-least-once processing and already-sent rows are never resent.
 * Provider-side exactly-once is NOT guaranteed: a crash after send before mark
 * can duplicate delivery. Provider idempotency keys are a future contract item.
 * Claims carry leases and fencing tokens. Recovery is a separate sweep; a
 * crashed worker's row stays processing until its lease expires and is swept.
 * If expiry occurs during an in-flight provider call, recovery + re-claim +
 * re-send can duplicate external delivery. Fencing only protects stored state.
 * Future mitigation requires provider idempotency using dedupeKey; no real
 * provider contract implements that guarantee yet.
 */
