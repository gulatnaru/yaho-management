import { ApplicationClosedNotice } from "@/app/(public)/_components/application-closed-notice";
import { headers } from "next/headers";
import { prisma } from "@/lib/db/prisma";
import { hashApplicationCapabilityToken } from "@/lib/reservation-applications/token";
import { getReservationApplicationSettings, isReservationApplicationSettingsReady } from "@/server/reservation-applications/settings";
import { GroupApplicationForm } from "../../group/[token]/group-application-form";
import { recheckApplicationGroupPrices, submitApplicationGroupWithCompanion } from "../../group/[token]/actions";
import { hasActivePhase20PreviewLease, parseAndVerifySignedPreviewRun, PHASE20_PREVIEW_HEADER } from "@/lib/e2e/phase20-lease";
import { reservationApplicationSettingsSchema } from "@/lib/reservation-applications/phase20-validation";
import { formatTargetAgeRange } from "@/lib/programs/format";
import { formatKstDateTimeRange } from "@/lib/classes/datetime";
import { isConsentContentReady } from "@/lib/reservation-applications/consent-content";

import { loadModernPublicApplicationClasses } from "@/lib/reservation-applications/public-queries";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/** An opaque invite supplies only its own group's currently open classes. */
export default async function CompanionApplicationPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const now = new Date();
  const [invite, settings] = await Promise.all([
    prisma.companionInvite.findFirst({
      where: { tokenHash: hashApplicationCapabilityToken(token), revokedAt: null, expiresAt: { gt: now }, group: { is: { isActive: true, ...(process.env.VERCEL_ENV === "production" ? { syntheticRunId: null } : {}) } } },
      select: { group: { select: { syntheticRunId: true, syntheticSettings: true } } },
    }),
    getReservationApplicationSettings(prisma),
  ]);
  const previewAllowed = process.env.VERCEL_ENV !== "preview" || await hasActivePhase20PreviewLease(prisma, { signed: parseAndVerifySignedPreviewRun((await headers()).get(PHASE20_PREVIEW_HEADER), process.env), syntheticRunId: invite?.group.syntheticRunId ?? null, now });
  const previewSettings = process.env.VERCEL_ENV === "preview" ? reservationApplicationSettingsSchema.safeParse(invite?.group.syntheticSettings) : null;
  const settingsReady = previewSettings ? previewSettings.success : Boolean(settings && isReservationApplicationSettingsReady(settings));
  if (!previewAllowed || !settingsReady || !isConsentContentReady(process.env.VERCEL_ENV)) return <ApplicationClosedNotice />;
  const classes = await loadModernPublicApplicationClasses({ companionToken: token, now });
  if (!classes.length) return <ApplicationClosedNotice />;
  return <section className="space-y-6"><div><p className="mt-1 text-sm text-slate-600">동행 정보만 연결됩니다. 각 보호자는 자신의 아이와 동의를 직접 입력합니다.</p></div><GroupApplicationForm recheck={recheckApplicationGroupPrices.bind(null, undefined, token)} action={submitApplicationGroupWithCompanion.bind(null, undefined, token)} classes={classes.map((item) => ({ id: item.id, label: `${item.program.name} · ${formatKstDateTimeRange(item.startsAt, item.endsAt)} · ${item.location}`, description: item.program.description, targetAge: formatTargetAgeRange(item.program.targetAgeMin, item.program.targetAgeMax), applicationPrice: item.applicationPrice }))} /></section>;
}
