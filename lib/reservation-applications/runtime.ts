import { isPublicApplicationEnvironment, type ApplicationAvailabilityContext } from "./availability";
import { readPublicApplicationConfig, type EnvironmentLike } from "./config";
import { isConsentContentReady } from "./consent-content";
import { isReservationApplicationSettingsReady } from "@/server/reservation-applications/settings";
import type { PrismaClient } from "@prisma/client";

/** 현재 배포 환경·설정·동의 문구 상태로 접수 판정 컨텍스트를 만든다. */
export function buildApplicationAvailabilityContext(
  now: Date = new Date(),
  env: EnvironmentLike = process.env,
): ApplicationAvailabilityContext {
  return {
    now,
    environmentAllowed: isPublicApplicationEnvironment(env.VERCEL_ENV),
    configReady: readPublicApplicationConfig(env) !== null,
    consentReady: isConsentContentReady(env.VERCEL_ENV),
  };
}

/**
 * Legacy /apply/[token] remains usable during the explicit settings transition.
 * Once the database singleton exists it is authoritative, including when invalid;
 * environment configuration is only the no-row fallback for an untouched Phase 18 install.
 */
export async function buildLegacyApplicationAvailabilityContext(
  client: Pick<PrismaClient, "reservationApplicationSettings">,
  now: Date = new Date(),
  env: EnvironmentLike = process.env,
): Promise<ApplicationAvailabilityContext> {
  const settings = await client.reservationApplicationSettings.findUnique({
    where: { id: 1 },
    select: { bankName: true, accountNumber: true, accountHolder: true, blogUrl: true, instagramUrl: true, kakaoChannelUrl: true },
  });
  return {
    now,
    environmentAllowed: isPublicApplicationEnvironment(env.VERCEL_ENV),
    configReady: settings ? isReservationApplicationSettingsReady(settings) : readPublicApplicationConfig(env) !== null,
    consentReady: isConsentContentReady(env.VERCEL_ENV),
  };
}
