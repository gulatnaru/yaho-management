import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { WarningBanner } from "@/components/ui/warning-banner";
import {
  formatKstDate,
  formatKstDateTimeRange,
  formatKstTime,
} from "@/lib/classes/datetime";
import { getClassDetail } from "@/lib/classes/queries";
import { getClassDisplayStatus, type ClassDisplayStatus } from "@/lib/classes/status";
import { isUnderStaffed } from "@/lib/classes/teacher-warning";
import { listReservationsByClassSchedule } from "@/lib/reservations/queries";
import { toTelHref } from "@/lib/shared/contact";
import { cn } from "@/lib/utils";
import { ClassParticipantList } from "../_components/class-participant-list";

const CLASS_LABEL: Record<ClassDisplayStatus, string> = {
  SCHEDULED: "예정",
  CANCELLED: "취소",
  ENDED: "완료",
};

const CLASS_VARIANT: Record<ClassDisplayStatus, NonNullable<BadgeProps["variant"]>> = {
  SCHEDULED: "default",
  CANCELLED: "secondary",
  ENDED: "success",
};

const CANCEL_REASON_LABEL: Record<string, string> = {
  WEATHER: "날씨",
  SAFETY: "안전 문제",
  MINIMUM_ENROLLMENT: "최소 인원 미달",
  OPERATION: "운영 사정",
  OTHER: "기타",
};

export default async function ClassDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [classDetail, reservations] = await Promise.all([
    getClassDetail(id),
    listReservationsByClassSchedule(id),
  ]);
  if (!classDetail) notFound();

  const classStatus = getClassDisplayStatus(classDetail);
  const teacherCount = classDetail.teachers.length;
  const reservedCount = reservations.filter((reservation) => reservation.status === "RESERVED").length;

  return (
    <section className="space-y-6">
      <Link className="text-sm text-slate-500 hover:underline" href="/classes">
        클래스 목록으로
      </Link>

      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <h1 className="text-2xl font-bold">
          {formatKstDateTimeRange(classDetail.startsAt, classDetail.endsAt)}
        </h1>
        <div className="flex flex-wrap gap-2">
          {classStatus === "SCHEDULED" ? (
            <Link className={cn(buttonVariants())} href={`/reservations/new?classScheduleId=${id}`}>
              예약 추가
            </Link>
          ) : null}
          {classStatus === "SCHEDULED" ? (
            <>
              <Link className={cn(buttonVariants())} href={`/classes/${id}/edit`}>
                정보 수정
              </Link>
              <Link
                className={cn(buttonVariants(), "bg-red-600 hover:bg-red-700")}
                href={`/classes/${id}/cancel`}
              >
                클래스 취소
              </Link>
            </>
          ) : null}
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>기본 정보</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div>
            <p className="text-sm text-slate-500">프로그램</p>
            <Link className="break-all hover:underline" href={`/programs/${classDetail.program.id}`}>
              {classDetail.program.name}
            </Link>
          </div>
          <div>
            <p className="text-sm text-slate-500">일시</p>
            <p>{formatKstDateTimeRange(classDetail.startsAt, classDetail.endsAt)}</p>
          </div>
          <div>
            <p className="text-sm text-slate-500">장소</p>
            <p className="break-all">{classDetail.location}</p>
          </div>
          <div>
            <p className="text-sm text-slate-500">정원</p>
            <p>{classDetail.capacity}명</p>
          </div>
          <div>
            <p className="text-sm text-slate-500">예약 인원</p>
            <p>
              {reservedCount}/{classDetail.capacity}명
            </p>
          </div>
          <div>
            <p className="text-sm text-slate-500">상태</p>
            <Badge variant={CLASS_VARIANT[classStatus]}>{CLASS_LABEL[classStatus]}</Badge>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>보험 및 안전 정보</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div>
            <p className="text-sm text-slate-500">보험 가입</p>
            <p>{classDetail.insured ? "가입" : "미가입"}</p>
          </div>
          <div>
            <p className="text-sm text-slate-500">보험사</p>
            <p>{classDetail.insurer || "미입력"}</p>
          </div>
          <div>
            <p className="text-sm text-slate-500">증권번호</p>
            <p>{classDetail.insurancePolicyNo || "미입력"}</p>
          </div>
          <div className="sm:col-span-2">
            <p className="text-sm text-slate-500">활동 장소 안전 특이사항</p>
            <p className="whitespace-pre-wrap">
              {classDetail.safetyMemo || "등록된 메모가 없습니다."}
            </p>
          </div>
        </CardContent>
      </Card>

      {classDetail.status === "CANCELLED" ? (
        <Card>
          <CardHeader>
            <CardTitle>취소 정보</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div>
              <p className="text-sm text-slate-500">취소 일시</p>
              <p>
                {classDetail.cancelledAt
                  ? `${formatKstDate(classDetail.cancelledAt)} ${formatKstTime(classDetail.cancelledAt)}`
                  : "-"}
              </p>
            </div>
            <div>
              <p className="text-sm text-slate-500">취소 사유</p>
              <p>{classDetail.cancelReason ? CANCEL_REASON_LABEL[classDetail.cancelReason] : "-"}</p>
            </div>
            <div>
              <p className="text-sm text-slate-500">처리자</p>
              <p>{classDetail.cancelledBy?.name ?? "-"}</p>
            </div>
            <div className="sm:col-span-2">
              <p className="text-sm text-slate-500">상세 사유</p>
              <p className="whitespace-pre-wrap">
                {classDetail.cancelDetail || "상세 사유가 없습니다."}
              </p>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>운영 메모</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="whitespace-pre-wrap text-sm text-slate-700">
            {classDetail.memo || "메모가 없습니다."}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>담당 선생님</CardTitle>
        </CardHeader>
        <CardContent>
          {classDetail.teachers.length === 0 ? (
            <p className="text-sm text-slate-500">배정된 선생님이 없습니다.</p>
          ) : (
            <ul className="space-y-2">
              {classDetail.teachers.map((assignment) => (
                <li className="flex justify-between gap-3 text-sm" key={assignment.id}>
                  <span>{assignment.teacher.name}</span>
                  {assignment.teacher.phone ? (
                    <a className="break-all hover:underline" href={toTelHref(assignment.teacher.phone)}>
                      {assignment.teacher.phone}
                    </a>
                  ) : (
                    <span className="text-slate-400">연락처 미입력</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {isUnderStaffed(teacherCount) ? (
        <WarningBanner>
          선생님이 {teacherCount}명만 배정되어 있습니다. 원칙은 2명입니다.
        </WarningBanner>
      ) : null}

      <ClassParticipantList
        classSchedule={{ status: classDetail.status, endsAt: classDetail.endsAt }}
        reservations={reservations}
      />
    </section>
  );
}
