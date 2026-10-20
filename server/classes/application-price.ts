import type { Prisma } from "@prisma/client";

export class ApplicationPriceRevisionConflictError extends Error {}
export const APPLICATION_PRICE_CONFLICT = "다른 관리자가 변경했거나 접수가 종료되었습니다. 다시 불러와 현재 가격을 확인해 주세요.";

/** Single price authority for existing classes. Caller authorizes ADMIN and validates input.
 * Full-form callers pass their transaction so a failed CAS rolls back every class/teacher edit.
 * Null remains supported for explicit full-form clearing; inline callers require a positive amount.
 */
export async function saveApplicationPriceCore(
  client: Pick<Prisma.TransactionClient, "classSchedule">,
  input: { classScheduleId: string; revision: string; applicationPrice: number | null },
): Promise<Date> {
  const now = new Date();
  const nextRevision = new Date(Math.max(now.getTime(), Date.parse(input.revision) + 1));
  const result = await client.classSchedule.updateMany({
    where: { id: input.classScheduleId, updatedAt: new Date(input.revision), status: "SCHEDULED", startsAt: { gt: now } },
    data: { applicationPrice: input.applicationPrice, updatedAt: nextRevision },
  });
  if (result.count !== 1) throw new ApplicationPriceRevisionConflictError();
  return nextRevision;
}
