import "server-only";
import { z } from "zod";
import { isAdmin } from "@/lib/auth/roles";

const id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const date = z.date();
const userSchema = z.object({ id, role: z.enum(["ADMIN", "MANAGER", "TEACHER"]), isActive: z.boolean(), mustChangePassword: z.boolean() }).strict();
export type RecipientUser = z.infer<typeof userSchema>;
const actorSchema = z.object({ user: userSchema, assignments: z.array(z.enum(["register", "verify", "purge"])) }).strict();
const evidenceSchema = z.object({ id: z.literal("mock_ownership_v1"), method: z.literal("synthetic_call"), synthetic: z.literal(true), success: z.literal(true), registrationId: id, version: id, verifiedAt: date, verifierId: id }).strict();
const cipherSchema = z.object({ ciphertext: z.instanceof(Buffer).refine((b) => b.length > 0), nonce: z.instanceof(Buffer).refine((b) => b.length === 12), tag: z.instanceof(Buffer).refine((b) => b.length === 16), keyVersion: id, synthetic: z.literal(true) }).strict();
const registrationSchema = z.object({ environment: z.literal("preview"), service: z.literal("application.received"), id, version: id, userId: id, purposeVersion: id, policyVersion: id, state: z.enum(["verification_pending", "verified_inactive", "active", "revoked", "superseded", "purged"]), ciphertext: cipherSchema.nullable(), evidence: evidenceSchema.nullable() }).strict();
export type Registration = z.infer<typeof registrationSchema>;
type Actor = z.infer<typeof actorSchema>;
export type RegistrationAudit = { registrationId: string; version: string; from: Registration["state"] | "unregistered"; to: Registration["state"]; actorId: string; at: Date; reason: "registered" | "verified" | "activated" | "withdrawn" | "replaced" | "verification_stopped" | "purpose_ended" };
type Transition = { registration: Registration; audit: RegistrationAudit };

export function isEligibleAdmin(value: unknown): value is RecipientUser {
  const parsed = userSchema.safeParse(value);
  return parsed.success && isAdmin(parsed.data) && parsed.data.isActive && !parsed.data.mustChangePassword;
}
function actor(value: unknown, assignment: "register" | "verify" | "purge"): Actor {
  const parsed = actorSchema.parse(value);
  if (!isEligibleAdmin(parsed.user) || !parsed.assignments.includes(assignment)) throw new Error("Unauthorized actor.");
  return parsed;
}
function result(registration: Registration, from: RegistrationAudit["from"], actorId: string, at: Date, reason: RegistrationAudit["reason"]): Transition {
  date.parse(at);
  return { registration, audit: { registrationId: registration.id, version: registration.version, from, to: registration.state, actorId, at, reason } };
}
function matchingEvidence(r: Registration): boolean {
  return !!r.evidence && r.evidence.registrationId === r.id && r.evidence.version === r.version;
}
/** Callers must supply current snapshots and make the transition/audit atomic in the later storage phase. */
export function registerRecipient(input: { registration: unknown; actor: unknown; target: unknown; ownWorkNumberConfirmed: boolean; previousVersions: unknown; at: Date }): Transition {
  const r = registrationSchema.parse(input.registration); const a = actor(input.actor, "register");
  const previous = z.array(z.object({ id, version: id, state: z.enum(["verification_pending", "verified_inactive", "active", "revoked", "superseded", "purged"]) }).strict()).parse(input.previousVersions);
  if (previous.some((v) => (v.id === r.id && v.version === r.version) || v.state === "active") || r.state !== "verification_pending" || !r.ciphertext || r.evidence !== null || !isEligibleAdmin(input.target) || input.target.id !== r.userId || input.ownWorkNumberConfirmed !== true) throw new Error("Invalid registration.");
  return result(r, "unregistered", a.user.id, input.at, "registered");
}
export function verifyRecipient(input: { registration: unknown; actor: unknown; target: unknown; evidence: unknown; at: Date }): Transition {
  const r = registrationSchema.parse(input.registration); const a = actor(input.actor, "verify"); const evidence = evidenceSchema.parse(input.evidence);
  if (r.state !== "verification_pending" || !r.ciphertext || r.evidence !== null || !isEligibleAdmin(input.target) || input.target.id !== r.userId || evidence.registrationId !== r.id || evidence.version !== r.version || evidence.verifierId !== a.user.id || evidence.verifiedAt.getTime() !== input.at.getTime()) throw new Error("Invalid verification.");
  return result({ ...r, state: "verified_inactive", evidence }, r.state, a.user.id, input.at, "verified");
}
export function activateRecipient(input: { registration: unknown; actor: unknown; target: unknown; activeRegistration: unknown | null; ciphertextValid: boolean; at: Date }): Transition {
  const r = registrationSchema.parse(input.registration); const a = actor(input.actor, "register");
  if (r.state !== "verified_inactive" || !r.ciphertext || !matchingEvidence(r) || !isEligibleAdmin(input.target) || input.target.id !== r.userId || input.activeRegistration !== null || input.ciphertextValid !== true) throw new Error("Invalid activation.");
  return result({ ...r, state: "active" }, r.state, a.user.id, input.at, "activated");
}
export function revokeRecipient(input: { registration: unknown; actor: unknown; reason: "withdrawn" | "replaced" | "verification_stopped"; at: Date }): Transition {
  const r = registrationSchema.parse(input.registration); const a = actorSchema.parse(input.actor);
  if (!isEligibleAdmin(a.user) || !(a.assignments.includes("register") || (input.reason === "withdrawn" && a.user.id === r.userId)) || !["verification_pending", "verified_inactive", "active"].includes(r.state) || !["withdrawn", "replaced", "verification_stopped"].includes(input.reason)) throw new Error("Invalid revocation.");
  // Purpose ended: erase ciphertext immediately, retaining only number-free reference and evidence.
  return result({ ...r, state: input.reason === "replaced" ? "superseded" : "revoked", ciphertext: null }, r.state, a.user.id, input.at, input.reason);
}
export function purgeRecipient(input: { registration: unknown; actor: unknown; at: Date }): Transition {
  const r = registrationSchema.parse(input.registration);
  const service = z.object({ serviceId: id, authorizedForPurge: z.literal(true) }).strict().safeParse(input.actor);
  const actorId = service.success ? service.data.serviceId : actor(input.actor, "purge").user.id;
  if (r.state !== "revoked" && r.state !== "superseded") throw new Error("Invalid purge.");
  return result({ ...r, state: "purged", ciphertext: null }, r.state, actorId, input.at, "purpose_ended");
}
export function recipientAvailable(value: unknown, target: unknown, fixed: { id: string; version: string; userId: string }): boolean {
  const parsed = registrationSchema.safeParse(value);
  if (!parsed.success || !isEligibleAdmin(target)) return false;
  const r = parsed.data;
  return r.state === "active" && !!r.ciphertext && matchingEvidence(r) && r.id === fixed.id && r.version === fixed.version && r.userId === fixed.userId && target.id === fixed.userId;
}
