import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import React from "react";
import { cookies } from "next/headers";
import { headers } from "next/headers";
import { unstable_noStore as noStore } from "next/cache";
import { prisma } from "@/lib/db/prisma";
import {
  canShowApplicationCompletionGuide,
  canShowGenericApplicationCompletionGuide,
  COMPLETION_COOKIE_NAME,
  loadApplicationCompletionView,
} from "@/lib/reservation-applications/completion";
import { readPublicApplicationConfig } from "@/lib/reservation-applications/config";
import { reservationApplicationSettingsSchema } from "@/lib/reservation-applications/phase20-validation";
import { getReservationApplicationSettings } from "@/server/reservation-applications/settings";
import { cn } from "@/lib/utils";
import { CompletionGuide } from "./completion-guide";
import { hasActivePhase20PreviewLease, parseAndVerifySignedPreviewRun, PHASE20_PREVIEW_HEADER } from "@/lib/e2e/phase20-lease";

// 배포 설정(환경변수)을 요청 시점에 읽는다.
export const dynamic = "force-dynamic";

/** A valid Phase 20 capability renders only its own transfer guide; legacy visits retain generic guidance. */
export default async function ReservationApplicationCompletePage() {
  noStore();
  const jar = await cookies();
  const token = jar.get(COMPLETION_COOKIE_NAME)?.value;
  const [completion, dbSettings] = await Promise.all([loadApplicationCompletionView(token), getReservationApplicationSettings(prisma)]);
  const previewAllowed = process.env.VERCEL_ENV !== "preview" || await hasActivePhase20PreviewLease(prisma, { signed: parseAndVerifySignedPreviewRun((await headers()).get(PHASE20_PREVIEW_HEADER), process.env), syntheticRunId: completion?.syntheticRunId ?? null, now: new Date() });
  const dbConfig = dbSettings ? reservationApplicationSettingsSchema.safeParse(dbSettings) : null;
  const showCompletionGuide = canShowApplicationCompletionGuide({ completion, vercelEnv: process.env.VERCEL_ENV, previewAllowed });
  const previewConfig = showCompletionGuide && process.env.VERCEL_ENV === "preview"
    ? reservationApplicationSettingsSchema.safeParse(completion?.syntheticSettings)
    : null;
  // Ordinary Phase 18 visits have no completion capability. The DB singleton
  // remains authoritative whenever it exists; Preview never falls back to it.
  const showGenericGuide = canShowGenericApplicationCompletionGuide({ completion, vercelEnv: process.env.VERCEL_ENV });
  const legacyConfig = showGenericGuide && !dbSettings ? readPublicApplicationConfig() : null;
  const completionDbConfig = showCompletionGuide && process.env.VERCEL_ENV !== "preview" && dbConfig?.success
    ? { ...dbConfig.data, bankAccountNumber: dbConfig.data.accountNumber, bankAccountHolder: dbConfig.data.accountHolder }
    : null;
  const genericDbConfig = showGenericGuide && dbConfig?.success
    ? { ...dbConfig.data, bankAccountNumber: dbConfig.data.accountNumber, bankAccountHolder: dbConfig.data.accountHolder }
    : null;
  const config = previewConfig?.success
    ? { ...previewConfig.data, bankAccountNumber: previewConfig.data.accountNumber, bankAccountHolder: previewConfig.data.accountHolder }
    : completionDbConfig ?? genericDbConfig ?? legacyConfig;

  return (
    <section className="space-y-6">
      <Card>
        <CardContent className="space-y-2 p-6">
          <h1 className="text-xl font-bold">신청이 접수되었습니다</h1>
          <p className="text-sm text-slate-700">
            아직 예약이 확정된 것은 아닙니다. 입금과 운영자 확인 후 예약이 확정됩니다.
          </p>
        </CardContent>
      </Card>

      {showCompletionGuide && completion && config ? (
        <CompletionGuide accountHolder={config.bankAccountHolder} accountNumber={config.bankAccountNumber} applications={completion.applications} bankName={config.bankName} payerName={completion.declaredPayerName} />
      ) : config ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle>무통장 입금 안내</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="space-y-3 text-sm">
                <div className="flex items-baseline justify-between gap-4">
                  <dt className="shrink-0 text-slate-500">은행</dt>
                  <dd className="break-words text-right font-medium">{config.bankName}</dd>
                </div>
                <div className="flex items-baseline justify-between gap-4">
                  <dt className="shrink-0 text-slate-500">계좌번호</dt>
                  <dd className="select-all break-all text-right font-medium">{config.bankAccountNumber}</dd>
                </div>
                <div className="flex items-baseline justify-between gap-4">
                  <dt className="shrink-0 text-slate-500">예금주</dt>
                  <dd className="break-words text-right font-medium">{config.bankAccountHolder}</dd>
                </div>
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>YAHO 채널</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              {[
                { href: config.blogUrl, label: "YAHO 블로그" },
                { href: config.instagramUrl, label: "YAHO Instagram" },
                { href: config.kakaoChannelUrl, label: "YAHO 카카오톡 채널" },
              ].map((channel) => (
                <a
                  className={cn(buttonVariants(), "w-full")}
                  href={channel.href}
                  key={channel.label}
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  {channel.label}
                </a>
              ))}
            </CardContent>
          </Card>
        </>
      ) : null}
    </section>
  );
}
