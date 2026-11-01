import { hash } from "bcryptjs";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { resolveAccountCutoverMode } from "@/lib/auth/cutover-mode";
import type { AdminPrincipal } from "@/lib/auth/principal";
import { lockAccountMutations } from "@/lib/auth/account-lock";
import { generateApplicationCapabilityToken, hashApplicationCapabilityToken, isWellFormedApplicationLinkToken } from "@/lib/reservation-applications/token";

const TTL = 72 * 60 * 60 * 1000;
const SINGLETON = "FIRST_SUPER_ADMIN";
const inputSchema = z.object({ name: z.string().trim().min(1).max(100), email: z.string().trim().email().max(254).transform(v => v.toLowerCase()), identityAt: z.union([z.string().min(1), z.date()]).pipe(z.coerce.date()) });
const passwordSchema = z.string().min(8).max(128);
type Client = Pick<typeof prisma, "$transaction">;
export class BootstrapError extends Error { constructor() { super("BOOTSTRAP_REJECTED"); } }
function reject(): never { throw new BootstrapError(); }

async function assertAvailable(tx: Prisma.TransactionClient): Promise<void> {
  if (resolveAccountCutoverMode() !== "LEGACY_ADMIN") reject();
  if (await tx.bootstrapCompletion.findUnique({ where: { id: SINGLETON } })) reject();
  if (await tx.user.findFirst({ where: { role: "SUPER_ADMIN" }, select: { id: true } })) reject();
}
async function assertActor(tx: Prisma.TransactionClient, principal: AdminPrincipal, approverId: string | undefined, strictPrincipal: boolean): Promise<void> {
  const actor = await tx.user.findUnique({ where: { id: principal.userId } });
  if (!approverId || principal.userId !== approverId) reject();
  if (!actor || actor.role !== "ADMIN" || !actor.isActive || actor.mustChangePassword || actor.authVersion !== principal.authVersion) reject();
  if (strictPrincipal && (principal.role !== "ADMIN" || principal.mustChangePassword !== actor.mustChangePassword)) reject();
}
async function locked(tx: Prisma.TransactionClient): Promise<void> { await lockAccountMutations(tx); await assertAvailable(tx); }
function validApproval(a: { approverUserId: string; targetUserId: string; revokedAt: Date | null; consumedAt: Date | null; expiresAt: Date; identityAt: Date; approvedAt: Date; identityMethod: string }, now: Date): boolean {
  return a.approverUserId !== a.targetUserId && !a.revokedAt && !a.consumedAt && a.expiresAt > now && a.identityMethod === "FACE_TO_FACE" && a.identityAt <= a.approvedAt;
}

type Policy = { enabled: () => boolean; approverId: () => string | undefined; strictPrincipal?: boolean };
export function createFirstSuperAdminCore(policy: Policy) {
  function assertEnabled() { if (!policy.enabled()) reject(); }
/** The caller must obtain principal from the live Auth.js request, never from input. */
async function prepareFirstSuperAdmin(principal: AdminPrincipal, input: unknown, client: Client = prisma) {
  assertEnabled();
  const parsed = inputSchema.safeParse(input); if (!parsed.success) reject();
  const { name, email, identityAt } = parsed.data; const now = new Date();
  if (identityAt > now) reject();
  return client.$transaction(async tx => {
    await locked(tx); await assertActor(tx, principal, policy.approverId(), policy.strictPrincipal === true);
    if (await tx.user.findFirst({ where: { email: { equals: email, mode: "insensitive" } }, select: { id: true } })) reject();
    const target = await tx.user.create({ data: { name, email, role: "STAFF", isActive: false, password: null, mustChangePassword: false } });
    if (target.id === principal.userId) reject();
    const approval = await tx.bootstrapApproval.create({ data: { approverUserId: principal.userId, targetUserId: target.id, targetEmail: email, approvedAt: now, expiresAt: new Date(now.getTime() + TTL), identityMethod: "FACE_TO_FACE", identityAt } });
    return { approvalId: approval.id, targetUserId: target.id };
  });
}

/** Returns a raw token only to an isolated harness's fake delivery adapter. */
async function issueFirstSuperAdminToken(principal: AdminPrincipal, approvalId: string, client: Client = prisma, provider?: string) {
  assertEnabled();
  const token = generateApplicationCapabilityToken();
  await client.$transaction(async tx => {
    await locked(tx); await assertActor(tx, principal, policy.approverId(), policy.strictPrincipal === true);
    const now = new Date();
    const a = await tx.bootstrapApproval.findUnique({ where: { id: approvalId } });
    if (!a || a.approverUserId !== principal.userId || !validApproval(a, now)) reject();
    const target = await tx.user.findUnique({ where: { id: a.targetUserId } });
    if (!target || target.email !== a.targetEmail || target.role !== "STAFF" || target.isActive || target.authVersion !== 1 || target.password !== null) reject();
    await tx.bootstrapAcceptance.updateMany({ where: { approvalId, acceptedAt: null, revokedAt: null }, data: { revokedAt: now } });
    const acceptance = await tx.bootstrapAcceptance.create({ data: { approvalId, acceptedForUserId: a.targetUserId, targetEmail: a.targetEmail, tokenHash: hashApplicationCapabilityToken(token), expiresAt: new Date(now.getTime() + TTL) } });
    if (provider) await tx.bootstrapDeliveryAttempt.create({ data: { acceptanceId: acceptance.id, provider } });
  });
  return token;
}
async function revokeFirstSuperAdmin(principal: AdminPrincipal, approvalId: string, client: Client = prisma) {
  assertEnabled();
  await client.$transaction(async tx => {
    await locked(tx); await assertActor(tx, principal, policy.approverId(), policy.strictPrincipal === true);
    const a = await tx.bootstrapApproval.findUnique({ where: { id: approvalId } });
    if (!a || a.approverUserId !== principal.userId || a.revokedAt || a.consumedAt) reject();
    const now = new Date();
    await tx.bootstrapApproval.update({ where: { id: approvalId }, data: { revokedAt: now } });
    await tx.bootstrapAcceptance.updateMany({ where: { approvalId, consumedAt: null, revokedAt: null }, data: { revokedAt: now } });
  });
}
async function acceptFirstSuperAdmin(token: string, password: string, client: Client = prisma) {
  assertEnabled();
  if (!isWellFormedApplicationLinkToken(token) || !passwordSchema.safeParse(password).success) reject();
  const passwordHash = await hash(password, 12);
  await client.$transaction(async tx => {
    await locked(tx);
    const now = new Date();
    const b = await tx.bootstrapAcceptance.findUnique({ where: { tokenHash: hashApplicationCapabilityToken(token) } });
    if (!b || b.revokedAt || b.acceptedAt || b.consumedAt || b.expiresAt <= now) reject();
    const a = await tx.bootstrapApproval.findUnique({ where: { id: b.approvalId } });
    const target = await tx.user.findUnique({ where: { id: b.acceptedForUserId } });
    if (!a || !validApproval(a, now) || a.targetUserId !== b.acceptedForUserId || a.targetEmail !== b.targetEmail || !target || target.email !== b.targetEmail || target.role !== "STAFF" || target.isActive || target.authVersion !== 1 || target.password !== null) reject();
    await tx.user.update({ where: { id: target.id }, data: { password: passwordHash, mustChangePassword: true } });
    await tx.bootstrapAcceptance.update({ where: { id: b.id }, data: { acceptedAt: now, tokenVerified: true, authenticationMethod: "TOKEN_POSSESSION" } });
  });
}
async function executeFirstSuperAdmin(principal: AdminPrincipal, approvalId: string, acceptanceId: string, client: Client = prisma) {
  assertEnabled();
  return client.$transaction(async tx => {
    await locked(tx); await assertActor(tx, principal, policy.approverId(), policy.strictPrincipal === true);
    const now = new Date();
    const a = await tx.bootstrapApproval.findUnique({ where: { id: approvalId } });
    const b = await tx.bootstrapAcceptance.findUnique({ where: { id: acceptanceId } });
    if (!a || !validApproval(a, now) || a.approverUserId !== principal.userId || !b || b.approvalId !== a.id || b.acceptedForUserId !== a.targetUserId || b.targetEmail !== a.targetEmail || !b.acceptedAt || !b.tokenVerified || b.authenticationMethod !== "TOKEN_POSSESSION" || b.revokedAt || b.consumedAt || b.expiresAt <= now) reject();
    const target = await tx.user.findUnique({ where: { id: a.targetUserId } });
    if (!target || target.email !== a.targetEmail || target.role !== "STAFF" || target.isActive || target.authVersion !== 1 || !target.password || !target.mustChangePassword || target.teacherId !== null) reject();
    await tx.user.update({ where: { id: target.id }, data: { role: "SUPER_ADMIN", isActive: true, authVersion: { increment: 1 }, mustChangePassword: true } });
    await tx.bootstrapApproval.update({ where: { id: a.id }, data: { consumedAt: now, executionId: SINGLETON } });
    await tx.bootstrapAcceptance.update({ where: { id: b.id }, data: { consumedAt: now, executionId: SINGLETON } });
    await tx.userAccountChange.create({ data: { targetUserId: target.id, actorAdminId: principal.userId, type: "CREATED", previousRole: "STAFF", nextRole: "SUPER_ADMIN", previousIsActive: false, nextIsActive: true, nextEmail: target.email } });
    await tx.bootstrapCompletion.create({ data: { id: SINGLETON, approvalId: a.id, acceptanceId: b.id, completedAt: now } });
    return { targetUserId: target.id };
  });
}

/** Read-only GET state; token and account details are never returned. */
async function getFirstSuperAdminAcceptanceState(token: string): Promise<boolean> {
  assertEnabled();
  if (!isWellFormedApplicationLinkToken(token)) return false;
  return prisma.$transaction(async tx => {
    await locked(tx);
    const b = await tx.bootstrapAcceptance.findUnique({ where: { tokenHash: hashApplicationCapabilityToken(token) } });
    const now = new Date();
    if (!b || b.acceptedAt || b.revokedAt || b.consumedAt || b.expiresAt <= now) return false;
    const a = await tx.bootstrapApproval.findUnique({ where: { id: b.approvalId } });
    return !!a && validApproval(a, now) && a.targetUserId === b.acceptedForUserId && a.targetEmail === b.targetEmail;
  });
}

  return { prepareFirstSuperAdmin, issueFirstSuperAdminToken, revokeFirstSuperAdmin, acceptFirstSuperAdmin, executeFirstSuperAdmin, getFirstSuperAdminAcceptanceState };
}
