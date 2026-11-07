import "server-only";
import { z } from "zod";
import { isEligibleAdmin } from "@/server/kakao/recipient-registration";

const id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const date = z.date();
const userSchema = z.object({ id, role: z.enum(["ADMIN", "MANAGER", "TEACHER"]), isActive: z.boolean(), mustChangePassword: z.boolean() }).strict();
const actorSchema = z.object({ user: userSchema, assignments: z.array(z.enum(["register", "verify", "purge"])) }).strict();

/** An ADMIN attests to a phone call completed outside this system. */
export const realOwnershipEvidenceSchema = z.object({
  id: z.literal("operator_call_verified"),
  method: z.literal("operator_call"),
  success: z.literal(true),
  registrationId: z.string().min(1),
  version: z.string().min(1),
  verifierId: z.string().min(1),
  verifiedAt: z.date(),
}).strict();
export const realCipherSchema = z.object({
  ciphertext: z.instanceof(Buffer).refine((value) => value.length > 0),
  nonce: z.instanceof(Buffer).refine((value) => value.length === 12),
  tag: z.instanceof(Buffer).refine((value) => value.length === 16),
  keyVersion: id,
}).strict();
export const realRegistrationSchema = z.object({
  environment: z.literal("preview"), service: z.literal("application.received"),
  id, version: id, userId: id, purposeVersion: id, policyVersion: id,
  state: z.enum(["verification_pending", "verified_inactive", "active", "revoked", "superseded", "purged"]),
  ciphertext: realCipherSchema.nullable(), evidence: realOwnershipEvidenceSchema.nullable(),
}).strict();
export type RealRegistration = z.infer<typeof realRegistrationSchema>;
export type RealOwnershipEvidence = z.infer<typeof realOwnershipEvidenceSchema>;
type Actor = z.infer<typeof actorSchema>;
type RegistrationAudit = {
  registrationId: string; version: string; from: RealRegistration["state"] | "unregistered";
  to: RealRegistration["state"]; actorId: string; at: Date;
  reason: "registered" | "verified" | "activated" | "withdrawn" | "replaced" | "verification_stopped";
};
type Transition = { registration: RealRegistration; audit: RegistrationAudit };

function actor(value: unknown, assignment: "register" | "verify"): Actor {
  const parsed = actorSchema.parse(value);
  if (!isEligibleAdmin(parsed.user) || !parsed.assignments.includes(assignment)) throw new Error("Unauthorized actor.");
  return parsed;
}
function result(registration: RealRegistration, from: RegistrationAudit["from"], actorId: string, at: Date, reason: RegistrationAudit["reason"]): Transition {
  date.parse(at);
  return { registration, audit: { registrationId: registration.id, version: registration.version, from, to: registration.state, actorId, at, reason } };
}
function matchingEvidence(registration: RealRegistration): boolean {
  const proof = registration.evidence;
  return !!proof && proof.registrationId === registration.id && proof.version === registration.version && proof.verifierId !== registration.userId;
}

/** Storage must commit each transition and its audit atomically. */
export function registerRealRecipient(input: { registration: unknown; actor: unknown; target: unknown; ownWorkNumberConfirmed: boolean; previousVersions: unknown; at: Date }): Transition {
  const registration = realRegistrationSchema.parse(input.registration);
  const operator = actor(input.actor, "register");
  const previous = z.array(z.object({ id, version: id, state: realRegistrationSchema.shape.state }).strict()).parse(input.previousVersions);
  if (previous.some((row) => (row.id === registration.id && row.version === registration.version) || row.state === "active") || registration.state !== "verification_pending" || !registration.ciphertext || registration.evidence !== null || !isEligibleAdmin(input.target) || input.target.id !== registration.userId || input.ownWorkNumberConfirmed !== true) throw new Error("Invalid registration.");
  return result(registration, "unregistered", operator.user.id, input.at, "registered");
}

export function verifyRealRecipient(input: { registration: unknown; actor: unknown; target: unknown; evidence: unknown; at: Date }): Transition {
  const registration = realRegistrationSchema.parse(input.registration);
  const operator = actor(input.actor, "verify");
  const evidence = realOwnershipEvidenceSchema.parse(input.evidence);
  date.parse(input.at);
  if (registration.state !== "verification_pending" || !registration.ciphertext || registration.evidence !== null || !isEligibleAdmin(input.target) || input.target.id !== registration.userId || evidence.registrationId !== registration.id || evidence.version !== registration.version || evidence.verifierId !== operator.user.id || evidence.verifierId === registration.userId || evidence.verifiedAt.getTime() !== input.at.getTime()) throw new Error("Invalid verification.");
  return result({ ...registration, state: "verified_inactive", evidence }, registration.state, operator.user.id, input.at, "verified");
}

export function activateRealRecipient(input: { registration: unknown; actor: unknown; target: unknown; activeRegistration: unknown | null; ciphertextValid: boolean; at: Date }): Transition {
  const registration = realRegistrationSchema.parse(input.registration);
  const operator = actor(input.actor, "register");
  if (registration.state !== "verified_inactive" || !registration.ciphertext || !matchingEvidence(registration) || !isEligibleAdmin(input.target) || input.target.id !== registration.userId || input.activeRegistration !== null || input.ciphertextValid !== true) throw new Error("Invalid activation.");
  return result({ ...registration, state: "active" }, registration.state, operator.user.id, input.at, "activated");
}

export function revokeRealRecipient(input: { registration: unknown; actor: unknown; reason: "withdrawn" | "replaced" | "verification_stopped"; at: Date }): Transition {
  const registration = realRegistrationSchema.parse(input.registration);
  const operator = actorSchema.parse(input.actor);
  if (!isEligibleAdmin(operator.user) || !(operator.assignments.includes("register") || (input.reason === "withdrawn" && operator.user.id === registration.userId)) || !["verification_pending", "verified_inactive", "active"].includes(registration.state) || !["withdrawn", "replaced", "verification_stopped"].includes(input.reason)) throw new Error("Invalid revocation.");
  return result({ ...registration, state: input.reason === "replaced" ? "superseded" : "revoked", ciphertext: null }, registration.state, operator.user.id, input.at, input.reason);
}

export function recipientAvailableReal(value: unknown, target: unknown, fixed: { id: string; version: string; userId: string }): boolean {
  const parsed = realRegistrationSchema.safeParse(value);
  if (!parsed.success || !isEligibleAdmin(target)) return false;
  const registration = parsed.data;
  return registration.state === "active" && !!registration.ciphertext && matchingEvidence(registration) && registration.id === fixed.id && registration.version === fixed.version && registration.userId === fixed.userId && target.id === fixed.userId;
}
