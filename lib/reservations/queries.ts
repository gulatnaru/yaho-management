import { prisma } from "@/lib/db/prisma";
import { buildReservationListWhere, type ReservationListParams } from "@/lib/reservations/query-builder";

export const RESERVATION_LIST_PAGE_SIZE = 20;

export type ListReservationsParams = ReservationListParams & {
  page?: number;
};

// Phase 8(결제/환불) 소유 필드 — paymentItem 은 이번 Phase 스코프가 아니므로 select 하지 않는다.
// attendance(Phase 6 출결)도 마찬가지로 select 하지 않는다.
const RESERVATION_LIST_SELECT = {
  id: true,
  status: true,
  reservedAt: true,
  child: { select: { id: true, name: true } },
  classSchedule: {
    select: {
      id: true,
      startsAt: true,
      endsAt: true,
      status: true,
      program: { select: { id: true, name: true } },
    },
  },
} as const;

export async function listReservations(params: ListReservationsParams) {
  const where = buildReservationListWhere(params);
  const page = params.page && params.page > 0 ? params.page : 1;

  const [reservations, total] = await Promise.all([
    prisma.reservation.findMany({
      where,
      select: RESERVATION_LIST_SELECT,
      orderBy: { classSchedule: { startsAt: "asc" } },
      skip: (page - 1) * RESERVATION_LIST_PAGE_SIZE,
      take: RESERVATION_LIST_PAGE_SIZE,
    }),
    prisma.reservation.count({ where }),
  ]);

  return {
    reservations,
    total,
    page,
    pageSize: RESERVATION_LIST_PAGE_SIZE,
    totalPages: Math.max(1, Math.ceil(total / RESERVATION_LIST_PAGE_SIZE)),
  };
}

// Phase 8(결제/환불) 소유 필드인 paymentItem 과 Phase 6(출결) 소유 필드인 attendance 는
// 목록과 마찬가지로 이번 Phase 스코프가 아니므로 select 하지 않는다.
const RESERVATION_DETAIL_SELECT = {
  id: true,
  status: true,
  reservedAt: true,
  memo: true,
  cancelledAt: true,
  cancelReason: true,
  cancelDetail: true,
  cancelledById: true,
  createdAt: true,
  updatedAt: true,
  child: { select: { id: true, name: true, isActive: true } },
  classSchedule: {
    select: {
      id: true,
      startsAt: true,
      endsAt: true,
      location: true,
      status: true,
      program: { select: { id: true, name: true } },
    },
  },
  cancelledBy: { select: { id: true, name: true } },
} as const;

export async function getReservationDetail(id: string) {
  return prisma.reservation.findUnique({
    where: { id },
    select: RESERVATION_DETAIL_SELECT,
  });
}

// 클래스 상세 화면(참여 아이 섹션)에서 쓰는 예약 목록. 정원 대비 예약 인원(n/capacity명) 표시도
// 이 목록에서 status === "RESERVED" 인 것만 세어 계산한다 — 별도 count 쿼리를 추가하지 않는다.
const CLASS_RESERVATION_LIST_SELECT = {
  id: true,
  status: true,
  child: { select: { id: true, name: true } },
} as const;

export async function listReservationsByClassSchedule(classScheduleId: string) {
  return prisma.reservation.findMany({
    where: { classScheduleId },
    select: CLASS_RESERVATION_LIST_SELECT,
    orderBy: { reservedAt: "asc" },
  });
}

// 아이 상세 화면(예약 이력 섹션)에서 쓰는 예약 목록. 최신 클래스가 위로 오도록 정렬한다.
const CHILD_RESERVATION_LIST_SELECT = {
  id: true,
  status: true,
  classSchedule: {
    select: {
      id: true,
      startsAt: true,
      endsAt: true,
      status: true,
      program: { select: { id: true, name: true } },
    },
  },
} as const;

export async function listReservationsByChild(childId: string) {
  return prisma.reservation.findMany({
    where: { childId },
    select: CHILD_RESERVATION_LIST_SELECT,
    orderBy: { classSchedule: { startsAt: "desc" } },
  });
}
