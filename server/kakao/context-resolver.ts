import "server-only";
import { z } from "zod";
import { dispatchContextSchema, realDispatchContextSchema } from "@/lib/kakao/send-contract";
import { formatSubmittedAt, TEMPLATE_ID, TEMPLATE_VERSION } from "@/lib/kakao/template";
import { recipientAvailable } from "@/server/kakao/recipient-registration";
import { recipientAvailableReal } from "@/server/kakao/recipient-registration-real";

// A future repository must select only these fields; this module performs no lookup.
export const submissionSelect = { id: true, submittedAt: true, personalDataPurgedAt: true } as const;
const submissionSchema = z.object({ id: z.string().min(1), submittedAt: z.date(), personalDataPurgedAt: z.date().nullable() }).strict();
const requestSchema = z.object({ event: z.literal("application.received"), audience: z.literal("admin"), entityId: z.string().min(1), dedupeKey: z.string().regex(/^application\.received:[a-f0-9]{64}$/), recipient: z.object({ id: z.string(), version: z.string(), userId: z.string() }).strict() }).strict();
export function resolveDispatchContext(input: { request: unknown; submission: unknown; registration: unknown; target: unknown }): { ok: true; context: z.infer<typeof dispatchContextSchema> } | { ok: false; reason: "unsupported_event" | "entity_unavailable" | "recipient_unavailable" } {
  const request = requestSchema.safeParse(input.request);
  if (!request.success) return { ok: false, reason: "unsupported_event" };
  const submission = submissionSchema.safeParse(input.submission);
  if (!submission.success || submission.data.id !== request.data.entityId || submission.data.personalDataPurgedAt !== null) return { ok: false, reason: "entity_unavailable" };
  if (!recipientAvailable(input.registration, input.target, request.data.recipient)) return { ok: false, reason: "recipient_unavailable" };
  let formatted: string;
  try { formatted = formatSubmittedAt(submission.data.submittedAt); } catch { return { ok: false, reason: "entity_unavailable" }; }
  const candidate = dispatchContextSchema.safeParse({ event: request.data.event, audience: request.data.audience, dedupeKey: request.data.dedupeKey, recipientId: request.data.recipient.id, recipientVersion: request.data.recipient.version, submittedAt: submission.data.submittedAt, templateId: TEMPLATE_ID, templateVersion: TEMPLATE_VERSION, variables: { 접수시각: formatted } });
  return candidate.success ? { ok: true, context: candidate.data } : { ok: false, reason: "entity_unavailable" };
}

/** Real counterpart of resolveDispatchContext: same validation, but templateId/templateVersion come from arguments and recipient availability uses recipientAvailableReal. */
export function resolveRealDispatchContext(input: { request: unknown; submission: unknown; registration: unknown; target: unknown; templateId: string; templateVersion: string }): { ok: true; context: z.infer<typeof realDispatchContextSchema> } | { ok: false; reason: string } {
  const request = requestSchema.safeParse(input.request);
  if (!request.success) return { ok: false, reason: "unsupported_event" };
  const submission = submissionSchema.safeParse(input.submission);
  if (!submission.success || submission.data.id !== request.data.entityId || submission.data.personalDataPurgedAt !== null) return { ok: false, reason: "entity_unavailable" };
  if (!recipientAvailableReal(input.registration, input.target, request.data.recipient)) return { ok: false, reason: "recipient_unavailable" };
  let formatted: string;
  try { formatted = formatSubmittedAt(submission.data.submittedAt); } catch { return { ok: false, reason: "entity_unavailable" }; }
  const candidate = realDispatchContextSchema.safeParse({ event: request.data.event, audience: request.data.audience, dedupeKey: request.data.dedupeKey, recipientId: request.data.recipient.id, recipientVersion: request.data.recipient.version, submittedAt: submission.data.submittedAt, templateId: input.templateId, templateVersion: input.templateVersion, variables: { 접수시각: formatted } });
  return candidate.success ? { ok: true, context: candidate.data } : { ok: false, reason: "entity_unavailable" };
}
