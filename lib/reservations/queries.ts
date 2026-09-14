import { Prisma } from "@prisma/client";
import {
  requireAdminPrincipal,
  requireAssignedClass,
  requireOperationalPrincipal,
  type TeacherPrincipal,
} from "@/lib/auth/authorization";
import { prisma } from "@/lib/db/prisma";
import { buildReservationListWhere, type ReservationListParams } from "@/lib/reservations/query-builder";

export const RESERVATION_LIST_PAGE_SIZE = 20;

export type ListReservationsParams = ReservationListParams & {
  page?: number;
};

// 목록에는 출결/결제 상세 필드를 노출하지 않는다. 각 도메인 상세 화면에서만 조회한다.
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
  await requireOperationalPrincipal();
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

// 목록에는 출결/결제 필드를 노출하지 않는다. 상세 화면에서만 출결 및 결제 요약을 사용한다.
const RESERVATION_OPERATIONAL_DETAIL_SELECT = {
  id: true,
  status: true,
  attendance: true,
  attendanceRecordedAt: true,
  attendanceRecordedBy: { select: { name: true } },
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
} as const satisfies Prisma.ReservationSelect;

const RESERVATION_DETAIL_SELECT = {
  ...RESERVATION_OPERATIONAL_DETAIL_SELECT,
  paymentItem: {
    select: {
      id: true,
      amount: true,
      discountAmount: true,
      paidAmount: true,
      refundedAmount: true,
      payment: {
        select: { id: true, status: true, method: true, paidAt: true },
      },
      refunds: {
        select: {
          id: true,
          amount: true,
          reason: true,
          reasonDetail: true,
          status: true,
          refundedAt: true,
        },
        orderBy: { refundedAt: "desc" as const },
      },
    },
  },
} as const satisfies Prisma.ReservationSelect;

export type ReservationOperationalDetail = Prisma.ReservationGetPayload<{
  select: typeof RESERVATION_OPERATIONAL_DETAIL_SELECT;
}>;

export type ReservationAdminDetail = Prisma.ReservationGetPayload<{
  select: typeof RESERVATION_DETAIL_SELECT;
}>;

export type ReservationDisplayDetail = ReservationAdminDetail | ReservationOperationalDetail;

export async function getReservationDetail(id: string) {
  await requireAdminPrincipal();
  return prisma.reservation.findUnique({
    where: { id },
    select: RESERVATION_DETAIL_SELECT,
  });
}

export async function getReservationOperationalDetail(id: string) {
  await requireOperationalPrincipal();
  return prisma.reservation.findUnique({
    where: { id },
    select: RESERVATION_OPERATIONAL_DETAIL_SELECT,
  });
}

// 클래스 상세 화면(참여 아이 섹션)에서 쓰는 예약 목록. 정원 대비 예약 인원(n/capacity명) 표시도
// 이 목록에서 status === "RESERVED" 인 것만 세어 계산한다 — 별도 count 쿼리를 추가하지 않는다.
const CLASS_RESERVATION_OPERATIONAL_SELECT = {
  id: true,
  status: true,
  attendance: true,
  attendanceRecordedAt: true,
  attendanceRecordedBy: { select: { name: true } },
  child: { select: { id: true, name: true } },
} as const satisfies Prisma.ReservationSelect;

const CLASS_RESERVATION_LIST_SELECT = {
  ...CLASS_RESERVATION_OPERATIONAL_SELECT,
  paymentItem: {
    select: { payment: { select: { status: true } } },
  },
} as const satisfies Prisma.ReservationSelect;

const PARTICIPANT_CHILD_SELECT = {
  id: true,
  name: true,
  guardianName: true,
  guardianPhone: true,
  safetyInfo: {
    select: {
      allergies: true,
      emergencyNotes: true,
      emergencyContactName: true,
      emergencyContactPhone: true,
      emergencyContactRelation: true,
    },
  },
} as const;

export async function listReservationsByClassSchedule(classScheduleId: string) {
  await requireAdminPrincipal();
  return prisma.reservation.findMany({
    where: { classScheduleId },
    select: {
      ...CLASS_RESERVATION_LIST_SELECT,
      child: { select: PARTICIPANT_CHILD_SELECT },
    },
    orderBy: { reservedAt: "asc" },
  });
}

export async function listOperationalReservationsByClassSchedule(classScheduleId: string) {
  await requireOperationalPrincipal();
  return prisma.reservation.findMany({
    where: { classScheduleId },
    select: {
      ...CLASS_RESERVATION_OPERATIONAL_SELECT,
      child: { select: PARTICIPANT_CHILD_SELECT },
    },
    orderBy: { reservedAt: "asc" },
  });
}

export async function listTeacherReservationsByClassSchedule(
  classScheduleId: string,
  principal: TeacherPrincipal,
) {
  await requireAssignedClass(classScheduleId, principal);
  return prisma.reservation.findMany({
    where: {
      classScheduleId,
      classSchedule: { teachers: { some: { teacherId: principal.teacherId } } },
    },
    select: {
      ...CLASS_RESERVATION_OPERATIONAL_SELECT,
      child: { select: PARTICIPANT_CHILD_SELECT },
    },
    orderBy: { reservedAt: "asc" },
  });
}

export type ClassReservationParticipant = Awaited<
  ReturnType<typeof listReservationsByClassSchedule>
>[number];

export type ClassOperationalReservationParticipant = Awaited<
  ReturnType<typeof listOperationalReservationsByClassSchedule>
>[number];

export type ClassTeacherReservationParticipant = Awaited<
  ReturnType<typeof listTeacherReservationsByClassSchedule>
>[number];

export type ClassReservationDisplayParticipant =
  | ClassReservationParticipant
  | ClassOperationalReservationParticipant
  | ClassTeacherReservationParticipant;
