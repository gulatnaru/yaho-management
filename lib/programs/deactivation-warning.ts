import { prisma } from "@/lib/db/prisma";

/**
 * 프로그램에 딸린, 미래(now 이후) 시작하는 SCHEDULED 클래스가 몇 건인지 센다.
 * 비활성화를 막지 않는 경고용 조회다(ADR-018). 과거/완료/취소된 클래스는 포함하지 않는다.
 */
export async function countFutureScheduledClasses(programId: string, now: Date = new Date()): Promise<number> {
  return prisma.classSchedule.count({
    where: {
      programId,
      status: "SCHEDULED",
      startsAt: { gt: now },
    },
  });
}
