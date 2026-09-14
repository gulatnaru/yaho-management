import Link from "next/link";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { formatKstDateTimeRange } from "@/lib/classes/datetime";
import {
  getChildHistoryClassLabel,
  getChildHistoryReservationLabel,
  type ChildHistoryClassLabel,
  type ChildHistoryReservationLabel,
} from "@/lib/children/history";
import {
  getChildHistoryPaymentLabel,
  type ChildHistoryPaymentLabel,
} from "@/lib/payments/child-history-status";
import { canCancelReservation } from "@/lib/reservations/cancellation";
import { getAttendanceLabel } from "@/lib/reservations/participants";
import { cn } from "@/lib/utils";
import type { ChildHistoryDisplayItem } from "@/server/children/history";

const CLASS_VARIANTS: Record<ChildHistoryClassLabel, NonNullable<BadgeProps["variant"]>> = {
  "수업 예정": "default",
  "수업 완료": "success",
  "수업 취소": "warning",
};

const RESERVATION_VARIANTS: Record<
  ChildHistoryReservationLabel,
  NonNullable<BadgeProps["variant"]>
> = {
  예약됨: "default",
  "예약 취소": "secondary",
  참여완료: "success",
  노쇼: "warning",
};

const PAYMENT_VARIANTS: Record<
  ChildHistoryPaymentLabel,
  NonNullable<BadgeProps["variant"]>
> = {
  결제완료: "success",
  부분환불: "warning",
  전액환불: "secondary",
  미결제: "secondary",
};

export function ChildHistoryCard({
  item,
  now,
  showPayment,
}: {
  item: ChildHistoryDisplayItem;
  now: Date;
  showPayment: boolean;
}) {
  const classLabel = getChildHistoryClassLabel(item.classSchedule, now);
  const reservationLabel = getChildHistoryReservationLabel(item.status);
  const attendanceLabel = getAttendanceLabel(item.attendance);
  const paymentLabel =
    showPayment && "paymentItem" in item
      ? getChildHistoryPaymentLabel(item.paymentItem?.payment.status)
      : undefined;
  const canCancel = canCancelReservation(item, item.classSchedule, now);

  return (
    <article
      aria-label={`${item.classSchedule.program.name} 예약 이력`}
      className="min-w-0 rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
    >
      <div className="min-w-0">
        <h3 className="break-words font-semibold">{item.classSchedule.program.name}</h3>
        <p className="mt-1 break-words text-sm text-slate-600">
          {formatKstDateTimeRange(item.classSchedule.startsAt, item.classSchedule.endsAt)}
        </p>
        <p className="mt-1 break-words text-sm text-slate-500">{item.classSchedule.location}</p>
      </div>

      <dl className={`mt-4 grid min-w-0 grid-cols-2 gap-3 text-sm ${showPayment ? "md:grid-cols-4" : "md:grid-cols-3"}`}>
        <div className="min-w-0">
          <dt className="text-xs text-slate-500">수업</dt>
          <dd className="mt-1">
            <Badge variant={CLASS_VARIANTS[classLabel]}>{classLabel}</Badge>
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-xs text-slate-500">예약</dt>
          <dd className="mt-1">
            <Badge variant={RESERVATION_VARIANTS[reservationLabel]}>{reservationLabel}</Badge>
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-xs text-slate-500">출결</dt>
          <dd className="mt-1">
            <Badge
              variant={
                item.attendance === "PRESENT"
                  ? "success"
                  : item.attendance === "ABSENT"
                    ? "warning"
                    : "secondary"
              }
            >
              {attendanceLabel}
            </Badge>
          </dd>
        </div>
        {paymentLabel ? (
          <div className="min-w-0">
            <dt className="text-xs text-slate-500">결제</dt>
            <dd className="mt-1">
              <Badge variant={PAYMENT_VARIANTS[paymentLabel]}>{paymentLabel}</Badge>
            </dd>
          </div>
        ) : null}
      </dl>

      <div className="mt-4 flex flex-col gap-2 md:flex-row">
        <Link
          className={cn(
            buttonVariants(),
            "w-full bg-white text-slate-900 ring-1 ring-slate-300 hover:bg-slate-100 md:w-auto",
          )}
          href={`/classes/${item.classSchedule.id}`}
        >
          클래스 상세
        </Link>
        <Link
          className={cn(
            buttonVariants(),
            "w-full bg-white text-slate-900 ring-1 ring-slate-300 hover:bg-slate-100 md:w-auto",
          )}
          href={`/reservations/${item.id}`}
        >
          예약 상세
        </Link>
        {canCancel ? (
          <Link
            className={cn(buttonVariants(), "w-full bg-red-600 hover:bg-red-700 md:w-auto")}
            href={`/reservations/${item.id}/cancel`}
          >
            예약 취소
          </Link>
        ) : null}
      </div>
    </article>
  );
}
