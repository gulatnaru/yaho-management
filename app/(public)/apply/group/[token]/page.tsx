import { ApplicationClosedNotice } from "@/app/(public)/_components/application-closed-notice";
import { headers } from "next/headers";
import { prisma } from "@/lib/db/prisma";
import { getReservationApplicationSettings, isReservationApplicationSettingsReady } from "@/server/reservation-applications/settings";
import { hashApplicationCapabilityToken } from "@/lib/reservation-applications/token";
import { GroupApplicationForm } from "./group-application-form";
import { recheckApplicationGroupPrices, submitApplicationGroup } from "./actions";
import { hasActivePhase20PreviewLease, parseAndVerifySignedPreviewRun, PHASE20_PREVIEW_HEADER } from "@/lib/e2e/phase20-lease";
import { reservationApplicationSettingsSchema } from "@/lib/reservation-applications/phase20-validation";
import { formatTargetAgeRange } from "@/lib/programs/format";
import { formatKstDateTimeRange } from "@/lib/classes/datetime";
import { isConsentContentReady } from "@/lib/reservation-applications/consent-content";
import { resolvePreviewApplyAccess } from "@/lib/e2e/preview-manual-session";
import { TestSessionBanner } from "./test-session-banner";

import { loadModernPublicApplicationClasses } from "@/lib/reservation-applications/public-queries";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function GroupApplicationPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const [link, settings] = await Promise.all([
    prisma.reservationApplicationLink.findFirst({
      where: { tokenHash: hashApplicationCapabilityToken(token), isActive: true, group: { is: { isActive: true, ...(process.env.VERCEL_ENV === "production" ? { syntheticRunId: null } : {}) } } },
      select: { group: { select: { syntheticRunId: true, syntheticSettings: true } } },
    }),
    getReservationApplicationSettings(prisma),
  ]);
  const leaseAllowed = process.env.VERCEL_ENV === "preview"
    ? await hasActivePhase20PreviewLease(prisma, { signed: parseAndVerifySignedPreviewRun((await headers()).get(PHASE20_PREVIEW_HEADER), process.env), syntheticRunId: link?.group?.syntheticRunId ?? null, now: new Date() })
    : true;
  const access = await resolvePreviewApplyAccess(leaseAllowed, link?.group?.syntheticRunId ?? null);
  const previewSettings = process.env.VERCEL_ENV === "preview" ? reservationApplicationSettingsSchema.safeParse(link?.group?.syntheticSettings) : null;
  const settingsReady = previewSettings ? previewSettings.success : Boolean(settings && isReservationApplicationSettingsReady(settings));
  if (!access.allowed || !settingsReady || !isConsentContentReady(process.env.VERCEL_ENV)) return <ApplicationClosedNotice />;
  const classes = await loadModernPublicApplicationClasses({ token, now: new Date() });
  if (!classes.length) return <ApplicationClosedNotice />;
  return <section className="space-y-6">{access.operatorSession ? <TestSessionBanner /> : null}<div><p className="mt-1 text-sm text-slate-600">보호자 정보는 한 번 입력하고 아이별로 참여할 클래스를 선택해주세요.</p></div><GroupApplicationForm recheck={recheckApplicationGroupPrices.bind(null, token, undefined)} action={submitApplicationGroup.bind(null, token)} classes={classes.map((item) => ({ id: item.id, label: `${item.program.name} · ${formatKstDateTimeRange(item.startsAt, item.endsAt)} · ${item.location}`, description: item.program.description, targetAge: formatTargetAgeRange(item.program.targetAgeMin, item.program.targetAgeMax), applicationPrice: item.applicationPrice }))} /></section>;
}
