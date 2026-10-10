"use server";

import { cookies } from "next/headers";
import { headers } from "next/headers";
import { prisma } from "@/lib/db/prisma";
import { APPLICATION_CONSENT_CONTENT, isConsentContentReady } from "@/lib/reservation-applications/consent-content";
import { COMPLETION_COOKIE_NAME, COMPLETION_TTL_MS } from "@/lib/reservation-applications/completion";
import { hashApplicationCapabilityToken, generateApplicationCapabilityToken } from "@/lib/reservation-applications/token";
import { APPLICATION_DEVICE_TTL_MS } from "@/server/reservation-applications/devices";
import { groupSubmissionSchema, reservationApplicationSettingsSchema } from "@/lib/reservation-applications/phase20-validation";
import { submitApplicationGroupCore } from "@/server/reservation-applications/groups";
import { getReservationApplicationSettings, isReservationApplicationSettingsReady } from "@/server/reservation-applications/settings";
import { hasActivePhase20PreviewLease, parseAndVerifySignedPreviewRun, PHASE20_PREVIEW_HEADER } from "@/lib/e2e/phase20-lease";

export type GroupSubmissionState = { submitted?: boolean; error?: string };

export async function submitApplicationGroup(token: string, _state: GroupSubmissionState, formData: FormData): Promise<GroupSubmissionState> {
  return submitApplicationGroupWithCompanion(token, undefined, _state, formData);
}

/** Used by the invitation route. The invite remains opaque and is never persisted in browser storage. */
export async function submitApplicationGroupWithCompanion(token: string | undefined, companionToken: string | undefined, _state: GroupSubmissionState, formData: FormData): Promise<GroupSubmissionState> {
  let payload: unknown;
  try { payload = JSON.parse(String(formData.get("payload") ?? "")); } catch { return { error: "입력 내용을 다시 확인해주세요." }; }
  const parsed = groupSubmissionSchema.safeParse(payload);
  if (!parsed.success || formData.get("website") || !isConsentContentReady(process.env.VERCEL_ENV)) return { error: "입력 내용을 다시 확인해주세요." };
  const scoped = token
    ? await prisma.reservationApplicationLink.findFirst({ where: { tokenHash: hashApplicationCapabilityToken(token) }, select: { group: { select: { syntheticRunId: true, syntheticSettings: true } } } })
    : await prisma.companionInvite.findFirst({ where: { tokenHash: hashApplicationCapabilityToken(companionToken ?? "") }, select: { group: { select: { syntheticRunId: true, syntheticSettings: true } } } });
  if (process.env.VERCEL_ENV === "production" && scoped?.group?.syntheticRunId) return { error: "현재 신청을 받을 수 없습니다." };
  if (process.env.VERCEL_ENV === "preview") {
    const requestHeaders = await headers();
    const signed = parseAndVerifySignedPreviewRun(requestHeaders.get(PHASE20_PREVIEW_HEADER), process.env);
    if (!await hasActivePhase20PreviewLease(prisma, { signed, syntheticRunId: scoped?.group?.syntheticRunId ?? null, now: new Date() })) return { error: "현재 신청을 받을 수 없습니다." };
  }
  const settings = await getReservationApplicationSettings(prisma);
  const previewSettings = process.env.VERCEL_ENV === "preview"
    ? reservationApplicationSettingsSchema.safeParse(scoped?.group?.syntheticSettings)
    : null;
  if (previewSettings ? !previewSettings.success : !settings || !isReservationApplicationSettingsReady(settings)) return { error: "현재 신청을 받을 수 없습니다." };
  const now = new Date();
  const completionToken = generateApplicationCapabilityToken();
  const deviceToken = generateApplicationCapabilityToken();
  const jar = await cookies();
  try {
    await submitApplicationGroupCore(prisma, {
      token, companionToken, previousDeviceTokenHash: jar.get("yaho_application_device")?.value ? hashApplicationCapabilityToken(jar.get("yaho_application_device")!.value) : undefined, data: parsed.data, consentVersion: APPLICATION_CONSENT_CONTENT.version, now, configReady: true,
      completionTokenHash: hashApplicationCapabilityToken(completionToken), completionExpiresAt: new Date(now.getTime() + COMPLETION_TTL_MS),
      deviceTokenHash: hashApplicationCapabilityToken(deviceToken), deviceExpiresAt: new Date(now.getTime() + APPLICATION_DEVICE_TTL_MS),
    });
  } catch { return { error: "현재 신청을 받을 수 없습니다. 잠시 후 다시 시도해주세요." }; }
  jar.set(COMPLETION_COOKIE_NAME, completionToken, { httpOnly: true, secure: true, sameSite: "lax", path: "/apply", maxAge: Math.floor(COMPLETION_TTL_MS / 1000) });
  jar.set("yaho_application_device", deviceToken, { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: Math.floor(APPLICATION_DEVICE_TTL_MS / 1000) });
  return { submitted: true };
}
