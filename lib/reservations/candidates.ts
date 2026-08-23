import { prisma } from "@/lib/db/prisma";

export type ChildCandidate = {
  id: string;
  name: string;
};

export type ScheduledClassCandidate = {
  id: string;
  startsAt: Date;
  location: string;
  capacity: number;
  reservedCount: number;
  program: { id: string; name: string };
};

/**
 * ADR-025: 예약 생성 후보 목록은 활성 아이만 노출한다.
 * ChildSafetyInfo 는 포함하지 않는다(ADR-006).
 */
export async function listActiveChildCandidates(): Promise<ChildCandidate[]> {
  return prisma.child.findMany({
    where: { isActive: true },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
}

/**
 * 예약 생성 후보 클래스 목록.
 * - status가 SCHEDULED(예정)인 클래스만 후보로 노출한다(취소/완료된 클래스는 제외).
 * - endsAt이 현재 시각보다 과거인(표시상 ENDED, ADR-026) 클래스도 제외한다 — DB status는
 *   클래스가 끝나도 SCHEDULED로 남으므로 endsAt을 별도로 확인해야 한다.
 * - 현재 RESERVED 예약 수가 capacity 미만인 클래스만 노출한다(정원이 가득 찬 클래스는 제외).
 * - startsAt 오름차순으로 정렬한다.
 */
export async function listScheduledClassCandidatesWithCapacity(now: Date = new Date()): Promise<ScheduledClassCandidate[]> {
  const classes = await prisma.classSchedule.findMany({
    where: { status: "SCHEDULED" },
    select: {
      id: true,
      startsAt: true,
      endsAt: true,
      location: true,
      capacity: true,
      program: { select: { id: true, name: true } },
      _count: { select: { reservations: { where: { status: "RESERVED" } } } },
    },
    orderBy: { startsAt: "asc" },
  });

  return classes
    .filter((classItem) => classItem.endsAt >= now)
    .map((classItem) => ({
      id: classItem.id,
      startsAt: classItem.startsAt,
      location: classItem.location,
      capacity: classItem.capacity,
      reservedCount: classItem._count.reservations,
      program: classItem.program,
    }))
    .filter((classItem) => classItem.reservedCount < classItem.capacity);
}
