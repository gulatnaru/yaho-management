"use server";

import { z } from "zod";
import { cookies } from "next/headers";
import { headers } from "next/headers";
import { prisma } from "@/lib/db/prisma";
import { APPLICATION_CONSENT_CONTENT, isConsentContentReady } from "@/lib/reservation-applications/consent-content";
import type { ApplicationConsentKey } from "@/lib/reservation-applications/consent-content";
import { COMPLETION_COOKIE_NAME, COMPLETION_TTL_MS } from "@/lib/reservation-applications/completion";
import { hashApplicationCapabilityToken, generateApplicationCapabilityToken } from "@/lib/reservation-applications/token";
import { APPLICATION_DEVICE_TTL_MS } from "@/server/reservation-applications/devices";
import { groupSubmissionSchema, reservationApplicationSettingsSchema } from "@/lib/reservation-applications/phase20-validation";
import { recheckApplicationGroupPricesCore, submitApplicationGroupCore } from "@/server/reservation-applications/groups";
import { getReservationApplicationSettings, isReservationApplicationSettingsReady } from "@/server/reservation-applications/settings";
import { hasActivePhase20PreviewLease, parseAndVerifySignedPreviewRun, PHASE20_PREVIEW_HEADER } from "@/lib/e2e/phase20-lease";
import { resolvePreviewApplyAccess } from "@/lib/e2e/preview-manual-session";

import { mapApplicationFieldErrors, type ApplicationFieldErrors } from "@/lib/reservation-applications/field-errors";
import { ApplicationClosedError } from "@/lib/reservation-applications/errors";
import { ApplicationPriceChangedError, ApplicationAlreadySubmittedError, type ApplicationPriceReview } from "@/server/reservation-applications/price-review";

export type GroupSubmissionState = {
  priceReview?: ApplicationPriceReview;
  priceChanged?: boolean;
  fieldErrors?: ApplicationFieldErrors;
  closed?: boolean;
  resultUnknown?: boolean;
  submitted?: boolean;
  error?: string;
  consentErrors?: Partial<Record<number, Partial<Record<ApplicationConsentKey, string>>>>;
};

async function publicApplicationAvailable(token?: string, companionToken?: string): Promise<boolean> {
  const scoped = token
    ? await prisma.reservationApplicationLink.findFirst({ where: { tokenHash: hashApplicationCapabilityToken(token) }, select: { group: { select: { syntheticRunId: true, syntheticSettings: true } } } })
    : await prisma.companionInvite.findFirst({ where: { tokenHash: hashApplicationCapabilityToken(companionToken ?? "") }, select: { group: { select: { syntheticRunId: true, syntheticSettings: true } } } });
  if (process.env.VERCEL_ENV === "production" && scoped?.group?.syntheticRunId) return false;
  if (process.env.VERCEL_ENV === "preview") {
    const requestHeaders = await headers();
    const signed = parseAndVerifySignedPreviewRun(requestHeaders.get(PHASE20_PREVIEW_HEADER), process.env);
    const leaseAllowed = await hasActivePhase20PreviewLease(prisma, { signed, syntheticRunId: scoped?.group?.syntheticRunId ?? null, now: new Date() });
    const access = await resolvePreviewApplyAccess(leaseAllowed, scoped?.group?.syntheticRunId ?? null);
    // Any falsy token selects the lease-only companion path: undefined from the companion
    // page, or "" through a direct server-action call. Only a non-empty group-link token
    // may use the operator-session allowance.
    if (!access.allowed || (access.operatorSession && !token)) return false;
  }
  const settings = await getReservationApplicationSettings(prisma);
  const previewSettings = process.env.VERCEL_ENV === "preview"
    ? reservationApplicationSettingsSchema.safeParse(scoped?.group?.syntheticSettings)
    : null;
  if (previewSettings ? !previewSettings.success : !settings || !isReservationApplicationSettingsReady(settings)) return false;
  return true;
}

const recheckSchema = z.object({
  classScheduleIds: z.array(z.string().min(1).max(200)).min(1).max(10),
  reviewedPriceProof: z.string().min(1).max(10000).optional(),
}).strict();

/** The same Preview and capability boundary applies to this read-only price response. */
export async function recheckApplicationGroupPrices(token: string | undefined, companionToken: string | undefined, input: unknown): Promise<GroupSubmissionState> {
  const parsed = recheckSchema.safeParse(input);
  if (!parsed.success) return { error: "입력 내용을 다시 확인해주세요." };
  try {
    if (!isConsentContentReady(process.env.VERCEL_ENV) || !await publicApplicationAvailable(token, companionToken)) return { closed: true, error: "현재 신청을 받을 수 없습니다." };
    const priceReview = await recheckApplicationGroupPricesCore(prisma, { token, companionToken, ...parsed.data, now: new Date() });
    return { priceReview };
  } catch { return { closed: true, error: "현재 신청을 받을 수 없습니다." }; }
}

export async function submitApplicationGroup(token: string, _state: GroupSubmissionState, formData: FormData): Promise<GroupSubmissionState> {
  return submitApplicationGroupWithCompanion(token, undefined, _state, formData);
}

/** Used by the invitation route. The invite remains opaque and is never persisted in browser storage. */
export async function submitApplicationGroupWithCompanion(token: string | undefined, companionToken: string | undefined, _state: GroupSubmissionState, formData: FormData): Promise<GroupSubmissionState> {
  let payload: unknown;
  try { payload = JSON.parse(String(formData.get("payload") ?? "")); } catch { return { error: "입력 내용을 다시 확인해주세요." }; }
  const parsed = groupSubmissionSchema.safeParse(payload);
  if (formData.get("website") || !isConsentContentReady(process.env.VERCEL_ENV)) return { error: "입력 내용을 다시 확인해주세요." };
  if (!parsed.success) {
    const fieldErrors = mapApplicationFieldErrors(parsed.error.issues);
    const consentErrors: NonNullable<GroupSubmissionState["consentErrors"]> = {};
    for (const issue of parsed.error.issues) {
      const [collection, index, key] = issue.path;
      // Only the four fixed, required-consent messages may cross the action boundary.
      if (issue.path.length !== 3 || collection !== "children" || typeof index !== "number" || !Number.isInteger(index) || index < 0 || index >= 10 || issue.code !== "invalid_literal") continue;
      if (key !== "programTerms" && key !== "privacyConsent" && key !== "legalGuardianConfirmation" && key !== "refundTerms") continue;
      consentErrors[index] = { ...consentErrors[index], [key]: fieldErrors[`children.${index}.${key}`] };
    }
    return { error: Object.keys(consentErrors).length ? "아이별 필수 확인·동의 항목을 확인해주세요." : "입력 내용을 다시 확인해주세요.", fieldErrors, ...(Object.keys(consentErrors).length ? { consentErrors } : {}) };
  }
  try {
    if (!await publicApplicationAvailable(token, companionToken)) return { closed: true, error: "현재 신청을 받을 수 없습니다." };
  } catch { return { closed: true, error: "현재 신청을 받을 수 없습니다." }; }
  if (parsed.data.consentVersion !== APPLICATION_CONSENT_CONTENT.version) return { error: "최신 필수 확인·동의 내용을 다시 확인해주세요.", fieldErrors: { consentVersion: "최신 필수 확인·동의 내용을 다시 확인해주세요" } };
  const now = new Date();
  const completionToken = generateApplicationCapabilityToken();
  const deviceToken = generateApplicationCapabilityToken();
  const jar = await cookies();
  try {
    const result = await submitApplicationGroupCore(prisma, {
      token, companionToken, previousCompletionTokenHash: jar.get(COMPLETION_COOKIE_NAME)?.value ? hashApplicationCapabilityToken(jar.get(COMPLETION_COOKIE_NAME)!.value) : undefined, previousDeviceTokenHash: jar.get("yaho_application_device")?.value ? hashApplicationCapabilityToken(jar.get("yaho_application_device")!.value) : undefined, data: parsed.data, consentVersion: APPLICATION_CONSENT_CONTENT.version, now, configReady: true,
      completionTokenHash: hashApplicationCapabilityToken(completionToken), completionExpiresAt: new Date(now.getTime() + COMPLETION_TTL_MS),
      deviceTokenHash: hashApplicationCapabilityToken(deviceToken), deviceExpiresAt: new Date(now.getTime() + APPLICATION_DEVICE_TTL_MS),
    });
    if (result.replayed) return { submitted: true };
  } catch (error) {
    if (error instanceof ApplicationPriceChangedError) return { error: "신청 금액이 변경되었습니다. 변경된 금액을 확인한 뒤 다시 제출해주세요.", priceChanged: true, priceReview: error.priceReview, fieldErrors: { reviewedPriceProof: "변경된 신청 금액을 다시 확인해주세요" } };
    if (error instanceof ApplicationAlreadySubmittedError) return { resultUnknown: true, error: "이미 접수된 신청일 수 있습니다. 다시 제출하지 말고 접수 결과를 확인해주세요." };
    if (error instanceof ApplicationClosedError) return { closed: true, error: "현재 신청을 받을 수 없습니다." };
    return { resultUnknown: true, error: "접수 결과를 확인할 수 없습니다. 다시 제출하지 말고 잠시 후 접수 결과를 확인해주세요." };
  }
  jar.set(COMPLETION_COOKIE_NAME, completionToken, { httpOnly: true, secure: true, sameSite: "lax", path: "/apply", maxAge: Math.floor(COMPLETION_TTL_MS / 1000) });
  jar.set("yaho_application_device", deviceToken, { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: Math.floor(APPLICATION_DEVICE_TTL_MS / 1000) });
  return { submitted: true };
}
