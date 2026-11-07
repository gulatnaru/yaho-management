"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdminOrSuperAdminPrincipal } from "@/lib/auth/authorization";
import { prisma } from "@/lib/db/prisma";
import { PrismaDispatchRepository } from "@/server/kakao/dispatch-repository";
import { isEligibleAdmin } from "@/server/kakao/recipient-registration";
import {
  activatePrismaRealRecipient, recordPrismaRealOwnership, registerPrismaRealRecipient,
  revokePrismaRealRecipient, verifyPrismaRealRecipient,
} from "@/server/kakao/recipient-storage-real";
import { setPrismaRecipientAssignment } from "@/server/kakao/runtime-settings";

export type RecipientActionResult = { ok: true; message: string; maskedPhone?: string } | { ok: false; error: string };
const path = "/reservation-applications/notifications/recipients";
const id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/).refine((value) => !/(?:\d[-_]*){7,}/.test(value));
const checked = z.literal("on");
const registrationForm = z.object({
  phoneNumber: z.string().trim().regex(/^[0-9 -]{9,32}$/).transform((value) => value.replace(/[ -]/g, "")).pipe(z.string().regex(/^\d{9,15}$/)),
  ownWorkNumberConfirmed: checked,
}).strict();
const verificationForm = z.object({ registrationId: id, verifierSelfConfirmed: checked, callCompletedConfirmed: checked }).strict();
const referenceForm = z.object({ registrationId: id }).strict();
const revokeForm = referenceForm.extend({ reason: z.enum(["withdrawn", "replaced", "verification_stopped"]) });
const assignmentForm = z.object({ executorId: id, assignment: z.enum(["register", "verify"]), operation: z.enum(["grant", "revoke"]) }).strict();
class ActionError extends Error {}

/** Keep generated references free of number-like sequences, as required by the store. */
function reference(): string {
  return randomUUID().replace(/[0-9]/g, (digit) => String.fromCharCode(103 + Number(digit)));
}
async function recipientKey(): Promise<{ keyVersion: string; key: Buffer }> {
  const encoded = process.env.KAKAO_RECIPIENT_KEY;
  if (!encoded || !/^[A-Za-z0-9+/]{43}=$/.test(encoded)) throw new ActionError("수신자 키가 설정되지 않았습니다");
  const key = Buffer.from(encoded, "base64");
  try {
    if (key.length !== 32 || key.toString("base64") !== encoded) throw new ActionError("수신자 키가 설정되지 않았습니다");
    const runtime = await prisma.notificationRuntimeConfig.findUnique({ where: { environment: "preview" }, select: { keyVersion: true } });
    if (!runtime?.keyVersion) throw new ActionError("수신자 키 상태를 확인할 수 없습니다");
    return { keyVersion: runtime.keyVersion, key };
  } catch (error) { key.fill(0); throw error; }
}
async function run(work: (context: { actorId: string; repository: PrismaDispatchRepository; key: { keyVersion: string; key: Buffer } }) => Promise<RecipientActionResult>): Promise<RecipientActionResult> {
  // A SUPER_ADMIN passes the page guard and receives a service error for writes.
  const principal = await requireAdminOrSuperAdminPrincipal();
  let key: Awaited<ReturnType<typeof recipientKey>> | undefined;
  try {
    if (!isEligibleAdmin({ id: principal.userId, role: principal.role, isActive: true, mustChangePassword: principal.mustChangePassword })) throw new ActionError("수신자 관리는 ADMIN만 수행할 수 있습니다");
    key = await recipientKey();
    const result = await work({ actorId: principal.userId, repository: new PrismaDispatchRepository(prisma), key });
    if (result.ok) revalidatePath(path);
    return result;
  } catch (error) {
    if (error instanceof ActionError) return { ok: false, error: error.message };
    if (error instanceof z.ZodError) return { ok: false, error: "입력값과 필수 확인 항목을 확인해주세요" };
    return { ok: false, error: "수신자 작업을 처리하지 못했습니다. 권한과 등록 상태를 확인해주세요" };
  } finally { key?.key.fill(0); }
}

export async function registerRecipientAction(_previous: RecipientActionResult | null, form: FormData): Promise<RecipientActionResult> {
  return run(async ({ actorId, repository, key }) => {
    const input = registrationForm.parse({ phoneNumber: form.get("phoneNumber"), ownWorkNumberConfirmed: form.get("ownWorkNumberConfirmed") });
    await registerPrismaRealRecipient(repository, { registrationId: reference(), version: reference(), userId: actorId, actorId, purposeVersion: "application-received-v1", policyVersion: "g4-v1", phoneNumber: input.phoneNumber, key, at: new Date() });
    // This one-time response is derived exclusively from the submitted form.
    return { ok: true, message: "수신자를 등록했습니다", maskedPhone: `${input.phoneNumber.slice(0, 3)}-${"*".repeat(input.phoneNumber.length - 7)}-${input.phoneNumber.slice(-4)}` };
  });
}
export async function verifyRecipientAction(_previous: RecipientActionResult | null, form: FormData): Promise<RecipientActionResult> {
  return run(async ({ actorId, repository }) => {
    const input = verificationForm.parse({ registrationId: form.get("registrationId"), verifierSelfConfirmed: form.get("verifierSelfConfirmed"), callCompletedConfirmed: form.get("callCompletedConfirmed") });
    const registration = await prisma.notificationRecipientRegistration.findUnique({ where: { id: input.registrationId }, select: { version: true } });
    if (!registration) throw new ActionError("수신자 등록을 찾을 수 없습니다");
    const at = new Date();
    const evidence = { id: "operator_call_verified", method: "operator_call", success: true, registrationId: input.registrationId, version: registration.version, verifierId: actorId, verifiedAt: at };
    await recordPrismaRealOwnership(repository, { registrationId: input.registrationId, actorId, evidence, at });
    await verifyPrismaRealRecipient(repository, { registrationId: input.registrationId, actorId, evidence, at });
    return { ok: true, message: "시스템 밖에서 완료한 통화의 확인 서명을 기록했습니다" };
  });
}
export async function activateRecipientAction(_previous: RecipientActionResult | null, form: FormData): Promise<RecipientActionResult> {
  return run(async ({ actorId, repository, key }) => {
    const input = referenceForm.parse({ registrationId: form.get("registrationId") });
    await activatePrismaRealRecipient(repository, { registrationId: input.registrationId, actorId, key, at: new Date() });
    return { ok: true, message: "수신자를 활성화했습니다" };
  });
}
export async function revokeRecipientAction(_previous: RecipientActionResult | null, form: FormData): Promise<RecipientActionResult> {
  return run(async ({ actorId, repository }) => {
    const input = revokeForm.parse({ registrationId: form.get("registrationId"), reason: form.get("reason") });
    await revokePrismaRealRecipient(repository, { registrationId: input.registrationId, actorId, reason: input.reason, at: new Date() });
    return { ok: true, message: "수신자를 해지하고 암호문을 지웠습니다" };
  });
}
export async function grantRecipientAssignmentAction(_previous: RecipientActionResult | null, form: FormData): Promise<RecipientActionResult> {
  return run(async ({ actorId, repository }) => {
    const input = assignmentForm.parse({ executorId: form.get("executorId"), assignment: form.get("assignment"), operation: form.get("operation") });
    await setPrismaRecipientAssignment(repository, { commandId: reference(), actorId, executorId: input.executorId, assignment: input.assignment, active: input.operation === "grant", at: new Date() });
    return { ok: true, message: input.operation === "grant" ? "수신자 직무를 부여했습니다" : "수신자 직무를 해지했습니다" };
  });
}
