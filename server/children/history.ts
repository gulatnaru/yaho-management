import { Prisma } from "@prisma/client";
import {
  CHILD_HISTORY_PAGE_SIZE,
  MAX_CHILD_HISTORY_PAGE,
} from "@/lib/children/history";
import { prisma } from "@/lib/db/prisma";

const CHILD_HISTORY_ITEM_SELECT = {
  id: true,
  status: true,
  attendance: true,
  classSchedule: {
    select: {
      id: true,
      status: true,
      startsAt: true,
      endsAt: true,
      location: true,
      program: { select: { id: true, name: true } },
    },
  },
  paymentItem: {
    select: { payment: { select: { status: true } } },
  },
} as const satisfies Prisma.ReservationSelect;

export type ChildHistoryItem = Prisma.ReservationGetPayload<{
  select: typeof CHILD_HISTORY_ITEM_SELECT;
}>;

export type ChildHistorySummary = {
  totalReservations: number;
  presentCount: number;
  absentCount: number;
  cancelledCount: number;
  upcomingCount: number;
};

export function buildChildUpcomingWhere(
  childId: string,
  now: Date,
): Prisma.ReservationWhereInput {
  return {
    childId,
    status: "RESERVED",
    classSchedule: {
      status: "SCHEDULED",
      endsAt: { gte: now },
    },
  };
}

export function buildChildPastHistoryWhere(
  childId: string,
  now: Date,
): Prisma.ReservationWhereInput {
  return {
    childId,
    OR: [
      { status: { in: ["COMPLETED", "NO_SHOW", "CANCELLED"] } },
      { classSchedule: { status: "CANCELLED" } },
      {
        status: "RESERVED",
        classSchedule: { endsAt: { lt: now } },
      },
    ],
  };
}

export async function getChildHistorySummary(
  childId: string,
  now: Date,
): Promise<ChildHistorySummary> {
  const [groups, upcomingCount] = await Promise.all([
    prisma.reservation.groupBy({
      by: ["status", "attendance"],
      where: { childId },
      _count: { _all: true },
    }),
    prisma.reservation.count({ where: buildChildUpcomingWhere(childId, now) }),
  ]);

  const summary: ChildHistorySummary = {
    totalReservations: 0,
    presentCount: 0,
    absentCount: 0,
    cancelledCount: 0,
    upcomingCount,
  };

  for (const group of groups) {
    const count = group._count._all;
    summary.totalReservations += count;
    if (group.attendance === "PRESENT") summary.presentCount += count;
    if (group.attendance === "ABSENT") summary.absentCount += count;
    if (group.status === "CANCELLED") summary.cancelledCount += count;
  }

  return summary;
}

export async function listChildUpcomingReservations(
  childId: string,
  now: Date,
): Promise<ChildHistoryItem[]> {
  return prisma.reservation.findMany({
    where: buildChildUpcomingWhere(childId, now),
    select: CHILD_HISTORY_ITEM_SELECT,
    orderBy: [
      { classSchedule: { startsAt: "asc" } },
      { id: "asc" },
    ],
  });
}

export async function listChildPastHistory(
  childId: string,
  now: Date,
  page: number,
) {
  const safePage =
    Number.isInteger(page) && page > 0 ? Math.min(page, MAX_CHILD_HISTORY_PAGE) : 1;
  const where = buildChildPastHistoryWhere(childId, now);
  const take = safePage * CHILD_HISTORY_PAGE_SIZE;
  const [items, total] = await Promise.all([
    prisma.reservation.findMany({
      where,
      select: CHILD_HISTORY_ITEM_SELECT,
      orderBy: [
        { classSchedule: { startsAt: "desc" } },
        { id: "desc" },
      ],
      take,
    }),
    prisma.reservation.count({ where }),
  ]);

  return {
    items,
    total,
    page: safePage,
    pageSize: CHILD_HISTORY_PAGE_SIZE,
    hasMore: safePage < MAX_CHILD_HISTORY_PAGE && items.length < total,
  };
}
