import {
  buildDedupeKey,
  notifyReservationEvent,
  type NotificationProvider,
  type NotificationSendResult,
  type ReservationNotificationEvent,
} from "@/lib/kakao/notify";

/**
 * 2B survey (source line numbers before this wiring; financial cores unchanged):
 * Event                 Classification / evidence / follow-up
 * application.received  WIREABLE: public apply/group/[token]/actions.ts:107-122,
 *                       submitApplicationGroupWithCompanion, after the committed
 *                       groups.ts:246-352 transaction, excluding replay. The group
 *                       wrapper at actions.ts:76-77 delegates here exactly once.
 *                       No finance/deposit/return/ledger/refund writes are involved;
 *                       existing application quote snapshots remain unchanged.
 *                       DEFERRED legacy: submit.ts:28-31,50-70 returns only an
 *                       application ID, not the required submission/group ID.
 *                       Follow-up: approve a legacy event identity contract.
 * application.confirmed DEFERRED: confirm.ts:39-49 is deposit-gated; admin
 *                       reservation-applications/actions.ts:342-348 calls finance
 *                       confirmApplicationSubmissionCore (finance.ts:379-403
 *                       writes payment/allocations). Confirm wiring is excluded;
 *                       follow-up: financial-logic change approval.
 * application.changed   DEFERRED: admin actions.ts:96-112 and groups.ts:84-118
 *                       edit future group membership only; existing applications
 *                       do not change. No unambiguous application-change success
 *                       point. Follow-up: define mutation, entity and revision.
 * application.cancelled DEFERRED: resolve.ts:24-44 is legacy-only; shared admin
 *                       closeApplication at actions.ts:549-555 dispatches to
 *                       finance.ts:215-230 (return obligations). Follow-up:
 *                       financial-logic change approval and cancel/reject scope.
 * Server paths above are under server/reservation-applications/; public/admin
 * actions are under app/(public)/ and app/(admin)/ respectively.
 *
 * received uses occasion "created" and audience "admin": new applications need
 * staff action. Group and companion submissions share the same success point.
 * changed must eventually use a caller-supplied revision marker, never the wall
 * clock. Deferred events have no wired occasion in this phase. Confirmed,
 * changed and cancelled copy describes customer-visible state for "customer".
 * Audience is future routing metadata; dry-run addresses/sends to nobody.
 *
 * buildDedupeKey is deterministic for kind + entity + occasion. Without a
 * persistent outbox this is NOT exactly-once delivery or durable deduplication.
 */
export type ReservationEventAudience = "customer" | "admin";

export type ReservationEventInput = {
  kind: ReservationNotificationEvent;
  entityId: string;
  occasion: string;
  audience: ReservationEventAudience;
};

export type ReservationEventRecord = {
  kind: ReservationNotificationEvent;
  entityId: string;
  dedupeKey: string;
  audience: ReservationEventAudience;
  occurredAt: Date;
  result: NotificationSendResult;
};

// Fixed status copy only. No recipients, names, financial data, tokens or URLs.
const copyByKind = {
  "application.received": { audience: "admin", title: "새 예약 신청이 접수되었습니다", body: "새 예약 신청을 확인해주세요." },
  "application.confirmed": { audience: "customer", title: "예약이 확정되었습니다", body: "예약 신청이 확정되었습니다." },
  "application.changed": { audience: "customer", title: "예약 신청이 변경되었습니다", body: "예약 신청 상태가 변경되었습니다." },
  "application.cancelled": { audience: "customer", title: "예약 신청이 취소되었습니다", body: "예약 신청이 취소되었습니다." },
} as const;

/** Best-effort event record; notification failures never undo a committed write. */
export async function emitReservationEvent(provider: NotificationProvider, input: ReservationEventInput): Promise<ReservationEventRecord> {
  const occurredAt = new Date();
  let dedupeKey = "";
  let result: NotificationSendResult;
  try {
    dedupeKey = buildDedupeKey(input.kind, input.entityId, input.occasion);
    const copy = copyByKind[input.kind];
    result = copy.audience === input.audience
      ? await notifyReservationEvent(provider, { event: input.kind, dedupeKey, title: copy.title, body: copy.body })
      : { status: "failed", reason: "invalid-event-audience" };
  } catch {
    result = { status: "failed", reason: "invalid-reservation-event" };
  }
  return { kind: input.kind, entityId: input.entityId, dedupeKey, audience: input.audience, occurredAt, result };
}

/** An explicit failure signal suppresses emission; it never turns failure into success. */
export async function emitReservationEventIfSuccessful(
  provider: NotificationProvider,
  successful: boolean,
  input: ReservationEventInput,
): Promise<ReservationEventRecord | null> {
  return successful ? emitReservationEvent(provider, input) : null;
}
