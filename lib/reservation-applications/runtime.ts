import { isPublicApplicationEnvironment, type ApplicationAvailabilityContext } from "./availability";
import { readPublicApplicationConfig, type EnvironmentLike } from "./config";
import { isConsentContentReady } from "./consent-content";

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
