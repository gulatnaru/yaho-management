import { prisma } from "@/lib/db/prisma";
import { buildChildListWhere, type ChildListStatus } from "@/lib/children/query-builder";
import { formatKstDate } from "@/lib/classes/datetime";

export const CHILD_LIST_PAGE_SIZE = 20;

export type ListChildrenParams = {
  q?: string;
  status: ChildListStatus;
  page?: number;
};

// 목록 조회에서 반환하는 필드. ChildSafetyInfo 는 절대 select/include 하지 않는다 (ADR-006).
const CHILD_LIST_SELECT = {
  id: true,
  name: true,
  birthDate: true,
  guardianName: true,
  guardianPhone: true,
  isActive: true,
} as const;

/**
 * 페이지에 보이는 아이들의 "다음 예약일"을 배치로 조회한다(ADR-012/ADR-015: 아이 목록 예약일자 열).
 * 아이별로 각각 조회하면 N+1이 되므로, childId 목록을 한 번에 IN 조건으로 묶어 조회하고
 * classSchedule.startsAt 오름차순으로 정렬한 뒤 아이당 첫 값(=가장 가까운 미래 예약)만 취한다.
 * 현재 시각 이후 시작하는 RESERVED 예약만 대상으로 한다. 없으면 맵에 값이 없다(호출부에서 "–" 처리).
 */
async function loadNextReservationDates(childIds: string[]): Promise<Map<string, string>> {
  if (childIds.length === 0) {
    return new Map();
  }

  const upcomingReservations = await prisma.reservation.findMany({
    where: {
      childId: { in: childIds },
      status: "RESERVED",
      classSchedule: { startsAt: { gte: new Date() } },
    },
    select: {
      childId: true,
      classSchedule: { select: { startsAt: true } },
    },
    orderBy: { classSchedule: { startsAt: "asc" } },
  });

  const nextReservationDateByChildId = new Map<string, string>();
  for (const reservation of upcomingReservations) {
    if (!nextReservationDateByChildId.has(reservation.childId)) {
      nextReservationDateByChildId.set(reservation.childId, formatKstDate(reservation.classSchedule.startsAt));
    }
  }
  return nextReservationDateByChildId;
}

export async function listChildren(params: ListChildrenParams) {
  const where = buildChildListWhere({ q: params.q, status: params.status });
  const page = params.page && params.page > 0 ? params.page : 1;

  const [children, total] = await Promise.all([
    prisma.child.findMany({
      where,
      select: CHILD_LIST_SELECT,
      orderBy: { name: "asc" },
      skip: (page - 1) * CHILD_LIST_PAGE_SIZE,
      take: CHILD_LIST_PAGE_SIZE,
    }),
    prisma.child.count({ where }),
  ]);

  const nextReservationDateByChildId = await loadNextReservationDates(children.map((child) => child.id));

  return {
    children: children.map((child) => ({
      ...child,
      nextReservationDate: nextReservationDateByChildId.get(child.id) ?? null,
    })),
    total,
    page,
    pageSize: CHILD_LIST_PAGE_SIZE,
    totalPages: Math.max(1, Math.ceil(total / CHILD_LIST_PAGE_SIZE)),
  };
}

// 상세 조회. ChildSafetyInfo 는 절대 select/include 하지 않는다 (ADR-006).
// 친구관계/형제자매관계/예약/결제/환불/안전정보는 Phase 2에서는 placeholder-section 으로만 표시한다 (ADR-011).
export async function getChildDetail(id: string) {
  return prisma.child.findUnique({
    where: { id },
  });
}
