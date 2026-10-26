import { createHash } from "node:crypto";
import { z } from "zod";

export const eventSchema = z.enum(["application.received", "application.confirmed", "application.changed", "application.cancelled"]);
export type ReservationNotificationEvent = z.infer<typeof eventSchema>;
export type NotificationSendResult = { status: "sent" | "skipped" | "failed"; reason?: string };

const nonEmptySchema = z.string().refine((value) => value.trim().length > 0);
const notificationSchema = z.object({
  event: eventSchema,
  dedupeKey: nonEmptySchema,
  title: nonEmptySchema,
  body: nonEmptySchema,
}).strict();
type NotificationInput = z.infer<typeof notificationSchema>;

/** No recipients or customer objects: title/body must be non-PII copy only. */
export interface NotificationProvider {
  send(input: NotificationInput): Promise<NotificationSendResult>;
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** A dry-run provider: it never sends a message and always reports skipped. */
export class LogNotificationProvider implements NotificationProvider {
  constructor(private readonly log: (line: string) => void = (line) => console.info(line)) {}

  async send(input: NotificationInput): Promise<NotificationSendResult> {
    const parsed = notificationSchema.safeParse(input);
    if (!parsed.success) throw new Error("Invalid notification input.");
    const result = { status: "skipped", reason: "log-only-provider" } as const;
    // The logged dedupeKey is an opaque correlation digest, even if a caller
    // mistakenly supplies an ID. Never log title/body, recipients or raw keys.
    this.log(JSON.stringify({ event: parsed.data.event, dedupeKey: digest(parsed.data.dedupeKey), result }));
    return result;
  }
}

const resultSchema = z.object({ status: z.enum(["sent", "skipped", "failed"]), reason: z.string().optional() }).strict();

/** Best-effort only: invalid input and provider failures never break a workflow. */
export async function notifyReservationEvent(provider: NotificationProvider, input: NotificationInput): Promise<NotificationSendResult> {
  try {
    const parsed = notificationSchema.safeParse(input);
    if (!parsed.success) return { status: "failed", reason: "invalid-notification-input" };
    const result = resultSchema.safeParse(await provider.send(parsed.data));
    if (!result.success) return { status: "failed", reason: "invalid-provider-result" };
    // Provider reasons are untrusted and may contain an upstream response/PII.
    // Expose only a fixed reason code; never reflect exception messages either.
    return result.data.reason === undefined
      ? { status: result.data.status }
      : { status: result.data.status, reason: `provider-${result.data.status}` };
  } catch {
    return { status: "failed", reason: "provider-error" };
  }
}

/**
 * Deterministic, opaque contract for a future outbox key; JSON tuple encoding
 * avoids delimiter collisions and never exposes the raw entity ID or occasion.
 * Persistent cross-process deduplication requires a future DB outbox table
 * (a schema decision, NOT this phase). No local set/cache claims deduplication.
 */
export function buildDedupeKey(event: ReservationNotificationEvent, entityId: string, occasion: string): string {
  if (!eventSchema.safeParse(event).success || !nonEmptySchema.safeParse(entityId).success || !nonEmptySchema.safeParse(occasion).success) {
    throw new Error("Invalid notification dedupe input.");
  }
  return `${event}:${digest(JSON.stringify([entityId, occasion]))}`;
}
