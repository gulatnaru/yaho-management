import type { ConsentAction, PrismaClient } from "@prisma/client";
import { planApplicationConsentRecords } from "@/lib/reservation-applications/consent-plan";
import {
  ApplicationDepositNotConfirmedError,
  ApplicationNotFoundError,
  ApplicationNotPendingError,
} from "@/lib/reservation-applications/errors";
import { ChildPersonalDataPurgedError } from "@/lib/children/errors";
import { ChildNotFoundError } from "@/lib/reservations/errors";
import {
  createReservationInTransaction,
  RESERVATION_TRANSACTION_OPTIONS,
} from "@/server/reservations/create";

export type ApplicationChildChoice = { type: "EXISTING"; childId: string } | { type: "NEW" };

export type ConfirmReservationApplicationInput = {
  applicationId: string;
  childChoice: ApplicationChildChoice;
  memo?: string;
  /** (신청 id, 아이 선택)에 묶인 초과 예약 확인이 유효한지. action 이 판정해서 넘긴다. */
  confirmOverbooking: boolean;
  actorUserId: string;
  now: Date;
};

/**
 * 입금 확인된 신청을 기존 예약 규칙으로 확정한다(ADR-053/054). 한 트랜잭션에서 다음을 모두 하거나 아무것도 하지 않는다.
 * 1. 신청 행을 잠그고 처리 대기·입금 확인을 다시 확인
 * 2. 새 아이 등록 또는 기존 아이 확인(기존 아이 정보는 바꾸지 않는다)
 * 3. createReservationInTransaction — 클래스 잠금·중복·비활성 아이·취소/종료 클래스·정원 초과 확인 그대로
 * 4. 신청 동의를 ChildConsent 에 append-only 로 추가(동의 일시 = 신청 제출 시각). 선택 동의의 미동의도 기록한다(ADR-055)
 * 5. 신청을 CONFIRMED 로 갱신
 * Payment 는 만들지 않는다.
 *
 * 잠금 순서: 신청 행 → ClassSchedule 행 → Child 행(FOR SHARE, ADR-058). 다른 경로는 처리 대기 신청 행을 잠그지 않고,
 * 개인정보 파기는 ClassSchedule 을 잠그지 않으므로 순환 대기가 생기지 않는다.
 */
export async function confirmReservationApplicationCore(
  client: Pick<PrismaClient, "$transaction">,
  input: ConfirmReservationApplicationInput,
): Promise<{ reservationId: string; childId: string }> {
  return client.$transaction(async (tx) => {
    const [locked] = await tx.$queryRaw<{ status: string; depositConfirmedAt: Date | null }[]>`
      SELECT "status", "depositConfirmedAt" FROM "ReservationApplication" WHERE "id" = ${input.applicationId} FOR UPDATE
    `;
    if (!locked) throw new ApplicationNotFoundError();
    if (locked.status !== "SUBMITTED") throw new ApplicationNotPendingError();
    if (!locked.depositConfirmedAt) throw new ApplicationDepositNotConfirmedError();

    const application = await tx.reservationApplication.findUniqueOrThrow({
      where: { id: input.applicationId },
      select: {
        classScheduleId: true,
        childName: true,
        childBirthDate: true,
        childGender: true,
        guardianName: true,
        guardianPhone: true,
        photoShareConsentAgreed: true,
        photoMarketingConsentAgreed: true,
        submittedAt: true,
      },
    });
    const { childName, childBirthDate, childGender, guardianName, guardianPhone } = application;
    // 파기된 신청은 처리 대기일 수 없지만(CHECK), 개인정보가 없으면 확정하지 않는다.
    if (!childName || !childBirthDate || !childGender || !guardianName || !guardianPhone) {
      throw new ApplicationNotPendingError();
    }

    let childId: string;
    let currentPhotoShareAction: ConsentAction | null = null;
    let currentPhotoMarketingAction: ConsentAction | null = null;
    if (input.childChoice.type === "NEW") {
      const child = await tx.child.create({
        data: { name: childName, birthDate: childBirthDate, gender: childGender, guardianName, guardianPhone },
        select: { id: true },
      });
      childId = child.id;
    } else {
      const child = await tx.child.findUnique({
        where: { id: input.childChoice.childId },
        select: { id: true, personalDataPurgedAt: true },
      });
      if (!child) throw new ChildNotFoundError();
      // 빠른 안내용 확인. 최종 판정은 createReservationInTransaction 의 Child 잠금 뒤에 다시 한다(ADR-058).
      if (child.personalDataPurgedAt) throw new ChildPersonalDataPurgedError();
      childId = child.id;
      const [latestShareConsent, latestMarketingConsent] = await Promise.all(
        (["PHOTO_SHARE", "PHOTO_MARKETING"] as const).map((consentType) =>
          tx.childConsent.findFirst({
            where: { childId, consentType },
            orderBy: [{ recordedAt: "desc" }, { id: "desc" }],
            select: { action: true },
          }),
        ),
      );
      currentPhotoShareAction = latestShareConsent?.action ?? null;
      currentPhotoMarketingAction = latestMarketingConsent?.action ?? null;
    }

    const reservation = await createReservationInTransaction(tx, {
      classScheduleId: application.classScheduleId,
      childId,
      memo: input.memo,
      ...(input.confirmOverbooking
        ? {
            confirmOverbooking: "true" as const,
            confirmedClassScheduleId: application.classScheduleId,
            confirmedChildId: childId,
          }
        : {}),
    });

    const consentRecords = planApplicationConsentRecords({
      photoShareConsentAgreed: application.photoShareConsentAgreed,
      photoMarketingConsentAgreed: application.photoMarketingConsentAgreed,
      currentPhotoShareAction,
      currentPhotoMarketingAction,
    });
    await tx.childConsent.createMany({
      data: consentRecords.map((record) => ({
        childId,
        consentType: record.consentType,
        action: record.action,
        recordedAt: application.submittedAt,
        recordedById: input.actorUserId,
        reservationApplicationId: input.applicationId,
      })),
    });

    const updated = await tx.reservationApplication.updateMany({
      where: { id: input.applicationId, status: "SUBMITTED" },
      data: {
        status: "CONFIRMED",
        childId,
        reservationId: reservation.id,
        resolvedAt: input.now,
        resolvedById: input.actorUserId,
      },
    });
    if (updated.count === 0) throw new ApplicationNotPendingError();

    return { reservationId: reservation.id, childId };
  }, RESERVATION_TRANSACTION_OPTIONS);
}
