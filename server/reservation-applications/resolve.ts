import type { PrismaClient } from "@prisma/client";
import { ApplicationNotPendingError } from "@/lib/reservation-applications/errors";

type ApplicationClient = Pick<PrismaClient, "reservationApplication">;

/**
 * 입금 확인을 기록한다(ADR-053). Payment 를 만들지 않는다 — 결제는 확정 후 기존 결제 화면에서 등록한다.
 * 확인 후 쓰기 레이스를 막기 위해 조건부 updateMany 로 최종 판정한다(ARCHITECTURE.md §7.1).
 */
export async function confirmApplicationDepositCore(
  client: ApplicationClient,
  input: { applicationId: string; actorUserId: string; now: Date },
): Promise<void> {
  const result = await client.reservationApplication.updateMany({
    where: { id: input.applicationId, status: "SUBMITTED", depositConfirmedAt: null },
    data: { depositConfirmedAt: input.now, depositConfirmedById: input.actorUserId },
  });
  if (result.count === 0) throw new ApplicationNotPendingError();
}

export type ApplicationClosingStatus = "REJECTED" | "CANCELLED";

/** 반려(운영자 판단)·취소(보호자 요청). 처리 대기 신청만 가능하며 사유·처리자·시각을 남긴다. */
export async function closeReservationApplicationCore(
  client: ApplicationClient,
  input: {
    applicationId: string;
    status: ApplicationClosingStatus;
    resolutionNote: string;
    actorUserId: string;
    now: Date;
  },
): Promise<void> {
  const result = await client.reservationApplication.updateMany({
    where: { id: input.applicationId, status: "SUBMITTED" },
    data: {
      status: input.status,
      resolvedAt: input.now,
      resolvedById: input.actorUserId,
      resolutionNote: input.resolutionNote,
    },
  });
  if (result.count === 0) throw new ApplicationNotPendingError();
}
