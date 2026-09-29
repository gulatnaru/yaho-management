import type { PrismaClient } from "@prisma/client";
import {
  isApplicationLinkOpen,
  type ApplicationAvailabilityContext,
} from "@/lib/reservation-applications/availability";
import { ApplicationClosedError, ApplicationRateLimitedError } from "@/lib/reservation-applications/errors";
import { isWellFormedApplicationLinkToken } from "@/lib/reservation-applications/token";
import type { ReservationApplicationSubmission } from "@/lib/validation/reservation-application";

/** 링크(클래스)당 요청 빈도 제한. IP 는 저장하지 않는다(파기 기능이 없는 동안 개인정보를 늘리지 않기 위해). */
export const APPLICATION_RATE_LIMIT = { windowMs: 10 * 60 * 1000, maxPerClass: 20 } as const;

type SubmitClient = Pick<PrismaClient, "reservationApplicationLink" | "reservationApplication">;

export type SubmitReservationApplicationInput = {
  token: string;
  data: ReservationApplicationSubmission;
  consentVersion: string;
  context: ApplicationAvailabilityContext;
};

/**
 * 비로그인 보호자의 신청 1건을 저장한다(ADR-052~054).
 * - 대상 클래스는 클라이언트 값이 아니라 링크 토큰으로 서버가 결정한다.
 * - 화면 렌더링 이후 링크가 중지·마감됐을 수 있으므로 제출 시점에 다시 판정한다.
 * - Child·Reservation·Payment·ChildConsent 는 만들거나 바꾸지 않는다. 이 client 에 그 delegate 가 없다.
 */
export async function submitReservationApplicationCore(
  client: SubmitClient,
  input: SubmitReservationApplicationInput,
): Promise<{ id: string }> {
  if (!isWellFormedApplicationLinkToken(input.token)) throw new ApplicationClosedError();

  const link = await client.reservationApplicationLink.findUnique({
    where: { token: input.token },
    select: {
      isActive: true,
      classScheduleId: true,
      classSchedule: { select: { status: true, startsAt: true } },
    },
  });
  if (!link || !isApplicationLinkOpen(link, input.context)) throw new ApplicationClosedError();

  const windowStart = new Date(input.context.now.getTime() - APPLICATION_RATE_LIMIT.windowMs);
  const recentCount = await client.reservationApplication.count({
    where: { classScheduleId: link.classScheduleId, submittedAt: { gte: windowStart } },
  });
  if (recentCount >= APPLICATION_RATE_LIMIT.maxPerClass) throw new ApplicationRateLimitedError();

  return client.reservationApplication.create({
    data: {
      classScheduleId: link.classScheduleId,
      childName: input.data.childName,
      childBirthDate: new Date(input.data.childBirthDate),
      childGender: input.data.childGender,
      guardianName: input.data.guardianName,
      guardianPhone: input.data.guardianPhone,
      guardianRelationship: input.data.guardianRelationship,
      requestNote: input.data.requestNote ?? null,
      programTermsAcknowledged: input.data.programTerms,
      privacyConsentAgreed: input.data.privacyConsent,
      legalGuardianConfirmed: input.data.legalGuardianConfirmation,
      photoShareConsentAgreed: input.data.photoShareConsent,
      photoMarketingConsentAgreed: input.data.photoMarketingConsent,
      consentVersion: input.consentVersion,
      submittedAt: input.context.now,
    },
    select: { id: true },
  });
}
