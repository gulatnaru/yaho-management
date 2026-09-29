import type { PrismaClient, ReservationApplicationStatus } from "@prisma/client";
import { getLastReservedClassDateByChildIds } from "@/lib/reservation-applications/last-reserved-class";
import {
  computeApplicationRetention,
  isPurgeableStatus,
  isRetentionExpired,
  type ApplicationRetention,
} from "@/lib/reservation-applications/retention";

type RetentionScanClient = Pick<PrismaClient, "$queryRaw" | "reservationApplication">;

export type RetentionCandidate = {
  id: string;
  status: ReservationApplicationStatus;
  childName: string | null;
  classStartsAt: Date;
  retention: ApplicationRetention;
};

export type RetentionScan = {
  /** 보관기간이 지나 지금 파기할 수 있는 신청 */
  purgeable: RetentionCandidate[];
  /** 보관기간이 지났지만 처리 대기라 먼저 반려·취소해야 하는 신청 */
  expiredPending: RetentionCandidate[];
};

/** 아직 파기되지 않은 신청 중 보관기간이 지난 것을 찾는다. 조회만 하며 DB 를 바꾸지 않는다. */
export async function scanApplicationRetention(client: RetentionScanClient, now: Date): Promise<RetentionScan> {
  const applications = await client.reservationApplication.findMany({
    where: { personalDataPurgedAt: null },
    select: {
      id: true,
      status: true,
      childId: true,
      childName: true,
      classSchedule: { select: { startsAt: true } },
    },
    orderBy: [{ submittedAt: "asc" }, { id: "asc" }],
  });

  const confirmedChildIds = applications.flatMap((application) =>
    application.status === "CONFIRMED" && application.childId ? [application.childId] : [],
  );
  const lastReservedByChild = await getLastReservedClassDateByChildIds(client, confirmedChildIds);

  const scan: RetentionScan = { purgeable: [], expiredPending: [] };
  for (const application of applications) {
    const retention = computeApplicationRetention({
      status: application.status,
      classStartsAt: application.classSchedule.startsAt,
      lastReservedClassAt: application.childId ? (lastReservedByChild.get(application.childId) ?? null) : null,
    });
    if (!isRetentionExpired(retention, now)) continue;

    const candidate: RetentionCandidate = {
      id: application.id,
      status: application.status,
      childName: application.childName,
      classStartsAt: application.classSchedule.startsAt,
      retention,
    };
    if (isPurgeableStatus(application.status)) {
      scan.purgeable.push(candidate);
    } else {
      scan.expiredPending.push(candidate);
    }
  }
  return scan;
}

/**
 * 보관기간이 지난 신청의 개인정보를 파기한다(ADR-055). ADMIN 이 직접 실행하는 정리 경로이며 자동 배치는 없다.
 * 신청 행은 남기고(상태·클래스·처리 기록·동의 여부·동의 문구 버전) 아이·보호자 항목과 요청사항만 지운다.
 * 확정된 신청은 아이 기록(Child)과 동의 이력이 따로 남으며, 이 경로는 신청에 남은 사본만 지운다.
 */
export async function purgeExpiredApplicationsCore(
  client: Pick<PrismaClient, "$transaction">,
  input: { actorUserId: string; now: Date },
): Promise<{ purgedCount: number }> {
  return client.$transaction(async (tx) => {
    const scan = await scanApplicationRetention(tx, input.now);
    const ids = scan.purgeable.map((candidate) => candidate.id);
    if (ids.length === 0) return { purgedCount: 0 };

    const result = await tx.reservationApplication.updateMany({
      where: { id: { in: ids }, personalDataPurgedAt: null, status: { not: "SUBMITTED" } },
      data: {
        childName: null,
        childBirthDate: null,
        childGender: null,
        guardianName: null,
        guardianPhone: null,
        guardianRelationship: null,
        requestNote: null,
        personalDataPurgedAt: input.now,
        personalDataPurgedById: input.actorUserId,
      },
    });
    return { purgedCount: result.count };
  });
}
