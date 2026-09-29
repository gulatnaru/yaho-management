import type { PrismaClient } from "@prisma/client";
import { canIssueApplicationLink } from "@/lib/reservation-applications/availability";
import {
  ApplicationLinkClassClosedError,
  ApplicationLinkNotFoundError,
} from "@/lib/reservation-applications/errors";
import { generateApplicationLinkToken } from "@/lib/reservation-applications/token";

type IssueClient = Pick<PrismaClient, "classSchedule" | "reservationApplicationLink">;
type StopClient = Pick<PrismaClient, "reservationApplicationLink">;

/**
 * 클래스 신청 링크를 만들거나 재발급한다(ADR-052). 클래스당 1개이며,
 * 재발급하면 토큰이 바뀌어 이전 링크는 즉시 무효가 되고 다시 접수 중이 된다.
 */
export async function issueApplicationLinkCore(
  client: IssueClient,
  input: { classScheduleId: string; actorUserId: string; now: Date; generateToken?: () => string },
): Promise<{ token: string }> {
  const classSchedule = await client.classSchedule.findUnique({
    where: { id: input.classScheduleId },
    select: { status: true, startsAt: true },
  });
  if (!classSchedule) throw new ApplicationLinkNotFoundError();
  if (!canIssueApplicationLink(classSchedule, input.now)) throw new ApplicationLinkClassClosedError();

  const token = (input.generateToken ?? generateApplicationLinkToken)();
  const linkData = { token, isActive: true, issuedAt: input.now, issuedById: input.actorUserId };
  await client.reservationApplicationLink.upsert({
    where: { classScheduleId: input.classScheduleId },
    create: { classScheduleId: input.classScheduleId, ...linkData },
    update: linkData,
  });
  return { token };
}

/** 링크를 중지한다. 이미 중지됐거나 링크가 없으면 ApplicationLinkNotFoundError. */
export async function stopApplicationLinkCore(
  client: StopClient,
  input: { classScheduleId: string },
): Promise<void> {
  const result = await client.reservationApplicationLink.updateMany({
    where: { classScheduleId: input.classScheduleId, isActive: true },
    data: { isActive: false },
  });
  if (result.count === 0) throw new ApplicationLinkNotFoundError();
}
