import "server-only";
import { createCipheriv, createDecipheriv } from "node:crypto";
import { z } from "zod";

// These are G2 synthetic contracts, not a provider API specification.
export const providerRefSchema = z.union([
  z.string().regex(/^g2ref_[a-f0-9]{32}$/),
  z.string().regex(/^M4V[0-9]{14}[0-9A-Za-z]{14}$/),
]);
export const sendErrorCodeSchema = z.enum(["provider_unconfigured", "provider_error", "provider_timeout", "invalid_payload", "provider_rate_limited", "provider_result_unknown", "provider_auth_error", "provider_balance_low", "provider_config_error", "template_invalid", "recipient_invalid", "recipient_unreachable", "attempt_limit"]);
export const sendSkipCodeSchema = z.enum(["send_disabled", "unsupported_event", "entity_unavailable", "recipient_unavailable", "event_expired", "before_activation", "cost_limit"]);
const identifier = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
export const dispatchContextSchema = z.object({
  event: z.literal("application.received"), audience: z.literal("admin"),
  dedupeKey: z.string().regex(/^application\.received:[a-f0-9]{64}$/),
  recipientId: identifier, recipientVersion: identifier,
  submittedAt: z.date(), templateId: z.literal("mock_application_received_v1"),
  templateVersion: z.literal("g2-v1"), variables: z.object({ 접수시각: z.string().regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/) }).strict(),
}).strict().refine((context) => {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(context.submittedAt);
  const get = (type: string) => parts.find((part) => part.type === type)?.value;
  return context.variables.접수시각 === `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}`;
});
const realDispatchContextSchema = z.object({
  event: z.literal("application.received"), audience: z.literal("admin"),
  dedupeKey: z.string().regex(/^application\.received:[a-f0-9]{64}$/),
  recipientId: identifier, recipientVersion: identifier,
  submittedAt: z.date(), templateId: identifier,
  templateVersion: identifier, variables: z.object({ 접수시각: z.string().regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/) }).strict(),
}).strict().refine((context) => {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(context.submittedAt);
  const get = (type: string) => parts.find((part) => part.type === type)?.value;
  return context.variables.접수시각 === `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}`;
});
export const dispatchPermitSchema = z.object({ dispatchId: identifier, slotId: identifier, claimToken: identifier, providerId: z.literal("solapi"), context: z.union([dispatchContextSchema, realDispatchContextSchema]) }).strict();
export const renderedBodySchema = z.string().refine((body) => { const length = Array.from(body).length; return length >= 1 && length <= 1000; });
// Validation only; template rendering and source lookup belong to P3.
export const syntheticTemplateContentSchema = z.object({
  context: dispatchContextSchema,
  body: renderedBodySchema,
}).strict().refine(({ context, body }) => body === `새 예약 신청이 접수되었습니다. 접수 시각: ${context.variables.접수시각}. YAHO 관리자 화면에서 확인해주세요.`);
export const providerResultSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("accepted"), providerId: z.literal("solapi"), ref: providerRefSchema, phase: z.enum(["accepted", "awaiting_final"]) }).strict(),
  z.object({ status: z.literal("definite_rejection"), retryable: z.boolean(), nonBillableEvidence: z.boolean() }).strict(),
  z.object({ status: z.literal("unknown"), code: sendErrorCodeSchema.optional() }).strict(),
]);
export type ProviderResult = z.infer<typeof providerResultSchema>;
export function normalizeProviderResult(value: unknown): ProviderResult {
  const result = providerResultSchema.safeParse(value);
  return result.success ? result.data : { status: "unknown" };
}

const bindingSchema = z.object({ environment: z.literal("preview"), registrationId: identifier, registrationVersion: identifier, keyVersion: identifier }).strict();
export type RecipientBinding = z.infer<typeof bindingSchema>;
export function recipientAad(value: unknown): Buffer {
  const binding = bindingSchema.parse(value);
  const values = ["yaho-kakao-recipient-v1", binding.environment, binding.registrationId, binding.registrationVersion, binding.keyVersion];
  return Buffer.concat(values.flatMap((item) => { const bytes = Buffer.from(item, "utf8"); const size = Buffer.alloc(4); size.writeUInt32BE(bytes.length); return [size, bytes]; }));
}
export function nonceFromSequence(sequence: bigint): Buffer {
  if (sequence < 1n || sequence > (1n << 63n) - 1n) throw new Error("Invalid nonce sequence.");
  const nonce = Buffer.alloc(12); nonce.writeBigUInt64BE(sequence, 4); return nonce;
}
// These attestations are inputs to a pure contract, not proof of persistence.
// P2+P4 must atomically issue the nonce and enforce the recovery conditions.
const cryptoSafetySchema = z.object({ counterCommitted: z.literal(true), counterCurrent: z.literal(true), nonceUnused: z.literal(true), keyActive: z.literal(true), recoveryVerified: z.literal(true), registrationActive: z.literal(true), rotationComplete: z.literal(true) }).strict();
export type CryptoSafety = z.infer<typeof cryptoSafetySchema>;
export type Ciphertext = { ciphertext: Buffer; nonce: Buffer; tag: Buffer };
export function encryptSyntheticRecipient(plaintext: Buffer, key: Buffer, sequence: bigint, binding: RecipientBinding, safety: CryptoSafety): Ciphertext {
  cryptoSafetySchema.parse(safety);
  if (!Buffer.isBuffer(plaintext) || !plaintext.length || !Buffer.isBuffer(key) || key.length !== 32) throw new Error("Invalid encryption input.");
  const nonce = nonceFromSequence(sequence);
  const cipher = createCipheriv("aes-256-gcm", key, nonce, { authTagLength: 16 });
  cipher.setAAD(recipientAad(binding));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return { ciphertext, nonce, tag: cipher.getAuthTag() };
}
export function decryptSyntheticRecipient(value: Ciphertext, key: Buffer, binding: RecipientBinding, safety: CryptoSafety): Buffer {
  cryptoSafetySchema.parse(safety);
  if (!Buffer.isBuffer(key) || key.length !== 32 || !Buffer.isBuffer(value.ciphertext) || !value.ciphertext.length || !Buffer.isBuffer(value.nonce) || value.nonce.length !== 12 || !Buffer.isBuffer(value.tag) || value.tag.length !== 16) throw new Error("Invalid encryption input.");
  const decipher = createDecipheriv("aes-256-gcm", key, value.nonce, { authTagLength: 16 });
  decipher.setAAD(recipientAad(binding)); decipher.setAuthTag(value.tag);
  return Buffer.concat([decipher.update(value.ciphertext), decipher.final()]);
}
