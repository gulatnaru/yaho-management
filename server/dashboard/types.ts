import type { AttendanceStatus, ReservationStatus } from "@prisma/client";

export interface DashboardPeriod {
  month: string;
  selectedDate?: string;
  today: string;
  startUtc: Date;
  endExclusiveUtc: Date;
  todayStartUtc: Date;
  tomorrowStartUtc: Date;
}

export interface DashboardCalendarDayMetric {
  date: string;
  classCount: number;
  operationReservationCount: number;
}

export interface DashboardCalendarCell {
  date: string;
  day: number;
  inCurrentMonth: boolean;
}

export interface DashboardReservationDetail {
  id: string;
  status: ReservationStatus;
  attendance: AttendanceStatus | null;
  child: {
    id: string;
    name: string;
  };
}

export interface DashboardClassDetail {
  id: string;
  startsAt: Date;
  endsAt: Date;
  location: string;
  capacity: number;
  program: {
    id: string;
    name: string;
  };
  teachers: Array<{
    id: string;
    name: string;
  }>;
  reservations: DashboardReservationDetail[];
  operationReservationCount: number;
  reservedCount: number;
  remainingSeats: number;
}

export interface DashboardFinancialMetrics {
  paidAmount: number;
  refundedAmount: number;
  netRevenue: number;
}

export interface DashboardTodayMetrics extends DashboardFinancialMetrics {
  classCount: number;
  operationReservationCount: number;
  cancellationCount: number;
}
