import { prisma } from "@/lib/db/prisma";

/**
 * 선생님이 미래(now 이후) 시작하는 SCHEDULED 클래스에 몇 건 배정되어 있는지 센다.
 * 비활성화를 막지 않는 경고용 조회다(ADR-018). 과거/완료/취소된 클래스는 포함하지 않는다.
 */
export async function countFutureScheduledAssignments(
  teacherId: string,
  now: Date = new Date(),
): Promise<number> {
  return prisma.classTeacher.count({
    where: {
      teacherId,
      classSchedule: {
        status: "SCHEDULED",
        startsAt: { gt: now },
      },
    },
  });
}
