import "server-only";
import { z } from "zod";

const id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/).refine((value) => !/^[0-9_-]{7,}$/.test(value));
const code = z.enum(["synthetic_fresh_key", "operator_stop", "provider_incident", "cost_incident", "security_incident", "recovery_pending", "provider_unconfigured", "provider_error", "provider_timeout", "invalid_payload", "provider_rate_limited", "provider_result_unknown", "provider_auth_error", "provider_balance_low", "provider_config_error", "template_invalid", "recipient_invalid", "recipient_unreachable", "attempt_limit", "send_disabled", "unsupported_event", "entity_unavailable", "recipient_unavailable", "event_expired", "before_activation", "cost_limit"]);
const auditSchema = z.object({
  eventId: id, environment: z.literal("preview"),
  eventType: z.enum(["permit_issued", "result_unknown", "result_recorded", "cost_reconciled", "cost_adjust_approved", "send_blocked", "command_failed", "details_purged", "details_purge_approved", "recipient_purge_approved", "recipient_purged", "nonce_consumed", "recipient_reencrypted", "key_rotation_approved", "key_rotation_started", "key_rotation_completed", "closure_approved", "closed_unconfirmed"]),
  occurredAt: z.date(), registrationId: id.optional(), outboxId: id.optional(), dispatchId: id.optional(), slotId: id.optional(),
  fromState: id.optional(), toState: id.optional(), code: code.optional(), actorId: id.optional(),
  commandId: id.optional(), approvalId: id.optional(), evidenceId: id.optional(), policyVersion: id.optional(), keyVersion: id.optional(),
  sequence: z.number().int().positive().optional(), revisionBefore: z.number().int().nonnegative().optional(), revisionAfter: z.number().int().nonnegative().optional(),
}).strict();
export type NotificationAuditInput = z.infer<typeof auditSchema>;
export interface AuditTransaction {
  notificationAudit: { create(args: { data: NotificationAuditInput }): Promise<unknown> };
}
/** Must receive the same transaction as the state change, never a global client. */
export async function appendNotificationAudit(tx: AuditTransaction, value: unknown): Promise<void> {
  const data = auditSchema.parse(value);
  await tx.notificationAudit.create({ data });
}
