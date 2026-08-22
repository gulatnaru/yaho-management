import Link from "next/link";
import { notFound } from "next/navigation";
import { PlaceholderSection } from "@/app/(admin)/children/_components/placeholder-section";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { WarningBanner } from "@/components/ui/warning-banner";
import { formatKstDate, formatKstDateTimeRange, formatKstTime } from "@/lib/classes/datetime";
import { getClassDetail } from "@/lib/classes/queries";
import { isUnderStaffed } from "@/lib/classes/teacher-warning";
import { toTelHref } from "@/lib/shared/contact";
import { cn } from "@/lib/utils";

interface ClassDetailPageProps {
  params: Promise<{ id: string }>;
}

type ClassStatusValue = "SCHEDULED" | "CANCELLED" | "COMPLETED";

const STATUS_LABEL: Record<ClassStatusValue, string> = {
  SCHEDULED: "예정",
  CANCELLED: "취소",
  COMPLETED: "완료",
};

const STATUS_VARIANT: Record<ClassStatusValue, NonNullable<BadgeProps["variant"]>> = {
  SCHEDULED: "default",
  CANCELLED: "secondary",
  COMPLETED: "success",
};

// REQUIREMENTS.md 9.3 취소 사유 코드
type ClassCancelReasonValue = "WEATHER" | "SAFETY" | "MINIMUM_ENROLLMENT" | "OPERATION" | "OTHER";

const CANCEL_REASON_LABEL: Record<ClassCancelReasonValue, string> = {
  WEATHER: "날씨",
  SAFETY: "안전 문제",
  MINIMUM_ENROLLMENT: "최소 인원 미달",
  OPERATION: "운영 사정",
  OTHER: "기타",
};

export default async function ClassDetailPage({ params }: ClassDetailPageProps) {
  const { id } = await params;
  const classDetail = await getClassDetail(id);

  if (!classDetail) {
    notFound();
  }

  const teacherCount = classDetail.teachers.length;
  const showTeacherWarning = isUnderStaffed(teacherCount);

  return (
    <section className="space-y-6">
      <Link className="text-sm text-slate-500 hover:underline" href="/classes">
        ← 목록으로
      </Link>

      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{formatKstDateTimeRange(classDetail.startsAt, classDetail.endsAt)}</h1>
        <div className="flex items-center gap-2">
          {classDetail.status === "SCHEDULED" ? (
            <>
              <Link className={buttonVariants()} href={`/classes/${classDetail.id}/edit`}>
                정보 수정
              </Link>
              <Link
                className={cn(buttonVariants(), "bg-red-600 hover:bg-red-700")}
                href={`/classes/${classDetail.id}/cancel`}
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
        <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <p className="text-sm text-slate-500">프로그램</p>
            <p>
              <Link className="hover:underline" href={`/programs/${classDetail.program.id}`}>
                {classDetail.program.name}
              </Link>
            </p>
          </div>
          <div>
            <p className="text-sm text-slate-500">날짜/시간</p>
            <p>{formatKstDateTimeRange(classDetail.startsAt, classDetail.endsAt)}</p>
          </div>
          <div>
            <p className="text-sm text-slate-500">장소</p>
            <p>{classDetail.location}</p>
          </div>
          <div>
            <p className="text-sm text-slate-500">정원</p>
            <p>{classDetail.capacity}명</p>
          </div>
          <div>
            <p className="text-sm text-slate-500">상태</p>
            <p>
              <Badge variant={STATUS_VARIANT[classDetail.status]}>{STATUS_LABEL[classDetail.status]}</Badge>
            </p>
          </div>
        </CardContent>
      </Card>

      {classDetail.status === "CANCELLED" ? (
        <Card>
          <CardHeader>
            <CardTitle>취소 정보</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
              <p className="whitespace-pre-wrap text-sm text-slate-700">{classDetail.cancelDetail || "상세 사유가 없습니다."}</p>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>메모</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="whitespace-pre-wrap text-sm text-slate-700">{classDetail.memo || "메모가 없습니다."}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>선생님</CardTitle>
        </CardHeader>
        <CardContent>
          {classDetail.teachers.length === 0 ? (
            <p className="text-sm text-slate-500">배정된 선생님이 없습니다.</p>
          ) : (
            <ul className="space-y-2">
              {classDetail.teachers.map((assignment) => (
                <li className="flex items-center justify-between text-sm" key={assignment.id}>
                  <span>{assignment.teacher.name}</span>
                  {assignment.teacher.phone ? (
                    <a className="text-slate-600 hover:underline" href={toTelHref(assignment.teacher.phone)}>
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

      {showTeacherWarning ? (
        <WarningBanner>선생님이 {teacherCount}명만 배정되어 있습니다. 원칙은 2명입니다.</WarningBanner>
      ) : null}

      <PlaceholderSection description="Phase 5에서 제공 예정" title="참여 아이" />
    </section>
  );
}
