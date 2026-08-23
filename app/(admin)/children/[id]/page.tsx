import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { calculateAge } from "@/lib/children/age";
import { formatKstDateTimeRange } from "@/lib/classes/datetime";
import { listReservationsByChild } from "@/lib/reservations/queries";
import { getReservationDisplayStatus, type ReservationDisplayStatus } from "@/lib/reservations/status";
import { toTelHref } from "@/lib/shared/contact";
import { getChildDetail } from "@/lib/children/queries";
import { cn } from "@/lib/utils";
import { ChildStatusToggle } from "../_components/child-status-toggle";
import { PlaceholderSection } from "../_components/placeholder-section";

const GENDER_LABEL: Record<string, string> = {
  MALE: "남",
  FEMALE: "여",
  UNSPECIFIED: "선택 안 함",
};

const RESERVATION_STATUS_LABEL: Record<ReservationDisplayStatus, string> = {
  RESERVED: "예약됨",
  CANCELLED: "취소",
  ENDED: "완료",
};

const RESERVATION_STATUS_VARIANT: Record<ReservationDisplayStatus, NonNullable<BadgeProps["variant"]>> = {
  RESERVED: "default",
  CANCELLED: "secondary",
  ENDED: "success",
};

interface ChildDetailPageProps {
  params: Promise<{ id: string }>;
}

export default async function ChildDetailPage({ params }: ChildDetailPageProps) {
  const { id } = await params;
  const [child, reservations] = await Promise.all([getChildDetail(id), listReservationsByChild(id)]);

  if (!child) {
    notFound();
  }

  const age = calculateAge(child.birthDate);

  return (
    <section className="space-y-6">
      <Link className="text-sm text-slate-500 hover:underline" href="/children">
        ← 목록으로
      </Link>

      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <h1 className="text-2xl font-bold">{child.name}</h1>
        <div className="flex flex-col gap-2 md:flex-row md:items-center">
          {child.isActive ? (
            <Link
              className={cn(buttonVariants(), "w-full md:w-auto")}
              href={`/reservations/new?childId=${child.id}`}
            >
              새 예약
            </Link>
          ) : null}
          <Link className={cn(buttonVariants(), "w-full md:w-auto")} href={`/children/${child.id}/edit`}>
            정보 수정
          </Link>
          <ChildStatusToggle buttonClassName="w-full md:w-auto" id={child.id} isActive={child.isActive} />
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>기본 정보</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <p className="text-sm text-slate-500">생년월일</p>
            <p>
              {child.birthDate
                ? `${child.birthDate.toISOString().slice(0, 10)} (만 ${age}세)`
                : "미입력"}
            </p>
          </div>
          <div>
            <p className="text-sm text-slate-500">성별</p>
            <p>{GENDER_LABEL[child.gender] ?? "미입력"}</p>
          </div>
          <div>
            <p className="text-sm text-slate-500">보호자 이름</p>
            <p>{child.guardianName ?? "미입력"}</p>
          </div>
          <div>
            <p className="text-sm text-slate-500">보호자 연락처</p>
            <p>
              {child.guardianPhone ? (
                <a className="hover:underline" href={toTelHref(child.guardianPhone)}>
                  {child.guardianPhone}
                </a>
              ) : (
                "미입력"
              )}
            </p>
          </div>
          <div>
            <p className="text-sm text-slate-500">상태</p>
            <p>{child.isActive ? "활성" : "비활성"}</p>
          </div>
          <div>
            <p className="text-sm text-slate-500">등록일</p>
            <p>{child.registeredAt.toISOString().slice(0, 10)}</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>운영 메모</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="whitespace-pre-wrap text-sm text-slate-700">{child.memo || "메모가 없습니다."}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>예약 이력</CardTitle>
        </CardHeader>
        <CardContent>
          {reservations.length === 0 ? (
            <p className="text-sm text-slate-500">아직 예약 이력이 없습니다.</p>
          ) : (
            <ul className="space-y-2">
              {reservations.map((reservation) => {
                const displayStatus = getReservationDisplayStatus(reservation, reservation.classSchedule);
                return (
                  <li className="flex items-center justify-between text-sm" key={reservation.id}>
                    <Link className="font-medium hover:underline" href={`/classes/${reservation.classSchedule.id}`}>
                      {reservation.classSchedule.program.name}
                      <span className="block text-xs text-slate-500">
                        {formatKstDateTimeRange(reservation.classSchedule.startsAt, reservation.classSchedule.endsAt)}
                      </span>
                    </Link>
                    <span className="flex items-center gap-3">
                      <Badge variant={RESERVATION_STATUS_VARIANT[displayStatus]}>
                        {RESERVATION_STATUS_LABEL[displayStatus]}
                      </Badge>
                      {displayStatus === "RESERVED" ? (
                        <Link
                          className="text-red-600 hover:underline"
                          href={`/reservations/${reservation.id}/cancel`}
                        >
                          예약 취소
                        </Link>
                      ) : null}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <PlaceholderSection description="Phase 7에서 제공 예정" title="친구관계" />
        <PlaceholderSection description="Phase 7에서 제공 예정" title="형제/자매관계" />
        <PlaceholderSection description="Phase 8에서 제공 예정" title="결제 이력" />
        <PlaceholderSection description="Phase 8에서 제공 예정" title="환불 이력" />
        <PlaceholderSection description="Phase 6에서 제공 예정" title="안전 정보 및 동의 현황" />
      </div>
    </section>
  );
}
