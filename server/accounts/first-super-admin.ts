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

// No product endpoint or delivery adapter may enable this while the integration gate is pending.
// Only unit tests or a verified disposable local development database may enable it.
export function firstSuperAdminHarnessEnabled(): boolean {
  if (process.env.YAHO_P7_ISOLATED_HARNESS !== "1" || process.env.VERCEL_ENV) return false;
  if (process.env.NODE_ENV === "test") return true;
  if (process.env.NODE_ENV !== "development") return false;
  try {
    return [process.env.DATABASE_URL, process.env.DIRECT_URL].every(value => {
      const url = new URL(value ?? "");
      return ["postgres:", "postgresql:"].includes(url.protocol) && ["127.0.0.1", "localhost"].includes(url.hostname) && url.port === "55432" && url.pathname === "/yaho_e2e" && url.username === "yaho_e2e";
    });
  } catch { return false; }
}
function assertHarness(): void { if (!firstSuperAdminHarnessEnabled()) reject(); }
async function assertAvailable(tx: Prisma.TransactionClient): Promise<void> {
  if (resolveAccountCutoverMode() !== "LEGACY_ADMIN") reject();
  if (await tx.bootstrapCompletion.findUnique({ where: { id: SINGLETON } })) reject();
  if (await tx.user.findFirst({ where: { role: "SUPER_ADMIN" }, select: { id: true } })) reject();
}
async function assertActor(tx: Prisma.TransactionClient, principal: AdminPrincipal): Promise<void> {
  const actor = await tx.user.findUnique({ where: { id: principal.userId } });
  if (!process.env.YAHO_P7_APPROVER_USER_ID || principal.userId !== process.env.YAHO_P7_APPROVER_USER_ID) reject();
  if (!actor || actor.role !== "ADMIN" || !actor.isActive || actor.mustChangePassword || actor.authVersion !== principal.authVersion) reject();
}
async function locked(tx: Prisma.TransactionClient): Promise<void> { await lockAccountMutations(tx); await assertAvailable(tx); }
function validApproval(a: { approverUserId: string; targetUserId: string; revokedAt: Date | null; consumedAt: Date | null; expiresAt: Date; identityAt: Date; approvedAt: Date; identityMethod: string }, now: Date): boolean {
  return a.approverUserId !== a.targetUserId && !a.revokedAt && !a.consumedAt && a.expiresAt > now && a.identityMethod === "FACE_TO_FACE" && a.identityAt <= a.approvedAt;
}

/** The caller must obtain principal from the live Auth.js request, never from input. */
export async function prepareFirstSuperAdmin(principal: AdminPrincipal, input: unknown, client: Client = prisma) {
  assertHarness();
  const parsed = inputSchema.safeParse(input); if (!parsed.success) reject();
  const { name, email, identityAt } = parsed.data; const now = new Date();
  if (identityAt > now) reject();
  return client.$transaction(async tx => {
    await locked(tx); await assertActor(tx, principal);
    if (await tx.user.findFirst({ where: { email: { equals: email, mode: "insensitive" } }, select: { id: true } })) reject();
    const target = await tx.user.create({ data: { name, email, role: "STAFF", isActive: false, password: null, mustChangePassword: false } });
    if (target.id === principal.userId) reject();
    const approval = await tx.bootstrapApproval.create({ data: { approverUserId: principal.userId, targetUserId: target.id, targetEmail: email, approvedAt: now, expiresAt: new Date(now.getTime() + TTL), identityMethod: "FACE_TO_FACE", identityAt } });
    return { approvalId: approval.id, targetUserId: target.id };
  });
}

/** Returns a raw token only to an isolated harness's fake delivery adapter. */
export async function issueFirstSuperAdminToken(principal: AdminPrincipal, approvalId: string, client: Client = prisma) {
  assertHarness();
  const token = generateApplicationCapabilityToken();
  await client.$transaction(async tx => {
    await locked(tx); await assertActor(tx, principal);
    const now = new Date();
    const a = await tx.bootstrapApproval.findUnique({ where: { id: approvalId } });
    if (!a || a.approverUserId !== principal.userId || !validApproval(a, now)) reject();
    const target = await tx.user.findUnique({ where: { id: a.targetUserId } });
    if (!target || target.email !== a.targetEmail || target.role !== "STAFF" || target.isActive || target.authVersion !== 1 || target.password !== null) reject();
    await tx.bootstrapAcceptance.updateMany({ where: { approvalId, acceptedAt: null, revokedAt: null }, data: { revokedAt: now } });
    await tx.bootstrapAcceptance.create({ data: { approvalId, acceptedForUserId: a.targetUserId, targetEmail: a.targetEmail, tokenHash: hashApplicationCapabilityToken(token), expiresAt: new Date(now.getTime() + TTL) } });
  });
  return token;
}
export async function revokeFirstSuperAdmin(principal: AdminPrincipal, approvalId: string, client: Client = prisma) {
  assertHarness();
  await client.$transaction(async tx => {
    await locked(tx); await assertActor(tx, principal);
    const a = await tx.bootstrapApproval.findUnique({ where: { id: approvalId } });
    if (!a || a.approverUserId !== principal.userId || a.revokedAt || a.consumedAt) reject();
    const now = new Date();
    await tx.bootstrapApproval.update({ where: { id: approvalId }, data: { revokedAt: now } });
    await tx.bootstrapAcceptance.updateMany({ where: { approvalId, consumedAt: null, revokedAt: null }, data: { revokedAt: now } });
  });
}
export async function acceptFirstSuperAdmin(token: string, password: string, client: Client = prisma) {
  assertHarness();
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
export async function executeFirstSuperAdmin(principal: AdminPrincipal, approvalId: string, acceptanceId: string, client: Client = prisma) {
  assertHarness();
  return client.$transaction(async tx => {
    await locked(tx); await assertActor(tx, principal);
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
export async function getFirstSuperAdminAcceptanceState(token: string): Promise<boolean> {
  assertHarness();
  if (!isWellFormedApplicationLinkToken(token)) return false;
  return prisma.$transaction(async tx => {
    await locked(tx);
    const b = await tx.bootstrapAcceptance.findUnique({ where: { tokenHash: hashApplicationCapabilityToken(token) } });
    return !!b && !b.acceptedAt && !b.revokedAt && !b.consumedAt && b.expiresAt > new Date();
  });
}
